/**
 * Monitoring & Analytics Handler
 *
 * Receives and processes monitoring data from CLI
 * Integrates with Cloudflare Analytics
 *
 * P0: Critical Before Launch
 */

import { Env } from "../index";
import { CachedDatabase } from "../db-cached";
import { Database } from "../db";
import { KVRateLimiter, createRateLimitResponse, addRateLimitHeaders } from "../utils/rate-limiter-kv";

// Fallback to in-memory rate limiter if KV not available
import { rateLimiters as memoryRateLimiters } from "../utils/rate-limiter";

// Constants (works on free plan)
const MAX_REQUEST_SIZE_MB = 10; // 10MB max request size
const MAX_REQUEST_SIZE_BYTES = MAX_REQUEST_SIZE_MB * 1024 * 1024;

/**
 * Error Severity
 */
enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

/**
 * Monitoring Data Payload
 */
interface MonitoringPayload {
  errors?: ErrorEvent[];
  metrics?: PerformanceMetric[];
  usage?: UsageEvent[];
  timestamp: string;
}

interface ErrorEvent {
  errorId: string;
  timestamp: Date;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  context: any;
  environment: any;
}

interface PerformanceMetric {
  metricId: string;
  timestamp: Date;
  name: string;
  value: number;
  unit: string;
  tags?: Record<string, string>;
}

interface UsageEvent {
  eventId: string;
  timestamp: Date;
  command: string;
  duration: number;
  success: boolean;
  clientId: string;
  metadata?: Record<string, any>;
}

/**
 * Analytics Manager
 */
class AnalyticsManager {
  private db: Database | CachedDatabase;

  constructor(db: Database | CachedDatabase) {
    this.db = db;
  }

  /**
   * Store error events
   */
  async storeErrors(errors: ErrorEvent[]): Promise<void> {
    if (errors.length === 0) return;

    const records = errors.map((error) => ({
      error_id: error.errorId,
      timestamp: new Date(error.timestamp).toISOString(),
      severity: error.severity,
      message: error.message,
      stack: error.stack || null,
      context: error.context,
      environment: error.environment,
    }));

    try {
      await this.db.insertErrors(records);
    } catch (err) {
      console.error("Failed to store errors:", err);
    }
  }

  /**
   * Store performance metrics
   */
  async storeMetrics(metrics: PerformanceMetric[]): Promise<void> {
    if (metrics.length === 0) return;

    const records = metrics.map((metric) => ({
      metric_id: metric.metricId,
      timestamp: new Date(metric.timestamp).toISOString(),
      name: metric.name,
      value: metric.value,
      unit: metric.unit,
      tags: metric.tags || {},
    }));

    try {
      await this.db.insertMetrics(records);
    } catch (err) {
      console.error("Failed to store metrics:", err);
    }
  }

  /**
   * Store usage events
   */
  async storeUsage(usage: UsageEvent[]): Promise<void> {
    if (usage.length === 0) return;

    const records = usage.map((event) => ({
      event_id: event.eventId,
      timestamp: new Date(event.timestamp).toISOString(),
      command: event.command,
      duration: event.duration,
      success: event.success,
      client_id: event.clientId,
      metadata: event.metadata || {},
    }));

    try {
      await this.db.insertUsageEvents(records);
    } catch (err) {
      console.error("Failed to store usage events:", err);
    }
  }

  /**
   * Get error statistics
   */
  async getErrorStats(hours: number = 24): Promise<any> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    try {
      const data = await this.db.getErrorsSince(since);

      // Group by severity
      const stats = data.reduce((acc: any, err: any) => {
        acc[err.severity] = (acc[err.severity] || 0) + 1;
        return acc;
      }, {});

      return {
        total: data.length,
        bySeverity: stats,
        period: `${hours}h`,
      };
    } catch (err) {
      console.error("Failed to get error stats:", err);
      return null;
    }
  }

  /**
   * Get performance statistics
   */
  async getPerformanceStats(hours: number = 24): Promise<any> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    try {
      const data = await this.db.getMetricsSince(since);

      // Group by metric name
      const byName: Record<
        string,
        { count: number; avg: number; min: number; max: number }
      > = {};

      data.forEach((metric: any) => {
        if (!byName[metric.name]) {
          byName[metric.name] = {
            count: 0,
            avg: 0,
            min: Infinity,
            max: -Infinity,
          };
        }

        const stats = byName[metric.name];
        stats.count++;
        stats.avg =
          (stats.avg * (stats.count - 1) + metric.value) / stats.count;
        stats.min = Math.min(stats.min, metric.value);
        stats.max = Math.max(stats.max, metric.value);
      });

      return {
        total: data.length,
        byMetric: byName,
        period: `${hours}h`,
      };
    } catch (err) {
      console.error("Failed to get performance stats:", err);
      return null;
    }
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(hours: number = 24): Promise<any> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    try {
      const data = await this.db.getUsageEventsSince(since);

      // Group by command
      const byCommand: Record<
        string,
        { count: number; successRate: number; avgDuration: number }
      > = {};

      data.forEach((event: any) => {
        if (!byCommand[event.command]) {
          byCommand[event.command] = {
            count: 0,
            successRate: 0,
            avgDuration: 0,
          };
        }

        const stats = byCommand[event.command];
        stats.count++;
        const successCount =
          stats.successRate * (stats.count - 1) + (event.success ? 1 : 0);
        stats.successRate = successCount / stats.count;
        stats.avgDuration =
          (stats.avgDuration * (stats.count - 1) + event.duration) /
          stats.count;
      });

      return {
        total: data.length,
        byCommand,
        period: `${hours}h`,
      };
    } catch (err) {
      console.error("Failed to get usage stats:", err);
      return null;
    }
  }
}

/**
 * Handle monitoring data ingestion
 */
export async function handleMonitoring(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Validate Content-Length to prevent memory exhaustion attacks
    const contentLength = parseInt(request.headers.get('Content-Length') || '0');
    
    if (contentLength > MAX_REQUEST_SIZE_BYTES) {
      return new Response(
        JSON.stringify({
          error: 'Request too large',
          maxSize: `${MAX_REQUEST_SIZE_MB}MB`,
          received: `${(contentLength / 1024 / 1024).toFixed(2)}MB`
        }),
        {
          status: 413,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Parse request body first to get client identifier
    const payload: MonitoringPayload = await request.json();

    // Extract client identifier for rate limiting (from usage events or IP)
    const clientId =
      payload.usage?.[0]?.clientId ||
      request.headers.get("CF-Connecting-IP") ||
      "unknown";

    // Rate limiting check - use KV-based if available, otherwise fall back to in-memory
    const rateLimiter = env.RATE_LIMIT_KV
      ? new KVRateLimiter(
          { windowMs: 60 * 1000, maxRequests: 50 },
          env.RATE_LIMIT_KV,
          'monitoring'
        )
      : memoryRateLimiters.monitoring;
    
    const rateLimitResult = env.RATE_LIMIT_KV
      ? await rateLimiter.check(clientId)
      : rateLimiter.check(clientId);
    
    if (!rateLimitResult.allowed) {
      console.warn(`Rate limit exceeded for monitoring client: ${clientId}`);
      return createRateLimitResponse(
        rateLimitResult.resetAt,
        rateLimitResult.limit
      );
    }

    // If Supabase not configured, accept but don't store (graceful degradation)
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
      const response = new Response(
        JSON.stringify({
          status: "ok",
          message: "Monitoring accepted (not stored)",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
      return addRateLimitHeaders(response, rateLimitResult);
    }

    // Validate payload
    if (!payload.timestamp) {
      return new Response(JSON.stringify({ error: "Missing timestamp" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const db = new CachedDatabase(env);
    const analytics = new AnalyticsManager(db);

    // Store all data in parallel
    await Promise.all([
      payload.errors
        ? analytics.storeErrors(payload.errors)
        : Promise.resolve(),
      payload.metrics
        ? analytics.storeMetrics(payload.metrics)
        : Promise.resolve(),
      payload.usage ? analytics.storeUsage(payload.usage) : Promise.resolve(),
    ]);

    // Log critical errors
    if (payload.errors) {
      const criticalErrors = payload.errors.filter(
        (e) => e.severity === ErrorSeverity.CRITICAL
      );
      if (criticalErrors.length > 0) {
        console.warn(
          `[CRITICAL] Received ${criticalErrors.length} critical errors`
        );
        criticalErrors.forEach((e) => {
          console.warn(`  - ${e.message}`, e.stack);
        });
      }
    }

    const response = new Response(
      JSON.stringify({
        success: true,
        received: {
          errors: payload.errors?.length || 0,
          metrics: payload.metrics?.length || 0,
          usage: payload.usage?.length || 0,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );

    // Add rate limit headers to response
    return addRateLimitHeaders(response, rateLimitResult);
  } catch (error: any) {
    console.error("Error handling monitoring data:", error);

    // Don't fail hard - monitoring is optional
    return new Response(
      JSON.stringify({
        status: "ok",
        message: "Monitoring error (non-blocking)",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Get monitoring statistics
 */
export async function handleMonitoringStats(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Extract client identifier for rate limiting (use IP address for stats endpoint)
    const clientId =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      "unknown";

    // Rate limiting check - use KV-based if available, otherwise fall back to in-memory
    const rateLimiter = env.RATE_LIMIT_KV
      ? new KVRateLimiter(
          { windowMs: 60 * 1000, maxRequests: 30 },
          env.RATE_LIMIT_KV,
          'monitoring-stats'
        )
      : memoryRateLimiters.monitoringStats;
    
    const rateLimitResult = env.RATE_LIMIT_KV
      ? await rateLimiter.check(clientId)
      : rateLimiter.check(clientId);
    
    if (!rateLimitResult.allowed) {
      console.warn(
        `Rate limit exceeded for monitoring stats client: ${clientId}`
      );
      return createRateLimitResponse(
        rateLimitResult.resetAt,
        rateLimitResult.limit
      );
    }

    // If Supabase not configured, return empty stats
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
      const response = new Response(
        JSON.stringify({ error: "Monitoring not configured" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
      return addRateLimitHeaders(response, rateLimitResult);
    }

    const url = new URL(request.url);
    const hours = parseInt(url.searchParams.get("hours") || "24");

    const db = new CachedDatabase(env);
    const analytics = new AnalyticsManager(db);

    const [errorStats, perfStats, usageStats] = await Promise.all([
      analytics.getErrorStats(hours),
      analytics.getPerformanceStats(hours),
      analytics.getUsageStats(hours),
    ]);

    const response = new Response(
      JSON.stringify({
        errors: errorStats,
        performance: perfStats,
        usage: usageStats,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );

    // Add rate limit headers to response
    return addRateLimitHeaders(response, rateLimitResult);
  } catch (error: any) {
    console.error("Error getting monitoring stats:", error);

    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
