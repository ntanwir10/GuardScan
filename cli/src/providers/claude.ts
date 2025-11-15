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
  private defaultModel = 'claude-3-5-sonnet-20241022';

  constructor(apiKey?: string) {
    super(apiKey);
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
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
      supportsEmbeddings: false, // Claude doesn't support embeddings
      supportsStreaming: true,
      maxContextTokens: 200000, // Claude 3.5 Sonnet context window
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
        input: 3.0,   // $3 per 1M tokens for Claude 3.5 Sonnet input
        output: 15.0, // $15 per 1M tokens for Claude 3.5 Sonnet output
      },
    };
  }

  /**
   * Get pricing for specific model
   */
  private getModelPricing(model: string): { input: number; output: number } {
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
      'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
      'claude-3-sonnet-20240229': { input: 3.0, output: 15.0 },
      'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
    };

    return pricing[model] || pricing['claude-3-5-sonnet-20241022'];
  }
}
