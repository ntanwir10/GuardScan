/**
 * Rate Limiter for Cloudflare Workers
 *
 * Simple in-memory rate limiting with sliding window
 * Uses per-client tracking to prevent abuse
 */

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

interface RateLimitRecord {
  count: number;
  resetAt: number; // Timestamp when window resets
}

export class RateLimiter {
  private limits: Map<string, RateLimitRecord> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if request is allowed
   * @param key - Unique identifier (e.g., clientId, IP address)
   * @returns { allowed: boolean, remaining: number, resetAt: number }
   */
  check(key: string): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    limit: number;
  } {
    const now = Date.now();
    const record = this.limits.get(key);

    // No record or window expired - create new window
    if (!record || now >= record.resetAt) {
      const newRecord: RateLimitRecord = {
        count: 1,
        resetAt: now + this.config.windowMs,
      };
      this.limits.set(key, newRecord);

      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetAt: newRecord.resetAt,
        limit: this.config.maxRequests,
      };
    }

    // Window still active - check limit
    if (record.count >= this.config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: record.resetAt,
        limit: this.config.maxRequests,
      };
    }

    // Increment count
    record.count++;
    this.limits.set(key, record);

    return {
      allowed: true,
      remaining: this.config.maxRequests - record.count,
      resetAt: record.resetAt,
      limit: this.config.maxRequests,
    };
  }

  /**
   * Clean up expired records (call periodically to prevent memory leak)
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.limits.entries()) {
      if (now >= record.resetAt) {
        this.limits.delete(key);
      }
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  reset(key: string): void {
    this.limits.delete(key);
  }

  /**
   * Get current stats
   */
  getStats(): { totalKeys: number; config: RateLimitConfig } {
    return {
      totalKeys: this.limits.size,
      config: this.config,
    };
  }
}

/**
 * Create rate limit response
 */
export function createRateLimitResponse(
  resetAt: number,
  limit: number
): Response {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);

  return new Response(
    JSON.stringify({
      error: "Rate limit exceeded",
      message: "Too many requests. Please try again later.",
      retryAfter,
      limit,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": retryAfter.toString(),
        "X-RateLimit-Limit": limit.toString(),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": new Date(resetAt).toISOString(),
      },
    }
  );
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(
  response: Response,
  result: { remaining: number; resetAt: number; limit: number }
): Response {
  const headers = new Headers(response.headers);
  headers.set("X-RateLimit-Limit", result.limit.toString());
  headers.set("X-RateLimit-Remaining", result.remaining.toString());
  headers.set("X-RateLimit-Reset", new Date(result.resetAt).toISOString());

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Pre-configured rate limiters for different endpoints
export const rateLimiters = {
  telemetry: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100, // 100 requests per minute per client
  }),
  monitoring: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 50, // 50 requests per minute per client
  }),
  monitoringStats: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30, // 30 requests per minute (admin endpoint)
  }),
};

// Note: In Cloudflare Workers, we can't use setInterval at the global scope.
// Memory is automatically cleaned up when Workers are recycled (typically every few minutes).
// For explicit cleanup, call rateLimiters.*.cleanup() manually from a scheduled worker if needed.

