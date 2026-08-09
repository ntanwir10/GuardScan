/**
 * cost-guard.ts - Budget Management and Cost Controls
 * 
 * Enforces budget limits and provides cost warnings.
 * Prevents unexpected AI spending.
 */

import { UsageTracker, UsageReport } from './usage-tracker';
import { MetricsCollector } from './metrics-collector';

export interface BudgetConfig {
  dailyLimit: number;          // USD
  monthlyLimit: number;        // USD
  perRequestLimit: number;     // USD
  warningThreshold: number;    // 0-1 (e.g., 0.8 = 80%)
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  dailyLimit: 10,
  monthlyLimit: 100,
  perRequestLimit: 1,
  warningThreshold: 0.8,
};

export interface BudgetStatus {
  daily: {
    used: number;
    limit: number;
    remaining: number;
    percentUsed: number;
  };
  monthly: {
    used: number;
    limit: number;
    remaining: number;
    percentUsed: number;
  };
  perRequest: {
    limit: number;
  };
  warnings: string[];
}

export class CostGuard {
  private config: BudgetConfig;
  private usage: UsageTracker;
  private metrics: MetricsCollector;

  constructor(
    repoId: string,
    config: Partial<BudgetConfig> = {},
    metrics?: MetricsCollector
  ) {
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
    this.usage = new UsageTracker(repoId);
    this.metrics = metrics || new MetricsCollector(repoId);
  }

  /**
   * Check if a request is within budget
   */
  async checkBudget(estimatedCost: number): Promise<void> {
    const current = await this.usage.getCurrentUsage();

    // Per-request limit
    if (estimatedCost > this.config.perRequestLimit) {
      throw new Error(
        `❌ Request exceeds per-request limit:\n` +
        `   Estimated: $${estimatedCost.toFixed(4)}\n` +
        `   Limit: $${this.config.perRequestLimit.toFixed(4)}\n` +
        `   Consider using a cheaper model or reduce context size.`
      );
    }

    // Daily limit
    if (current.daily + estimatedCost > this.config.dailyLimit) {
      throw new Error(
        `❌ Daily budget exceeded:\n` +
        `   Current: $${current.daily.toFixed(2)}\n` +
        `   Estimated: +$${estimatedCost.toFixed(4)}\n` +
        `   Total: $${(current.daily + estimatedCost).toFixed(2)}\n` +
        `   Daily Limit: $${this.config.dailyLimit.toFixed(2)}\n` +
        `   Reset in ${this.getTimeUntilReset('daily')}\n` +
        `   Increase limit with: guardscan budget set --daily <amount>`
      );
    }

    // Monthly limit
    if (current.monthly + estimatedCost > this.config.monthlyLimit) {
      throw new Error(
        `❌ Monthly budget exceeded:\n` +
        `   Current: $${current.monthly.toFixed(2)}\n` +
        `   Estimated: +$${estimatedCost.toFixed(4)}\n` +
        `   Total: $${(current.monthly + estimatedCost).toFixed(2)}\n` +
        `   Monthly Limit: $${this.config.monthlyLimit.toFixed(2)}\n` +
        `   Reset in ${this.getTimeUntilReset('monthly')}\n` +
        `   Increase limit with: guardscan budget set --monthly <amount>`
      );
    }

    // Warning threshold
    const dailyUsagePercent = (current.daily + estimatedCost) / this.config.dailyLimit;
    const monthlyUsagePercent = (current.monthly + estimatedCost) / this.config.monthlyLimit;

    if (dailyUsagePercent >= this.config.warningThreshold) {
      console.warn(
        `⚠️  Budget Warning: ${(dailyUsagePercent * 100).toFixed(0)}% of daily budget used ` +
        `($${(current.daily + estimatedCost).toFixed(2)}/$${this.config.dailyLimit})`
      );
    }

    if (monthlyUsagePercent >= this.config.warningThreshold) {
      console.warn(
        `⚠️  Budget Warning: ${(monthlyUsagePercent * 100).toFixed(0)}% of monthly budget used ` +
        `($${(current.monthly + estimatedCost).toFixed(2)}/$${this.config.monthlyLimit})`
      );
    }
  }

  /**
   * Record actual usage
   */
  async recordUsage(
    actualCost: number,
    metadata?: {
      provider?: string;
      model?: string;
      operation?: string;
      tokens?: number;
    }
  ): Promise<void> {
    await this.usage.record(actualCost, metadata);
  }

  /**
   * Get budget status
   */
  async getBudgetStatus(): Promise<BudgetStatus> {
    const current = await this.usage.getCurrentUsage();
    const warnings: string[] = [];

    // Calculate percentages
    const dailyPercent = (current.daily / this.config.dailyLimit) * 100;
    const monthlyPercent = (current.monthly / this.config.monthlyLimit) * 100;

    // Generate warnings
    if (dailyPercent >= this.config.warningThreshold * 100) {
      warnings.push(
        `Daily budget at ${dailyPercent.toFixed(0)}% - consider monitoring usage`
      );
    }

    if (monthlyPercent >= this.config.warningThreshold * 100) {
      warnings.push(
        `Monthly budget at ${monthlyPercent.toFixed(0)}% - consider increasing limit`
      );
    }

    if (current.daily >= this.config.dailyLimit) {
      warnings.push(
        `Daily limit reached - will reset in ${this.getTimeUntilReset('daily')}`
      );
    }

    if (current.monthly >= this.config.monthlyLimit) {
      warnings.push(
        `Monthly limit reached - will reset in ${this.getTimeUntilReset('monthly')}`
      );
    }

    return {
      daily: {
        used: current.daily,
        limit: this.config.dailyLimit,
        remaining: Math.max(0, this.config.dailyLimit - current.daily),
        percentUsed: dailyPercent,
      },
      monthly: {
        used: current.monthly,
        limit: this.config.monthlyLimit,
        remaining: Math.max(0, this.config.monthlyLimit - current.monthly),
        percentUsed: monthlyPercent,
      },
      perRequest: {
        limit: this.config.perRequestLimit,
      },
      warnings,
    };
  }

  /**
   * Get usage report
   */
  async getUsageReport(days: number = 30): Promise<UsageReport> {
    return this.usage.generateReport(days);
  }

  /**
   * Update budget configuration
   */
  updateBudget(updates: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get budget configuration
   */
  getBudgetConfig(): BudgetConfig {
    return { ...this.config };
  }

  /**
   * Calculate time until reset
   */
  private getTimeUntilReset(period: 'daily' | 'monthly'): string {
    const now = new Date();
    let resetTime: Date;

    if (period === 'daily') {
      resetTime = new Date(now);
      resetTime.setHours(24, 0, 0, 0); // Next midnight
    } else {
      // Monthly reset
      resetTime = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0);
    }

    const msUntilReset = resetTime.getTime() - now.getTime();
    const hoursUntilReset = Math.floor(msUntilReset / (1000 * 60 * 60));
    const minutesUntilReset = Math.floor((msUntilReset % (1000 * 60 * 60)) / (1000 * 60));

    return `${hoursUntilReset}h ${minutesUntilReset}m`;
  }

  /**
   * Export usage data
   */
  exportUsage(outputPath: string, days: number = 30): void {
    this.usage.exportToCSV(outputPath, days);
  }

  /**
   * Clear all usage records
   */
  async clearUsage(): Promise<void> {
    await this.usage.clear();
  }
}
