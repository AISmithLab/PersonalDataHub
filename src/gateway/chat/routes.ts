import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ServerDeps } from '../server.js';
import { applyFilters, type QuickFilter } from '../filters.js';
import type { MemoryRow, SkillRow } from '../../database/datastore.js';
import { parseTriggerEvents, serializeTriggerEvents } from '../../database/datastore.js';
import { runCode } from '../code-runner/runner.js';
import { setContacts, labelWithContact } from './contacts-cache.js';
import { complete, createLlmClient, describeError, readableErrors, type LlmClient, type LlmMessage, type LlmParams, type LlmResponse, type LlmTool } from './llm.js';
import { OUTGOING_SOURCES, ACTION_TYPES } from '../pipes-outgoing.js';
import { makeAsk, savePipe, deletePipe, describePipe, PIPE_SOURCES, type AskFn, type PipeDeps } from '../pipes.js';

type SmsMessage = { address: string; body: string; date: number };
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type SmsHistoryEntry = { address: string; body: string; date: number; type: number };
type ToolOutput = { name: string; input: Record<string, unknown>; output: string };

const MEMORY_LIMIT = 50;

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-4o',
  groq: 'llama-3.3-70b-versatile',
  // An alias Google keeps pointed at its current Flash model; fixed model names get retired.
  google: 'gemini-flash-latest',
  ollama: 'llama3',
};

// Where each provider lists its models, for the Settings dropdown.
const MODEL_LIST_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  ollama: 'http://localhost:11434/v1',
};

const MAX_TOOL_ROUNDS = 5;


// Pending auto-replies for the drain path: when Node.js starts after the app was killed,
// it replays queued SMS via ?drain=true, stores them here, and the WebView picks them up.
const pendingAutoReplies = new Map<string, { to: string; body: string; createdAt: number }>();

export function getClient(deps: ServerDeps): LlmClient {
  return createLlmClient(deps.config.ai!);
}

/**
 * Models to move to, in order, when the one asked for is overloaded or has been
 * retired. A provider can be out of capacity on one model for hours while its
 * others answer normally, and a fixed default would leave the hub unusable.
 */
const MODEL_FALLBACKS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-5-5', 'claude-sonnet-4-6'],
  // Newest Flash first, stepping down to older ones, so the best available model is used.
  google: ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-flash-lite-latest'],
};

/** Per provider, the model that last answered. Used when the owner has not chosen a model. */
const workingModel = new Map<string, string>();

/** Forget which models answered. For tests. */
export function forgetWorkingModels(): void {
  workingModel.clear();
}

export function getModel(deps: ServerDeps): string {
  const ai = deps.config.ai!;
  const provider = ai.provider ?? 'anthropic';
  return ai.model ?? workingModel.get(provider) ?? DEFAULT_MODELS[provider] ?? 'claude-sonnet-4-6';
}

function fallbackProvider(model: string): string | null {
  for (const [provider, models] of Object.entries(MODEL_FALLBACKS)) if (models.includes(model)) return provider;
  // A model picked from the provider's own list can still be closed to this account
  // ("no longer available to new users"); it gets the same fallbacks.
  if (/^gemini-/.test(model)) return 'google';
  if (/^claude-/.test(model)) return 'anthropic';
  return null;
}

/** Models that are not for chat: speech, images, embeddings and the like. */
const NOT_CHAT = /(embed|tts|audio|image|imagen|veo|whisper|transcribe|realtime|live|robotics|computer-use|moderation|guard|dall-e|sora|nano-banana|omni|aqa|learnlm)/i;

/**
 * The chat models a provider offers to this key, for the model dropdown in
 * Settings. Asked from the provider itself, because a list kept in the hub goes
 * stale: providers retire models every few months. The hub's recommended models
 * come first.
 */
export async function listProviderModels(provider: string, apiKey: string, baseUrl?: string): Promise<string[]> {
  const base = (baseUrl ?? MODEL_LIST_BASE_URLS[provider] ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const headers: Record<string, string> = provider === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${apiKey}` };
  const res = await readableErrors(`${base}/models${provider === 'anthropic' ? '?limit=100' : ''}`, { headers, signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => null) as { data?: Array<{ id?: unknown }>; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(body?.error?.message || `The provider answered ${res.status}.`);
  const ids = (body?.data ?? [])
    .map((m) => String(m.id ?? '').replace(/^models\//, ''))
    .filter((id) => id && !NOT_CHAT.test(id))
    .filter((id) => provider !== 'google' || id.startsWith('gemini-'))
    .filter((id) => provider !== 'openai' || /^(gpt-|o\d|chatgpt-)/.test(id));
  const recommended = (MODEL_FALLBACKS[provider] ?? [DEFAULT_MODELS[provider]].filter(Boolean)).filter((m) => ids.includes(m));
  const rest = [...new Set(ids)].filter((id) => !recommended.includes(id)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return [...recommended, ...rest].slice(0, 60);
}

// The `ask(question, text)` helper that pipe programs call: one yes/no question to the
// configured model. One instance per server, so its answer cache is shared by every run.
const pipeAsks = new WeakMap<ServerDeps, AskFn>();

export function pipeAsk(deps: ServerDeps): AskFn {
  let ask = pipeAsks.get(deps);
  if (!ask) {
    ask = makeAsk(async (system, user) => {
      if (!deps.config.ai?.api_key) throw new Error('ask() needs an AI key. Add one in Settings → AI Settings.');
      const response = await callChatCompletionWithRetry(getClient(deps), {
        model: getModel(deps),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        // Room for a model that thinks before it answers; the answer itself is a few words.
        max_tokens: 2048,
      });
      return response.choices[0]?.message.content ?? '';
    });
    pipeAsks.set(deps, ask);
  }
  return ask;
}

function pipeDeps(deps: ServerDeps): PipeDeps {
  return { ...deps, ask: pipeAsk(deps) };
}

/** What a pipe program is, for the model that writes them. */
const PIPE_CONTRACT = [
  'A pipe is a small filter program over ONE source that agents can call as their own endpoint. Use list_pipes() to see them, save_pipe() to create or change one, delete_pipe(id) to remove one.',
  `Sources: ${PIPE_SOURCES.join(', ')}. Optional "query" is the source's own search string and sets which items the pipe looks at (Gmail example: "newer_than:60d"); leave it empty for the newest items. A pipe looks at 20 items by default, 50 at most.`,
  'Put what the source can search for into "query", not only into the program: a time range ("the past month" is newer_than:30d in Gmail) and plain keywords ("recommendation"). The program only ever sees the newest items that match the query, so a narrow query is what lets the pipe reach everything the owner means. Keep the same condition in the program too when it must hold exactly (a source search can be fuzzy).',
  'Write "description" as one or two plain sentences that say exactly what is released to agents (which items, from when). The owner reads it to check the pipe does what they asked, and revises it by talking to you.',
  'The program is the BODY of an async JavaScript function. Two names are in scope: `rows` and `ask`. It must `return` an array.',
  '- `rows`: array of { source, source_item_id, type, timestamp, data }. For gmail, data has title (the subject), body, snippet, author_name, author_email, participants, labels, attachments. Quick filters set by the owner are already applied.',
  '- `ask(question, text)`: asks the AI model a yes/no question about the text and resolves to true or false. Use it for judgments a keyword test cannot make ("does this email ask me to write a recommendation letter?"). Call it for all rows at once with Promise.all; it limits its own concurrency and caches answers.',
  '- Nothing else exists: no require, fetch, process, Buffer or timers. Do not use console for output.',
  '- Return the rows to keep. You may also return trimmed copies (for example without the body) when the agent does not need every field.',
  'Example program:',
  '  const keep = await Promise.all(rows.map((r) => ask("Does this email ask the recipient to write a recommendation letter?", r.data.title + "\\n" + (r.data.snippet || r.data.body || ""))));',
  '  return rows.filter((_, i) => keep[i]);',
  '',
  'OUTGOING pipes are the other direction: an agent sends an action, the program decides, and what passes is carried out at once with the owner\'s account (no approval step). Create one with save_pipe and direction "outgoing".',
  `- Sources: ${OUTGOING_SOURCES.join(', ')}. Action types: ${OUTGOING_SOURCES.map((src) => `${src}: ${ACTION_TYPES[src].join(', ')}`).join('; ')}.`,
  '- The program is the BODY of an async function with `action` in scope: { type, data } exactly as the agent sent it. Gmail data has to (a string, possibly several addresses separated by commas), subject, body, and for reply_email in_reply_to. Calendar data has title, body, location, start, end, timeZone, attendees ([{ email }], which sends invitations), and eventId for update/delete.',
  '- It must `return pass()` or `return block(reason)`. The reason is shown to the agent. Anything else, a throw, or a timeout blocks the action. There is no ask(): the decision must be a fixed rule. Nothing else exists: no require, fetch, process or timers.',
  '- Compare addresses case-insensitively and split `to` on commas and semicolons.',
  '- Pass `examples`: actions that should pass and actions that should block, taken from the owner\'s words, as [{ type, data, expect: "pass" | "block" }]. save_pipe runs the program on them (and on the last real agent actions) without carrying anything out, and saves unless the program fails on one.',
  '- Saving always switches an outgoing pipe off. Only the owner switches it on, in the Pipes panel, after checking the test results. Say so after saving.',
  '- Write "description" as exactly what agents may do through it (which actions, to whom).',
  'Example outgoing program:',
  '  const students = ["alice@ucsd.edu", "bob@ucsd.edu"];',
  '  if (action.type !== "send_email" && action.type !== "draft_email") return block("Only emails and drafts.");',
  '  const to = String(action.data.to).toLowerCase().split(/[,;]/).map((r) => r.trim());',
  '  const outside = to.filter((r) => !students.includes(r));',
  '  if (outside.length) return block("Not a lab student: " + outside.join(", "));',
  '  return pass();',
  '',
  'save_pipe test-runs the program on up to 10 items first and saves it only if the run succeeds. If it answers ok:false, nothing was saved (an existing pipe is unchanged): fix the program and call save_pipe again. On success read the `test` field. To change an existing pipe pass its id; only the fields you pass are changed, and its source cannot be changed. Tell the user what the pipe keeps and how many of the tested items matched. Agents need the owner to tick the pipe for them in Settings → Agents before they can call it.',
].join('\n');

/** Which page the chat is embedded in, and what the user has selected there. */
export type ChatPage = { page?: 'skills' | 'pipes'; focusId?: string; newKind?: 'incoming' | 'outgoing' };

async function pageContext(deps: ServerDeps, where: ChatPage): Promise<string[]> {
  if (where.page === 'pipes') {
    const lines = ['', 'After every save the page runs the pipe on the latest data and shows the user the items it looked at, each marked released or held back, beside what agents receive. So after save_pipe, answer in two or three sentences: what the pipe now releases, and how the test run went (how many of the items looked at were released). Do not list the items. If the result looks wrong for what was asked (nothing released, or everything), say so and suggest what to change.', 'The user is on the Pipes page: this conversation is for creating and refining pipes. Their pipes are shown beside this chat and refresh when you save one, so do not paste a whole program back unless asked.'];
    const pipe = where.focusId ? await deps.store.getPipe(where.focusId) : null;
    if (pipe) {
      lines.push('The pipe the user has selected is below. A request like "also drop newsletters" or "make it stricter" means: change THIS pipe (save_pipe with this id), not create a new one.', JSON.stringify(describePipe(pipe, '')));
    } else {
      lines.push(where.newKind === 'outgoing'
        ? 'No pipe is selected and the user chose "New pipe: outgoing". Create an OUTGOING pipe (save_pipe with direction "outgoing"): a gate on what agents may do with the owner\'s account.'
        : where.newKind === 'incoming'
          ? 'No pipe is selected and the user chose "New pipe: incoming". Create an INCOMING pipe: a filter on what agents may read.'
          : 'No pipe is selected. A request that describes a new filter means: create an incoming pipe; a request about what agents may send or do means: create an outgoing pipe.');
    }
    return lines;
  }
  if (where.page === 'skills') {
    const lines = ['', 'The user is on the Skills page: this conversation is for creating and refining skills. Their skills are shown beside this chat and refresh when you save one.'];
    const skill = where.focusId ? (await deps.store.listSkills()).find((s) => s.id === where.focusId) : null;
    if (skill) {
      lines.push('The skill the user has selected is below. A request to adjust behavior means: change THIS skill (save_skill with this id), not create a new one.', JSON.stringify({ id: skill.id, name: skill.name, instructions: skill.instructions, trigger_events: parseTriggerEvents(skill.trigger_event), primitive_type: skill.primitive_type, enabled: !!skill.enabled }));
    } else {
      lines.push('No skill is selected. A request that describes new behavior means: create a skill.');
    }
    return lines;
  }
  return [];
}

async function buildTools(deps: ServerDeps): Promise<LlmTool[]> {
  const tools: LlmTool[] = [];

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

  if (deps.connectorRegistry.has('photo')) {
    tools.push({
      type: 'function',
      function: {
        name: 'read_photos',
        description: 'Read photos and images from the device gallery. Automatically strips EXIF GPS and identifiable metadata by default.',
        parameters: {
          type: 'object',
          properties: {
            after: { type: 'string', description: 'Only photos after date (YYYY-MM-DD)' },
            album: { type: 'string', description: 'Filter by album or folder name' },
            limit: { type: 'number', description: 'Max results (default 20)' },
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
      description: 'Create or update an agent skill primitive. Primitives can be labels (to classify context) or actions (to execute logic based on context). Multiple primitives can be enabled at once.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill ID to update (omit to create new)' },
          name: { type: 'string', description: 'Short name for this skill' },
          summary: { type: 'string', description: 'A single sentence summarizing the rule' },
          instructions: { type: 'string', description: 'Full behavioral instructions. For labels: state the condition to match. For actions: state what to do if conditions are met.' },
          trigger_events: { type: 'array', items: { type: 'string' }, description: 'One or more contexts when this skill fires: sms_received, photo_added, email_received, calendar_event_starting, manual_shortcut. A skill only gets pulled into a task when that task\'s context matches one of these tags.' },
          allowed_sources: { type: 'string', description: 'JSON array string of allowed sources for this skill (e.g., \'["photo", "emails"]\')' },
          primitive_type: { type: 'string', enum: ['label', 'action'], description: 'Type of primitive' },
          label_tag: { type: 'string', description: 'If primitive_type is label, the tag string to append when matched (e.g., "Spam")' },
          enabled: { type: 'boolean', description: 'If true, enable this skill (default false)' },
        },
        required: ['name', 'summary', 'instructions', 'trigger_events', 'primitive_type'],
      },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'list_pipes',
      description: 'List all pipes: id, name, description, source, query, program, enabled.',
      parameters: { type: 'object', properties: {} },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'save_pipe',
      description: 'Create a pipe, or change one when id is given. Test-runs the program on up to 10 items and saves it only if the run succeeds; returns the result in `test` (itemsFetched, itemsReturned, sample).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id of the pipe to change. Omit to create a new pipe.' },
          name: { type: 'string', description: 'Short name, e.g. "Recommendation letter requests"' },
          description: { type: 'string', description: 'One sentence saying what the pipe returns. Agents read this to decide whether to call it.' },
          source: { type: 'string', enum: [...PIPE_SOURCES], description: 'The one source the pipe reads' },
          query: { type: 'string', description: 'Optional search string for the source that sets which items are looked at. Empty for the newest items.' },
          program: { type: 'string', description: 'Incoming: body of an async function with `rows` and `ask` in scope; returns an array. Outgoing: body of an async function with `action` in scope; returns pass() or block(reason).' },
          enabled: { type: 'boolean', description: 'Incoming only: whether agents can call it (default true). Outgoing pipes are always saved off; only the owner switches them on.' },
          direction: { type: 'string', enum: ['incoming', 'outgoing'], description: 'incoming (default): what agents may read. outgoing: what agents may do. Cannot change after creation.' },
          examples: {
            type: 'array',
            description: 'Outgoing only: example actions to test the program on, some that should pass and some that should block.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                data: { type: 'object' },
                expect: { type: 'string', enum: ['pass', 'block'] },
              },
              required: ['type', 'data'],
            },
          },
        },
      },
    },
  });

  tools.push({
    type: 'function',
    function: {
      name: 'delete_pipe',
      description: 'Delete a pipe by id.',
      parameters: { type: 'object', properties: { id: { type: 'string', description: 'Pipe id' } }, required: ['id'] },
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
      description: `Execute JavaScript on this device's Node.js runtime. Use for computations, file I/O, network requests, or data processing — including writing your own logic to filter, analyze, or clean up data (e.g. finding and removing duplicate photos) instead of relying on a canned tool.
Globals available: fetch, require (fs, path, crypto, etc.), Buffer, URL, URLSearchParams, setTimeout, AbortController, __dataDir (app data directory path).
${deps.connectorRegistry.has('photo') ? "If photos are connected: __photos.list(params?) returns the full photo dataset as an array of { id, title, album, date, dataUrl, ... } (params: after, album — same as read_photos). __photos.stageDelete(id, reason?) stages a photo for deletion — like all writes, it requires the owner's approval before anything is actually deleted; it never deletes directly. Use these to write your own duplicate-detection logic (e.g. hash dataUrl, group photos with matching hashes or matching title+album+dimensions, and stageDelete every photo in a group after the first)." : ''}
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
    'By default, proactively access and edit data sources (calendar, email, sms, etc.) in response to a trigger or implicit request. For example, if someone asks to meet, absolutely propose adding that to the calendar. Do not be passive; use your tools to take concrete action.',
    '',
    `Connected sources: ${Object.keys(deps.config.sources).join(', ') || 'none'}`,
    // A model does not know its own name unless told; without this it guesses or declines.
    `You are running as the model "${getModel(deps)}" from the provider "${deps.config.ai?.provider ?? 'anthropic'}", as chosen in Settings → AI Settings. If asked which model you are, say that.`,
  ];

  if (memories.length > 0) {
    lines.push('', 'What you remember about the user:');
    memories.forEach(m => lines.push(`  [id:${m.id}] ${m.content}`));
  }

  lines.push('', 'Memory: Use save_memory() to record important facts the user shares (preferences, ongoing projects, personal context). Use update_memory(id) when a fact changes. Use delete_memory(id) for stale facts. Be proactive but concise — one clear sentence per memory. If a memory is about someone in an SMS conversation, refer to them by their contact name (shown in the conversation header) rather than their phone number.');
  lines.push('', 'Skills: Skills are primitive rules (labels and actions). Use list_skills() to view them. Use save_skill(name, instructions, trigger_events, enabled) to create/update a primitive. A skill can be tagged with multiple trigger_events (e.g. both sms_received and photo_added) and is only pulled into a task when that task\'s context matches one of its tags. Labels classify incoming events and append tags to the context ground truth. Actions define how to respond based on the context. Ensure one primitive per rule. Do not disable other skills for the same trigger unless explicitly replacing them, as multiple primitives compose together. Currently supported triggers: sms_received, photo_added, email_received, calendar_event_starting, manual_shortcut. Specify allowed_sources to scope permissions.');
  lines.push('', 'Pipes: ' + PIPE_CONTRACT);
  lines.push('', 'Code execution: Use run_code() to run JavaScript on this device. Supports top-level await, fetch, require (fs, path, etc.), Buffer, and __dataDir (path to app data). Use console.log() to emit output — return values are ignored. Each call is a fresh context; write files at __dataDir to persist data between calls. When asked to find photos matching some criteria, or to clean up duplicates/clutter, prefer writing this logic yourself in run_code over guessing from read_photos summaries alone — see the run_code tool description for the __photos bindings.');

  if (sms && sms.length > 0) {
    lines.push('', 'Recent SMS messages (newest first):');
    sms.slice(0, 50).forEach(msg => {
      const d = new Date(msg.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      lines.push(`  [${d}] ${labelWithContact(msg.address)}: ${msg.body.slice(0, 200)}`);
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
  try {
    return await executeToolInner(deps, name, input, stagedActionIds);
  } catch (err) {
    // Tool calls hit live external APIs (Gmail, Calendar, GitHub) that can fail for
    // reasons outside our control (expired OAuth token, rate limits, network errors).
    // Without this, a single failing tool call throws out of the whole agent loop and
    // kills the entire chat response instead of letting the model see the failure and
    // respond gracefully (e.g. "I couldn't reach Gmail, try reconnecting it").
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[executeTool] ${name} failed:`, message);
    return JSON.stringify({ error: `${name} failed: ${message}` });
  }
}

/**
 * Narrow, source-scoped capabilities exposed inside the run_code sandbox — lets the agent
 * write its own JS (e.g. hash-based duplicate detection) against real data instead of us
 * pre-building a "find duplicates" tool. Deletion is staged for owner approval, never
 * executed directly from the sandbox, consistent with every other write path.
 */
export function buildRunCodeBindings(deps: ServerDeps, stagedActionIds: string[]): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};

  if (deps.connectorRegistry.has('photo')) {
    const connector = deps.connectorRegistry.get('photo')!;
    bindings.__photos = {
      // Mirrors the read_photos tool: applies stored quick filters + EXIF stripping.
      list: async (params?: Record<string, unknown>) => {
        const rows = await connector.fetch({}, params);
        const filters = (await deps.store.getEnabledFiltersBySource('photo')) as QuickFilter[];
        return applyFilters(rows, filters).map((r) => {
          const d = r.data as Record<string, unknown>;
          return { id: r.source_item_id, title: d.title, album: d.album, date: r.timestamp, ...d };
        });
      },
      // Stages a delete for owner approval — never deletes directly.
      stageDelete: async (photoId: string, reason?: string) => {
        const actionId = `act_${randomUUID().slice(0, 12)}`;
        await deps.store.insertStagingAction({
          actionId,
          manifestId: '',
          source: 'photo',
          actionType: 'delete_photo',
          actionData: JSON.stringify({ photoId, reason: reason ?? '' }),
          purpose: `AI: delete photo ${photoId}${reason ? ` (${reason})` : ''}`,
        });
        stagedActionIds.push(actionId);
        return { ok: true, actionId, status: 'pending_review' };
      },
    };
  }

  return bindings;
}

async function executeToolInner(
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

    case 'read_photos': {
      const connector = deps.connectorRegistry.get('photo');
      if (!connector) return JSON.stringify({ error: 'Photo connector not connected' });
      const params: Record<string, unknown> = {};
      if (input.after) params.after = input.after;
      if (input.album) params.album = input.album;
      if (input.limit) params.limit = input.limit;
      const rows = await connector.fetch({}, Object.keys(params).length ? params : undefined);
      const filters = (await deps.store.getEnabledFiltersBySource('photo')) as QuickFilter[];
      return JSON.stringify(applyFilters(rows, filters).slice(0, Number(input.limit ?? 20)).map(r => {
        const d = r.data as Record<string, unknown>;
        return { id: r.source_item_id, title: d.title, album: d.album, date: r.timestamp, ...d };
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
      const summary = String(input.summary ?? '').trim();
      const instructions = String(input.instructions ?? '').trim();
      const triggerEventsInput = Array.isArray(input.trigger_events)
        ? (input.trigger_events as unknown[]).map(t => String(t))
        : (input.trigger_event ? [String(input.trigger_event)] : ['sms_received']);
      const trigger_event = serializeTriggerEvents(triggerEventsInput);
      const allowed_sources = input.allowed_sources ? String(input.allowed_sources).trim() : null;
      const primitive_type = String(input.primitive_type ?? 'action').trim();
      const label_tag = input.label_tag ? String(input.label_tag).trim() : null;
      const enabled = Boolean(input.enabled);
      if (!name || !instructions) return JSON.stringify({ error: 'name and instructions are required' });
      const existingId = String(input.id ?? '').trim();
      if (existingId) {
        await deps.store.updateSkill(existingId, { name, summary, instructions, trigger_event, primitive_type, label_tag, allowed_sources });
        if (input.enabled !== undefined) await deps.store.setSkillEnabled(existingId, enabled ? 1 : 0);
        await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_skill_updated', source: null, details: JSON.stringify({ id: existingId, name, primitive_type }) });
        return JSON.stringify({ ok: true, id: existingId });
      }
      const skillId = `skill_${randomUUID().slice(0, 12)}`;
      await deps.store.insertSkill({ id: skillId, name, summary, instructions, trigger_event, primitive_type, label_tag, allowed_sources, enabled: enabled ? 1 : 0 });
      await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_skill_created', source: null, details: JSON.stringify({ id: skillId, name, primitive_type }) });
      return JSON.stringify({ ok: true, id: skillId });
    }

    case 'delete_skill': {
      const id = String(input.id ?? '').trim();
      if (!id) return JSON.stringify({ error: 'id is required' });
      await deps.store.deleteSkill(id);
      await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_skill_deleted', source: null, details: JSON.stringify({ id }) });
      return JSON.stringify({ ok: true });
    }

    case 'list_pipes': {
      const pipes = (await deps.store.listPipes()).map((p) => describePipe(p, ''));
      return JSON.stringify({ ok: true, pipes });
    }

    case 'save_pipe': {
      return JSON.stringify(await savePipe(pipeDeps(deps), input));
    }

    case 'delete_pipe': {
      const id = String(input.id ?? '').trim();
      const pipe = id ? await deps.store.getPipe(id) : null;
      if (!pipe) return JSON.stringify({ ok: false, error: `No pipe with id "${id}"` });
      await deletePipe(deps, pipe, 'chat');
      return JSON.stringify({ ok: true });
    }

    case 'run_code': {
      const code = String(input.code ?? '').trim();
      if (!code) return JSON.stringify({ error: 'code is required' });
      const dataDir = process.env.PDH_DATA_DIR ?? join(process.cwd(), 'pdh-data');
      const bindings = buildRunCodeBindings(deps, stagedActionIds);
      const result = await runCode(code, dataDir, bindings);
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

export async function callChatCompletionWithRetry(
  client: LlmClient,
  params: LlmParams,
  maxAttempts = 3,
): Promise<LlmResponse> {
  const tried = new Set<string>([params.model]);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await complete(client, params);
      const provider = fallbackProvider(params.model);
      if (provider) workingModel.set(provider, params.model);
      return response;
    } catch (err: any) {
      const { status, message: msg, timedOut } = describeError(err);
      // Overloaded (503) or retired (404) model: another model of the same provider will do.
      const unavailable = status === 503 || timedOut || (status === 404 && /model/i.test(msg));
      const provider = unavailable ? fallbackProvider(params.model) : null;
      const next = provider ? MODEL_FALLBACKS[provider].find((m) => !tried.has(m)) : undefined;
      if (next) {
        console.warn(`[chat] ${params.model} is unavailable (${timedOut ? 'no answer in time' : status}); using ${next} instead.`);
        tried.add(next);
        params = { ...params, model: next };
        attempt--; // switching models is not a retry
        continue;
      }
      // 429: over the rate limit. 503: the provider is overloaded. Both pass if we wait.
      const busy = status === 429 || status === 503 || msg.includes('429');
      if (busy && attempt < maxAttempts) {
        // Providers often say how long ("Please retry in 23.3s"); a short fixed wait would just fail again.
        const hinted = /retry in ([\d.]+)\s*s/i.exec(msg);
        const waitMs = hinted ? Math.min(Math.ceil(Number(hinted[1]) * 1000) + 500, 45_000) : attempt * 2000;
        console.warn(`[chat] provider busy (${status}). Retrying in ${waitMs}ms (${attempt}/${maxAttempts})...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      if (status === 429 || msg.includes('429')) {
        throw new Error(`AI provider rate limit reached. ${providerSaid(msg)}`);
      }
      const tail = tried.size > 1 ? ` (tried ${[...tried].join(', ')})` : status === 503 || status === 404 ? ' Set another model in Settings → AI Settings.' : '';
      throw new Error((providerSaid(msg) || 'The AI provider returned an error.') + tail);
    }
  }
  throw new Error('Chat completion failed');
}

// The provider's own sentence, without the SDK's status prefix and without the long tail of links.
function providerSaid(message: string): string {
  return message.replace(/^\d{3}\s+/, '').split('\n')[0].trim().slice(0, 400);
}

async function runAgentLoop(
  deps: ServerDeps,
  messages: ChatMessage[],
  sms: SmsMessage[] | null,
  where: ChatPage = {},
): Promise<{ reply: string; toolsUsed: string[]; stagedActionIds: string[]; toolOutputs: ToolOutput[] }> {
  const client = getClient(deps);
  const model = getModel(deps);
  const tools = await buildTools(deps);
  const memories = await deps.store.listMemories();
  const system = [buildSystemPrompt(deps, sms, memories), ...(await pageContext(deps, where))].join('\n');

  const chatMessages: LlmMessage[] = [
    { role: 'system', content: system },
    ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  const toolsUsed: string[] = [];
  const stagedActionIds: string[] = [];
  const toolOutputs: ToolOutput[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callChatCompletionWithRetry(client, {
      model,
      messages: chatMessages,
      ...(tools.length > 0 ? { tools } : {}),
      max_tokens: 4096,
    });

    const choice = response.choices[0];
    if (!choice) break;

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      chatMessages.push(choice.message);
      const results: LlmMessage[] = [];
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

    if (choice.message.content) {
      return { reply: choice.message.content, toolsUsed, stagedActionIds, toolOutputs };
    }

    if (choice.finish_reason === 'stop' || choice.finish_reason == null) {
      return { reply: choice.message.content ?? '', toolsUsed, stagedActionIds, toolOutputs };
    }

    return { reply: choice.message.content ?? 'Response was cut short.', toolsUsed, stagedActionIds, toolOutputs };
  }

  return {
    reply: 'Reached the maximum number of tool calls. Please try a simpler request.',
    toolsUsed,
    stagedActionIds,
    toolOutputs,
  };
}

async function buildAutoReplyTools(deps: ServerDeps): Promise<LlmTool[]> {
  const tools: LlmTool[] = [];

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
  try {
    return await executeAutoReplyToolInner(deps, name, input);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[executeAutoReplyTool] ${name} failed:`, message);
    return JSON.stringify({ error: `${name} failed: ${message}` });
  }
}

async function executeAutoReplyToolInner(
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

async function evaluateLabels(
  client: LlmClient,
  model: string,
  from: string,
  smsBody: string,
  labelSkills: any[]
): Promise<string[]> {
  if (labelSkills.length === 0) return [];
  const prompt = [
    `You are a text classifier. Evaluate this incoming SMS against the following rules.`,
    `Message from ${from}: "${smsBody}"`,
    `\nRules:`,
    ...labelSkills.map(s => `- [${s.label_tag}] ${s.instructions}`),
    `\nRespond with a JSON object containing a "tags" array of the label tags that apply (e.g. {"tags": ["Tag1", "Tag2"]}).`
  ].join('\n');

  try {
    const response = await callChatCompletionWithRetry(client, {
      model,
      // A user message: providers other than OpenAI refuse a request that has only a system prompt.
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
    });
    const content = response.choices[0]?.message.content?.trim();
    if (!content) return [];
    
    let tags: string[] = [];
    try {
      // The model may wrap the object in a code fence or a sentence; take the object itself.
      const parsed = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
      if (parsed.tags && Array.isArray(parsed.tags)) tags = parsed.tags;
    } catch (e) {
      tags = labelSkills.map(s => s.label_tag).filter(tag => tag && content.includes(tag));
    }
    return tags.filter(Boolean) as string[];
  } catch (err) {
    console.error('[evaluateLabels] error:', err);
    return [];
  }
}

export function filterToolsForSkillScopes(tools: any[], activeSkills: { allowed_sources?: string | null }[]): any[] {
  const scopedSkills = activeSkills.filter(s => s.allowed_sources && s.allowed_sources.trim() !== '' && s.allowed_sources !== 'null');
  if (scopedSkills.length === 0) return tools;

  const allowedSet = new Set<string>();
  for (const skill of scopedSkills) {
    try {
      const parsed = JSON.parse(skill.allowed_sources!);
      if (Array.isArray(parsed)) {
        parsed.forEach((s: string) => allowedSet.add(s.toLowerCase()));
      }
    } catch (_) { /* ignore invalid JSON */ }
  }

  if (allowedSet.has('emails')) allowedSet.add('gmail');
  if (allowedSet.has('gmail')) allowedSet.add('emails');
  if (allowedSet.has('calendar')) allowedSet.add('google_calendar');
  if (allowedSet.has('google_calendar')) allowedSet.add('calendar');
  if (allowedSet.has('photos')) allowedSet.add('photo');
  if (allowedSet.has('photo')) allowedSet.add('photos');

  return tools.filter(tool => {
    const name = (tool.function?.name || '').toLowerCase();
    if (name.includes('memory') || name.includes('skill')) return true;
    if (name.includes('calendar') && !allowedSet.has('calendar')) return false;
    if (name.includes('email') && !allowedSet.has('emails')) return false;
    if (name.includes('sms') && !allowedSet.has('sms')) return false;
    if (name.includes('photo') && !allowedSet.has('photo')) return false;
    return true;
  });
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
  const allTools = await buildAutoReplyTools(deps);
  const memories = await deps.store.listMemories();
  const skills = await deps.store.listSkills();
  const today = new Date().toISOString().split('T')[0];

  const activeLabelSkills = skills.filter(s => parseTriggerEvents(s.trigger_event).includes('sms_received') && s.enabled && s.primitive_type === 'label');
  const activeActionSkills = skills.filter(s => parseTriggerEvents(s.trigger_event).includes('sms_received') && s.enabled && s.primitive_type !== 'label');
  const tools = filterToolsForSkillScopes(allTools, [...activeLabelSkills, ...activeActionSkills]);

  const systemLines = [
    `You are an AI SMS auto-reply assistant on the user's Android phone. Today is ${today}.`,
    '',
    'Reply with just the message text — no quotes, no labels, no preamble.',
    'By default, proactively access and edit data sources (calendar, email, sms, etc.) in response to triggers in the SMS. For example, if the sender asks to meet, absolutely use create_calendar_event to add that to the calendar. Do not be passive; take concrete action.',
    '',
    '--- Tools available ---',
    '- read_calendar_events: check upcoming events and availability',
    '- read_emails: scan recent email threads for context',
    '- create_calendar_event: create a new event (requires explicit time from sender)',
    '- read_sms_thread: review conversation history with this contact',
    '- save_memory / update_memory / delete_memory: persist facts about contacts (use the contact\'s name, not their phone number, when one is known)',
  ];

  const appliedLabels = await evaluateLabels(client, model, from, smsBody, activeLabelSkills);

  if (activeActionSkills.length > 0) {
    systemLines.push('', '--- Behavior Actions ---');
    systemLines.push('Dynamically select which action rules to run based on the context ground truth (including labels). Only execute actions whose conditions are met.');
    activeActionSkills.forEach(s => systemLines.push(`- ${s.name}: ${s.instructions}`));
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

  const labelTagsStr = appliedLabels.length > 0 ? ` [Labels: ${appliedLabels.join(', ')}]` : '';
  const chatMessages: LlmMessage[] = [
    { role: 'system', content: systemLines.join('\n') },
    { role: 'user', content: `Incoming SMS from ${from}: "${smsBody}"${labelTagsStr}` },
  ];

  for (let round = 0; round < maxRounds; round++) {
    const response = await callChatCompletionWithRetry(client, {
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
      const results: LlmMessage[] = [];
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

const CHAT_SCOPES = ['chat', 'skills', 'pipes'];
const HISTORY_MAX_MESSAGES = 200;
const HISTORY_MAX_BYTES = 1_000_000;

type StoredMessage = { role: 'user' | 'assistant'; content: string; toolOutputs?: ToolOutput[] };

/**
 * A conversation as the page sends it, reduced to what is kept: the newest messages,
 * within a size limit (tool outputs can hold whole emails). Null when it is not a conversation.
 */
export function cleanHistory(input: unknown): StoredMessage[] | null {
  if (!Array.isArray(input)) return null;
  const out: StoredMessage[] = [];
  for (const m of input as Array<Record<string, unknown>>) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    const msg: StoredMessage = { role: m.role, content: m.content };
    if (Array.isArray(m.toolOutputs)) {
      msg.toolOutputs = (m.toolOutputs as Array<Record<string, unknown>>)
        .filter((t) => t && typeof t.name === 'string' && typeof t.output === 'string')
        .map((t) => ({ name: t.name as string, input: (t.input && typeof t.input === 'object' ? t.input : {}) as Record<string, unknown>, output: t.output as string }));
    }
    out.push(msg);
  }
  let kept = out.slice(-HISTORY_MAX_MESSAGES);
  // Too large: first drop the tool outputs of older messages, then the oldest messages.
  for (let i = 0; i < kept.length - 1 && Buffer.byteLength(JSON.stringify(kept)) > HISTORY_MAX_BYTES; i++) delete kept[i].toolOutputs;
  while (kept.length > 1 && Buffer.byteLength(JSON.stringify(kept)) > HISTORY_MAX_BYTES) kept = kept.slice(1);
  if (kept.length === 1 && Buffer.byteLength(JSON.stringify(kept)) > HISTORY_MAX_BYTES) { delete kept[0].toolOutputs; kept[0].content = kept[0].content.slice(0, 100_000); }
  return kept;
}

export function createChatRoutes(deps: ServerDeps): Hono {
  const app = new Hono();

  // Mounted under /web behind requireOwner (see server.ts).
  // The owner's conversations, kept so a page reload does not lose them. One per page.
  // The page sends the whole conversation after each exchange; the hub only stores it.
  app.get('/chat/history/:scope', async (c) => {
    const scope = c.req.param('scope');
    if (!CHAT_SCOPES.includes(scope)) return c.json({ ok: false, error: 'Unknown conversation.' }, 404);
    let messages: unknown = [];
    try { messages = JSON.parse((await deps.store.getChatHistory(scope)) ?? '[]'); } catch { /* unreadable: start empty */ }
    return c.json({ ok: true, messages: Array.isArray(messages) ? messages : [] });
  });

  app.put('/chat/history/:scope', async (c) => {
    const scope = c.req.param('scope');
    if (!CHAT_SCOPES.includes(scope)) return c.json({ ok: false, error: 'Unknown conversation.' }, 404);
    const body = await c.req.json().catch(() => null) as { messages?: unknown } | null;
    const messages = cleanHistory(body?.messages);
    if (!messages) return c.json({ ok: false, error: 'messages must be a list of { role, content }.' }, 400);
    await deps.store.setChatHistory(scope, JSON.stringify(messages));
    return c.json({ ok: true, kept: messages.length });
  });

  app.delete('/chat/history/:scope', async (c) => {
    const scope = c.req.param('scope');
    if (!CHAT_SCOPES.includes(scope)) return c.json({ ok: false, error: 'Unknown conversation.' }, 404);
    await deps.store.deleteChatHistory(scope);
    return c.json({ ok: true });
  });

  app.get('/chat/status', (c) => {
    return c.json({
      ok: true,
      configured: !!deps.config.ai?.api_key,
      provider: deps.config.ai?.provider ?? null,
      model: deps.config.ai?.model ?? null,
    });
  });

  // The models to offer in the Settings dropdown. Uses the key being typed, or the
  // saved key when the provider is the saved one.
  app.post('/settings/ai-models', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { provider?: unknown; api_key?: unknown };
    const saved = deps.config.ai;
    const provider = typeof body.provider === 'string' && body.provider ? body.provider : saved?.provider ?? '';
    if (!(provider in DEFAULT_MODELS)) return c.json({ ok: false, error: 'Unknown provider' }, 400);
    const typed = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    const key = typed || (saved?.provider === provider ? saved.api_key : '');
    if (!key && provider !== 'ollama') return c.json({ ok: true, models: [], needsKey: true });
    try {
      return c.json({ ok: true, models: await listProviderModels(provider, key || 'ollama') });
    } catch (err) {
      return c.json({ ok: false, error: providerSaid(err instanceof Error ? err.message : String(err)) || 'Could not list models.' });
    }
  });

  app.post('/settings/ai-key', async (c) => {
    const body = await c.req.json();
    const { api_key, model, provider } = body;
    // No base URL in the form any more: each provider's address is known. An address set by
    // hand in the config file is kept as long as the provider stays the same.
    const base_url = body.base_url ?? (deps.config.ai?.provider === provider ? (deps.config.ai as Record<string, unknown> | undefined)?.base_url : undefined);
    const prov = (provider && typeof provider === 'string' && provider.trim()) ? provider.trim() : 'anthropic';
    // Changing only the model does not need the key typed again: the saved key is kept
    // when the provider is the saved one.
    const typedKey = typeof api_key === 'string' ? api_key.trim() : '';
    const key = typedKey || (deps.config.ai?.provider === prov ? deps.config.ai.api_key : '');
    if (!key) {
      return c.json({ ok: false, error: 'api_key is required' }, 400);
    }

    // Replace the whole setting. Keeping an earlier provider's model or base URL when
    // only the provider and key change would send, say, a Claude model name to Google.
    (deps.config as Record<string, unknown>).ai = {
      provider: prov,
      api_key: key,
      ...(model && typeof model === 'string' && model.trim() ? { model: model.trim() } : {}),
      ...(base_url && typeof base_url === 'string' && base_url.trim() ? { base_url: base_url.trim() } : {}),
    };

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

  app.get('/memories', async (c) => {
    const memories = await deps.store.listMemories();
    return c.json({ ok: true, memories });
  });

  app.post('/memories', async (c) => {
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

  app.patch('/memories/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return c.json({ ok: false, error: 'content is required' }, 400);
    await deps.store.updateMemory(id, content);
    await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_memory_updated', source: null, details: JSON.stringify({ id, content, updatedBy: 'user' }) });
    return c.json({ ok: true });
  });

  app.delete('/memories/:id', async (c) => {
    const id = c.req.param('id');
    await deps.store.deleteMemory(id);
    await deps.store.insertAuditEntry({ timestamp: new Date().toISOString(), event: 'ai_memory_deleted', source: null, details: JSON.stringify({ id, deletedBy: 'user' }) });
    return c.json({ ok: true });
  });

  app.post('/chat', async (c) => {
    if (!deps.config.ai?.api_key) {
      return c.json({ ok: false, error: 'AI not configured. Add an API key in Settings.' }, 400);
    }
    const body = await c.req.json();
    const { messages, sms } = body;
    if (!Array.isArray(messages)) {
      return c.json({ ok: false, error: 'messages array required' }, 400);
    }
    // The Skills and Pipes pages embed this chat and say what is selected beside it.
    const where: ChatPage = {
      page: body.page === 'skills' || body.page === 'pipes' ? body.page : undefined,
      focusId: typeof body.focusId === 'string' ? body.focusId : undefined,
      newKind: body.newKind === 'incoming' || body.newKind === 'outgoing' ? body.newKind : undefined,
    };
    try {
      const result = await runAgentLoop(deps, messages as ChatMessage[], sms ?? null, where);
      return c.json({ ok: true, reply: result.reply, toolsUsed: result.toolsUsed, stagedActionIds: result.stagedActionIds, toolOutputs: result.toolOutputs });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[chat] error:', message);
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // Direct code execution — user-triggered (e.g. "Run" button on a code block in the chat UI).
  // This is NOT the agent's path; the agent uses run_code as a tool via executeTool().
  app.post('/code/run', async (c) => {
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
  app.get('/settings/auto-reply', async (c) => {
    return c.json({
      ok: true,
      enabled: deps.config.autoReply?.enabled ?? false,
      maxToolRounds: deps.config.autoReply?.maxToolRounds ?? 3,
    });
  });

  app.post('/settings/auto-reply', async (c) => {
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

  // Onboarding completion flag — gates the first-run walkthrough in the frontend
  app.get('/settings/onboarding', async (c) => {
    return c.json({ ok: true, completed: deps.config.onboardingCompleted ?? false });
  });

  app.post('/settings/onboarding', async (c) => {
    const body = await c.req.json();
    const completed = Boolean(body.completed);
    (deps.config as Record<string, unknown>).onboardingCompleted = completed;
    const configPath = process.env.PDH_CONFIG_PATH;
    if (configPath) {
      try {
        const parsed = parseYaml(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
        parsed.onboardingCompleted = completed;
        writeFileSync(configPath, stringifyYaml(parsed), 'utf-8');
      } catch (e) {
        console.warn('[chat] onboarding persist failed (in-memory update succeeded):', e);
      }
    }
    return c.json({ ok: true, completed });
  });

  // Contact list sync — called by the RN app (App.tsx) whenever it (re)reads the device
  // contact list, so backend prompt-building code can resolve phone numbers to names
  // synchronously, in-process, with no extra tool/API call per SMS reply or memory.
  app.post('/device/contacts', async (c) => {
    const body = await c.req.json();
    const contacts = Array.isArray(body.contacts) ? body.contacts : [];
    setContacts(contacts);
    return c.json({ ok: true, count: contacts.length });
  });

  // Auto-reply execute — called by Android SmsReceiver.
  // The receiver authenticates with the device secret (see auth/access.ts).
  app.post('/device/sms/auto-reply', async (c) => {
    if (!deps.config.autoReply?.enabled) {
      return c.json({ ok: true, enabled: false });
    }
    if (!deps.config.ai?.api_key) {
      return c.json({ ok: false, error: 'AI not configured' });
    }

    const body = await c.req.json();
    const fromRaw: string = body.from ?? '';
    const contactName: string = body.contactName;
    const fromLabel = labelWithContact(fromRaw, contactName);
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
  app.post('/device/sms/manual-reply', async (c) => {
    if (!deps.config.ai?.api_key) {
      return c.json({ ok: false, error: 'AI not configured — add an API key in Settings.' }, 400);
    }
    const body = await c.req.json();
    const fromRaw: string = body.from ?? '';
    const from = labelWithContact(fromRaw);
    const smsBody: string = body.body ?? '';
    if (!fromRaw || !smsBody) {
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
      const response = await callChatCompletionWithRetry(client, {
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
        details: JSON.stringify({ from: fromRaw, incomingBody: smsBody, reply }),
      });
      return c.json({ ok: true, reply });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ ok: false, error: message }, 500);
    }
  });

  // WebView polls this to pick up drain-path pending replies and send them via AndroidSms.
  // Only populated when ?drain=true is used (by android.ts drainSmsQueue).
  app.get('/device/sms/pending-replies', async (c) => {
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

  app.delete('/device/sms/pending-replies/:id', async (c) => {
    pendingAutoReplies.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  return app;
}
