/**
 * retry-provider.test.ts - Unit tests for RetryProvider
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { RetryProvider, DEFAULT_RETRY_CONFIG } from '../../../src/providers/decorators/retry-provider';
import { AIProvider, AIMessage, AIResponse } from '../../../src/providers/base';

// Mock provider
class MockProvider extends AIProvider {
  private callCount = 0;
  private failuresBeforeSuccess: number;

  constructor(failuresBeforeSuccess: number = 0) {
    super();
    this.failuresBeforeSuccess = failuresBeforeSuccess;
  }

  async chat(messages: AIMessage[]): Promise<AIResponse> {
    this.callCount++;
    
    if (this.callCount <= this.failuresBeforeSuccess) {
      const error: any = new Error('Transient failure');
      error.status = 500;
      throw error;
    }

    return {
      content: 'Success',
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

  resetCallCount() {
    this.callCount = 0;
  }

  getCallCount() {
    return this.callCount;
  }
}

describe('RetryProvider', () => {
  describe('chat with retry', () => {
    it('should succeed on first attempt without retrying', async () => {
      const mock = new MockProvider(0);
      const retry = new RetryProvider(mock);

      const response = await retry.chat([{ role: 'user', content: 'test' }]);

      expect(response.content).toBe('Success');
      expect(mock.getCallCount()).toBe(1);
    });

    it('should retry once on transient failure', async () => {
      const mock = new MockProvider(1); // Fail once
      const retry = new RetryProvider(mock);

      const response = await retry.chat([{ role: 'user', content: 'test' }]);

      expect(response.content).toBe('Success');
      expect(mock.getCallCount()).toBe(2); // Initial + 1 retry
    });

    it('should retry twice on multiple failures', async () => {
      const mock = new MockProvider(2); // Fail twice
      const retry = new RetryProvider(mock);

      const response = await retry.chat([{ role: 'user', content: 'test' }]);

      expect(response.content).toBe('Success');
      expect(mock.getCallCount()).toBe(3); // Initial + 2 retries
    });

    it('should fail after max retries', async () => {
      const mock = new MockProvider(10); // Fail many times
      const retry = new RetryProvider(mock, { maxRetries: 2 });

      await expect(
        retry.chat([{ role: 'user', content: 'test' }])
      ).rejects.toThrow('Transient failure');

      expect(mock.getCallCount()).toBe(3); // Initial + 2 retries
    });

    it('should not retry on non-retryable errors', async () => {
      const mock = new MockProvider(0);
      const originalChat = mock.chat.bind(mock);
      mock.chat = async (messages) => {
        await originalChat(messages);
        const error: any = new Error('Bad request');
        error.status = 400; // Non-retryable
        throw error;
      };

      const retry = new RetryProvider(mock);

      await expect(
        retry.chat([{ role: 'user', content: 'test' }])
      ).rejects.toThrow('Bad request');

      expect(mock.getCallCount()).toBe(1); // Initial attempt, no retry
    });
  });

  describe('exponential backoff', () => {
    it('should use exponential backoff delays', () => {
      const mock = new MockProvider();
      const retry = new RetryProvider(mock, {
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        jitterFactor: 0,
      });

      // Access private method via any cast
      const calculateDelay = (retry as any).calculateDelay.bind(retry);

      expect(calculateDelay(0)).toBe(1000);  // 1s
      expect(calculateDelay(1)).toBe(2000);  // 2s
      expect(calculateDelay(2)).toBe(4000);  // 4s
      expect(calculateDelay(3)).toBe(8000);  // 8s
      expect(calculateDelay(4)).toBe(10000); // Capped at max
    });

    it('should apply jitter to delays', () => {
      const mock = new MockProvider();
      const retry = new RetryProvider(mock, {
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        jitterFactor: 0.3,
      });

      const calculateDelay = (retry as any).calculateDelay.bind(retry);
      const delay = calculateDelay(0);

      // Delay should be within ±30% of 1000ms
      expect(delay).toBeGreaterThanOrEqual(700);
      expect(delay).toBeLessThanOrEqual(1300);
    });
  });

  describe('retryable error detection', () => {
    it('should identify rate limit errors as retryable', () => {
      const mock = new MockProvider();
      const retry = new RetryProvider(mock);
      const isRetryable = (retry as any).isRetryable.bind(retry);

      const error = { status: 429, message: 'Rate limit exceeded' };
      expect(isRetryable(error)).toBe(true);
    });

    it('should identify server errors as retryable', () => {
      const mock = new MockProvider();
      const retry = new RetryProvider(mock);
      const isRetryable = (retry as any).isRetryable.bind(retry);

      expect(isRetryable({ status: 500 })).toBe(true);
      expect(isRetryable({ status: 502 })).toBe(true);
      expect(isRetryable({ status: 503 })).toBe(true);
      expect(isRetryable({ status: 504 })).toBe(true);
    });

    it('should identify client errors as non-retryable', () => {
      const mock = new MockProvider();
      const retry = new RetryProvider(mock);
      const isRetryable = (retry as any).isRetryable.bind(retry);

      expect(isRetryable({ status: 400 })).toBe(false);
      expect(isRetryable({ status: 401 })).toBe(false);
      expect(isRetryable({ status: 403 })).toBe(false);
      expect(isRetryable({ status: 404 })).toBe(false);
    });

    it('should identify network errors as retryable', () => {
      const mock = new MockProvider();
      const retry = new RetryProvider(mock);
      const isRetryable = (retry as any).isRetryable.bind(retry);

      expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
      expect(isRetryable({ code: 'ETIMEDOUT' })).toBe(true);
      expect(isRetryable({ code: 'ENOTFOUND' })).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should use default configuration', () => {
      const mock = new MockProvider();
      const retry = new RetryProvider(mock);

      const config = retry.getRetryConfig();

      expect(config.maxRetries).toBe(DEFAULT_RETRY_CONFIG.maxRetries);
      expect(config.baseDelayMs).toBe(DEFAULT_RETRY_CONFIG.baseDelayMs);
      expect(config.maxDelayMs).toBe(DEFAULT_RETRY_CONFIG.maxDelayMs);
    });

    it('should allow custom configuration', () => {
      const mock = new MockProvider();
      const customConfig = {
        maxRetries: 5,
        baseDelayMs: 2000,
      };
      const retry = new RetryProvider(mock, customConfig);

      const config = retry.getRetryConfig();

      expect(config.maxRetries).toBe(5);
      expect(config.baseDelayMs).toBe(2000);
    });
  });
});
