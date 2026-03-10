import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupE2eApp, request, cleanup, makeConfig } from './helpers.js';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';

function makeConfigWithPipeline() {
  const config = makeConfig();
  (config as Record<string, unknown>).pipeline = {
    allow_custom_pipelines: true,
    required_operators: [],
    max_steps: 20,
  };
  return config;
}

describe('E2E: Pipeline action restriction on /propose', () => {
  let app: Hono;
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(async () => {
    ({ app, db, tmpDir } = await setupE2eApp(undefined, makeConfigWithPipeline()));
  });
  afterEach(() => cleanup(db, tmpDir));

  it('allows a propose with an allowed action after running a pipeline', async () => {
    // First, run a pipeline with allowed_actions: ['draft_email']
    const pullRes = await request(app, 'POST', '/app/v1/pull/pipeline', {
      pipeline: 'restricted_pipeline',
      steps: [
        { op: 'pull_source', source: 'gmail' },
        { op: 'limit', max: 1 },
      ],
      allowed_actions: ['draft_email'],
      purpose: 'Test action guard',
    });
    expect(pullRes.status).toBe(200);

    // Propose an allowed action
    const proposeRes = await request(app, 'POST', '/app/v1/propose', {
      source: 'gmail',
      action_type: 'draft_email',
      action_data: { to: 'test@example.com', subject: 'Hi', body: 'Hello' },
      purpose: 'Drafting email',
      pipeline: 'restricted_pipeline',
    });
    expect(proposeRes.status).toBe(200);
    const json = await proposeRes.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('rejects a propose with a disallowed action after running a pipeline', async () => {
    // Run a pipeline with allowed_actions: ['draft_email']
    const pullRes = await request(app, 'POST', '/app/v1/pull/pipeline', {
      pipeline: 'restricted_pipeline_2',
      steps: [
        { op: 'pull_source', source: 'gmail' },
        { op: 'limit', max: 1 },
      ],
      allowed_actions: ['draft_email'],
      purpose: 'Test action guard',
    });
    expect(pullRes.status).toBe(200);

    // Propose a disallowed action
    const proposeRes = await request(app, 'POST', '/app/v1/propose', {
      source: 'gmail',
      action_type: 'send_email',
      action_data: { to: 'test@example.com', subject: 'Hi', body: 'Hello' },
      purpose: 'Sending email',
      pipeline: 'restricted_pipeline_2',
    });
    expect(proposeRes.status).toBe(403);
    const json = await proposeRes.json() as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('ACTION_NOT_ALLOWED');
  });

  it('allows propose without pipeline field (backward compat)', async () => {
    const proposeRes = await request(app, 'POST', '/app/v1/propose', {
      source: 'gmail',
      action_type: 'send_email',
      action_data: { to: 'test@example.com', subject: 'Hi', body: 'Hello' },
      purpose: 'No pipeline restriction',
    });
    expect(proposeRes.status).toBe(200);
    const json = await proposeRes.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('allows propose when pipeline has no allowed_actions (undefined)', async () => {
    // Run a pipeline without allowed_actions
    const pullRes = await request(app, 'POST', '/app/v1/pull/pipeline', {
      pipeline: 'unrestricted_pipeline',
      steps: [
        { op: 'pull_source', source: 'gmail' },
        { op: 'limit', max: 1 },
      ],
      purpose: 'Test no restrictions',
    });
    expect(pullRes.status).toBe(200);

    // Propose any action — should be allowed
    const proposeRes = await request(app, 'POST', '/app/v1/propose', {
      source: 'gmail',
      action_type: 'send_email',
      action_data: {},
      purpose: 'Any action',
      pipeline: 'unrestricted_pipeline',
    });
    expect(proposeRes.status).toBe(200);
    const json = await proposeRes.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('rejects all actions when allowed_actions is empty array', async () => {
    // Run a pipeline with allowed_actions: []
    const pullRes = await request(app, 'POST', '/app/v1/pull/pipeline', {
      pipeline: 'no_actions_pipeline',
      steps: [
        { op: 'pull_source', source: 'gmail' },
      ],
      allowed_actions: [],
      purpose: 'Test empty allowed_actions',
    });
    expect(pullRes.status).toBe(200);

    const proposeRes = await request(app, 'POST', '/app/v1/propose', {
      source: 'gmail',
      action_type: 'draft_email',
      action_data: {},
      purpose: 'Should be denied',
      pipeline: 'no_actions_pipeline',
    });
    expect(proposeRes.status).toBe(403);
  });
});
