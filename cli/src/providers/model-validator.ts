/**
 * model-validator.ts - Model Validation Logic
 * 
 * Validates model names, checks deprecation status, and provides warnings.
 */

import { ModelInfo, modelRegistry } from './model-registry';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
  modelInfo?: ModelInfo;
}

export class ModelValidator {
  /**
   * Validate a model name
   */
  static validate(modelName: string, provider?: string): ValidationResult {
    const warnings: string[] = [];

    // Check if model exists
    const modelInfo = modelRegistry.getModelInfo(modelName);
    
    if (!modelInfo) {
      return {
        valid: false,
        error: `Model "${modelName}" not found in registry. Available models: ${this.getSuggestions(modelName).join(', ')}`,
      };
    }

    // Check provider match
    if (provider && modelInfo.provider !== provider) {
      return {
        valid: false,
        error: `Model "${modelName}" belongs to provider "${modelInfo.provider}", but "${provider}" was specified.`,
      };
    }

    // Check if deprecated
    if (modelInfo.deprecated) {
      const replacement = modelInfo.replacedBy 
        ? ` Use "${modelInfo.replacedBy}" instead.`
        : '';
      
      warnings.push(
        `⚠️  Warning: Model "${modelName}" is deprecated${modelInfo.deprecationDate ? ` as of ${modelInfo.deprecationDate}` : ''}.${replacement}`
      );
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
      modelInfo,
    };
  }

  /**
   * Get model suggestions based on partial name
   */
  static getSuggestions(partialName: string, limit: number = 5): string[] {
    const allModels = modelRegistry.getAllModels();
    const lowerPartial = partialName.toLowerCase();

    // Find models that include the partial name
    const matches = allModels
      .filter(
        (model) =>
          model.name.toLowerCase().includes(lowerPartial) ||
          model.displayName.toLowerCase().includes(lowerPartial)
      )
      .map((model) => model.name);

    return matches.slice(0, limit);
  }

  /**
   * Validate model capabilities for a task
   */
  static validateCapabilities(
    modelName: string,
    requiredCapabilities: {
      minContextWindow?: number;
      supportsStreaming?: boolean;
      supportsEmbeddings?: boolean;
    }
  ): ValidationResult {
    const modelInfo = modelRegistry.getModelInfo(modelName);

    if (!modelInfo) {
      return {
        valid: false,
        error: `Model "${modelName}" not found in registry.`,
      };
    }

    const warnings: string[] = [];

    // Check context window
    if (
      requiredCapabilities.minContextWindow &&
      modelInfo.contextWindow < requiredCapabilities.minContextWindow
    ) {
      warnings.push(
        `⚠️  Model context window (${modelInfo.contextWindow}) is smaller than required (${requiredCapabilities.minContextWindow})`
      );
    }

    // Check streaming support
    if (
      requiredCapabilities.supportsStreaming &&
      !modelInfo.supportsStreaming
    ) {
      warnings.push(`⚠️  Model does not support streaming`);
    }

    // Check embeddings support
    if (
      requiredCapabilities.supportsEmbeddings &&
      !modelInfo.supportsEmbeddings
    ) {
      warnings.push(`⚠️  Model does not support embeddings`);
    }

    return {
      valid: warnings.length === 0,
      warnings: warnings.length > 0 ? warnings : undefined,
      modelInfo,
    };
  }

  /**
   * Validate pricing constraints
   */
  static validatePricing(
    modelName: string,
    maxCostPerRequest?: number
  ): ValidationResult {
    const modelInfo = modelRegistry.getModelInfo(modelName);

    if (!modelInfo) {
      return {
        valid: false,
        error: `Model "${modelName}" not found in registry.`,
      };
    }

    if (maxCostPerRequest) {
      // Estimate cost for average request (1000 input + 500 output tokens)
      const estimatedCost =
        (1000 / 1000000) * modelInfo.inputPricing +
        (500 / 1000000) * modelInfo.outputPricing;

      if (estimatedCost > maxCostPerRequest) {
        return {
          valid: false,
          error: `Model pricing (estimated $${estimatedCost.toFixed(4)} per request) exceeds max cost ($${maxCostPerRequest})`,
          modelInfo,
        };
      }
    }

    return {
      valid: true,
      modelInfo,
    };
  }

  /**
   * Get model comparison
   */
  static compareModels(modelName1: string, modelName2: string): string {
    const model1 = modelRegistry.getModelInfo(modelName1);
    const model2 = modelRegistry.getModelInfo(modelName2);

    if (!model1 || !model2) {
      return 'One or both models not found in registry.';
    }

    const comparison: string[] = [];
    comparison.push(`\nComparing ${model1.displayName} vs ${model2.displayName}:`);
    comparison.push('─'.repeat(60));

    // Cost comparison
    const cost1 = model1.inputPricing + model1.outputPricing;
    const cost2 = model2.inputPricing + model2.outputPricing;
    const cheaper = cost1 < cost2 ? model1.displayName : model2.displayName;
    comparison.push(`💰 Cost: ${cheaper} is cheaper`);

    // Context window comparison
    const larger = model1.contextWindow > model2.contextWindow ? model1.displayName : model2.displayName;
    comparison.push(`📏 Context: ${larger} has larger context window`);

    // Features comparison
    const features: string[] = [];
    if (model1.supportsStreaming && model2.supportsStreaming) {
      features.push('Both support streaming');
    } else if (model1.supportsStreaming) {
      features.push(`Only ${model1.displayName} supports streaming`);
    } else if (model2.supportsStreaming) {
      features.push(`Only ${model2.displayName} supports streaming`);
    }

    if (features.length > 0) {
      comparison.push(`✨ Features: ${features.join(', ')}`);
    }

    // Tags comparison
    const commonTags = model1.tags.filter((tag) => model2.tags.includes(tag));
    if (commonTags.length > 0) {
      comparison.push(`🏷️  Common tags: ${commonTags.join(', ')}`);
    }

    return comparison.join('\n');
  }

  /**
   * Recommend model for use case
   */
  static recommendModel(
    provider: string,
    useCase: 'cost' | 'quality' | 'speed' | 'balanced'
  ): ModelInfo | undefined {
    const models = modelRegistry.listProviderModels(provider);

    if (models.length === 0) {
      return undefined;
    }

    switch (useCase) {
      case 'cost':
        return models.sort(
          (a, b) =>
            a.inputPricing +
            a.outputPricing -
            (b.inputPricing + b.outputPricing)
        )[0];

      case 'quality':
        return models.sort((a, b) => b.contextWindow - a.contextWindow)[0];

      case 'speed':
        return models.find((m) => m.tags.includes('fast')) || models[0];

      case 'balanced':
        // Find model with good balance of cost and capabilities
        return models.sort((a, b) => {
          const scoreA =
            a.contextWindow / 1000 - (a.inputPricing + a.outputPricing) * 10;
          const scoreB =
            b.contextWindow / 1000 - (b.inputPricing + b.outputPricing) * 10;
          return scoreB - scoreA;
        })[0];

      default:
        return models[0];
    }
  }
}
