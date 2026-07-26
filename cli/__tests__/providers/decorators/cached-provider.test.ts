/**
 * cached-provider.test.ts - Unit tests for CachedProvider
 */

import { afterEach, describe, expect, it, beforeEach } from '@jest/globals';
import { CachedProvider } from '../../../src/providers/decorators/cached-provider';
import { AIProvider, AIMessage, AIResponse } from '../../../src/providers/base';

// Mock provider
class MockProvider extends AIProvider {
  private callCount = 0;
  private embeddingCallCount = 0;
  private streamCallCount = 0;

  async chat(messages: AIMessage[]): Promise<AIResponse> {
    this.callCount++;
    return {
      content: `Response ${this.callCount}`,
      model: 'mock',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    };
  }

  async *stream(): AsyncGenerator<string> {
    this.streamCallCount++;
    yield 'test';
  }

  async generateEmbedding(): Promise<number[]> {
    this.embeddingCallCount++;
    return [1, 0, 0];
  }

  isAvailable(): boolean {
    return true;
  }

  getName(): string {
    return 'Mock';
  }

  async testConnection(): Promise<boolean> {
    return true;
  }

  getCapabilities() {
    return {
      supportsChat: true,
      supportsEmbeddings: false,
      supportsStreaming: false,
      maxContextTokens: 4000,
    };
  }

  getCallCount() {
    return this.callCount;
  }

  resetCallCount() {
    this.callCount = 0;
  }

  getEmbeddingCallCount() {
    return this.embeddingCallCount;
  }

  getStreamCallCount() {
    return this.streamCallCount;
  }
}

const originalNoCache = process.env.GUARDSCAN_NO_CACHE;

describe('CachedProvider', () => {
  beforeEach(async () => {
    delete process.env.GUARDSCAN_NO_CACHE;
    const mock = new MockProvider();
    const cached = new CachedProvider(mock, 'test-repo');
    await cached.clearCache();
  });

  afterEach(() => {
    if (originalNoCache === undefined) {
      delete process.env.GUARDSCAN_NO_CACHE;
    } else {
      process.env.GUARDSCAN_NO_CACHE = originalNoCache;
    }
  });
  describe('cache hits and misses', () => {
    it('should cache responses', async () => {
      const mock = new MockProvider();
      const cached = new CachedProvider(mock, 'test-repo');

      // First call - should miss cache
      const response1 = await cached.chat([{ role: 'user', content: 'test' }]);
      expect(response1.content).toBe('Response 1');
      expect(mock.getCallCount()).toBe(1);

      // Second call with same prompt - should hit cache
      const response2 = await cached.chat([{ role: 'user', content: 'test' }]);
      expect(response2.content).toBe('Response 1'); // Same cached response
      expect(response2.model).toContain('cached');
      expect(mock.getCallCount()).toBe(1); // No additional call
    });

    it('should miss cache for different prompts', async () => {
      const mock = new MockProvider();
      const cached = new CachedProvider(mock, 'test-repo');

      await cached.chat([{ role: 'user', content: 'test1' }]);
      await cached.chat([{ role: 'user', content: 'test2' }]);

      expect(mock.getCallCount()).toBe(2);
    });

    it('should differentiate by model', async () => {
      const mock = new MockProvider();
      const cached = new CachedProvider(mock, 'test-repo');

      await cached.chat([{ role: 'user', content: 'test' }], { model: 'model1' });
      await cached.chat([{ role: 'user', content: 'test' }], { model: 'model2' });

      expect(mock.getCallCount()).toBe(2); // Different models = different cache entries
    });
  });

  describe('cache statistics', () => {
    it('should track cache hits and misses', async () => {
      const mock = new MockProvider();
      const cached = new CachedProvider(mock, 'test-repo');

      // Miss
      await cached.chat([{ role: 'user', content: 'test1' }]);

      // Hit
      await cached.chat([{ role: 'user', content: 'test1' }]);

      // Miss
      await cached.chat([{ role: 'user', content: 'test2' }]);

      const stats = cached.getCacheStats();

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBeCloseTo(33.33, 1);
    });
  });

  describe('cache clearing', () => {
    it('should clear cache', async () => {
      const mock = new MockProvider();
      const cached = new CachedProvider(mock, 'test-repo');

      // Add to cache
      await cached.chat([{ role: 'user', content: 'test' }]);

      // Clear
      await cached.clearCache();

      // Next call should miss cache
      await cached.chat([{ role: 'user', content: 'test' }]);

      expect(mock.getCallCount()).toBe(2);
    });
  });

  describe('cache bypass when disabled', () => {
    it.each([
      ['configuration', false, undefined],
      ['GUARDSCAN_NO_CACHE', true, 'true'],
    ])(
      'fully bypasses exact and semantic caching when disabled by %s',
      async (_source, configuredEnabled, environmentValue) => {
      if (environmentValue) {
        process.env.GUARDSCAN_NO_CACHE = environmentValue;
      }
      const mock = new MockProvider();
      const cached = new CachedProvider(mock, 'test-repo', mock, {
        enabled: configuredEnabled,
        useSemanticSimilarity: true,
      });

      await cached.chat([{ role: 'user', content: 'test' }]);
      await cached.chat([{ role: 'user', content: 'test' }]);
      for await (const _chunk of cached.stream([{ role: 'user', content: 'stream' }])) {
        // Drain the stream; disabled caching must not store the response.
      }

      expect(mock.getCallCount()).toBe(2);
      expect(mock.getStreamCallCount()).toBe(1);
      expect(mock.getEmbeddingCallCount()).toBe(0);
      expect(cached.getCacheStats()).toEqual({
        hits: 0,
        misses: 0,
        totalEntries: 0,
        totalSize: 0,
        hitRate: 0,
      });
      expect((cached as any).cache).toBeUndefined();
      expect((cached as any).semanticCache).toBeUndefined();
    });
  });
});
