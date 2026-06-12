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
  // OpenAI Models
  'gpt-5.1': {
    provider: 'openai',
    name: 'gpt-5.1',
    displayName: 'GPT-5.1',
    inputPricing: 0.005,
    outputPricing: 0.02,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2025-06-01',
    tags: ['reasoning', 'coding', 'agentic', 'latest'],
  },
  'gpt-4o': {
    provider: 'openai',
    name: 'gpt-4o',
    displayName: 'GPT-4o',
    inputPricing: 0.0025,
    outputPricing: 0.01,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2024-05-13',
    tags: ['multimodal', 'fast', 'balanced', 'coding'],
  },
  'gpt-4.1-mini': {
    provider: 'openai',
    name: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini',
    inputPricing: 0.00015,
    outputPricing: 0.0006,
    contextWindow: 32000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2024-12-01',
    tags: ['fast', 'cost-efficient', 'lightweight'],
  },
  'gpt-3.5-turbo': {
    provider: 'openai',
    name: 'gpt-3.5-turbo',
    displayName: 'GPT-3.5 Turbo',
    inputPricing: 0.0005,
    outputPricing: 0.0015,
    contextWindow: 16000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2022-11-30',
    deprecated: true,
    deprecationDate: '2024-06-01',
    replacedBy: 'gpt-4.1-mini',
    tags: ['legacy', 'fast', 'cost-efficient'],
  },
  'text-embedding-3-small': {
    provider: 'openai',
    name: 'text-embedding-3-small',
    displayName: 'Text Embedding 3 Small',
    inputPricing: 0.00002,
    outputPricing: 0,
    contextWindow: 8191,
    supportsStreaming: false,
    supportsEmbeddings: true,
    embeddingDimensions: 1536,
    embeddingPricing: 0.00002,
    releaseDate: '2024-01-25',
    tags: ['embeddings', 'cost-efficient'],
  },
  'text-embedding-3-large': {
    provider: 'openai',
    name: 'text-embedding-3-large',
    displayName: 'Text Embedding 3 Large',
    inputPricing: 0.00013,
    outputPricing: 0,
    contextWindow: 8191,
    supportsStreaming: false,
    supportsEmbeddings: true,
    embeddingDimensions: 3072,
    embeddingPricing: 0.00013,
    releaseDate: '2024-01-25',
    tags: ['embeddings', 'high-quality'],
  },

  // Gemini Models
  'gemini-3-pro': {
    provider: 'gemini',
    name: 'gemini-3-pro',
    displayName: 'Gemini 3 Pro',
    inputPricing: 2.0,
    outputPricing: 8.0,
    contextWindow: 2000000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2025-12-01',
    tags: ['reasoning', 'multimodal', 'latest', 'large-context'],
  },
  'gemini-2.5-pro': {
    provider: 'gemini',
    name: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    inputPricing: 1.25,
    outputPricing: 5.0,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2024-12-01',
    tags: ['reasoning', 'coding', 'analysis', 'large-context'],
  },
  'gemini-2.5-flash': {
    provider: 'gemini',
    name: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    inputPricing: 0.075,
    outputPricing: 0.3,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsEmbeddings: true,
    embeddingDimensions: 768,
    embeddingPricing: 0.000025,
    releaseDate: '2024-09-24',
    tags: ['fast', 'balanced', 'coding', 'large-context'],
  },
  'gemini-2.5-flash-lite': {
    provider: 'gemini',
    name: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash Lite',
    inputPricing: 0.0375,
    outputPricing: 0.15,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2024-11-01',
    tags: ['fast', 'cost-efficient', 'lightweight', 'large-context'],
  },

  // Claude Models
  'claude-sonnet-4.5': {
    provider: 'claude',
    name: 'claude-sonnet-4.5',
    displayName: 'Claude Sonnet 4.5',
    inputPricing: 3.0,
    outputPricing: 15.0,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2024-10-22',
    tags: ['reasoning', 'analysis', 'coding', 'latest'],
  },
  'claude-3-opus': {
    provider: 'claude',
    name: 'claude-3-opus',
    displayName: 'Claude 3 Opus',
    inputPricing: 15.0,
    outputPricing: 75.0,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2024-03-04',
    tags: ['reasoning', 'quality', 'analysis'],
  },
  'claude-3-sonnet': {
    provider: 'claude',
    name: 'claude-3-sonnet',
    displayName: 'Claude 3 Sonnet',
    inputPricing: 3.0,
    outputPricing: 15.0,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2024-03-04',
    tags: ['balanced', 'reasoning', 'coding'],
  },
  'claude-3-haiku': {
    provider: 'claude',
    name: 'claude-3-haiku',
    displayName: 'Claude 3 Haiku',
    inputPricing: 0.25,
    outputPricing: 1.25,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsEmbeddings: false,
    releaseDate: '2024-03-04',
    tags: ['fast', 'cost-efficient'],
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
