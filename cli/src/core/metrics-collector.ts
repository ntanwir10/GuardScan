/**
 * metrics-collector.ts - AI Metrics Collection and Analysis
 *
 * Local spans persist under ~/.guardscan/cache and are never sent remotely.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { configManager } from './config';
import {
  acquireFileLease,
  atomicReplaceJson,
  ensurePrivateDirectory,
  FileLease,
  forEachDirectoryEntry,
  publishJsonNoReplace,
  quarantineFile,
  readJsonFileBounded,
  removeStaleTemporaryFiles,
} from '../utils/private-state';

const MAX_SPANS = 1000;
const MAX_EVENT_FILE_BYTES = 64 * 1024;
const MAX_MIGRATION_FILE_BYTES = 8 * 1024 * 1024;
const EVENT_FILE = /^[a-f0-9]{64}\.json$/;
const MIGRATION_JOURNAL_VERSION = 'guardscan.metrics.migration.v1' as const;
const MIGRATION_LEASE_MS = 5 * 60 * 1000;

interface MetricsMigrationJournal {
  schemaVersion: typeof MIGRATION_JOURNAL_VERSION;
  source: string;
  migrated: string;
  phase: 'committing' | 'committed';
  createdFiles: Array<{file: string; span: AISpan}>;
}

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
  private maxSpans: number = MAX_SPANS;
  private recordsSincePrune = 0;
  private repoId: string;
  private readonly metricsDir: string;
  private readonly eventsDir: string;
  private readonly legacyMetricsPath: string;
  private readonly quarantineDir: string;
  private readonly migrationLeaseFile: string;
  private readonly migrationJournalFile: string;

  constructor(repoId: string) {
    this.repoId = repoId;
    const baseCacheDir = configManager.getCacheDir();
    const safeRepoId = /^[A-Za-z0-9_-]{1,128}$/.test(repoId)
      ? repoId
      : crypto.createHash('sha256').update(repoId).digest('hex');
    this.metricsDir = path.join(baseCacheDir, safeRepoId, 'metrics');
    this.eventsDir = path.join(this.metricsDir, 'events');
    this.legacyMetricsPath = path.join(this.metricsDir, 'spans.json');
    this.quarantineDir = path.join(this.metricsDir, 'quarantine');
    this.migrationLeaseFile = path.join(this.metricsDir, 'migration.lock');
    this.migrationJournalFile = path.join(this.metricsDir, 'migration.journal.json');
    this.ensureStorage();
    this.runMigration();
    this.pruneDiskEvents();
    this.loadFromDisk();
  }

  /**
   * Record a span
   */
  async recordSpan(span: AISpan): Promise<void> {
    const safeSpan = parseSpan(span);
    const created = this.persistSpan(safeSpan);
    if (!created) {return;}
    this.spans.push(safeSpan);
    const shouldPrune = this.spans.length > this.maxSpans;
    let evicted: AISpan | undefined;

    // Trim old spans if exceeding max
    if (this.spans.length > this.maxSpans) {
      evicted = this.spans.shift();
      if (evicted) {
        try {fs.unlinkSync(path.join(this.eventsDir, `${this.storageId(evicted)}.json`));}
        catch { /* concurrent delete */ }
      }
    }

    if (shouldPrune) {
      this.recordsSincePrune += 1;
      if (this.recordsSincePrune >= 32) {
        this.pruneDiskEvents();
        this.recordsSincePrune = 0;
      }
    }
    await Promise.resolve();
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
    if (limit !== undefined) {
      if (!Number.isSafeInteger(limit) || limit < 0) {
        throw new Error('span limit must be a non-negative safe integer');
      }
      return this.spans.slice(-limit);
    }
    return [...this.spans];
  }

  /**
   * Clear all spans
   */
  async clear(): Promise<void> {
    const lease = acquireMetricsLease(this.migrationLeaseFile);
    try {
      this.spans = [];
      this.ensureStorage();
      const handle = await fs.promises.opendir(this.eventsDir);
      for await (const entry of handle) {
        if (!entry.name.endsWith('.json')) {continue;}
        try {await fs.promises.unlink(path.join(this.eventsDir, entry.name));}
        catch { /* concurrent delete */ }
      }
      unlinkIfPresent(this.legacyMetricsPath);
      unlinkIfPresent(`${this.legacyMetricsPath}.migrated`);
      unlinkIfPresent(this.migrationJournalFile);
      forEachDirectoryEntry(this.quarantineDir, entry => {
        if (entry.dirent.isFile() || entry.dirent.isSymbolicLink()) {unlinkIfPresent(entry.path);}
      });
    } finally {
      lease.release();
    }
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

    const target = path.resolve(outputPath);
    atomicReplaceJson(target, exportData, {privateParent: false});
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  private calculateAverageLatency(spans: AISpan[]): number {
    if (spans.length === 0) {return 0;}
    const total = spans.reduce((sum, span) => sum + span.latency, 0);
    return total / spans.length;
  }

  private calculatePercentileLatency(spans: AISpan[], percentile: number): number {
    if (spans.length === 0) {return 0;}

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
    if (spans.length === 0) {return 0;}
    const cacheHits = spans.filter((span) => span.cacheHit).length;
    return (cacheHits / spans.length) * 100;
  }

  private groupErrorsByType(failedSpans: AISpan[]): Record<string, number> {
    return groupCounts(failedSpans.map(span => span.errorType || 'unknown'));
  }

  private groupByProvider(spans: AISpan[]): Record<string, number> {
    return groupCounts(spans.map(span => span.provider));
  }

  private groupByModel(spans: AISpan[]): Record<string, number> {
    return groupCounts(spans.map(span => span.model));
  }

  private groupByOperation(spans: AISpan[]): Record<string, number> {
    return groupCounts(spans.map(span => span.operation));
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

  private ensureStorage(): void {
    ensurePrivateDirectory(this.metricsDir);
    ensurePrivateDirectory(this.eventsDir);
    ensurePrivateDirectory(this.quarantineDir);
    removeStaleTemporaryFiles(this.eventsDir);
  }

  private storageId(span: AISpan): string {
    return crypto.createHash('sha256').update(`${span.traceId}:${span.spanId}`).digest('hex');
  }

  private persistSpan(span: AISpan): boolean {
    this.ensureStorage();
    const target = path.join(this.eventsDir, `${this.storageId(span)}.json`);
    if (publishJsonNoReplace(target, span)) {return true;}
    const existing = parseSpan(readJsonFileBounded(target, MAX_EVENT_FILE_BYTES));
    if (JSON.stringify(existing) !== JSON.stringify(span)) {
      throw new Error(`metrics span identity conflict for ${span.traceId}:${span.spanId}`);
    }
    return false;
  }

  /**
   * Load metrics from disk
   */
  private loadFromDisk(): void {
    const loaded: AISpan[] = [];
    this.scanMetricFiles(span => {addNewest(loaded, span, this.maxSpans, compareSpans);});
    this.spans = loaded.sort(compareSpans);
  }

  private scanMetricFiles(callback: (span: AISpan, file: string) => void): void {
    this.ensureStorage();
    forEachDirectoryEntry(this.eventsDir, entry => {
      if (!entry.name.endsWith('.json')) {return;}
      try {
        if (!EVENT_FILE.test(entry.name)) {throw new Error('unexpected metrics event filename');}
        const value = parseSpan(readJsonFileBounded(entry.path, MAX_EVENT_FILE_BYTES));
        if (`${this.storageId(value)}.json` !== entry.name) {
          throw new Error('metrics event identity mismatch');
        }
        callback(value, entry.path);
      } catch (error) {
        quarantineFile(entry.path, this.quarantineDir);
        console.warn('Malformed metrics event was quarantined:', error);
      }
    });
  }

  private runMigration(): void {
    let lease: FileLease;
    try {lease = acquireMetricsLease(this.migrationLeaseFile);} catch {return;}
    try {
      this.recoverMigrationJournal();
      this.migrateLegacyMetrics();
    } finally {
      lease.release();
    }
  }

  private migrateLegacyMetrics(): void {
    if (!fs.existsSync(this.legacyMetricsPath)) {return;}
    try {
      const value = readJsonFileBounded(this.legacyMetricsPath, MAX_MIGRATION_FILE_BYTES);
      if (!Array.isArray(value)) {throw new Error('legacy metrics must be an array');}
      if (value.length > MAX_SPANS) {throw new Error('legacy metrics exceed span limit');}
      const spans = value.map(parseSpan);
      this.commitMigration(spans);
    } catch (error) {
      quarantineFile(this.legacyMetricsPath, this.quarantineDir);
      console.warn('Legacy metrics were quarantined:', error);
    }
  }

  private pruneDiskEvents(): void {
    const retained: AISpan[] = [];
    this.scanMetricFiles(span => {
      const evicted = addNewest(retained, span, this.maxSpans, compareSpans);
      if (evicted) {
        try {fs.unlinkSync(path.join(this.eventsDir, `${this.storageId(evicted)}.json`));}
        catch { /* concurrent delete */ }
      }
    });
    this.spans = this.spans.slice(-this.maxSpans);
  }

  private commitMigration(spans: AISpan[]): void {
    const source = this.legacyMetricsPath;
    const migrated = `${source}.migrated`;
    const createdFiles = spans
      .map(span => ({file: path.join(this.eventsDir, `${this.storageId(span)}.json`), span}))
      .filter(({file, span}) => {
        if (!fs.existsSync(file)) {return true;}
        const existing = parseSpan(readJsonFileBounded(file, MAX_EVENT_FILE_BYTES));
        if (JSON.stringify(existing) !== JSON.stringify(span)) {
          throw new Error(`metrics migration identity conflict for ${span.traceId}:${span.spanId}`);
        }
        return false;
      });
    const journal: MetricsMigrationJournal = {
      schemaVersion: MIGRATION_JOURNAL_VERSION,
      source,
      migrated,
      phase: 'committing',
      createdFiles,
    };
    atomicReplaceJson(this.migrationJournalFile, journal);
    try {
      for (const {file, span} of createdFiles) {
        if (!publishJsonNoReplace(file, span)) {
          throw new Error(`metrics migration identity conflict for ${span.traceId}:${span.spanId}`);
        }
      }
      fs.renameSync(source, migrated);
      journal.phase = 'committed';
      atomicReplaceJson(this.migrationJournalFile, journal);
      unlinkIfPresent(this.migrationJournalFile);
    } catch (error) {
      this.rollbackMigration(journal);
      throw error;
    }
  }

  private recoverMigrationJournal(): void {
    if (!fs.existsSync(this.migrationJournalFile)) {return;}
    try {
      const journal = readJsonFileBounded(this.migrationJournalFile, MAX_MIGRATION_FILE_BYTES) as MetricsMigrationJournal;
      if (journal.schemaVersion !== MIGRATION_JOURNAL_VERSION || !Array.isArray(journal.createdFiles)) {
        throw new Error('invalid metrics migration journal');
      }
      if (journal.phase === 'committed' || (!fs.existsSync(journal.source) && fs.existsSync(journal.migrated))) {
        unlinkIfPresent(this.migrationJournalFile);
      } else {
        this.rollbackMigration(journal);
      }
    } catch (error) {
      quarantineFile(this.migrationJournalFile, this.quarantineDir);
      console.warn('Metrics migration journal was quarantined:', error);
    }
  }

  private rollbackMigration(journal: MetricsMigrationJournal): void {
    for (const {file, span} of journal.createdFiles) {
      try {
        const current = parseSpan(readJsonFileBounded(file, MAX_EVENT_FILE_BYTES));
        if (JSON.stringify(current) === JSON.stringify(span)) {unlinkIfPresent(file);}
      } catch { /* missing or concurrently changed */ }
    }
    if (!fs.existsSync(journal.source) && fs.existsSync(journal.migrated)) {
      fs.renameSync(journal.migrated, journal.source);
    }
    unlinkIfPresent(this.migrationJournalFile);
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

function parseSpan(value: unknown): AISpan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid metrics span');
  }
  const span = value as Record<string, unknown>;
  if (!isBoundedString(span.traceId, 128) || !isBoundedString(span.spanId, 128) ||
      !isBoundedString(span.provider, 256) || !isBoundedString(span.model, 256) ||
      !['chat', 'stream', 'embed', 'embed-bulk'].includes(String(span.operation)) ||
      !isNonNegativeFinite(span.startTime) || !isNonNegativeFinite(span.endTime) ||
      !isNonNegativeFinite(span.latency) || (span.endTime) < (span.startTime) ||
      typeof span.success !== 'boolean') {
    throw new Error('invalid metrics span');
  }
  const parsed: AISpan = {
    traceId: span.traceId,
    spanId: span.spanId,
    provider: span.provider,
    model: span.model,
    operation: span.operation as AISpan['operation'],
    startTime: span.startTime,
    endTime: span.endTime,
    latency: span.latency,
    success: span.success,
  };
  if (span.tokens !== undefined) {
    if (!span.tokens || typeof span.tokens !== 'object' || Array.isArray(span.tokens)) {
      throw new Error('invalid metrics tokens');
    }
    const tokens = span.tokens as Record<string, unknown>;
    if (Object.keys(tokens).some(key => !['prompt', 'completion', 'total'].includes(key)) ||
        !isNonNegativeSafeInteger(tokens.prompt) || !isNonNegativeSafeInteger(tokens.completion) ||
        !isNonNegativeSafeInteger(tokens.total)) {
      throw new Error('invalid metrics tokens');
    }
    parsed.tokens = {prompt: tokens.prompt, completion: tokens.completion, total: tokens.total};
  }
  if (span.cost !== undefined) {
    if (!isNonNegativeFinite(span.cost)) {throw new Error('invalid metrics cost');}
    parsed.cost = span.cost;
  }
  if (span.errorType !== undefined) {
    if (!isBoundedString(span.errorType, 128)) {throw new Error('invalid metrics error type');}
    parsed.errorType = span.errorType;
  }
  if (span.cacheHit !== undefined) {
    if (typeof span.cacheHit !== 'boolean') {throw new Error('invalid metrics cache flag');}
    parsed.cacheHit = span.cacheHit;
  }
  if (span.retryCount !== undefined) {
    if (!isNonNegativeSafeInteger(span.retryCount)) {throw new Error('invalid metrics retry count');}
    parsed.retryCount = span.retryCount;
  }
  if (span.circuitBreakerState !== undefined) {
    if (!isBoundedString(span.circuitBreakerState, 128)) {throw new Error('invalid circuit breaker state');}
    parsed.circuitBreakerState = span.circuitBreakerState;
  }
  return parsed;
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function groupCounts(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {counts.set(value, (counts.get(value) || 0) + 1);}
  return Object.fromEntries(counts);
}

function acquireMetricsLease(file: string): FileLease {
  return acquireFileLease(file, MIGRATION_LEASE_MS);
}

function compareSpans(left: AISpan, right: AISpan): number {
  return left.endTime - right.endTime || left.spanId.localeCompare(right.spanId);
}

function addNewest<T>(
  values: T[],
  value: T,
  limit: number,
  compare: (left: T, right: T) => number
): T | undefined {
  values.push(value);
  values.sort(compare);
  if (values.length <= limit) {return undefined;}
  return values.shift();
}

function unlinkIfPresent(file: string): void {
  try {fs.unlinkSync(file);} catch (error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
}
