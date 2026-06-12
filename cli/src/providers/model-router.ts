/**
 * model-router.ts - Smart Model Router with User Overrides
 * 
 * Automatically selects optimal model for each task type.
 * Supports user overrides for specific models or priorities per task.
 */

import { ModelRegistry, ModelInfo, modelRegistry } from './model-registry';
import { Config } from '../core/config';

export type TaskType =
  | 'code-review'
  | 'code-generation'
  | 'chat'
  | 'explanation'
  | 'refactoring'
  | 'test-generation';

export interface RoutingStrategy {
  priority: 'cost' | 'quality' | 'speed' | 'balanced';
  maxCostPerRequest?: number;
  requiredCapabilities?: string[];
}

export interface TaskOverride {
  model?: string;  // Specific model to use (e.g., 'gpt-4o')
  priority?: 'cost' | 'quality' | 'speed' | 'balanced';  // Priority for this task
}

export interface ModelSelection {
  modelId: string;
  provider: string;
  estimatedCost: number;
  rationale: string;
  isOverride: boolean;
}

export interface ModelSelectionCriteria {
  tags: string[];
  minContextWindow: number;
  priority: 'cost' | 'quality' | 'speed' | 'balanced';
}

export class ModelRouter {
  private registry: ModelRegistry;

  constructor(
    private config: Config
  ) {
    this.registry = modelRegistry;
  }

  /**
   * Select optimal model for a task
   */
  selectOptimalModel(
    task: TaskType,
    strategy: RoutingStrategy = { priority: 'balanced' }
  ): ModelSelection {
    // 1. Check for user override first
    const override = this.config.modelRouting?.taskOverrides?.[task];

    if (override) {
      if (override.model) {
        // User specified exact model for this task
        const modelInfo = this.registry.getModelInfo(override.model);
        
        if (!modelInfo) {
          console.warn(
            `⚠️  Override model "${override.model}" not found in registry. ` +
            `Falling back to automatic selection.`
          );
        } else {
          return {
            modelId: override.model,
            provider: modelInfo.provider,
            estimatedCost: modelInfo.inputPricing,
            rationale: `User override: ${override.model} for ${task}`,
            isOverride: true,
          };
        }
      }

      // Apply override priority if specified
      if (override.priority) {
        strategy = { ...strategy, priority: override.priority };
      }
    }

    // 2. Automatic selection based on task criteria
    const taskRoutes: Record<TaskType, ModelSelectionCriteria> = {
      'code-review': {
        tags: ['reasoning', 'analysis'],
        minContextWindow: 32000,
        priority: 'quality',
      },
      'code-generation': {
        tags: ['coding', 'generation'],
        minContextWindow: 16000,
        priority: 'balanced',
      },
      'chat': {
        tags: ['fast', 'general'],
        minContextWindow: 8000,
        priority: 'speed',
      },
      'explanation': {
        tags: ['reasoning', 'teaching'],
        minContextWindow: 16000,
        priority: 'quality',
      },
      'refactoring': {
        tags: ['coding', 'reasoning'],
        minContextWindow: 32000,
        priority: 'balanced',
      },
      'test-generation': {
        tags: ['coding', 'testing'],
        minContextWindow: 16000,
        priority: 'balanced',
      },
    };

    const criteria = taskRoutes[task];

    // Get available models from registry
    const candidates = this.registry
      .listProviderModels(this.config.provider)
      .filter((model) => this.matchesCriteria(model, criteria));

    if (candidates.length === 0) {
      throw new Error(
        `No suitable models found for task "${task}" with provider "${this.config.provider}". ` +
        `Try using a different provider or check available models with: guardscan models list`
      );
    }

    // Score and rank candidates
    const scored = candidates.map((model) => ({
      model,
      score: this.scoreModel(model, criteria, strategy),
    }));

    scored.sort((a, b) => b.score - a.score);

    const selected = scored[0].model;

    return {
      modelId: selected.name,
      provider: this.config.provider,
      estimatedCost: selected.inputPricing,
      rationale: this.explainSelection(selected, criteria, strategy),
      isOverride: false,
    };
  }

  /**
   * Check if model matches criteria
   */
  private matchesCriteria(
    model: ModelInfo,
    criteria: ModelSelectionCriteria
  ): boolean {
    // Must not be deprecated
    if (model.deprecated) {
      return false;
    }

    // Must meet minimum context window
    if (model.contextWindow < criteria.minContextWindow) {
      return false;
    }

    // Must support chat (not embedding-only models)
    if (model.supportsEmbeddings && model.embeddingDimensions && !model.tags.includes('chat')) {
      return false;
    }

    return true;
  }

  /**
   * Score a model based on criteria and strategy
   */
  private scoreModel(
    model: ModelInfo,
    criteria: ModelSelectionCriteria,
    strategy: RoutingStrategy
  ): number {
    let score = 0;

    // Tag matching (high weight)
    const matchingTags = model.tags.filter((tag) =>
      criteria.tags.includes(tag)
    );
    score += matchingTags.length * 10;

    // Priority-based scoring
    const effectivePriority = strategy.priority || criteria.priority;

    switch (effectivePriority) {
      case 'cost':
        // Prefer cheaper models
        score -= (model.inputPricing + model.outputPricing) * 100;
        break;

      case 'speed':
        // Prefer fast models
        score += model.tags.includes('fast') ? 20 : 0;
        score += model.tags.includes('lightweight') ? 15 : 0;
        break;

      case 'quality':
        // Prefer models with larger context windows and reasoning tags
        score += model.contextWindow / 1000;
        score += model.tags.includes('reasoning') ? 15 : 0;
        score += model.tags.includes('analysis') ? 15 : 0;
        break;

      case 'balanced':
        // Balance cost and quality
        const costScore = -(model.inputPricing + model.outputPricing) * 50;
        const qualityScore = model.contextWindow / 2000;
        score += costScore + qualityScore;
        break;
    }

    // Cost constraint (hard limit)
    if (strategy.maxCostPerRequest) {
      // Estimate cost for average request
      const estimatedCost =
        (1000 / 1000000) * model.inputPricing +
        (500 / 1000000) * model.outputPricing;

      if (estimatedCost > strategy.maxCostPerRequest) {
        score -= 1000; // Heavy penalty
      }
    }

    // Required capabilities
    if (strategy.requiredCapabilities) {
      const hasAll = strategy.requiredCapabilities.every((cap) =>
        model.tags.includes(cap)
      );
      if (!hasAll) {
        score -= 500; // Penalty for missing required capabilities
      }
    }

    // Deprecation penalty
    if (model.deprecated) {
      score -= 100;
    }

    // Bonus for latest models
    if (model.tags.includes('latest')) {
      score += 5;
    }

    return score;
  }

  /**
   * Explain why a model was selected
   */
  private explainSelection(
    model: ModelInfo,
    criteria: ModelSelectionCriteria,
    strategy: RoutingStrategy
  ): string {
    const reasons: string[] = [];

    reasons.push(`Selected ${model.displayName || model.name}`);

    const matchingTags = model.tags.filter((tag) => criteria.tags.includes(tag));
    if (matchingTags.length > 0) {
      reasons.push(`matches tags: ${matchingTags.join(', ')}`);
    }

    const effectivePriority = strategy.priority || criteria.priority;
    reasons.push(`${effectivePriority} priority`);
    reasons.push(`$${model.inputPricing}/1M input tokens`);
    reasons.push(`${model.contextWindow.toLocaleString()} token context`);

    return reasons.join(' | ');
  }

  /**
   * Get all task types
   */
  static getTaskTypes(): TaskType[] {
    return [
      'code-review',
      'code-generation',
      'chat',
      'explanation',
      'refactoring',
      'test-generation',
    ];
  }

  /**
   * Get routing configuration for a task
   */
  getTaskRouting(task: TaskType): {
    override?: TaskOverride;
    defaultCriteria: ModelSelectionCriteria;
  } {
    const taskRoutes: Record<TaskType, ModelSelectionCriteria> = {
      'code-review': {
        tags: ['reasoning', 'analysis'],
        minContextWindow: 32000,
        priority: 'quality',
      },
      'code-generation': {
        tags: ['coding', 'generation'],
        minContextWindow: 16000,
        priority: 'balanced',
      },
      'chat': {
        tags: ['fast', 'general'],
        minContextWindow: 8000,
        priority: 'speed',
      },
      'explanation': {
        tags: ['reasoning', 'teaching'],
        minContextWindow: 16000,
        priority: 'quality',
      },
      'refactoring': {
        tags: ['coding', 'reasoning'],
        minContextWindow: 32000,
        priority: 'balanced',
      },
      'test-generation': {
        tags: ['coding', 'testing'],
        minContextWindow: 16000,
        priority: 'balanced',
      },
    };

    return {
      override: this.config.modelRouting?.taskOverrides?.[task],
      defaultCriteria: taskRoutes[task],
    };
  }

  /**
   * Test routing for a task (dry run)
   */
  testRouting(task: TaskType): ModelSelection {
    return this.selectOptimalModel(task);
  }

  /**
   * List all routing configurations
   */
  listAllRoutings(): Record<TaskType, ModelSelection> {
    const routes: any = {};

    for (const task of ModelRouter.getTaskTypes()) {
      try {
        routes[task] = this.selectOptimalModel(task);
      } catch (error: any) {
        routes[task] = {
          error: error.message,
        };
      }
    }

    return routes;
  }

  /**
   * Validate a routing configuration
   */
  validateRouting(
    task: TaskType,
    override: TaskOverride
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate model if specified
    if (override.model) {
      const modelInfo = this.registry.getModelInfo(override.model);
      
      if (!modelInfo) {
        errors.push(`Model "${override.model}" not found in registry`);
      } else if (modelInfo.provider !== this.config.provider) {
        errors.push(
          `Model "${override.model}" belongs to provider "${modelInfo.provider}", ` +
          `but current provider is "${this.config.provider}"`
        );
      } else if (modelInfo.deprecated) {
        errors.push(
          `Model "${override.model}" is deprecated. ` +
          `Consider using "${modelInfo.replacedBy || 'a newer model'}"`
        );
      }
    }

    // Validate priority if specified
    if (override.priority) {
      const validPriorities = ['cost', 'quality', 'speed', 'balanced'];
      if (!validPriorities.includes(override.priority)) {
        errors.push(`Invalid priority "${override.priority}". Must be one of: ${validPriorities.join(', ')}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
