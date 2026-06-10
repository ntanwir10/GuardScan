/**
 * rate-limited-provider.test.ts - Unit tests for RateLimitedProvider
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  RateLimitedProvider,
  DEFAULT_RATE_LIMIT_CONFIG,
} from '../../../src/providers/decorators/rate-limited-provider';
import { AIProvider, AIMessage, AIResponse } from '../../../src/providers/base';

// Mock provider
class MockProvider extends AIProvider {
  private callTimes: number[] = [];

  async chat(messages: AIMessage[]): Promise<AIResponse> {
    this.callTimes.push(Date.now());
    return {
      content: 'Success',
      model: 'mock',
    };
  }

  async *stream(): AsyncGenerator<string> {
    this.callTimes.push(Date.now());
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

  countMessagesTokens(messages: AIMessage[]): number {
    return 1000; // Fixed for testing
  }

  getCallTimes() {
    return this.callTimes;
  }

  resetCallTimes() {
    this.callTimes = [];
  }
}

describe('RateLimitedProvider', () => {
  describe('token bucket algorithm', () => {
    it('should allow requests when tokens are available', async () => {
      const mock = new MockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 10000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      const response = await rateLimited.chat([{ role: 'user', content: 'test' }]);

      expect(response.content).toBe('Success');
      expect(await rateLimited.getCurrentTokens()).toBeLessThan(10000);
    });

    it('should wait when insufficient tokens', async () => {
      const mock = new MockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 1000,  // Small bucket
        refillRate: 1000, // 1000 tokens/second
        costMultiplier: 1.0,
      });

      const startTime = Date.now();

      // First request consumes 500 tokens (full bucket)
      await rateLimited.chat([{ role: 'user', content: 'test' }]);

      // Second request needs to wait for refill
      await rateLimited.chat([{ role: 'user', content: 'test' }]);

      const elapsed = Date.now() - startTime;

      // Should have waited at least 500ms (500 tokens / 1000 tokens per second)
      expect(elapsed).toBeGreaterThanOrEqual(900); // Wait ~1s for 1000 tokens
    });

    it('should refill tokens over time', async () => {
      const mock = new MockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 10000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      // Consume some tokens
      await rateLimited.chat([{ role: 'user', content: 'test' }]);
      const tokensAfterFirst = await rateLimited.getCurrentTokens();

      // Wait for refill
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const tokensAfterWait = await rateLimited.getCurrentTokens();

      // Should have refilled ~1000 tokens
      expect(tokensAfterWait).toBeGreaterThan(tokensAfterFirst);
    });

    it('should not exceed max tokens', async () => {
      const mock = new MockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 5000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      // Wait to ensure full refill
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const tokens = await rateLimited.getCurrentTokens();

      // Should not exceed max
      expect(tokens).toBeLessThanOrEqual(5000);
    });
  });

  describe('statistics', () => {
    it('should track wait statistics', async () => {
      const mock = new MockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 1000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      // Consume all tokens
      await rateLimited.chat([{ role: 'user', content: 'test' }]);

      // Force wait
      await rateLimited.chat([{ role: 'user', content: 'test' }]);

      const stats = rateLimited.getStats();

      expect(stats.totalWaits).toBeGreaterThan(0);
      expect(stats.totalWaitTimeMs).toBeGreaterThan(0);
    });

    it('should calculate utilization', async () => {
      const mock = new MockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 10000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      const statsBefore = rateLimited.getStats();
      expect(statsBefore.utilizationPercent).toBe(0);

      await rateLimited.chat([{ role: 'user', content: 'test' }]);

      const statsAfter = rateLimited.getStats();
      expect(statsAfter.utilizationPercent).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    it('should reset to full capacity', async () => {
      const mock = new MockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 10000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      // Consume tokens
      await rateLimited.chat([{ role: 'user', content: 'test' }]);

      const tokensBefore = await rateLimited.getCurrentTokens();
      expect(tokensBefore).toBeLessThan(10000);

      // Reset
      rateLimited.reset();

      const tokensAfter = await rateLimited.getCurrentTokens();
      expect(tokensAfter).toBe(10000);
    });
  });
});

// ---- Additional edge-case tests for rate-limited-provider.ts ----

// Provider that supports embeddings for embedding rate limit tests
class EmbeddingMockProvider extends AIProvider {
  async chat(messages: AIMessage[]): Promise<AIResponse> {
    return { content: 'ok', model: 'mock' };
  }

  async *stream(): AsyncGenerator<string> {
    yield 'ok';
  }

  async generateEmbedding(_text: string, _model?: string): Promise<number[]> {
    return [0.1, 0.2, 0.3];
  }

  async generateBulkEmbeddings(texts: string[], _model?: string): Promise<number[][]> {
    return texts.map(() => [0.1, 0.2, 0.3]);
  }

  isAvailable(): boolean { return true; }
  getName(): string { return 'EmbeddingMock'; }
  async testConnection(): Promise<boolean> { return true; }

  getCapabilities() {
    return {
      supportsChat: true,
      supportsEmbeddings: true,
      supportsStreaming: true,
      maxContextTokens: 4000,
    };
  }

  countMessagesTokens(_messages: AIMessage[]): number { return 500; }
  countTokens(_text: string): number { return 200; }
}

// Named provider for testing provider-specific rate limit selection
class OpenAIMockProvider extends AIProvider {
  async chat(messages: AIMessage[]): Promise<AIResponse> {
    return { content: 'openai response', model: 'gpt-4o' };
  }

  async *stream(): AsyncGenerator<string> { yield 'ok'; }

  isAvailable(): boolean { return true; }
  getName(): string { return 'openai'; }
  async testConnection(): Promise<boolean> { return true; }

  getCapabilities() {
    return {
      supportsChat: true,
      supportsEmbeddings: false,
      supportsStreaming: true,
      maxContextTokens: 128000,
    };
  }

  countMessagesTokens(_messages: AIMessage[]): number { return 500; }
}

class OllamaMockProvider extends AIProvider {
  async chat(messages: AIMessage[]): Promise<AIResponse> {
    return { content: 'ollama response', model: 'llama3' };
  }

  async *stream(): AsyncGenerator<string> { yield 'ok'; }

  isAvailable(): boolean { return true; }
  getName(): string { return 'ollama'; }
  async testConnection(): Promise<boolean> { return true; }

  getCapabilities() {
    return {
      supportsChat: true,
      supportsEmbeddings: false,
      supportsStreaming: true,
      maxContextTokens: 4000,
    };
  }

  countMessagesTokens(_messages: AIMessage[]): number { return 500; }
}

import {
  PROVIDER_RATE_LIMITS,
} from '../../../src/providers/decorators/rate-limited-provider';

describe('RateLimitedProvider – edge cases', () => {
  describe('request cost exceeds bucket capacity', () => {
    it('should throw when estimated token cost exceeds maxTokens', async () => {
      // MockProvider.countMessagesTokens returns 1000
      const mock = new MockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 500,   // smaller than estimated cost of 1000
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      await expect(
        rateLimited.chat([{ role: 'user', content: 'test' }])
      ).rejects.toThrow(/exceeds the maximum bucket size/);
    });

    it('should include the cost and max in the error message', async () => {
      const mock = new MockProvider(); // countMessagesTokens returns 1000
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 499,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      await expect(
        rateLimited.chat([{ role: 'user', content: 'hi' }])
      ).rejects.toThrow(/499/);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the current configuration', () => {
      const mock = new MockProvider();
      const config = { maxTokens: 8000, refillRate: 500, costMultiplier: 2.0 };
      const rateLimited = new RateLimitedProvider(mock, config);

      const retrieved = rateLimited.getConfig();

      expect(retrieved.maxTokens).toBe(8000);
      expect(retrieved.refillRate).toBe(500);
      expect(retrieved.costMultiplier).toBe(2.0);
    });

    it('should return an independent copy (mutation-safe)', () => {
      const mock = new MockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 10000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      const config1 = rateLimited.getConfig();
      config1.maxTokens = 99999; // mutate the returned copy

      const config2 = rateLimited.getConfig();
      expect(config2.maxTokens).toBe(10000); // should not be affected
    });
  });

  describe('costMultiplier', () => {
    it('should apply costMultiplier to token consumption', async () => {
      const mock = new MockProvider(); // countMessagesTokens = 1000
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 3000,
        refillRate: 1000,
        costMultiplier: 2.0, // doubles the cost → 2000 tokens consumed
      });

      await rateLimited.chat([{ role: 'user', content: 'test' }]);

      const remaining = await rateLimited.getCurrentTokens();
      // Should have consumed 2000 tokens (1000 * 2.0)
      expect(remaining).toBeLessThanOrEqual(1000);
    });

    it('should throw when multiplied cost exceeds maxTokens', async () => {
      const mock = new MockProvider(); // countMessagesTokens = 1000
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 1500,
        refillRate: 1000,
        costMultiplier: 2.0, // cost becomes 2000, which exceeds 1500
      });

      await expect(
        rateLimited.chat([{ role: 'user', content: 'test' }])
      ).rejects.toThrow(/exceeds the maximum bucket size/);
    });
  });

  describe('provider-specific rate limit configs', () => {
    it('should use openai-specific config when provider is openai', () => {
      const mock = new OpenAIMockProvider();
      const rateLimited = new RateLimitedProvider(mock);

      const config = rateLimited.getConfig();
      expect(config.maxTokens).toBe(PROVIDER_RATE_LIMITS['openai'].maxTokens);
      expect(config.refillRate).toBe(PROVIDER_RATE_LIMITS['openai'].refillRate);
    });

    it('should use ollama-specific config when provider is ollama', () => {
      const mock = new OllamaMockProvider();
      const rateLimited = new RateLimitedProvider(mock);

      const config = rateLimited.getConfig();
      expect(config.maxTokens).toBe(PROVIDER_RATE_LIMITS['ollama'].maxTokens);
    });

    it('should allow overriding provider-specific config', () => {
      const mock = new OpenAIMockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 50000,  // override
      });

      const config = rateLimited.getConfig();
      expect(config.maxTokens).toBe(50000);
      // refillRate should still come from openai defaults
      expect(config.refillRate).toBe(PROVIDER_RATE_LIMITS['openai'].refillRate);
    });

    it('should fall back to DEFAULT_RATE_LIMIT_CONFIG for unknown provider', () => {
      const mock = new MockProvider(); // getName() returns 'Mock' (not in PROVIDER_RATE_LIMITS)
      const rateLimited = new RateLimitedProvider(mock);

      const config = rateLimited.getConfig();
      expect(config.maxTokens).toBe(DEFAULT_RATE_LIMIT_CONFIG.maxTokens);
      expect(config.refillRate).toBe(DEFAULT_RATE_LIMIT_CONFIG.refillRate);
    });
  });

  describe('PROVIDER_RATE_LIMITS constants', () => {
    it('should define rate limits for openai', () => {
      expect(PROVIDER_RATE_LIMITS['openai']).toBeDefined();
      expect(PROVIDER_RATE_LIMITS['openai'].maxTokens).toBeGreaterThan(0);
      expect(PROVIDER_RATE_LIMITS['openai'].refillRate).toBeGreaterThan(0);
    });

    it('should define rate limits for claude', () => {
      expect(PROVIDER_RATE_LIMITS['claude']).toBeDefined();
      expect(PROVIDER_RATE_LIMITS['claude'].maxTokens).toBeGreaterThan(0);
    });

    it('should define rate limits for gemini', () => {
      expect(PROVIDER_RATE_LIMITS['gemini']).toBeDefined();
      expect(PROVIDER_RATE_LIMITS['gemini'].maxTokens).toBeGreaterThan(0);
    });

    it('should define rate limits for ollama with very large bucket', () => {
      expect(PROVIDER_RATE_LIMITS['ollama']).toBeDefined();
      // ollama is local, so it should have a very large bucket
      expect(PROVIDER_RATE_LIMITS['ollama'].maxTokens).toBeGreaterThan(
        PROVIDER_RATE_LIMITS['openai'].maxTokens
      );
    });
  });

  describe('DEFAULT_RATE_LIMIT_CONFIG', () => {
    it('should have sensible default values', () => {
      expect(DEFAULT_RATE_LIMIT_CONFIG.maxTokens).toBeGreaterThan(0);
      expect(DEFAULT_RATE_LIMIT_CONFIG.refillRate).toBeGreaterThan(0);
      expect(DEFAULT_RATE_LIMIT_CONFIG.costMultiplier).toBe(1.0);
    });
  });

  describe('generateEmbedding rate limiting', () => {
    it('should apply rate limiting to embedding generation', async () => {
      const mock = new EmbeddingMockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 10000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      const embedding = await rateLimited.generateEmbedding('test text');

      expect(embedding).toEqual([0.1, 0.2, 0.3]);
      const tokens = await rateLimited.getCurrentTokens();
      expect(tokens).toBeLessThan(10000); // tokens were consumed
    });
  });

  describe('generateBulkEmbeddings rate limiting', () => {
    it('should apply rate limiting to bulk embedding generation', async () => {
      const mock = new EmbeddingMockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 10000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      const embeddings = await rateLimited.generateBulkEmbeddings(['text1', 'text2']);

      expect(embeddings).toHaveLength(2);
      const tokens = await rateLimited.getCurrentTokens();
      expect(tokens).toBeLessThan(10000); // tokens were consumed
    });
  });

  describe('getStats structure', () => {
    it('should return all required stat fields', async () => {
      const mock = new MockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 10000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      const stats = rateLimited.getStats();

      expect(stats).toHaveProperty('currentTokens');
      expect(stats).toHaveProperty('maxTokens');
      expect(stats).toHaveProperty('refillRate');
      expect(stats).toHaveProperty('utilizationPercent');
      expect(stats).toHaveProperty('totalWaits');
      expect(stats).toHaveProperty('totalWaitTimeMs');
      expect(stats).toHaveProperty('lastRefillTime');
    });

    it('should show zero waits on fresh provider', () => {
      const mock = new MockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 10000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      const stats = rateLimited.getStats();
      expect(stats.totalWaits).toBe(0);
      expect(stats.totalWaitTimeMs).toBe(0);
    });

    it('should reset wait statistics on reset()', async () => {
      const mock = new MockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 1000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });

      // Force a wait to accumulate stats
      await rateLimited.chat([{ role: 'user', content: 'test' }]);
      await rateLimited.chat([{ role: 'user', content: 'test' }]);

      const statsBefore = rateLimited.getStats();
      expect(statsBefore.totalWaits).toBeGreaterThan(0);

      rateLimited.reset();

      const statsAfter = rateLimited.getStats();
      expect(statsAfter.totalWaits).toBe(0);
      expect(statsAfter.totalWaitTimeMs).toBe(0);
    });
  });
});
