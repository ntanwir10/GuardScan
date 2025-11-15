-- GuardScan Open Source Test Data
-- File: 002_open_source_test_data.sql
-- Description: Sample data for open-source, telemetry-only backend
-- Created: 2025-11-15
-- WARNING: DO NOT run this in production!

-- ============================================================================
-- TEST CLIENTS (Simplified - No Payment Data)
-- ============================================================================

INSERT INTO clients (client_id, created_at, last_seen_at, cli_version, metadata)
VALUES
  (
    'test-client-001',
    NOW() - INTERVAL '30 days',
    NOW() - INTERVAL '1 day',
    '0.1.0',
    '{"test_account": true, "description": "Active user with regular usage"}'
  ),
  (
    'test-client-002',
    NOW() - INTERVAL '15 days',
    NOW() - INTERVAL '2 hours',
    '0.1.0',
    '{"test_account": true, "description": "Recent user, frequent scans"}'
  ),
  (
    'test-client-003',
    NOW() - INTERVAL '7 days',
    NOW() - INTERVAL '5 days',
    '0.0.9',
    '{"test_account": true, "description": "Older CLI version, inactive"}'
  ),
  (
    'test-client-004',
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '1 hour',
    '0.1.0',
    '{"test_account": true, "description": "New user, trying AI features"}'
  )
ON CONFLICT (client_id) DO NOTHING;

-- ============================================================================
-- TEST TELEMETRY EVENTS
-- ============================================================================

INSERT INTO telemetry (client_id, repo_id, action_type, duration_ms, model, loc, timestamp, metadata)
VALUES
  -- Client 001: Regular usage pattern
  (
    'test-client-001',
    'repo-hash-project-a',
    'init',
    1200,
    NULL,
    NULL,
    NOW() - INTERVAL '30 days',
    '{"test_event": true}'
  ),
  (
    'test-client-001',
    'repo-hash-project-a',
    'security',
    8500,
    NULL,
    5000,
    NOW() - INTERVAL '29 days',
    '{"test_event": true, "findings": 3}'
  ),
  (
    'test-client-001',
    'repo-hash-project-a',
    'run',
    25000,
    'gpt-4',
    5000,
    NOW() - INTERVAL '28 days',
    '{"test_event": true}'
  ),
  (
    'test-client-001',
    'repo-hash-project-a',
    'run',
    22000,
    'claude-3-sonnet',
    5200,
    NOW() - INTERVAL '15 days',
    '{"test_event": true}'
  ),
  (
    'test-client-001',
    'repo-hash-project-a',
    'security',
    9000,
    NULL,
    5200,
    NOW() - INTERVAL '1 day',
    '{"test_event": true, "findings": 1}'
  ),

  -- Client 002: Heavy AI user
  (
    'test-client-002',
    'repo-hash-project-b',
    'init',
    1100,
    NULL,
    NULL,
    NOW() - INTERVAL '15 days',
    '{"test_event": true}'
  ),
  (
    'test-client-002',
    'repo-hash-project-b',
    'run',
    30000,
    'gpt-4-turbo',
    12000,
    NOW() - INTERVAL '14 days',
    '{"test_event": true}'
  ),
  (
    'test-client-002',
    'repo-hash-project-b',
    'run',
    28000,
    'gpt-4-turbo',
    12500,
    NOW() - INTERVAL '10 days',
    '{"test_event": true}'
  ),
  (
    'test-client-002',
    'repo-hash-project-b',
    'run',
    26000,
    'claude-3-opus',
    13000,
    NOW() - INTERVAL '5 days',
    '{"test_event": true}'
  ),
  (
    'test-client-002',
    'repo-hash-project-b',
    'security',
    15000,
    NULL,
    13000,
    NOW() - INTERVAL '2 hours',
    '{"test_event": true, "findings": 8}'
  ),

  -- Client 003: Static analysis only (no AI)
  (
    'test-client-003',
    'repo-hash-project-c',
    'init',
    1300,
    NULL,
    NULL,
    NOW() - INTERVAL '7 days',
    '{"test_event": true}'
  ),
  (
    'test-client-003',
    'repo-hash-project-c',
    'security',
    7000,
    NULL,
    3000,
    NOW() - INTERVAL '6 days',
    '{"test_event": true, "findings": 5}'
  ),
  (
    'test-client-003',
    'repo-hash-project-c',
    'test',
    10000,
    NULL,
    3000,
    NOW() - INTERVAL '5 days',
    '{"test_event": true, "coverage": 75}'
  ),

  -- Client 004: New user exploring features
  (
    'test-client-004',
    'repo-hash-project-d',
    'init',
    1000,
    NULL,
    NULL,
    NOW() - INTERVAL '2 days',
    '{"test_event": true}'
  ),
  (
    'test-client-004',
    'repo-hash-project-d',
    'security',
    6000,
    NULL,
    2000,
    NOW() - INTERVAL '2 days',
    '{"test_event": true, "findings": 2}'
  ),
  (
    'test-client-004',
    'repo-hash-project-d',
    'run',
    18000,
    'gemini-pro',
    2000,
    NOW() - INTERVAL '1 day',
    '{"test_event": true}'
  ),
  (
    'test-client-004',
    'repo-hash-project-d',
    'sbom',
    3000,
    NULL,
    2000,
    NOW() - INTERVAL '1 hour',
    '{"test_event": true, "dependencies": 45}'
  )
ON CONFLICT (event_id) DO NOTHING;

-- ============================================================================
-- VERIFY SEED DATA
-- ============================================================================

-- Display summary
DO $$
BEGIN
  RAISE NOTICE '==========================================';
  RAISE NOTICE 'GuardScan Open Source Test Data Loaded';
  RAISE NOTICE '==========================================';
  RAISE NOTICE 'Clients: % test accounts', (SELECT COUNT(*) FROM clients WHERE metadata->>'test_account' = 'true');
  RAISE NOTICE 'Telemetry Events: % test events', (SELECT COUNT(*) FROM telemetry WHERE metadata->>'test_event' = 'true');
  RAISE NOTICE '==========================================';
END $$;

-- Display client activity summary
SELECT
  c.client_id,
  c.cli_version,
  c.created_at::DATE as joined,
  c.last_seen_at::DATE as last_active,
  COUNT(t.event_id) as total_events,
  COUNT(DISTINCT t.action_type) as unique_actions,
  SUM(CASE WHEN t.model IS NOT NULL THEN 1 ELSE 0 END) as ai_scans
FROM clients c
LEFT JOIN telemetry t ON c.client_id = t.client_id
WHERE c.metadata->>'test_account' = 'true'
GROUP BY c.client_id, c.cli_version, c.created_at, c.last_seen_at
ORDER BY c.created_at DESC;

-- Display most popular commands
SELECT
  action_type,
  COUNT(*) as total_executions,
  ROUND(AVG(duration_ms)::NUMERIC, 0) as avg_duration_ms,
  COUNT(DISTINCT client_id) as unique_users,
  SUM(CASE WHEN model IS NOT NULL THEN 1 ELSE 0 END) as with_ai
FROM telemetry
WHERE metadata->>'test_event' = 'true'
GROUP BY action_type
ORDER BY total_executions DESC;
