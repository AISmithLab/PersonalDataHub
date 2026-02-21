import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupE2eApp, request, insertManifest, cleanup } from './helpers.js';
import type { DataRow } from '../../src/connectors/types.js';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';

const FULL_REDACTED_MANIFEST = `
@purpose: "Full access with sensitive data redaction and body truncation"
@graph: pull_emails -> redact_sensitive -> truncate_body
pull_emails: pull { source: "gmail", type: "email" }
redact_sensitive: transform { kind: "redact", field: "body", pattern: "\\d{3}-\\d{2}-\\d{4}", replacement: "[REDACTED]" }
truncate_body: transform { kind: "truncate", field: "body", max_length: 5000 }
`;

describe('E2E: Gmail Full Access Redacted', () => {
  let app: Hono;
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    ({ app, db, tmpDir } = setupE2eApp());
    insertManifest(db, 'gmail-full', 'gmail', 'Full access redacted', FULL_REDACTED_MANIFEST);
  });

  afterEach(() => cleanup(db, tmpDir));

  it('returns all fields', async () => {
    const res = await request(app, 'POST', '/app/v1/pull', {
      source: 'gmail',
      purpose: 'Full access check',
    });

    const json = await res.json() as { data: DataRow[] };
    const row = json.data[0];
    expect(row.data.title).toBeDefined();
    expect(row.data.body).toBeDefined();
    expect(row.data.author_name).toBeDefined();
    expect(row.data.labels).toBeDefined();
  });

  it('redacts SSNs in body', async () => {
    const res = await request(app, 'POST', '/app/v1/pull', {
      source: 'gmail',
      purpose: 'Redaction check',
    });

    const json = await res.json() as { data: DataRow[] };
    for (const row of json.data) {
      expect(row.data.body).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    }
  });

  it('truncates body to 5000 chars', async () => {
    const res = await request(app, 'POST', '/app/v1/pull', {
      source: 'gmail',
      purpose: 'Truncation check',
    });

    const json = await res.json() as { data: DataRow[] };
    for (const row of json.data) {
      const body = row.data.body as string;
      expect(body.length).toBeLessThanOrEqual(5003); // 5000 + '...'
    }
  });
});
