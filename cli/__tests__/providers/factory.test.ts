import { ProviderFactory } from '../../src/providers/factory';
import { OpenAIProvider } from '../../src/providers/openai';
import { ClaudeProvider } from '../../src/providers/claude';
import { GeminiProvider } from '../../src/providers/gemini';
import { OllamaProvider } from '../../src/providers/ollama';

describe('ProviderFactory', () => {
  describe('create', () => {
    it('should create OpenAI provider', () => {
      const provider = ProviderFactory.create('openai', 'test-key');
      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.getName()).toBe('OpenAI');
    });

    it('should create Claude provider', () => {
      const provider = ProviderFactory.create('claude', 'test-key');
      expect(provider).toBeInstanceOf(ClaudeProvider);
      expect(provider.getName()).toBe('Claude');
    });

    it('should create Gemini provider', () => {
      const provider = ProviderFactory.create('gemini', 'test-key');
      expect(provider).toBeInstanceOf(GeminiProvider);
      expect(provider.getName()).toBe('Gemini');
    });

    it('should create Ollama provider', () => {
      const provider = ProviderFactory.create('ollama', undefined, 'http://localhost:11434');
      expect(provider).toBeInstanceOf(OllamaProvider);
      expect(provider.getName()).toBe('Ollama');
    });

    it('should create LM Studio provider (Ollama-compatible)', () => {
      const provider = ProviderFactory.create('lmstudio', undefined, 'http://localhost:1234');
      expect(provider).toBeInstanceOf(OllamaProvider);
    });

    it('should create OpenRouter provider (OpenAI-compatible)', () => {
      const provider = ProviderFactory.create('openrouter', 'test-key');
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it('should throw error for unknown provider', () => {
      expect(() => {
        ProviderFactory.create('unknown' as any, 'test-key');
      }).toThrow('Unknown provider: unknown');
    });
  });

  describe('getAvailableProviders', () => {
    it('should return all available providers', () => {
      const providers = ProviderFactory.getAvailableProviders();

      expect(providers).toContain('openai');
      expect(providers).toContain('claude');
      expect(providers).toContain('gemini');
      expect(providers).toContain('ollama');
      expect(providers).toContain('lmstudio');
      expect(providers).toContain('openrouter');
      expect(providers).toHaveLength(6);
    });
  });
});
