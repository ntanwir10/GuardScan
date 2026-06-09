/**
 * metrics-collector.ts - AI Metrics Collection and Analysis
 *
 * Local spans persist under ~/.guardscan/cache. When telemetry is enabled,
 * aggregate performance samples are flushed through utils/monitoring to the
 * GuardScan-Monitoring Worker (POST /api/monitoring).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { configManager } from './config';
import { getMonitoring } from '../utils/monitoring';

export interface AISpan {
  traceId: string;
  spanId: string;
  provider: string;
  model: string;
  operation: 'chat' | 'stream' | 'embed' | 'embed-bulk';
  startTime: number;
  endTime: number;
  latency: number;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost?: number;
  success: boolean;
  error?: string;
  errorType?: string;
  cacheHit?: boolean;
  retryCount?: number;
  circuitBreakerState?: string;
}

export interface AggregatedMetrics {
  totalCalls: number;
  successRate: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  totalCost: number;
  totalTokens: number;
  cacheHitRate: number;
  errorsByType: Record<string, number>;
  callsByProvider: Record<string, number>;
  callsByModel: Record<string, number>;
  callsByOperation: Record<string, number>;
}

export class MetricsCollector {
  private spans: AISpan[] = [];
  private maxSpans: number = 10000; // Keep last 10k spans in memory
  private repoId: string;
  private telemetryEnabled: boolean;

  constructor(repoId: string, telemetryEnabled: boolean = false) {
    this.repoId = repoId;
    this.telemetryEnabled = telemetryEnabled;
    this.loadFromDisk();
  }

  /**
   * Record a span
   */
  async recordSpan(span: AISpan): Promise<void> {
    this.spans.push(span);

    // Trim old spans if exceeding max
    if (this.spans.length > this.maxSpans) {
      this.spans = this.spans.slice(-this.maxSpans);
    }

    // Persist to disk (async, non-blocking)
    this.saveToDisk().catch((err) => {
      console.warn('Failed to save metrics:', err);
    });

    if (this.telemetryEnabled) {
      this.forwardSpanToMonitoring(span).catch(() => {
        /* non-blocking; matches optional telemetry semantics */
      });
    }
  }

  /**
   * Get aggregated metrics
   */
  getMetrics(timeRangeMs?: number): AggregatedMetrics {
    // Filter by time range if specified
    const now = Date.now();
    const relevantSpans = timeRangeMs
      ? this.spans.filter((span) => now - span.endTime <= timeRangeMs)
      : this.spans;

    if (relevantSpans.length === 0) {
      return this.getEmptyMetrics();
    }

    const successfulSpans = relevantSpans.filter((span) => span.success);
    const failedSpans = relevantSpans.filter((span) => !span.success);

    return {
      totalCalls: relevantSpans.length,
      successRate: (successfulSpans.length / relevantSpans.length) * 100,
      averageLatency: this.calculateAverageLatency(relevantSpans),
      p50Latency: this.calculatePercentileLatency(relevantSpans, 0.5),
      p95Latency: this.calculatePercentileLatency(relevantSpans, 0.95),
      p99Latency: this.calculatePercentileLatency(relevantSpans, 0.99),
      totalCost: this.calculateTotalCost(relevantSpans),
      totalTokens: this.calculateTotalTokens(relevantSpans),
      cacheHitRate: this.calculateCacheHitRate(relevantSpans),
      errorsByType: this.groupErrorsByType(failedSpans),
      callsByProvider: this.groupByProvider(relevantSpans),
      callsByModel: this.groupByModel(relevantSpans),
      callsByOperation: this.groupByOperation(relevantSpans),
    };
  }

  /**
   * Get spans
   */
  getSpans(limit?: number): AISpan[] {
    if (limit) {
      return this.spans.slice(-limit);
    }
    return [...this.spans];
  }

  /**
   * Clear all spans
   */
  clear(): void {
    this.spans = [];
    this.saveToDisk().catch((err) => {
      console.warn('Failed to save metrics after clear:', err);
    });
  }

  /**
   * Export metrics to JSON
   */
  exportToJSON(outputPath: string, timeRangeMs?: number): void {
    const metrics = this.getMetrics(timeRangeMs);
    const now = Date.now();
    
    const relevantSpans = timeRangeMs
      ? this.spans.filter((span) => now - span.endTime <= timeRangeMs)
      : this.spans;

    const exportData = {
      timestamp: new Date().toISOString(),
      repoId: this.repoId,
      timeRangeMs,
      aggregated: metrics,
      spans: relevantSpans,
    };

    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  private calculateAverageLatency(spans: AISpan[]): number {
    if (spans.length === 0) return 0;
    const total = spans.reduce((sum, span) => sum + span.latency, 0);
    return total / spans.length;
  }

  private calculatePercentileLatency(spans: AISpan[], percentile: number): number {
    if (spans.length === 0) return 0;

    const sorted = spans.map((s) => s.latency).sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;

    return sorted[Math.max(0, index)];
  }

  private calculateTotalCost(spans: AISpan[]): number {
    return spans.reduce((sum, span) => sum + (span.cost || 0), 0);
  }

  private calculateTotalTokens(spans: AISpan[]): number {
    return spans.reduce((sum, span) => sum + (span.tokens?.total || 0), 0);
  }

  private calculateCacheHitRate(spans: AISpan[]): number {
    if (spans.length === 0) return 0;
    const cacheHits = spans.filter((span) => span.cacheHit).length;
    return (cacheHits / spans.length) * 100;
  }

  private groupErrorsByType(failedSpans: AISpan[]): Record<string, number> {
    const groups: Record<string, number> = {};

    for (const span of failedSpans) {
      const errorType = span.errorType || 'unknown';
      groups[errorType] = (groups[errorType] || 0) + 1;
    }

    return groups;
  }

  private groupByProvider(spans: AISpan[]): Record<string, number> {
    const groups: Record<string, number> = {};

    for (const span of spans) {
      groups[span.provider] = (groups[span.provider] || 0) + 1;
    }

    return groups;
  }

  private groupByModel(spans: AISpan[]): Record<string, number> {
    const groups: Record<string, number> = {};

    for (const span of spans) {
      groups[span.model] = (groups[span.model] || 0) + 1;
    }

    return groups;
  }

  private groupByOperation(spans: AISpan[]): Record<string, number> {
    const groups: Record<string, number> = {};

    for (const span of spans) {
      groups[span.operation] = (groups[span.operation] || 0) + 1;
    }

    return groups;
  }

  private getEmptyMetrics(): AggregatedMetrics {
    return {
      totalCalls: 0,
      successRate: 0,
      averageLatency: 0,
      p50Latency: 0,
      p95Latency: 0,
      p99Latency: 0,
      totalCost: 0,
      totalTokens: 0,
      cacheHitRate: 0,
      errorsByType: {},
      callsByProvider: {},
      callsByModel: {},
      callsByOperation: {},
    };
  }

  /**
   * Get metrics directory path
   */
  private getMetricsDir(): string {
    const baseCacheDir = configManager.getCacheDir();
    return path.join(baseCacheDir, this.repoId, 'metrics');
  }

  /**
   * Save metrics to disk
   */
  private async saveToDisk(): Promise<void> {
    const metricsDir = this.getMetricsDir();

    try {
      fs.mkdirSync(metricsDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    const metricsPath = path.join(metricsDir, 'spans.json');

    // Save last 1000 spans to disk
    const spansToSave = this.spans.slice(-1000);

    try {
      fs.writeFileSync(
        metricsPath,
        JSON.stringify(spansToSave, null, 2),
        'utf-8'
      );
    } catch (error: any) {
      console.warn('Failed to save metrics to disk:', error.message);
      // Continue without crashing - metrics just won't persist
    }
  }

  /**
   * Load metrics from disk
   */
  private loadFromDisk(): void {
    const metricsDir = this.getMetricsDir();
    const metricsPath = path.join(metricsDir, 'spans.json');

    if (!fs.existsSync(metricsPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(metricsPath, 'utf-8');
      const loaded = JSON.parse(content);

      if (Array.isArray(loaded)) {
        this.spans = loaded;
      }
    } catch (error) {
      console.warn('Failed to load metrics from disk:', error);
      this.spans = [];
    }
  }

  /**
   * Forward span-derived metrics to the GuardScan-Monitoring service.
   */
  private async forwardSpanToMonitoring(span: AISpan): Promise<void> {
    const mon = getMonitoring();
    const tagBase = {
      provider: span.provider,
      model: span.model,
      operation: span.operation,
      success: span.success ? 'true' : 'false',
    };
    await mon.trackMetric(`ai.${span.operation}.latency`, span.latency, 'ms', tagBase);
    if (span.tokens?.total !== undefined) {
      await mon.trackMetric('ai.tokens.total', span.tokens.total, 'count', tagBase);
    }
    if (span.cost !== undefined && Number.isFinite(span.cost)) {
      await mon.trackMetric('ai.estimated_cost_usd', span.cost, 'count', tagBase);
    }
  }

  /**
   * Generate trace ID
   */
  static generateTraceId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate span ID
   */
  static generateSpanId(): string {
    return crypto.randomBytes(8).toString('hex');
  }
}
