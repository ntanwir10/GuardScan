/**
 * KV-Based Rate Limiter for Cloudflare Workers
 *
 * Persistent rate limiting using Cloudflare KV storage
 * Unlike in-memory rate limiting, this survives Worker restarts and works across multiple Worker instances
 */

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

interface RateLimitRecord {
  count: number;
  resetAt: number; // Timestamp when window resets
}

export class KVRateLimiter {
  private config: RateLimitConfig;
  private kv: KVNamespace | undefined;
  private prefix: string;

  constructor(config: RateLimitConfig, kv: KVNamespace | undefined, prefix: string = 'ratelimit') {
    this.config = config;
    this.kv = kv;
    this.prefix = prefix;
  }

  /**
   * Generate KV key for a client
   */
  private getKey(clientKey: string): string {
    return `${this.prefix}:${clientKey}`;
  }

  /**
   * Check if request is allowed
   * @param key - Unique identifier (e.g., clientId, IP address)
   * @returns { allowed: boolean, remaining: number, resetAt: number, limit: number }
   */
  async check(key: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
    limit: number;
  }> {
    // If KV is not available, fall back to allow all requests
    if (!this.kv) {
      console.warn('KV not available, rate limiting disabled');
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetAt: Date.now() + this.config.windowMs,
        limit: this.config.maxRequests,
      };
    }

    const now = Date.now();
    const kvKey = this.getKey(key);

    try {
      // Get existing record from KV
      const recordJson = await this.kv.get(kvKey);
      let record: RateLimitRecord | null = null;

      if (recordJson) {
        try {
          record = JSON.parse(recordJson);
        } catch (error) {
          console.error('Failed to parse rate limit record:', error);
          record = null;
        }
      }

      // No record or window expired - create new window
      if (!record || now >= record.resetAt) {
        const newRecord: RateLimitRecord = {
          count: 1,
          resetAt: now + this.config.windowMs,
        };

        // Store in KV with TTL
        const ttlSeconds = Math.ceil(this.config.windowMs / 1000);
        await this.kv.put(kvKey, JSON.stringify(newRecord), {
          expirationTtl: ttlSeconds,
        });

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

      // Update KV record
      const ttlSeconds = Math.ceil((record.resetAt - now) / 1000);
      await this.kv.put(kvKey, JSON.stringify(record), {
        expirationTtl: ttlSeconds,
      });

      return {
        allowed: true,
        remaining: this.config.maxRequests - record.count,
        resetAt: record.resetAt,
        limit: this.config.maxRequests,
      };
    } catch (error) {
      console.error('Rate limiter error:', error);
      // On error, allow the request (fail open)
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetAt: Date.now() + this.config.windowMs,
        limit: this.config.maxRequests,
      };
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    if (!this.kv) {
      return;
    }

    const kvKey = this.getKey(key);
    try {
      await this.kv.delete(kvKey);
    } catch (error) {
      console.error('Failed to reset rate limit:', error);
    }
  }

  /**
   * Get current stats (limited functionality with KV)
   * Note: KV doesn't support listing all keys, so we can't get total count
   */
  async getStats(key?: string): Promise<{
    key?: string;
    record?: RateLimitRecord;
    config: RateLimitConfig;
  }> {
    const stats: any = {
      config: this.config,
    };

    if (key && this.kv) {
      try {
        const kvKey = this.getKey(key);
        const recordJson = await this.kv.get(kvKey);
        if (recordJson) {
          stats.key = key;
          stats.record = JSON.parse(recordJson);
        }
      } catch (error) {
        console.error('Failed to get stats:', error);
      }
    }

    return stats;
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

