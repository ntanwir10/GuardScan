import { AIProvider } from './base';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';
import { GeminiProvider } from './gemini';
import { OllamaProvider } from './ollama';
import { AIProvider as ProviderType } from '../core/config';

export class ProviderFactory {
  static create(provider: ProviderType, apiKey?: string, endpoint?: string, model?: string): AIProvider {
    switch (provider) {
      case 'openai':
        return new OpenAIProvider(apiKey, model);
      case 'claude':
        return new ClaudeProvider(apiKey, model);
      case 'gemini':
        return new GeminiProvider(apiKey, model);
      case 'ollama':
        return new OllamaProvider(endpoint);
      case 'lmstudio':
        return new OllamaProvider(endpoint || 'http://localhost:1234');
      case 'openrouter':
        return new OpenAIProvider(apiKey, model); // OpenRouter uses OpenAI-compatible API
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  static getAvailableProviders(): ProviderType[] {
    return ['openai', 'claude', 'gemini', 'ollama', 'lmstudio', 'openrouter'];
  }
}
