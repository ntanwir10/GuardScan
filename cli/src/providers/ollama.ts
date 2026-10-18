import axios from 'axios';
import { tokenCounter } from './token-counter';
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
    this.endpoint = endpoint || process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
  }

  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    const response = await axios.post(`${this.endpoint}/api/chat`, {
      model: options?.model || this.defaultModel,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: false,
    }, { maxRedirects: 0 });

    return {
      content: response.data.message.content,
      model: options?.model || this.defaultModel,
    };
  }

  /**
   * Stream chat completion
   */
  async *stream(
    messages: AIMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    const response = await axios.post(
      `${this.endpoint}/api/chat`,
      {
        model: options?.model || this.defaultModel,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        stream: true,
      },
      {
        responseType: 'stream',
        maxRedirects: 0,
      }
    );

    const stream = response.data;
    let buffer = '';
    
    for await (const chunk of stream) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          const json = JSON.parse(line);
          if (json.message && json.message.content) {
            yield json.message.content;
          }
        } catch (error) {
          // Ignore malformed streaming lines so one bad chunk does not stop the generator.
        }
      }
    }

    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer);
        if (json.message && json.message.content) {
          yield json.message.content;
        }
      } catch (error) {
        // Ignore a trailing partial or malformed streaming line.
      }
    }
  }

  isAvailable(): boolean {
    return true; // Ollama is always available if running locally
  }

  getName(): string {
    return 'Ollama';
  }

  async testConnection(): Promise<boolean> {
    try {
      await axios.get(`${this.endpoint}/api/tags`, { timeout: 5000, maxRedirects: 0 });
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
   * Count tokens (uses estimation for Ollama models)
   */
  countTokens(text: string): number {
    const result = tokenCounter.countTokens(text, 'ollama');
    return result.count;
  }

  /**
   * Generate embedding using Ollama's API
   */
  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    const embeddingModel = model || this.defaultModel;

    const response = await axios.post(`${this.endpoint}/api/embeddings`, {
      model: embeddingModel,
      prompt: text,
    }, { maxRedirects: 0 });

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
