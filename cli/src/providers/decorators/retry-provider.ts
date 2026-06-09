/**
 * retry-provider.ts - Retry Decorator with Exponential Backoff
 * 
 * Automatically retries failed requests with exponential backoff and jitter.
 * Handles transient failures (429, 500, 502, 503, 504).
 */

import { AIProviderDecorator } from './base-decorator';
import { AIProvider, AIMessage, AIResponse, ChatOptions } from '../base';

export interface RetryConfig {
  maxRetries: number;       // Maximum number of retry attempts (default: 3)
  baseDelayMs: number;      // Base delay in milliseconds (default: 1000)
  maxDelayMs: number;       // Maximum delay in milliseconds (default: 10000)
  retryableStatusCodes: number[];  // HTTP status codes to retry (default: [429, 500, 502, 503, 504])
  jitterFactor: number;     // Jitter factor 0-1 (default: 0.3 for ±30%)
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  jitterFactor: 0.3,
};

export class RetryProvider extends AIProviderDecorator {
  private config: RetryConfig;

  constructor(
    wrapped: AIProvider,
    config: Partial<RetryConfig> = {}
  ) {
    super(wrapped);
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * Chat with automatic retry on failure
   */
  async chat(
    messages: AIMessage[],
    options?: ChatOptions
  ): Promise<AIResponse> {
    return this.retryWithBackoff(
      () => this.wrapped.chat(messages, options),
      'chat'
    );
  }

  /**
   * Stream with automatic retry on failure
   * Note: Streaming retry is more complex as we need to handle partial responses
   */
  async *stream(
    messages: AIMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    let attempt = 0;
    let lastError: any;

    while (attempt <= this.config.maxRetries) {
      try {
        yield* this.wrapped.stream(messages, options);
        return; // Success, exit
      } catch (error: any) {
        lastError = error;

        if (!this.isRetryable(error) || attempt >= this.config.maxRetries) {
          throw error;
        }

        // Calculate delay and wait
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);

        attempt++;
      }
    }

    throw lastError;
  }

  /**
   * Test connection with retry
   */
  async testConnection(): Promise<boolean> {
    return this.retryWithBackoff(
      () => this.wrapped.testConnection(),
      'testConnection'
    );
  }

  /**
   * Generate embedding with retry
   */
  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    return this.retryWithBackoff(
      () => this.wrapped.generateEmbedding(text, model),
      'generateEmbedding'
    );
  }

  /**
   * Generate bulk embeddings with retry
   */
  async generateBulkEmbeddings(
    texts: string[],
    model?: string
  ): Promise<number[][]> {
    return this.retryWithBackoff(
      () => this.wrapped.generateBulkEmbeddings(texts, model),
      'generateBulkEmbeddings'
    );
  }

  /**
   * Retry with exponential backoff and jitter
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    operation: string,
    attempt: number = 0
  ): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      // Check if we should retry
      if (!this.isRetryable(error) || attempt >= this.config.maxRetries) {
        throw error;
      }

      // Log retry attempt
      const nextAttempt = attempt + 1;
      console.warn(
        `⚠️  ${operation} failed (attempt ${nextAttempt}/${this.config.maxRetries}): ${error.message}. Retrying...`
      );

      // Calculate delay with exponential backoff and jitter
      const delay = this.calculateDelay(attempt);

      // Wait before retry
      await this.sleep(delay);

      // Recursive retry
      return this.retryWithBackoff(fn, operation, nextAttempt);
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryable(error: any): boolean {
    // Check for HTTP status code
    if (error.status) {
      return this.config.retryableStatusCodes.includes(error.status);
    }

    // Check for status code in error object
    if (error.statusCode) {
      return this.config.retryableStatusCodes.includes(error.statusCode);
    }

    // Check for rate limit errors
    if (error.message) {
      const message = error.message.toLowerCase();
      if (
        message.includes('rate limit') ||
        message.includes('too many requests') ||
        message.includes('429')
      ) {
        return true;
      }

      // Check for server errors
      if (
        message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504') ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('enotfound')
      ) {
        return true;
      }
    }

    // Check for network errors
    if (error.code) {
      const retryableNetworkCodes = [
        'ECONNRESET',
        'ENOTFOUND',
        'ETIMEDOUT',
        'ECONNREFUSED',
        'EHOSTUNREACH',
      ];
      return retryableNetworkCodes.includes(error.code);
    }

    return false;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attempt: number): number {
    // Exponential backoff: baseDelay * 2^attempt
    const exponentialDelay = this.config.baseDelayMs * Math.pow(2, attempt);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);

    // Add jitter (±30% by default)
    // Jitter helps prevent thundering herd problem
    const jitterRange = cappedDelay * this.config.jitterFactor;
    const jitter = Math.random() * jitterRange * 2 - jitterRange;

    const finalDelay = Math.max(0, cappedDelay + jitter);

    return Math.floor(finalDelay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get retry statistics
   */
  getRetryConfig(): RetryConfig {
    return { ...this.config };
  }
}
