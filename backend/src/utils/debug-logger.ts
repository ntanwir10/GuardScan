/**
 * Backend Debug Logger for Cloudflare Workers
 * 
 * Provides structured debug logging with:
 * - Timestamp prefixes
 * - Handler/component context
 * - Performance timing
 * - JSON output for production
 * - Compatible with Cloudflare Workers console API
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

  constructor(component: string, environment?: string) {
    this.component = component;
    this.timers = new Map();
    this.metrics = [];
    // Enable debug logging in development
    // Note: In Cloudflare Workers, we can't access process.env, so we rely on environment parameter
    this.enabled = environment === 'development';
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: DebugLogData): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({
      level: 'debug',
      component: this.component,
      timestamp,
      message,
      data
    }));
  }

  /**
   * Log an info message
   */
  info(message: string, data?: DebugLogData): void {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({
      level: 'info',
      component: this.component,
      timestamp,
      message,
      data
    }));
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: DebugLogData): void {
    const timestamp = new Date().toISOString();
    console.warn(JSON.stringify({
      level: 'warn',
      component: this.component,
      timestamp,
      message,
      data
    }));
  }

  /**
   * Log an error
   */
  error(message: string, error: unknown): void {
    const timestamp = new Date().toISOString();
    const errorData = this.extractErrorData(error);
    
    console.error(JSON.stringify({
      level: 'error',
      component: this.component,
      timestamp,
      message,
      error: errorData
    }));
  }

  /**
   * Start a performance timer
   */
  time(label: string): void {
    this.timers.set(label, Date.now());
    if (this.enabled) {
      this.debug(`Timer started: ${label}`);
    }
  }

  /**
   * End a performance timer and return duration
   */
  timeEnd(label: string): number {
    const startTime = this.timers.get(label);
    if (!startTime) {
      this.warn(`Timer not found: ${label}`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(label);
    
    if (this.enabled) {
      this.debug(`Timer ended: ${label}`, { durationMs: duration });
    }
    
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

    // Always log performance metrics (even if debug is disabled)
    console.log(JSON.stringify({
      level: 'performance',
      component: this.component,
      ...metric,
      metadata
    }));
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
}

/**
 * Create a debug logger for a specific component
 */
export function createDebugLogger(component: string, environment?: string): DebugLogger {
  return new DebugLogger(component, environment);
}

