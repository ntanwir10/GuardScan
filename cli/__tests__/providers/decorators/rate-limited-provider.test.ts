/**
 * rate-limited-provider.test.ts - Unit tests for RateLimitedProvider
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  RateLimitedProvider,
  DEFAULT_RATE_LIMIT_CONFIG,
  PROVIDER_RATE_LIMITS,
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

  describe('DEFAULT_RATE_LIMIT_CONFIG', () => {
    it('should export valid default rate limit config', () => {
      expect(DEFAULT_RATE_LIMIT_CONFIG.maxTokens).toBeGreaterThan(0);
      expect(DEFAULT_RATE_LIMIT_CONFIG.refillRate).toBeGreaterThan(0);
      expect(DEFAULT_RATE_LIMIT_CONFIG.costMultiplier).toBe(1.0);
    });
  });

  describe('PROVIDER_RATE_LIMITS', () => {
    it('should contain configs for known providers', () => {
      expect(PROVIDER_RATE_LIMITS).toHaveProperty('openai');
      expect(PROVIDER_RATE_LIMITS).toHaveProperty('claude');
      expect(PROVIDER_RATE_LIMITS).toHaveProperty('gemini');
      expect(PROVIDER_RATE_LIMITS).toHaveProperty('ollama');
    });

    it('each provider config should have required fields', () => {
      for (const [providerName, cfg] of Object.entries(PROVIDER_RATE_LIMITS)) {
        expect(typeof cfg.maxTokens).toBe('number');
        expect(typeof cfg.refillRate).toBe('number');
        expect(typeof cfg.costMultiplier).toBe('number');
        expect(cfg.maxTokens).toBeGreaterThan(0);
        expect(cfg.refillRate).toBeGreaterThan(0);
      }
    });
  });

  describe('request exceeds bucket size', () => {
    it('should throw when estimated tokens exceed maxTokens', async () => {
      class HighTokenMockProvider extends MockProvider {
        countMessagesTokens(): number {
          return 99999999; // larger than any reasonable bucket
        }
        getName() { return 'Mock'; }
      }
      const mock = new HighTokenMockProvider();
      const rateLimited = new RateLimitedProvider(mock, {
        maxTokens: 1000,
        refillRate: 100,
        costMultiplier: 1.0,
      });

      await expect(
        rateLimited.chat([{ role: 'user', content: 'test' }])
      ).rejects.toThrow(/exceeds the maximum bucket size/);
    });
  });

  describe('costMultiplier effect', () => {
    it('should consume more tokens when costMultiplier > 1', async () => {
      const mock = new MockProvider();
      // With multiplier 2, the 1000 fixed tokens become 2000
      const rateLimitedNormal = new RateLimitedProvider(mock, {
        maxTokens: 10000,
        refillRate: 1000,
        costMultiplier: 1.0,
      });
      const rateLimitedDoubled = new RateLimitedProvider(mock, {
        maxTokens: 10000,
        refillRate: 1000,
        costMultiplier: 2.0,
      });

      await rateLimitedNormal.chat([{ role: 'user', content: 'test' }]);
      await rateLimitedDoubled.chat([{ role: 'user', content: 'test' }]);

      const tokensNormal = await rateLimitedNormal.getCurrentTokens();
      const tokensDoubled = await rateLimitedDoubled.getCurrentTokens();

      // With double cost multiplier, more tokens should have been consumed
      expect(tokensDoubled).toBeLessThan(tokensNormal);
    });
  });
});
