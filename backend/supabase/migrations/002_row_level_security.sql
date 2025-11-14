-- GuardScan Row Level Security (RLS) Policies
-- Migration: 002_row_level_security
-- Description: Enable RLS and create security policies for all tables
-- Created: 2025-11-14

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- CLIENTS TABLE POLICIES
-- ============================================================================

-- Policy: Service role has full access (for backend API)
CREATE POLICY "Service role has full access to clients"
ON clients
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Policy: Authenticated users can read their own client record
CREATE POLICY "Users can read their own client data"
ON clients
FOR SELECT
TO authenticated
USING (client_id = auth.uid()::text);

-- Policy: Authenticated users can update their own client record
CREATE POLICY "Users can update their own client data"
ON clients
FOR UPDATE
TO authenticated
USING (client_id = auth.uid()::text)
WITH CHECK (client_id = auth.uid()::text);

-- Note: INSERT for clients is only allowed via service role (backend creates clients)

-- ============================================================================
-- TRANSACTIONS TABLE POLICIES
-- ============================================================================

-- Policy: Service role has full access (for Stripe webhooks and backend)
CREATE POLICY "Service role has full access to transactions"
ON transactions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Policy: Authenticated users can read their own transactions
CREATE POLICY "Users can read their own transactions"
ON transactions
FOR SELECT
TO authenticated
USING (client_id = auth.uid()::text);

-- Note: INSERT/UPDATE for transactions only via service role (Stripe webhooks)

-- ============================================================================
-- TELEMETRY TABLE POLICIES
-- ============================================================================

-- Policy: Service role has full access (for backend telemetry ingestion)
CREATE POLICY "Service role has full access to telemetry"
ON telemetry
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Policy: No direct access for authenticated users (telemetry is write-only via API)
-- This ensures privacy - users can't query telemetry directly

-- ============================================================================
-- ADDITIONAL SECURITY MEASURES
-- ============================================================================

-- Revoke all default public access
REVOKE ALL ON clients FROM PUBLIC;
REVOKE ALL ON transactions FROM PUBLIC;
REVOKE ALL ON telemetry FROM PUBLIC;

-- Grant specific permissions to authenticated role
GRANT SELECT ON clients TO authenticated;
GRANT UPDATE ON clients TO authenticated;
GRANT SELECT ON transactions TO authenticated;

-- Service role gets all permissions (already has them, but explicit is good)
GRANT ALL ON clients TO service_role;
GRANT ALL ON transactions TO service_role;
GRANT ALL ON telemetry TO service_role;

-- ============================================================================
-- REALTIME SUBSCRIPTIONS (Optional - if you want live updates)
-- ============================================================================

-- Enable realtime for clients table (users can subscribe to their credit balance)
ALTER PUBLICATION supabase_realtime ADD TABLE clients;

-- Note: Transactions and telemetry are excluded from realtime for privacy

-- ============================================================================
-- API KEY RESTRICTIONS
-- ============================================================================

-- Comment documenting API key usage:
--
-- ANON_KEY (public):
--   - Should NOT be used by GuardScan CLI
--   - Only for potential web dashboard in future
--   - RLS policies prevent unauthorized access
--
-- SERVICE_ROLE_KEY (secret):
--   - Used by Cloudflare Workers backend
--   - Bypasses RLS for administrative operations
--   - MUST be kept secret in environment variables
--   - Validates requests before database operations

COMMENT ON TABLE clients IS 'RLS enabled - service role for backend, authenticated for user access';
COMMENT ON TABLE transactions IS 'RLS enabled - service role for backend and Stripe, authenticated read-only';
COMMENT ON TABLE telemetry IS 'RLS enabled - service role only (privacy-preserving)';
