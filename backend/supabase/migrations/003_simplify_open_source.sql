-- GuardScan Open Source Migration
-- Migration: 003_simplify_open_source
-- Description: Simplify database for open-source, telemetry-only backend
-- Created: 2025-11-15

-- ============================================================================
-- REMOVE PAYMENT-RELATED TABLES AND VIEWS
-- ============================================================================

-- Drop materialized view
DROP MATERIALIZED VIEW IF EXISTS credits_balance;

-- Drop triggers
DROP TRIGGER IF EXISTS refresh_credits_on_transaction_change ON transactions;
DROP TRIGGER IF EXISTS refresh_credits_on_client_change ON clients;
DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;

-- Drop functions
DROP FUNCTION IF EXISTS refresh_credits_balance();
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop transactions table (payment history)
DROP TABLE IF EXISTS transactions CASCADE;

-- ============================================================================
-- SIMPLIFY CLIENTS TABLE
-- ============================================================================

-- Remove payment-related columns from clients
ALTER TABLE clients DROP COLUMN IF EXISTS total_loc_used;
ALTER TABLE clients DROP COLUMN IF EXISTS plan_tier;
ALTER TABLE clients DROP COLUMN IF EXISTS email;

-- Add simple tracking columns
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cli_version VARCHAR(50);

-- Update comments
COMMENT ON TABLE clients IS 'Open-source: Track unique CLI users (no payment data)';
COMMENT ON COLUMN clients.client_id IS 'Unique client identifier (UUID from CLI init)';
COMMENT ON COLUMN clients.created_at IS 'First time CLI was initialized';
COMMENT ON COLUMN clients.last_seen_at IS 'Last activity timestamp';
COMMENT ON COLUMN clients.cli_version IS 'CLI version string';
COMMENT ON COLUMN clients.metadata IS 'Optional metadata (extensible)';

-- ============================================================================
-- UPDATE TELEMETRY TABLE
-- ============================================================================

-- Telemetry table remains unchanged - already privacy-preserving
-- Just update the comment
COMMENT ON TABLE telemetry IS 'Open-source: Privacy-preserving usage analytics (opt-out available)';

-- ============================================================================
-- UPDATE INDEXES
-- ============================================================================

-- Drop payment-related indexes
DROP INDEX IF EXISTS idx_clients_plan_tier;
DROP INDEX IF EXISTS idx_clients_email;
DROP INDEX IF EXISTS idx_transactions_client_id;
DROP INDEX IF EXISTS idx_transactions_payment_status;
DROP INDEX IF EXISTS idx_transactions_created_at;
DROP INDEX IF EXISTS idx_transactions_stripe_payment_id;
DROP INDEX IF EXISTS idx_transactions_stripe_session_id;
DROP INDEX IF EXISTS idx_transactions_client_status;

-- Keep essential indexes for clients
-- idx_clients_created_at already exists

-- Add index for last_seen_at
CREATE INDEX IF NOT EXISTS idx_clients_last_seen ON clients(last_seen_at DESC NULLS LAST);

-- Telemetry indexes remain unchanged (already optimal)

-- ============================================================================
-- UPDATE RLS POLICIES
-- ============================================================================

-- Clients table policies remain the same (service role + authenticated)
-- Telemetry table policies remain the same (service role only)

-- No changes needed - RLS is already configured correctly

-- ============================================================================
-- CLEANUP AND VERIFICATION
-- ============================================================================

-- Vacuum tables to reclaim space
VACUUM ANALYZE clients;
VACUUM ANALYZE telemetry;

-- Display summary
DO $$
BEGIN
  RAISE NOTICE '==========================================';
  RAISE NOTICE 'GuardScan Open Source Migration Complete';
  RAISE NOTICE '==========================================';
  RAISE NOTICE 'Removed: transactions table, credits_balance view';
  RAISE NOTICE 'Simplified: clients table (removed payment columns)';
  RAISE NOTICE 'Kept: telemetry table (privacy-preserving)';
  RAISE NOTICE '==========================================';
  RAISE NOTICE 'Total clients: %', (SELECT COUNT(*) FROM clients);
  RAISE NOTICE 'Total telemetry events: %', (SELECT COUNT(*) FROM telemetry);
  RAISE NOTICE '==========================================';
END $$;
