import Anthropic from '@anthropic-ai/sdk';
import {
  AIProvider,
  AIMessage,
  AIResponse,
  ChatOptions,
  ProviderCapabilities,
  CostEstimate
} from './base';

export class ClaudeProvider extends AIProvider {
  private client: Anthropic;
  private defaultModel = 'claude-sonnet-4.5'; // Will be overridden by config if user selects different model

  constructor(apiKey?: string, model?: string) {
    super(apiKey);
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    if (model) {
      this.defaultModel = model;
    }
  }

  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    // Separate system messages from user/assistant messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const response = await (this.client as any).messages.create({
      model: options?.model || this.defaultModel,
      max_tokens: options?.maxTokens || 4000,
      temperature: options?.temperature || 0.7,
      system: systemMessages.map(m => m.content).join('\n'),
      messages: conversationMessages.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      stream: options?.stream || false,
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    return {
      content: content.text,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
    };
  }

  isAvailable(): boolean {
    return !!(this.apiKey || process.env.ANTHROPIC_API_KEY);
  }

  getName(): string {
    return 'Claude';
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
      supportsEmbeddings: false, // Claude doesn't support embeddings natively - uses ClaudeEmbeddingProvider with Ollama/LM Studio fallback
      supportsStreaming: true,
      maxContextTokens: 200000, // Claude 4.5 models context window
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
        input: 3.0,   // $3 per 1M tokens for Claude Sonnet 4.5 input
        output: 15.0, // $15 per 1M tokens for Claude Sonnet 4.5 output
      },
    };
  }

  /**
   * Get pricing for specific model
   */
  private getModelPricing(model: string): { input: number; output: number } {
    // Claude API uses format: claude-{tier}-{version} or claude-{tier}-{version}-{date}
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-opus-4.5': { input: 15.0, output: 75.0 }, // Most intelligent and capable
      'claude-sonnet-4.5': { input: 3.0, output: 15.0 }, // Balanced performance and practicality
      'claude-haiku-4.5': { input: 0.25, output: 1.25 }, // Fastest and most cost-effective
      // Fallback to API format if needed
      'claude-4-opus': { input: 15.0, output: 75.0 },
      'claude-4-sonnet': { input: 3.0, output: 15.0 },
      'claude-4-haiku': { input: 0.25, output: 1.25 },
    };

    return pricing[model] || pricing['claude-sonnet-4.5'];
  }
}
