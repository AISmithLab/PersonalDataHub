import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { getDb } from '../../database/db.js';
import { SqliteDataStore } from '../../database/sqlite-store.js';
import { createServer } from '../server.js';
import { cleanHistory } from './routes.js';
import { TokenManager } from '../auth/token-manager.js';
import type { HubConfigParsed } from '../../config/schema.js';
import { makeTmpDir } from '../../test-utils.js';

describe('chat history', () => {
  let tmpDir: string;
  let db: Database.Database;
  let app: Hono;
  const owner = { Cookie: 'pdh_session=sess', 'Content-Type': 'application/json' };
  const config = { deployment: { gateway: 'local', database: 'sqlite' }, sources: {}, port: 3000 } as unknown as HubConfigParsed;
  const start = () => {
    db = getDb(join(tmpDir, 'test.db'));
    const store = new SqliteDataStore(db);
    if (!store.getValidSession('sess')) { store.createUser('owner@test.com', 'hash'); store.createSession('sess', '2099-01-01T00:00:00.000Z'); }
    app = createServer({ store, connectorRegistry: new Map(), config, tokenManager: new TokenManager(store, 's') });
  };
  const get = async (scope: string) => (await app.request(`/web/chat/history/${scope}`, { headers: owner })).json() as Promise<{ ok: boolean; messages: unknown[] }>;
  const put = (scope: string, messages: unknown, headers: Record<string, string> = owner) => app.request(`/web/chat/history/${scope}`, { method: 'PUT', headers, body: JSON.stringify({ messages }) });

  beforeEach(() => { tmpDir = makeTmpDir(); start(); });
  afterEach(() => { db.close(); rmSync(tmpDir, { recursive: true, force: true }); });

  it('a saved conversation comes back, also after the hub restarts', async () => {
    const messages = [
      { role: 'user', content: 'filter recommendation requests' },
      { role: 'assistant', content: 'Saved.', toolOutputs: [{ name: 'save_pipe', input: { name: 'recs' }, output: '{"ok":true,"id":"k7f3q2x2"}' }] },
    ];
    expect((await put('pipes', messages)).status).toBe(200);
    expect((await get('pipes')).messages).toEqual(messages);
    db.close();
    start();
    expect((await get('pipes')).messages).toEqual(messages);
  });

  it('each page has its own conversation, and clearing one leaves the others', async () => {
    await put('pipes', [{ role: 'user', content: 'p' }]);
    await put('skills', [{ role: 'user', content: 's' }]);
    await put('chat', [{ role: 'user', content: 'c' }]);
    expect((await app.request('/web/chat/history/skills', { method: 'DELETE', headers: owner })).status).toBe(200);
    expect((await get('skills')).messages).toEqual([]);
    expect((await get('pipes')).messages).toEqual([{ role: 'user', content: 'p' }]);
    expect((await get('chat')).messages).toEqual([{ role: 'user', content: 'c' }]);
  });

  it('needs the owner: an agent token or no credential is refused', async () => {
    expect((await app.request('/web/chat/history/chat')).status).toBe(401);
    expect((await put('chat', [], { 'Content-Type': 'application/json' })).status).toBe(401);
    expect((await put('chat', [], { 'Content-Type': 'application/json', Authorization: 'Bearer pdh_nope' })).status).toBe(401);
  });

  it('refuses an unknown conversation and anything that is not a conversation', async () => {
    expect((await put('other', [])).status).toBe(404);
    expect((await put('chat', 'hello')).status).toBe(400);
    expect((await put('chat', [{ role: 'system', content: 'x' }])).status).toBe(400);
    expect((await put('chat', [{ role: 'user', content: 5 }])).status).toBe(400);
  });

  it('keeps the newest messages and stays within the size limit', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    const kept = cleanHistory(many)!;
    expect(kept).toHaveLength(200);
    expect(kept[199].content).toBe('m249');
    const big = Array.from({ length: 30 }, (_, i) => ({ role: 'assistant', content: `r${i}`, toolOutputs: [{ name: 'read_emails', input: {}, output: 'x'.repeat(100_000) }] }));
    const trimmed = cleanHistory(big)!;
    expect(Buffer.byteLength(JSON.stringify(trimmed))).toBeLessThanOrEqual(1_000_000);
    expect(trimmed[trimmed.length - 1]).toEqual(big[29]); // the newest message is intact
    expect(trimmed.map((m) => m.content)).toEqual(big.map((m) => m.content)); // older text survives; only old tool outputs went
  });
});
