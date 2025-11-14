# Supabase Setup Guide for GuardScan

This guide walks you through setting up the Supabase database for GuardScan's backend infrastructure.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Create Supabase Project](#create-supabase-project)
3. [Run Database Migrations](#run-database-migrations)
4. [Configure Environment Variables](#configure-environment-variables)
5. [Deploy to Cloudflare Workers](#deploy-to-cloudflare-workers)
6. [Verify Setup](#verify-setup)
7. [Optional: Seed Test Data](#optional-seed-test-data)
8. [Monitoring and Maintenance](#monitoring-and-maintenance)

---

## Prerequisites

- **Supabase Account**: Sign up at [https://supabase.com](https://supabase.com)
- **Cloudflare Account**: For Workers deployment
- **Wrangler CLI**: Install with `npm install -g wrangler`
- **PostgreSQL Client** (optional): For local testing (psql or pgAdmin)

---

## Create Supabase Project

### Step 1: Create New Project

1. Go to [https://app.supabase.com](https://app.supabase.com)
2. Click **"New Project"**
3. Fill in project details:
   - **Name**: `guardscan-production` (or your preferred name)
   - **Database Password**: Use a strong password (save this!)
   - **Region**: Choose closest to your users (e.g., `us-east-1`, `eu-central-1`)
   - **Pricing Plan**:
     - **Free Tier**: Good for MVP (500MB database, 50k rows)
     - **Pro**: $25/month (8GB database, unlimited rows)

4. Click **"Create new project"**
5. Wait 2-3 minutes for provisioning

### Step 2: Get Project Credentials

Once the project is ready:

1. Go to **Settings → API** in the Supabase dashboard
2. Note these values (you'll need them later):
   - **Project URL**: `https://xxxxxxxxxxxxx.supabase.co`
   - **Project API Keys**:
     - `anon` (public) - Not used by GuardScan CLI
     - `service_role` (secret) - **IMPORTANT**: This is what backend uses

**Security Warning**: Never commit `service_role` key to git!

---

## Run Database Migrations

### Option 1: Using Supabase SQL Editor (Recommended for First-Time)

1. In Supabase dashboard, go to **SQL Editor**
2. Click **"New query"**
3. Copy and paste the contents of `backend/supabase/migrations/001_initial_schema.sql`
4. Click **"Run"** (or press `Ctrl+Enter`)
5. Verify success - you should see: "Success. No rows returned"
6. Repeat for `backend/supabase/migrations/002_row_level_security.sql`

### Option 2: Using Supabase CLI

First, install Supabase CLI:

```bash
npm install -g supabase
```

Link your project:

```bash
cd backend
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Run migrations:

```bash
supabase db push
```

### Verify Tables Created

In Supabase dashboard, go to **Table Editor**. You should see:

- ✅ `clients` - Client accounts
- ✅ `transactions` - Payment records
- ✅ `telemetry` - Usage events
- ✅ `credits_balance` (materialized view) - Credit calculations

---

## Configure Environment Variables

### Get Your Supabase Credentials

From Supabase dashboard (**Settings → API**):

```bash
# Your values will look like this:
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_KEY=eyJhbGci...  # service_role key (long JWT token)
```

### Set Secrets in Cloudflare Workers

**Important**: Use `wrangler secret put` to securely store secrets:

```bash
cd backend

# Set Supabase credentials
wrangler secret put SUPABASE_URL
# Paste: https://xxxxxxxxxxxxx.supabase.co

wrangler secret put SUPABASE_KEY
# Paste: eyJhbGci... (service_role key)
```

### Set Stripe Secrets (if using payments)

```bash
# Get these from Stripe dashboard (https://dashboard.stripe.com/apikeys)
wrangler secret put STRIPE_SECRET_KEY
# Paste: sk_test_... or sk_live_...

wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste: whsec_...
```

### Verify Secrets Are Set

```bash
wrangler secret list
```

You should see:
```
SUPABASE_URL
SUPABASE_KEY
STRIPE_SECRET_KEY (if set)
STRIPE_WEBHOOK_SECRET (if set)
```

---

## Deploy to Cloudflare Workers

### Step 1: Authenticate with Cloudflare

```bash
wrangler login
```

This opens your browser to authenticate.

### Step 2: Update Account ID (if needed)

Edit `backend/wrangler.toml` and add your account ID:

```toml
account_id = "your-cloudflare-account-id"  # Get from Cloudflare dashboard
```

Or run without it - wrangler will prompt you.

### Step 3: Deploy

```bash
cd backend
npm install          # Install dependencies
npm run deploy       # Deploys to Cloudflare Workers
```

Expected output:
```
✨ Built successfully
🌎 Uploading...
✨ Success! Uploaded to https://guardscan-backend.YOURNAME.workers.dev
```

### Step 4: Test the Deployment

```bash
# Test health endpoint
curl https://guardscan-backend.YOURNAME.workers.dev/api/health

# Expected response:
# {"status":"healthy","timestamp":"2025-11-14T..."}
```

---

## Verify Setup

### Test Database Connection

Use this SQL query in Supabase SQL Editor:

```sql
-- Check tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public';

-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';

-- Check indexes
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename;
```

### Test Backend API

```bash
# Health check
curl https://YOUR-WORKER-URL.workers.dev/api/health

# Test credit validation (should fail with invalid client_id)
curl -X POST https://YOUR-WORKER-URL.workers.dev/api/validate \
  -H "Content-Type: application/json" \
  -d '{"client_id": "test-123", "loc": 1000}'
```

### Check Logs

```bash
# Live tail logs from Cloudflare Workers
wrangler tail
```

Then make API requests and watch logs appear in real-time.

---

## Optional: Seed Test Data

**Warning**: Only run this in development/staging environments!

### Load Test Data

In Supabase SQL Editor:

```sql
-- Run the seed script
\i backend/supabase/seed/001_test_data.sql
```

Or copy/paste contents of `backend/supabase/seed/001_test_data.sql`.

### Verify Test Data

```sql
-- Check test clients
SELECT client_id, plan_tier, total_loc_used, remaining_credits
FROM credits_balance
WHERE client_id LIKE 'test-client-%';

-- Check test transactions
SELECT client_id, loc_purchased, amount_usd, payment_status
FROM transactions
WHERE metadata->>'test_transaction' = 'true';
```

### Clean Up Test Data (when done testing)

```sql
-- Remove test data
DELETE FROM telemetry WHERE metadata->>'test_event' = 'true';
DELETE FROM transactions WHERE metadata->>'test_transaction' = 'true';
DELETE FROM clients WHERE metadata->>'test_account' = 'true';

-- Refresh materialized view
REFRESH MATERIALIZED VIEW credits_balance;
```

---

## Monitoring and Maintenance

### Database Monitoring

In Supabase dashboard:

1. **Database → Reports**: View query performance, table sizes
2. **Database → Backups**: Daily backups enabled by default
3. **Logs**: View real-time database logs

### Performance Optimization

#### Refresh Materialized View (if needed)

The `credits_balance` view auto-refreshes on data changes, but you can manually refresh:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY credits_balance;
```

#### Analyze Query Performance

```sql
-- Check slow queries
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Check table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### Vacuum and Analyze (if performance degrades)

```sql
VACUUM ANALYZE clients;
VACUUM ANALYZE transactions;
VACUUM ANALYZE telemetry;
```

### Cloudflare Workers Monitoring

```bash
# View deployment status
wrangler deployments list

# Check worker analytics (in Cloudflare dashboard)
# Go to: Workers & Pages → guardscan-backend → Metrics
```

### Database Backups

Supabase automatically backs up your database daily. To download a backup:

1. Go to **Database → Backups** in Supabase dashboard
2. Click **"Download"** on desired backup
3. Store securely (encrypted)

### Security Checklist

- [ ] `service_role` key stored in Wrangler secrets (not in code)
- [ ] RLS policies enabled on all tables
- [ ] `anon` key not used by backend
- [ ] Database password is strong (20+ characters)
- [ ] Backups enabled and tested
- [ ] Rate limiting configured (if using Cloudflare Workers)
- [ ] HTTPS enforced (Cloudflare does this by default)

---

## Common Issues and Solutions

### Issue: "relation does not exist"

**Cause**: Migrations not run or wrong database.

**Solution**:
```sql
-- Check if tables exist
\dt

-- If not, run migrations again
```

### Issue: "permission denied for table"

**Cause**: RLS blocking access or wrong API key.

**Solution**:
- Verify using `service_role` key in backend
- Check RLS policies are correct

### Issue: Materialized view not updating

**Cause**: Triggers not working.

**Solution**:
```sql
-- Manually refresh
REFRESH MATERIALIZED VIEW CONCURRENTLY credits_balance;

-- Check triggers exist
SELECT tgname FROM pg_trigger WHERE tgname LIKE 'refresh%';
```

### Issue: Worker deployment fails

**Cause**: Missing secrets or build error.

**Solution**:
```bash
# Verify secrets
wrangler secret list

# Check build locally
npm run build

# Redeploy
npm run deploy
```

---

## Production Checklist

Before going live:

- [ ] Supabase project on Pro plan (if expecting >50k users)
- [ ] Database in appropriate region (low latency)
- [ ] All migrations applied successfully
- [ ] RLS policies tested and verified
- [ ] Secrets set in production environment
- [ ] Custom domain configured (e.g., `api.guardscan.com`)
- [ ] Monitoring and alerts configured
- [ ] Backup strategy tested (restore test)
- [ ] Rate limiting configured
- [ ] CORS headers configured (if needed)
- [ ] Stripe webhooks configured (if using payments)

---

## Next Steps

1. **Set up Stripe**: See `STRIPE_SETUP.md` (if it exists)
2. **Configure CLI**: Update CLI to use production API endpoint
3. **Set up monitoring**: Sentry, LogDNA, or similar
4. **Create dashboard**: Optional web dashboard for users

---

## Resources

- **Supabase Docs**: https://supabase.com/docs
- **Cloudflare Workers Docs**: https://developers.cloudflare.com/workers/
- **Wrangler CLI Docs**: https://developers.cloudflare.com/workers/wrangler/
- **PostgreSQL Docs**: https://www.postgresql.org/docs/

---

## Support

For GuardScan-specific issues:
- **Issues**: https://github.com/ntanwir10/GuardScan/issues
- **Repository**: https://github.com/ntanwir10/GuardScan

For Supabase support:
- **Support**: https://supabase.com/support
- **Discord**: https://discord.supabase.com

---

**Last Updated**: 2025-11-14
**Version**: 1.0.0
**Maintainer**: GuardScan Team
