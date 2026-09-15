/**
 * observable-provider.ts - Observability Decorator
 *
 * Records spans locally via MetricsCollector. Spans are not sent remotely.
 */

import { AIProviderDecorator } from './base-decorator';
import { AIProvider, AIMessage, AIResponse, ChatOptions } from '../base';
import { MetricsCollector, AISpan } from '../../core/metrics-collector';

export interface ObservabilityConfig {
  enabled: boolean;
  exportPath?: string;
  logSpans?: boolean;  // Log spans to console
}

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  enabled: true,
  logSpans: false,
};

export class ObservableProvider extends AIProviderDecorator {
  private config: ObservabilityConfig;
  private metrics: MetricsCollector;

  constructor(
    wrapped: AIProvider,
    metrics: MetricsCollector,
    config: Partial<ObservabilityConfig> = {}
  ) {
    super(wrapped);
    this.config = { ...DEFAULT_OBSERVABILITY_CONFIG, ...config };
    this.metrics = metrics;
  }

  /**
   * Chat with observability
   */
  async chat(
    messages: AIMessage[],
    options?: ChatOptions
  ): Promise<AIResponse> {
    if (!this.config.enabled) {
      return this.wrapped.chat(messages, options);
    }

    const span: AISpan = {
      traceId: this.generateTraceId(),
      spanId: this.generateSpanId(),
      provider: this.getBaseProvider().getName(),
      model: options?.model || 'default',
      operation: 'chat',
      startTime: Date.now(),
      endTime: 0,
      latency: 0,
      success: false,
    };

    try {
      const response = await this.wrapped.chat(messages, options);

      span.endTime = Date.now();
      span.latency = span.endTime - span.startTime;
      span.tokens = response.usage ? {
        prompt: response.usage.promptTokens,
        completion: response.usage.completionTokens,
        total: response.usage.totalTokens,
      } : undefined;
      span.cost = this.calculateCost(messages, response, options);
      span.success = true;
      span.cacheHit = response.model?.includes('cached') || false;
      span.model = response.model || span.model;

      await this.recordSpan(span);

      if (this.config.logSpans) {
        this.logSpan(span);
      }

      return response;
    } catch (error: unknown) {
      span.endTime = Date.now();
      span.latency = span.endTime - span.startTime;
      span.success = false;
      span.errorType = this.categorizeError(error);

      await this.recordSpan(span);

      if (this.config.logSpans) {
        this.logSpan(span);
      }

      throw error;
    }
  }

  /**
   * Stream with observability
   */
  async *stream(
    messages: AIMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    if (!this.config.enabled) {
      yield* this.wrapped.stream(messages, options);
      return;
    }

    const span: AISpan = {
      traceId: this.generateTraceId(),
      spanId: this.generateSpanId(),
      provider: this.getBaseProvider().getName(),
      model: options?.model || 'default',
      operation: 'stream',
      startTime: Date.now(),
      endTime: 0,
      latency: 0,
      success: false,
    };

    try {
      for await (const chunk of this.wrapped.stream(messages, options)) {
        yield chunk;
      }

      span.endTime = Date.now();
      span.latency = span.endTime - span.startTime;
      span.success = true;
      
      // Estimate tokens for streaming (we don't have exact count)
      const estimatedPromptTokens = this.wrapped.countMessagesTokens(messages);
      span.tokens = {
        prompt: estimatedPromptTokens,
        completion: 0, // Unknown for streaming
        total: estimatedPromptTokens,
      };

      await this.recordSpan(span);

      if (this.config.logSpans) {
        this.logSpan(span);
      }
    } catch (error: unknown) {
      span.endTime = Date.now();
      span.latency = span.endTime - span.startTime;
      span.success = false;
      span.errorType = this.categorizeError(error);

      await this.recordSpan(span);

      if (this.config.logSpans) {
        this.logSpan(span);
      }

      throw error;
    }
  }

  /**
   * Generate embedding with observability
   */
  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    if (!this.config.enabled) {
      return this.wrapped.generateEmbedding(text, model);
    }

    const span: AISpan = {
      traceId: this.generateTraceId(),
      spanId: this.generateSpanId(),
      provider: this.getBaseProvider().getName(),
      model: model || 'default',
      operation: 'embed',
      startTime: Date.now(),
      endTime: 0,
      latency: 0,
      success: false,
    };

    try {
      const result = await this.wrapped.generateEmbedding(text, model);

      span.endTime = Date.now();
      span.latency = span.endTime - span.startTime;
      span.success = true;
      
      const estimatedTokens = this.wrapped.countTokens(text);
      span.tokens = {
        prompt: estimatedTokens,
        completion: 0,
        total: estimatedTokens,
      };

      await this.recordSpan(span);

      if (this.config.logSpans) {
        this.logSpan(span);
      }

      return result;
    } catch (error: unknown) {
      span.endTime = Date.now();
      span.latency = span.endTime - span.startTime;
      span.success = false;
      span.errorType = this.categorizeError(error);

      await this.recordSpan(span);

      if (this.config.logSpans) {
        this.logSpan(span);
      }

      throw error;
    }
  }

  /**
   * Generate bulk embeddings with observability
   */
  async generateBulkEmbeddings(
    texts: string[],
    model?: string
  ): Promise<number[][]> {
    if (!this.config.enabled) {
      return this.wrapped.generateBulkEmbeddings(texts, model);
    }

    const span: AISpan = {
      traceId: this.generateTraceId(),
      spanId: this.generateSpanId(),
      provider: this.getBaseProvider().getName(),
      model: model || 'default',
      operation: 'embed-bulk',
      startTime: Date.now(),
      endTime: 0,
      latency: 0,
      success: false,
    };

    try {
      const result = await this.wrapped.generateBulkEmbeddings(texts, model);

      span.endTime = Date.now();
      span.latency = span.endTime - span.startTime;
      span.success = true;

      const estimatedTokens = texts.reduce(
        (sum, text) => sum + this.wrapped.countTokens(text),
        0
      );
      span.tokens = {
        prompt: estimatedTokens,
        completion: 0,
        total: estimatedTokens,
      };

      await this.recordSpan(span);

      if (this.config.logSpans) {
        this.logSpan(span);
      }

      return result;
    } catch (error: unknown) {
      span.endTime = Date.now();
      span.latency = span.endTime - span.startTime;
      span.success = false;
      span.errorType = this.categorizeError(error);

      await this.recordSpan(span);

      if (this.config.logSpans) {
        this.logSpan(span);
      }

      throw error;
    }
  }

  /**
   * Calculate actual cost from response
   */
  private async recordSpan(span: AISpan): Promise<void> {
    try {
      await this.metrics.recordSpan(span);
    } catch (error: unknown) {
      if (process.env.GUARDSCAN_DEBUG === 'true') {
        console.warn(
          'Unable to persist local observability metrics; continuing without this span:',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  private calculateCost(
    messages: AIMessage[],
    response: AIResponse,
    options?: ChatOptions
  ): number {
    if (response.usage) {
      const pricing = this.wrapped.getPricing();
      const inputCost = (response.usage.promptTokens / 1000000) * pricing.chat.input;
      const outputCost = (response.usage.completionTokens / 1000000) * pricing.chat.output;
      return inputCost + outputCost;
    }

    // Fallback to estimation
    const estimate = this.wrapped.estimateChatCost(messages, options);
    return estimate.totalCost;
  }

  /**
   * Categorize error type
   */
  private categorizeError(error: unknown): string {
    const details = error && typeof error === 'object'
      ? error as Record<string, unknown>
      : {};
    const status = typeof details.status === 'number'
      ? details.status
      : typeof details.statusCode === 'number' ? details.statusCode : undefined;
    const message = typeof details.message === 'string' ? details.message.toLowerCase() : '';
    const code = typeof details.code === 'string' ? details.code.toLowerCase() : '';

    // Rate limiting
    if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
      return 'rate_limit';
    }

    // Authentication
    if (status === 401 || status === 403 || message.includes('unauthorized') || message.includes('forbidden')) {
      return 'auth_error';
    }

    // Server errors
    if ((status !== undefined && status >= 500) || message.includes('server error')) {
      return 'server_error';
    }

    // Network errors
    if (code.includes('econnrefused') || code.includes('etimedout') || code.includes('enotfound')) {
      return 'network_error';
    }

    // Validation errors
    if (status === 400 || message.includes('invalid') || message.includes('validation')) {
      return 'validation_error';
    }

    // Timeout
    if (message.includes('timeout')) {
      return 'timeout';
    }

    return 'unknown_error';
  }

  /**
   * Log span to console
   */
  private logSpan(span: AISpan): void {
    const status = span.success ? '✅' : '❌';
    const cached = span.cacheHit ? ' [CACHED]' : '';
    
    console.log(
      `${status} ${span.operation.toUpperCase()} | ` +
      `${span.provider} (${span.model})${cached} | ` +
      `${span.latency}ms | ` +
      (span.tokens ? `${span.tokens.total} tokens | ` : '') +
      (span.cost ? `$${span.cost.toFixed(6)} | ` : '') +
      (span.success ? 'Success' : `Error: ${span.errorType || 'unknown_error'}`)
    );
  }

  /**
   * Generate trace ID
   */
  private generateTraceId(): string {
    return MetricsCollector.generateTraceId();
  }

  /**
   * Generate span ID
   */
  private generateSpanId(): string {
    return MetricsCollector.generateSpanId();
  }

  /**
   * Get metrics
   */
  getMetrics(timeRangeMs?: number) {
    return this.metrics.getMetrics(timeRangeMs);
  }

  /**
   * Export metrics
   */
  exportMetrics(outputPath: string, timeRangeMs?: number) {
    this.metrics.exportToJSON(outputPath, timeRangeMs);
  }

  /**
   * Get observability configuration
   */
  getConfig(): ObservabilityConfig {
    return { ...this.config };
  }
}
