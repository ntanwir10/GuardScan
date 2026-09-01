import OpenAI from 'openai';
import { tokenCounter } from './token-counter';
import {
  AIProvider,
  AIMessage,
  AIResponse,
  ChatOptions,
  ProviderCapabilities,
  CostEstimate
} from './base';

export interface OpenAICompatibleProfile {
  providerName: string;
  defaultModel?: string;
  defaultEmbeddingModel?: string;
  capabilities: ProviderCapabilities;
  pricing?: {
    chat: {
      input: number;
      output: number;
    };
    embeddings?: {
      input: number;
    };
  };
  modelPricing?: Record<string, { input: number; output: number }>;
}

const OPENAI_PROFILE: OpenAICompatibleProfile = {
  providerName: 'OpenAI',
  defaultModel: 'gpt-4o',
  defaultEmbeddingModel: 'text-embedding-3-small',
  capabilities: {
    supportsChat: true,
    supportsEmbeddings: true,
    supportsStreaming: true,
    maxContextTokens: 128000,
    embeddingDimensions: 1536,
  },
  pricing: {
    chat: {
      input: 0.0025,
      output: 0.01,
    },
    embeddings: {
      input: 0.00002,
    },
  },
  modelPricing: {
    'gpt-5.1': { input: 0.005, output: 0.02 },
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4.1-mini': { input: 0.00015, output: 0.0006 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  },
};

export class OpenAIProvider extends AIProvider {
  private client: OpenAI;
  private defaultModel = 'gpt-4o';
  private defaultEmbeddingModel = 'text-embedding-3-small';
  private profile: OpenAICompatibleProfile;

  constructor(
    apiKey?: string,
    model?: string,
    apiEndpoint?: string,
    providerName: string = 'OpenAI',
    profile?: Partial<OpenAICompatibleProfile>
  ) {
    super(apiKey, apiEndpoint);
    const hasCustomPricing = Object.prototype.hasOwnProperty.call(
      profile || {},
      'pricing'
    );
    this.profile = {
      ...OPENAI_PROFILE,
      ...profile,
      providerName: profile?.providerName || providerName,
      capabilities: {
        ...OPENAI_PROFILE.capabilities,
        ...profile?.capabilities,
      },
      pricing: hasCustomPricing ? profile?.pricing : OPENAI_PROFILE.pricing,
      modelPricing: profile?.modelPricing || OPENAI_PROFILE.modelPricing,
    };
    this.defaultModel = this.profile.defaultModel || this.defaultModel;
    this.defaultEmbeddingModel =
      this.profile.defaultEmbeddingModel || this.defaultEmbeddingModel;
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
      baseURL: apiEndpoint,
      fetch: (url, init) => globalThis.fetch(url, {...init, redirect: 'error'}),
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
      stream: false,
    });

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

  /**
   * Stream chat completion
   */
  async *stream(
    messages: AIMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    const stream = await this.client.chat.completions.create({
      model: options?.model || this.defaultModel,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      temperature: options?.temperature || 0.7,
      max_tokens: options?.maxTokens || 4000,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  isAvailable(): boolean {
    return !!(this.apiKey || process.env.OPENAI_API_KEY);
  }

  getName(): string {
    return this.profile.providerName;
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
    return this.profile.capabilities;
  }

  /**
   * Generate embedding using OpenAI's API
   */
  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    if (!this.profile.capabilities.supportsEmbeddings) {
      throw new Error(`${this.getName()} embedding support is model-dependent. Configure an explicit embedding provider.`);
    }

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
    if (!this.profile.capabilities.supportsEmbeddings) {
      throw new Error(`${this.getName()} embedding support is model-dependent. Configure an explicit embedding provider.`);
    }

    const embeddingModel = model || this.defaultEmbeddingModel;

    const response = await this.client.embeddings.create({
      model: embeddingModel,
      input: texts,
    });

    return response.data.map(item => item.embedding);
  }

  /**
   * Count tokens accurately using tiktoken (if available)
   */
  countTokens(text: string): number {
    const result = tokenCounter.countTokens(text, this.defaultModel);
    return result.count;
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
    return this.profile.pricing || {
      chat: {
        input: 0,
        output: 0,
      },
    };
  }

  /**
   * Get pricing for specific model
   */
  private getModelPricing(model: string): { input: number; output: number } {
    return this.profile.modelPricing?.[model] || this.getPricing().chat;
  }
}
