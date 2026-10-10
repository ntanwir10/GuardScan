/**
 * circuit-breaker-provider.test.ts - Unit tests for CircuitBreakerProvider
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CircuitBreakerProvider,
  CircuitState,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
} from '../../../src/providers/decorators/circuit-breaker-provider';
import { AIProvider, AIMessage, AIResponse } from '../../../src/providers/base';

// Mock failing provider
class FailingMockProvider extends AIProvider {
  private callCount = 0;
  private shouldFail = true;

  async chat(messages: AIMessage[]): Promise<AIResponse> {
    this.callCount++;

    if (this.shouldFail) {
      const error: any = new Error('Server error');
      error.status = 500;
      throw error;
    }

    return {
      content: 'Success',
      model: 'mock',
    };
  }

  async *stream(): AsyncGenerator<string> {
    if (this.shouldFail) {
      const error: any = new Error('Server error');
      error.status = 500;
      throw error;
    }
    yield 'test';
  }

  isAvailable(): boolean {
    return true;
  }

  getName(): string {
    return 'FailingMock';
  }

  async testConnection(): Promise<boolean> {
    return !this.shouldFail;
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

  resetCallCount() {
    this.callCount = 0;
  }

  getCallCount() {
    return this.callCount;
  }
}

describe('CircuitBreakerProvider', () => {
  const originalGuardScanHome = process.env.GUARDSCAN_HOME;
  const isolatedHome = path.join(
    os.tmpdir(),
    `guardscan-circuit-breaker-${process.pid}-${Date.now()}`
  );

  beforeAll(() => {
    process.env.GUARDSCAN_HOME = isolatedHome;
  });

  afterAll(async () => {
    // State writes are intentionally best-effort; let pending writes settle.
    await new Promise<void>((resolve) => setImmediate(resolve));
    fs.rmSync(isolatedHome, { recursive: true, force: true });
    if (originalGuardScanHome === undefined) {
      delete process.env.GUARDSCAN_HOME;
    } else {
      process.env.GUARDSCAN_HOME = originalGuardScanHome;
    }
  });

  it('stores state under GUARDSCAN_HOME rather than the real user home', () => {
    const cb = new CircuitBreakerProvider(new FailingMockProvider());

    expect((cb as any).statePath).toBe(
      path.join(
        isolatedHome,
        '.guardscan',
        'circuit-breaker',
        'FailingMock-state.json'
      )
    );
  });

  describe('state transitions', () => {
    it('should start in CLOSED state', () => {
      const mock = new FailingMockProvider();
      const cb = new CircuitBreakerProvider(mock);

      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should transition to OPEN after threshold failures', async () => {
      const mock = new FailingMockProvider();
      const cb = new CircuitBreakerProvider(mock, { failureThreshold: 3 });

      // Fail 3 times
      for (let i = 0; i < 3; i++) {
        try {
          await cb.chat([{ role: 'user', content: 'test' }]);
        } catch {}
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it('should block requests when OPEN', async () => {
      const mock = new FailingMockProvider();
      const cb = new CircuitBreakerProvider(mock, { failureThreshold: 2 });

      // Trigger circuit to open
      for (let i = 0; i < 2; i++) {
        try {
          await cb.chat([{ role: 'user', content: 'test' }]);
        } catch {}
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Next request should be blocked
      await expect(
        cb.chat([{ role: 'user', content: 'test' }])
      ).rejects.toThrow('Circuit breaker is OPEN');
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      const mock = new FailingMockProvider();
      const cb = new CircuitBreakerProvider(mock, {
        failureThreshold: 2,
        resetTimeoutMs: 100, // Short timeout for testing
      });

      // Open circuit
      for (let i = 0; i < 2; i++) {
        try {
          await cb.chat([{ role: 'user', content: 'test' }]);
        } catch {}
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Next request should transition to HALF_OPEN
      try {
        await cb.chat([{ role: 'user', content: 'test' }]);
      } catch {}

      expect(cb.getState()).toBe(CircuitState.OPEN); // Still open because it failed
    });

    it('should transition to CLOSED after success in HALF_OPEN', async () => {
      const mock = new FailingMockProvider();
      const cb = new CircuitBreakerProvider(mock, {
        failureThreshold: 2,
        resetTimeoutMs: 100,
        halfOpenSuccessThreshold: 2,
      });

      // Open circuit
      for (let i = 0; i < 2; i++) {
        try {
          await cb.chat([{ role: 'user', content: 'test' }]);
        } catch {}
      }

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Now succeed
      mock.setShouldFail(false);

      // Two successes should close circuit
      await cb.chat([{ role: 'user', content: 'test' }]);
      await cb.chat([{ role: 'user', content: 'test' }]);

      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('statistics', () => {
    it('should track statistics', async () => {
      const mock = new FailingMockProvider();
      const cb = new CircuitBreakerProvider(mock);

      // One success
      mock.setShouldFail(false);
      await cb.chat([{ role: 'user', content: 'test' }]);

      // One failure
      mock.setShouldFail(true);
      try {
        await cb.chat([{ role: 'user', content: 'test' }]);
      } catch {}

      const stats = cb.getStats();

      expect(stats.totalSuccesses).toBe(1);
      expect(stats.totalFailures).toBe(1);
      expect(stats.state).toBe(CircuitState.CLOSED);
    });
  });

  describe('manual control', () => {
    it('should allow manual reset', async () => {
      const mock = new FailingMockProvider();
      const cb = new CircuitBreakerProvider(mock, { failureThreshold: 2 });

      // Open circuit
      for (let i = 0; i < 2; i++) {
        try {
          await cb.chat([{ role: 'user', content: 'test' }]);
        } catch {}
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Manual reset
      cb.reset();

      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should allow manual open', () => {
      const mock = new FailingMockProvider();
      const cb = new CircuitBreakerProvider(mock);

      expect(cb.getState()).toBe(CircuitState.CLOSED);

      cb.open();

      expect(cb.getState()).toBe(CircuitState.OPEN);
    });
  });
});
