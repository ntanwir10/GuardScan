/**
 * Centralized Debug Logger
 * 
 * Provides structured debug logging with:
 * - Timestamp prefixes
 * - Component/command context
 * - Performance timing
 * - JSON output for CI environments
 * - Integration with GUARDSCAN_DEBUG flag
 */

export interface DebugLogData {
  [key: string]: any;
}

export interface PerformanceMetric {
  operation: string;
  durationMs: number;
  timestamp: string;
}

export class DebugLogger {
  private component: string;
  private timers: Map<string, number>;
  private metrics: PerformanceMetric[];
  private enabled: boolean;
  private jsonOutput: boolean;

  constructor(component: string) {
    this.component = component;
    this.timers = new Map();
    this.metrics = [];
    this.enabled = process.env.GUARDSCAN_DEBUG === 'true';
    this.jsonOutput = process.env.GUARDSCAN_DEBUG_JSON === 'true';
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: DebugLogData): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    
    if (this.jsonOutput) {
      console.error(JSON.stringify({
        level: 'debug',
        component: this.component,
        timestamp,
        message,
        data
      }));
    } else {
      const prefix = `[${timestamp}] [${this.component}]`;
      if (data) {
        console.error(`${prefix} ${message}`, data);
      } else {
        console.error(`${prefix} ${message}`);
      }
    }
  }

  /**
   * Log an info message (always shown, not just in debug mode)
   */
  info(message: string, data?: DebugLogData): void {
    const timestamp = new Date().toISOString();
    
    if (this.jsonOutput) {
      console.log(JSON.stringify({
        level: 'info',
        component: this.component,
        timestamp,
        message,
        data
      }));
    } else {
      const prefix = `[${this.component}]`;
      if (data) {
        console.log(`${prefix} ${message}`, data);
      } else {
        console.log(`${prefix} ${message}`);
      }
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: DebugLogData): void {
    const timestamp = new Date().toISOString();
    
    if (this.jsonOutput) {
      console.warn(JSON.stringify({
        level: 'warn',
        component: this.component,
        timestamp,
        message,
        data
      }));
    } else {
      const prefix = `[${timestamp}] [${this.component}] WARNING:`;
      if (data) {
        console.warn(`${prefix} ${message}`, data);
      } else {
        console.warn(`${prefix} ${message}`);
      }
    }
  }

  /**
   * Log an error
   */
  error(message: string, error: unknown): void {
    const timestamp = new Date().toISOString();
    const errorData = this.extractErrorData(error);
    
    if (this.jsonOutput) {
      console.error(JSON.stringify({
        level: 'error',
        component: this.component,
        timestamp,
        message,
        error: errorData
      }));
    } else {
      const prefix = `[${timestamp}] [${this.component}] ERROR:`;
      console.error(`${prefix} ${message}`);
      console.error('Error details:', errorData);
    }
  }

  /**
   * Start a performance timer
   */
  time(label: string): void {
    if (!this.enabled) return;
    
    this.timers.set(label, Date.now());
    this.debug(`Timer started: ${label}`);
  }

  /**
   * End a performance timer and return duration
   */
  timeEnd(label: string): number {
    if (!this.enabled) return 0;
    
    const startTime = this.timers.get(label);
    if (!startTime) {
      this.warn(`Timer not found: ${label}`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(label);
    
    this.debug(`Timer ended: ${label}`, { durationMs: duration });
    
    return duration;
  }

  /**
   * Log a performance metric
   */
  performance(operation: string, durationMs: number, metadata?: DebugLogData): void {
    const metric: PerformanceMetric = {
      operation,
      durationMs,
      timestamp: new Date().toISOString()
    };

    this.metrics.push(metric);

    if (this.enabled) {
      if (this.jsonOutput) {
        console.error(JSON.stringify({
          level: 'performance',
          component: this.component,
          ...metric,
          metadata
        }));
      } else {
        console.error(
          `[${this.component}] PERF: ${operation} completed in ${durationMs}ms`,
          metadata || ''
        );
      }
    }
  }

  /**
   * Get all collected performance metrics
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * Clear all performance metrics
   */
  clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): string {
    if (this.metrics.length === 0) {
      return 'No performance metrics collected';
    }

    const total = this.metrics.reduce((sum, m) => sum + m.durationMs, 0);
    let summary = `Performance Summary (${this.component}):\n`;
    summary += `  Total: ${(total / 1000).toFixed(2)}s\n`;

    this.metrics.forEach(metric => {
      const percentage = ((metric.durationMs / total) * 100).toFixed(1);
      summary += `  ├─ ${metric.operation}: ${(metric.durationMs / 1000).toFixed(2)}s (${percentage}%)\n`;
    });

    return summary;
  }

  /**
   * Extract error data from unknown error type
   */
  private extractErrorData(error: unknown): any {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }
    
    if (typeof error === 'string') {
      return { message: error };
    }
    
    if (typeof error === 'object' && error !== null) {
      return error;
    }
    
    return { message: String(error) };
  }

  /**
   * Check if debug mode is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable debug logging programmatically
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable debug logging programmatically
   */
  disable(): void {
    this.enabled = false;
  }
}

/**
 * Create a debug logger for a specific component
 */
export function createDebugLogger(component: string): DebugLogger {
  return new DebugLogger(component);
}

/**
 * Global profile flag check
 */
export function isProfilingEnabled(): boolean {
  return process.env.GUARDSCAN_PROFILE === 'true';
}

