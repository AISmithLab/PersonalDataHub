import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { getDb } from '../database/db.js';
import { SqliteDataStore } from '../database/sqlite-store.js';
import { createServer } from './server.js';
import { TokenManager } from './auth/token-manager.js';
import type { ActionResult, ConnectorRegistry, SourceConnector } from './connectors/types.js';
import type { HubConfigParsed } from '../config/schema.js';
import { makeTmpDir } from '../test-utils.js';

const STUDENTS = `
const students = ["alice@ucsd.edu", "bob@ucsd.edu"];
if (action.type !== "send_email" && action.type !== "draft_email") return block("Only emails and drafts.");
const to = String(action.data.to).toLowerCase().split(/[,;]/).map((r) => r.trim());
const outside = to.filter((r) => !students.includes(r));
if (outside.length) return block("Not a lab student: " + outside.join(", "));
return pass();`;

describe('outgoing pipes', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: SqliteDataStore;
  let app: Hono;
  let sent: Array<{ type: string; data: Record<string, unknown> }>;
  let connectorReply: () => Promise<ActionResult>;
  const owner = { Cookie: 'pdh_session=sess', 'Content-Type': 'application/json' };

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    db = getDb(join(tmpDir, 'test.db'));
    store = new SqliteDataStore(db);
    store.createUser('owner@test.com', 'hash');
    store.createSession('sess', '2099-01-01T00:00:00.000Z');
    sent = [];
    connectorReply = async () => ({ success: true, message: 'Email sent', resultData: { id: 'msg1' } });
    const gmail: SourceConnector = {
      name: 'gmail',
      async fetch() { return []; },
      async executeAction(type, data) { sent.push({ type, data }); return connectorReply(); },
    };
    const registry: ConnectorRegistry = new Map([['gmail', gmail]]);
    const tokenManager = new TokenManager(store, 'secret');
    await tokenManager.storeToken('gmail', { access_token: 'a', refresh_token: 'r' });
    const config = { deployment: { gateway: 'local', database: 'sqlite' }, sources: { gmail: { enabled: true, boundary: {} } }, port: 3000 } as unknown as HubConfigParsed;
    app = createServer({ store, connectorRegistry: registry, config, tokenManager });
    delete process.env.PDH_DEVICE_SECRET;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function outgoingPipe(id = 'out23456', program = STUDENTS, enabled = 1): string {
    store.insertPipe({ id, name: 'Students only', description: 'Emails to my lab students.', source: 'gmail', query: '', program, enabled, direction: 'outgoing' });
    return id;
  }
  async function agent(name: string, permissions: string[]): Promise<Record<string, string>> {
    const link = await (await app.request('/web/agents/join-links', { method: 'POST', headers: owner, body: JSON.stringify({ permissions }) })).json() as { url: string };
    const joined = await (await app.request('/agent/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: link.url.split('/agent/join/')[1], name }) })).json() as { token: string };
    return { Authorization: `Bearer ${joined.token}`, 'Content-Type': 'application/json' };
  }
  const act = (id: string, headers: Record<string, string>, body: unknown) => app.request(`/agent/pipes/${id}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const email = (to: string) => ({ type: 'send_email', data: { to, subject: 'Letter submitted', body: 'Done.' } });
  const logOf = (id: string) => store.listPipeLog(id, { limit: 10 }).map((e) => ({ ...e, summary: JSON.parse(e.summary) }));

  it('a passing email is sent once, with the data the agent sent, and logged as sent', async () => {
    const id = outgoingPipe();
    const who = await agent('mailer', [`pipe:${id}`]);
    const res = await act(id, who, { action: email('alice@ucsd.edu'), purpose: 'tell Alice' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: 'sent', result: { message: 'Email sent', id: 'msg1' } });
    expect(sent).toEqual([{ type: 'send_email', data: { to: 'alice@ucsd.edu', subject: 'Letter submitted', body: 'Done.' } }]);
    const [entry] = logOf(id);
    expect(entry).toMatchObject({ caller: 'mailer', purpose: 'tell Alice', outcome: 'sent' });
    expect(entry.summary.action).toEqual(email('alice@ucsd.edu'));
  });

  it('a blocked email is not sent; the agent gets the program\'s reason; logged as blocked', async () => {
    const id = outgoingPipe();
    const who = await agent('mailer', [`pipe:${id}`]);
    const res = await act(id, who, { action: email('dean@ucsd.edu'), purpose: 'x' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, outcome: 'blocked', reason: 'Not a lab student: dean@ucsd.edu' });
    expect(sent).toEqual([]);
    expect(logOf(id)[0]).toMatchObject({ outcome: 'blocked' });
    expect(logOf(id)[0].summary.reason).toBe('Not a lab student: dean@ucsd.edu');
  });

  it('a program error blocks, hides the message from an agent, shows it to the owner, and is logged as error', async () => {
    const id = outgoingPipe('out23456', 'throw new Error("secret detail");');
    const who = await agent('mailer', [`pipe:${id}`]);
    const asAgent = await (await act(id, who, { action: email('alice@ucsd.edu'), purpose: 'x' })).json() as { reason: string; outcome: string };
    expect(asAgent).toEqual({ ok: false, outcome: 'blocked', reason: 'The pipe failed; the action was not carried out.' });
    const asOwner = await (await act(id, owner, { action: email('alice@ucsd.edu'), purpose: 'x' })).json() as { reason: string };
    expect(asOwner.reason).toContain('secret detail');
    expect(sent).toEqual([]);
    expect(logOf(id).map((e) => [e.caller, e.outcome])).toEqual([['owner', 'error'], ['mailer', 'error']]);
    expect(logOf(id)[1].summary.reason).toContain('secret detail');
  });

  it('the connector throwing or returning success false is failed, logged, and not reported as sent', async () => {
    const id = outgoingPipe();
    const who = await agent('mailer', [`pipe:${id}`]);
    connectorReply = async () => { throw new Error('Gmail said no'); };
    const r1 = await act(id, who, { action: email('alice@ucsd.edu'), purpose: 'x' });
    expect(r1.status).toBe(502);
    expect(await r1.json()).toEqual({ ok: false, outcome: 'failed', reason: 'Gmail said no' });
    connectorReply = async () => ({ success: false, message: 'Missing recipient' });
    const r2 = await act(id, who, { action: email('alice@ucsd.edu'), purpose: 'x' });
    expect(await r2.json()).toEqual({ ok: false, outcome: 'failed', reason: 'Missing recipient' });
    expect(logOf(id).map((e) => e.outcome)).toEqual(['failed', 'failed']);
  });

  it('a switched-off pipe sends nothing and is 409', async () => {
    const id = outgoingPipe('out23456', STUDENTS, 0);
    const who = await agent('mailer', [`pipe:${id}`]);
    const res = await act(id, who, { action: email('alice@ucsd.edu'), purpose: 'x' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PIPE_OFF');
    expect(sent).toEqual([]);
    expect(logOf(id)).toEqual([]);
  });

  it('reads the pipe once per call, so one version decides and acts', async () => {
    const id = outgoingPipe();
    const who = await agent('mailer', [`pipe:${id}`]);
    const original = store.getPipe.bind(store);
    let reads = 0;
    store.getPipe = (pid: string) => { if (pid === id) reads++; return original(pid); };
    await act(id, who, { action: email('alice@ucsd.edu'), purpose: 'x' });
    expect(reads).toBe(1);
  });

  it('a malformed action is 400, and nothing is logged or sent', async () => {
    const id = outgoingPipe();
    const who = await agent('mailer', [`pipe:${id}`]);
    for (const body of [{ purpose: 'x' }, { action: { type: 'create_event', data: {} }, purpose: 'x' }, { action: email('alice@ucsd.edu') }]) {
      expect((await act(id, who, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(sent).toEqual([]);
    expect(logOf(id)).toEqual([]);
  });

  it('wrong direction is 405 both ways', async () => {
    const out = outgoingPipe();
    store.insertPipe({ id: 'in234567', name: 'In', description: '', source: 'gmail', query: '', program: 'return rows;', enabled: 1 });
    const get = await app.request(`/agent/pipes/${out}`, { headers: owner });
    expect(get.status).toBe(405);
    expect(((await get.json()) as { error: { code: string } }).error.code).toBe('WRONG_DIRECTION');
    expect((await act('in234567', owner, { action: email('alice@ucsd.edu'), purpose: 'x' })).status).toBe(405);
  });

  it('an agent without pipe:<id> is 403; pull on gmail does not help; an unknown id is 404 only with the permission', async () => {
    const id = outgoingPipe();
    const other = await agent('reader', ['pull:gmail']);
    expect((await act(id, other, { action: email('alice@ucsd.edu'), purpose: 'x' })).status).toBe(403);
    expect((await act('zzzzzzzz', owner, { action: email('alice@ucsd.edu'), purpose: 'x' })).status).toBe(404);
    expect(sent).toEqual([]);
  });

  it('the list shows direction', async () => {
    const id = outgoingPipe();
    const who = await agent('mailer', [`pipe:${id}`]);
    const j = await (await app.request('/agent/pipes', { headers: who })).json() as { pipes: Array<{ id: string; direction: string }> };
    expect(j.pipes).toEqual([expect.objectContaining({ id, direction: 'outgoing' })]);
  });
});
