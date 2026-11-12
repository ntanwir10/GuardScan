/**
 * Provider prices come from the model registry, in USD per 1M tokens.
 */

import { ClaudeProvider } from '../../src/providers/claude';
import { GeminiProvider } from '../../src/providers/gemini';
import { OpenAIProvider } from '../../src/providers/openai';
import { DEFAULT_MODELS, MODEL_REGISTRY } from '../../src/providers/model-registry';

const listed = (id: string) => ({
  input: MODEL_REGISTRY[id].inputPricing,
  output: MODEL_REGISTRY[id].outputPricing,
});

describe('provider pricing', () => {
  it('prices each provider default model from the registry', () => {
    expect(new OpenAIProvider('key').getPricing().chat).toEqual(listed(DEFAULT_MODELS.openai));
    expect(new ClaudeProvider('key').getPricing().chat).toEqual(listed(DEFAULT_MODELS.claude));
    expect(new GeminiProvider('key').getPricing().chat).toEqual(listed(DEFAULT_MODELS.gemini));
  });

  it('prices the configured model, including saved dotted Claude ids', () => {
    expect(new OpenAIProvider('key', 'gpt-6-luna').getPricing().chat).toEqual(listed('gpt-6-luna'));
    expect(new ClaudeProvider('key', 'claude-haiku-5.5').getPricing().chat).toEqual(listed('claude-haiku-5-5'));
    expect(new GeminiProvider('key', 'gemini-3.8-flash').getPricing().chat).toEqual(listed('gemini-3.8-flash'));
  });

  it('prices ids the registry does not list for the provider as its default model', () => {
    expect(new OpenAIProvider('key', 'gpt-3.5-turbo').getPricing().chat).toEqual(listed(DEFAULT_MODELS.openai));
    expect(new ClaudeProvider('key', 'claude-sonnet-4-5-20250929').getPricing().chat)
      .toEqual(listed(DEFAULT_MODELS.claude));
    expect(new GeminiProvider('key', 'gpt-6-luna').getPricing().chat).toEqual(listed(DEFAULT_MODELS.gemini));
  });

  it('estimates OpenAI chat cost per 1M tokens', () => {
    const provider = new OpenAIProvider('key', 'gpt-6.1-sol');
    jest.spyOn(provider, 'countMessagesTokens').mockReturnValue(1_000_000);
    const { input, output } = listed('gpt-6.1-sol');

    const estimate = provider.estimateChatCost([{ role: 'user', content: 'hi' }], { maxTokens: 2_000_000 });

    expect(estimate).toEqual({
      promptCost: input,
      completionCost: 2 * output,
      totalCost: input + 2 * output,
      currency: 'USD',
    });
  });

  it('estimates OpenAI embedding cost per 1M tokens', () => {
    const provider = new OpenAIProvider('key');
    jest.spyOn(provider, 'countTokens').mockReturnValue(1000);

    // 1,000 texts x 1,000 tokens = 1M tokens
    expect(provider.estimateEmbeddingCost(1000, 10).totalCost)
      .toBeCloseTo(MODEL_REGISTRY['text-embedding-3-small'].embeddingPricing ?? NaN);
  });
});
