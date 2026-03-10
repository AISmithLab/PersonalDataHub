import { describe, it, expect } from 'vitest';
import { checkActionAllowed } from './action-guard.js';
import type { PipelineDefinition } from './types.js';

function makeDef(allowed_actions?: string[]): PipelineDefinition {
  return {
    pipeline: 'test_pipeline',
    steps: [{ op: 'pull_source', source: 'gmail' }],
    allowed_actions,
  };
}

describe('checkActionAllowed', () => {
  it('allows all actions when allowed_actions is undefined', () => {
    const result = checkActionAllowed(makeDef(undefined), 'send_email');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('denies all actions when allowed_actions is empty array', () => {
    const result = checkActionAllowed(makeDef([]), 'send_email');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('does not allow any actions');
  });

  it('allows a listed action', () => {
    const result = checkActionAllowed(makeDef(['draft_email']), 'draft_email');
    expect(result.allowed).toBe(true);
  });

  it('denies an unlisted action', () => {
    const result = checkActionAllowed(makeDef(['draft_email']), 'send_email');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('send_email');
    expect(result.reason).toContain('draft_email');
  });

  it('works with multiple allowed actions', () => {
    const def = makeDef(['draft_email', 'read_emails']);
    expect(checkActionAllowed(def, 'draft_email').allowed).toBe(true);
    expect(checkActionAllowed(def, 'read_emails').allowed).toBe(true);
    expect(checkActionAllowed(def, 'send_email').allowed).toBe(false);
  });
});
