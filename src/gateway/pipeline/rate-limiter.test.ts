import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows pulls under the limit', () => {
    limiter.recordPull('pipeline_a');
    limiter.recordPull('pipeline_a');
    const result = limiter.checkRateLimit('pipeline_a', 5);
    expect(result.allowed).toBe(true);
  });

  it('denies pulls at the limit', () => {
    for (let i = 0; i < 3; i++) {
      limiter.recordPull('pipeline_b');
    }
    const result = limiter.checkRateLimit('pipeline_b', 3);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('allows pulls again after window slides', () => {
    for (let i = 0; i < 3; i++) {
      limiter.recordPull('pipeline_c');
    }
    expect(limiter.checkRateLimit('pipeline_c', 3).allowed).toBe(false);

    // Advance time past the 1-hour window
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);

    expect(limiter.checkRateLimit('pipeline_c', 3).allowed).toBe(true);
  });

  it('tracks pipelines independently', () => {
    for (let i = 0; i < 3; i++) {
      limiter.recordPull('pipeline_d');
    }
    // pipeline_d is at limit
    expect(limiter.checkRateLimit('pipeline_d', 3).allowed).toBe(false);
    // pipeline_e is unaffected
    expect(limiter.checkRateLimit('pipeline_e', 3).allowed).toBe(true);
  });

  it('allows when no pulls have been recorded', () => {
    const result = limiter.checkRateLimit('new_pipeline', 10);
    expect(result.allowed).toBe(true);
  });
});
