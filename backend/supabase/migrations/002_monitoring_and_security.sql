-- GuardScan Monitoring & Security - Open Source Edition
-- Migration: 002_monitoring_and_security
-- Description: Monitoring tables, analytics views, functions, and Row Level Security
-- Created: 2024-11-17

-- ============================================================================
-- ERRORS TABLE
-- ============================================================================
-- Tracks error events from CLI for debugging and monitoring
CREATE TABLE IF NOT EXISTS errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    error_id TEXT NOT NULL UNIQUE,
    timestamp TIMESTAMPTZ NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    message TEXT NOT NULL,
    stack TEXT,
    context JSONB,
    environment JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for errors table
CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON errors(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_severity ON errors(severity);
CREATE INDEX IF NOT EXISTS idx_errors_created_at ON errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_errors_error_id ON errors(error_id);

-- Comments
COMMENT ON TABLE errors IS 'Stores error events from CLI with context and environment info';
COMMENT ON COLUMN errors.error_id IS 'Unique error identifier';
COMMENT ON COLUMN errors.severity IS 'Error severity: low, medium, high, critical';
COMMENT ON COLUMN errors.message IS 'Error message';
COMMENT ON COLUMN errors.stack IS 'Stack trace (optional)';
COMMENT ON COLUMN errors.context IS 'Error context (command, args, etc.)';
COMMENT ON COLUMN errors.environment IS 'Environment info (OS, Node version, etc.)';

-- ============================================================================
-- METRICS TABLE
-- ============================================================================
-- Tracks performance metrics from CLI
CREATE TABLE IF NOT EXISTS metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_id TEXT NOT NULL UNIQUE,
    timestamp TIMESTAMPTZ NOT NULL,
    name TEXT NOT NULL,
    value NUMERIC NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('ms', 'MB', 'count', 'LOC/sec')),
    tags JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for metrics table
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name);
CREATE INDEX IF NOT EXISTS idx_metrics_created_at ON metrics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_metric_id ON metrics(metric_id);
CREATE INDEX IF NOT EXISTS idx_metrics_name_timestamp ON metrics(name, timestamp DESC);

-- Comments
COMMENT ON TABLE metrics IS 'Stores performance metrics (execution time, memory usage, etc.)';
COMMENT ON COLUMN metrics.name IS 'Metric name (e.g., scan_duration, memory_usage)';
COMMENT ON COLUMN metrics.value IS 'Numeric metric value';
COMMENT ON COLUMN metrics.unit IS 'Unit of measurement: ms, MB, count, LOC/sec';
COMMENT ON COLUMN metrics.tags IS 'Additional metric tags (JSONB)';

-- ============================================================================
-- USAGE EVENTS TABLE
-- ============================================================================
-- Tracks CLI command usage for analytics
CREATE TABLE IF NOT EXISTS usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL UNIQUE,
    timestamp TIMESTAMPTZ NOT NULL,
    command TEXT NOT NULL,
    duration INTEGER NOT NULL,
    success BOOLEAN NOT NULL,
    client_id TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for usage_events table
CREATE INDEX IF NOT EXISTS idx_usage_events_timestamp ON usage_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_command ON usage_events(command);
CREATE INDEX IF NOT EXISTS idx_usage_events_client_id ON usage_events(client_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_event_id ON usage_events(event_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_command_timestamp ON usage_events(command, timestamp DESC);

-- Comments
COMMENT ON TABLE usage_events IS 'Stores CLI command usage events for analytics';
COMMENT ON COLUMN usage_events.command IS 'CLI command executed';
COMMENT ON COLUMN usage_events.duration IS 'Command duration in milliseconds';
COMMENT ON COLUMN usage_events.success IS 'Whether command completed successfully';
COMMENT ON COLUMN usage_events.client_id IS 'Client that executed the command';

-- ============================================================================
-- HEALTH CHECKS TABLE
-- ============================================================================
-- Stores system health check results
CREATE TABLE IF NOT EXISTS health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'unhealthy')),
    checks JSONB NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for health_checks table
CREATE INDEX IF NOT EXISTS idx_health_checks_timestamp ON health_checks(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_health_checks_status ON health_checks(status);

-- Comments
COMMENT ON TABLE health_checks IS 'Stores system health check results';

-- ============================================================================
-- ANALYTICS VIEWS
-- ============================================================================

-- Error summary view (hourly aggregation)
CREATE OR REPLACE VIEW error_summary AS
SELECT
    DATE_TRUNC('hour', timestamp) AS hour,
    severity,
    COUNT(*) AS count,
    COUNT(DISTINCT context->>'command') AS affected_commands
FROM errors
WHERE timestamp >= NOW() - INTERVAL '7 days'
GROUP BY hour, severity
ORDER BY hour DESC, severity;

COMMENT ON VIEW error_summary IS 'Hourly error summary by severity for last 7 days';

-- Performance metrics summary view (with percentiles)
CREATE OR REPLACE VIEW performance_summary AS
SELECT
    DATE_TRUNC('hour', timestamp) AS hour,
    name AS metric_name,
    unit,
    COUNT(*) AS sample_count,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value) AS p50,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value) AS p95,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY value) AS p99
FROM metrics
WHERE timestamp >= NOW() - INTERVAL '7 days'
GROUP BY hour, name, unit
ORDER BY hour DESC, name;

COMMENT ON VIEW performance_summary IS 'Hourly performance metrics summary with percentiles';

-- Usage summary view (command statistics)
CREATE OR REPLACE VIEW usage_summary AS
SELECT
    DATE_TRUNC('hour', timestamp) AS hour,
    command,
    COUNT(*) AS execution_count,
    SUM(CASE WHEN success THEN 1 ELSE 0 END) AS success_count,
    (SUM(CASE WHEN success THEN 1 ELSE 0 END)::FLOAT / COUNT(*)) * 100 AS success_rate,
    AVG(duration) AS avg_duration_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration) AS p95_duration_ms,
    COUNT(DISTINCT client_id) AS unique_users
FROM usage_events
WHERE timestamp >= NOW() - INTERVAL '7 days'
GROUP BY hour, command
ORDER BY hour DESC, execution_count DESC;

COMMENT ON VIEW usage_summary IS 'Hourly usage summary with success rates and latencies';

-- ============================================================================
-- UTILITY FUNCTIONS
-- ============================================================================

-- Function: Clean up old monitoring data
CREATE OR REPLACE FUNCTION cleanup_old_monitoring_data(retention_days INTEGER DEFAULT 30)
RETURNS TABLE(
    errors_deleted INTEGER,
    metrics_deleted INTEGER,
    usage_deleted INTEGER,
    health_checks_deleted INTEGER
) AS $$
DECLARE
    cutoff_date TIMESTAMPTZ;
    errors_count INTEGER;
    metrics_count INTEGER;
    usage_count INTEGER;
    health_count INTEGER;
BEGIN
    cutoff_date := NOW() - (retention_days || ' days')::INTERVAL;
    
    -- Delete old errors
    DELETE FROM errors WHERE timestamp < cutoff_date;
    GET DIAGNOSTICS errors_count = ROW_COUNT;
    
    -- Delete old metrics
    DELETE FROM metrics WHERE timestamp < cutoff_date;
    GET DIAGNOSTICS metrics_count = ROW_COUNT;
    
    -- Delete old usage events
    DELETE FROM usage_events WHERE timestamp < cutoff_date;
    GET DIAGNOSTICS usage_count = ROW_COUNT;
    
    -- Delete old health checks
    DELETE FROM health_checks WHERE timestamp < cutoff_date;
    GET DIAGNOSTICS health_count = ROW_COUNT;
    
    RETURN QUERY SELECT errors_count, metrics_count, usage_count, health_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_monitoring_data IS 'Removes monitoring data older than specified retention period';

-- Function: Get system health status
CREATE OR REPLACE FUNCTION get_system_health()
RETURNS TABLE(
    status TEXT,
    error_rate NUMERIC,
    avg_response_time NUMERIC,
    success_rate NUMERIC,
    active_users INTEGER
) AS $$
DECLARE
    v_error_count INTEGER;
    v_total_events INTEGER;
    v_avg_duration NUMERIC;
    v_success_count INTEGER;
    v_active_users INTEGER;
    v_status TEXT;
    v_error_rate NUMERIC;
    v_success_rate NUMERIC;
BEGIN
    -- Count errors in last hour
    SELECT COUNT(*) INTO v_error_count
    FROM errors
    WHERE timestamp >= NOW() - INTERVAL '1 hour'
        AND severity IN ('high', 'critical');
    
    -- Get usage stats for last hour
    SELECT
        COUNT(*),
        AVG(duration),
        SUM(CASE WHEN success THEN 1 ELSE 0 END),
        COUNT(DISTINCT client_id)
    INTO v_total_events, v_avg_duration, v_success_count, v_active_users
    FROM usage_events
    WHERE timestamp >= NOW() - INTERVAL '1 hour';
    
    -- Calculate rates
    v_error_rate := CASE
        WHEN v_total_events > 0 THEN (v_error_count::NUMERIC / v_total_events) * 100
        ELSE 0
    END;
    
    v_success_rate := CASE
        WHEN v_total_events > 0 THEN (v_success_count::NUMERIC / v_total_events) * 100
        ELSE 100
    END;
    
    -- Determine status
    v_status := CASE
        WHEN v_error_rate > 10 OR v_success_rate < 90 THEN 'unhealthy'
        WHEN v_error_rate > 5 OR v_success_rate < 95 THEN 'degraded'
        ELSE 'healthy'
    END;
    
    RETURN QUERY SELECT
        v_status,
        v_error_rate,
        COALESCE(v_avg_duration, 0),
        v_success_rate,
        COALESCE(v_active_users, 0);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_system_health IS 'Returns current system health status based on recent errors and usage';

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_checks ENABLE ROW LEVEL SECURITY;

-- Revoke all default public access
REVOKE ALL ON clients FROM PUBLIC;
REVOKE ALL ON telemetry FROM PUBLIC;
REVOKE ALL ON errors FROM PUBLIC;
REVOKE ALL ON metrics FROM PUBLIC;
REVOKE ALL ON usage_events FROM PUBLIC;
REVOKE ALL ON health_checks FROM PUBLIC;

-- Service role has full access (for backend API)
CREATE POLICY "Service role full access to clients" ON clients
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to telemetry" ON telemetry
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to errors" ON errors
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to metrics" ON metrics
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to usage_events" ON usage_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to health_checks" ON health_checks
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Grant permissions to service role
GRANT ALL ON clients TO service_role;
GRANT ALL ON telemetry TO service_role;
GRANT ALL ON errors TO service_role;
GRANT ALL ON metrics TO service_role;
GRANT ALL ON usage_events TO service_role;
GRANT ALL ON health_checks TO service_role;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '==========================================';
    RAISE NOTICE 'GuardScan Monitoring & Security Applied';
    RAISE NOTICE '==========================================';
    RAISE NOTICE 'Monitoring tables: errors, metrics, usage_events, health_checks';
    RAISE NOTICE 'Analytics views: error_summary, performance_summary, usage_summary';
    RAISE NOTICE 'Functions: cleanup_old_monitoring_data(), get_system_health()';
    RAISE NOTICE 'Row Level Security: ENABLED on all tables (service role only)';
    RAISE NOTICE '==========================================';
    RAISE NOTICE 'Total tables: 6';
    RAISE NOTICE 'Total views: 3';
    RAISE NOTICE 'Total functions: 2';
    RAISE NOTICE '==========================================';
END $$;

