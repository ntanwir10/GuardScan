/**
 * usage-tracker.ts - AI Usage and Cost Tracking
 * 
 * Tracks AI usage and costs over time.
 * Provides daily, weekly, and monthly reports.
 */

import * as fs from 'fs';
import * as path from 'path';
import { configManager } from './config';

export interface UsageRecord {
  timestamp: Date;
  cost: number;
  provider: string;
  model: string;
  operation: string;
  tokens?: number;
}

export interface UsageSummary {
  daily: number;
  weekly: number;
  monthly: number;
  allTime: number;
}

export interface UsageReport {
  summary: UsageSummary;
  dailyBreakdown: Array<{ date: string; cost: number; calls: number }>;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  byOperation: Record<string, number>;
  topCostlyOperations: Array<{ timestamp: Date; cost: number; model: string }>;
}

export class UsageTracker {
  private records: UsageRecord[] = [];
  private repoId: string;
  private maxRecords: number = 10000; // Keep last 10k records

  constructor(repoId: string) {
    this.repoId = repoId;
    this.loadFromDisk();
  }

  /**
   * Record a usage event
   */
  async record(cost: number, metadata?: {
    provider?: string;
    model?: string;
    operation?: string;
    tokens?: number;
  }): Promise<void> {
    const record: UsageRecord = {
      timestamp: new Date(),
      cost,
      provider: metadata?.provider || 'unknown',
      model: metadata?.model || 'unknown',
      operation: metadata?.operation || 'unknown',
      tokens: metadata?.tokens,
    };

    this.records.push(record);

    // Trim old records
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    // Persist to disk
    await this.saveToDisk();
  }

  /**
   * Get current usage
   */
  async getCurrentUsage(): Promise<UsageSummary> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const daily = this.records
      .filter((r) => r.timestamp >= oneDayAgo)
      .reduce((sum, r) => sum + r.cost, 0);

    const weekly = this.records
      .filter((r) => r.timestamp >= oneWeekAgo)
      .reduce((sum, r) => sum + r.cost, 0);

    const monthly = this.records
      .filter((r) => r.timestamp >= oneMonthAgo)
      .reduce((sum, r) => sum + r.cost, 0);

    const allTime = this.records.reduce((sum, r) => sum + r.cost, 0);

    return {
      daily,
      weekly,
      monthly,
      allTime,
    };
  }

  /**
   * Generate usage report
   */
  async generateReport(days: number = 30): Promise<UsageReport> {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const relevantRecords = this.records.filter(
      (r) => r.timestamp >= cutoffDate
    );

    const summary = await this.getCurrentUsage();

    // Daily breakdown
    const dailyMap = new Map<string, { cost: number; calls: number }>();
    for (const record of relevantRecords) {
      const dateKey = record.timestamp.toISOString().split('T')[0];
      const existing = dailyMap.get(dateKey) || { cost: 0, calls: 0 };
      existing.cost += record.cost;
      existing.calls += 1;
      dailyMap.set(dateKey, existing);
    }

    const dailyBreakdown = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // By provider
    const byProvider: Record<string, number> = {};
    for (const record of relevantRecords) {
      byProvider[record.provider] = (byProvider[record.provider] || 0) + record.cost;
    }

    // By model
    const byModel: Record<string, number> = {};
    for (const record of relevantRecords) {
      byModel[record.model] = (byModel[record.model] || 0) + record.cost;
    }

    // By operation
    const byOperation: Record<string, number> = {};
    for (const record of relevantRecords) {
      byOperation[record.operation] = (byOperation[record.operation] || 0) + record.cost;
    }

    // Top costly operations
    const topCostlyOperations = relevantRecords
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10)
      .map((r) => ({
        timestamp: r.timestamp,
        cost: r.cost,
        model: r.model,
      }));

    return {
      summary,
      dailyBreakdown,
      byProvider,
      byModel,
      byOperation,
      topCostlyOperations,
    };
  }

  /**
   * Clear all records
   */
  async clear(): Promise<void> {
    this.records = [];
    await this.saveToDisk();
  }

  /**
   * Get usage directory path
   */
  private getUsageDir(): string {
    const baseCacheDir = configManager.getCacheDir();
    return path.join(baseCacheDir, this.repoId, 'usage');
  }

  /**
   * Save usage records to disk
   */
  private async saveToDisk(): Promise<void> {
    const usageDir = this.getUsageDir();

    try {
      fs.mkdirSync(usageDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    const usagePath = path.join(usageDir, 'records.json');

    // Serialize records
    const serialized = this.records.map((r) => ({
      ...r,
      timestamp: r.timestamp.toISOString(),
    }));

    try {
      fs.writeFileSync(usagePath, JSON.stringify(serialized, null, 2), 'utf-8');
    } catch (error: any) {
      console.warn('Failed to save usage data to disk:', error.message);
      // Continue without crashing - usage just won't persist
    }
  }

  /**
   * Load usage records from disk
   */
  private loadFromDisk(): void {
    const usageDir = this.getUsageDir();
    const usagePath = path.join(usageDir, 'records.json');

    if (!fs.existsSync(usagePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(usagePath, 'utf-8');
      const loaded = JSON.parse(content);

      if (Array.isArray(loaded)) {
        this.records = loaded.map((r: any) => ({
          ...r,
          timestamp: new Date(r.timestamp),
        }));
      }
    } catch (error) {
      console.warn('Failed to load usage records from disk:', error);
      this.records = [];
    }
  }

  /**
   * Export usage records to CSV
   */
  exportToCSV(outputPath: string, days: number = 30): void {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const relevantRecords = this.records.filter(
      (r) => r.timestamp >= cutoffDate
    );

    const lines: string[] = [];
    lines.push('timestamp,cost,provider,model,operation,tokens');

    for (const record of relevantRecords) {
      lines.push(
        `${record.timestamp.toISOString()},${record.cost},${record.provider},${record.model},${record.operation},${record.tokens || ''}`
      );
    }

    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
  }
}
