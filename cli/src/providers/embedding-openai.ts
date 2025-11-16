/**
 * embedding-openai.ts - OpenAI Embedding Provider
 *
 * Uses OpenAI's text-embedding-3-small model (1536 dimensions)
 * Cost: $0.00002 per 1K tokens (~$0.02 per 1M tokens)
 */

import OpenAI from 'openai';
import { BaseEmbeddingProvider } from '../core/embeddings';

export class OpenAIEmbeddingProvider extends BaseEmbeddingProvider {
  private client: OpenAI;

  constructor(apiKey: string, endpoint?: string) {
    super('openai', 'text-embedding-3-small', 1536);

    this.client = new OpenAI({
      apiKey,
      baseURL: endpoint,
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
        encoding_format: 'float',
      });

      return response.data[0].embedding;
    } catch (error: any) {
      throw new Error(`OpenAI embedding generation failed: ${error.message}`);
    }
  }

  async generateBulkEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // OpenAI allows up to 2048 inputs per request, but we'll use 100 for safety
    const batches = this.chunk(texts, 100);
    const allEmbeddings: number[][] = [];

    for (const batch of batches) {
      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: batch,
          encoding_format: 'float',
        });

        // Preserve order from response
        allEmbeddings.push(...response.data.map(d => d.embedding));
      } catch (error: any) {
        throw new Error(`OpenAI bulk embedding generation failed: ${error.message}`);
      }
    }

    return allEmbeddings;
  }

  estimateCost(tokenCount: number): number {
    // text-embedding-3-small: $0.00002 per 1K tokens
    return (tokenCount / 1000) * 0.00002;
  }

  isAvailable(): boolean {
    return !!this.client.apiKey;
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test with a simple embedding request
      await this.generateEmbedding('test');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get current pricing for this model
   */
  getPricing(): { perMillionTokens: number; per1kTokens: number } {
    return {
      perMillionTokens: 0.02,  // $0.02 per 1M tokens
      per1kTokens: 0.00002,    // $0.00002 per 1K tokens
    };
  }

  /**
   * Estimate cost for a codebase
   */
  estimateCodebaseCost(totalCharacters: number): number {
    const estimatedTokens = this.estimateTokens(
      totalCharacters.toString().repeat(Math.ceil(totalCharacters / 1000))
    );
    return this.estimateCost(estimatedTokens);
  }
}
