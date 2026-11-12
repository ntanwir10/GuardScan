import Anthropic from '@anthropic-ai/sdk';
import { tokenCounter } from './token-counter';
import {
  AIProvider,
  AIMessage,
  AIResponse,
  ChatOptions,
  ProviderCapabilities,
  CostEstimate
} from './base';
import { DEFAULT_MODELS, chatPricing } from './model-registry';

// No temperature/top_p/top_k is sent to Claude: Claude 5 and Opus 4.7+ reject them with a 400.

// Claude 5-generation models always think, and thinking counts toward max_tokens
// (platform.claude.com migration guides).
// shortcut: matches by generation, extend the pattern when a new generation ships.
const CLAUDE_5_MODEL = /^claude-(fable|opus|sonnet|haiku|mythos)-5/;

function defaultMaxTokens(model: string): number {
  return CLAUDE_5_MODEL.test(model) ? 16000 : 4000;
}

// Anthropic ids never contain dots; older configs saved ids like `claude-sonnet-4.5`.
function claudeModelId(model: string): string {
  return model.replace(/\./g, '-');
}

export class ClaudeProvider extends AIProvider {
  private client: Anthropic;
  private defaultModel: string = DEFAULT_MODELS.claude; // Overridden by the configured model

  constructor(apiKey?: string, model?: string) {
    super(apiKey);
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    if (model) {
      this.defaultModel = claudeModelId(model);
    }
  }

  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    // Separate system messages from user/assistant messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const model = claudeModelId(options?.model || this.defaultModel);
    const response = (await (this.client as any).messages.create({
      model,
      max_tokens: options?.maxTokens || defaultMaxTokens(model),
      system: systemMessages.map(m => m.content).join('\n'),
      messages: conversationMessages.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      stream: false,
    })) as Anthropic.Message;

    // Models with adaptive thinking can put thinking blocks before the answer.
    const textBlocks = response.content.filter((block): block is Anthropic.TextBlock => block.type === 'text');
    if (textBlocks.length === 0) {
      throw new Error(`Unexpected response type from Claude: no text block (stop_reason: ${response.stop_reason})`);
    }

    return {
      content: textBlocks.map((block) => block.text).join(''),
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
    };
  }

  /**
   * Stream chat completion
   */
  async *stream(
    messages: AIMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string, void, unknown> {
    // Separate system messages from user/assistant messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const model = claudeModelId(options?.model || this.defaultModel);
    const stream = await (this.client as any).messages.create({
      model,
      max_tokens: options?.maxTokens || defaultMaxTokens(model),
      system: systemMessages.map(m => m.content).join('\n'),
      messages: conversationMessages.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        yield chunk.delta.text;
      }
    }
  }

  isAvailable(): boolean {
    return !!(this.apiKey || process.env.ANTHROPIC_API_KEY);
  }

  getName(): string {
    return 'Claude';
  }

  async testConnection(): Promise<boolean> {
    try {
      // Thinking counts toward max_tokens, so a 10-token probe can stop before any text.
      const maxTokens = CLAUDE_5_MODEL.test(this.defaultModel) ? 1024 : 10;
      await this.chat([{ role: 'user', content: 'test' }], { maxTokens });
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
   * Count tokens accurately using Anthropic tokenizer (if available)
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
    return { chat: this.getModelPricing(this.defaultModel) };
  }

  /**
   * Get pricing for specific model
   */
  private getModelPricing(model: string): { input: number; output: number } {
    return chatPricing('claude', claudeModelId(model));
  }
}
