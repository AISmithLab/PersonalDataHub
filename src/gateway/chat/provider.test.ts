import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { parse as parseYaml } from 'yaml';
import { getDb } from '../../database/db.js';
import { SqliteDataStore } from '../../database/sqlite-store.js';
import { createServer } from '../server.js';
import { forgetWorkingModels } from './routes.js';
import { TokenManager } from '../auth/token-manager.js';
import type { HubConfigParsed } from '../../config/schema.js';
import { makeTmpDir } from '../../test-utils.js';

// How the hub behaves toward an AI provider that is not OpenAI: errors in another shape,
// rate limits with a stated wait, and settings changed from one provider to another.
describe('AI provider handling', () => {
  let tmpDir: string;
  let db: Database.Database;
  let app: Hono;
  let config: HubConfigParsed;
  let provider: Server;
  let replies: Array<{ status: number; body: unknown }>;
  let seenModels: string[];
  let modelCalls: Array<{ auth: string; xkey: string }>;
  let modelList: { status: number; body: unknown };
  const owner = { Cookie: 'pdh_session=sess', 'Content-Type': 'application/json' };
  const ok = (content: string) => ({ status: 200, body: { id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] } });
  // Google's OpenAI-compatible endpoint wraps its error in an array.
  const googleError = (status: number, message: string) => ({ status, body: [{ error: { code: status, message, status: 'X' } }] });
  const chat = () => app.request('/web/chat', { method: 'POST', headers: owner, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    db = getDb(join(tmpDir, 'test.db'));
    const store = new SqliteDataStore(db);
    store.createUser('owner@test.com', 'hash');
    store.createSession('sess', '2099-01-01T00:00:00.000Z');
    replies = []; seenModels = []; modelCalls = [];
    modelList = { status: 200, body: { object: 'list', data: ['models/gemini-2.5-flash', 'models/gemini-3.6-flash', 'models/gemini-flash-latest', 'models/gemini-embedding-2', 'models/gemini-2.5-flash-preview-tts', 'models/gemma-4-31b-it', 'models/gemini-3.5-flash-image', 'models/gemini-10-flash', 'models/gemini-3-flash-preview'].map((id) => ({ id })) } };
    forgetWorkingModels();
    provider = createHttpServer((req, res) => {
      if (req.method === 'GET' && String(req.url).includes('/models')) {
        modelCalls.push({ auth: String(req.headers.authorization ?? ''), xkey: String(req.headers['x-api-key'] ?? '') });
        res.writeHead(modelList.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(modelList.body));
        return;
      }
      let raw = '';
      req.on('data', (d) => (raw += d)).on('end', () => {
        seenModels.push(JSON.parse(raw).model);
        const r = replies.shift() ?? ok('default');
        if (r.status === -1) return; // never answer: the hub's own timeout has to end this
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.body));
      });
    });
    await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
    config = {
      deployment: { gateway: 'local', database: 'sqlite' },
      sources: {},
      ai: { provider: 'google', api_key: 'k', base_url: `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1` },
      port: 3000,
    } as unknown as HubConfigParsed;
    app = createServer({ store, connectorRegistry: new Map(), config, tokenManager: new TokenManager(store, 's') });
  });

  afterEach(async () => {
    delete process.env.PDH_CONFIG_PATH;
    await new Promise((done) => provider.close(done));
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shows the provider\'s own words for an error it sends in Google\'s shape', async () => {
    replies.push(googleError(400, 'API key not valid. Please pass a valid API key.'));
    const j = await (await chat()).json() as { ok: boolean; error: string };
    expect(j.ok).toBe(false);
    expect(j.error).toContain('API key not valid. Please pass a valid API key.');
    expect(j.error).not.toContain('no body');
  });

  it('also reads OpenAI-shaped and plain-text errors', async () => {
    replies.push({ status: 401, body: { error: { message: 'Incorrect API key provided.' } } });
    expect((await (await chat()).json() as { error: string }).error).toContain('Incorrect API key provided.');
    replies.push({ status: 400, body: 'upstream said no' });
    expect((await (await chat()).json() as { error: string }).error).toContain('upstream said no');
  });

  it('waits as long as a rate-limit message asks, then succeeds', async () => {
    replies.push(googleError(429, 'You exceeded your current quota.\n* Quota exceeded for metric: free_tier_requests, limit: 5\nPlease retry in 0.2s.'), ok('after waiting'));
    const started = Date.now();
    const j = await (await chat()).json() as { ok: boolean; reply: string };
    expect(j).toMatchObject({ ok: true, reply: 'after waiting' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(600);
  });

  it('moves to the next model when the default is overloaded, and stays on the one that answers', async () => {
    replies.push(googleError(503, 'This model is currently experiencing high demand.'), ok('from the second model'));
    const started = Date.now();
    expect(await (await chat()).json()).toMatchObject({ ok: true, reply: 'from the second model' });
    expect(seenModels).toEqual(['gemini-flash-latest', 'gemini-3.8-flash']);
    expect(Date.now() - started).toBeLessThan(1500); // switching is immediate, not a timed retry
    // the next message goes straight to the model that worked
    await chat();
    expect(seenModels[2]).toBe('gemini-3.8-flash');
  });

  it('prefers the newest Flash and steps down through older ones', async () => {
    for (const _ of [1, 2, 3, 4, 5]) replies.push(googleError(503, 'This model is currently experiencing high demand.'));
    replies.push(ok('from the old preview'));
    expect(await (await chat()).json()).toMatchObject({ ok: true, reply: 'from the old preview' });
    expect(seenModels).toEqual(['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview']);
  });

  it('a model that never answers is given up on, and the next one is used', async () => {
    process.env.PDH_AI_TIMEOUT_MS = '300';
    try {
      replies.push({ status: -1, body: null }, ok('from the next model'));
      const started = Date.now();
      expect(await (await chat()).json()).toMatchObject({ ok: true, reply: 'from the next model' });
      expect(seenModels).toEqual(['gemini-flash-latest', 'gemini-3.8-flash']);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      delete process.env.PDH_AI_TIMEOUT_MS;
    }
  });

  it('also moves on when a model has been retired (404), and says what it tried when all fail', async () => {
    replies.push(googleError(404, 'This model models/x is no longer available.'), ok('ok'));
    expect(await (await chat()).json()).toMatchObject({ ok: true });
    for (let i = 0; i < 12; i++) replies.push(googleError(503, 'This model is currently experiencing high demand.'));
    const j = await (await chat()).json() as { ok: boolean; error: string };
    expect(j.ok).toBe(false);
    expect(j.error).toContain('high demand');
    expect(j.error).toContain('tried ');
    expect(j.error).toContain('gemini-flash-lite-latest');
  }, 20_000);

  it('a model the owner chose that is not on the list is retried, not replaced', async () => {
    (config.ai as Record<string, unknown>).model = 'my-own-model';
    replies.push(googleError(503, 'busy'), ok('same model again'));
    expect(await (await chat()).json()).toMatchObject({ ok: true, reply: 'same model again' });
    expect(seenModels).toEqual(['my-own-model', 'my-own-model']);
  }, 15_000);

  it('uses a current Google model by default, never the retired one', async () => {
    await chat();
    expect(seenModels[0]).toBe('gemini-flash-latest');
  });

  it('saving a new provider drops the previous provider\'s model and base URL', async () => {
    const save = (body: Record<string, unknown>) => app.request('/web/settings/ai-key', { method: 'POST', headers: owner, body: JSON.stringify(body) });
    await save({ provider: 'anthropic', api_key: 'a-key', model: 'claude-sonnet-4-6', base_url: 'https://example.test/v1' });
    await save({ provider: 'groq', api_key: 'g-key' });
    expect(config.ai).toEqual({ provider: 'groq', api_key: 'g-key' });
  });

  it('writes the setting to the config file the hub was started with, so it survives a restart', async () => {
    const path = join(tmpDir, 'hub-config.yaml');
    writeFileSync(path, 'sources: {}\nport: 3000\n');
    process.env.PDH_CONFIG_PATH = path;
    await app.request('/web/settings/ai-key', { method: 'POST', headers: owner, body: JSON.stringify({ provider: 'google', api_key: 'g-key', model: 'gemini-flash-latest' }) });
    expect((parseYaml(readFileSync(path, 'utf-8')) as { ai: unknown; port: number })).toMatchObject({ port: 3000, ai: { provider: 'google', api_key: 'g-key', model: 'gemini-flash-latest' } });
  });

  describe('the model dropdown', () => {
    // listProviderModels asks the provider's real address, so point Google's at the stand-in.
    const models = async (body: Record<string, unknown>) => {
      return app.request('/web/settings/ai-models', { method: 'POST', headers: owner, body: JSON.stringify(body) });
    };

    it('lists the provider\'s chat models: recommended first, newest next, nothing that is not for chat', async () => {
      const { listProviderModels } = await import('./routes.js');
      const base = (config.ai as { base_url: string }).base_url;
      const list = await listProviderModels('google', 'the-key', base);
      // recommended models in the hub's order (newest Flash first), then the rest
      expect(list).toEqual(['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-10-flash', 'gemini-2.5-flash']);
      expect(modelCalls[0]).toEqual({ auth: 'Bearer the-key', xkey: '' });
      await listProviderModels('anthropic', 'a-key', base);
      expect(modelCalls[1]).toEqual({ auth: '', xkey: 'a-key' });
    });

    it('passes on the provider\'s reason when the key is refused', async () => {
      const { listProviderModels } = await import('./routes.js');
      modelList = { status: 400, body: [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }] };
      await expect(listProviderModels('google', 'bad', (config.ai as { base_url: string }).base_url)).rejects.toThrow('API key not valid');
    });

    it('needs the owner', async () => {
      const res = await app.request('/web/settings/ai-models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(401);
    });

    it('asks for a key when none is typed and the saved key belongs to another provider', async () => {
      const j = await (await models({ provider: 'openai' })).json();
      expect(j).toEqual({ ok: true, models: [], needsKey: true });
    });

    it('rejects an unknown provider', async () => {
      expect((await models({ provider: 'nonsense' })).status).toBe(400);
    });
  });

  it('changing only the model keeps the saved key; a new provider still needs its own key', async () => {
    const save = (body: Record<string, unknown>) => app.request('/web/settings/ai-key', { method: 'POST', headers: owner, body: JSON.stringify(body) });
    expect((await save({ provider: 'google', model: 'gemini-3.6-flash' })).status).toBe(200);
    expect(config.ai).toMatchObject({ provider: 'google', api_key: 'k', model: 'gemini-3.6-flash' });
    // back to Automatic
    await save({ provider: 'google' });
    expect((config.ai as Record<string, unknown>).model).toBeUndefined();
    expect(config.ai!.api_key).toBe('k');
    const other = await save({ provider: 'openai' });
    expect(other.status).toBe(400);
    expect(config.ai!.provider).toBe('google');
  });

  it('the settings form no longer sets a base URL, and one in the config file is kept for the same provider', async () => {
    const save = (body: Record<string, unknown>) => app.request('/web/settings/ai-key', { method: 'POST', headers: owner, body: JSON.stringify(body) });
    const before = (config.ai as { base_url: string }).base_url;
    await save({ provider: 'google', api_key: 'new-key', model: 'gemini-3.6-flash' });
    expect(config.ai).toEqual({ provider: 'google', api_key: 'new-key', model: 'gemini-3.6-flash', base_url: before });
    await save({ provider: 'openai', api_key: 'o-key' });
    expect(config.ai).toEqual({ provider: 'openai', api_key: 'o-key' });
  });
});
