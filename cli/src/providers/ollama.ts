import axios from 'axios';
import { AIProvider, AIMessage, AIResponse, ChatOptions } from './base';

export class OllamaProvider extends AIProvider {
  private defaultModel = 'codellama';
  private endpoint: string;

  constructor(endpoint?: string) {
    super(undefined, endpoint);
    this.endpoint = endpoint || process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
  }

  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    const response = await axios.post(`${this.endpoint}/api/chat`, {
      model: options?.model || this.defaultModel,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: false,
    });

    return {
      content: response.data.message.content,
      model: options?.model || this.defaultModel,
    };
  }

  isAvailable(): boolean {
    return true; // Ollama is always available if running locally
  }

  getName(): string {
    return 'Ollama';
  }

  async testConnection(): Promise<boolean> {
    try {
      await axios.get(`${this.endpoint}/api/tags`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
