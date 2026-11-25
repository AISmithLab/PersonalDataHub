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
    replies = []; seenModels = [];
    provider = createHttpServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d)).on('end', () => {
        seenModels.push(JSON.parse(raw).model);
        const r = replies.shift() ?? ok('default');
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
    replies.push(googleError(404, 'This model models/gemini-2.0-flash is no longer available. Please update your code to use models/gemini-3.8-flash.'));
    const j = await (await chat()).json() as { ok: boolean; error: string };
    expect(j.ok).toBe(false);
    expect(j.error).toContain('This model models/gemini-2.0-flash is no longer available');
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

  it('retries when the provider is overloaded (503)', async () => {
    replies.push(googleError(503, 'This model is currently experiencing high demand.'), ok('recovered'));
    expect(await (await chat()).json()).toMatchObject({ ok: true, reply: 'recovered' });
  }, 15_000);

  it('uses a current default model for Google', async () => {
    await chat();
    expect(seenModels[0]).toBe('gemini-flash-latest');
  });

  it('saving a new provider drops the previous provider\'s model and base URL', async () => {
    const save = (body: Record<string, unknown>) => app.request('/web/settings/ai-key', { method: 'POST', headers: owner, body: JSON.stringify(body) });
    await save({ provider: 'anthropic', api_key: 'a-key', model: 'claude-sonnet-4-6', base_url: 'https://example.test/v1' });
    await save({ provider: 'google', api_key: 'g-key' });
    expect(config.ai).toEqual({ provider: 'google', api_key: 'g-key' });
  });

  it('writes the setting to the config file the hub was started with, so it survives a restart', async () => {
    const path = join(tmpDir, 'hub-config.yaml');
    writeFileSync(path, 'sources: {}\nport: 3000\n');
    process.env.PDH_CONFIG_PATH = path;
    await app.request('/web/settings/ai-key', { method: 'POST', headers: owner, body: JSON.stringify({ provider: 'google', api_key: 'g-key', model: 'gemini-flash-latest' }) });
    expect((parseYaml(readFileSync(path, 'utf-8')) as { ai: unknown; port: number })).toMatchObject({ port: 3000, ai: { provider: 'google', api_key: 'g-key', model: 'gemini-flash-latest' } });
  });
});
