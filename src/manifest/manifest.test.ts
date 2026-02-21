import { describe, it, expect } from 'vitest';
import { parseManifest } from './parser.js';
import { validateManifest } from './validator.js';

const EMAIL_SEARCH_MANIFEST = `
@purpose: "Find relevant emails by keyword for AI assistant"
@graph: pull_emails -> select_fields -> redact_sensitive -> truncate_body
pull_emails: pull { source: "gmail", type: "email" }
select_fields: select { fields: ["title", "body", "author_name", "author_email", "timestamp", "labels"] }
redact_sensitive: transform { kind: "redact", field: "body", pattern: "\\\\b\\\\d{3}-\\\\d{2}-\\\\d{4}\\\\b", replacement: "[REDACTED]" }
truncate_body: transform { kind: "truncate", field: "body", max_length: 5000 }
`;

const GITHUB_ISSUES_MANIFEST = `
@purpose: "Search GitHub issues and PRs in allowed repos"
@graph: pull_items -> select_fields -> redact_secrets
pull_items: pull { source: "github", type: "issue,pr" }
select_fields: select { fields: ["title", "body", "author_name", "labels", "url", "timestamp", "repo", "number", "state"] }
redact_secrets: transform { kind: "redact", field: "body", pattern: "(?i)(password|secret|token|key)\\\\s*[:=]\\\\s*\\\\S+", replacement: "[REDACTED]" }
`;

const PROPOSE_EMAIL_MANIFEST = `
@purpose: "Draft an email reply for owner review before sending"
@graph: stage_it
stage_it: stage { action_type: "reply_email", requires_approval: true }
`;

describe('Manifest Parser', () => {
  it('parses email-search manifest correctly', () => {
    const m = parseManifest(EMAIL_SEARCH_MANIFEST, 'email-search');

    expect(m.id).toBe('email-search');
    expect(m.purpose).toBe('Find relevant emails by keyword for AI assistant');
    expect(m.graph).toEqual(['pull_emails', 'select_fields', 'redact_sensitive', 'truncate_body']);
    expect(m.operators.size).toBe(4);

    const pull = m.operators.get('pull_emails')!;
    expect(pull.type).toBe('pull');
    expect(pull.properties.source).toBe('gmail');
    expect(pull.properties.type).toBe('email');

    const select = m.operators.get('select_fields')!;
    expect(select.type).toBe('select');
    expect(select.properties.fields).toEqual(['title', 'body', 'author_name', 'author_email', 'timestamp', 'labels']);

    const truncate = m.operators.get('truncate_body')!;
    expect(truncate.type).toBe('transform');
    expect(truncate.properties.kind).toBe('truncate');
    expect(truncate.properties.max_length).toBe(5000);
  });

  it('parses github-issues manifest correctly', () => {
    const m = parseManifest(GITHUB_ISSUES_MANIFEST, 'github-issues');

    expect(m.purpose).toBe('Search GitHub issues and PRs in allowed repos');
    expect(m.graph).toEqual(['pull_items', 'select_fields', 'redact_secrets']);
    expect(m.operators.size).toBe(3);

    const pull = m.operators.get('pull_items')!;
    expect(pull.properties.source).toBe('github');
    expect(pull.properties.type).toBe('issue,pr');
  });

  it('parses propose-email-reply manifest (single-node graph)', () => {
    const m = parseManifest(PROPOSE_EMAIL_MANIFEST, 'propose-email-reply');

    expect(m.purpose).toBe('Draft an email reply for owner review before sending');
    expect(m.graph).toEqual(['stage_it']);
    expect(m.operators.size).toBe(1);

    const stage = m.operators.get('stage_it')!;
    expect(stage.type).toBe('stage');
    expect(stage.properties.action_type).toBe('reply_email');
    expect(stage.properties.requires_approval).toBe(true);
  });

  it('rejects manifest with missing @purpose', () => {
    const text = `
@graph: pull -> select
pull: pull { source: "gmail" }
select: select { fields: ["title"] }
`;
    expect(() => parseManifest(text)).toThrow('missing @purpose');
  });

  it('comments and blank lines are ignored', () => {
    const text = `
// This is a comment
@purpose: "Test manifest"

// Another comment
@graph: pull_data
// comment before operator
pull_data: pull { source: "gmail", type: "email" }
// trailing comment
`;
    const m = parseManifest(text);
    expect(m.purpose).toBe('Test manifest');
    expect(m.graph).toEqual(['pull_data']);
    expect(m.operators.size).toBe(1);
  });

  it('handles inline comments after operator declarations', () => {
    const text = `
@purpose: "Test"
@graph: pull_data
pull_data: pull { source: "gmail", type: "email" }  // fetches from Gmail
`;
    const m = parseManifest(text);
    expect(m.operators.get('pull_data')!.properties.source).toBe('gmail');
  });
});

describe('Manifest Validator', () => {
  it('validates a correct manifest with no errors', () => {
    const m = parseManifest(EMAIL_SEARCH_MANIFEST, 'email-search');
    const errors = validateManifest(m);
    expect(errors).toHaveLength(0);
  });

  it('rejects graph referencing an undeclared operator name', () => {
    const text = `
@purpose: "Test"
@graph: pull_data -> nonexistent
pull_data: pull { source: "gmail" }
`;
    const m = parseManifest(text);
    const errors = validateManifest(m);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('undeclared operator');
    expect(errors[0].message).toContain('nonexistent');
  });

  it('rejects unknown operator type', () => {
    const text = `
@purpose: "Test"
@graph: op1
op1: unknown_type { source: "test" }
`;
    const m = parseManifest(text);
    const errors = validateManifest(m);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('unknown type');
  });

  it('rejects pull operator without source property', () => {
    const text = `
@purpose: "Test"
@graph: pull_data
pull_data: pull { type: "email" }
`;
    const m = parseManifest(text);
    const errors = validateManifest(m);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('missing required property');
    expect(errors[0].message).toContain('source');
  });
});
