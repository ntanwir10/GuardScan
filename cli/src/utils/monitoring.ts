/**
 * Monitoring & Analytics Module
 *
 * Integrates with Cloudflare Analytics and provides error tracking
 * P0: Critical Before Launch
 *
 * Features:
 * - Error tracking and reporting
 * - Performance monitoring
 * - Usage analytics
 * - Health checks
 */

import axios from 'axios';
import * as os from 'os';
import { ConfigManager } from '../core/config';

/**
 * Error Severity Levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Error Context
 */
export interface ErrorContext {
  command?: string;
  provider?: string;
  filePath?: string;
  lineNumber?: number;
  additionalData?: Record<string, any>;
}

/**
 * Error Event
 */
export interface ErrorEvent {
  errorId: string;
  timestamp: Date;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  context: ErrorContext;
  environment: EnvironmentInfo;
}

/**
 * Performance Metric
 */
export interface PerformanceMetric {
  metricId: string;
  timestamp: Date;
  name: string;
  value: number;
  unit: 'ms' | 'MB' | 'count' | 'LOC/sec';
  tags?: Record<string, string>;
}

/**
 * Usage Event
 */
export interface UsageEvent {
  eventId: string;
  timestamp: Date;
  command: string;
  duration: number;
  success: boolean;
  clientId: string;
  metadata?: Record<string, any>;
}

/**
 * Environment Info
 */
export interface EnvironmentInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  cliVersion: string;
  memory: {
    total: number;
    free: number;
    used: number;
  };
}

/**
 * Monitoring Configuration
 */
export interface MonitoringConfig {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  errorReportingEnabled: boolean;
  performanceMonitoringEnabled: boolean;
  usageAnalyticsEnabled: boolean;
  sampleRate: number; // 0.0 to 1.0
}

/**
 * Monitoring & Analytics Manager
 */
export class MonitoringManager {
  private config: MonitoringConfig;
  private configManager: ConfigManager;
  private errorBuffer: ErrorEvent[] = [];
  private metricBuffer: PerformanceMetric[] = [];
  private usageBuffer: UsageEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(config?: MonitoringConfig) {
    this.configManager = new ConfigManager();

    this.config = config || {
      enabled: true,
      errorReportingEnabled: true,
      performanceMonitoringEnabled: true,
      usageAnalyticsEnabled: true,
      sampleRate: 1.0
    };

    // Auto-flush every 30 seconds
    this.startAutoFlush();
  }

  /**
   * Track an error
   */
  async trackError(
    error: Error,
    severity: ErrorSeverity,
    context?: ErrorContext
  ): Promise<void> {
    if (!this.config.enabled || !this.config.errorReportingEnabled) {
      return;
    }

    // Sample based on configured rate
    if (Math.random() > this.config.sampleRate) {
      return;
    }

    const errorEvent: ErrorEvent = {
      errorId: this.generateId(),
      timestamp: new Date(),
      severity,
      message: error.message,
      stack: error.stack,
      context: context || {},
      environment: this.getEnvironmentInfo()
    };

    this.errorBuffer.push(errorEvent);

    // Flush critical errors immediately
    if (severity === ErrorSeverity.CRITICAL) {
      await this.flush();
    }
  }

  /**
   * Track a performance metric
   */
  async trackMetric(
    name: string,
    value: number,
    unit: 'ms' | 'MB' | 'count' | 'LOC/sec',
    tags?: Record<string, string>
  ): Promise<void> {
    if (!this.config.enabled || !this.config.performanceMonitoringEnabled) {
      return;
    }

    if (Math.random() > this.config.sampleRate) {
      return;
    }

    const metric: PerformanceMetric = {
      metricId: this.generateId(),
      timestamp: new Date(),
      name,
      value,
      unit,
      tags
    };

    this.metricBuffer.push(metric);

    // Auto-flush if buffer is large
    if (this.metricBuffer.length >= 50) {
      await this.flush();
    }
  }

  /**
   * Track a usage event
   */
  async trackUsage(
    command: string,
    duration: number,
    success: boolean,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (!this.config.enabled || !this.config.usageAnalyticsEnabled) {
      return;
    }

    if (Math.random() > this.config.sampleRate) {
      return;
    }

    const userConfig = this.configManager.load();

    const usageEvent: UsageEvent = {
      eventId: this.generateId(),
      timestamp: new Date(),
      command,
      duration,
      success,
      clientId: userConfig.clientId,
      metadata
    };

    this.usageBuffer.push(usageEvent);

    // Auto-flush if buffer is large
    if (this.usageBuffer.length >= 20) {
      await this.flush();
    }
  }

  /**
   * Track command execution time
   */
  startTimer(): () => Promise<void> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    return async () => {
      const duration = Date.now() - startTime;
      const memoryUsed = process.memoryUsage().heapUsed - startMemory;

      await this.trackMetric('command.duration', duration, 'ms');
      await this.trackMetric('command.memory', memoryUsed / 1024 / 1024, 'MB');
    };
  }

  /**
   * Flush all buffered events to backend
   */
  async flush(): Promise<void> {
    if (!this.config.enabled || !this.config.endpoint) {
      // Clear buffers even if disabled
      this.errorBuffer = [];
      this.metricBuffer = [];
      this.usageBuffer = [];
      return;
    }

    try {
      const payload = {
        errors: this.errorBuffer,
        metrics: this.metricBuffer,
        usage: this.usageBuffer,
        timestamp: new Date().toISOString()
      };

      // Only send if there's data
      if (
        this.errorBuffer.length === 0 &&
        this.metricBuffer.length === 0 &&
        this.usageBuffer.length === 0
      ) {
        return;
      }

      await axios.post(
        `${this.config.endpoint}/api/monitoring`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey || ''}`
          },
          timeout: 5000
        }
      );

      // Clear buffers after successful send
      this.errorBuffer = [];
      this.metricBuffer = [];
      this.usageBuffer = [];
    } catch (error) {
      // Silently fail - don't block user operations
      // Keep data in buffer for next flush attempt
      console.error('Failed to send monitoring data:', error.message);
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, boolean>;
    details: Record<string, any>;
  }> {
    const checks: Record<string, boolean> = {};
    const details: Record<string, any> = {};

    // Check memory usage
    const memoryUsage = process.memoryUsage();
    const memoryPercent = memoryUsage.heapUsed / memoryUsage.heapTotal;
    checks.memory = memoryPercent < 0.9;
    details.memory = {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      percent: Math.round(memoryPercent * 100)
    };

    // Check buffer sizes
    checks.bufferSize = (
      this.errorBuffer.length +
      this.metricBuffer.length +
      this.usageBuffer.length
    ) < 1000;
    details.bufferSize = {
      errors: this.errorBuffer.length,
      metrics: this.metricBuffer.length,
      usage: this.usageBuffer.length
    };

    // Check monitoring endpoint
    if (this.config.endpoint) {
      try {
        const response = await axios.get(
          `${this.config.endpoint}/api/health`,
          { timeout: 5000 }
        );
        checks.endpoint = response.status === 200;
        details.endpoint = { status: response.status };
      } catch (error) {
        checks.endpoint = false;
        details.endpoint = { error: error.message };
      }
    } else {
      checks.endpoint = true; // Skip if no endpoint configured
    }

    // Determine overall status
    const allHealthy = Object.values(checks).every(c => c);
    const mostlyHealthy = Object.values(checks).filter(c => c).length >= 2;

    const status = allHealthy ? 'healthy' : mostlyHealthy ? 'degraded' : 'unhealthy';

    return { status, checks, details };
  }

  /**
   * Get environment info
   */
  private getEnvironmentInfo(): EnvironmentInfo {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();

    return {
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      cliVersion: require('../../../package.json').version,
      memory: {
        total: Math.round(totalMemory / 1024 / 1024),
        free: Math.round(freeMemory / 1024 / 1024),
        used: Math.round((totalMemory - freeMemory) / 1024 / 1024)
      }
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Start auto-flush interval
   */
  private startAutoFlush(): void {
    this.flushInterval = setInterval(async () => {
      await this.flush();
    }, 30000); // 30 seconds

    // Don't keep process alive for this interval
    if (this.flushInterval.unref) {
      this.flushInterval.unref();
    }
  }

  /**
   * Stop auto-flush and flush remaining data
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    await this.flush();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MonitoringConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): MonitoringConfig {
    return { ...this.config };
  }
}

// Global monitoring instance
let globalMonitoring: MonitoringManager | null = null;

/**
 * Get global monitoring instance
 */
export function getMonitoring(): MonitoringManager {
  if (!globalMonitoring) {
    globalMonitoring = new MonitoringManager();
  }
  return globalMonitoring;
}

/**
 * Initialize monitoring with config
 */
export function initMonitoring(config: MonitoringConfig): MonitoringManager {
  globalMonitoring = new MonitoringManager(config);
  return globalMonitoring;
}

/**
 * Shutdown monitoring
 */
export async function shutdownMonitoring(): Promise<void> {
  if (globalMonitoring) {
    await globalMonitoring.shutdown();
    globalMonitoring = null;
  }
}
