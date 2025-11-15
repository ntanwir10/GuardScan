import axios from 'axios';
import {
  AIProvider,
  AIMessage,
  AIResponse,
  ChatOptions,
  ProviderCapabilities,
  CostEstimate
} from './base';

export class OllamaProvider extends AIProvider {
  private defaultModel = 'codellama';
  private endpoint: string;

  constructor(endpoint?: string) {
    super(undefined, endpoint);
    this.endpoint = endpoint || process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
  }

  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    const response = await axios.post(`${this.endpoint}/api/chat`, {
      model: options?.model || this.defaultModel,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: options?.stream || false,
    });

    return {
      content: response.data.message.content,
      model: options?.model || this.defaultModel,
    };
  }

  isAvailable(): boolean {
    return true; // Ollama is always available if running locally
  }

  getName(): string {
    return 'Ollama';
  }

  async testConnection(): Promise<boolean> {
    try {
      await axios.get(`${this.endpoint}/api/tags`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsChat: true,
      supportsEmbeddings: true, // Ollama supports embeddings via /api/embeddings
      supportsStreaming: true,
      maxContextTokens: 4096, // Varies by model, codellama default
      embeddingDimensions: 768, // Varies by model
    };
  }

  /**
   * Generate embedding using Ollama's API
   */
  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    const embeddingModel = model || this.defaultModel;

    const response = await axios.post(`${this.endpoint}/api/embeddings`, {
      model: embeddingModel,
      prompt: text,
    });

    return response.data.embedding;
  }

  /**
   * Estimate chat API cost (always free for local Ollama)
   */
  estimateChatCost(messages: AIMessage[], options?: ChatOptions): CostEstimate {
    return {
      promptCost: 0,
      completionCost: 0,
      totalCost: 0,
      currency: 'USD',
    };
  }

  /**
   * Estimate embedding API cost (always free for local Ollama)
   */
  estimateEmbeddingCost(textCount: number, avgLength: number): CostEstimate {
    return {
      promptCost: 0,
      completionCost: 0,
      totalCost: 0,
      currency: 'USD',
    };
  }

  /**
   * Get pricing (free for local Ollama)
   */
  getPricing() {
    return {
      chat: {
        input: 0,
        output: 0,
      },
      embeddings: {
        input: 0,
      },
    };
  }
}
