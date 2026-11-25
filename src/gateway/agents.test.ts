import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { getDb } from '../database/db.js';
import { SqliteDataStore } from '../database/sqlite-store.js';
import { createServer } from './server.js';
import { TokenManager } from './auth/token-manager.js';
import { hashToken } from './auth/access.js';
import { normalizePermissions, isValidAgentName } from './agents.js';
import type { ConnectorRegistry, DataRow, SourceConnector } from './connectors/types.js';
import type { HubConfigParsed } from '../config/schema.js';
import { makeTmpDir } from '../test-utils.js';

function connector(name: string): SourceConnector {
  const rows: DataRow[] = [{ source: name, source_item_id: `${name}_1`, type: 'item', timestamp: '2026-11-20T10:00:00Z', data: { title: `${name} item` } }];
  return { name, async fetch() { return rows; }, async executeAction() { return { success: true, message: 'done' }; } };
}

const config = {
  deployment: { gateway: 'local', database: 'sqlite' },
  sources: {
    gmail: { enabled: true, owner_auth: { type: 'oauth2' }, boundary: {} },
    github: { enabled: true, owner_auth: { type: 'github_app' }, boundary: {} },
  },
  port: 3000,
  onboardingCompleted: true,
} as unknown as HubConfigParsed;

describe('agent registration', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: SqliteDataStore;
  let app: Hono;
  const owner = { Cookie: 'pdh_session=sess', 'Content-Type': 'application/json' };

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    db = getDb(join(tmpDir, 'test.db'));
    store = new SqliteDataStore(db);
    store.createUser('owner@test.com', 'hash');
    store.createSession('sess', '2099-01-01T00:00:00.000Z');
    const registry: ConnectorRegistry = new Map([['gmail', connector('gmail')], ['github', connector('github')]]);
    const tokenManager = new TokenManager(store, 'secret');
    await tokenManager.storeToken('gmail', { access_token: 'a', refresh_token: 'r' });
    await tokenManager.storeToken('github', { access_token: 'a', refresh_token: 'r' });
    app = createServer({ store, connectorRegistry: registry, config, tokenManager });
    delete process.env.PDH_DEVICE_SECRET;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PDH_DEVICE_SECRET;
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function makeLink(permissions: string[]): Promise<{ url: string; code: string }> {
    const res = await app.request('/web/agents/join-links', { method: 'POST', headers: owner, body: JSON.stringify({ permissions }) });
    expect(res.status).toBe(201);
    const { url } = await res.json() as { url: string };
    return { url, code: url.split('/agent/join/')[1] };
  }

  const joinWith = (code: string, name: unknown) =>
    app.request('/agent/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }) });

  async function register(name: string, permissions: string[]): Promise<{ token: string; id: string }> {
    const { code } = await makeLink(permissions);
    const res = await joinWith(code, name);
    expect(res.status).toBe(201);
    const j = await res.json() as { token: string; agent_id: string };
    return { token: j.token, id: j.agent_id };
  }

  const as = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  const pull = (token: string, source: string) =>
    app.request('/agent/pull', { method: 'POST', headers: as(token), body: JSON.stringify({ source, purpose: 'test' }) });
  const propose = (token: string, source: string) =>
    app.request('/agent/propose', { method: 'POST', headers: as(token), body: JSON.stringify({ source, action_type: 'draft_email', action_data: {}, purpose: 'test' }) });

  describe('join links', () => {
    it('only the owner can make one, and it points at this hub', async () => {
      const anon = await app.request('/web/agents/join-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"permissions":[]}' });
      expect(anon.status).toBe(401);
      const { url, code } = await makeLink(['pull:gmail']);
      expect(url).toBe(`http://localhost/agent/join/${code}`);
      expect(code).toMatch(/^[0-9a-f]{48}$/);
    });

    it('rejects unknown permissions', async () => {
      for (const permissions of [['pull:slack'], ['admin'], 'pull:gmail', undefined, [42]]) {
        const res = await app.request('/web/agents/join-links', { method: 'POST', headers: owner, body: JSON.stringify({ permissions }) });
        expect(res.status, JSON.stringify(permissions)).toBe(400);
      }
    });

    it('opening the link in a browser shows what it grants and does not use it up', async () => {
      const { code } = await makeLink(['pull:gmail', 'propose:gmail']);
      for (let i = 0; i < 2; i++) {
        const page = await app.request(`/agent/join/${code}`);
        expect(page.status).toBe(200);
        const html = await page.text();
        expect(html).toContain('pull:gmail, propose:gmail');
        expect(html).toContain(`smithagent joinhub &lt;agent&gt; http://localhost/agent/join/${code}`);
      }
      expect((await joinWith(code, 'a1')).status).toBe(201);
      expect((await app.request(`/agent/join/${code}`)).status).toBe(410);
    });
  });

  describe('joining', () => {
    it('returns the token once and stores only its hash', async () => {
      const { code } = await makeLink(['pull:gmail']);
      const res = await joinWith(code, 'haojian-agent7');
      expect(res.status).toBe(201);
      const j = await res.json() as { ok: boolean; token: string; agent_id: string; agent_name: string; permissions: string[]; hub: string };
      expect(j.token).toMatch(/^pdh_[A-Za-z0-9_-]{43}$/);
      expect(j).toMatchObject({ ok: true, agent_name: 'haojian-agent7', permissions: ['pull:gmail'], hub: 'http://localhost' });

      const row = store.listAgents()[0];
      expect(row.token_hash).toBe(hashToken(j.token));
      expect(JSON.stringify(row)).not.toContain(j.token);

      const list = await (await app.request('/web/agents', { headers: owner })).text();
      expect(list).toContain('haojian-agent7');
      expect(list).not.toContain(j.token);
      expect(list).not.toContain(row.token_hash);
      const audit = JSON.stringify(store.queryAuditEntries({}));
      expect(audit).toContain('agent_joined');
      expect(audit).not.toContain(j.token);
    });

    it('a code works once', async () => {
      const { code } = await makeLink(['pull:gmail']);
      expect((await joinWith(code, 'a1')).status).toBe(201);
      const again = await joinWith(code, 'a2');
      expect(again.status).toBe(410);
      expect((await again.json() as { error: { code: string } }).error.code).toBe('GONE');
      expect(store.listAgents().map((a) => a.name)).toEqual(['a1']);
    });

    it('an unknown or expired code is refused', async () => {
      expect((await joinWith('nope', 'a1')).status).toBe(410);
      expect((await joinWith('', 'a1')).status).toBe(410);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-25T10:00:00Z'));
      const { code } = await makeLink(['pull:gmail']);
      vi.setSystemTime(new Date('2026-11-25T10:14:00Z'));
      expect((await app.request(`/agent/join/${code}`)).status).toBe(200);
      vi.setSystemTime(new Date('2026-11-25T10:16:00Z'));
      expect((await joinWith(code, 'a1')).status).toBe(410);
      expect((await app.request(`/agent/join/${code}`)).status).toBe(410);
    });

    it('a bad name is refused and leaves the link usable', async () => {
      const { code } = await makeLink(['pull:gmail']);
      for (const name of ['', 'Owner', 'owner', 'has space', '-lead', 'x'.repeat(64), 42, undefined, '../etc', 'a_b']) {
        const res = await joinWith(code, name);
        expect(res.status, String(name)).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe('INVALID_NAME');
      }
      expect((await joinWith(code, 'good-name-1')).status).toBe(201);
    });

    it('a taken name is refused and leaves the link usable', async () => {
      await register('writer', ['pull:gmail']);
      const { code } = await makeLink(['pull:github']);
      const res = await joinWith(code, 'writer');
      expect(res.status).toBe(409);
      expect((await res.json() as { error: { code: string } }).error.code).toBe('NAME_TAKEN');
      expect((await joinWith(code, 'writer-2')).status).toBe(201);
    });

    it('two agents joining with the same name at once: one wins, the other keeps its link', async () => {
      const a = await makeLink(['pull:gmail']);
      const b = await makeLink(['pull:gmail']);
      const [ra, rb] = await Promise.all([joinWith(a.code, 'twin'), joinWith(b.code, 'twin')]);
      expect([ra.status, rb.status].sort()).toEqual([201, 409]);
      expect(store.listAgents().map((x) => x.name)).toEqual(['twin']);
      const loser = ra.status === 409 ? a : b;
      expect((await joinWith(loser.code, 'twin-2')).status).toBe(201);
    });

    it('a storage failure during join gives the link back and is not reported as a taken name', async () => {
      const { code } = await makeLink(['pull:gmail']);
      const original = store.insertAgent.bind(store);
      store.insertAgent = () => { throw new Error('disk I/O error'); };
      const res = await joinWith(code, 'a1');
      store.insertAgent = original;
      expect(res.status).toBe(500);
      expect(store.getJoinCode(code)!.used_at).toBeNull();
      expect((await joinWith(code, 'a1')).status).toBe(201);
    });

    it('the same link redeemed twice at once registers one agent', async () => {
      const { code } = await makeLink(['pull:gmail']);
      const results = await Promise.all([joinWith(code, 'p1'), joinWith(code, 'p2')]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 410]);
      expect(store.listAgents()).toHaveLength(1);
    });

    it('is switched off on a device-secret hub', async () => {
      const { code } = await makeLink(['pull:gmail']);
      process.env.PDH_DEVICE_SECRET = 's3cret-value';
      expect((await joinWith(code, 'a1')).status).toBe(404);
      expect((await app.request(`/agent/join/${code}`)).status).toBe(404);
      expect(store.listAgents()).toHaveLength(0);
    });
  });

  describe('permissions', () => {
    it('an agent can pull and propose only for its ticked sources', async () => {
      const { token } = await register('gh-only', ['pull:github', 'propose:github']);
      expect((await pull(token, 'github')).status).toBe(200);
      expect((await propose(token, 'github')).status).toBe(200);

      const denied = await pull(token, 'gmail');
      expect(denied.status).toBe(403);
      expect((await denied.json() as { error: { code: string; permission: string } }).error).toMatchObject({ code: 'FORBIDDEN', permission: 'pull:gmail' });
      const deniedPropose = await propose(token, 'gmail');
      expect(deniedPropose.status).toBe(403);
      expect((await deniedPropose.json() as { error: { permission: string } }).error.permission).toBe('propose:gmail');
      expect(store.getAllStagingActions().map((a) => a.source)).toEqual(['github']);
    });

    it('read without propose', async () => {
      const { token } = await register('reader', ['pull:gmail']);
      expect((await pull(token, 'gmail')).status).toBe(200);
      expect((await propose(token, 'gmail')).status).toBe(403);
    });

    it('sources lists only what the agent may pull', async () => {
      const { token } = await register('gh-only', ['pull:github']);
      const j = await (await app.request('/agent/sources', { headers: as(token) })).json() as { sources: Record<string, unknown> };
      expect(Object.keys(j.sources)).toEqual(['github']);
      const all = await (await app.request('/agent/sources', { headers: owner })).json() as { sources: Record<string, unknown> };
      expect(Object.keys(all.sources).sort()).toEqual(['github', 'gmail']);
    });

    it('the owner changes permissions and the next call sees it', async () => {
      const { token, id } = await register('reader', ['pull:gmail']);
      expect((await pull(token, 'github')).status).toBe(403);
      const res = await app.request(`/web/agents/${id}`, { method: 'PUT', headers: owner, body: JSON.stringify({ permissions: ['pull:github'] }) });
      expect(res.status).toBe(200);
      expect((await pull(token, 'github')).status).toBe(200);
      expect((await pull(token, 'gmail')).status).toBe(403);
      const bad = await app.request(`/web/agents/${id}`, { method: 'PUT', headers: owner, body: JSON.stringify({ permissions: ['root'] }) });
      expect(bad.status).toBe(400);
      expect((await app.request('/web/agents/agent_nope', { method: 'PUT', headers: owner, body: JSON.stringify({ permissions: [] }) })).status).toBe(404);
    });

    it('a source that is not a plain string is a bad request, never a way around the check', async () => {
      const { token } = await register('gm', ['pull:gmail', 'propose:gmail']);
      const before = store.getAllStagingActions().length;
      for (const source of [['gmail'], [['gmail']], { name: 'gmail' }, 42, null, '']) {
        const p = await app.request('/agent/pull', { method: 'POST', headers: as(token), body: JSON.stringify({ source, purpose: 'p' }) });
        expect(p.status, `pull ${JSON.stringify(source)}`).toBe(400);
        const q = await app.request('/agent/propose', { method: 'POST', headers: as(token), body: JSON.stringify({ source, action_type: 'draft_email', action_data: {}, purpose: 'p' }) });
        expect(q.status, `propose ${JSON.stringify(source)}`).toBe(400);
      }
      for (const body of ['null', '[]', '{not json', '"gmail"']) {
        expect((await app.request('/agent/pull', { method: 'POST', headers: as(token), body })).status, body).toBe(400);
        expect((await app.request('/agent/propose', { method: 'POST', headers: as(token), body })).status, body).toBe(400);
      }
      for (const source of ['GMAIL', ' gmail', '__proto__', 'constructor', 'github']) {
        expect((await pull(token, source)).status, source).toBe(403);
      }
      expect(store.getAllStagingActions()).toHaveLength(before);
    });

    it('the owner passes every check', async () => {
      expect((await app.request('/agent/pull', { method: 'POST', headers: owner, body: JSON.stringify({ source: 'gmail', purpose: 'p' }) })).status).toBe(200);
    });

    it('me reports name and permissions', async () => {
      const { token } = await register('reader', ['pull:gmail']);
      const me = await (await app.request('/agent/me', { headers: as(token) })).json();
      expect(me).toEqual({ ok: true, name: 'reader', owner: false, permissions: ['pull:gmail'] });
    });

    it('the audit log names the agent', async () => {
      const { token } = await register('reader', ['pull:gmail']);
      await pull(token, 'gmail');
      const entry = store.queryAuditEntries({ event: 'data_pull' })[0];
      expect(JSON.parse(entry.details).initiatedBy).toBe('reader');
    });
  });

  describe('an agent cannot manage agents', () => {
    it('its token is refused on every /web/agents route', async () => {
      const { token, id } = await register('sneaky', ['pull:gmail']);
      const calls: [string, string, string?][] = [
        ['GET', '/web/agents'],
        ['POST', '/web/agents/join-links', JSON.stringify({ permissions: ['pull:gmail', 'pull:github', 'propose:gmail'] })],
        ['PUT', `/web/agents/${id}`, JSON.stringify({ permissions: ['pull:gmail', 'pull:github'] })],
        ['DELETE', `/web/agents/${id}`],
      ];
      for (const [method, path, body] of calls) {
        const res = await app.request(path, { method, headers: as(token), body });
        expect(res.status, `${method} ${path}`).toBe(401);
      }
      expect(JSON.parse(store.listAgents()[0].permissions)).toEqual(['pull:gmail']);
    });
  });

  describe('revoke and leave', () => {
    it('a revoked agent is refused on its next call and its name is free again', async () => {
      const { token, id } = await register('temp', ['pull:gmail']);
      expect((await pull(token, 'gmail')).status).toBe(200);
      expect((await app.request(`/web/agents/${id}`, { method: 'DELETE', headers: owner })).status).toBe(200);
      const res = await pull(token, 'gmail');
      expect(res.status).toBe(401);
      expect((await res.json() as { error: { message: string } }).error.message).toContain('revoked');
      await register('temp', ['pull:gmail']);
      expect((await app.request('/web/agents/agent_nope', { method: 'DELETE', headers: owner })).status).toBe(404);
    });

    it('an agent can leave on its own; the owner session cannot "leave"', async () => {
      const { token } = await register('temp', ['pull:gmail']);
      expect((await app.request('/agent/leave', { method: 'POST', headers: as(token) })).status).toBe(200);
      expect((await pull(token, 'gmail')).status).toBe(401);
      expect(store.listAgents()).toHaveLength(0);
      expect((await app.request('/agent/leave', { method: 'POST', headers: owner })).status).toBe(400);
    });
  });

  describe('helpers', () => {
    it('normalizePermissions orders, dedupes and validates', () => {
      expect(normalizePermissions(['propose:gmail', 'pull:github', 'pull:gmail', 'pull:gmail'])).toEqual(['pull:gmail', 'pull:github', 'propose:gmail']);
      expect(normalizePermissions([])).toEqual([]);
      expect(normalizePermissions(['pull:nope'])).toBeNull();
      expect(normalizePermissions('pull:gmail')).toBeNull();
    });

    it('isValidAgentName', () => {
      expect(isValidAgentName('haojian-agent7')).toBe(true);
      expect(isValidAgentName('7up')).toBe(true);
      expect(isValidAgentName('owner')).toBe(false);
      expect(isValidAgentName('A')).toBe(false);
    });
  });
});
