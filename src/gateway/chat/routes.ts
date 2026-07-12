import { Hono } from 'hono';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ServerDeps } from '../server.js';
import { applyFilters, type QuickFilter } from '../filters.js';
import type { MemoryRow, SkillRow } from '../../database/datastore.js';
import { runCode } from '../code-runner/runner.js';

type SmsMessage = { address: string; body: string; date: number };
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type SmsHistoryEntry = { address: string; body: string; date: number; type: number };
type ToolOutput = { name: string; input: Record<string, unknown>; output: string };

const MEMORY_LIMIT = 50;

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  groq: 'llama-3.3-70b-versatile',
  google: 'gemini-2.0-flash',
  ollama: 'llama3',
};

const DEFAULT_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  ollama: 'http://localhost:11434/v1',
};

const MAX_TOOL_ROUNDS = 5;


// Pending auto-replies for the drain path: when Node.js starts after the app was killed,
// it replays queued SMS via ?drain=true, stores them here, and the WebView picks them up.
const pendingAutoReplies = new Map<string, { to: string; body: string; createdAt: number }>();

function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp('(?:^|;)\\s*' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getClient(deps: ServerDeps): OpenAI {
  const ai = deps.config.ai!;
  const provider = ai.provider ?? 'anthropic';
  const baseURL = ai.base_url ?? DEFAULT_BASE_URLS[provider];
  return new OpenAI({ apiKey: ai.api_key, ...(baseURL ? { baseURL } : {}) });
}

export function getModel(deps: ServerDeps): string {
  const ai = deps.config.ai!;
  return ai.model ?? DEFAULT_MODELS[ai.provider ?? 'anthropic'] ?? 'claude-sonnet-4-6';
}

async function buildTools(deps: ServerDeps): Promise<OpenAI.ChatCompletionTool[]> {
  const tools: OpenAI.ChatCompletionTool[] = [];

  if (await deps.tokenManager.hasToken('gmail')) {
    tools.push({
      type: 'function',
      function: {
        name: 'read_emails',
        description: 'Read emails from Gmail. Respects owner access control filters.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Gmail search query (e.g. "is:unread from:alice")' },
            limit: { type: 'number', description: 'Max results (default 20)' },
          },
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'draft_email',
        description: 'Propose creating an email draft. Staged for owner review before saving.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Email body' },
            in_reply_to: { type: 'string', description: 'Message ID for threading (optional)' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'send_email',
        description: 'Propose sending an email. Staged for owner review before sending.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Email body' },
            in_reply_to: { type: 'string', description: 'Message ID for threading (optional)' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
    });
  }

  if (await deps.tokenManager.hasToken('google_calendar')) {
    tools.push({
      type: 'function',
      function: {
        name: 'read_calendar_events',
        description: 'Read events from Google Calendar.',
        parameters: {
          type: 'object',
          properties: {
            after: { type: 'string', description: 'ISO timestamp — only events after this time' },
            limit: { type: 'number', description: 'Max results (default 20)' },
          },
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'create_calendar_event',
        description: 'Propose creating a Google Calendar event. Staged for owner review.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Event title' },
            start: { type: 'string', description: 'ISO start time' },
            end: { type: 'string', description: 'ISO end time' },
            body: { type: 'string', description: 'Event description (optional)' },
            location: { type: 'string', description: 'Event location (optional)' },
          },
          required: ['title', 'start', 'end'],
        },
      },
    });
  }

  if (await deps.tokenManager.hasToken('github')) {
    tools.push({
      type: 'function',
      function: {
        name: 'search_github_issues',
        description: 'Search GitHub issues.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' },
          },
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'search_github_prs',
        description: 'Search GitHub pull requests.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results' },
          },
        },
      },
    });
  }

  // Always available — executed client-side via window.AndroidSms.sendMessage
  tools.push({
    type: 'function',
    function: {
      name: 'send_sms',
      description: 'Propose sending an SMS message. Staged for owner approval before sending.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number' },
          body: { type: 'string', description: 'SMS message text' },
        },
        required: ['to', 'body'],
      },
    },
  });

  // Memory tools — always available
  tools.push({
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'Save a fact about the user to persistent memory. Use this proactively when the user shares preferences, context, or ongoing projects. Max 50 memories — if at capacity, use update_memory or delete_memory first.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact to remember (concise, one sentence)' },
        },
        required: ['content'],
      },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'update_memory',
      description: 'Update an existing memory by ID. Use when a remembered fact has changed.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID from the system prompt' },
          content: { type: 'string', description: 'Updated fact' },
        },
        required: ['id', 'content'],
      },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'delete_memory',
      description: 'Delete a memory by ID. Use when a remembered fact is no longer relevant.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID from the system prompt' },
        },
        required: ['id'],
      },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'list_skills',
      description: 'List all agent skills. Returns each skill\'s id, name, description, rules, and enabled status.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'save_skill',
      description: 'Create or update an agent skill. Each trigger_event can have one active skill at a time. Pass id to update an existing skill, omit id to create a new one. Activating a skill automatically deactivates any other skill with the same trigger.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill ID to update (omit to create new)' },
          name: { type: 'string', description: 'Short name for this skill' },
          instructions: { type: 'string', description: 'Full behavior instructions as plain text. Can include what context to check, reply style, and behavioral rules.' },
          trigger_event: { type: 'string', description: 'When this skill fires. Currently supported: sms_received' },
          activate: { type: 'boolean', description: 'If true, make this skill the active one for its trigger (default false)' },
        },
        required: ['name', 'instructions', 'trigger_event'],
      },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'delete_skill',
      description: 'Delete an agent skill by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill ID to delete' },
        },
        required: ['id'],
      },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'run_code',
      description: `Execute JavaScript on this device's Node.js runtime. Use for computations, file I/O, network requests, or data processing.
Globals available: fetch, require (fs, path, crypto, etc.), Buffer, URL, URLSearchParams, setTimeout, AbortController, __dataDir (app data directory path).
Top-level await is supported. Each call starts with a fresh context — write files to __dataDir to persist data between calls.
Use console.log() to emit output; return values are not captured.`,
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'JavaScript code to execute. Use console.log() to produce visible output.',
          },
          description: {
            type: 'string',
            description: 'One-line description of what this code does (logged to audit trail).',
          },
        },
        required: ['code'],
      },
    },
  });

  return tools;
}

function buildSystemPrompt(deps: ServerDeps, sms: SmsMessage[] | null, memories: MemoryRow[]): string {
  const today = new Date().toISOString().split('T')[0];
  const lines = [
    `You are a personal AI assistant inside PersonalDataHub on the user's Android phone. Today is ${today}.`,
    '',
    'You help the user understand and act on their personal data. Read tools fetch live data. Write tools (send_sms, send_email, etc.) create staged proposals that the user must review and explicitly approve before anything is sent or saved — always make clear you are proposing, not executing.',
    '',
    `Connected sources: ${Object.keys(deps.config.sources).join(', ') || 'none'}`,
  ];

  if (memories.length > 0) {
    lines.push('', 'What you remember about the user:');
    memories.forEach(m => lines.push(`  [id:${m.id}] ${m.content}`));
  }

  lines.push('', 'Memory: Use save_memory() to record important facts the user shares (preferences, ongoing projects, personal context). Use update_memory(id) when a fact changes. Use delete_memory(id) for stale facts. Be proactive but concise — one clear sentence per memory.');
  lines.push('', 'Skills: Use list_skills() to see agent skills (one active per trigger). Use save_skill(name, instructions, trigger_event, activate?) to create/update a skill — set activate=true to make it the active one for that trigger, which deactivates any other. Use delete_skill(id) to remove one. Currently supported trigger: sms_received.');
  lines.push('', 'Code execution: Use run_code() to run JavaScript on this device. Supports top-level await, fetch, require (fs, path, etc.), Buffer, and __dataDir (path to app data). Use console.log() to emit output — return values are ignored. Each call is a fresh context; write files at __dataDir to persist data between calls.');

  if (sms && sms.length > 0) {
    lines.push('', 'Recent SMS messages (newest first):');
    sms.slice(0, 50).forEach(msg => {
      const d = new Date(msg.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      lines.push(`  [${d}] ${msg.address}: ${msg.body.slice(0, 200)}`);
    });
  } else if (sms === null) {
    lines.push('', 'SMS context: not loaded. If the user asks about SMS messages, suggest they open the SMS tab first.');
  }

  return lines.join('\n');
}

async function executeTool(
  deps: ServerDeps,
  name: string,
  input: Record<string, unknown>,
  stagedActionIds: string[],
): Promise<string> {
  switch (name) {
    case 'read_emails': {
      const connector = deps.connectorRegistry.get('gmail');
      if (!connector) return JSON.stringify({ error: 'Gmail not connected' });
      const boundary = deps.config.sources['gmail']?.boundary ?? {};
      const params: Record<string, unknown> = {};
      if (input.query) params.query = input.query;
      if (input.limit) params.limit = input.limit;
      const rows = await connector.fetch(boundary, Object.keys(params).length ? params : undefined);
      const filters = (await deps.store.getEnabledFiltersBySource('gmail')) as QuickFilter[];
      return JSON.stringify(applyFilters(rows, filters).slice(0, Number(input.limit ?? 20)).map(r => {
        const d = r.data as Record<string, unknown>;
        const rawBody = typeof d.body === 'string' ? d.body : '';
        const clean = rawBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
        return { id: r.source_item_id, subject: d.title, from: d.author_email || d.author_name, snippet: d.snippet || clean, date: r.timestamp };
      }));
    }

    case 'read_calendar_events': {
      const connector = deps.connectorRegistry.get('google_calendar');
      if (!connector) return JSON.stringify({ error: 'Google Calendar not connected' });
      const boundary = deps.config.sources['google_calendar']?.boundary ?? {};
      const params: Record<string, unknown> = {};
      if (input.after) params.after = input.after;
      if (input.limit) params.limit = input.limit;
      const rows = await connector.fetch(boundary, Object.keys(params).length ? params : undefined);
      const filters = (await deps.store.getEnabledFiltersBySource('google_calendar')) as QuickFilter[];
      return JSON.stringify(applyFilters(rows, filters).slice(0, Number(input.limit ?? 20)).map(r => {
        const d = r.data as Record<string, unknown>;
        return { id: r.source_item_id, title: d.title, start: d.start, end: d.end, location: d.location, date: r.timestamp };
      }));
    }

    case 'search_github_issues': {
      const connector = deps.connectorRegistry.get('github');
      if (!connector) return JSON.stringify({ error: 'GitHub not connected' });
      const boundary = deps.config.sources['github']?.boundary ?? {};
      const rows = await connector.fetch(boundary, { type: 'issue', ...(input.query ? { query: input.query } : {}), ...(input.limit ? { limit: input.limit } : {}) });
      return JSON.stringify(rows.slice(0, Number(input.limit ?? 20)).map(r => {
        const d = r.data as Record<string, unknown>;
        return { id: r.source_item_id, title: d.title, state: d.state, author: d.author_name, date: r.timestamp };
      }));
    }

    case 'search_github_prs': {
      const connector = deps.connectorRegistry.get('github');
      if (!connector) return JSON.stringify({ error: 'GitHub not connected' });
      const boundary = deps.config.sources['github']?.boundary ?? {};
      const rows = await connector.fetch(boundary, { type: 'pr', ...(input.query ? { query: input.query } : {}), ...(input.limit ? { limit: input.limit } : {}) });
      return JSON.stringify(rows.slice(0, Number(input.limit ?? 20)).map(r => {
        const d = r.data as Record<string, unknown>;
        return { id: r.source_item_id, title: d.title, state: d.state, author: d.author_name, date: r.timestamp };
      }));
    }

    case 'send_sms': {
      const actionId = `act_${randomUUID().slice(0, 12)}`;
      await deps.store.insertStagingAction({
        actionId,
        manifestId: '',
        source: 'sms',
        actionType: 'send_sms',
        actionData: JSON.stringify({ to: input.to, body: input.body }),
        purpose: `AI: send SMS to ${input.to}`,
      });
      stagedActionIds.push(actionId);
      return JSON.stringify({ ok: true, actionId, status: 'pending_review', note: 'Staged for owner approval before sending' });
    }

    case 'draft_email': {
      const actionId = `act_${randomUUID().slice(0, 12)}`;
      await deps.store.insertStagingAction({
        actionId, manifestId: '', source: 'gmail', actionType: 'draft_email',
        actionData: JSON.stringify(input), purpose: `AI: draft email to ${input.to}`,
      });
      stagedActionIds.push(actionId);
      return JSON.stringify({ ok: true, actionId, status: 'pending_review' });
    }

    case 'send_email': {
      const actionId = `act_${randomUUID().slice(0, 12)}`;
      await deps.store.insertStagingAction({
        actionId, manifestId: '', source: 'gmail', actionType: 'send_email',
        actionData: JSON.stringify(input), purpose: `AI: send email to ${input.to}`,
      });
      stagedActionIds.push(actionId);
      return JSON.stringify({ ok: true, actionId, status: 'pending_review' });
    }

    case 'create_calendar_event': {
      const actionId = `act_${randomUUID().slice(0, 12)}`;
      await deps.store.insertStagingAction({
        actionId, manifestId: '', source: 'google_calendar', actionType: 'create_event',
        actionData: JSON.stringify(input), purpose: `AI: create event "${input.title}"`,
      });
      stagedActionIds.push(actionId);
      return JSON.stringify({ ok: true, actionId, status: 'pending_review' });
    }

    case 'save_memory': {
      const content = String(input.content ?? '').trim();
      if (!content) return JSON.stringify({ error: 'content is required' });
      const existing = await deps.store.listMemories();
      if (existing.length >= MEMORY_LIMIT) {
        return JSON.stringify({ error: `Memory is full (${MEMORY_LIMIT} items). Use update_memory or delete_memory to make room.` });
      }
      const memId = `mem_${randomUUID().slice(0, 8)}`;
      await deps.store.insertMemory(memId, content);
      await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_memory_saved', source: null, details: JSON.stringify({ id: memId, content }) });
      return JSON.stringify({ ok: true, id: memId });
    }

    case 'update_memory': {
      const id = String(input.id ?? '').trim();
      const content = String(input.content ?? '').trim();
      if (!id || !content) return JSON.stringify({ error: 'id and content are required' });
      await deps.store.updateMemory(id, content);
      await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_memory_updated', source: null, details: JSON.stringify({ id, content }) });
      return JSON.stringify({ ok: true });
    }

    case 'delete_memory': {
      const id = String(input.id ?? '').trim();
      if (!id) return JSON.stringify({ error: 'id is required' });
      await deps.store.deleteMemory(id);
      await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_memory_deleted', source: null, details: JSON.stringify({ id }) });
      return JSON.stringify({ ok: true });
    }

    case 'list_skills': {
      const skills = await deps.store.listSkills();
      return JSON.stringify({ ok: true, skills });
    }

    case 'save_skill': {
      const name = String(input.name ?? '').trim();
      const instructions = String(input.instructions ?? '').trim();
      const trigger_event = String(input.trigger_event ?? 'sms_received').trim();
      const activate = Boolean(input.activate);
      if (!name || !instructions) return JSON.stringify({ error: 'name and instructions are required' });
      const existingId = String(input.id ?? '').trim();
      if (existingId) {
        await deps.store.updateSkill(existingId, { name, instructions, trigger_event });
        if (activate) await deps.store.activateSkill(existingId, trigger_event);
        await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_skill_updated', source: null, details: JSON.stringify({ id: existingId, name, trigger_event, activate }) });
        return JSON.stringify({ ok: true, id: existingId });
      }
      const skillId = `skill_${randomUUID().slice(0, 12)}`;
      await deps.store.insertSkill({ id: skillId, name, instructions, trigger_event, enabled: 0 });
      if (activate) await deps.store.activateSkill(skillId, trigger_event);
      await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_skill_created', source: null, details: JSON.stringify({ id: skillId, name, trigger_event, activate }) });
      return JSON.stringify({ ok: true, id: skillId });
    }

    case 'delete_skill': {
      const id = String(input.id ?? '').trim();
      if (!id) return JSON.stringify({ error: 'id is required' });
      await deps.store.deleteSkill(id);
      await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_skill_deleted', source: null, details: JSON.stringify({ id }) });
      return JSON.stringify({ ok: true });
    }

    case 'run_code': {
      const code = String(input.code ?? '').trim();
      if (!code) return JSON.stringify({ error: 'code is required' });
      const dataDir = process.env.PDH_DATA_DIR ?? join(process.cwd(), 'pdh-data');
      const result = await runCode(code, dataDir);
      await deps.store.insertAuditEntry({
        timestamp: new Date().toISOString(),
        event: 'code_executed',
        source: null,
        details: JSON.stringify({
          description: String(input.description ?? ''),
          code: code.slice(0, 500),
          duration_ms: result.duration,
          error: result.error ?? null,
        }),
      });
      return JSON.stringify({
        output: result.output || '(no output)',
        ...(result.error ? { error: result.error } : {}),
        duration_ms: result.duration,
        ...(result.truncated ? { note: 'Output truncated at 10 KB' } : {}),
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

async function runAgentLoop(
  deps: ServerDeps,
  messages: ChatMessage[],
  sms: SmsMessage[] | null,
): Promise<{ reply: string; toolsUsed: string[]; stagedActionIds: string[]; toolOutputs: ToolOutput[] }> {
  const client = getClient(deps);
  const model = getModel(deps);
  const tools = await buildTools(deps);
  const memories = await deps.store.listMemories();
  const system = buildSystemPrompt(deps, sms, memories);

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  const toolsUsed: string[] = [];
  const stagedActionIds: string[] = [];
  const toolOutputs: ToolOutput[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.chat.completions.create({
      model,
      messages: chatMessages,
      ...(tools.length > 0 ? { tools } : {}),
      max_tokens: 4096,
    });

    const choice = response.choices[0];
    if (!choice) break;

    if (choice.finish_reason === 'stop') {
      return { reply: choice.message.content ?? '', toolsUsed, stagedActionIds, toolOutputs };
    }

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      chatMessages.push(choice.message);
      const results: OpenAI.ChatCompletionToolMessageParam[] = [];
      for (const tc of choice.message.tool_calls) {
        if (tc.type !== 'function') continue;
        toolsUsed.push(tc.function.name);
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments); } catch (_) { /* ignore */ }
        const result = await executeTool(deps, tc.function.name, input, stagedActionIds);
        toolOutputs.push({ name: tc.function.name, input, output: result });
        results.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
      chatMessages.push(...results);
      continue;
    }

    // length, content_filter, or other — return whatever text we have
    return { reply: choice.message.content ?? 'Response was cut short.', toolsUsed, stagedActionIds, toolOutputs };
  }

  return {
    reply: 'Reached the maximum number of tool calls. Please try a simpler request.',
    toolsUsed,
    stagedActionIds,
    toolOutputs,
  };
}

async function buildAutoReplyTools(deps: ServerDeps): Promise<OpenAI.ChatCompletionTool[]> {
  const tools: OpenAI.ChatCompletionTool[] = [];

  if (await deps.tokenManager.hasToken('gmail')) {
    tools.push({
      type: 'function',
      function: {
        name: 'read_emails',
        description: 'Read emails from Gmail.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Gmail search query (e.g. "is:unread from:alice")' },
            limit: { type: 'number', description: 'Max results (default 20)' },
          },
        },
      },
    });
  }

  if (await deps.tokenManager.hasToken('google_calendar')) {
    tools.push({
      type: 'function',
      function: {
        name: 'read_calendar_events',
        description: 'Read events from Google Calendar.',
        parameters: {
          type: 'object',
          properties: {
            after: { type: 'string', description: 'ISO timestamp — only events after this time' },
            limit: { type: 'number', description: 'Max results (default 20)' },
          },
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'create_calendar_event',
        description: 'Create a Google Calendar event immediately — no approval required.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Event title' },
            start: { type: 'string', description: 'ISO start time' },
            end: { type: 'string', description: 'ISO end time' },
            body: { type: 'string', description: 'Event description (optional)' },
            location: { type: 'string', description: 'Event location (optional)' },
          },
          required: ['title', 'start', 'end'],
        },
      },
    });
  }

  tools.push({
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'Save a fact about the user or contact to persistent memory.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact to remember (concise, one sentence)' },
        },
        required: ['content'],
      },
    },
  });
  tools.push({
    type: 'function',
    function: {
      name: 'update_memory',
      description: 'Update an existing memory by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID from the system prompt' },
          content: { type: 'string', description: 'Updated fact' },
        },
        required: ['id', 'content'],
      },
    },
  });
  tools.push({
    type: 'function',
    function: {
      name: 'delete_memory',
      description: 'Delete a memory by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID from the system prompt' },
        },
        required: ['id'],
      },
    },
  });

  return tools;
}

async function executeAutoReplyTool(
  deps: ServerDeps,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case 'read_emails': {
      const connector = deps.connectorRegistry.get('gmail');
      if (!connector) return JSON.stringify({ error: 'Gmail not connected' });
      const boundary = deps.config.sources['gmail']?.boundary ?? {};
      const params: Record<string, unknown> = {};
      if (input.query) params.query = input.query;
      if (input.limit) params.limit = input.limit;
      const rows = await connector.fetch(boundary, Object.keys(params).length ? params : undefined);
      const filters = (await deps.store.getEnabledFiltersBySource('gmail')) as import('../filters.js').QuickFilter[];
      return JSON.stringify(applyFilters(rows, filters).slice(0, Number(input.limit ?? 20)).map(r => {
        const d = r.data as Record<string, unknown>;
        const rawBody = typeof d.body === 'string' ? d.body : '';
        const clean = rawBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
        return { id: r.source_item_id, subject: d.title, from: d.author_email || d.author_name, snippet: d.snippet || clean, date: r.timestamp };
      }));
    }

    case 'read_calendar_events': {
      const connector = deps.connectorRegistry.get('google_calendar');
      if (!connector) return JSON.stringify({ error: 'Google Calendar not connected' });
      const boundary = deps.config.sources['google_calendar']?.boundary ?? {};
      const params: Record<string, unknown> = {};
      if (input.after) params.after = input.after;
      if (input.limit) params.limit = input.limit;
      const rows = await connector.fetch(boundary, Object.keys(params).length ? params : undefined);
      const filters = (await deps.store.getEnabledFiltersBySource('google_calendar')) as import('../filters.js').QuickFilter[];
      return JSON.stringify(applyFilters(rows, filters).slice(0, Number(input.limit ?? 20)).map(r => {
        const d = r.data as Record<string, unknown>;
        return { id: r.source_item_id, title: d.title, start: d.start, end: d.end, location: d.location, date: r.timestamp };
      }));
    }

    case 'create_calendar_event': {
      const connector = deps.connectorRegistry.get('google_calendar');
      if (!connector) return JSON.stringify({ error: 'Google Calendar not connected' });
      const result = await connector.executeAction('create_event', input);
      if (result.success) {
        await deps.store.insertAuditEntry({
          timestamp: new Date().toISOString(),
          event: 'calendar_event_created',
          source: 'google_calendar',
          details: JSON.stringify({ title: input.title, start: input.start, end: input.end, createdBy: 'auto_reply' }),
        });
      }
      return JSON.stringify(result);
    }

    case 'save_memory': {
      const content = String(input.content ?? '').trim();
      if (!content) return JSON.stringify({ error: 'content is required' });
      const existing = await deps.store.listMemories();
      if (existing.length >= MEMORY_LIMIT) {
        return JSON.stringify({ error: `Memory is full (${MEMORY_LIMIT} items). Use update_memory or delete_memory first.` });
      }
      const memId = `mem_${randomUUID().slice(0, 8)}`;
      await deps.store.insertMemory(memId, content);
      return JSON.stringify({ ok: true, id: memId });
    }

    case 'update_memory': {
      const id = String(input.id ?? '').trim();
      const content = String(input.content ?? '').trim();
      if (!id || !content) return JSON.stringify({ error: 'id and content are required' });
      await deps.store.updateMemory(id, content);
      return JSON.stringify({ ok: true });
    }

    case 'delete_memory': {
      const id = String(input.id ?? '').trim();
      if (!id) return JSON.stringify({ error: 'id is required' });
      await deps.store.deleteMemory(id);
      return JSON.stringify({ ok: true });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

async function runAutoReplyLoop(
  deps: ServerDeps,
  from: string,
  smsBody: string,
  history: SmsHistoryEntry[],
  maxRounds: number,
): Promise<string> {
  const client = getClient(deps);
  const model = getModel(deps);
  const tools = await buildAutoReplyTools(deps);
  const memories = await deps.store.listMemories();
  const skills = await deps.store.listSkills();
  const today = new Date().toISOString().split('T')[0];

  const systemLines = [
    `You are an AI SMS auto-reply assistant on the user's Android phone. Today is ${today}.`,
    '',
    'Reply with just the message text — no quotes, no labels, no preamble.',
    '',
    '--- Tools available ---',
    '- read_calendar_events: check upcoming events and availability',
    '- read_emails: scan recent email threads for context',
    '- create_calendar_event: create a new event (requires explicit time from sender)',
    '- read_sms_thread: review conversation history with this contact',
    '- save_memory / update_memory / delete_memory: persist facts about contacts',
  ];

  // Inject the active skill for this trigger — one enabled skill per trigger_event
  const activeSkill = skills.find(s => s.trigger_event === 'sms_received' && s.enabled);
  if (activeSkill) {
    systemLines.push('', '--- Behavior instructions ---', activeSkill.instructions);
  }

  if (memories.length > 0) {
    systemLines.push('', 'What you remember about the user:');
    memories.forEach(m => systemLines.push(`  [id:${m.id}] ${m.content}`));
  }

  if (history.length > 0) {
    systemLines.push('', `Recent SMS conversation with ${from}:`);
    history.forEach(h => {
      const d = new Date(h.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const role = h.type === 1 ? from : 'Me';
      systemLines.push(`  [${d}] ${role}: ${h.body.slice(0, 200)}`);
    });
  }

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemLines.join('\n') },
    { role: 'user', content: `Incoming SMS from ${from}: "${smsBody}"` },
  ];

  for (let round = 0; round < maxRounds; round++) {
    const response = await client.chat.completions.create({
      model,
      messages: chatMessages,
      ...(tools.length > 0 ? { tools } : {}),
      max_tokens: 512,
    });

    const choice = response.choices[0];
    if (!choice) break;

    if (choice.finish_reason === 'stop') {
      return choice.message.content?.trim() ?? '';
    }

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      chatMessages.push(choice.message);
      const results: OpenAI.ChatCompletionToolMessageParam[] = [];
      for (const tc of choice.message.tool_calls) {
        if (tc.type !== 'function') continue;
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments); } catch (_) { /* ignore */ }
        const result = await executeAutoReplyTool(deps, tc.function.name, input);
        results.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
      chatMessages.push(...results);
      continue;
    }

    return choice.message.content?.trim() ?? '';
  }

  return '';
}

export function createChatRoutes(deps: ServerDeps): Hono {
  const app = new Hono();

  // Session auth — same pattern as gui/routes.ts
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/auth/status') {
      await next();
      return;
    }
    const cookie = parseCookie(c.req.header('Cookie') ?? '', 'pdh_session');
    if (!cookie) return c.json({ ok: false, error: 'Unauthorized' }, 401);
    const session = await deps.store.getValidSession(cookie);
    if (!session) return c.json({ ok: false, error: 'Unauthorized' }, 401);
    await next();
  });

  app.get('/api/chat/status', (c) => {
    return c.json({
      ok: true,
      configured: !!deps.config.ai?.api_key,
      provider: deps.config.ai?.provider ?? null,
      model: deps.config.ai?.model ?? null,
    });
  });

  app.post('/api/settings/ai-key', async (c) => {
    const body = await c.req.json();
    const { api_key, model, provider, base_url } = body;
    if (!api_key || typeof api_key !== 'string' || !api_key.trim()) {
      return c.json({ ok: false, error: 'api_key is required' }, 400);
    }
    const prov = (provider && typeof provider === 'string' && provider.trim()) ? provider.trim() : 'anthropic';
    const key = api_key.trim();

    if (!deps.config.ai) {
      (deps.config as Record<string, unknown>).ai = { provider: prov, api_key: key };
    } else {
      deps.config.ai.provider = prov;
      deps.config.ai.api_key = key;
    }
    if (model && typeof model === 'string' && model.trim()) deps.config.ai!.model = model.trim();
    if (base_url && typeof base_url === 'string' && base_url.trim()) (deps.config.ai as Record<string, unknown>).base_url = base_url.trim();

    // Persist to config file — PDH_CONFIG_PATH is set by android.ts at startup
    const configPath = process.env.PDH_CONFIG_PATH;
    if (configPath) {
      try {
        const parsed = parseYaml(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
        parsed.ai = {
          provider: prov,
          api_key: key,
          ...(model && typeof model === 'string' && model.trim() ? { model: model.trim() } : {}),
          ...(base_url && typeof base_url === 'string' && base_url.trim() ? { base_url: base_url.trim() } : {}),
        };
        writeFileSync(configPath, stringifyYaml(parsed), 'utf-8');
      } catch (e) {
        console.warn('[chat] Config persist failed (in-memory update succeeded):', e);
      }
    }

    return c.json({ ok: true });
  });

  app.get('/api/memories', async (c) => {
    const memories = await deps.store.listMemories();
    return c.json({ ok: true, memories });
  });

  app.post('/api/memories', async (c) => {
    const body = await c.req.json();
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return c.json({ ok: false, error: 'content is required' }, 400);
    const existing = await deps.store.listMemories();
    if (existing.length >= MEMORY_LIMIT) {
      return c.json({ ok: false, error: `Memory is full (${MEMORY_LIMIT} items). Delete some memories first.` }, 400);
    }
    const id = `mem_${randomUUID().slice(0, 8)}`;
    await deps.store.insertMemory(id, content);
    await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_memory_saved', source: null, details: JSON.stringify({ id, content, savedBy: 'user' }) });
    return c.json({ ok: true, id });
  });

  app.patch('/api/memories/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return c.json({ ok: false, error: 'content is required' }, 400);
    await deps.store.updateMemory(id, content);
    await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_memory_updated', source: null, details: JSON.stringify({ id, content, updatedBy: 'user' }) });
    return c.json({ ok: true });
  });

  app.delete('/api/memories/:id', async (c) => {
    const id = c.req.param('id');
    await deps.store.deleteMemory(id);
    await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_memory_deleted', source: null, details: JSON.stringify({ id, deletedBy: 'user' }) });
    return c.json({ ok: true });
  });

  app.post('/api/chat', async (c) => {
    if (!deps.config.ai?.api_key) {
      return c.json({ ok: false, error: 'AI not configured. Add an API key in Settings.' }, 400);
    }
    const body = await c.req.json();
    const { messages, sms } = body;
    if (!Array.isArray(messages)) {
      return c.json({ ok: false, error: 'messages array required' }, 400);
    }
    try {
      const result = await runAgentLoop(deps, messages as ChatMessage[], sms ?? null);
      return c.json({ ok: true, reply: result.reply, toolsUsed: result.toolsUsed, stagedActionIds: result.stagedActionIds, toolOutputs: result.toolOutputs });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[chat] error:', message);
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // Direct code execution — user-triggered (e.g. "Run" button on a code block in the chat UI).
  // This is NOT the agent's path; the agent uses run_code as a tool via executeTool().
  app.post('/api/code/run', async (c) => {
    const body = await c.req.json();
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!code) return c.json({ ok: false, error: 'code is required' }, 400);
    const dataDir = process.env.PDH_DATA_DIR ?? join(process.cwd(), 'pdh-data');
    try {
      const result = await runCode(code, dataDir);
      await deps.store.insertAuditEntry({
        timestamp: new Date().toISOString(),
        event: 'code_executed',
        source: null,
        details: JSON.stringify({ description: 'user-run', code: code.slice(0, 500), duration_ms: result.duration, error: result.error ?? null }),
      });
      return c.json({ ok: true, output: result.output, error: result.error, duration_ms: result.duration, truncated: result.truncated });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // Auto-reply toggle — session-protected
  app.get('/api/settings/auto-reply', async (c) => {
    return c.json({
      ok: true,
      enabled: deps.config.autoReply?.enabled ?? false,
      maxToolRounds: deps.config.autoReply?.maxToolRounds ?? 3,
    });
  });

  app.post('/api/settings/auto-reply', async (c) => {
    const body = await c.req.json();
    const enabled = Boolean(body.enabled);
    const maxToolRounds = typeof body.maxToolRounds === 'number'
      ? Math.max(1, Math.min(10, Math.round(body.maxToolRounds)))
      : (deps.config.autoReply?.maxToolRounds ?? 3);
    if (!deps.config.autoReply) {
      (deps.config as Record<string, unknown>).autoReply = { enabled, maxToolRounds };
    } else {
      deps.config.autoReply.enabled = enabled;
      (deps.config.autoReply as Record<string, unknown>).maxToolRounds = maxToolRounds;
    }
    const configPath = process.env.PDH_CONFIG_PATH;
    if (configPath) {
      try {
        const parsed = parseYaml(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
        parsed.autoReply = { enabled, maxToolRounds };
        writeFileSync(configPath, stringifyYaml(parsed), 'utf-8');
      } catch (e) {
        console.warn('[chat] autoReply persist failed (in-memory update succeeded):', e);
      }
    }
    return c.json({ ok: true, enabled, maxToolRounds });
  });

  // Auto-reply execute — called by Android SmsReceiver.
  // Uses /sms/ prefix (not /api/) to bypass session middleware; safe because server only binds to 127.0.0.1.
  app.post('/sms/auto-reply', async (c) => {
    if (!deps.config.autoReply?.enabled) {
      return c.json({ ok: true, enabled: false });
    }
    if (!deps.config.ai?.api_key) {
      return c.json({ ok: false, error: 'AI not configured' });
    }

    const body = await c.req.json();
    const fromRaw: string = body.from ?? '';
    const contactName: string = body.contactName;
    const fromLabel = contactName ? `${contactName} (${fromRaw})` : fromRaw;
    const smsBody: string = body.body ?? '';
    const history: SmsHistoryEntry[] = Array.isArray(body.history) ? body.history : [];
    if (!fromRaw || !smsBody) {
      return c.json({ ok: false, error: 'from and body required' }, 400);
    }

    // Log every incoming request so the Audit Log shows what address was received
    await deps.store.insertAuditEntry({
      timestamp: new Date().toISOString(),
      event: 'sms_received',
      source: 'sms',
      details: JSON.stringify({ from: fromRaw, contactName, body: smsBody.slice(0, 100) }),
    });

    // Skip purely numeric short codes (< 5 digits, no letters)
    const hasAlpha = /[a-zA-Z]/.test(fromRaw);
    const digits = fromRaw.replace(/\D/g, '');
    if (!hasAlpha && digits.length < 5) {
      return c.json({ ok: true, enabled: true, skipped: true, reason: 'short_code' });
    }

    try {
      const maxRounds = deps.config.autoReply?.maxToolRounds ?? 3;
      const reply = await runAutoReplyLoop(deps, fromLabel, smsBody, history, maxRounds);
      if (!reply) {
        return c.json({ ok: false, error: 'No reply generated' });
      }

      await deps.store.insertAuditEntry({
        timestamp: new Date().toISOString(),
        event: 'sms_auto_reply',
        source: 'sms',
        details: JSON.stringify({ from: fromRaw, incomingBody: smsBody, reply }),
      });

      // For the drain path (?drain=true): android.ts replays queued SMS when Node.js
      // restarts after the app was killed. Store in pendingAutoReplies so the WebView
      // can pick it up and send via AndroidSms (Node.js has no direct SmsManager access).
      // For the live path (SmsReceiver calling directly): return the reply in the response
      // so SmsReceiver can send it immediately via SmsManager without needing the WebView.
      if (c.req.query('drain') === 'true') {
        const replyId = crypto.randomUUID();
        pendingAutoReplies.set(replyId, { to: fromRaw, body: reply, createdAt: Date.now() });
        return c.json({ ok: true, pending: true });
      }

      return c.json({ ok: true, enabled: true, reply });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[auto-reply] error:', message);
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // Manual one-tap reply from the SMS tab (session-protected, bypasses auto-reply toggle)
  app.post('/api/sms/manual-reply', async (c) => {
    if (!deps.config.ai?.api_key) {
      return c.json({ ok: false, error: 'AI not configured — add an API key in Settings.' }, 400);
    }
    const body = await c.req.json();
    const from: string = body.from ?? '';
    const smsBody: string = body.body ?? '';
    if (!from || !smsBody) {
      return c.json({ ok: false, error: 'from and body required' }, 400);
    }
    try {
      const client = getClient(deps);
      const model = getModel(deps);
      const memories = await deps.store.listMemories();
      const today = new Date().toISOString().split('T')[0];
      const systemLines = [
        `You are an AI SMS reply assistant on the user's Android phone. Today is ${today}.`,
        'Write a concise, natural reply to the incoming SMS. Match the tone of the conversation.',
        'Keep it short: 1-3 sentences. Reply with just the message text — no quotes, no labels.',
      ];
      if (memories.length > 0) {
        systemLines.push('', 'Context about the user:');
        memories.forEach(m => systemLines.push(`  ${m.content}`));
      }
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemLines.join('\n') },
          { role: 'user', content: `Incoming SMS from ${from}: "${smsBody}"` },
        ],
        max_tokens: 200,
      });
      const reply = response.choices[0]?.message?.content?.trim() ?? '';
      if (!reply) return c.json({ ok: false, error: 'No reply generated' });
      await deps.store.insertAuditEntry({
        timestamp: new Date().toISOString(),
        event: 'sms_manual_reply',
        source: 'sms',
        details: JSON.stringify({ from, incomingBody: smsBody, reply }),
      });
      return c.json({ ok: true, reply });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // WebView polls this to pick up drain-path pending replies and send them via AndroidSms.
  // Only populated when ?drain=true is used (by android.ts drainSmsQueue).
  app.get('/api/sms/pending-replies', async (c) => {
    const cutoff = Date.now() - 60_000;
    const replies: Array<{ id: string; to: string; body: string }> = [];
    for (const [id, r] of pendingAutoReplies) {
      if (r.createdAt < cutoff) {
        pendingAutoReplies.delete(id);
      } else {
        replies.push({ id, to: r.to, body: r.body });
      }
    }
    return c.json({ ok: true, replies });
  });

  app.delete('/api/sms/pending-replies/:id', async (c) => {
    pendingAutoReplies.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  return app;
}
