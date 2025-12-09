/**
 * embedding-lmstudio.ts - LM Studio Embedding Provider
 *
 * Uses LM Studio's nomic-embed-text model (768 dimensions)
 * Cost: Free (runs locally)
 * Requires: LM Studio installed locally with nomic-embed-text model loaded
 * Note: Independent from Ollama - separate implementation
 */

import axios, { AxiosInstance } from 'axios';
import { BaseEmbeddingProvider } from '../core/embeddings';

export interface LMStudioEmbeddingResponse {
  embedding: number[];
}

export class LMStudioEmbeddingProvider extends BaseEmbeddingProvider {
  private client: AxiosInstance;
  private endpoint: string;

  constructor(endpoint: string = 'http://localhost:1234') {
    super('lmstudio', 'nomic-embed-text', 768);

    this.endpoint = endpoint;
    this.client = axios.create({
      baseURL: endpoint,
      timeout: 30000, // 30 seconds per request
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.post<LMStudioEmbeddingResponse>(
        '/v1/embeddings',
        {
          model: this.model,
          input: text,
        }
      );

      if (!response.data.embedding || !Array.isArray(response.data.embedding)) {
        throw new Error('No embedding returned from LM Studio');
      }

      return response.data.embedding;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error(
          `Cannot connect to LM Studio at ${this.endpoint}. ` +
          `Make sure LM Studio is running and the server is started.`
        );
      }

      if (error.response?.status === 404) {
        throw new Error(
          `Model '${this.model}' not found in LM Studio. ` +
          `Make sure the model is loaded in LM Studio.`
        );
      }

      throw new Error(`LM Studio embedding generation failed: ${error.message}`);
    }
  }

  async generateBulkEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // LM Studio doesn't support bulk requests, so we process in parallel
    // Limit concurrency to avoid overwhelming the local server
    const concurrency = 10;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += concurrency) {
      const batch = texts.slice(i, i + concurrency);
      const batchEmbeddings = await Promise.all(
        batch.map(text => this.generateEmbedding(text))
      );
      allEmbeddings.push(...batchEmbeddings);
    }

    return allEmbeddings;
  }

  estimateCost(_tokenCount: number): number {
    return 0; // Free, runs locally
  }

  isAvailable(): boolean {
    // Always return true - we'll check connection when needed
    return true;
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
   * Check if LM Studio is running
   */
  async checkLMStudioRunning(): Promise<boolean> {
    try {
      await this.client.get('/v1/models');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if the embedding model is available
   */
  async checkModelAvailable(): Promise<boolean> {
    try {
      const response = await this.client.get<{ data: any[] }>('/v1/models');
      const models = response.data.data || [];
      return models.some(m => m.id.includes(this.model));
    } catch (error) {
      return false;
    }
  }

  /**
   * Get installation instructions
   */
  getInstallationInstructions(): {
    installLMStudio: string;
    loadModel: string;
    docs: string;
  } {
    return {
      installLMStudio: 'Download from https://lmstudio.ai',
      loadModel: `Load '${this.model}' model in LM Studio`,
      docs: 'https://lmstudio.ai/docs',
    };
  }

  /**
   * Get performance info
   */
  getPerformanceInfo(): {
    speed: string;
    privacy: string;
    cost: string;
    quality: string;
  } {
    return {
      speed: 'Fast (~100-500 embeddings/sec on consumer hardware)',
      privacy: '100% local - no data leaves your machine',
      cost: 'Free',
      quality: 'Good (768 dimensions, suitable for most use cases)',
    };
  }

  /**
   * Estimate embedding generation time
   */
  estimateGenerationTime(count: number): number {
    // Rough estimate: 300 embeddings per second on average hardware
    const embeddingsPerSecond = 300;
    return Math.ceil(count / embeddingsPerSecond);
  }
}


