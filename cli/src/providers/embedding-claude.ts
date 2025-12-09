/**
 * embedding-claude.ts - Claude Embedding Provider
 *
 * Claude does not support native embeddings, so this provider wraps
 * either Ollama or LM Studio as a fallback.
 * Uses nomic-embed-text model (768 dimensions) via fallback provider
 */

import { BaseEmbeddingProvider, EmbeddingProvider } from '../core/embeddings';
import { OllamaEmbeddingProvider } from './embedding-ollama';
import { LMStudioEmbeddingProvider } from './embedding-lmstudio';

export class ClaudeEmbeddingProvider extends BaseEmbeddingProvider {
  private fallbackProvider: EmbeddingProvider;
  private fallbackType: 'ollama' | 'lmstudio';

  constructor(fallbackProvider: 'ollama' | 'lmstudio', endpoint?: string) {
    super(
      `claude (via ${fallbackProvider})`,
      'nomic-embed-text',
      768
    );

    this.fallbackType = fallbackProvider;

    if (fallbackProvider === 'lmstudio') {
      this.fallbackProvider = new LMStudioEmbeddingProvider(endpoint);
    } else {
      this.fallbackProvider = new OllamaEmbeddingProvider(endpoint);
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      return await this.fallbackProvider.generateEmbedding(text);
    } catch (error: any) {
      const providerName = this.fallbackType === 'ollama' ? 'Ollama' : 'LM Studio';
      if (error.message?.includes('ECONNREFUSED') || error.message?.includes('Cannot connect')) {
        throw new Error(
          `Claude requires ${providerName} for embeddings, but ${providerName} is not running.\n` +
          this.getInstallationInstructions()
        );
      }
      throw new Error(`Claude embedding generation failed (via ${this.fallbackType}): ${error.message}`);
    }
  }

  async generateBulkEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      return await this.fallbackProvider.generateBulkEmbeddings(texts);
    } catch (error: any) {
      throw new Error(`Claude bulk embedding generation failed (via ${this.fallbackType}): ${error.message}`);
    }
  }

  estimateCost(_tokenCount: number): number {
    return 0; // Free, uses local fallback
  }

  isAvailable(): boolean {
    return this.fallbackProvider.isAvailable();
  }

  async testConnection(): Promise<boolean> {
    try {
      return await this.fallbackProvider.testConnection();
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if fallback provider is running
   */
  async checkFallbackRunning(): Promise<boolean> {
    if (this.fallbackType === 'ollama') {
      const ollamaProvider = this.fallbackProvider as OllamaEmbeddingProvider;
      return await ollamaProvider.checkOllamaRunning();
    } else {
      const lmstudioProvider = this.fallbackProvider as LMStudioEmbeddingProvider;
      return await lmstudioProvider.checkLMStudioRunning();
    }
  }

  /**
   * Check if the embedding model is available
   */
  async checkModelAvailable(): Promise<boolean> {
    if (this.fallbackType === 'ollama') {
      const ollamaProvider = this.fallbackProvider as OllamaEmbeddingProvider;
      return await ollamaProvider.checkModelAvailable();
    } else {
      const lmstudioProvider = this.fallbackProvider as LMStudioEmbeddingProvider;
      return await lmstudioProvider.checkModelAvailable();
    }
  }

  /**
   * Get installation instructions
   */
  getInstallationInstructions(): string {
    if (this.fallbackType === 'ollama') {
      const ollamaProvider = this.fallbackProvider as OllamaEmbeddingProvider;
      const instructions = ollamaProvider.getInstallationInstructions();
      return `Install Ollama: ${instructions.installOllama}\n` +
             `Pull model: ${instructions.pullModel}\n` +
             `Docs: ${instructions.docs}`;
    } else {
      const lmstudioProvider = this.fallbackProvider as LMStudioEmbeddingProvider;
      const instructions = lmstudioProvider.getInstallationInstructions();
      return `Install LM Studio: ${instructions.installLMStudio}\n` +
             `Load model: ${instructions.loadModel}\n` +
             `Docs: ${instructions.docs}`;
    }
  }
}


