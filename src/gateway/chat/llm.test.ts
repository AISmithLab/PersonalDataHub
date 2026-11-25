import { describe, it, expect, beforeEach } from 'vitest';
import { createLlmClient, type LlmMessage, type LlmTool } from './llm.js';
import { callChatCompletionWithRetry, forgetWorkingModels } from './routes.js';

// Each provider is spoken to in its own format. These tests stand in for the provider at
// the network level: they record the requests the hub sends and answer in that provider's
// real response shape, including a tool call and the model's thinking.

type Sent = { url: string; headers: Record<string, string>; body: any };

function standIn(answers: Array<{ status?: number; body: unknown }>) {
  const sent: Sent[] = [];
  const fetchImpl = (async (input: any, init: any) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    sent.push({ url: String(input), headers, body: JSON.parse(String(init?.body ?? '{}')) });
    const a = answers.shift();
    if (!a) throw new Error('stand-in: no answer left');
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { sent, fetchImpl };
}

const tools: LlmTool[] = [{ type: 'function', function: { name: 'list_pipes', description: 'List the pipes.', parameters: { type: 'object', properties: {} } } }];
const start = (): LlmMessage[] => [{ role: 'system', content: 'You are the hub.' }, { role: 'user', content: 'what pipes do I have?' }];

/** The chat loop in miniature: ask, run the tool the model called, ask again. */
async function toolRound(client: ReturnType<typeof createLlmClient>, model: string) {
  const messages = start();
  const first = await callChatCompletionWithRetry(client, { model, messages, tools, max_tokens: 200 });
  const choice = first.choices[0];
  expect(choice.finish_reason).toBe('tool_calls');
  expect(choice.message.tool_calls?.[0].function).toEqual({ name: 'list_pipes', arguments: '{}' });
  messages.push(choice.message, { role: 'tool', tool_call_id: choice.message.tool_calls![0].id, content: '[]' });
  const second = await callChatCompletionWithRetry(client, { model, messages, tools, max_tokens: 200 });
  expect(second.choices[0].finish_reason).toBe('stop');
  return second.choices[0].message.content;
}

beforeEach(() => forgetWorkingModels());

describe('OpenAI, through the Responses API', () => {
  const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };
  const base = { object: 'response', created_at: 0, model: 'gpt-6.1-sol', status: 'completed', usage };
  const toolCall = { ...base, id: 'resp_1', output: [
    { type: 'reasoning', id: 'rs_1', encrypted_content: 'ENCRYPTED-THINKING', summary: [] },
    { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'list_pipes', arguments: '{}', status: 'completed' },
  ] };
  const answer = { ...base, id: 'resp_2', output: [
    { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'You have none.', annotations: [] }] },
  ] };

  it('uses tools with a thinking model, and carries the thinking across the tool call', async () => {
    const { sent, fetchImpl } = standIn([{ body: toolCall }, { body: answer }]);
    const reply = await toolRound(createLlmClient({ provider: 'openai', api_key: 'o-key' }, fetchImpl), 'gpt-6.1-sol');
    expect(reply).toBe('You have none.');
    expect(sent[0].url).toBe('https://api.openai.com/v1/responses');
    expect(sent[0].headers.authorization).toBe('Bearer o-key');
    // The two things the old chat-completions path got wrong for this model:
    expect(sent[0].body.max_tokens).toBeUndefined();
    expect(sent[0].body.max_output_tokens).toBe(4096);
    expect(sent[0].body.tools[0]).toMatchObject({ type: 'function', name: 'list_pipes' });
    expect(sent[0].body.reasoning?.effort).not.toBe('none');
    // Personal data: the exchange is not kept by the provider.
    expect(sent[0].body.store).toBe(false);
    const second = JSON.stringify(sent[1].body.input);
    expect(second).toContain('ENCRYPTED-THINKING');
    expect(second).toContain('call_1');
  });

  it('passes on the provider\'s own words for an error', async () => {
    const { fetchImpl } = standIn([{ status: 401, body: { error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', param: null, code: 'invalid_api_key' } } }]);
    const client = createLlmClient({ provider: 'openai', api_key: 'bad' }, fetchImpl);
    await expect(callChatCompletionWithRetry(client, { model: 'gpt-6.1-sol', messages: start() })).rejects.toThrow('Incorrect API key provided.');
  });
});

describe('Google, through its own API', () => {
  const usageMetadata = { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 };
  const toolCall = { candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { name: 'list_pipes', args: {} }, thoughtSignature: 'THOUGHT-SIGNATURE' }] } }], usageMetadata };
  const answer = { candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'You have none.' }] } }], usageMetadata };

  it('uses tools, and sends the model\'s thought signature back with the tool result', async () => {
    const { sent, fetchImpl } = standIn([{ body: toolCall }, { body: answer }]);
    const reply = await toolRound(createLlmClient({ provider: 'google', api_key: 'g-key' }, fetchImpl), 'gemini-flash-latest');
    expect(reply).toBe('You have none.');
    expect(sent[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
    // The key travels in a header, never in the address.
    expect(sent[0].headers['x-goog-api-key']).toBe('g-key');
    expect(sent[0].body.generationConfig.maxOutputTokens).toBe(4096);
    expect(JSON.stringify(sent[0].body.systemInstruction)).toContain('You are the hub.');
    const second = JSON.stringify(sent[1].body.contents);
    expect(second).toContain('THOUGHT-SIGNATURE');
    expect(second).toContain('functionResponse');
  });

  it('moves to the next model when one is overloaded', async () => {
    const { sent, fetchImpl } = standIn([
      { status: 503, body: { error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } } },
      { body: answer },
    ]);
    const client = createLlmClient({ provider: 'google', api_key: 'g-key' }, fetchImpl);
    const res = await callChatCompletionWithRetry(client, { model: 'gemini-flash-latest', messages: start() });
    expect(res.choices[0].message.content).toBe('You have none.');
    expect(sent[1].url).toContain('/models/gemini-3.8-flash:generateContent');
  });

  it('says so when the account has no credit', async () => {
    const { fetchImpl } = standIn([{ status: 402, body: { error: { code: 402, message: 'Your prepayment credits are depleted.', status: 'FAILED_PRECONDITION' } } }]);
    const client = createLlmClient({ provider: 'google', api_key: 'g-key' }, fetchImpl);
    await expect(callChatCompletionWithRetry(client, { model: 'gemini-flash-latest', messages: start() })).rejects.toThrow('Your prepayment credits are depleted.');
  });
});

describe('Anthropic, through the Messages API', () => {
  const base = { type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  const toolCall = { ...base, id: 'msg_1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'list_pipes', input: {} }] };
  const answer = { ...base, id: 'msg_2', stop_reason: 'end_turn', content: [{ type: 'text', text: 'You have none.' }] };

  it('uses tools and returns the tool result in the provider\'s shape', async () => {
    const { sent, fetchImpl } = standIn([{ body: toolCall }, { body: answer }]);
    const reply = await toolRound(createLlmClient({ provider: 'anthropic', api_key: 'a-key' }, fetchImpl), 'claude-sonnet-5-5');
    expect(reply).toBe('You have none.');
    expect(sent[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0].headers['x-api-key']).toBe('a-key');
    expect(sent[0].body.max_tokens).toBe(4096);
    expect(JSON.stringify(sent[0].body.system)).toContain('You are the hub.');
    expect(JSON.stringify(sent[1].body.messages)).toContain('"tool_use_id":"toolu_1"');
  });
});

describe('a base_url in the config file', () => {
  it('still means an OpenAI-compatible endpoint, whatever the provider', async () => {
    const { sent, fetchImpl } = standIn([{ body: { id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }] } }]);
    const client = createLlmClient({ provider: 'google', api_key: 'k', base_url: 'http://127.0.0.1:9/v1/' }, fetchImpl);
    const res = await callChatCompletionWithRetry(client, { model: 'my-model', messages: start() });
    expect(res.choices[0].message.content).toBe('hello');
    expect(sent[0].url).toBe('http://127.0.0.1:9/v1/chat/completions');
  });
});
