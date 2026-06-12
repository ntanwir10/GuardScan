/**
 * cached-provider.ts - Semantic Caching Decorator
 * 
 * Caches AI responses with semantic similarity matching.
 * Uses embeddings to find similar cached queries (95% similarity threshold).
 */

import { AIProviderDecorator } from './base-decorator';
import { AIProvider, AIMessage, AIResponse, ChatOptions } from '../base';
import { AICache } from '../../core/ai-cache';
import * as crypto from 'crypto';

export interface CacheConfig {
  enabled: boolean;
  semanticThreshold: number;  // 0-1, default: 0.95
  maxSizeMB: number;          // default: 100
  ttlSeconds: number;         // default: 3600 (1 hour)
  useSemanticSimilarity: boolean; // default: true
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  semanticThreshold: 0.95,
  maxSizeMB: 100,
  ttlSeconds: 3600,
  useSemanticSimilarity: true,
};

export interface CachedResponse {
  response: string;
  model: string;
  embedding?: number[];
  timestamp: Date;
}

export class CachedProvider extends AIProviderDecorator {
  private config: CacheConfig;
  private cache: AICache;
  private embeddingProvider?: AIProvider;
  private semanticCache?: SemanticCache;

  constructor(
    wrapped: AIProvider,
    repoId: string,
    embeddingProvider?: AIProvider,
    config: Partial<CacheConfig> = {}
  ) {
    super(wrapped);
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.cache = new AICache(repoId, this.config.maxSizeMB);
    this.embeddingProvider = embeddingProvider;
    
    // Initialize semantic cache if embedding provider available
    if (embeddingProvider && this.config.useSemanticSimilarity) {
      this.semanticCache = new SemanticCache(embeddingProvider);
    }
  }

  /**
   * Chat with caching
   */
  async chat(
    messages: AIMessage[],
    options?: ChatOptions
  ): Promise<AIResponse> {
    if (!this.config.enabled) {
      return this.wrapped.chat(messages, options);
    }

    const prompt = this.messagesToPrompt(messages);
    const model = options?.model || 'default';

    // 1. Try semantic cache first (if enabled)
    if (this.semanticCache && this.config.useSemanticSimilarity) {
      try {
        const semanticMatch = await this.semanticCache.getSimilar(
          prompt,
          model,
          this.config.semanticThreshold
        );

        if (semanticMatch) {
          return {
            content: semanticMatch.response,
            usage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            },
            model: model + ' (semantic-cached)',
          };
        }
      } catch (error) {
        // Semantic cache failed, fall back to exact match
        console.warn('Semantic cache lookup failed:', error);
      }
    }

    // 2. Try exact match cache
    const cached = await this.cache.get(prompt, model);

    if (cached) {
      // Cache hit!
      return {
        content: cached,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        model: model + ' (cached)',
      };
    }

    // 3. Cache miss - call provider
    const response = await this.wrapped.chat(messages, options);

    // 4. Store in both caches
    await this.cache.set(prompt, model, response.content);

    if (this.semanticCache && this.config.useSemanticSimilarity) {
      try {
        await this.semanticCache.set(prompt, model, response.content, this.config.ttlSeconds);
      } catch (error) {
        // Embedding generation failed, only exact cache available
        console.warn('Failed to store in semantic cache:', error);
      }
    }

    return response;
  }

  /**
   * Stream with caching (cache only final result)
   * Note: Streaming bypasses cache lookup to provide immediate response
   */
  async *stream(
    messages: AIMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    // For streaming, we collect the response and cache it at the end
    const chunks: string[] = [];

    try {
      for await (const chunk of this.wrapped.stream(messages, options)) {
        chunks.push(chunk);
        yield chunk;
      }

      // Cache the complete response after streaming
      if (this.config.enabled && chunks.length > 0) {
        const prompt = this.messagesToPrompt(messages);
        const model = options?.model || 'default';
        const fullResponse = chunks.join('');
        
        // Store in exact match cache (fire and forget)
        this.cache.set(prompt, model, fullResponse).catch(err => {
          console.warn('Failed to cache streamed response:', err);
        });

        // Store in semantic cache (fire and forget)
        if (this.semanticCache && this.config.useSemanticSimilarity) {
          this.semanticCache.set(prompt, model, fullResponse, this.config.ttlSeconds).catch(err => {
            console.warn('Failed to store streamed response in semantic cache:', err);
          });
        }
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Convert messages to prompt string for caching
   */
  private messagesToPrompt(messages: AIMessage[]): string {
    return messages
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join('\n');
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(prompt: string, model: string): string {
    return crypto
      .createHash('sha256')
      .update(prompt + '::' + model)
      .digest('hex');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear cache
   */
  async clearCache() {
    await this.cache.clear();
  }

  /**
   * Invalidate cache for changed files
   */
  async invalidateCache(changedFiles: string[]) {
    await this.cache.invalidate(changedFiles);
  }

  /**
   * Get cache configuration
   */
  getCacheConfig(): CacheConfig {
    return { ...this.config };
  }
}

/**
 * Enhanced Semantic Cache (for future enhancement with actual embeddings)
 * 
 * This provides semantic similarity matching using embeddings.
 * Currently simplified to exact matching via AICache.
 */
export class SemanticCache {
  private entries: Map<string, CachedResponse> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private embeddingProvider: AIProvider;

  constructor(embeddingProvider: AIProvider) {
    this.embeddingProvider = embeddingProvider;
  }

  /**
   * Get similar cached response
   */
  async getSimilar(
    query: string,
    model: string,
    threshold: number = 0.95
  ): Promise<CachedResponse | null> {
    // Generate embedding for query
    const queryEmbedding = await this.embeddingProvider.generateEmbedding(query);

    // Find most similar cached query
    let bestMatch: CachedResponse | null = null;
    let bestSimilarity = 0;

    for (const [key, entry] of this.entries) {
      if (!entry.embedding) {continue;}

      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);

      if (similarity > bestSimilarity && similarity >= threshold) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    return bestMatch;
  }

  /**
   * Set cached response with embedding
   */
  async set(
    query: string,
    model: string,
    response: string,
    ttlSeconds: number = 3600
  ): Promise<void> {
    // Generate embedding for query
    const embedding = await this.embeddingProvider.generateEmbedding(query);

    const cacheKey = this.generateKey(query, model);

    // Clear old timeout if exists
    const oldTimeout = this.timeouts.get(cacheKey);
    if (oldTimeout) {
      clearTimeout(oldTimeout);
    }

    this.entries.set(cacheKey, {
      response,
      model,
      embedding,
      timestamp: new Date(),
    });

    // Set TTL expiration with tracked timeout
    const timeoutId = setTimeout(() => {
      this.entries.delete(cacheKey);
      this.timeouts.delete(cacheKey);
    }, ttlSeconds * 1000);
    
    this.timeouts.set(cacheKey, timeoutId);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Generate cache key
   */
  private generateKey(query: string, model: string): string {
    return crypto
      .createHash('sha256')
      .update(query + '::' + model)
      .digest('hex');
  }

  /**
   * Clear all cached entries
   */
  clear() {
    // Clear all timeouts to prevent memory leaks
    for (const timeoutId of this.timeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.timeouts.clear();
    this.entries.clear();
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.entries.size;
  }
}
