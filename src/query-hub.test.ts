import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import type Database from 'better-sqlite3';
import { getDb } from './database/db.js';
import { SqliteDataStore } from './database/sqlite-store.js';
import { createServer } from './gateway/server.js';
import { TokenManager } from './gateway/auth/token-manager.js';
import type { ConnectorRegistry, DataRow, SourceConnector } from './gateway/connectors/types.js';
import type { HubConfigParsed } from './config/schema.js';
import { makeTmpDir } from './test-utils.js';

// Runs the real bin/query-hub.mjs as a child process against a real hub on a free port.
const SCRIPT = resolve('bin/query-hub.mjs');

function connector(name: string): SourceConnector {
  const rows: DataRow[] = [{ source: name, source_item_id: `${name}_1`, type: 'item', timestamp: '2026-11-20T10:00:00Z', data: { title: `${name} item` } }];
  return { name, async fetch() { return rows; }, async executeAction() { return { success: true, message: 'done' }; } };
}

interface Run { code: number; stdout: string; stderr: string; json: any }

describe('query-hub', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: SqliteDataStore;
  let server: Server;
  let hub: string;
  let tokenFile: string;
  const owner = { Cookie: 'pdh_session=sess', 'Content-Type': 'application/json' };

  beforeAll(async () => {
    tmpDir = makeTmpDir();
    db = getDb(join(tmpDir, 'test.db'));
    store = new SqliteDataStore(db);
    store.createUser('owner@test.com', 'hash');
    store.createSession('sess', '2099-01-01T00:00:00.000Z');
    const registry: ConnectorRegistry = new Map([['gmail', connector('gmail')], ['github', connector('github')]]);
    const tokenManager = new TokenManager(store, 'secret');
    await tokenManager.storeToken('gmail', { access_token: 'a', refresh_token: 'r' });
    await tokenManager.storeToken('github', { access_token: 'a', refresh_token: 'r' });
    const config = {
      deployment: { gateway: 'local', database: 'sqlite' },
      sources: { gmail: { enabled: true, owner_auth: { type: 'oauth2' }, boundary: {} }, github: { enabled: true, owner_auth: { type: 'github_app' }, boundary: {} } },
      port: 0,
    } as unknown as HubConfigParsed;
    const app = createServer({ store, connectorRegistry: registry, config, tokenManager });
    await new Promise<void>((done) => {
      server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => done()) as Server;
    });
    hub = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    tokenFile = join(tmpDir, `agent-${Math.random().toString(36).slice(2)}`, 'agent.json');
    for (const a of store.listAgents()) store.deleteAgent(a.id);
  });

  function run(args: string[], env: Record<string, string> = {}): Promise<Run> {
    return new Promise((done) => {
      execFile(process.execPath, [SCRIPT, ...args], { env: { ...process.env, QUERY_HUB_CONFIG: tokenFile, ...env } }, (err, stdout, stderr) => {
        let json: any = null;
        try { json = JSON.parse(stdout); } catch { /* not JSON */ }
        done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr, json });
      });
    });
  }

  async function link(permissions: string[]): Promise<string> {
    const res = await fetch(`${hub}/web/agents/join-links`, { method: 'POST', headers: owner, body: JSON.stringify({ permissions }) });
    return (await res.json() as { url: string }).url;
  }

  const token = () => JSON.parse(readFileSync(tokenFile, 'utf8')).token as string;

  it('join registers the agent, writes a private token file, and never prints the token', async () => {
    const url = await link(['pull:gmail', 'propose:gmail']);
    expect(url.startsWith(`${hub}/agent/join/`)).toBe(true);
    const r = await run(['join', url, '--name', 'haojian-agent7']);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: true, joined: 'haojian-agent7', hub, permissions: ['pull:gmail', 'propose:gmail'], token_file: tokenFile });

    const saved = JSON.parse(readFileSync(tokenFile, 'utf8'));
    expect(saved).toMatchObject({ hub, agent_name: 'haojian-agent7' });
    expect(saved.token).toMatch(/^pdh_/);
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
    expect(r.stdout + r.stderr).not.toContain(saved.token);
    expect(store.listAgents().map((a) => a.name)).toEqual(['haojian-agent7']);
  });

  it('me, sources, pull and propose work and keep the token out of the output', async () => {
    await run(['join', await link(['pull:gmail', 'propose:gmail']), '--name', 'worker']);
    const t = token();

    const me = await run(['me']);
    expect(me.json).toEqual({ ok: true, name: 'worker', owner: false, permissions: ['pull:gmail', 'propose:gmail'] });

    const sources = await run(['sources']);
    expect(sources.json.sources).toEqual({ gmail: { connected: true } });

    const pull = await run(['pull', 'gmail', '--purpose', 'find the proposal thread', '--query', 'from:diego', '--limit', '5']);
    expect(pull.code).toBe(0);
    expect(pull.json.data[0].data.title).toBe('gmail item');
    const audit = store.queryAuditEntries({ event: 'data_pull' })[0];
    expect(JSON.parse(audit.details)).toMatchObject({ purpose: 'find the proposal thread', initiatedBy: 'worker' });

    const propose = await run(['propose', 'gmail', 'draft_email', '--purpose', 'reply to Diego', '--data', '{"to":"d@x.org","subject":"Re","body":"Hi"}']);
    expect(propose.json).toMatchObject({ ok: true, status: 'pending_review' });
    const staged = store.getStagingAction(propose.json.actionId)!;
    expect(JSON.parse(staged.action_data)).toEqual({ to: 'd@x.org', subject: 'Re', body: 'Hi' });

    for (const r of [me, sources, pull, propose]) expect(r.stdout + r.stderr).not.toContain(t);
  });

  it('a pull the agent is not allowed names the missing permission', async () => {
    await run(['join', await link(['pull:github']), '--name', 'gh-only']);
    const r = await run(['pull', 'gmail', '--purpose', 'x']);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('lacks the "pull:gmail" permission');
    expect(r.stderr).toContain('Settings → Agents');
  });

  it('says the agent was revoked, in words, when the owner revokes it', async () => {
    await run(['join', await link(['pull:gmail']), '--name', 'temp']);
    const t = token();
    await fetch(`${hub}/web/agents/${store.listAgents()[0].id}`, { method: 'DELETE', headers: owner });
    const r = await run(['me']);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('it was revoked');
    expect(r.stderr).not.toContain(t);
    expect(r.stderr).not.toContain('{');
  });

  it('refuses to join over an existing registration', async () => {
    await run(['join', await link(['pull:gmail']), '--name', 'first']);
    const before = readFileSync(tokenFile, 'utf8');
    const second = await link(['pull:gmail']);
    const r = await run(['join', second, '--name', 'second']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Already registered as "first"');
    expect(readFileSync(tokenFile, 'utf8')).toBe(before);
    // the unused link is still good
    expect(store.getJoinCode(second.split('/agent/join/')[1])!.used_at).toBeNull();
  });

  it('leave removes the agent at the hub and deletes the token file', async () => {
    await run(['join', await link(['pull:gmail']), '--name', 'temp']);
    const r = await run(['leave']);
    expect(r.json).toMatchObject({ ok: true, left: 'temp', at_hub: 'removed' });
    expect(existsSync(tokenFile)).toBe(false);
    expect(store.listAgents()).toHaveLength(0);
    const after = await run(['me']);
    expect(after.code).toBe(1);
    expect(after.stderr).toContain('Not registered with a hub');
  });

  it('leave still clears the local token when the hub already revoked the agent', async () => {
    await run(['join', await link(['pull:gmail']), '--name', 'temp']);
    store.deleteAgent(store.listAgents()[0].id);
    const r = await run(['leave']);
    expect(r.json.at_hub).toBe('already revoked');
    expect(existsSync(tokenFile)).toBe(false);
  });

  it('explains a used link, a bad name and a malformed link', async () => {
    const url = await link(['pull:gmail']);
    const bad = await run(['join', url, '--name', 'Not Valid']);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('name must be');
    expect(existsSync(tokenFile)).toBe(false);

    expect((await run(['join', url, '--name', 'ok-name'])).code).toBe(0);
    rmSync(tokenFile);
    const used = await run(['join', url, '--name', 'other']);
    expect(used.stderr).toContain('already used or has expired');

    const malformed = await run(['join', 'https://library.aismithlab.com/join/abc', '--name', 'x']);
    expect(malformed.stderr).toContain('not a hub join link');
  });

  it('says so when the hub is not running', async () => {
    writeFileSync(join(tmpDir, 'down.json'), JSON.stringify({ hub: 'http://127.0.0.1:9', token: 'pdh_x', agent_name: 'a', agent_id: 'agent_1' }));
    const r = await run(['me'], { QUERY_HUB_CONFIG: join(tmpDir, 'down.json') });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('The hub is not running at http://127.0.0.1:9');
    expect(r.stderr).not.toContain('pdh_x');
  });

  it('rejects bad arguments before calling the hub', async () => {
    await run(['join', await link(['pull:gmail', 'propose:gmail']), '--name', 'worker']);
    const stagedBefore = store.getAllStagingActions().length;
    expect((await run(['pull', 'gmail'])).stderr).toContain('Usage: query-hub pull');
    expect((await run(['pull', 'gmail', '--purpose', 'x', '--limit', 'many'])).stderr).toContain('--limit must be');
    expect((await run(['propose', 'gmail', 'draft_email', '--purpose', 'x', '--data', '{not json'])).stderr).toContain('--data must be valid JSON');
    expect((await run(['pull', 'gmail', '--purpose'])).stderr).toContain('--purpose needs a value');
    expect((await run(['pull', 'gmail', '--purpos', 'x'])).stderr).toContain('Unknown option --purpos');
    expect((await run(['frobnicate'])).stderr).toContain('Unknown command "frobnicate"');
    expect(store.getAllStagingActions()).toHaveLength(stagedBefore);
  });

  it('prints help with no arguments', async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('query-hub join <join-link> --name <agent-name>');
  });
});
