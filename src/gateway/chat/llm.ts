/**
 * The one place the hub talks to an AI provider.
 *
 * Requests go through the Vercel AI SDK, whose provider packages speak each
 * provider's own API (OpenAI Responses, Google Generative AI, Anthropic Messages).
 * The differences between providers and between a provider's model generations
 * (what the length limit is called, whether tools and thinking can be combined,
 * how thinking is carried across a tool call) are handled there, and a change on
 * the provider's side is picked up by updating the packages.
 *
 * The rest of the hub uses the small chat shape below and does not know which
 * provider is behind it.
 */
import { generateText, jsonSchema, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export type LlmTool = {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown> };
};

export type LlmToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type LlmAssistantMessage = {
  role: 'assistant';
  content: string | null;
  tool_calls?: LlmToolCall[];
  /**
   * The provider's own record of this turn, as the SDK returned it. It is sent back
   * unchanged on the next request, because it carries what a plain copy would lose:
   * the model's thinking, which several providers require alongside a tool call.
   */
  sdk?: ModelMessage[];
};

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | LlmAssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };

export type LlmParams = { model: string; messages: LlmMessage[]; tools?: LlmTool[]; max_tokens?: number };

export type LlmResponse = {
  choices: Array<{ finish_reason: 'stop' | 'tool_calls' | 'length' | 'other'; message: LlmAssistantMessage }>;
};

export type LlmClient = {
  provider: string;
  languageModel(modelId: string): LanguageModel;
  timeoutMs: number;
};

export type AiSetting = { provider?: string; api_key?: string; base_url?: string };

/** Providers without a package of their own: they speak the OpenAI chat format at these addresses. */
const COMPATIBLE_BASE_URLS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  ollama: 'http://localhost:11434/v1',
};

/**
 * A limit also counts the tokens a model spends thinking before it answers, so a
 * small limit meant for a short answer can leave no room for the answer itself.
 */
const OUTPUT_TOKENS_FLOOR = 4096;

/**
 * Compatible endpoints do not all send errors in OpenAI's shape (some wrap the error
 * in an array, some send plain text). Re-shape such bodies so the provider's own
 * message (model retired, quota exceeded, key not valid) reaches the user.
 */
export const readableErrors: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.ok) return res;
  const text = await res.text();
  let message = '';
  try {
    const parsed = JSON.parse(text) as unknown;
    const first = (Array.isArray(parsed) ? parsed[0] : parsed) as { error?: { message?: unknown } | string; message?: unknown } | null;
    const err = first?.error;
    message = typeof err === 'string' ? err : String(err?.message ?? first?.message ?? '');
  } catch { /* not JSON */ }
  const body = JSON.stringify({ error: { message: message || text.slice(0, 500) || res.statusText, type: 'provider_error' } });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: { 'content-type': 'application/json', ...(res.headers.get('retry-after') ? { 'retry-after': res.headers.get('retry-after')! } : {}) } });
};

/**
 * `base_url` in the config file has always meant "an OpenAI-compatible endpoint", and
 * still does: when it is set, or for a provider without its own package, the request
 * goes there in the OpenAI chat format. `fetchImpl` is for tests.
 */
export function createLlmClient(ai: AiSetting, fetchImpl?: typeof fetch): LlmClient {
  const provider = ai.provider ?? 'anthropic';
  const apiKey = ai.api_key ?? '';
  // A model that accepts the request and then never answers must not hold a chat for
  // minutes; after this long the next model is tried.
  const timeoutMs = Number(process.env.PDH_AI_TIMEOUT_MS) || 60_000;
  const withFetch = fetchImpl ? { fetch: fetchImpl } : {};

  const compatibleBase = ai.base_url ?? COMPATIBLE_BASE_URLS[provider];
  if (compatibleBase || !['openai', 'google', 'anthropic'].includes(provider)) {
    const compatible = createOpenAICompatible({
      name: provider,
      baseURL: (compatibleBase ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
      apiKey,
      fetch: fetchImpl ?? readableErrors,
    });
    return { provider, timeoutMs, languageModel: (id) => compatible.chatModel(id) };
  }
  if (provider === 'openai') {
    const openai = createOpenAI({ apiKey, ...withFetch });
    return { provider, timeoutMs, languageModel: (id) => openai.responses(id) };
  }
  if (provider === 'google') {
    const google = createGoogleGenerativeAI({ apiKey, ...withFetch });
    return { provider, timeoutMs, languageModel: (id) => google(id) };
  }
  const anthropic = createAnthropic({ apiKey, ...withFetch });
  return { provider, timeoutMs, languageModel: (id) => anthropic(id) };
}

/** The hub's messages in the SDK's shape. */
function toModelMessages(messages: LlmMessage[]): { system: string | undefined; messages: ModelMessage[] } {
  const system: string[] = [];
  const out: ModelMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'system') {
      system.push(m.content);
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      for (const tc of m.tool_calls ?? []) toolNames.set(tc.id, tc.function.name);
      if (m.sdk?.length) {
        out.push(...m.sdk);
      } else if (m.tool_calls?.length) {
        out.push({
          role: 'assistant',
          content: [
            ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
            ...m.tool_calls.map((tc) => ({ type: 'tool-call' as const, toolCallId: tc.id, toolName: tc.function.name, input: parseJson(tc.function.arguments) })),
          ],
        });
      } else {
        out.push({ role: 'assistant', content: m.content ?? '' });
      }
    } else if (m.role === 'tool') {
      const part = {
        type: 'tool-result' as const,
        toolCallId: m.tool_call_id,
        toolName: toolNames.get(m.tool_call_id) ?? 'unknown',
        output: { type: 'text' as const, value: m.content },
      };
      // The results of one round of tool calls belong in one message.
      const last = out[out.length - 1];
      if (last?.role === 'tool') last.content.push(part);
      else out.push({ role: 'tool', content: [part] });
    }
  }
  return { system: system.length ? system.join('\n\n') : undefined, messages: out };
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return {}; }
}

function toToolSet(tools: LlmTool[] | undefined): ToolSet | undefined {
  if (!tools?.length) return undefined;
  const set: ToolSet = {};
  for (const t of tools) {
    // No `execute`: the hub runs tools itself, between requests.
    set[t.function.name] = tool({ description: t.function.description, inputSchema: jsonSchema(t.function.parameters) });
  }
  return set;
}

/** One request to the model: no retries, no fallback. Those are the caller's (see routes.ts). */
export async function complete(client: LlmClient, params: LlmParams): Promise<LlmResponse> {
  const { system, messages } = toModelMessages(params.messages);
  const tools = toToolSet(params.tools);
  const result = await generateText({
    model: client.languageModel(params.model),
    ...(system ? { system } : {}),
    messages,
    ...(tools ? { tools } : {}),
    ...(params.max_tokens != null ? { maxOutputTokens: Math.max(params.max_tokens, OUTPUT_TOKENS_FLOOR) } : {}),
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(client.timeoutMs),
    // Personal data passes through here: ask OpenAI not to keep the exchange.
    providerOptions: { openai: { store: false } },
  });
  const toolCalls: LlmToolCall[] = result.toolCalls.map((tc) => ({
    id: tc.toolCallId,
    type: 'function',
    function: { name: tc.toolName, arguments: JSON.stringify(tc.input ?? {}) },
  }));
  const finish = toolCalls.length ? 'tool_calls' : result.finishReason === 'stop' ? 'stop' : result.finishReason === 'length' ? 'length' : 'other';
  return {
    choices: [{
      finish_reason: finish,
      message: {
        role: 'assistant',
        content: result.text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        sdk: result.response.messages as ModelMessage[],
      },
    }],
  };
}

/** What went wrong, in the terms the retry logic needs. */
export function describeError(err: unknown): { status: number | undefined; message: string; timedOut: boolean } {
  const e = err as { statusCode?: number; status?: number; message?: string; name?: string; cause?: { name?: string } } | null;
  const status = e?.statusCode ?? e?.status;
  const message = String(e?.message || '');
  const names = [e?.name, e?.cause?.name];
  const timedOut = !status && (names.includes('TimeoutError') || names.includes('AbortError') || /timed out|timeout|aborted/i.test(message));
  return { status, message, timedOut };
}
