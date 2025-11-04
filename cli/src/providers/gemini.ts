import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider, AIMessage, AIResponse, ChatOptions } from './base';

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
}
