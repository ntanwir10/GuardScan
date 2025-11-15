export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface CostEstimate {
  promptCost: number;
  completionCost: number;
  totalCost: number;
  currency: string;
}

export interface ProviderCapabilities {
  supportsChat: boolean;
  supportsEmbeddings: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number;
  embeddingDimensions?: number;
}

export abstract class AIProvider {
  protected apiKey?: string;
  protected apiEndpoint?: string;

  constructor(apiKey?: string, apiEndpoint?: string) {
    this.apiKey = apiKey;
    this.apiEndpoint = apiEndpoint;
  }

  /**
   * Send messages to AI and get response
   */
  abstract chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse>;

  /**
   * Check if provider is available (has required credentials)
   */
  abstract isAvailable(): boolean;

  /**
   * Get provider name
   */
  abstract getName(): string;

  /**
   * Test connection to provider
   */
  abstract testConnection(): Promise<boolean>;

  /**
   * Get provider capabilities
   */
  abstract getCapabilities(): ProviderCapabilities;

  /**
   * Generate embedding for text
   * @param text - Text to embed
   * @param model - Optional embedding model (provider-specific)
   * @returns Embedding vector
   */
  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    throw new Error(`${this.getName()} does not support embeddings`);
  }

  /**
   * Generate embeddings for multiple texts (batch)
   * @param texts - Array of texts to embed
   * @param model - Optional embedding model (provider-specific)
   * @returns Array of embedding vectors
   */
  async generateBulkEmbeddings(texts: string[], model?: string): Promise<number[][]> {
    // Default implementation: sequential calls
    // Providers can override with batch API
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await this.generateEmbedding(text, model);
      embeddings.push(embedding);
    }
    return embeddings;
  }

  /**
   * Count tokens in text
   * @param text - Text to count
   * @returns Estimated token count
   */
  countTokens(text: string): number {
    // Default implementation: rough estimate (4 chars per token)
    // Providers should override with accurate tokenization
    return Math.ceil(text.length / 4);
  }

  /**
   * Count tokens in messages
   * @param messages - Messages to count
   * @returns Estimated token count
   */
  countMessagesTokens(messages: AIMessage[]): number {
    let total = 0;
    for (const message of messages) {
      // Count message content
      total += this.countTokens(message.content);
      // Add overhead for role and formatting (~4 tokens per message)
      total += 4;
    }
    return total;
  }

  /**
   * Estimate API cost for a chat request
   * @param messages - Messages to send
   * @param options - Chat options
   * @returns Cost estimate
   */
  estimateChatCost(messages: AIMessage[], options?: ChatOptions): CostEstimate {
    // Default implementation: returns zero
    // Providers should override with actual pricing
    return {
      promptCost: 0,
      completionCost: 0,
      totalCost: 0,
      currency: 'USD',
    };
  }

  /**
   * Estimate API cost for embedding generation
   * @param textCount - Number of texts to embed
   * @param avgLength - Average text length
   * @returns Cost estimate
   */
  estimateEmbeddingCost(textCount: number, avgLength: number): CostEstimate {
    // Default implementation: returns zero
    // Providers should override with actual pricing
    return {
      promptCost: 0,
      completionCost: 0,
      totalCost: 0,
      currency: 'USD',
    };
  }

  /**
   * Get pricing information for this provider
   */
  getPricing(): {
    chat: {
      input: number;    // Cost per 1K tokens
      output: number;   // Cost per 1K tokens
    };
    embeddings?: {
      input: number;    // Cost per 1K tokens
    };
  } {
    return {
      chat: {
        input: 0,
        output: 0,
      },
    };
  }
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  stream?: boolean;
}
