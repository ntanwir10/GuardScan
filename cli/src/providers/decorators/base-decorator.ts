/**
 * base-decorator.ts - Base Decorator for AI Providers
 * 
 * Abstract base class for all provider decorators.
 * Implements delegation pattern - decorators wrap providers and delegate calls.
 */

import {
  AIProvider,
  AIMessage,
  AIResponse,
  ChatOptions,
  ProviderCapabilities,
  CostEstimate,
} from '../base';

export abstract class AIProviderDecorator extends AIProvider {
  constructor(protected wrapped: AIProvider) {
    super();
  }

  /**
   * Delegate chat to wrapped provider
   */
  async chat(
    messages: AIMessage[],
    options?: ChatOptions
  ): Promise<AIResponse> {
    return this.wrapped.chat(messages, options);
  }

  /**
   * Delegate stream to wrapped provider
   */
  async *stream(
    messages: AIMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    yield* this.wrapped.stream(messages, options);
  }

  /**
   * Delegate isAvailable to wrapped provider
   */
  isAvailable(): boolean {
    return this.wrapped.isAvailable();
  }

  /**
   * Delegate getName to wrapped provider
   */
  getName(): string {
    return this.wrapped.getName();
  }

  /**
   * Delegate testConnection to wrapped provider
   */
  async testConnection(): Promise<boolean> {
    return this.wrapped.testConnection();
  }

  /**
   * Delegate getCapabilities to wrapped provider
   */
  getCapabilities(): ProviderCapabilities {
    return this.wrapped.getCapabilities();
  }

  /**
   * Delegate generateEmbedding to wrapped provider
   */
  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    return this.wrapped.generateEmbedding(text, model);
  }

  /**
   * Delegate generateBulkEmbeddings to wrapped provider
   */
  async generateBulkEmbeddings(
    texts: string[],
    model?: string
  ): Promise<number[][]> {
    return this.wrapped.generateBulkEmbeddings(texts, model);
  }

  /**
   * Delegate countTokens to wrapped provider
   */
  countTokens(text: string): number {
    return this.wrapped.countTokens(text);
  }

  /**
   * Delegate countMessagesTokens to wrapped provider
   */
  countMessagesTokens(messages: AIMessage[]): number {
    return this.wrapped.countMessagesTokens(messages);
  }

  /**
   * Delegate estimateChatCost to wrapped provider
   */
  estimateChatCost(
    messages: AIMessage[],
    options?: ChatOptions
  ): CostEstimate {
    return this.wrapped.estimateChatCost(messages, options);
  }

  /**
   * Delegate estimateEmbeddingCost to wrapped provider
   */
  estimateEmbeddingCost(textCount: number, avgLength: number): CostEstimate {
    return this.wrapped.estimateEmbeddingCost(textCount, avgLength);
  }

  /**
   * Delegate getPricing to wrapped provider
   */
  getPricing(): {
    chat: {
      input: number;
      output: number;
    };
    embeddings?: {
      input: number;
    };
  } {
    return this.wrapped.getPricing();
  }

  /**
   * Get the underlying wrapped provider (for debugging/testing)
   */
  getWrapped(): AIProvider {
    return this.wrapped;
  }

  /**
   * Unwrap all decorators to get the base provider
   */
  getBaseProvider(): AIProvider {
    let current: AIProvider = this.wrapped;
    while (current instanceof AIProviderDecorator) {
      current = current.getWrapped();
    }
    return current;
  }
}
