/**
 * ai-providers-enhanced.test.ts - Integration tests for enhanced AI providers
 * 
 * Tests the full decorator stack and end-to-end scenarios.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ProviderFactory } from '../../src/providers/factory';
import { AIProvider, AIMessage } from '../../src/providers/base';
import { MetricsCollector } from '../../src/core/metrics-collector';
import { Config } from '../../src/core/config';
import { RetryProvider } from '../../src/providers/decorators/retry-provider';
import {
  CircuitBreakerProvider,
  CircuitState,
} from '../../src/providers/decorators/circuit-breaker-provider';
import { CachedProvider } from '../../src/providers/decorators/cached-provider';
import { RateLimitedProvider } from '../../src/providers/decorators/rate-limited-provider';
import { ObservableProvider } from '../../src/providers/decorators/observable-provider';

// Mock provider for testing
class TestProvider extends AIProvider {
  private failureCount = 0;
  private maxFailures: number;
  private callCount = 0;
  private providerName: string;

  constructor(maxFailures: number = 0, providerName: string = 'Test') {
    super();
    this.maxFailures = maxFailures;
    this.providerName = providerName;
  }

  async chat(messages: AIMessage[]) {
    this.callCount++;
    
    if (this.failureCount < this.maxFailures) {
      this.failureCount++;
      const error: any = new Error('Transient failure');
      error.status = 500;
      throw error;
    }

    return {
      content: 'Success',
      model: 'test',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    };
  }

  async *stream(messages: AIMessage[]) {
    this.callCount++;

    if (this.failureCount < this.maxFailures) {
      this.failureCount++;
      const error: any = new Error('Transient failure');
      error.status = 500;
      throw error;
    }
    yield 'test';
  }

  isAvailable() {
    return true;
  }

  getName() {
    return this.providerName;
  }

  async testConnection() {
    return true;
  }

  getCapabilities() {
    return {
      supportsChat: true,
      supportsEmbeddings: false,
      supportsStreaming: true,
      maxContextTokens: 4000,
    };
  }

  getCallCount() {
    return this.callCount;
  }
}

describe('Enhanced AI Provider Integration', () => {
  const uniqueId = (prefix: string) => (
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const messages: AIMessage[] = [{ role: 'user', content: 'Explain this code path.' }];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('decorator stack', () => {
    it('should create provider with all decorators', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      const enhanced = ProviderFactory.createEnhanced('openai', {
        config,
        apiKey: 'test-key',
        repoId: 'test-repo',
        enableRetry: true,
        enableCache: true,
        enableCircuitBreaker: true,
        enableRateLimit: false,
        enableObservability: true,
      });

      expect(enhanced).toBeDefined();
      expect(enhanced.getName()).toBeDefined();
    });

    it('should work with partial decorator stack', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'gemini',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      const enhanced = ProviderFactory.createEnhanced('gemini', {
        config,
        apiKey: 'test-key',
        repoId: 'test-repo',
        enableRetry: true,
        enableCache: false,
        enableCircuitBreaker: false,
        enableRateLimit: false,
        enableObservability: false,
      });

      expect(enhanced).toBeDefined();
    });
  });

  describe('retry with circuit breaker', () => {
    it('should retry failures and track in circuit breaker', async () => {
      const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const base = new TestProvider(1, uniqueId('retry-circuit'));
      const retry = new RetryProvider(base, {
        maxRetries: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterFactor: 0,
      });
      const circuit = new CircuitBreakerProvider(retry, {
        failureThreshold: 1,
        resetTimeoutMs: 60_000,
        halfOpenSuccessThreshold: 1,
        monitoredErrors: ['500'],
      });

      await expect(circuit.chat(messages)).resolves.toMatchObject({ content: 'Success' });
      expect(base.getCallCount()).toBe(2);
      expect(circuit.getState()).toBe(CircuitState.CLOSED);
      expect(circuit.getStats()).toMatchObject({
        totalFailures: 0,
        totalSuccesses: 1,
        circuitOpenCount: 0,
      });
      expect(warning).toHaveBeenCalledTimes(1);
    });
  });

  describe('caching with observability', () => {
    it('should track cache hits in metrics', async () => {
      const id = uniqueId('cache-observability');
      const base = new TestProvider(0, id);
      const cached = new CachedProvider(base, id, undefined, {
        useSemanticSimilarity: false,
      });
      const metrics = new MetricsCollector(id);
      const observable = new ObservableProvider(cached, metrics);

      const first = await observable.chat(messages);
      const second = await observable.chat(messages);

      expect(first.content).toBe('Success');
      expect(second.model).toContain('cached');
      expect(base.getCallCount()).toBe(1);
      expect(cached.getCacheStats()).toMatchObject({ hits: 1, misses: 1 });
      expect(metrics.getMetrics()).toMatchObject({
        totalCalls: 2,
        successRate: 100,
        cacheHitRate: 50,
      });
      expect(metrics.getSpans().map(span => span.cacheHit)).toEqual([false, true]);

      await cached.clearCache();
    });
  });

  describe('rate limiting with retry', () => {
    it('should rate limit and retry on failures', async () => {
      const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const base = new TestProvider(1, uniqueId('rate-retry'));
      const retry = new RetryProvider(base, {
        maxRetries: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterFactor: 0,
      });
      const rateLimited = new RateLimitedProvider(retry, {
        maxTokens: 100,
        refillRate: 1,
        costMultiplier: 1,
      });

      await expect(rateLimited.chat(messages)).resolves.toMatchObject({ content: 'Success' });
      expect(base.getCallCount()).toBe(2);
      expect(rateLimited.getStats()).toMatchObject({
        maxTokens: 100,
        totalWaits: 0,
      });
      expect(rateLimited.getStats().currentTokens).toBeLessThan(100);
      expect(warning).toHaveBeenCalledTimes(1);
    });
  });

  describe('full stack end-to-end', () => {
    it('should handle complex scenario with all features', async () => {
      const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const id = uniqueId('full-stack');
      const base = new TestProvider(1, id);
      const retry = new RetryProvider(base, {
        maxRetries: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterFactor: 0,
      });
      const rateLimited = new RateLimitedProvider(retry, {
        maxTokens: 1_000,
        refillRate: 1,
        costMultiplier: 1,
      });
      const circuit = new CircuitBreakerProvider(rateLimited, {
        failureThreshold: 1,
        resetTimeoutMs: 60_000,
        halfOpenSuccessThreshold: 1,
        monitoredErrors: ['500'],
      });
      const cached = new CachedProvider(circuit, id, undefined, {
        useSemanticSimilarity: false,
      });
      const metrics = new MetricsCollector(id);
      const enhanced = new ObservableProvider(cached, metrics);

      const first = await enhanced.chat(messages);
      const second = await enhanced.chat(messages);

      expect(first.content).toBe('Success');
      expect(second.model).toContain('cached');
      expect(base.getCallCount()).toBe(2);
      expect(rateLimited.getStats().currentTokens).toBeLessThan(1_000);
      expect(circuit.getStats()).toMatchObject({
        state: CircuitState.CLOSED,
        totalFailures: 0,
        totalSuccesses: 1,
      });
      expect(cached.getCacheStats()).toMatchObject({ hits: 1, misses: 1 });
      expect(metrics.getMetrics()).toMatchObject({
        totalCalls: 2,
        successRate: 100,
        cacheHitRate: 50,
      });
      expect(warning).toHaveBeenCalledTimes(1);

      await cached.clearCache();
    });
  });
});

describe('Provider Compatibility', () => {
  describe('OpenAI provider', () => {
    it('should work with enhanced features', async () => {
      const config: Config = {
        clientId: 'test',
        provider: 'openai',
        apiKey: 'test-key',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      expect(() => {
        ProviderFactory.createEnhanced('openai', {
          config,
          apiKey: 'test-key',
          repoId: 'test',
          enableRetry: true,
        });
      }).not.toThrow();
    });
  });

  describe('Gemini provider', () => {
    it('should work with enhanced features', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'gemini',
        apiKey: 'test-key',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      expect(() => {
        ProviderFactory.createEnhanced('gemini', {
          config,
          apiKey: 'test-key',
          repoId: 'test',
          enableRetry: true,
        });
      }).not.toThrow();
    });
  });

  describe('Claude provider', () => {
    it('should work with enhanced features', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'claude',
        apiKey: 'test-key',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      expect(() => {
        ProviderFactory.createEnhanced('claude', {
          config,
          apiKey: 'test-key',
          repoId: 'test',
          enableRetry: true,
        });
      }).not.toThrow();
    });
  });

  describe('Ollama provider', () => {
    it('should work with enhanced features', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'ollama',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      expect(() => {
        ProviderFactory.createEnhanced('ollama', {
          config,
          apiKey: 'test-key',
          repoId: 'test',
          enableRetry: true,
        });
      }).not.toThrow();
    });
  });
});
