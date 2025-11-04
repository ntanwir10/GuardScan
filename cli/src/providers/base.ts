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
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}
