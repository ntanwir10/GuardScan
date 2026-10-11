/**
 * circuit-breaker-provider.ts - Circuit Breaker Pattern
 * 
 * Prevents cascading failures by opening circuit after threshold failures.
 * States: CLOSED (normal) → OPEN (blocking) → HALF_OPEN (testing recovery)
 */

import { AIProviderDecorator } from './base-decorator';
import { AIProvider, AIMessage, AIResponse, ChatOptions } from '../base';
import * as fs from 'fs';
import * as path from 'path';
import { getGuardScanDir } from '../../utils/path-helper';

export enum CircuitState {
  CLOSED = 'CLOSED',      // Normal operation
  OPEN = 'OPEN',          // Blocking requests (provider unavailable)
  HALF_OPEN = 'HALF_OPEN' // Testing recovery
}

export interface CircuitBreakerConfig {
  failureThreshold: number;          // Number of failures before opening (default: 5)
  resetTimeoutMs: number;            // Time before attempting recovery (default: 60000 = 1 min)
  halfOpenSuccessThreshold: number;  // Successes needed to close circuit (default: 2)
  monitoredErrors: string[];         // Error types to monitor
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000,
  halfOpenSuccessThreshold: 2,
  monitoredErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', '500', '502', '503', '504'],
};

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailTime: number;
  lastStateChange: number;
  totalFailures: number;
  totalSuccesses: number;
  circuitOpenCount: number;
}

export class CircuitBreakerProvider extends AIProviderDecorator {
  private config: CircuitBreakerConfig;
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private lastFailTime: number = 0;
  private successCount: number = 0;
  private lastStateChange: number = Date.now();
  private statePath: string;
  
  // Statistics
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;
  private circuitOpenCount: number = 0;

  constructor(
    wrapped: AIProvider,
    config: Partial<CircuitBreakerConfig> = {}
  ) {
    super(wrapped);
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.statePath = path.join(
      getGuardScanDir(),
      'circuit-breaker',
      `${wrapped.getName()}-state.json`
    );
    this.loadState();
  }

  /**
   * Chat with circuit breaker protection
   */
  async chat(
    messages: AIMessage[],
    options?: ChatOptions
  ): Promise<AIResponse> {
    this.checkCircuitState();

    if (this.state === CircuitState.OPEN) {
      throw new Error(
        `Circuit breaker is OPEN - ${this.wrapped.getName()} provider unavailable. ` +
        `Last failed ${Math.floor((Date.now() - this.lastFailTime) / 1000)}s ago. ` +
        `Will retry in ${Math.floor((this.config.resetTimeoutMs - (Date.now() - this.lastFailTime)) / 1000)}s.`
      );
    }

    try {
      const response = await this.wrapped.chat(messages, options);
      this.onSuccess();
      return response;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Stream with circuit breaker protection
   */
  async *stream(
    messages: AIMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    this.checkCircuitState();

    if (this.state === CircuitState.OPEN) {
      throw new Error(
        `Circuit breaker is OPEN - ${this.wrapped.getName()} provider unavailable`
      );
    }

    try {
      let hasStarted = false;
      
      for await (const chunk of this.wrapped.stream(messages, options)) {
        hasStarted = true;
        yield chunk;
      }

      if (hasStarted) {
        this.onSuccess();
      }
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Test connection with circuit breaker
   */
  async testConnection(): Promise<boolean> {
    this.checkCircuitState();

    if (this.state === CircuitState.OPEN) {
      return false;
    }

    try {
      const result = await this.wrapped.testConnection();
      if (result) {
        this.onSuccess();
      } else {
        this.onFailure(new Error('Connection test failed'));
      }
      return result;
    } catch (error) {
      this.onFailure(error);
      return false;
    }
  }

  /**
   * Generate embedding with circuit breaker
   */
  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    this.checkCircuitState();

    if (this.state === CircuitState.OPEN) {
      throw new Error(
        `Circuit breaker is OPEN - ${this.wrapped.getName()} provider unavailable`
      );
    }

    try {
      const result = await this.wrapped.generateEmbedding(text, model);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Check and update circuit state based on time
   */
  private checkCircuitState(): void {
    if (this.state === CircuitState.OPEN) {
      const timeSinceLastFail = Date.now() - this.lastFailTime;
      
      if (timeSinceLastFail > this.config.resetTimeoutMs) {
        console.log(
          `🔄 Circuit breaker transitioning to HALF_OPEN - testing recovery for ${this.wrapped.getName()}`
        );
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        this.lastStateChange = Date.now();
      }
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.totalSuccesses++;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      
      if (this.successCount >= this.config.halfOpenSuccessThreshold) {
        console.log(
          `✅ Circuit breaker CLOSED - ${this.wrapped.getName()} recovered after ${this.successCount} successful requests`
        );
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successCount = 0;
        this.lastStateChange = Date.now();
        this.saveState().catch(() => {});
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success in CLOSED state
      this.failures = 0;
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(error: any): void {
    this.failures++;
    this.totalFailures++;
    this.lastFailTime = Date.now();

    // Only count monitored errors
    if (!this.isMonitoredError(error)) {
      return;
    }

    if (this.state === CircuitState.HALF_OPEN) {
      // Immediate failure in HALF_OPEN state reopens circuit
      console.error(
        `❌ Circuit breaker OPEN - ${this.wrapped.getName()} failed during recovery attempt`
      );
      this.state = CircuitState.OPEN;
      this.successCount = 0;
      this.circuitOpenCount++;
      this.lastStateChange = Date.now();
    } else if (this.state === CircuitState.CLOSED) {
      // Check if we've hit failure threshold
      if (this.failures >= this.config.failureThreshold) {
        console.error(
          `⚠️  Circuit breaker OPEN - ${this.wrapped.getName()} failed ${this.failures} times. ` +
          `Blocking requests for ${this.config.resetTimeoutMs / 1000}s.`
        );
        this.state = CircuitState.OPEN;
        this.circuitOpenCount++;
        this.lastStateChange = Date.now();
      }
    }
  }

  /**
   * Check if error should be monitored by circuit breaker
   */
  private isMonitoredError(error: any): boolean {
    const errorStr = JSON.stringify(error).toLowerCase();
    const messageStr = (error.message || '').toLowerCase();
    const codeStr = (error.code || '').toLowerCase();
    const statusStr = String(error.status || error.statusCode || '');

    return this.config.monitoredErrors.some((monitoredError) => {
      const monitored = monitoredError.toLowerCase();
      return (
        errorStr.includes(monitored) ||
        messageStr.includes(monitored) ||
        codeStr.includes(monitored) ||
        statusStr.includes(monitored)
      );
    });
  }

  /**
   * Get circuit breaker state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successCount,
      lastFailTime: this.lastFailTime,
      lastStateChange: this.lastStateChange,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      circuitOpenCount: this.circuitOpenCount,
    };
  }

  /**
   * Manually reset circuit breaker (for testing/admin)
   */
  reset(): void {
    console.log(`🔄 Circuit breaker manually reset for ${this.wrapped.getName()}`);
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successCount = 0;
    this.lastStateChange = Date.now();
    this.saveState().catch(() => {});
  }

  /**
   * Manually open circuit breaker (for testing/admin)
   */
  open(): void {
    console.log(`⚠️  Circuit breaker manually opened for ${this.wrapped.getName()}`);
    this.state = CircuitState.OPEN;
    this.lastFailTime = Date.now();
    this.circuitOpenCount++;
    this.lastStateChange = Date.now();
    this.saveState().catch(() => {});
  }

  /**
   * Get circuit breaker configuration
   */
  getConfig(): CircuitBreakerConfig {
    return { ...this.config };
  }

  /**
   * Save circuit state to disk
   */
  private async saveState(): Promise<void> {
    try {
      const state = {
        state: this.state,
        failures: this.failures,
        lastFailTime: this.lastFailTime,
        lastStateChange: this.lastStateChange,
      };

      await fs.promises.mkdir(path.dirname(this.statePath), { recursive: true });
      await fs.promises.writeFile(this.statePath, JSON.stringify(state), 'utf-8');
    } catch (error) {
      // Fail silently - state persistence is optional
    }
  }

  /**
   * Load circuit state from disk
   */
  private loadState(): void {
    try {
      const data = fs.readFileSync(this.statePath, 'utf-8');
      const saved = JSON.parse(data);

      // Only restore if recent (within reset timeout)
      if (Date.now() - saved.lastFailTime < this.config.resetTimeoutMs) {
        this.state = saved.state;
        this.failures = saved.failures;
        this.lastFailTime = saved.lastFailTime;
        this.lastStateChange = saved.lastStateChange;
      }
    } catch {
      // No saved state or error reading - start fresh
    }
  }
}
