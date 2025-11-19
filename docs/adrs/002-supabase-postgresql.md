# ADR 002: Supabase PostgreSQL for Database

## Status
Accepted

## Date
2024-11-19

## Context
GuardScan's backend needs to store optional telemetry and monitoring data. The database requirements were:

1. **PostgreSQL compatibility** - Rich ecosystem and features
2. **REST API access** - Compatible with Cloudflare Workers (no persistent connections)
3. **Serverless scaling** - Scale to zero when not in use
4. **Built-in security** - Row-Level Security (RLS), authentication
5. **Cost-effective** - Free tier for development, affordable scaling
6. **Developer experience** - Easy schema management, migrations, SQL editor

We evaluated several options:
- **Supabase** (PostgreSQL-as-a-Service)
- **PlanetScale** (MySQL-compatible)
- **Neon** (Serverless PostgreSQL)
- **AWS RDS** (Managed PostgreSQL)
- **Direct PostgreSQL** (Self-hosted)

## Decision
We chose **Supabase PostgreSQL** as the database for GuardScan's telemetry and monitoring backend.

## Rationale

### Advantages of Supabase

1. **PostgreSQL Foundation**
   - Full PostgreSQL 15+ with all extensions
   - Familiar SQL syntax and tooling
   - Rich ecosystem (pgvector, pg_cron, timescaledb, etc.)
   - Excellent support for JSON/JSONB
   - Materialized views, triggers, functions

2. **REST API**
   - PostgREST auto-generates REST API from schema
   - Perfect for Cloudflare Workers (no persistent connections)
   - Automatic query optimization
   - Pagination, filtering, sorting built-in

3. **Security Features**
   - Row-Level Security (RLS) policies
   - JWT-based authentication
   - Service role keys for backend
   - Column-level permissions
   - Audit logging

4. **Developer Experience**
   - Web-based SQL editor
   - Schema visualization
   - Migration management
   - Seed data support
   - Local development with Docker

5. **Cost Structure**
   - **Free tier**: 
     - 500MB database
     - 1GB file storage
     - 50,000 monthly active users
     - Unlimited API requests
   - **Pro tier** ($25/month):
     - 8GB database
     - 100GB file storage
     - No project pause
   - **Pay-as-you-go** database size and bandwidth

6. **Performance**
   - Connection pooling built-in
   - Read replicas available
   - Point-in-time recovery
   - Automatic backups
   - CDN for static assets

### Alternatives Considered

**PlanetScale**
- ✅ Excellent developer experience
- ✅ Branching databases
- ✅ Automatic query insights
- ❌ MySQL (not PostgreSQL)
- ❌ No native TimescaleDB for time-series
- ❌ More expensive for telemetry workloads

**Neon**
- ✅ True serverless PostgreSQL (scale to zero)
- ✅ Instant branching
- ✅ Competitive pricing
- ❌ Newer product (less mature)
- ❌ Limited free tier (3GB storage vs Supabase unlimited requests)
- ❌ No built-in authentication/RLS tooling

**AWS RDS PostgreSQL**
- ✅ Extremely mature and reliable
- ✅ Full PostgreSQL compatibility
- ✅ Many configuration options
- ❌ More expensive (minimum ~$15/month)
- ❌ Complex setup and management
- ❌ No auto-generated REST API
- ❌ Requires connection pooler for Workers

**Self-hosted PostgreSQL**
- ✅ Complete control
- ✅ No vendor lock-in
- ❌ Operational overhead (backups, updates, monitoring)
- ❌ Scaling complexity
- ❌ Security responsibility
- ❌ No built-in REST API

## Consequences

### Positive
- **Rapid development**: Schema changes immediately reflected in REST API
- **Built-in security**: RLS policies enforce data isolation
- **Excellent DX**: Web UI, migrations, SQL editor all integrated
- **Cost-effective**: Free tier sufficient for initial deployment
- **PostgreSQL power**: Access to full PostgreSQL feature set
- **Easy integration**: REST API perfect for Cloudflare Workers

### Negative
- **Vendor dependency**: Some lock-in to Supabase ecosystem
  - *Mitigation*: Uses standard PostgreSQL underneath
  - *Mitigation*: Can export data and migrate to any PostgreSQL
  - *Mitigation*: Can self-host Supabase (open source)
- **REST overhead**: Slightly higher latency than direct Postgres connection
  - *Mitigation*: Still <100ms for most queries
  - *Mitigation*: Use caching with Cloudflare KV
  - *Mitigation*: Batch operations where possible
- **Free tier limits**: 500MB database on free tier
  - *Mitigation*: Sufficient for initial deployment
  - *Mitigation*: Upgrade to Pro ($25/month) for 8GB
  - *Mitigation*: Implement data retention policies

### Risks
1. **Supabase pricing changes**: Could become expensive
   - *Mitigation*: Telemetry is optional
   - *Mitigation*: Can migrate to standard PostgreSQL
   
2. **Service availability**: Outages possible
   - *Mitigation*: Graceful degradation in client
   - *Mitigation*: Telemetry failures don't affect CLI

3. **Data growth**: Telemetry data could grow large
   - *Mitigation*: Implement table partitioning
   - *Mitigation*: Data retention policies (90 days)
   - *Mitigation*: Materialized views for aggregations

## Implementation Details

### Schema Design
```sql
-- Clients table
CREATE TABLE clients (
  client_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

-- Telemetry table (partitioned by month)
CREATE TABLE telemetry (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(client_id),
  repo_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  duration_ms INTEGER,
  loc INTEGER,
  model TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

-- Indexes for common queries
CREATE INDEX idx_telemetry_client_id ON telemetry(client_id);
CREATE INDEX idx_telemetry_timestamp ON telemetry(timestamp DESC);
CREATE INDEX idx_telemetry_action ON telemetry(action_type, timestamp DESC);
```

### Access Patterns
1. **Insert telemetry**: Batch inserts (100+ events at once)
2. **Query stats**: Aggregations over time ranges
3. **Client lookup**: By client_id (UUID)
4. **Time-series queries**: Last 24h, 7d, 30d, 90d

### Performance Optimizations
1. **Materialized views** for expensive aggregations
2. **Partial indexes** for active data
3. **Connection pooling** via Supabase
4. **Query caching** in Cloudflare KV (5 min TTL)
5. **Table partitioning** by month for telemetry

### Security Model
- **Service role key**: Backend has full access
- **RLS policies**: Not needed (backend-only access)
- **API key**: Never exposed to client
- **Data encryption**: At rest and in transit

## Related Decisions
- [ADR 001: Cloudflare Workers Backend](./001-cloudflare-workers-backend.md) - Why REST API is required
- [ADR 003: Privacy-First Architecture](./003-privacy-first-architecture.md) - What data we store

## References
- [Supabase Documentation](https://supabase.com/docs)
- [PostgREST](https://postgrest.org/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Supabase Pricing](https://supabase.com/pricing)

## Review
This decision should be reviewed if:
- Supabase pricing becomes prohibitive
- Performance issues arise
- Better alternatives emerge
- We need features not available on Supabase

**Next review date**: 2025-05-19 (6 months)

