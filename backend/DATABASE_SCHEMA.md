# GuardScan Database Schema

This document describes the database schema for GuardScan's Supabase PostgreSQL database.

## Overview

The database consists of 3 main tables and 1 materialized view:

- **clients** - User accounts and usage tracking
- **transactions** - Payment records and credit purchases
- **telemetry** - Anonymized usage events
- **credits_balance** (view) - Computed credit balances

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────┐
│                  clients                    │
├─────────────────────────────────────────────┤
│ • client_id (PK)          VARCHAR(255)      │
│   created_at              TIMESTAMPTZ       │
│   total_loc_used          BIGINT            │
│   plan_tier               VARCHAR(50)       │
│   email                   VARCHAR(255)      │
│   last_seen_at            TIMESTAMPTZ       │
│   metadata                JSONB             │
└─────────────────────────────────────────────┘
         │
         │ 1
         │
         │ *
         ▼
┌─────────────────────────────────────────────┐
│               transactions                  │
├─────────────────────────────────────────────┤
│ • transaction_id (PK)     UUID              │
│   client_id (FK)          VARCHAR(255)      │
│   loc_purchased           BIGINT            │
│   amount_usd              DECIMAL(10,2)     │
│   payment_status          VARCHAR(50)       │
│   stripe_payment_id       VARCHAR(255)      │
│   stripe_session_id       VARCHAR(255)      │
│   created_at              TIMESTAMPTZ       │
│   updated_at              TIMESTAMPTZ       │
│   metadata                JSONB             │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│                 telemetry                   │
├─────────────────────────────────────────────┤
│ • event_id (PK)           UUID              │
│   client_id               VARCHAR(255)      │
│   repo_id                 VARCHAR(255)      │
│   action_type             VARCHAR(100)      │
│   duration_ms             INTEGER           │
│   model                   VARCHAR(100)      │
│   loc                     INTEGER           │
│   timestamp               TIMESTAMPTZ       │
│   metadata                JSONB             │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│          credits_balance (VIEW)             │
├─────────────────────────────────────────────┤
│ • client_id               VARCHAR(255)      │
│   plan_tier               VARCHAR(50)       │
│   total_purchased         BIGINT            │
│   total_loc_used          BIGINT            │
│   remaining_credits       BIGINT            │
│   last_purchase_date      TIMESTAMPTZ       │
└─────────────────────────────────────────────┘
```

## Table Definitions

### clients

Stores client accounts and cumulative usage statistics.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `client_id` | VARCHAR(255) | PRIMARY KEY | Unique client identifier (UUID from CLI) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Account creation timestamp |
| `total_loc_used` | BIGINT | NOT NULL, DEFAULT 0, >= 0 | Total LOC scanned across all operations |
| `plan_tier` | VARCHAR(50) | NOT NULL, DEFAULT 'free' | Subscription tier (free/starter/pro/enterprise) |
| `email` | VARCHAR(255) | NULLABLE | User email (optional for future features) |
| `last_seen_at` | TIMESTAMPTZ | NULLABLE | Last CLI activity timestamp |
| `metadata` | JSONB | DEFAULT '{}' | Extensible metadata field |

**Constraints:**
- `plan_tier` must be one of: `free`, `starter`, `pro`, `enterprise`
- `total_loc_used` must be >= 0

**Indexes:**
- `idx_clients_plan_tier` on `(plan_tier)`
- `idx_clients_created_at` on `(created_at DESC)`
- `idx_clients_email` on `(email)` where `email IS NOT NULL`

### transactions

Stores payment transactions and credit purchases via Stripe.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `transaction_id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique transaction identifier |
| `client_id` | VARCHAR(255) | FOREIGN KEY → clients(client_id), NOT NULL | Client who made the purchase |
| `loc_purchased` | BIGINT | NOT NULL, > 0 | LOC credits purchased |
| `amount_usd` | DECIMAL(10,2) | NOT NULL, > 0 | Amount paid in USD |
| `payment_status` | VARCHAR(50) | NOT NULL, DEFAULT 'pending' | Payment status |
| `stripe_payment_id` | VARCHAR(255) | NULLABLE | Stripe Payment Intent ID |
| `stripe_session_id` | VARCHAR(255) | NULLABLE | Stripe Checkout Session ID |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Transaction creation time |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last update time (auto-updated) |
| `metadata` | JSONB | DEFAULT '{}' | Additional transaction data |

**Constraints:**
- `payment_status` must be one of: `pending`, `paid`, `failed`, `refunded`
- `loc_purchased` must be > 0
- `amount_usd` must be > 0
- Foreign key to `clients.client_id` with `ON DELETE CASCADE`

**Indexes:**
- `idx_transactions_client_id` on `(client_id)`
- `idx_transactions_payment_status` on `(payment_status)`
- `idx_transactions_created_at` on `(created_at DESC)`
- `idx_transactions_stripe_payment_id` on `(stripe_payment_id)` where not null
- `idx_transactions_stripe_session_id` on `(stripe_session_id)` where not null
- `idx_transactions_client_status` on `(client_id, payment_status, created_at DESC)`

**Triggers:**
- `update_transactions_updated_at` - Auto-updates `updated_at` on row change
- `refresh_credits_on_transaction_change` - Refreshes credits_balance view

### telemetry

Stores anonymized usage telemetry events (privacy-preserving, no source code).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `event_id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique event identifier |
| `client_id` | VARCHAR(255) | NOT NULL | Client identifier (not FK - privacy) |
| `repo_id` | VARCHAR(255) | NOT NULL | Hashed repository identifier |
| `action_type` | VARCHAR(100) | NOT NULL | CLI command executed |
| `duration_ms` | INTEGER | NULLABLE, >= 0 | Command execution duration |
| `model` | VARCHAR(100) | NULLABLE | AI model used (if applicable) |
| `loc` | INTEGER | NULLABLE, >= 0 | LOC processed in this action |
| `timestamp` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Event timestamp |
| `metadata` | JSONB | DEFAULT '{}' | Additional event data |

**Constraints:**
- `action_type` must be one of: `init`, `run`, `security`, `test`, `sbom`, `perf`, `mutation`, `rules`, `config`, `status`, `reset`
- `duration_ms` must be >= 0 if set
- `loc` must be >= 0 if set

**Privacy Notes:**
- `client_id` is NOT a foreign key (prevents reverse lookup)
- `repo_id` is a cryptographic hash (one-way, anonymized)
- NO source code, file paths, or file names stored
- Metadata is sanitized before storage

**Indexes:**
- `idx_telemetry_client_id` on `(client_id)`
- `idx_telemetry_repo_id` on `(repo_id)`
- `idx_telemetry_action_type` on `(action_type)`
- `idx_telemetry_timestamp` on `(timestamp DESC)`
- `idx_telemetry_client_action_time` on `(client_id, action_type, timestamp DESC)`

### credits_balance (Materialized View)

Computed view for efficient credit balance queries. Auto-refreshed on data changes.

| Column | Type | Description |
|--------|------|-------------|
| `client_id` | VARCHAR(255) | Client identifier |
| `plan_tier` | VARCHAR(50) | Current subscription tier |
| `total_purchased` | BIGINT | Total LOC credits purchased (sum of paid transactions) |
| `total_loc_used` | BIGINT | Total LOC scanned (from clients table) |
| `remaining_credits` | BIGINT | Calculated: total_purchased - total_loc_used |
| `last_purchase_date` | TIMESTAMPTZ | Most recent successful purchase |

**Refresh Strategy:**
- Auto-refreshes CONCURRENTLY on transaction INSERT/UPDATE/DELETE
- Auto-refreshes CONCURRENTLY on clients.total_loc_used UPDATE
- Manual refresh: `REFRESH MATERIALIZED VIEW CONCURRENTLY credits_balance;`

**Indexes:**
- `idx_credits_balance_client_id` (UNIQUE) on `(client_id)`

## Functions and Triggers

### update_updated_at_column()

Automatically updates the `updated_at` timestamp on row modifications.

**Used by:**
- `transactions` table

**Trigger:**
```sql
CREATE TRIGGER update_transactions_updated_at
BEFORE UPDATE ON transactions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
```

### refresh_credits_balance()

Refreshes the `credits_balance` materialized view concurrently (non-blocking).

**Triggers:**
```sql
-- Refresh on transaction changes
CREATE TRIGGER refresh_credits_on_transaction_change
AFTER INSERT OR UPDATE OR DELETE ON transactions
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_credits_balance();

-- Refresh on client usage updates
CREATE TRIGGER refresh_credits_on_client_change
AFTER UPDATE OF total_loc_used ON clients
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_credits_balance();
```

## Row Level Security (RLS)

All tables have RLS enabled to ensure data security.

### Service Role (Backend API)

**Permissions**: Full access (SELECT, INSERT, UPDATE, DELETE)

**Use case**: Cloudflare Workers backend operations

**Policy**:
```sql
CREATE POLICY "Service role has full access"
ON <table>
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
```

### Authenticated Role (Future Web Dashboard)

**clients**:
- SELECT: Own client record only (`client_id = auth.uid()`)
- UPDATE: Own client record only

**transactions**:
- SELECT: Own transactions only (`client_id = auth.uid()`)
- INSERT/UPDATE: Blocked (only via service role)

**telemetry**:
- No access (privacy-preserving)

### Public/Anonymous Role

**All tables**: No access (REVOKED)

## Common Queries

### Get Client Credit Balance

```sql
SELECT
  client_id,
  plan_tier,
  remaining_credits
FROM credits_balance
WHERE client_id = 'uuid-here';
```

### Validate Sufficient Credits

```sql
SELECT
  remaining_credits >= 1000 AS has_credits
FROM credits_balance
WHERE client_id = 'uuid-here';
```

### Get Client Transaction History

```sql
SELECT
  transaction_id,
  loc_purchased,
  amount_usd,
  payment_status,
  created_at
FROM transactions
WHERE client_id = 'uuid-here'
ORDER BY created_at DESC
LIMIT 10;
```

### Get Usage Analytics (Anonymized)

```sql
SELECT
  action_type,
  COUNT(*) AS total_executions,
  AVG(duration_ms) AS avg_duration_ms,
  SUM(loc) AS total_loc_processed
FROM telemetry
WHERE timestamp >= NOW() - INTERVAL '30 days'
GROUP BY action_type
ORDER BY total_executions DESC;
```

### Find Active Users (Last 7 Days)

```sql
SELECT DISTINCT client_id
FROM telemetry
WHERE timestamp >= NOW() - INTERVAL '7 days';
```

### Revenue by Plan Tier

```sql
SELECT
  c.plan_tier,
  COUNT(DISTINCT t.client_id) AS paying_clients,
  SUM(t.amount_usd) AS total_revenue,
  SUM(t.loc_purchased) AS total_credits_sold
FROM transactions t
JOIN clients c ON t.client_id = c.client_id
WHERE t.payment_status = 'paid'
GROUP BY c.plan_tier
ORDER BY total_revenue DESC;
```

## Maintenance

### Vacuum Tables (Performance)

Run weekly to reclaim storage and update statistics:

```sql
VACUUM ANALYZE clients;
VACUUM ANALYZE transactions;
VACUUM ANALYZE telemetry;
```

### Refresh Materialized View

Usually auto-refreshes, but can be forced:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY credits_balance;
```

### Archive Old Telemetry

Delete telemetry older than 90 days (GDPR compliance):

```sql
DELETE FROM telemetry
WHERE timestamp < NOW() - INTERVAL '90 days';
```

### Check Table Sizes

```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY size_bytes DESC;
```

### Check Index Usage

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan AS scans,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;
```

## Migration History

| Migration | Date | Description |
|-----------|------|-------------|
| `001_initial_schema.sql` | 2025-11-14 | Initial schema: clients, transactions, telemetry, indexes |
| `002_row_level_security.sql` | 2025-11-14 | Enable RLS and create security policies |

## Future Considerations

### Potential Schema Additions

1. **subscriptions** table - For recurring billing
2. **api_keys** table - For programmatic access
3. **webhooks** table - For user-defined webhooks
4. **reports** table - Store generated security reports
5. **teams** table - Multi-user organizations

### Scaling Strategies

- **Partitioning**: Partition `telemetry` by month if > 10M rows
- **Archiving**: Move old telemetry to cold storage (S3, Glacier)
- **Read replicas**: Add Supabase read replicas for analytics
- **Caching**: Use Cloudflare KV for hot credit balance data

---

**Last Updated**: 2025-11-14
**Version**: 1.0.0
**Schema Version**: 002
