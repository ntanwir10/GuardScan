import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  AIProvider,
  AIMessage,
  AIResponse,
  ChatOptions,
  ProviderCapabilities,
  CostEstimate
} from './base';

export class GeminiProvider extends AIProvider {
  private client: GoogleGenerativeAI;
  private defaultModel = 'gemini-pro';

  constructor(apiKey?: string) {
    super(apiKey);
    const key = apiKey || process.env.GOOGLE_API_KEY;
    if (!key) {
      throw new Error('Google API key is required');
    }
    this.client = new GoogleGenerativeAI(key);
  }

  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    const model = this.client.getGenerativeModel({
      model: options?.model || this.defaultModel
    });

    // Convert messages to Gemini format
    const history = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const lastMessage = messages[messages.length - 1];

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response;

    return {
      content: response.text(),
      model: this.defaultModel,
    };
  }

  isAvailable(): boolean {
    return !!(this.apiKey || process.env.GOOGLE_API_KEY);
  }

  getName(): string {
    return 'Gemini';
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.chat([{ role: 'user', content: 'test' }]);
      return true;
    } catch {
      return false;
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsChat: true,
      supportsEmbeddings: false, // Gemini embeddings available but not implemented yet
      supportsStreaming: true,
      maxContextTokens: 32000, // Gemini Pro context window
    };
  }

  /**
   * Estimate chat API cost
   */
  estimateChatCost(messages: AIMessage[], options?: ChatOptions): CostEstimate {
    const model = options?.model || this.defaultModel;
    const pricing = this.getModelPricing(model);

    const promptTokens = this.countMessagesTokens(messages);
    const completionTokens = options?.maxTokens || 1000; // Estimate

    const promptCost = (promptTokens / 1000000) * pricing.input;
    const completionCost = (completionTokens / 1000000) * pricing.output;

    return {
      promptCost,
      completionCost,
      totalCost: promptCost + completionCost,
      currency: 'USD',
    };
  }

  /**
   * Get pricing for current default model
   */
  getPricing() {
    return {
      chat: {
        input: 0.5,   // $0.50 per 1M tokens for Gemini Pro input
        output: 1.5,  // $1.50 per 1M tokens for Gemini Pro output
      },
    };
  }

  /**
   * Get pricing for specific model
   */
  private getModelPricing(model: string): { input: number; output: number } {
    const pricing: Record<string, { input: number; output: number }> = {
      'gemini-pro': { input: 0.5, output: 1.5 },
      'gemini-1.5-pro': { input: 3.5, output: 10.5 },
      'gemini-1.5-flash': { input: 0.075, output: 0.3 },
    };

    return pricing[model] || pricing['gemini-pro'];
  }
}
