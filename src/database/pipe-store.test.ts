import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { getDb } from './db.js';
import { SqliteDataStore } from './sqlite-store.js';
import { SqlJsDataStore } from './sqljs-store.js';
import type { DataStore } from './datastore.js';
import { makeTmpDir } from '../test-utils.js';

const pipe = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: 'n', description: 'd', source: 'gmail', query: '', program: 'return rows;', enabled: 1, ...extra,
});
const entry = (pipeId: string, n: number) => ({
  pipe_id: pipeId, caller: 'worker', purpose: `call ${n}`, outcome: 'sent', summary: JSON.stringify({ n }), duration_ms: n,
});

describe.each([
  ['SQLite', async (dir: string) => new SqliteDataStore(getDb(join(dir, 'a.db'))) as DataStore],
  // The store loads sql.js by dynamic import, which vitest cannot run; the asm.js build
  // path is the one the iOS app uses and loads with require.
  ['sql.js', async (dir: string) => {
    process.env.SQLJS_ASM_PATH = join(process.cwd(), 'node_modules/sql.js/dist/sql-asm.js');
    try { return (await SqlJsDataStore.create(join(dir, 'b.db'))) as DataStore; } finally { delete process.env.SQLJS_ASM_PATH; }
  }],
])('pipe store (%s)', (_name, open) => {
  let dir: string;
  let store: DataStore;
  beforeEach(async () => { dir = makeTmpDir(); store = await open(dir); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('an outgoing pipe keeps its direction and test actions', async () => {
    await store.insertPipe(pipe('out00001', { direction: 'outgoing', test_actions: '[{"type":"send_email"}]' }));
    const row = (await store.getPipe('out00001'))!;
    expect(row.direction).toBe('outgoing');
    expect(row.test_actions).toBe('[{"type":"send_email"}]');
    await store.updatePipe('out00001', { test_actions: '[]' });
    expect((await store.getPipe('out00001'))!.test_actions).toBe('[]');
  });

  it('a pipe inserted without a direction is incoming', async () => {
    await store.insertPipe(pipe('in000001'));
    expect((await store.getPipe('in000001'))!).toMatchObject({ direction: 'incoming', test_actions: '[]' });
  });

  it('the log returns newest first, pages with before, and keeps 500 per pipe', async () => {
    for (let i = 1; i <= 502; i++) await store.insertPipeLog(entry('p1', i));
    for (let i = 1; i <= 3; i++) await store.insertPipeLog(entry('p2', i));
    const all = await store.listPipeLog('p1', { limit: 1000 });
    expect(all).toHaveLength(500);
    expect(all[0].purpose).toBe('call 502');
    expect(all[499].purpose).toBe('call 3');
    expect(await store.listPipeLog('p2', { limit: 1000 })).toHaveLength(3);
    const next = await store.listPipeLog('p1', { limit: 10, before: all[9].id });
    expect(next.map((e) => e.purpose)).toEqual(all.slice(10, 20).map((e) => e.purpose));
    expect(all[0]).toMatchObject({ pipe_id: 'p1', caller: 'worker', outcome: 'sent', duration_ms: 502 });
    expect(typeof all[0].at).toBe('string');
  });

  it('deletePipeLog removes only that pipe\'s entries', async () => {
    await store.insertPipeLog(entry('p1', 1));
    await store.insertPipeLog(entry('p2', 1));
    await store.deletePipeLog('p1');
    expect(await store.listPipeLog('p1', { limit: 10 })).toEqual([]);
    expect(await store.listPipeLog('p2', { limit: 10 })).toHaveLength(1);
    expect(store.supportsPipeLog).toBe(true);
  });
});

describe('an existing hub database', () => {
  it('reads its pipes back as incoming with no test actions', () => {
    const dir = makeTmpDir();
    try {
      const path = join(dir, 'old.db');
      const old = new Database(path);
      old.exec(`CREATE TABLE pipes (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, query TEXT NOT NULL DEFAULT '', program TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
      old.prepare("INSERT INTO pipes (id, name, source, program) VALUES ('oldpipe1', 'n', 'gmail', 'return rows;')").run();
      old.close();
      const store = new SqliteDataStore(getDb(path));
      expect(store.getPipe('oldpipe1')).toMatchObject({ direction: 'incoming', test_actions: '[]' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
