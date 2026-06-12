/**
 * observable-provider.test.ts - Unit tests for ObservableProvider
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ObservableProvider } from '../../../src/providers/decorators/observable-provider';
import { MetricsCollector } from '../../../src/core/metrics-collector';
import { AIProvider, AIMessage, AIResponse } from '../../../src/providers/base';

// Mock provider
class MockProvider extends AIProvider {
  private shouldFail = false;

  async chat(messages: AIMessage[]): Promise<AIResponse> {
    if (this.shouldFail) {
      throw new Error('Test error');
    }

    return {
      content: 'Success',
      model: 'mock',
      usage: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
    };
  }

  async *stream(): AsyncGenerator<string> {
    if (this.shouldFail) {
      throw new Error('Test error');
    }
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

  setShouldFail(fail: boolean) {
    this.shouldFail = fail;
  }

  countMessagesTokens(): number {
    return 10;
  }

  getPricing() {
    return {
      chat: {
        input: 0.01,
        output: 0.02,
      },
    };
  }
}

describe('ObservableProvider', () => {
  const repoId = () => `test-obs-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  describe('span recording', () => {
    it('should record successful spans', async () => {
      const mock = new MockProvider();
      const metrics = new MetricsCollector(repoId(), false);
      const observable = new ObservableProvider(mock, metrics);

      await observable.chat([{ role: 'user', content: 'test' }]);

      const spans = metrics.getSpans();
      expect(spans.length).toBe(1);

      const span = spans[0];
      expect(span.success).toBe(true);
      expect(span.provider).toBe('Mock');
      expect(span.operation).toBe('chat');
      expect(span.tokens?.total).toBe(25);
    });

    it('should record failed spans', async () => {
      const mock = new MockProvider();
      mock.setShouldFail(true);
      
      const metrics = new MetricsCollector(repoId(), false);
      const observable = new ObservableProvider(mock, metrics);

      try {
        await observable.chat([{ role: 'user', content: 'test' }]);
      } catch {}

      const spans = metrics.getSpans();
      expect(spans.length).toBe(1);

      const span = spans[0];
      expect(span.success).toBe(false);
      expect(span.error).toBe('Test error');
      expect(span.errorType).toBeDefined();
    });

    it('should record latency', async () => {
      const mock = new MockProvider();
      const metrics = new MetricsCollector(repoId(), false);
      const observable = new ObservableProvider(mock, metrics);

      await observable.chat([{ role: 'user', content: 'test' }]);

      const spans = metrics.getSpans();
      const span = spans[0];

      expect(span.latency).toBeGreaterThanOrEqual(0);
      expect(span.endTime).toBeGreaterThanOrEqual(span.startTime);
    });

    it('should detect cache hits', async () => {
      const mock = new MockProvider();
      mock.chat = async () => ({
        content: 'test',
        model: 'mock (cached)',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });

      const metrics = new MetricsCollector(repoId(), false);
      const observable = new ObservableProvider(mock, metrics);

      await observable.chat([{ role: 'user', content: 'test' }]);

      const spans = metrics.getSpans();
      const span = spans[0];

      expect(span.cacheHit).toBe(true);
    });
  });

  describe('metrics aggregation', () => {
    it('should aggregate metrics correctly', async () => {
      const mock = new MockProvider();
      const metrics = new MetricsCollector(repoId(), false);
      const observable = new ObservableProvider(mock, metrics);

      // Make multiple successful calls
      await observable.chat([{ role: 'user', content: 'test1' }]);
      await observable.chat([{ role: 'user', content: 'test2' }]);

      // Make a failed call
      mock.setShouldFail(true);
      try {
        await observable.chat([{ role: 'user', content: 'test3' }]);
      } catch {}

      const aggregated = observable.getMetrics();

      expect(aggregated.totalCalls).toBe(3);
      expect(aggregated.successRate).toBeCloseTo(66.67, 1);
      expect(aggregated.totalTokens).toBe(50); // 2 successful calls × 25 tokens
    });
  });

  describe('configuration', () => {
    it('should bypass observability when disabled', async () => {
      const mock = new MockProvider();
      const metrics = new MetricsCollector(repoId(), false);
      const observable = new ObservableProvider(mock, metrics, {
        enabled: false,
      });

      await observable.chat([{ role: 'user', content: 'test' }]);

      // Should not record spans when disabled
      const spans = metrics.getSpans();
      expect(spans.length).toBe(0);
    });
  });
});
