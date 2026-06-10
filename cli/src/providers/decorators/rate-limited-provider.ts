/**
 * rate-limited-provider.ts - Rate Limiting with Token Bucket Algorithm
 * 
 * Prevents hitting provider rate limits by controlling request rate.
 * Uses token bucket algorithm with configurable refill rate.
 */

import { AIProviderDecorator } from './base-decorator';
import { AIProvider, AIMessage, AIResponse, ChatOptions } from '../base';

export interface RateLimitConfig {
  maxTokens: number;        // Maximum bucket size (default: 100000)
  refillRate: number;       // Tokens per second (default: 1000)
  costMultiplier: number;   // Multiplier for token cost (default: 1.0)
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxTokens: 100000,
  refillRate: 1000,  // 1000 tokens/second = 60k tokens/minute
  costMultiplier: 1.0,
};

// Provider-specific rate limit configs
export const PROVIDER_RATE_LIMITS: Record<string, RateLimitConfig> = {
  openai: {
    maxTokens: 150000,
    refillRate: 1667, // ~100k tokens/minute for gpt-4o
    costMultiplier: 1.0,
  },
  claude: {
    maxTokens: 100000,
    refillRate: 833,  // ~50k tokens/minute
    costMultiplier: 1.0,
  },
  gemini: {
    maxTokens: 200000,
    refillRate: 3333, // ~200k tokens/minute
    costMultiplier: 1.0,
  },
  ollama: {
    maxTokens: 1000000, // Local, no real limit
    refillRate: 100000,
    costMultiplier: 1.0,
  },
};

export interface RateLimitStats {
  currentTokens: number;
  maxTokens: number;
  refillRate: number;
  utilizationPercent: number;
  totalWaits: number;
  totalWaitTimeMs: number;
  lastRefillTime: number;
}

export class RateLimitedProvider extends AIProviderDecorator {
  private config: RateLimitConfig;
  private tokens: number;
  private lastRefill: number;
  private refillLock: boolean = false;
  
  // Statistics
  private totalWaits: number = 0;
  private totalWaitTimeMs: number = 0;

  constructor(
    wrapped: AIProvider,
    config: Partial<RateLimitConfig> = {}
  ) {
    super(wrapped);
    
    // Use provider-specific config if available
    const providerName = wrapped.getName().toLowerCase();
    const providerConfig = PROVIDER_RATE_LIMITS[providerName] || DEFAULT_RATE_LIMIT_CONFIG;
    
    this.config = { ...providerConfig, ...config };
    this.tokens = this.config.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Chat with rate limiting
   */
  async chat(
    messages: AIMessage[],
    options?: ChatOptions
  ): Promise<AIResponse> {
    // Estimate token cost
    const estimatedTokens = Math.ceil(
      this.wrapped.countMessagesTokens(messages) * this.config.costMultiplier
    );

    // Wait for rate limit
    await this.acquire(estimatedTokens);

    return this.wrapped.chat(messages, options);
  }

  /**
   * Stream with rate limiting
   */
  async *stream(
    messages: AIMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    // Estimate token cost
    const estimatedTokens = Math.ceil(
      this.wrapped.countMessagesTokens(messages) * this.config.costMultiplier
    );

    // Wait for rate limit
    await this.acquire(estimatedTokens);

    yield* this.wrapped.stream(messages, options);
  }

  /**
   * Generate embedding with rate limiting
   */
  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    // Estimate token cost for embedding
    const estimatedTokens = Math.ceil(
      this.wrapped.countTokens(text) * this.config.costMultiplier
    );

    // Wait for rate limit
    await this.acquire(estimatedTokens);

    return this.wrapped.generateEmbedding(text, model);
  }

  /**
   * Generate bulk embeddings with rate limiting
   */
  async generateBulkEmbeddings(
    texts: string[],
    model?: string
  ): Promise<number[][]> {
    // Estimate total token cost
    const estimatedTokens = Math.ceil(
      texts.reduce((sum, text) => sum + this.wrapped.countTokens(text), 0) *
        this.config.costMultiplier
    );

    // Wait for rate limit
    await this.acquire(estimatedTokens);

    return this.wrapped.generateBulkEmbeddings(texts, model);
  }

  /**
   * Acquire tokens from bucket (wait if necessary)
   */
  private async acquire(cost: number): Promise<void> {
    if (cost > this.config.maxTokens) {
      throw new Error(`Request requires ${cost} tokens, which exceeds the maximum bucket size of ${this.config.maxTokens}`);
    }
    await this.refill();

    if (this.tokens >= cost) {
      // Sufficient tokens available
      this.tokens -= cost;
      return;
    }

    // Need to wait for tokens
    const waitStartTime = Date.now();
    this.totalWaits++;

    console.log(
      `⏳ Rate limit: waiting for ${cost} tokens (${this.tokens} available). ` +
      `Estimated wait: ${Math.ceil((cost - this.tokens) / this.config.refillRate)}s`
    );

    while (this.tokens < cost) {
      const tokensNeeded = cost - this.tokens;
      const waitTimeMs = (tokensNeeded / this.config.refillRate) * 1000;
      
      // Wait in small increments (max 1 second at a time)
      const waitIncrement = Math.min(waitTimeMs, 1000);
      await this.sleep(waitIncrement);
      
      await this.refill();
    }

    this.tokens -= cost;

    const totalWaitTime = Date.now() - waitStartTime;
    this.totalWaitTimeMs += totalWaitTime;

    console.log(
      `✅ Rate limit: acquired ${cost} tokens after ${Math.ceil(totalWaitTime / 1000)}s wait`
    );
  }

  /**
  private async refill(): Promise<void> {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000; // in seconds
    const tokensToAdd = timePassed * this.config.refillRate;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.config.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current token count
   */
  async getCurrentTokens(): Promise<number> {
    await this.refill();
    return this.tokens;
  }

  /**
   * Get rate limit statistics
   */
  getStats(): RateLimitStats {
    this.refill();
    
    return {
      currentTokens: this.tokens,
      maxTokens: this.config.maxTokens,
      refillRate: this.config.refillRate,
      utilizationPercent: ((this.config.maxTokens - this.tokens) / this.config.maxTokens) * 100,
      totalWaits: this.totalWaits,
      totalWaitTimeMs: this.totalWaitTimeMs,
      lastRefillTime: this.lastRefill,
    };
  }

  /**
   * Get rate limit configuration
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  /**
   * Reset rate limiter (for testing/admin)
   */
  reset(): void {
    this.tokens = this.config.maxTokens;
    this.lastRefill = Date.now();
    this.totalWaits = 0;
    this.totalWaitTimeMs = 0;
  }
}
