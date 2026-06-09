/**
 * model-router.test.ts - Unit tests for ModelRouter
 */

import { describe, expect, it } from '@jest/globals';
import { ModelRouter, TaskType } from '../../src/providers/model-router';
import { Config } from '../../src/core/config';

describe('ModelRouter', () => {
  describe('automatic model selection', () => {
    it('should select model for code-review task', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      const router = new ModelRouter(config);
      const selection = router.selectOptimalModel('code-review');

      expect(selection.modelId).toBeDefined();
      expect(selection.provider).toBe('openai');
      expect(selection.isOverride).toBe(false);
    });

    it('should respect priority strategy', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      const router = new ModelRouter(config);
      
      const costSelection = router.selectOptimalModel('chat', { priority: 'cost' });
      const qualitySelection = router.selectOptimalModel('chat', { priority: 'quality' });

      // Cost selection should be cheaper
      expect(costSelection.estimatedCost).toBeLessThanOrEqual(qualitySelection.estimatedCost);
    });

    it('should enforce cost constraints', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      const router = new ModelRouter(config);
      const selection = router.selectOptimalModel('chat', {
        priority: 'balanced',
        maxCostPerRequest: 0.000005, // Extremely low limit to force cheapest model
      });

      // Should select cheapest model
      expect(selection.estimatedCost).toBeLessThanOrEqual(0.001);
    });
  });

  describe('user overrides', () => {
    it('should use model override when specified', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        modelRouting: {
          enabled: true,
          strategy: 'balanced',
          taskOverrides: {
            'code-review': {
              model: 'gpt-4o',
            },
          },
        },
      };

      const router = new ModelRouter(config);
      const selection = router.selectOptimalModel('code-review');

      expect(selection.modelId).toBe('gpt-4o');
      expect(selection.isOverride).toBe(true);
      expect(selection.rationale).toContain('User override');
    });

    it('should use priority override when specified', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        modelRouting: {
          enabled: true,
          strategy: 'balanced',
          taskOverrides: {
            'chat': {
              priority: 'speed',
            },
          },
        },
      };

      const router = new ModelRouter(config);
      const selection = router.selectOptimalModel('chat');

      // Should select fast model
      expect(selection.isOverride).toBe(false); // Priority override, not model override
    });

    it('should fallback to auto-selection if override model not found', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        modelRouting: {
          enabled: true,
          strategy: 'balanced',
          taskOverrides: {
            'chat': {
              model: 'invalid-model',
            },
          },
        },
      };

      const router = new ModelRouter(config);
      const selection = router.selectOptimalModel('chat');

      // Should fallback to automatic selection
      expect(selection.isOverride).toBe(false);
    });
  });

  describe('task routing configuration', () => {
    it('should get routing configuration for task', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      const router = new ModelRouter(config);
      const routing = router.getTaskRouting('code-review');

      expect(routing.defaultCriteria).toBeDefined();
      expect(routing.defaultCriteria.tags).toContain('reasoning');
    });

    it('should list all task types', () => {
      const tasks = ModelRouter.getTaskTypes();

      expect(tasks).toContain('code-review');
      expect(tasks).toContain('code-generation');
      expect(tasks).toContain('chat');
      expect(tasks).toContain('explanation');
      expect(tasks).toContain('refactoring');
      expect(tasks).toContain('test-generation');
    });
  });

  describe('routing validation', () => {
    it('should validate valid override', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      const router = new ModelRouter(config);
      const validation = router.validateRouting('code-review', {
        model: 'gpt-4o',
        priority: 'quality',
      });

      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should detect invalid model', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      const router = new ModelRouter(config);
      const validation = router.validateRouting('chat', {
        model: 'invalid-model',
      });

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should detect provider mismatch', () => {
      const config: Config = {
        clientId: 'test',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      const router = new ModelRouter(config);
      const validation = router.validateRouting('chat', {
        model: 'gemini-2.5-flash', // Gemini model for OpenAI provider
      });

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('provider'))).toBe(true);
    });
  });
});
