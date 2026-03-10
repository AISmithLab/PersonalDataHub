export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

/**
 * In-memory sliding window rate limiter per pipeline name.
 * Counters reset on server restart (acceptable for V1).
 */
export class RateLimiter {
  private timestamps: Map<string, number[]> = new Map();
  private readonly windowMs = 60 * 60 * 1000; // 1 hour

  /**
   * Check if a pull is allowed under max_pulls_per_hour.
   */
  checkRateLimit(pipelineName: string, maxPullsPerHour: number): RateLimitResult {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.timestamps.get(pipelineName) ?? [];

    // Remove expired timestamps
    const active = timestamps.filter((t) => t > cutoff);

    if (active.length >= maxPullsPerHour) {
      // Earliest timestamp that will expire
      const oldestActive = active[0];
      const retryAfterMs = oldestActive + this.windowMs - now;
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0) };
    }

    return { allowed: true };
  }

  /**
   * Record a successful pull for the given pipeline.
   */
  recordPull(pipelineName: string): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.timestamps.get(pipelineName) ?? [];

    // Clean up expired + add new
    const active = timestamps.filter((t) => t > cutoff);
    active.push(now);
    this.timestamps.set(pipelineName, active);
  }
}
