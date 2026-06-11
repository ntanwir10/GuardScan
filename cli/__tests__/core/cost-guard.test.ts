/**
 * cost-guard.test.ts - Unit tests for CostGuard
 */

import { describe, expect, it, beforeEach } from '@jest/globals';
import { CostGuard, DEFAULT_BUDGET_CONFIG } from '../../src/core/cost-guard';

describe('CostGuard', () => {
  let costGuard: CostGuard;

  beforeEach(async () => {
    costGuard = new CostGuard('test-repo');
    await costGuard.clearUsage();
  });
  describe('budget checking', () => {
    it('should allow requests within budget', async () => {
      const costGuard = new CostGuard('test-repo', {
        dailyLimit: 10,
        monthlyLimit: 100,
        perRequestLimit: 1,
        warningThreshold: 0.8,
      });

      await expect(
        costGuard.checkBudget(0.5)
      ).resolves.not.toThrow();
    });

    it('should reject requests exceeding per-request limit', async () => {
      const costGuard = new CostGuard('test-repo', {
        dailyLimit: 10,
        monthlyLimit: 100,
        perRequestLimit: 1,
        warningThreshold: 0.8,
      });

      await expect(
        costGuard.checkBudget(2)
      ).rejects.toThrow('per-request limit');
    });

    it('should reject requests exceeding daily limit', async () => {
      const costGuard = new CostGuard('test-repo', {
        dailyLimit: 1,
        monthlyLimit: 100,
        perRequestLimit: 10,
        warningThreshold: 0.8,
      });

      // Record some usage
      await costGuard.recordUsage(0.5);

      // This should exceed daily limit
      await expect(
        costGuard.checkBudget(0.6)
      ).rejects.toThrow('Daily budget exceeded');
    });
  });

  describe('budget status', () => {
    it('should provide accurate budget status', async () => {
      const costGuard = new CostGuard('test-repo', {
        dailyLimit: 10,
        monthlyLimit: 100,
        perRequestLimit: 5,
        warningThreshold: 0.8,
      });

      const status = await costGuard.getBudgetStatus();

      expect(status.daily.limit).toBe(10);
      expect(status.monthly.limit).toBe(100);
      expect(status.perRequest.limit).toBe(5);
      expect(status.daily.used).toBe(0);
    });

    it('should generate warnings at threshold', async () => {
      const costGuard = new CostGuard('test-repo', {
        dailyLimit: 1,
        monthlyLimit: 100,
        perRequestLimit: 10,
        warningThreshold: 0.8,
      });

      // Use 80% of daily budget
      await costGuard.recordUsage(0.8);

      const status = await costGuard.getBudgetStatus();

      expect(status.warnings.length).toBeGreaterThan(0);
      expect(status.warnings.some((w: string) => w.includes('80%'))).toBe(true);
    });
  });

  describe('usage recording', () => {
    it('should record usage with metadata', async () => {
      const costGuard = new CostGuard('test-repo');

      await costGuard.recordUsage(0.5, {
        provider: 'openai',
        model: 'gpt-4o',
        operation: 'chat',
        tokens: 1000,
      });

      const status = await costGuard.getBudgetStatus();
      expect(status.daily.used).toBeCloseTo(0.5, 2);
    });
  });

  describe('usage reports', () => {
    it('should generate usage report', async () => {
      const costGuard = new CostGuard('test-repo');

      await costGuard.recordUsage(1.0, {
        provider: 'openai',
        model: 'gpt-4o',
        operation: 'chat',
      });

      await costGuard.recordUsage(0.5, {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        operation: 'chat',
      });

      const report = await costGuard.getUsageReport(30);

      expect(report.summary.daily).toBeCloseTo(1.5, 2);
      expect(report.byProvider['openai']).toBeCloseTo(1.0, 2);
      expect(report.byProvider['gemini']).toBeCloseTo(0.5, 2);
    });
  });

  describe('configuration', () => {
    it('should use default configuration', async () => {
      const costGuard = new CostGuard('test-repo');
      const config = costGuard.getBudgetConfig();

      expect(config.dailyLimit).toBe(DEFAULT_BUDGET_CONFIG.dailyLimit);
      expect(config.monthlyLimit).toBe(DEFAULT_BUDGET_CONFIG.monthlyLimit);
    });

    it('should allow custom configuration', () => {
      const customConfig = {
        dailyLimit: 50,
        monthlyLimit: 500,
      };
      const costGuard = new CostGuard('test-repo', customConfig);
      const config = costGuard.getBudgetConfig();

      expect(config.dailyLimit).toBe(50);
      expect(config.monthlyLimit).toBe(500);
    });

    it('should update budget configuration', () => {
      const costGuard = new CostGuard('test-repo');

      costGuard.updateBudget({
        dailyLimit: 25,
      });

      const config = costGuard.getBudgetConfig();
      expect(config.dailyLimit).toBe(25);
    });

    it('should return a copy of config (not mutable reference)', () => {
      const costGuard = new CostGuard('test-repo', { dailyLimit: 5 });
      const config = costGuard.getBudgetConfig();
      config.dailyLimit = 999; // mutate the returned copy

      // Original should be unchanged
      expect(costGuard.getBudgetConfig().dailyLimit).toBe(5);
    });

    it('DEFAULT_BUDGET_CONFIG should have all required fields', () => {
      expect(DEFAULT_BUDGET_CONFIG).toHaveProperty('dailyLimit');
      expect(DEFAULT_BUDGET_CONFIG).toHaveProperty('monthlyLimit');
      expect(DEFAULT_BUDGET_CONFIG).toHaveProperty('perRequestLimit');
      expect(DEFAULT_BUDGET_CONFIG).toHaveProperty('warningThreshold');
      expect(DEFAULT_BUDGET_CONFIG.dailyLimit).toBeGreaterThan(0);
      expect(DEFAULT_BUDGET_CONFIG.monthlyLimit).toBeGreaterThan(0);
      expect(DEFAULT_BUDGET_CONFIG.warningThreshold).toBeGreaterThan(0);
      expect(DEFAULT_BUDGET_CONFIG.warningThreshold).toBeLessThanOrEqual(1);
    });
  });

  describe('budget checking – monthly limit', () => {
    it('should reject requests exceeding monthly limit', async () => {
      const costGuard = new CostGuard('test-repo', {
        dailyLimit: 100,
        monthlyLimit: 1,
        perRequestLimit: 50,
        warningThreshold: 0.8,
      });

      // Record some usage
      await costGuard.recordUsage(0.6);

      // This should exceed monthly limit
      await expect(
        costGuard.checkBudget(0.5)
      ).rejects.toThrow('Monthly budget exceeded');
    });
  });

  describe('budget checking – zero cost', () => {
    it('should allow zero-cost requests', async () => {
      const costGuard = new CostGuard('test-repo', {
        dailyLimit: 10,
        monthlyLimit: 100,
        perRequestLimit: 1,
        warningThreshold: 0.8,
      });

      await expect(costGuard.checkBudget(0)).resolves.not.toThrow();
    });
  });

  describe('budget status – remaining calculation', () => {
    it('should not report negative remaining budget', async () => {
      const costGuard = new CostGuard('test-repo', {
        dailyLimit: 1,
        monthlyLimit: 100,
        perRequestLimit: 10,
        warningThreshold: 0.8,
      });

      // Record more than the limit (this could happen via direct recordUsage)
      await costGuard.recordUsage(1.5);

      const status = await costGuard.getBudgetStatus();
      expect(status.daily.remaining).toBeGreaterThanOrEqual(0);
    });

    it('should emit daily-limit-reached warning in getBudgetStatus', async () => {
      const costGuard = new CostGuard('test-repo', {
        dailyLimit: 1,
        monthlyLimit: 100,
        perRequestLimit: 10,
        warningThreshold: 0.8,
      });

      await costGuard.recordUsage(1.0); // exactly at limit

      const status = await costGuard.getBudgetStatus();
      expect(status.warnings.some((w: string) => w.includes('Daily limit reached'))).toBe(true);
    });
  });
});
