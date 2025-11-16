/**
 * Monitoring & Analytics Handler
 *
 * Receives and processes monitoring data from CLI
 * Integrates with Cloudflare Analytics
 *
 * P0: Critical Before Launch
 */

import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Error Severity
 */
enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
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
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Store error events
   */
  async storeErrors(errors: ErrorEvent[]): Promise<void> {
    if (errors.length === 0) return;

    const records = errors.map(error => ({
      error_id: error.errorId,
      timestamp: error.timestamp,
      severity: error.severity,
      message: error.message,
      stack: error.stack,
      context: error.context,
      environment: error.environment,
      created_at: new Date()
    }));

    const { error } = await this.supabase
      .from('errors')
      .insert(records);

    if (error) {
      console.error('Failed to store errors:', error);
    }
  }

  /**
   * Store performance metrics
   */
  async storeMetrics(metrics: PerformanceMetric[]): Promise<void> {
    if (metrics.length === 0) return;

    const records = metrics.map(metric => ({
      metric_id: metric.metricId,
      timestamp: metric.timestamp,
      name: metric.name,
      value: metric.value,
      unit: metric.unit,
      tags: metric.tags,
      created_at: new Date()
    }));

    const { error } = await this.supabase
      .from('metrics')
      .insert(records);

    if (error) {
      console.error('Failed to store metrics:', error);
    }
  }

  /**
   * Store usage events
   */
  async storeUsage(usage: UsageEvent[]): Promise<void> {
    if (usage.length === 0) return;

    const records = usage.map(event => ({
      event_id: event.eventId,
      timestamp: event.timestamp,
      command: event.command,
      duration: event.duration,
      success: event.success,
      client_id: event.clientId,
      metadata: event.metadata,
      created_at: new Date()
    }));

    const { error } = await this.supabase
      .from('usage_events')
      .insert(records);

    if (error) {
      console.error('Failed to store usage events:', error);
    }
  }

  /**
   * Get error statistics
   */
  async getErrorStats(hours: number = 24): Promise<any> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const { data, error } = await this.supabase
      .from('errors')
      .select('severity, message')
      .gte('timestamp', since.toISOString());

    if (error) {
      console.error('Failed to get error stats:', error);
      return null;
    }

    // Group by severity
    const stats = data.reduce((acc: any, err: any) => {
      acc[err.severity] = (acc[err.severity] || 0) + 1;
      return acc;
    }, {});

    return {
      total: data.length,
      bySeverity: stats,
      period: `${hours}h`
    };
  }

  /**
   * Get performance statistics
   */
  async getPerformanceStats(hours: number = 24): Promise<any> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const { data, error } = await this.supabase
      .from('metrics')
      .select('name, value, unit')
      .gte('timestamp', since.toISOString());

    if (error) {
      console.error('Failed to get performance stats:', error);
      return null;
    }

    // Group by metric name
    const byName: Record<string, { count: number; avg: number; min: number; max: number }> = {};

    data.forEach((metric: any) => {
      if (!byName[metric.name]) {
        byName[metric.name] = {
          count: 0,
          avg: 0,
          min: Infinity,
          max: -Infinity
        };
      }

      const stats = byName[metric.name];
      stats.count++;
      stats.avg = ((stats.avg * (stats.count - 1)) + metric.value) / stats.count;
      stats.min = Math.min(stats.min, metric.value);
      stats.max = Math.max(stats.max, metric.value);
    });

    return {
      total: data.length,
      byMetric: byName,
      period: `${hours}h`
    };
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(hours: number = 24): Promise<any> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const { data, error } = await this.supabase
      .from('usage_events')
      .select('command, success, duration')
      .gte('timestamp', since.toISOString());

    if (error) {
      console.error('Failed to get usage stats:', error);
      return null;
    }

    // Group by command
    const byCommand: Record<string, { count: number; successRate: number; avgDuration: number }> = {};

    data.forEach((event: any) => {
      if (!byCommand[event.command]) {
        byCommand[event.command] = {
          count: 0,
          successRate: 0,
          avgDuration: 0
        };
      }

      const stats = byCommand[event.command];
      stats.count++;
      const successCount = stats.successRate * (stats.count - 1) + (event.success ? 1 : 0);
      stats.successRate = successCount / stats.count;
      stats.avgDuration = ((stats.avgDuration * (stats.count - 1)) + event.duration) / stats.count;
    });

    return {
      total: data.length,
      byCommand,
      period: `${hours}h`
    };
  }
}

/**
 * Handle monitoring data ingestion
 */
export async function handleMonitoring(
  request: Request,
  supabase: SupabaseClient
): Promise<Response> {
  try {
    // Parse request body
    const payload: MonitoringPayload = await request.json();

    // Validate payload
    if (!payload.timestamp) {
      return new Response(
        JSON.stringify({ error: 'Missing timestamp' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const analytics = new AnalyticsManager(supabase);

    // Store all data in parallel
    await Promise.all([
      payload.errors ? analytics.storeErrors(payload.errors) : Promise.resolve(),
      payload.metrics ? analytics.storeMetrics(payload.metrics) : Promise.resolve(),
      payload.usage ? analytics.storeUsage(payload.usage) : Promise.resolve()
    ]);

    // Log critical errors
    if (payload.errors) {
      const criticalErrors = payload.errors.filter(e => e.severity === ErrorSeverity.CRITICAL);
      if (criticalErrors.length > 0) {
        console.warn(`[CRITICAL] Received ${criticalErrors.length} critical errors`);
        criticalErrors.forEach(e => {
          console.warn(`  - ${e.message}`, e.stack);
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        received: {
          errors: payload.errors?.length || 0,
          metrics: payload.metrics?.length || 0,
          usage: payload.usage?.length || 0
        }
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    console.error('Error handling monitoring data:', error);

    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Get monitoring statistics
 */
export async function handleMonitoringStats(
  request: Request,
  supabase: SupabaseClient
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const hours = parseInt(url.searchParams.get('hours') || '24');

    const analytics = new AnalyticsManager(supabase);

    const [errorStats, perfStats, usageStats] = await Promise.all([
      analytics.getErrorStats(hours),
      analytics.getPerformanceStats(hours),
      analytics.getUsageStats(hours)
    ]);

    return new Response(
      JSON.stringify({
        errors: errorStats,
        performance: perfStats,
        usage: usageStats
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    console.error('Error getting monitoring stats:', error);

    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
