/**
 * GuardScan Simplified Database Schema
 *
 * 100% Free & Open Source - No payments, no credits
 * BYOK (Bring Your Own Key) model
 *
 * Optional telemetry for product analytics and debugging
 * Can be completely disabled with --no-telemetry flag
 */

-- ============================================================================
-- TELEMETRY TABLE (Optional - Anonymous Usage Data)
-- ============================================================================
CREATE TABLE IF NOT EXISTS telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Anonymous identifiers (hashed)
  client_id TEXT NOT NULL,  -- Local client UUID (not tied to user identity)
  repo_id TEXT NOT NULL,    -- Hashed repository URL

  -- Usage data
  command TEXT NOT NULL,
  loc_count INTEGER,
  language_breakdown JSONB,  -- { "typescript": 1000, "python": 500 }

  -- Metadata
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cli_version TEXT,
  node_version TEXT,
  platform TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for querying
CREATE INDEX IF NOT EXISTS idx_telemetry_command ON telemetry(command);
CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_client_id ON telemetry(client_id);

-- ============================================================================
-- ERRORS TABLE (Optional - Error Tracking for Debugging)
-- ============================================================================
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

CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON errors(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_severity ON errors(severity);
CREATE INDEX IF NOT EXISTS idx_errors_error_id ON errors(error_id);

-- ============================================================================
-- METRICS TABLE (Optional - Performance Monitoring)
-- ============================================================================
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

CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name);
CREATE INDEX IF NOT EXISTS idx_metrics_name_timestamp ON metrics(name, timestamp DESC);

-- ============================================================================
-- USAGE EVENTS TABLE (Optional - Command Usage Analytics)
-- ============================================================================
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

CREATE INDEX IF NOT EXISTS idx_usage_events_timestamp ON usage_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_command ON usage_events(command);
CREATE INDEX IF NOT EXISTS idx_usage_events_command_timestamp ON usage_events(command, timestamp DESC);

-- ============================================================================
-- VIEWS - Analytics Summaries
-- ============================================================================

-- Command usage summary
CREATE OR REPLACE VIEW command_usage_summary AS
SELECT
  command,
  COUNT(*) AS total_uses,
  COUNT(DISTINCT client_id) AS unique_users,
  AVG(duration) AS avg_duration_ms,
  SUM(CASE WHEN success THEN 1 ELSE 0 END)::FLOAT / COUNT(*) * 100 AS success_rate
FROM usage_events
WHERE timestamp >= NOW() - INTERVAL '30 days'
GROUP BY command
ORDER BY total_uses DESC;

-- Popular languages
CREATE OR REPLACE VIEW popular_languages AS
SELECT
  jsonb_object_keys(language_breakdown) AS language,
  SUM((language_breakdown->>jsonb_object_keys(language_breakdown))::INTEGER) AS total_loc
FROM telemetry
WHERE timestamp >= NOW() - INTERVAL '30 days'
  AND language_breakdown IS NOT NULL
GROUP BY language
ORDER BY total_loc DESC;

-- Error rate by command
CREATE OR REPLACE VIEW error_rate_by_command AS
SELECT
  ue.command,
  COUNT(DISTINCT e.id) AS error_count,
  COUNT(DISTINCT ue.id) AS total_executions,
  (COUNT(DISTINCT e.id)::FLOAT / NULLIF(COUNT(DISTINCT ue.id), 0)) * 100 AS error_rate
FROM usage_events ue
LEFT JOIN errors e
  ON e.timestamp BETWEEN ue.timestamp - INTERVAL '1 second'
  AND ue.timestamp + INTERVAL '1 second'
WHERE ue.timestamp >= NOW() - INTERVAL '7 days'
GROUP BY ue.command
ORDER BY error_rate DESC;

-- ============================================================================
-- FUNCTIONS - Data Cleanup
-- ============================================================================

/**
 * Clean up old telemetry data
 * Retains data for specified number of days (default 90 days)
 */
CREATE OR REPLACE FUNCTION cleanup_old_telemetry(retention_days INTEGER DEFAULT 90)
RETURNS TABLE(
  telemetry_deleted INTEGER,
  errors_deleted INTEGER,
  metrics_deleted INTEGER,
  usage_deleted INTEGER
) AS $$
DECLARE
  cutoff_date TIMESTAMPTZ;
  telemetry_count INTEGER;
  errors_count INTEGER;
  metrics_count INTEGER;
  usage_count INTEGER;
BEGIN
  cutoff_date := NOW() - (retention_days || ' days')::INTERVAL;

  DELETE FROM telemetry WHERE timestamp < cutoff_date;
  GET DIAGNOSTICS telemetry_count = ROW_COUNT;

  DELETE FROM errors WHERE timestamp < cutoff_date;
  GET DIAGNOSTICS errors_count = ROW_COUNT;

  DELETE FROM metrics WHERE timestamp < cutoff_date;
  GET DIAGNOSTICS metrics_count = ROW_COUNT;

  DELETE FROM usage_events WHERE timestamp < cutoff_date;
  GET DIAGNOSTICS usage_count = ROW_COUNT;

  RETURN QUERY SELECT telemetry_count, errors_count, metrics_count, usage_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- Service role has full access (for backend)
CREATE POLICY "Service role has full access to telemetry"
  ON telemetry FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role has full access to errors"
  ON errors FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role has full access to metrics"
  ON metrics FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role has full access to usage_events"
  ON usage_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE telemetry IS 'Anonymous usage telemetry - no source code, just metadata';
COMMENT ON TABLE errors IS 'Error tracking for debugging - can be disabled with --no-telemetry';
COMMENT ON TABLE metrics IS 'Performance metrics for product improvements';
COMMENT ON TABLE usage_events IS 'Command usage analytics - anonymous and optional';

COMMENT ON VIEW command_usage_summary IS 'Most popular commands and success rates';
COMMENT ON VIEW popular_languages IS 'Most analyzed programming languages';
COMMENT ON VIEW error_rate_by_command IS 'Commands with highest error rates';

COMMENT ON FUNCTION cleanup_old_telemetry IS 'Removes telemetry older than retention period';

-- ============================================================================
-- PRIVACY GUARANTEE
-- ============================================================================

/**
 * PRIVACY COMMITMENT:
 *
 * - NO source code is ever sent to GuardScan backend
 * - NO file names or file paths are ever sent
 * - Client ID is a local UUID, not tied to user identity
 * - Repo ID is a cryptographic hash of git remote URL
 * - All telemetry is OPTIONAL and can be disabled with --no-telemetry
 * - Users can self-host or run completely offline
 * - AI processing happens with USER'S OWN API keys
 *
 * GuardScan is 100% free and open source (BYOK model).
 * Users pay AI providers directly, not GuardScan.
 */
