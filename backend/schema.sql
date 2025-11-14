-- GuardScan Database Schema for Supabase (PostgreSQL)
-- This schema supports the credit system, telemetry, and payment processing

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Clients Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS clients (
    client_id UUID PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    total_loc_used BIGINT DEFAULT 0,
    plan_tier VARCHAR(50) DEFAULT 'free',
    email VARCHAR(255),
    CONSTRAINT positive_loc_used CHECK (total_loc_used >= 0)
);

CREATE INDEX idx_clients_created_at ON clients(created_at);
CREATE INDEX idx_clients_email ON clients(email) WHERE email IS NOT NULL;

-- ============================================================================
-- Transactions Table (Credit Purchases)
-- ============================================================================
CREATE TABLE IF NOT EXISTS transactions (
    transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
    loc_purchased BIGINT NOT NULL,
    amount_usd DECIMAL(10, 2) NOT NULL,
    payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    payment_method VARCHAR(50),
    stripe_payment_id VARCHAR(255),
    stripe_session_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT positive_loc_purchased CHECK (loc_purchased > 0),
    CONSTRAINT positive_amount CHECK (amount_usd >= 0),
    CONSTRAINT valid_payment_status CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded'))
);

CREATE INDEX idx_transactions_client_id ON transactions(client_id);
CREATE INDEX idx_transactions_payment_status ON transactions(payment_status);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_stripe_payment_id ON transactions(stripe_payment_id) WHERE stripe_payment_id IS NOT NULL;

-- ============================================================================
-- Telemetry Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS telemetry (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
    repo_id VARCHAR(32) NOT NULL,  -- SHA-256 hash (first 16 chars)
    action_type VARCHAR(50) NOT NULL,
    duration_ms INTEGER,
    model VARCHAR(100),
    loc BIGINT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT positive_duration CHECK (duration_ms >= 0),
    CONSTRAINT positive_loc CHECK (loc >= 0)
);

CREATE INDEX idx_telemetry_client_id ON telemetry(client_id);
CREATE INDEX idx_telemetry_repo_id ON telemetry(repo_id);
CREATE INDEX idx_telemetry_action_type ON telemetry(action_type);
CREATE INDEX idx_telemetry_timestamp ON telemetry(timestamp);
CREATE INDEX idx_telemetry_created_at ON telemetry(created_at);

-- Partition by month for better performance (optional, for scale)
-- CREATE TABLE telemetry_y2024m11 PARTITION OF telemetry
-- FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');

-- ============================================================================
-- Credits View (Computed)
-- ============================================================================
CREATE OR REPLACE VIEW client_credits AS
SELECT
    c.client_id,
    c.total_loc_used,
    COALESCE(SUM(CASE WHEN t.payment_status = 'paid' THEN t.loc_purchased ELSE 0 END), 0) AS total_loc_purchased,
    COALESCE(SUM(CASE WHEN t.payment_status = 'paid' THEN t.loc_purchased ELSE 0 END), 0) - c.total_loc_used AS remaining_loc,
    c.plan_tier,
    c.created_at,
    c.last_active_at
FROM clients c
LEFT JOIN transactions t ON c.client_id = t.client_id
GROUP BY c.client_id, c.total_loc_used, c.plan_tier, c.created_at, c.last_active_at;

-- ============================================================================
-- Analytics View (Aggregated Telemetry)
-- ============================================================================
CREATE OR REPLACE VIEW telemetry_summary AS
SELECT
    client_id,
    repo_id,
    action_type,
    COUNT(*) AS event_count,
    AVG(duration_ms) AS avg_duration_ms,
    SUM(loc) AS total_loc_analyzed,
    MIN(timestamp) AS first_event,
    MAX(timestamp) AS last_event
FROM telemetry
GROUP BY client_id, repo_id, action_type;

-- ============================================================================
-- Functions
-- ============================================================================

-- Function to update last_active_at
CREATE OR REPLACE FUNCTION update_last_active()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE clients
    SET last_active_at = NOW()
    WHERE client_id = NEW.client_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update last_active_at on telemetry insert
CREATE TRIGGER trigger_update_last_active
AFTER INSERT ON telemetry
FOR EACH ROW
EXECUTE FUNCTION update_last_active();

-- Function to increment LOC usage
CREATE OR REPLACE FUNCTION increment_loc_usage(
    p_client_id UUID,
    p_loc_count BIGINT
) RETURNS VOID AS $$
BEGIN
    UPDATE clients
    SET total_loc_used = total_loc_used + p_loc_count,
        last_active_at = NOW()
    WHERE client_id = p_client_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get remaining credits
CREATE OR REPLACE FUNCTION get_remaining_credits(
    p_client_id UUID
) RETURNS BIGINT AS $$
DECLARE
    v_remaining BIGINT;
BEGIN
    SELECT remaining_loc INTO v_remaining
    FROM client_credits
    WHERE client_id = p_client_id;

    RETURN COALESCE(v_remaining, 0);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Row Level Security (RLS) - IMPORTANT FOR SECURITY
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access (backend only)
CREATE POLICY service_role_all_clients ON clients
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY service_role_all_transactions ON transactions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY service_role_all_telemetry ON telemetry
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Policy: Authenticated users can only see their own data (if implementing user auth)
-- CREATE POLICY user_own_client ON clients
--     FOR SELECT
--     TO authenticated
--     USING (client_id = auth.uid());

-- ============================================================================
-- Sample Data (for testing/development)
-- ============================================================================

-- Insert a test client
-- INSERT INTO clients (client_id, email, plan_tier)
-- VALUES (
--     '550e8400-e29b-41d4-a716-446655440000',
--     'test@example.com',
--     'free'
-- );

-- Insert a test transaction
-- INSERT INTO transactions (client_id, loc_purchased, amount_usd, payment_status)
-- VALUES (
--     '550e8400-e29b-41d4-a716-446655440000',
--     1000,
--     9.90,
--     'paid'
-- );

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- Additional composite indexes for common queries
CREATE INDEX idx_transactions_client_status ON transactions(client_id, payment_status);
CREATE INDEX idx_telemetry_client_timestamp ON telemetry(client_id, timestamp DESC);
CREATE INDEX idx_telemetry_repo_timestamp ON telemetry(repo_id, timestamp DESC);

-- ============================================================================
-- Maintenance
-- ============================================================================

-- Clean up old telemetry (run periodically, e.g., via cron)
-- DELETE FROM telemetry WHERE created_at < NOW() - INTERVAL '90 days';

COMMENT ON TABLE clients IS 'Stores GuardScan client information and LOC usage';
COMMENT ON TABLE transactions IS 'Stores credit purchase transactions from Stripe';
COMMENT ON TABLE telemetry IS 'Stores anonymized usage telemetry events';
COMMENT ON VIEW client_credits IS 'Computed view of client credit balances';
COMMENT ON FUNCTION get_remaining_credits IS 'Returns remaining LOC credits for a client';
