/**
 * embedding-gemini.ts - Google Gemini Embedding Provider
 *
 * Uses Google's text-embedding-004 model (768 dimensions)
 * Cost: Free tier available, then $0.0001 per 1K characters
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseEmbeddingProvider } from '../core/embeddings';

export class GeminiEmbeddingProvider extends BaseEmbeddingProvider {
  private client: GoogleGenerativeAI;
  private apiKey: string;

  constructor(apiKey: string) {
    super('gemini', 'text-embedding-004', 768);
    
    const key = apiKey || process.env.GOOGLE_API_KEY;
    if (!key) {
      throw new Error('Google API key is required for Gemini embeddings');
    }
    
    this.apiKey = key;
    this.client = new GoogleGenerativeAI(key);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model });
      const result = await model.embedContent(text);
      
      if (!result.embedding || !result.embedding.values) {
        throw new Error('No embedding returned from Gemini');
      }

      return result.embedding.values;
    } catch (error: any) {
      if (error.message?.includes('API_KEY')) {
        throw new Error('Invalid Google API key. Check your API key in guardscan config.');
      }
      throw new Error(`Gemini embedding generation failed: ${error.message}`);
    }
  }

  async generateBulkEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batches = this.chunk(texts, 50);
    const allEmbeddings: number[][] = [];

    for (const batch of batches) {
      try {
        const model = this.client.getGenerativeModel({ model: this.model });
        
        const batchPromises = batch.map(text => 
          model.embedContent(text).then(result => {
            if (!result.embedding || !result.embedding.values) {
              throw new Error('No embedding returned from Gemini');
            }
            return result.embedding.values;
          })
        );
        
        const batchEmbeddings = await Promise.all(batchPromises);
        allEmbeddings.push(...batchEmbeddings);
      } catch (error: any) {
        throw new Error(`Gemini bulk embedding generation failed: ${error.message}`);
      }
    }

    return allEmbeddings;
  }

  estimateCost(tokenCount: number): number {
    const characterCount = tokenCount * 4; // Rough estimate: 4 chars per token
    return (characterCount / 1000) * 0.0001;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.generateEmbedding('test');
      return true;
    } catch (error) {
      return false;
    }
  }
}


