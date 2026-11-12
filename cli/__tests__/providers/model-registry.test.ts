/**
 * model-registry.test.ts - Unit tests for Model Registry
 */

import { describe, expect, it } from '@jest/globals';
import { modelRegistry, MODEL_REGISTRY, DEFAULT_MODELS } from '../../src/providers/model-registry';

describe('ModelRegistry', () => {
  describe('getModelInfo', () => {
    it('should return model info for valid model', () => {
      const info = modelRegistry.getModelInfo('gpt-6.1-sol');

      expect(info).toBeDefined();
      expect(info?.name).toBe('gpt-6.1-sol');
      expect(info?.provider).toBe('openai');
    });

    it('should return undefined for invalid model', () => {
      const info = modelRegistry.getModelInfo('invalid-model');
      expect(info).toBeUndefined();
    });
  });

  describe('listProviderModels', () => {
    it('should list OpenAI models', () => {
      const models = modelRegistry.listProviderModels('openai');
      
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === 'openai')).toBe(true);
    });

    it('should list Gemini models', () => {
      const models = modelRegistry.listProviderModels('gemini');
      
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === 'gemini')).toBe(true);
    });

    it('should return empty array for unknown provider', () => {
      const models = modelRegistry.listProviderModels('unknown');
      expect(models.length).toBe(0);
    });
  });

  describe('findModelsByTag', () => {
    it('should find models by single tag', () => {
      const models = modelRegistry.findModelsByTag(['coding']);
      
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.tags.includes('coding'))).toBe(true);
    });

    it('should find models by multiple tags (OR logic)', () => {
      const models = modelRegistry.findModelsByTag(['fast', 'reasoning'], false);
      
      expect(models.length).toBeGreaterThan(0);
      expect(
        models.every((m) => m.tags.includes('fast') || m.tags.includes('reasoning'))
      ).toBe(true);
    });

    it('should find models by multiple tags (AND logic)', () => {
      const models = modelRegistry.findModelsByTag(['coding', 'fast'], true);
      
      expect(
        models.every((m) => m.tags.includes('coding') && m.tags.includes('fast'))
      ).toBe(true);
    });
  });

  describe('model filtering', () => {
    it('should get active (non-deprecated) models', () => {
      const models = modelRegistry.getActiveModels();
      
      expect(models.every((m) => !m.deprecated)).toBe(true);
    });

    it('should get deprecated models', () => {
      const models = modelRegistry.getDeprecatedModels();
      
      expect(models.every((m) => m.deprecated === true)).toBe(true);
    });

    it('should get embedding models', () => {
      const models = modelRegistry.getEmbeddingModels();
      
      expect(models.every((m) => m.supportsEmbeddings)).toBe(true);
    });
  });

  describe('model search', () => {
    it('should search models by name', () => {
      const models = modelRegistry.searchModels('gpt');
      
      expect(models.length).toBeGreaterThan(0);
      expect(
        models.every((m) => 
          m.name.toLowerCase().includes('gpt') || 
          m.displayName.toLowerCase().includes('gpt')
        )
      ).toBe(true);
    });

    it('should be case-insensitive', () => {
      const models = modelRegistry.searchModels('GPT');
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('model sorting', () => {
    it('should sort models by price', () => {
      const models = modelRegistry.getModelsByPrice();
      
      for (let i = 1; i < models.length; i++) {
        const costPrev = models[i - 1].inputPricing + models[i - 1].outputPricing;
        const costCurr = models[i].inputPricing + models[i].outputPricing;
        expect(costCurr).toBeGreaterThanOrEqual(costPrev);
      }
    });

    it('should sort models by context window', () => {
      const models = modelRegistry.getModelsByContextWindow();
      
      for (let i = 1; i < models.length; i++) {
        expect(models[i].contextWindow).toBeLessThanOrEqual(models[i - 1].contextWindow);
      }
    });
  });

  describe('model validation', () => {
    it('should validate model exists', () => {
      expect(modelRegistry.modelExists('gpt-6.1-sol')).toBe(true);
      expect(modelRegistry.modelExists('invalid')).toBe(false);
    });
  });

  describe('registry data', () => {
    it('points every deprecated model at an active replacement in the registry', () => {
      for (const model of modelRegistry.getDeprecatedModels()) {
        const replacement = model.replacedBy ? MODEL_REGISTRY[model.replacedBy] : undefined;
        expect({ model: model.name, replacement: replacement?.name, deprecated: replacement?.deprecated })
          .toEqual({ model: model.name, replacement: model.replacedBy, deprecated: undefined });
      }
    });

    it('stores paid prices per 1M tokens, not per 1K', () => {
      // A per-1K value such as 0.00015 would sit far below any real per-1M list price.
      const paid = modelRegistry.getAllModels().filter((m) => m.inputPricing > 0);
      for (const model of paid) {
        expect({ model: model.name, inputPricing: model.inputPricing >= 0.01 })
          .toEqual({ model: model.name, inputPricing: true });
      }
    });

    it('defaults each cloud provider to one of its own active chat models', () => {
      for (const [provider, id] of Object.entries(DEFAULT_MODELS)) {
        const model = MODEL_REGISTRY[id];
        expect({ id, provider: model?.provider, deprecated: model?.deprecated, embeddings: model?.supportsEmbeddings })
          .toEqual({ id, provider, deprecated: undefined, embeddings: false });
      }
    });

    it('keys every model by its own API id', () => {
      for (const [key, model] of Object.entries(MODEL_REGISTRY)) {
        expect(model.name).toBe(key);
      }
    });
  });
});
