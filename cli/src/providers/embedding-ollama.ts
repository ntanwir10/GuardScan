/**
 * embedding-ollama.ts - Ollama Embedding Provider
 *
 * Uses Ollama's nomic-embed-text model (768 dimensions)
 * Cost: Free (runs locally)
 * Requires: Ollama installed locally with nomic-embed-text model pulled
 */

import axios, { AxiosInstance } from 'axios';
import { BaseEmbeddingProvider } from '../core/embeddings';

export interface OllamaEmbeddingResponse {
  embedding: number[];
}

export class OllamaEmbeddingProvider extends BaseEmbeddingProvider {
  private client: AxiosInstance;
  private endpoint: string;

  constructor(endpoint: string = 'http://localhost:11434') {
    super('ollama', 'nomic-embed-text', 768);

    this.endpoint = endpoint;
    this.client = axios.create({
      baseURL: endpoint,
      timeout: 30000, // 30 seconds per request
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.post<OllamaEmbeddingResponse>(
        '/api/embeddings',
        {
          model: this.model,
          prompt: text,
        }
      );

      if (!response.data.embedding) {
        throw new Error('No embedding returned from Ollama');
      }

      return response.data.embedding;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error(
          `Cannot connect to Ollama at ${this.endpoint}. ` +
          `Make sure Ollama is running: https://ollama.ai`
        );
      }

      if (error.response?.status === 404) {
        throw new Error(
          `Model '${this.model}' not found. Pull it with: ollama pull ${this.model}`
        );
      }

      throw new Error(`Ollama embedding generation failed: ${error.message}`);
    }
  }

  async generateBulkEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Ollama doesn't support bulk requests, so we process in parallel
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
   * Check if Ollama is running
   */
  async checkOllamaRunning(): Promise<boolean> {
    try {
      await this.client.get('/api/tags');
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
      const response = await this.client.get<{ models: any[] }>('/api/tags');
      const models = response.data.models || [];
      return models.some(m => m.name.includes(this.model));
    } catch (error) {
      return false;
    }
  }

  /**
   * Get installation instructions
   */
  getInstallationInstructions(): {
    installOllama: string;
    pullModel: string;
    docs: string;
  } {
    return {
      installOllama: 'curl https://ollama.ai/install.sh | sh',
      pullModel: `ollama pull ${this.model}`,
      docs: 'https://ollama.ai',
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
