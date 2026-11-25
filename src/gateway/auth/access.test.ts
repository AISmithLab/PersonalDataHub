import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { getDb } from '../../database/db.js';
import { SqliteDataStore } from '../../database/sqlite-store.js';
import { createServer } from '../server.js';
import { TokenManager } from './token-manager.js';
import type { ConnectorRegistry, SourceConnector } from '../connectors/types.js';
import type { HubConfigParsed } from '../../config/schema.js';
import { makeTmpDir, addTestAgentKey, TEST_AGENT_AUTH } from '../../test-utils.js';
import { DEVICE_SECRET_HEADER, newAgentKey, hashAgentKey } from './access.js';

const connector: SourceConnector = {
  name: 'gmail',
  async fetch() { return []; },
  async executeAction() { return { success: true, message: 'done' }; },
};

const config: HubConfigParsed = {
  deployment: { gateway: 'local', database: 'sqlite' },
  sources: { gmail: { enabled: true, owner_auth: { type: 'oauth2', clientId: 'cid', clientSecret: 'cs' }, boundary: {} } },
  port: 3000,
  onboardingCompleted: true,
} as HubConfigParsed;

describe('access control', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: SqliteDataStore;
  let app: Hono;
  let cookie: string;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    db = getDb(join(tmpDir, 'test.db'));
    store = new SqliteDataStore(db);
    store.createUser('owner@test.com', 'hash');
    store.createSession('sess', new Date(Date.now() + 3600_000).toISOString());
    cookie = 'pdh_session=sess';
    const registry: ConnectorRegistry = new Map([['gmail', connector]]);
    app = createServer({ store, connectorRegistry: registry, config, tokenManager: new TokenManager(store, 'secret') });
    delete process.env.PDH_DEVICE_SECRET;
  });

  afterEach(() => {
    delete process.env.PDH_DEVICE_SECRET;
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('/agent/*', () => {
    it('rejects a call with no credential', async () => {
      const res = await app.request('/agent/sources');
      expect(res.status).toBe(401);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects an unknown key', async () => {
      const res = await app.request('/agent/sources', { headers: { Authorization: 'Bearer pk_nope' } });
      expect(res.status).toBe(401);
    });

    it('accepts a valid key and records last use', async () => {
      await addTestAgentKey(store);
      const res = await app.request('/agent/sources', { headers: TEST_AGENT_AUTH });
      expect(res.status).toBe(200);
      expect(store.listAgentKeys()[0].last_used_at).not.toBeNull();
    });

    it('rejects a key once it is deleted', async () => {
      const id = await addTestAgentKey(store);
      store.deleteAgentKey(id);
      const res = await app.request('/agent/sources', { headers: TEST_AGENT_AUTH });
      expect(res.status).toBe(401);
    });

    it('accepts the owner session', async () => {
      const res = await app.request('/agent/sources', { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
    });

    it('records the key name in the audit log', async () => {
      await addTestAgentKey(store, 'claude-code');
      await app.request('/agent/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...TEST_AGENT_AUTH },
        body: JSON.stringify({ source: 'gmail', action_type: 'draft_email', action_data: {}, purpose: 'p' }),
      });
      const entry = store.queryAuditEntries({ event: 'action_proposed' })[0];
      expect(JSON.parse(entry.details).initiatedBy).toBe('claude-code');
    });
  });

  describe('/web/*', () => {
    it('rejects a call with no credential', async () => {
      for (const path of ['/web/sources', '/web/filters', '/web/staging', '/web/audit', '/web/skills', '/web/memories', '/web/agent-keys', '/web/chat/status']) {
        const res = await app.request(path);
        expect(res.status, path).toBe(401);
      }
    });

    it('rejects an agent key', async () => {
      await addTestAgentKey(store);
      const res = await app.request('/web/staging', { headers: TEST_AGENT_AUTH });
      expect(res.status).toBe(401);
    });

    it('rejects the device routes without a credential', async () => {
      for (const path of ['/web/device/contacts', '/web/device/photos', '/web/device/sms/auto-reply']) {
        const res = await app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        expect(res.status, path).toBe(401);
      }
    });

    it('status works without a credential and reports it', async () => {
      const anon = await (await app.request('/web/auth/status')).json() as { authenticated: boolean; hasUsers: boolean };
      expect(anon).toEqual({ authenticated: false, hasUsers: true });
      const owner = await (await app.request('/web/auth/status', { headers: { Cookie: cookie } })).json() as { authenticated: boolean };
      expect(owner.authenticated).toBe(true);
    });

    it('logout ends the session', async () => {
      await app.request('/web/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
      const res = await app.request('/web/sources', { headers: { Cookie: cookie } });
      expect(res.status).toBe(401);
    });
  });

  describe('device secret', () => {
    it('is ignored when the hub has none configured', async () => {
      const res = await app.request('/web/sources', { headers: { [DEVICE_SECRET_HEADER]: '' } });
      expect(res.status).toBe(401);
      const res2 = await app.request('/web/sources', { headers: { [DEVICE_SECRET_HEADER]: 'anything' } });
      expect(res2.status).toBe(401);
    });

    it('never matches an empty configured secret', async () => {
      process.env.PDH_DEVICE_SECRET = '';
      const res = await app.request('/web/sources', { headers: { [DEVICE_SECRET_HEADER]: '' } });
      expect(res.status).toBe(401);
    });

    it('is accepted as the owner when it matches', async () => {
      process.env.PDH_DEVICE_SECRET = 's3cret-value';
      expect((await app.request('/web/sources', { headers: { [DEVICE_SECRET_HEADER]: 's3cret-value' } })).status).toBe(200);
      expect((await app.request('/agent/sources', { headers: { [DEVICE_SECRET_HEADER]: 's3cret-value' } })).status).toBe(200);
      expect((await app.request('/web/sources', { headers: { [DEVICE_SECRET_HEADER]: 's3cret-valuX' } })).status).toBe(401);
      const status = await (await app.request('/web/auth/status', { headers: { [DEVICE_SECRET_HEADER]: 's3cret-value' } })).json() as { authenticated: boolean };
      expect(status.authenticated).toBe(true);
    });
  });

  describe('agent keys', () => {
    it('creates a key that is shown once, lists without it, and deletes it', async () => {
      const created = await (await app.request('/web/agent-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ name: 'laptop' }),
      })).json() as { ok: boolean; id: string; key: string };
      expect(created.key).toMatch(/^pk_[A-Za-z0-9_-]{43}$/);
      expect(store.listAgentKeys()[0].key_hash).toBe(hashAgentKey(created.key));

      const listed = await (await app.request('/web/agent-keys', { headers: { Cookie: cookie } })).json() as { keys: Record<string, unknown>[] };
      expect(listed.keys).toHaveLength(1);
      expect(JSON.stringify(listed)).not.toContain(created.key);
      expect(listed.keys[0]).not.toHaveProperty('key_hash');

      expect((await app.request('/agent/sources', { headers: { Authorization: `Bearer ${created.key}` } })).status).toBe(200);
      await app.request(`/web/agent-keys/${created.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
      expect((await app.request('/agent/sources', { headers: { Authorization: `Bearer ${created.key}` } })).status).toBe(401);
    });

    it('rejects a missing, duplicate or reserved name', async () => {
      const post = (name: string) => app.request('/web/agent-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ name }),
      });
      expect((await post('')).status).toBe(400);
      expect((await post('owner')).status).toBe(400);
      expect((await post('a')).status).toBe(200);
      expect((await post('a')).status).toBe(409);
    });

    it('newAgentKey gives distinct keys', () => {
      expect(newAgentKey().key).not.toBe(newAgentKey().key);
    });
  });

  describe('old paths are gone', () => {
    it('returns 404', async () => {
      const calls: [string, string][] = [
        ['POST', '/app/v1/pull'], ['POST', '/app/v1/propose'], ['GET', '/app/v1/sources'],
        ['GET', '/api/sources'], ['GET', '/api/auth/status'], ['POST', '/auth/device-login'],
        ['POST', '/auth/login'], ['POST', '/sms/auto-reply'], ['POST', '/device/contacts-sync'],
        ['GET', '/oauth/gmail/start'], ['POST', '/oauth/gmail/disconnect'],
      ];
      for (const [method, path] of calls) {
        const res = await app.request(path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    });
  });

  describe('oauth', () => {
    it('start needs the owner and returns the provider url', async () => {
      expect((await app.request('/web/oauth/gmail/start', { method: 'POST' })).status).toBe(401);
      const res = await app.request('/web/oauth/gmail/start', { method: 'POST', headers: { Cookie: cookie } });
      const json = await res.json() as { ok: boolean; url: string };
      expect(json.ok).toBe(true);
      expect(json.url).toContain('https://accounts.google.com/');
      expect(json.url).toContain(encodeURIComponent('http://127.0.0.1:3000/oauth/gmail/callback'));
    });

    it('disconnect needs the owner', async () => {
      expect((await app.request('/web/oauth/gmail/disconnect', { method: 'POST' })).status).toBe(401);
      expect((await app.request('/web/oauth/gmail/disconnect', { method: 'POST', headers: { Cookie: cookie } })).status).toBe(200);
    });

    const storeTokens = (source: string, ticket?: string) => app.request(
      `/oauth/${source}/store-tokens${ticket ? `?ticket=${ticket}` : ''}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokens: { access_token: 'at' }, userinfo: {} }) },
    );

    async function ticketFromCallback(source: string): Promise<string> {
      const start = await (await app.request(`/web/oauth/${source}/start`, { method: 'POST', headers: { Cookie: cookie } })).json() as { url: string };
      const state = new URL(start.url).searchParams.get('state')!;
      const page = await (await app.request(`/oauth/${source}/callback?code=c&state=${state}`)).text();
      return page.match(/store-tokens\?ticket=(ticket_[0-9a-f]+)/)![1];
    }

    it('store-tokens refuses a call without a ticket, even from the owner', async () => {
      expect((await storeTokens('gmail')).status).toBe(401);
      expect((await storeTokens('gmail', 'ticket_made_up')).status).toBe(401);
      expect(store.hasToken('gmail')).toBe(false);
    });

    it('a ticket from the callback works exactly once', async () => {
      const ticket = await ticketFromCallback('gmail');
      expect((await storeTokens('gmail', ticket)).status).toBe(200);
      expect(store.hasToken('gmail')).toBe(true);
      expect((await storeTokens('gmail', ticket)).status).toBe(401);
    });

    it('a ticket for one source cannot store tokens for another', async () => {
      const ticket = await ticketFromCallback('gmail');
      expect((await storeTokens('github', ticket)).status).toBe(401);
    });

    it('the state value cannot be used as a ticket', async () => {
      const start = await (await app.request('/web/oauth/gmail/start', { method: 'POST', headers: { Cookie: cookie } })).json() as { url: string };
      const state = new URL(start.url).searchParams.get('state')!;
      expect((await storeTokens('gmail', state)).status).toBe(401);
    });
  });

  describe('every route', () => {
    // Walks the server's own route table, so a route added later without
    // protection fails here without anyone having to remember to list it.
    const OPEN = new Set([
      'GET /health', 'GET /', 'GET /next',
      'POST /web/auth/signup', 'POST /web/auth/login', 'POST /web/auth/logout', 'GET /web/auth/status',
      'GET /oauth/gmail/callback', 'GET /oauth/google_calendar/callback', 'GET /oauth/github/callback',
      'POST /oauth/gmail/store-tokens', 'POST /oauth/google_calendar/store-tokens', 'POST /oauth/github/store-tokens',
    ]);

    it('answers 401 without a credential unless it is on the open list', async () => {
      const routes = app.routes.filter((r) => r.method !== 'ALL');
      expect(routes.length).toBeGreaterThan(40);
      const seen = new Set<string>();
      for (const r of routes) {
        const id = `${r.method} ${r.path}`;
        if (seen.has(id) || OPEN.has(id)) continue;
        seen.add(id);
        expect(r.path.startsWith('/web/') || r.path.startsWith('/agent/'), `${id} is outside /web and /agent`).toBe(true);
        const path = r.path.replace(/:\w+/g, 'x');
        const res = await app.request(path, {
          method: r.method,
          ...(r.method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        });
        expect(res.status, id).toBe(401);
      }
    });

    it('store-tokens is open only to a ticket holder', async () => {
      for (const source of ['gmail', 'google_calendar', 'github']) {
        const res = await app.request(`/oauth/${source}/store-tokens`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ tokens: { access_token: 'x' }, userinfo: {} }),
        });
        expect(res.status, source).toBe(401);
      }
    });
  });

  describe('requests from another origin', () => {
    const resolve = (headers: Record<string, string>) => {
      store.insertStagingAction({ actionId: 'act_x', manifestId: '', source: 'gmail', actionType: 'draft_email', actionData: '{}', purpose: 'p' });
      return app.request('/web/staging/act_x/resolve', { method: 'POST', headers: { Cookie: cookie, ...headers }, body: JSON.stringify({ decision: 'reject' }) });
    };

    it('a page on another local port cannot use the owner cookie', async () => {
      const res = await resolve({ 'Content-Type': 'text/plain', Origin: 'http://127.0.0.1:8081', Host: '127.0.0.1:3000' });
      expect(res.status).toBe(401);
      expect(store.getStagingAction('act_x')!.status).toBe('pending');
    });

    it('a cross-site or same-site fetch is refused even without an Origin header', async () => {
      expect((await app.request('/web/staging', { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-site' } })).status).toBe(401);
      expect((await app.request('/web/staging', { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(401);
      expect((await app.request('/agent/sources', { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(401);
    });

    it('the hub\'s own page still works', async () => {
      const res = await resolve({ 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3000', Host: '127.0.0.1:3000', 'Sec-Fetch-Site': 'same-origin' });
      expect(res.status).toBe(200);
    });

    it('an agent key is not affected by origin headers', async () => {
      await addTestAgentKey(store);
      const res = await app.request('/agent/sources', { headers: { ...TEST_AGENT_AUTH, Origin: 'http://elsewhere.test' } });
      expect(res.status).toBe(200);
    });

    it('another origin cannot create the first account', async () => {
      db.prepare('DELETE FROM users').run();
      const signup = (headers: Record<string, string>) => app.request('/web/auth/signup', {
        method: 'POST', headers: { 'Content-Type': 'text/plain', ...headers }, body: JSON.stringify({ email: 'evil@x.test', password: 'password123' }),
      });
      expect((await signup({ Origin: 'http://127.0.0.1:8081', Host: '127.0.0.1:3000' })).status).toBe(403);
      expect(store.getUserCount()).toBe(0);
      expect((await signup({ Origin: 'http://127.0.0.1:3000', Host: '127.0.0.1:3000' })).status).toBe(200);
    });
  });

  describe('accounts on a device-secret hub', () => {
    it('cannot be created or used, so nobody can claim the hub by signing up first', async () => {
      db.prepare('DELETE FROM users').run();
      process.env.PDH_DEVICE_SECRET = 's3cret-value';
      const post = (path: string) => app.request(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'evil@x.test', password: 'password123' }),
      });
      const signup = await post('/web/auth/signup');
      expect(signup.status).toBe(404);
      expect(signup.headers.get('Set-Cookie')).toBeNull();
      expect(store.getUserCount()).toBe(0);
      expect((await post('/web/auth/login')).status).toBe(404);
      const status = await (await app.request('/web/auth/status')).json() as { authenticated: boolean; hasUsers: boolean };
      expect(status).toEqual({ authenticated: false, hasUsers: true });
    });
  });

  describe('one-time values expire', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('a ticket older than ten minutes is refused', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
      store.createSession('sess2', '2099-01-01T00:00:00.000Z');
      const start = await (await app.request('/web/oauth/gmail/start', { method: 'POST', headers: { Cookie: 'pdh_session=sess2' } })).json() as { url: string };
      const state = new URL(start.url).searchParams.get('state')!;
      const page = await (await app.request(`/oauth/gmail/callback?code=c&state=${state}`)).text();
      const ticket = page.match(/store-tokens\?ticket=(ticket_[0-9a-f]+)/)![1];
      vi.setSystemTime(new Date('2026-11-24T10:11:00Z'));
      const res = await app.request(`/oauth/gmail/store-tokens?ticket=${ticket}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokens: { access_token: 'at' }, userinfo: {} }),
      });
      expect(res.status).toBe(401);
    });

    it('a state older than ten minutes is refused', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
      store.createSession('sess3', '2099-01-01T00:00:00.000Z');
      const start = await (await app.request('/web/oauth/gmail/start', { method: 'POST', headers: { Cookie: 'pdh_session=sess3' } })).json() as { url: string };
      const state = new URL(start.url).searchParams.get('state')!;
      vi.setSystemTime(new Date('2026-11-24T10:11:00Z'));
      const res = await app.request(`/oauth/gmail/callback?code=c&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toContain('invalid_state');
    });
  });
});
