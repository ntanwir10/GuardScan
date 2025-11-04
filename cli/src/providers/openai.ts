import OpenAI from 'openai';
import { AIProvider, AIMessage, AIResponse, ChatOptions } from './base';

export class OpenAIProvider extends AIProvider {
  private client: OpenAI;
  private defaultModel = 'gpt-4o';

  constructor(apiKey?: string) {
    super(apiKey);
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
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
    });

    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error('No response from OpenAI');
    }

    return {
      content: choice.message.content,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      model: response.model,
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
}
