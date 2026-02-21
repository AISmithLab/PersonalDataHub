import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupE2eApp, request, insertManifest, cleanup } from './helpers.js';
import type { DataRow } from '../../src/connectors/types.js';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import type { AuditLog } from '../../src/audit/log.js';

const READONLY_MANIFEST = `
@purpose: "Read-only, recent emails with SSN redaction"
@graph: pull_emails -> select_fields -> redact_sensitive
pull_emails: pull { source: "gmail", type: "email" }
select_fields: select { fields: ["title", "body", "labels", "timestamp"] }
redact_sensitive: transform { kind: "redact", field: "body", pattern: "\\d{3}-\\d{2}-\\d{4}", replacement: "[REDACTED]" }
`;

describe('E2E: Gmail Read-Only Recent', () => {
  let app: Hono;
  let db: Database.Database;
  let tmpDir: string;
  let audit: AuditLog;

  beforeEach(() => {
    ({ app, db, tmpDir, audit } = setupE2eApp());
    insertManifest(db, 'gmail-readonly', 'gmail', 'Read-only recent', READONLY_MANIFEST);
  });

  afterEach(() => cleanup(db, tmpDir));

  it('returns only title, body, labels, timestamp (no sender info)', async () => {
    const res = await request(app, 'POST', '/app/v1/pull', {
      source: 'gmail',
      type: 'email',
      purpose: 'Find Q4 report emails',
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; data: DataRow[] };
    expect(json.ok).toBe(true);
    expect(json.data.length).toBe(3);

    for (const row of json.data) {
      const keys = Object.keys(row.data);
      expect(keys).toContain('title');
      expect(keys).toContain('body');
      expect(keys).toContain('labels');
      // These should NOT be present (filtered by select)
      expect(keys).not.toContain('author_name');
      expect(keys).not.toContain('author_email');
      expect(keys).not.toContain('participants');
    }
  });

  it('redacts SSNs in body', async () => {
    const res = await request(app, 'POST', '/app/v1/pull', {
      source: 'gmail',
      purpose: 'Check redaction',
    });

    const json = await res.json() as { data: DataRow[] };
    const row1 = json.data.find(r => r.source_item_id === 'msg_e2e_1')!;
    expect(row1.data.body).toContain('[REDACTED]');
    expect(row1.data.body).not.toContain('123-45-6789');

    const row2 = json.data.find(r => r.source_item_id === 'msg_e2e_2')!;
    expect(row2.data.body).toContain('[REDACTED]');
    expect(row2.data.body).not.toContain('987-65-4321');
  });

  it('creates audit log entry', async () => {
    await request(app, 'POST', '/app/v1/pull', {
      source: 'gmail',
      purpose: 'Audit test',
    });

    const entries = audit.getEntries({ event: 'data_pull' });
    expect(entries).toHaveLength(1);
    expect(entries[0].details.purpose).toBe('Audit test');
    expect(entries[0].details.resultsReturned).toBe(3);
  });
});
