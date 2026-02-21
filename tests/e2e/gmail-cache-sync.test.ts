import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupE2eApp, request, insertManifest, cleanup, makeGmailRows } from './helpers.js';
import { encryptField } from '../../src/db/encryption.js';
import type { DataRow } from '../../src/connectors/types.js';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';

const STORE_MANIFEST = `
@purpose: "Cache emails locally"
@graph: pull_emails -> store_locally
pull_emails: pull { source: "gmail", type: "email" }
store_locally: store { }
`;

const READ_MANIFEST = `
@purpose: "Read cached emails"
@graph: pull_emails -> select_fields
pull_emails: pull { source: "gmail", type: "email" }
select_fields: select { fields: ["title", "body", "labels"] }
`;

describe('E2E: Gmail Cache/Sync', () => {
  let app: Hono;
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    ({ app, db, tmpDir } = setupE2eApp());
  });

  afterEach(() => cleanup(db, tmpDir));

  it('store manifest populates cache → subsequent pull served from cache', async () => {
    // First: use store manifest to cache data
    insertManifest(db, 'gmail-store', 'gmail', 'Cache emails', STORE_MANIFEST);

    const storeRes = await request(app, 'POST', '/app/v1/pull', {
      source: 'gmail',
      purpose: 'Cache emails locally',
    });
    expect(storeRes.status).toBe(200);
    const storeJson = await storeRes.json() as { data: DataRow[] };
    expect(storeJson.data).toHaveLength(3);

    // Verify cache is populated
    const cached = db.prepare('SELECT COUNT(*) as count FROM cached_data WHERE source = ?').get('gmail') as { count: number };
    expect(cached.count).toBe(3);

    // Now switch to read manifest — should read from cache, not connector
    db.prepare('DELETE FROM manifests').run();
    insertManifest(db, 'gmail-read', 'gmail', 'Read cached', READ_MANIFEST);

    // The pull should read from cache (connector would return different data if called)
    const readRes = await request(app, 'POST', '/app/v1/pull', {
      source: 'gmail',
      purpose: 'Read from cache',
    });
    expect(readRes.status).toBe(200);
    const readJson = await readRes.json() as { data: DataRow[] };
    expect(readJson.data).toHaveLength(3);
  });

  it('pre-populated cache serves pull requests', async () => {
    // Manually insert cached data
    const rows = makeGmailRows();
    const encryptionKey = 'e2e-test-secret';

    for (const row of rows) {
      const dataStr = encryptField(JSON.stringify(row.data), encryptionKey);
      db.prepare(
        `INSERT INTO cached_data (id, source, source_item_id, type, timestamp, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(`cache_${row.source_item_id}`, row.source, row.source_item_id, row.type, row.timestamp, dataStr);
    }

    insertManifest(db, 'gmail-read', 'gmail', 'Read cached', READ_MANIFEST);

    const res = await request(app, 'POST', '/app/v1/pull', {
      source: 'gmail',
      purpose: 'Serve from pre-populated cache',
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { data: DataRow[] };
    expect(json.data).toHaveLength(3);
    // Should have only selected fields
    for (const row of json.data) {
      expect(Object.keys(row.data)).toContain('title');
      expect(Object.keys(row.data)).toContain('body');
      expect(Object.keys(row.data)).toContain('labels');
    }
  });
});
