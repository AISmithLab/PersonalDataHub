import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { getDb } from '../database/db.js';
import { SqliteDataStore } from '../database/sqlite-store.js';
import { AuditLog } from './audit/log.js';
import { retireProposals } from './agents.js';
import { makeTmpDir } from '../test-utils.js';

describe('retireProposals', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: SqliteDataStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    db = getDb(join(tmpDir, 'test.db'));
    store = new SqliteDataStore(db);
  });
  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes propose grants, rejects agent-proposed pending actions, leaves SMS staging alone, and is idempotent', async () => {
    const audit = new AuditLog(store);
    store.insertAgent({ id: 'agent_a', name: 'mailer', token_hash: 'h1', permissions: JSON.stringify(['pull:gmail', 'propose:gmail', 'propose:github']) });
    store.insertAgent({ id: 'agent_b', name: 'reader', token_hash: 'h2', permissions: JSON.stringify(['pull:gmail']) });
    store.insertStagingAction({ actionId: 'act_agent', manifestId: '', source: 'gmail', actionType: 'send_email', actionData: '{}', purpose: 'p' });
    await audit.logActionProposed('act_agent', 'gmail', 'send_email', 'p', 'mailer');
    store.insertStagingAction({ actionId: 'act_sms', manifestId: '', source: 'sms', actionType: 'send_sms', actionData: '{}', purpose: 'auto-reply' });

    expect(await retireProposals(store)).toEqual({ agentsChanged: 1, proposalsRejected: 1 });
    expect(JSON.parse(store.getAgentByTokenHash('h1')!.permissions)).toEqual(['pull:gmail']);
    expect(JSON.parse(store.getAgentByTokenHash('h2')!.permissions)).toEqual(['pull:gmail']);
    expect(store.getStagingAction('act_agent')!.status).toBe('rejected');
    expect(store.getStagingAction('act_sms')!.status).toBe('pending');
    expect(store.queryAuditEntries({ event: 'action_rejected' })).toHaveLength(1);

    expect(await retireProposals(store)).toEqual({ agentsChanged: 0, proposalsRejected: 0 });
  });
});
