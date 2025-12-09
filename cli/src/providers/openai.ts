import OpenAI from 'openai';
import {
  AIProvider,
  AIMessage,
  AIResponse,
  ChatOptions,
  ProviderCapabilities,
  CostEstimate
} from './base';

export class OpenAIProvider extends AIProvider {
  private client: OpenAI;
  private defaultModel = 'gpt-4o';
  private defaultEmbeddingModel = 'text-embedding-3-small';

  constructor(apiKey?: string, model?: string) {
    super(apiKey);
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
    if (model) {
      this.defaultModel = model;
    }
  }

  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    const response = await this.client.chat.completions.create({
      model: options?.model || this.defaultModel,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      temperature: options?.temperature || 0.7,
      max_tokens: options?.maxTokens || 4000,
      stream: options?.stream || false,
    });

    // Type narrowing: check if response is not a stream
    if (Symbol.asyncIterator in response) {
      throw new Error('Streaming responses are not supported in this method');
    }

    const chatCompletion = response as OpenAI.Chat.Completions.ChatCompletion;
    const choice = chatCompletion.choices[0];
    if (!choice?.message?.content) {
      throw new Error('No response from OpenAI');
    }

    return {
      content: choice.message.content,
      usage: chatCompletion.usage ? {
        promptTokens: chatCompletion.usage.prompt_tokens,
        completionTokens: chatCompletion.usage.completion_tokens,
        totalTokens: chatCompletion.usage.total_tokens,
      } : undefined,
      model: chatCompletion.model,
    };
  }

  isAvailable(): boolean {
    return !!(this.apiKey || process.env.OPENAI_API_KEY);
  }

  getName(): string {
    return 'OpenAI';
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.chat([{ role: 'user', content: 'test' }], { maxTokens: 10 });
      return true;
    } catch {
      return false;
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsChat: true,
      supportsEmbeddings: true,
      supportsStreaming: true,
      maxContextTokens: 128000, // gpt-4o/gpt-5.1 context window
      embeddingDimensions: 1536, // text-embedding-3-small
    };
  }

  /**
   * Generate embedding using OpenAI's API
   */
  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    const embeddingModel = model || this.defaultEmbeddingModel;

    const response = await this.client.embeddings.create({
      model: embeddingModel,
      input: text,
    });

    return response.data[0].embedding;
  }

  /**
   * Generate embeddings in batch (more efficient)
   */
  async generateBulkEmbeddings(texts: string[], model?: string): Promise<number[][]> {
    const embeddingModel = model || this.defaultEmbeddingModel;

    const response = await this.client.embeddings.create({
      model: embeddingModel,
      input: texts,
    });

    return response.data.map(item => item.embedding);
  }

  /**
   * Count tokens accurately (rough estimate without tiktoken dependency)
   */
  countTokens(text: string): number {
    // More accurate estimate based on OpenAI's tokenization
    // Average: ~4 characters per token for English text
    // Add slight overhead for special characters and formatting
    const charCount = text.length;
    const wordCount = text.split(/\s+/).length;

    // Heuristic: use word count if available, otherwise char count
    if (wordCount > 0) {
      return Math.ceil(wordCount * 1.3); // ~1.3 tokens per word
    }

    return Math.ceil(charCount / 4);
  }

  /**
   * Estimate chat API cost
   */
  estimateChatCost(messages: AIMessage[], options?: ChatOptions): CostEstimate {
    const model = options?.model || this.defaultModel;
    const pricing = this.getModelPricing(model);

    const promptTokens = this.countMessagesTokens(messages);
    const completionTokens = options?.maxTokens || 1000; // Estimate

    const promptCost = (promptTokens / 1000) * pricing.input;
    const completionCost = (completionTokens / 1000) * pricing.output;

    return {
      promptCost,
      completionCost,
      totalCost: promptCost + completionCost,
      currency: 'USD',
    };
  }

  /**
   * Estimate embedding API cost
   */
  estimateEmbeddingCost(textCount: number, avgLength: number): CostEstimate {
    const pricing = this.getPricing();
    const tokensPerText = this.countTokens('a'.repeat(avgLength));
    const totalTokens = textCount * tokensPerText;

    const cost = (totalTokens / 1000) * (pricing.embeddings?.input || 0);

    return {
      promptCost: cost,
      completionCost: 0,
      totalCost: cost,
      currency: 'USD',
    };
  }

  /**
   * Get pricing for current default models
   */
  getPricing() {
    return {
      chat: {
        input: 0.0025,   // $2.50 per 1M tokens for gpt-4o input
        output: 0.01,    // $10 per 1M tokens for gpt-4o output
      },
      embeddings: {
        input: 0.00002,  // $0.02 per 1M tokens for text-embedding-3-small
      },
    };
  }

  /**
   * Get pricing for specific model
   */
  private getModelPricing(model: string): { input: number; output: number } {
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-5.1': { input: 0.005, output: 0.02 }, // Newest, coding and agentic tasks (estimated)
      'gpt-4o': { input: 0.0025, output: 0.01 }, // Multimodal, low-latency
      'gpt-4.1-mini': { input: 0.00015, output: 0.0006 }, // Fast, efficient, improvement over gpt-4o-mini
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 }, // Faster, lighter, basic tasks
    };

    return pricing[model] || pricing['gpt-4o'];
  }
}
