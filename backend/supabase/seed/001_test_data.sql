-- GuardScan Test Seed Data
-- File: 001_test_data.sql
-- Description: Sample data for development and testing
-- Created: 2025-11-14
-- WARNING: DO NOT run this in production!

-- ============================================================================
-- TEST CLIENTS
-- ============================================================================

INSERT INTO clients (client_id, plan_tier, total_loc_used, email, metadata)
VALUES
  (
    'test-client-free-001',
    'free',
    500,
    'test-free@example.com',
    '{"test_account": true, "created_by": "seed_script"}'
  ),
  (
    'test-client-starter-002',
    'starter',
    15000,
    'test-starter@example.com',
    '{"test_account": true, "created_by": "seed_script"}'
  ),
  (
    'test-client-pro-003',
    'pro',
    50000,
    'test-pro@example.com',
    '{"test_account": true, "created_by": "seed_script"}'
  ),
  (
    'test-client-enterprise-004',
    'enterprise',
    200000,
    'test-enterprise@example.com',
    '{"test_account": true, "created_by": "seed_script"}'
  )
ON CONFLICT (client_id) DO NOTHING;

-- ============================================================================
-- TEST TRANSACTIONS
-- ============================================================================

INSERT INTO transactions (client_id, loc_purchased, amount_usd, payment_status, stripe_payment_id, metadata)
VALUES
  (
    'test-client-starter-002',
    50000,
    4.99,
    'paid',
    'pi_test_starter_001',
    '{"test_transaction": true, "plan": "starter"}'
  ),
  (
    'test-client-pro-003',
    200000,
    14.99,
    'paid',
    'pi_test_pro_001',
    '{"test_transaction": true, "plan": "pro"}'
  ),
  (
    'test-client-pro-003',
    200000,
    14.99,
    'paid',
    'pi_test_pro_002',
    '{"test_transaction": true, "plan": "pro", "renewal": true}'
  ),
  (
    'test-client-enterprise-004',
    1000000,
    49.99,
    'paid',
    'pi_test_enterprise_001',
    '{"test_transaction": true, "plan": "enterprise"}'
  ),
  (
    'test-client-starter-002',
    50000,
    4.99,
    'failed',
    'pi_test_starter_failed_001',
    '{"test_transaction": true, "error": "card_declined"}'
  )
ON CONFLICT (transaction_id) DO NOTHING;

-- ============================================================================
-- TEST TELEMETRY EVENTS
-- ============================================================================

INSERT INTO telemetry (client_id, repo_id, action_type, duration_ms, model, loc, metadata)
VALUES
  -- Free tier user activity
  (
    'test-client-free-001',
    'repo-hash-abc123',
    'init',
    1200,
    NULL,
    NULL,
    '{"test_event": true}'
  ),
  (
    'test-client-free-001',
    'repo-hash-abc123',
    'security',
    8500,
    NULL,
    500,
    '{"test_event": true, "findings": 3}'
  ),
  (
    'test-client-free-001',
    'repo-hash-abc123',
    'run',
    15000,
    'gpt-4',
    500,
    '{"test_event": true}'
  ),

  -- Starter tier user activity
  (
    'test-client-starter-002',
    'repo-hash-def456',
    'init',
    1100,
    NULL,
    NULL,
    '{"test_event": true}'
  ),
  (
    'test-client-starter-002',
    'repo-hash-def456',
    'run',
    25000,
    'claude-3-sonnet',
    15000,
    '{"test_event": true}'
  ),
  (
    'test-client-starter-002',
    'repo-hash-def456',
    'security',
    12000,
    NULL,
    15000,
    '{"test_event": true, "findings": 12}'
  ),

  -- Pro tier user activity
  (
    'test-client-pro-003',
    'repo-hash-ghi789',
    'run',
    45000,
    'gpt-4-turbo',
    50000,
    '{"test_event": true}'
  ),
  (
    'test-client-pro-003',
    'repo-hash-ghi789',
    'security',
    22000,
    NULL,
    50000,
    '{"test_event": true, "findings": 25}'
  ),
  (
    'test-client-pro-003',
    'repo-hash-ghi789',
    'test',
    18000,
    NULL,
    50000,
    '{"test_event": true, "coverage": 85}'
  ),
  (
    'test-client-pro-003',
    'repo-hash-ghi789',
    'sbom',
    5000,
    NULL,
    50000,
    '{"test_event": true, "dependencies": 120}'
  ),

  -- Enterprise tier user activity
  (
    'test-client-enterprise-004',
    'repo-hash-jkl012',
    'run',
    120000,
    'claude-3-opus',
    200000,
    '{"test_event": true}'
  ),
  (
    'test-client-enterprise-004',
    'repo-hash-jkl012',
    'security',
    45000,
    NULL,
    200000,
    '{"test_event": true, "findings": 50}'
  ),
  (
    'test-client-enterprise-004',
    'repo-hash-jkl012',
    'perf',
    30000,
    NULL,
    200000,
    '{"test_event": true, "benchmarks": 15}'
  ),
  (
    'test-client-enterprise-004',
    'repo-hash-jkl012',
    'mutation',
    60000,
    NULL,
    200000,
    '{"test_event": true, "mutations": 500}'
  )
ON CONFLICT (event_id) DO NOTHING;

-- ============================================================================
-- REFRESH MATERIALIZED VIEW
-- ============================================================================

REFRESH MATERIALIZED VIEW credits_balance;

-- ============================================================================
-- VERIFY SEED DATA
-- ============================================================================

-- Show summary of seeded data
DO $$
BEGIN
  RAISE NOTICE '==========================================';
  RAISE NOTICE 'GuardScan Test Data Seeded Successfully';
  RAISE NOTICE '==========================================';
  RAISE NOTICE 'Clients: % records', (SELECT COUNT(*) FROM clients WHERE metadata->>'test_account' = 'true');
  RAISE NOTICE 'Transactions: % records', (SELECT COUNT(*) FROM transactions WHERE metadata->>'test_transaction' = 'true');
  RAISE NOTICE 'Telemetry Events: % records', (SELECT COUNT(*) FROM telemetry WHERE metadata->>'test_event' = 'true');
  RAISE NOTICE '==========================================';
END $$;

-- Display credit balances for test accounts
SELECT
  client_id,
  plan_tier,
  total_purchased,
  total_loc_used,
  remaining_credits
FROM credits_balance
WHERE client_id LIKE 'test-client-%'
ORDER BY plan_tier;
