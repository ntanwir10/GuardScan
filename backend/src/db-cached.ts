/**
 * Cached Database Layer
 * 
 * Extends the base Database class with query result caching using Cloudflare KV
 */

import { Database, Client, TelemetryEvent } from './db';
import { Env } from './index';

// Cache TTL in seconds (5 minutes)
const CACHE_TTL = 300;

/**
 * CachedDatabase - Database wrapper with KV caching
 * 
 * Implements cache-aside pattern:
 * 1. Check cache first
 * 2. On miss, query database
 * 3. Store result in cache
 * 4. Return result
 */
export class CachedDatabase extends Database {
  private cache: KVNamespace | undefined;

  constructor(env: Env) {
    super(env);
    this.cache = env.CACHE;
  }

  /**
   * Generate cache key for query
   */
  private getCacheKey(type: string, params: any): string {
    const paramsString = JSON.stringify(params);
    return `query:${type}:${paramsString}`;
  }

  /**
   * Get client by ID with caching
   */
  async getClient(clientId: string): Promise<Client | null> {
    if (!this.cache) {
      return super.getClient(clientId);
    }

    const cacheKey = this.getCacheKey('client', { clientId });

    try {
      // Try cache first
      const cached = await this.cache.get(cacheKey, 'json');
      if (cached) {
        console.log(`Cache HIT: ${cacheKey}`);
        return cached as Client | null;
      }

      console.log(`Cache MISS: ${cacheKey}`);
    } catch (error) {
      console.error('Cache read error:', error);
    }

    // Query database on cache miss
    const result = await super.getClient(clientId);

    // Store in cache
    if (this.cache) {
      try {
        await this.cache.put(cacheKey, JSON.stringify(result), {
          expirationTtl: CACHE_TTL,
        });
      } catch (error) {
        console.error('Cache write error:', error);
      }
    }

    return result;
  }

  /**
   * Get client statistics with caching
   */
  async getClientStats(clientId: string): Promise<any> {
    if (!this.cache) {
      return super.getClientStats(clientId);
    }

    const cacheKey = this.getCacheKey('client-stats', { clientId });

    try {
      // Try cache first
      const cached = await this.cache.get(cacheKey, 'json');
      if (cached) {
        console.log(`Cache HIT: ${cacheKey}`);
        return cached;
      }

      console.log(`Cache MISS: ${cacheKey}`);
    } catch (error) {
      console.error('Cache read error:', error);
    }

    // Query database on cache miss
    const result = await super.getClientStats(clientId);

    // Store in cache
    if (this.cache) {
      try {
        await this.cache.put(cacheKey, JSON.stringify(result), {
          expirationTtl: CACHE_TTL,
        });
      } catch (error) {
        console.error('Cache write error:', error);
      }
    }

    return result;
  }

  /**
   * Get errors since timestamp with caching
   */
  async getErrorsSince(since: string): Promise<any[]> {
    if (!this.cache) {
      return super.getErrorsSince(since);
    }

    const cacheKey = this.getCacheKey('errors', { since });

    try {
      // Try cache first
      const cached = await this.cache.get(cacheKey, 'json');
      if (cached) {
        console.log(`Cache HIT: ${cacheKey}`);
        return cached as any[];
      }

      console.log(`Cache MISS: ${cacheKey}`);
    } catch (error) {
      console.error('Cache read error:', error);
    }

    // Query database on cache miss
    const result = await super.getErrorsSince(since);

    // Store in cache
    if (this.cache) {
      try {
        await this.cache.put(cacheKey, JSON.stringify(result), {
          expirationTtl: CACHE_TTL,
        });
      } catch (error) {
        console.error('Cache write error:', error);
      }
    }

    return result;
  }

  /**
   * Get metrics since timestamp with caching
   */
  async getMetricsSince(since: string): Promise<any[]> {
    if (!this.cache) {
      return super.getMetricsSince(since);
    }

    const cacheKey = this.getCacheKey('metrics', { since });

    try {
      // Try cache first
      const cached = await this.cache.get(cacheKey, 'json');
      if (cached) {
        console.log(`Cache HIT: ${cacheKey}`);
        return cached as any[];
      }

      console.log(`Cache MISS: ${cacheKey}`);
    } catch (error) {
      console.error('Cache read error:', error);
    }

    // Query database on cache miss
    const result = await super.getMetricsSince(since);

    // Store in cache
    if (this.cache) {
      try {
        await this.cache.put(cacheKey, JSON.stringify(result), {
          expirationTtl: CACHE_TTL,
        });
      } catch (error) {
        console.error('Cache write error:', error);
      }
    }

    return result;
  }

  /**
   * Get usage events since timestamp with caching
   */
  async getUsageEventsSince(since: string): Promise<any[]> {
    if (!this.cache) {
      return super.getUsageEventsSince(since);
    }

    const cacheKey = this.getCacheKey('usage', { since });

    try {
      // Try cache first
      const cached = await this.cache.get(cacheKey, 'json');
      if (cached) {
        console.log(`Cache HIT: ${cacheKey}`);
        return cached as any[];
      }

      console.log(`Cache MISS: ${cacheKey}`);
    } catch (error) {
      console.error('Cache read error:', error);
    }

    // Query database on cache miss
    const result = await super.getUsageEventsSince(since);

    // Store in cache
    if (this.cache) {
      try {
        await this.cache.put(cacheKey, JSON.stringify(result), {
          expirationTtl: CACHE_TTL,
        });
      } catch (error) {
        console.error('Cache write error:', error);
      }
    }

    return result;
  }

  /**
   * Invalidate cache for a specific key or pattern
   */
  async invalidateCache(pattern?: string): Promise<void> {
    if (!this.cache) {
      return;
    }

    // Note: KV doesn't support pattern-based deletion
    // For production, consider using a cache invalidation strategy
    // like versioned keys or short TTLs
    console.log('Cache invalidation requested:', pattern);
  }
}

