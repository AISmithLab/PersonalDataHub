import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupE2eApp, request, insertManifest, cleanup } from './helpers.js';
import type { DataRow } from '../../src/connectors/types.js';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';

const METADATA_MANIFEST = `
@purpose: "Metadata only - no body or sender info"
@graph: pull_emails -> select_fields
pull_emails: pull { source: "gmail", type: "email" }
select_fields: select { fields: ["title", "labels", "timestamp"] }
`;

describe('E2E: Gmail Metadata Only', () => {
  let app: Hono;
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    ({ app, db, tmpDir } = setupE2eApp());
    insertManifest(db, 'gmail-metadata', 'gmail', 'Metadata only', METADATA_MANIFEST);
  });

  afterEach(() => cleanup(db, tmpDir));

  it('returns only title, labels, timestamp', async () => {
    const res = await request(app, 'POST', '/app/v1/pull', {
      source: 'gmail',
      purpose: 'Metadata check',
    });

    const json = await res.json() as { ok: boolean; data: DataRow[] };
    expect(json.ok).toBe(true);

    for (const row of json.data) {
      const keys = Object.keys(row.data);
      expect(keys).toContain('title');
      expect(keys).toContain('labels');
      // These should NOT be present
      expect(keys).not.toContain('body');
      expect(keys).not.toContain('author_name');
      expect(keys).not.toContain('author_email');
      expect(keys).not.toContain('participants');
    }
  });
});
