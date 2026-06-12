/**
 * cached-provider.test.ts - Unit tests for CachedProvider
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { CachedProvider } from '../../../src/providers/decorators/cached-provider';
import { AIProvider, AIMessage, AIResponse } from '../../../src/providers/base';

// Mock provider
class MockProvider extends AIProvider {
  private callCount = 0;

  async chat(messages: AIMessage[]): Promise<AIResponse> {
    this.callCount++;
    return {
      content: `Response ${this.callCount}`,
      model: 'mock',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    };
  }

  async *stream(): AsyncGenerator<string> {
    yield 'test';
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
}

describe('CachedProvider', () => {
  beforeEach(async () => {
    const mock = new MockProvider();
    const cached = new CachedProvider(mock, 'test-repo');
    await cached.clearCache();
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
    it('should bypass cache when disabled', async () => {
      const mock = new MockProvider();
      const cached = new CachedProvider(mock, 'test-repo', undefined, {
        enabled: false,
      });

      await cached.chat([{ role: 'user', content: 'test' }]);
      await cached.chat([{ role: 'user', content: 'test' }]);

      // Should call provider twice (no caching)
      expect(mock.getCallCount()).toBe(2);
    });
  });
});
