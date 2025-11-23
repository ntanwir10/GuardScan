/**
 * Performance Tracker
 * 
 * Tracks command execution time breakdown and provides detailed
 * performance metrics for optimization and debugging.
 */

import chalk from 'chalk';
import { isProfilingEnabled } from './debug-logger';

export interface PerformanceEntry {
  label: string;
  durationMs: number;
  startTime: number;
  endTime: number;
  metadata?: Record<string, any>;
}

export interface PerformanceSummary {
  totalDurationMs: number;
  entries: PerformanceEntry[];
  breakdown: Array<{
    label: string;
    durationMs: number;
    percentage: number;
  }>;
}

export class PerformanceTracker {
  private entries: PerformanceEntry[];
  private activeTimers: Map<string, number>;
  private command: string;
  private startTime: number;
  private enabled: boolean;

  constructor(command: string) {
    this.command = command;
    this.entries = [];
    this.activeTimers = new Map();
    this.startTime = Date.now();
    this.enabled = isProfilingEnabled();
  }

  /**
   * Start tracking an operation
   */
  start(label: string, metadata?: Record<string, any>): void {
    if (!this.enabled) return;

    const startTime = Date.now();
    this.activeTimers.set(label, startTime);
    
    if (metadata) {
      // Store metadata for later use
      this.activeTimers.set(`${label}_metadata`, metadata as any);
    }
  }

  /**
   * End tracking an operation
   */
  end(label: string): number {
    if (!this.enabled) return 0;

    const startTime = this.activeTimers.get(label);
    if (!startTime) {
      console.warn(`Performance tracker: Timer not found for "${label}"`);
      return 0;
    }

    const endTime = Date.now();
    const durationMs = endTime - startTime;
    
    const metadata = this.activeTimers.get(`${label}_metadata`) as Record<string, any> | undefined;

    this.entries.push({
      label,
      durationMs,
      startTime,
      endTime,
      metadata
    });

    this.activeTimers.delete(label);
    if (metadata) {
      this.activeTimers.delete(`${label}_metadata`);
    }

    return durationMs;
  }

  /**
   * Track a synchronous operation
   */
  track<T>(label: string, fn: () => T): T {
    this.start(label);
    try {
      return fn();
    } finally {
      this.end(label);
    }
  }

  /**
   * Track an asynchronous operation
   */
  async trackAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.start(label);
    try {
      return await fn();
    } finally {
      this.end(label);
    }
  }

  /**
   * Get performance summary
   */
  getSummary(): PerformanceSummary {
    const totalDurationMs = Date.now() - this.startTime;

    const breakdown = this.entries.map(entry => ({
      label: entry.label,
      durationMs: entry.durationMs,
      percentage: (entry.durationMs / totalDurationMs) * 100
    }));

    // Sort by duration (descending)
    breakdown.sort((a, b) => b.durationMs - a.durationMs);

    return {
      totalDurationMs,
      entries: this.entries,
      breakdown
    };
  }

  /**
   * Display performance summary in console
   */
  displaySummary(): void {
    if (!this.enabled || this.entries.length === 0) return;

    const summary = this.getSummary();
    const totalSeconds = (summary.totalDurationMs / 1000).toFixed(2);

    console.log('\n' + chalk.cyan.bold('Performance Summary:'));
    console.log(chalk.gray(`Command: ${this.command}`));
    console.log(chalk.gray(`Total: ${totalSeconds}s\n`));

    summary.breakdown.forEach((item, index) => {
      const seconds = (item.durationMs / 1000).toFixed(2);
      const percentage = item.percentage.toFixed(1);
      const isLast = index === summary.breakdown.length - 1;
      const prefix = isLast ? '└─' : '├─';
      
      // Color code based on percentage
      let color = chalk.gray;
      if (item.percentage > 30) {
        color = chalk.red; // Slow
      } else if (item.percentage > 15) {
        color = chalk.yellow; // Medium
      } else {
        color = chalk.green; // Fast
      }

      console.log(`  ${prefix} ${item.label}: ${color(`${seconds}s (${percentage}%)`)}`);
    });

    console.log(''); // Empty line
  }

  /**
   * Get JSON representation of performance data
   */
  toJSON(): string {
    const summary = this.getSummary();
    return JSON.stringify({
      command: this.command,
      timestamp: new Date().toISOString(),
      totalDurationMs: summary.totalDurationMs,
      breakdown: summary.breakdown,
      entries: this.entries
    }, null, 2);
  }

  /**
   * Export performance data to file
   */
  async exportToFile(filePath: string): Promise<void> {
    if (!this.enabled) return;

    const fs = await import('fs');
    const json = this.toJSON();
    fs.writeFileSync(filePath, json, 'utf-8');
  }

  /**
   * Get the slowest operations
   */
  getSlowestOperations(count: number = 5): PerformanceEntry[] {
    return [...this.entries]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, count);
  }

  /**
   * Check if profiling is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get memory usage snapshot (if available)
   */
  getMemoryUsage(): NodeJS.MemoryUsage | null {
    if (typeof process === 'undefined' || !process.memoryUsage) {
      return null;
    }
    return process.memoryUsage();
  }

  /**
   * Format memory usage for display
   */
  formatMemoryUsage(usage: NodeJS.MemoryUsage): string {
    const formatBytes = (bytes: number): string => {
      return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    };

    return [
      `Heap Used: ${formatBytes(usage.heapUsed)}`,
      `Heap Total: ${formatBytes(usage.heapTotal)}`,
      `RSS: ${formatBytes(usage.rss)}`,
      `External: ${formatBytes(usage.external)}`
    ].join(', ');
  }
}

/**
 * Create a performance tracker for a command
 */
export function createPerformanceTracker(command: string): PerformanceTracker {
  return new PerformanceTracker(command);
}

/**
 * Simple performance timer utility
 */
export class SimpleTimer {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Get elapsed time in milliseconds
   */
  elapsed(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get elapsed time in seconds (formatted)
   */
  elapsedSeconds(): string {
    return (this.elapsed() / 1000).toFixed(2);
  }

  /**
   * Reset the timer
   */
  reset(): void {
    this.startTime = Date.now();
  }
}

