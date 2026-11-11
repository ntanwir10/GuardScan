/**
 * model-registry.ts - Centralized Model Registry
 * 
 * Single source of truth for all AI models across providers.
 * Provides metadata, pricing, capabilities, and deprecation tracking.
 */

export interface ModelInfo {
  provider: string;
  name: string;
  displayName: string;
  version?: string;
  inputPricing: number;   // per 1M tokens
  outputPricing: number;  // per 1M tokens
  contextWindow: number;
  supportsStreaming: boolean;
  supportsEmbeddings: boolean;
  embeddingDimensions?: number;
  embeddingPricing?: number;  // per 1M tokens
  releaseDate: string;
  deprecated?: boolean;
  deprecationDate?: string;
  replacedBy?: string;
  tags: string[];  // e.g., ['coding', 'fast', 'reasoning']
}

export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  // Prices are list prices in USD per 1M tokens, checked 2026-11-11 against each
  // provider's official pricing, models and deprecations pages (cited per section).
  // Launch promotions are noted inline; the stored value is the price after the promo ends.

  // OpenAI Models — Standard tier, prompts up to 272K input tokens.
  // https://developers.openai.com/api/docs/pricing, /models, /deprecations, /changelog
  'gpt-6-astra': {
    provider: 'openai',
    name: 'gpt-6-astra',
    displayName: 'GPT-6 Astra',
    inputPricing: 10.0,
    outputPricing: 50.0,
    contextWindow: 1050000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2026-09-03',
    tags: ['reasoning', 'analysis', 'coding', 'agentic', 'latest'],
  },
  'gpt-6.1-sol': {
    provider: 'openai',
    name: 'gpt-6.1-sol',
    displayName: 'GPT-6.1 Sol',
    inputPricing: 2.0,
    outputPricing: 10.0,
    contextWindow: 1050000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2026-09-29',
    tags: ['balanced', 'reasoning', 'coding', 'agentic', 'latest'],
  },
  'gpt-6.1-terra': {
    provider: 'openai',
    name: 'gpt-6.1-terra',
    displayName: 'GPT-6.1 Terra',
    inputPricing: 1.0,
    outputPricing: 5.0,
    contextWindow: 1050000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2026-10-26',
    tags: ['balanced', 'coding', 'cost-efficient', 'latest'],
  },
  'gpt-6-luna': {
    provider: 'openai',
    name: 'gpt-6-luna',
    displayName: 'GPT-6 Luna',
    inputPricing: 0.1,
    outputPricing: 0.5,
    contextWindow: 1050000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2026-09-22',
    tags: ['fast', 'cost-efficient', 'lightweight', 'latest'],
  },
  // Shuts down 2027-04-01. OpenAI names gpt-6-sol, whose page points to gpt-6.1-sol as the newer Sol.
  'gpt-5.1': {
    provider: 'openai',
    name: 'gpt-5.1',
    displayName: 'GPT-5.1',
    inputPricing: 1.25,
    outputPricing: 10.0,
    contextWindow: 400000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2025-11-13',
    deprecated: true,
    deprecationDate: '2026-10-01',
    replacedBy: 'gpt-6.1-sol',
    tags: ['reasoning', 'coding', 'agentic'],
  },
  // Shuts down 2027-01-14.
  'gpt-4o': {
    provider: 'openai',
    name: 'gpt-4o',
    displayName: 'GPT-4o',
    inputPricing: 2.5,
    outputPricing: 10.0,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2024-05-13',
    deprecated: true,
    deprecationDate: '2026-10-14',
    replacedBy: 'gpt-6-luna',
    tags: ['multimodal', 'fast', 'balanced', 'coding'],
  },
  // Shuts down 2027-01-14.
  'gpt-4.1-mini': {
    provider: 'openai',
    name: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini',
    inputPricing: 0.4,
    outputPricing: 1.6,
    contextWindow: 1047576,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2025-04-14',
    deprecated: true,
    replacedBy: 'gpt-6-luna',
    tags: ['fast', 'cost-efficient', 'lightweight'],
  },
  'text-embedding-3-small': {
    provider: 'openai',
    name: 'text-embedding-3-small',
    displayName: 'Text Embedding 3 Small',
    inputPricing: 0.02,
    outputPricing: 0,
    contextWindow: 8191,
    supportsStreaming: false,
    supportsEmbeddings: true,
    embeddingDimensions: 1536,
    embeddingPricing: 0.02,
    releaseDate: '2024-01-25',
    tags: ['embeddings', 'cost-efficient'],
  },
  'text-embedding-3-large': {
    provider: 'openai',
    name: 'text-embedding-3-large',
    displayName: 'Text Embedding 3 Large',
    inputPricing: 0.13,
    outputPricing: 0,
    contextWindow: 8191,
    supportsStreaming: false,
    supportsEmbeddings: true,
    embeddingDimensions: 3072,
    embeddingPricing: 0.13,
    releaseDate: '2024-01-25',
    tags: ['embeddings', 'high-quality'],
  },

  // Gemini Models — Paid tier, Standard, text input.
  // https://aistudio.google.com/docs/pricing, /models, /deprecations
  // Launch price $2.00 / $10.00 through 2026-11-30.
  'gemini-4-carbon': {
    provider: 'gemini',
    name: 'gemini-4-carbon',
    displayName: 'Gemini 4 Carbon',
    inputPricing: 4.0,
    outputPricing: 20.0,
    contextWindow: 1048576,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2026-11-10',
    tags: ['reasoning', 'analysis', 'coding', 'multimodal', 'large-context', 'latest'],
  },
  // Launch price $2.00 / $10.00 through 2026-11-30.
  'gemini-4-argon': {
    provider: 'gemini',
    name: 'gemini-4-argon',
    displayName: 'Gemini 4 Argon',
    inputPricing: 4.0,
    outputPricing: 20.0,
    contextWindow: 1048576,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2026-10-13',
    tags: ['balanced', 'coding', 'multimodal', 'large-context', 'latest'],
  },
  // Launch price $0.75 / $3.75 through 2026-12-31.
  'gemini-3.8-flash': {
    provider: 'gemini',
    name: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash',
    inputPricing: 1.5,
    outputPricing: 7.5,
    contextWindow: 1048576,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2026-09-02',
    tags: ['fast', 'balanced', 'coding', 'large-context'],
  },
  'gemini-3.5-flash-lite': {
    provider: 'gemini',
    name: 'gemini-3.5-flash-lite',
    displayName: 'Gemini 3.5 Flash-Lite',
    inputPricing: 0.3,
    outputPricing: 2.5,
    contextWindow: 1048576,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2026-07-21',
    tags: ['fast', 'cost-efficient', 'lightweight', 'large-context'],
  },
  // Shuts down 2026-12-01; requests then route to gemini-3.8-flash. Prompts up to 200K tokens.
  'gemini-2.5-pro': {
    provider: 'gemini',
    name: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    inputPricing: 1.25,
    outputPricing: 10.0,
    contextWindow: 1048576,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2025-06-17',
    deprecated: true,
    replacedBy: 'gemini-3.8-flash',
    tags: ['reasoning', 'coding', 'analysis', 'large-context'],
  },
  // Shuts down 2026-12-01; requests then route to gemini-3.5-flash-lite.
  'gemini-2.5-flash': {
    provider: 'gemini',
    name: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    inputPricing: 0.3,
    outputPricing: 2.5,
    contextWindow: 1048576,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2025-06-17',
    deprecated: true,
    replacedBy: 'gemini-3.5-flash-lite',
    tags: ['fast', 'balanced', 'coding', 'large-context'],
  },

  // Claude Models — base input/output price.
  // https://platform.claude.com/docs/en/about-claude/pricing, /models/overview, /model-deprecations,
  // release dates from https://platform.claude.com/docs/en/release-notes/overview
  'claude-fable-5-2': {
    provider: 'claude',
    name: 'claude-fable-5-2',
    displayName: 'Claude Fable 5.2',
    inputPricing: 8.0,
    outputPricing: 40.0,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2026-11-09',
    tags: ['reasoning', 'analysis', 'coding', 'agentic', 'latest'],
  },
  'claude-opus-5-5': {
    provider: 'claude',
    name: 'claude-opus-5-5',
    displayName: 'Claude Opus 5.5',
    inputPricing: 4.0,
    outputPricing: 20.0,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2026-09-22',
    tags: ['reasoning', 'analysis', 'coding', 'quality', 'latest'],
  },
  'claude-sonnet-5-5': {
    provider: 'claude',
    name: 'claude-sonnet-5-5',
    displayName: 'Claude Sonnet 5.5',
    inputPricing: 2.0,
    outputPricing: 10.0,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2026-09-28',
    tags: ['balanced', 'reasoning', 'coding', 'latest'],
  },
  // Prompts up to 100K tokens; longer prompts cost $0.50 / $2.50.
  'claude-haiku-5-5': {
    provider: 'claude',
    name: 'claude-haiku-5-5',
    displayName: 'Claude Haiku 5.5',
    inputPricing: 0.1,
    outputPricing: 0.5,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2026-10-07',
    tags: ['fast', 'cost-efficient', 'lightweight', 'latest'],
  },

  // Ollama models (local, free)
  'codellama': {
    provider: 'ollama',
    name: 'codellama',
    displayName: 'Code Llama',
    inputPricing: 0,
    outputPricing: 0,
    contextWindow: 4096,
    supportsStreaming: true,
    supportsEmbeddings: true,
    embeddingDimensions: 768,
    embeddingPricing: 0,
    releaseDate: '2023-08-24',
    tags: ['coding', 'local', 'free', 'privacy'],
  },
  'llama2': {
    provider: 'ollama',
    name: 'llama2',
    displayName: 'Llama 2',
    inputPricing: 0,
    outputPricing: 0,
    contextWindow: 4096,
    supportsStreaming: true,
    supportsEmbeddings: true,
    embeddingDimensions: 768,
    embeddingPricing: 0,
    releaseDate: '2023-07-18',
    tags: ['general', 'local', 'free', 'privacy'],
  },
  'mistral': {
    provider: 'ollama',
    name: 'mistral',
    displayName: 'Mistral',
    inputPricing: 0,
    outputPricing: 0,
    contextWindow: 8192,
    supportsStreaming: true,
    supportsEmbeddings: true,
    embeddingDimensions: 768,
    embeddingPricing: 0,
    releaseDate: '2023-09-27',
    tags: ['general', 'local', 'free', 'privacy'],
  },
};

/**
 * Model Registry class with helper methods
 */
export class ModelRegistry {
  private static instance: ModelRegistry;

  private constructor() {}

  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  /**
   * Get model information by name
   */
  getModelInfo(modelName: string): ModelInfo | undefined {
    return MODEL_REGISTRY[modelName];
  }

  /**
   * List all models for a provider
   */
  listProviderModels(provider: string): ModelInfo[] {
    return Object.values(MODEL_REGISTRY).filter(
      (model) => model.provider === provider
    );
  }

  /**
   * Find models by tags
   */
  findModelsByTag(tags: string[], matchAll: boolean = false): ModelInfo[] {
    return Object.values(MODEL_REGISTRY).filter((model) => {
      if (matchAll) {
        return tags.every((tag) => model.tags.includes(tag));
      } else {
        return tags.some((tag) => model.tags.includes(tag));
      }
    });
  }

  /**
   * Get all models
   */
  getAllModels(): ModelInfo[] {
    return Object.values(MODEL_REGISTRY);
  }

  /**
   * Get non-deprecated models
   */
  getActiveModels(): ModelInfo[] {
    return Object.values(MODEL_REGISTRY).filter((model) => !model.deprecated);
  }

  /**
   * Get deprecated models
   */
  getDeprecatedModels(): ModelInfo[] {
    return Object.values(MODEL_REGISTRY).filter((model) => model.deprecated);
  }

  /**
   * Search models by name or display name
   */
  searchModels(query: string): ModelInfo[] {
    const lowerQuery = query.toLowerCase();
    return Object.values(MODEL_REGISTRY).filter(
      (model) =>
        model.name.toLowerCase().includes(lowerQuery) ||
        model.displayName.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get models sorted by pricing (cheapest first)
   */
  getModelsByPrice(provider?: string): ModelInfo[] {
    const models = provider
      ? this.listProviderModels(provider)
      : this.getAllModels();

    return models.sort((a, b) => {
      const costA = a.inputPricing + a.outputPricing;
      const costB = b.inputPricing + b.outputPricing;
      return costA - costB;
    });
  }

  /**
   * Get models sorted by context window (largest first)
   */
  getModelsByContextWindow(provider?: string): ModelInfo[] {
    const models = provider
      ? this.listProviderModels(provider)
      : this.getAllModels();

    return models.sort((a, b) => b.contextWindow - a.contextWindow);
  }

  /**
   * Check if a model exists
   */
  modelExists(modelName: string): boolean {
    return modelName in MODEL_REGISTRY;
  }

  /**
   * Get embedding models
   */
  getEmbeddingModels(provider?: string): ModelInfo[] {
    const models = provider
      ? this.listProviderModels(provider)
      : this.getAllModels();

    return models.filter((model) => model.supportsEmbeddings);
  }

  /**
   * Get chat models
   */
  getChatModels(provider?: string): ModelInfo[] {
    const models = provider
      ? this.listProviderModels(provider)
      : this.getAllModels();

    return models.filter((model) => !model.supportsEmbeddings || model.embeddingDimensions === undefined);
  }
}

// Export singleton instance
export const modelRegistry = ModelRegistry.getInstance();
