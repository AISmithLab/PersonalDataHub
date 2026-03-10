import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupE2eApp, request, cleanup, makeConfig } from './helpers.js';
import type { DataRow } from '../../src/connectors/types.js';
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

describe('E2E: Pipeline rate limiting', () => {
  let app: Hono;
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(async () => {
    ({ app, db, tmpDir } = await setupE2eApp(undefined, makeConfigWithPipeline()));
  });
  afterEach(() => cleanup(db, tmpDir));

  it('allows pulls within the rate limit', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app, 'POST', '/app/v1/pull/pipeline', {
        pipeline: 'rate_limited_pipeline',
        steps: [
          { op: 'pull_source', source: 'gmail' },
          { op: 'limit', max: 1 },
        ],
        rate_limit: { max_pulls_per_hour: 5 },
        purpose: `Pull ${i + 1}`,
      });
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 when max_pulls_per_hour is exceeded', async () => {
    const pipelineDef = {
      pipeline: 'tight_limit_pipeline',
      steps: [
        { op: 'pull_source', source: 'gmail' },
        { op: 'limit', max: 1 },
      ],
      rate_limit: { max_pulls_per_hour: 2 },
      purpose: 'Rate limit test',
    };

    // First two pulls should succeed
    const res1 = await request(app, 'POST', '/app/v1/pull/pipeline', pipelineDef);
    expect(res1.status).toBe(200);

    const res2 = await request(app, 'POST', '/app/v1/pull/pipeline', pipelineDef);
    expect(res2.status).toBe(200);

    // Third pull should be rate limited
    const res3 = await request(app, 'POST', '/app/v1/pull/pipeline', pipelineDef);
    expect(res3.status).toBe(429);
    const json = await res3.json() as { ok: boolean; error: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('RATE_LIMITED');
    expect(res3.headers.get('Retry-After')).toBeTruthy();
  });

  it('enforces max_results_per_pull by truncating results', async () => {
    const res = await request(app, 'POST', '/app/v1/pull/pipeline', {
      pipeline: 'result_capped_pipeline',
      steps: [
        { op: 'pull_source', source: 'gmail' },
      ],
      rate_limit: { max_results_per_pull: 1 },
      purpose: 'Test result cap',
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; data: DataRow[]; meta: { itemsReturned: number } };
    expect(json.ok).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.meta.itemsReturned).toBe(1);
  });

  it('rate limits are per-pipeline (different pipelines are independent)', async () => {
    const makePipeline = (name: string) => ({
      pipeline: name,
      steps: [
        { op: 'pull_source', source: 'gmail' },
        { op: 'limit', max: 1 },
      ],
      rate_limit: { max_pulls_per_hour: 1 },
      purpose: 'Independence test',
    });

    // Exhaust pipeline_a's limit
    const res1 = await request(app, 'POST', '/app/v1/pull/pipeline', makePipeline('pipeline_a'));
    expect(res1.status).toBe(200);

    const res2 = await request(app, 'POST', '/app/v1/pull/pipeline', makePipeline('pipeline_a'));
    expect(res2.status).toBe(429);

    // pipeline_b should still work
    const res3 = await request(app, 'POST', '/app/v1/pull/pipeline', makePipeline('pipeline_b'));
    expect(res3.status).toBe(200);
  });
});
