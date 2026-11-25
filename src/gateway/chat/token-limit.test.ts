import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { callChatCompletionWithRetry } from './routes.js';

// A stand-in for the provider: records what it was sent and answers as told.
function fakeClient(answer: (params: any) => any) {
  const sent: any[] = [];
  const client = {
    chat: { completions: { create: async (params: any) => { sent.push(params); return answer(params); } } },
  } as unknown as OpenAI;
  return { client, sent };
}
const ok = { choices: [{ message: { role: 'assistant', content: 'hi' } }] };
const messages = [{ role: 'user' as const, content: 'hello' }];

describe('reply-length limit name', () => {
  it('sends max_completion_tokens to OpenAI models, never max_tokens', async () => {
    const { client, sent } = fakeClient(() => ok);
    await callChatCompletionWithRetry(client, { model: 'gpt-6', messages, max_tokens: 4096 });
    expect(sent[0].max_tokens).toBeUndefined();
    expect(sent[0].max_completion_tokens).toBe(4096);
  });

  it('raises a small limit, since thinking counts against it', async () => {
    const { client, sent } = fakeClient(() => ok);
    await callChatCompletionWithRetry(client, { model: 'gpt-6-mini', messages, max_tokens: 200 });
    expect(sent[0].max_completion_tokens).toBe(4096);
  });

  it('keeps max_tokens for other providers', async () => {
    const { client, sent } = fakeClient(() => ok);
    await callChatCompletionWithRetry(client, { model: 'gemini-flash-latest', messages, max_tokens: 200 });
    expect(sent[0].max_tokens).toBe(200);
    expect(sent[0].max_completion_tokens).toBeUndefined();
  });

  it('learns from the refusal when a model it did not recognise wants the other name', async () => {
    const { client, sent } = fakeClient((p) => {
      if (p.max_tokens != null) {
        throw Object.assign(new Error("400 Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."), { status: 400 });
      }
      return ok;
    });
    await callChatCompletionWithRetry(client, { model: 'some-new-model', messages, max_tokens: 512 });
    expect(sent).toHaveLength(2);
    expect(sent[1].max_tokens).toBeUndefined();
    expect(sent[1].max_completion_tokens).toBe(4096);
    // Remembered: the next call gets it right the first time.
    await callChatCompletionWithRetry(client, { model: 'some-new-model', messages, max_tokens: 512 });
    expect(sent).toHaveLength(3);
  });
});
