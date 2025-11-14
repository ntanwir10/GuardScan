# GuardScan Backend - Deployment Checklist

Follow this checklist to deploy the GuardScan backend from scratch.

## 📋 Pre-Deployment

### ☐ Prerequisites Installed

- [ ] Node.js 18+ (`node --version`)
- [ ] NPM (`npm --version`)
- [ ] Wrangler CLI (`wrangler --version`) - Install: `npm install -g wrangler`
- [ ] Git (`git --version`)

### ☐ Accounts Created

- [ ] Cloudflare account ([https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up))
- [ ] Supabase account ([https://app.supabase.com](https://app.supabase.com))
- [ ] Stripe account (optional, for payments) ([https://dashboard.stripe.com/register](https://dashboard.stripe.com/register))

## 🗄️ Database Setup

### ☐ Step 1: Create Supabase Project

- [ ] Log in to [Supabase Dashboard](https://app.supabase.com)
- [ ] Click **"New Project"**
- [ ] Enter project details:
  - Name: `guardscan-production`
  - Database Password: *(Use a strong password, save it!)*
  - Region: *(Choose closest to users)*
  - Pricing Plan: Free (for MVP) or Pro ($25/month)
- [ ] Click **"Create new project"**
- [ ] Wait 2-3 minutes for provisioning

### ☐ Step 2: Get Supabase Credentials

- [ ] Go to **Settings → API** in Supabase dashboard
- [ ] Copy **Project URL**: `https://xxxxxxxxxxxxx.supabase.co`
- [ ] Copy **service_role key** (long JWT token): `eyJhbGci...`
- [ ] Save these somewhere secure (password manager, `.env.local`, etc.)

**⚠️ IMPORTANT**: Use `service_role` key, NOT `anon` key!

### ☐ Step 3: Run Database Migrations

- [ ] Open **SQL Editor** in Supabase dashboard
- [ ] Click **"New query"**
- [ ] Copy contents of `backend/supabase/migrations/001_initial_schema.sql`
- [ ] Paste into SQL Editor
- [ ] Click **"Run"** (or Ctrl+Enter)
- [ ] Verify success: "Success. No rows returned"
- [ ] Repeat for `backend/supabase/migrations/002_row_level_security.sql`

### ☐ Step 4: Verify Tables Created

- [ ] Go to **Table Editor** in Supabase dashboard
- [ ] Confirm these tables exist:
  - `clients`
  - `transactions`
  - `telemetry`
  - `credits_balance` (materialized view under "Views")

### ☐ Step 5: (Optional) Load Test Data

Only if you want to test with sample data:

- [ ] Open SQL Editor
- [ ] Copy contents of `backend/supabase/seed/001_test_data.sql`
- [ ] Paste and run
- [ ] Verify: `SELECT * FROM clients WHERE client_id LIKE 'test-%'`

## ☁️ Cloudflare Workers Setup

### ☐ Step 6: Install Dependencies

```bash
cd backend
npm install
```

- [ ] Run `npm install` in backend directory
- [ ] Verify no errors in installation

### ☐ Step 7: Authenticate with Cloudflare

```bash
wrangler login
```

- [ ] Run `wrangler login`
- [ ] Browser opens automatically
- [ ] Click **"Allow"** to authorize
- [ ] Verify: `wrangler whoami` shows your account

### ☐ Step 8: Configure Secrets

**Option A: Using Helper Script (Recommended)**

```bash
cd backend
./scripts/setup-secrets.sh
```

- [ ] Run the setup script
- [ ] Paste **SUPABASE_URL** when prompted
- [ ] Paste **SUPABASE_KEY** (service_role) when prompted
- [ ] Optionally set Stripe keys if using payments

**Option B: Manual Setup**

```bash
wrangler secret put SUPABASE_URL
# Paste: https://xxxxxxxxxxxxx.supabase.co

wrangler secret put SUPABASE_KEY
# Paste: eyJhbGci... (service_role key)
```

- [ ] Set `SUPABASE_URL`
- [ ] Set `SUPABASE_KEY`
- [ ] (Optional) Set `STRIPE_SECRET_KEY`
- [ ] (Optional) Set `STRIPE_WEBHOOK_SECRET`

### ☐ Step 9: Verify Secrets

```bash
wrangler secret list
```

- [ ] Run `wrangler secret list`
- [ ] Confirm secrets are listed:
  - `SUPABASE_URL`
  - `SUPABASE_KEY`
  - (Optional) `STRIPE_SECRET_KEY`
  - (Optional) `STRIPE_WEBHOOK_SECRET`

### ☐ Step 10: Deploy to Cloudflare

```bash
npm run deploy
```

- [ ] Run `npm run deploy` (or `wrangler deploy`)
- [ ] Wait for build and upload
- [ ] Note your worker URL: `https://guardscan-backend.YOURNAME.workers.dev`
- [ ] Copy this URL for testing

## ✅ Verification

### ☐ Step 11: Test Health Endpoint

```bash
curl https://guardscan-backend.YOURNAME.workers.dev/api/health
```

Expected response:
```json
{"status":"healthy","timestamp":"2025-11-14T..."}
```

- [ ] Run curl command with your worker URL
- [ ] Verify HTTP 200 response
- [ ] Verify JSON contains `"status":"healthy"`

### ☐ Step 12: Test Full Stack

**Option A: Using Helper Script**

```bash
./scripts/verify-setup.sh https://guardscan-backend.YOURNAME.workers.dev
```

- [ ] Run verification script with your worker URL
- [ ] Review test results
- [ ] Confirm health check passes

**Option B: Manual Testing**

```bash
# Test credit validation
curl -X POST https://YOUR-WORKER-URL/api/validate \
  -H "Content-Type: application/json" \
  -d '{"client_id":"test-client-pro-003","loc":1000}'

# Test credits endpoint
curl https://YOUR-WORKER-URL/api/credits/test-client-pro-003
```

- [ ] Test validation endpoint (may fail if no test data loaded)
- [ ] Test credits endpoint
- [ ] Review responses for errors

### ☐ Step 13: Monitor Logs

```bash
wrangler tail
```

- [ ] Run `wrangler tail` in terminal
- [ ] Make API requests (repeat Step 12)
- [ ] Watch logs appear in real-time
- [ ] Verify no errors in logs

## 🔧 Configuration

### ☐ Step 14: Update CLI Configuration

Update the CLI to point to your deployed backend:

**File**: `cli/src/utils/api-client.ts`

```typescript
const API_BASE_URL = 'https://guardscan-backend.YOURNAME.workers.dev';
```

- [ ] Open `cli/src/utils/api-client.ts`
- [ ] Update `API_BASE_URL` to your worker URL
- [ ] Save file

### ☐ Step 15: Test CLI Integration

```bash
cd cli
npm run build
npm link
guardscan init
guardscan status
```

- [ ] Build CLI
- [ ] Link CLI globally
- [ ] Run `guardscan init` to create client
- [ ] Run `guardscan status` to verify backend connection

## 🚀 Production Deployment

### ☐ Step 16: Production Environment

If deploying to production (not just testing):

- [ ] Update `wrangler.toml` with your account_id
- [ ] Configure custom domain (optional):
  - Add domain to Cloudflare
  - Update routes in `wrangler.toml`
  - Deploy: `wrangler deploy --env production`
- [ ] Set up monitoring/alerts
- [ ] Enable Cloudflare rate limiting
- [ ] Configure CORS if needed

### ☐ Step 17: Set Up Stripe (If Using Payments)

- [ ] Create Stripe account
- [ ] Get API keys (test and live)
- [ ] Set up webhook endpoint:
  - URL: `https://YOUR-WORKER-URL/api/stripe/webhook`
  - Events to listen: `checkout.session.completed`, `payment_intent.succeeded`
- [ ] Get webhook signing secret
- [ ] Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` secrets
- [ ] Test with Stripe CLI: `stripe listen --forward-to YOUR-WORKER-URL/api/stripe/webhook`

### ☐ Step 18: Security Hardening

- [ ] Verify RLS is enabled on all tables (check `pg_tables` view)
- [ ] Ensure `service_role` key is in Wrangler secrets (not in code)
- [ ] Review Cloudflare Workers environment variables (no secrets!)
- [ ] Enable Cloudflare WAF rules (if on paid plan)
- [ ] Set up rate limiting on critical endpoints
- [ ] Configure CORS headers appropriately

## 📊 Monitoring

### ☐ Step 19: Set Up Monitoring

- [ ] Bookmark Cloudflare Workers dashboard: [https://dash.cloudflare.com](https://dash.cloudflare.com)
  - Navigate to **Workers & Pages** → **guardscan-backend**
- [ ] Bookmark Supabase dashboard: [https://app.supabase.com](https://app.supabase.com)
  - Check **Database → Reports** regularly
- [ ] (Optional) Set up external monitoring:
  - Uptime monitoring (e.g., UptimeRobot, Pingdom)
  - Error tracking (e.g., Sentry, Rollbar)
  - Log aggregation (e.g., LogDNA, Datadog)

### ☐ Step 20: Schedule Maintenance Tasks

- [ ] Set calendar reminder: Weekly database vacuum
  ```sql
  VACUUM ANALYZE clients;
  VACUUM ANALYZE transactions;
  VACUUM ANALYZE telemetry;
  ```
- [ ] Set calendar reminder: Monthly telemetry cleanup (delete > 90 days old)
- [ ] Set calendar reminder: Monthly backup download and verification

## 🎉 Deployment Complete!

### Post-Deployment Checklist

- [ ] Worker URL noted and saved
- [ ] CLI configured to use backend
- [ ] Test end-to-end: `guardscan init` → `guardscan run` → check Supabase data
- [ ] Monitoring dashboards bookmarked
- [ ] Secrets documented (in password manager, NOT in git)
- [ ] Team members notified (if applicable)

### Next Steps

1. **Announce to Users**: Update README with new backend URL
2. **Documentation**: Update user-facing docs with setup instructions
3. **Marketing**: Announce launch or new features
4. **Monitor**: Watch logs and metrics for first 24-48 hours

---

## 🆘 Troubleshooting

### Common Issues

**Issue**: `wrangler secret put` fails with "Unauthorized"
- **Fix**: Run `wrangler login` to re-authenticate

**Issue**: Database queries fail with "relation does not exist"
- **Fix**: Verify migrations ran successfully in Supabase SQL Editor

**Issue**: RLS errors like "permission denied for table"
- **Fix**: Ensure using `service_role` key, not `anon` key

**Issue**: Worker deployment succeeds but returns 500 errors
- **Fix**: Check `wrangler tail` logs for detailed error messages

**Issue**: Secrets not available in worker
- **Fix**: Verify with `wrangler secret list`, redeploy after setting secrets

### Getting Help

- **Documentation**: `backend/SUPABASE_SETUP.md` for detailed setup
- **Schema Reference**: `backend/DATABASE_SCHEMA.md` for database info
- **GitHub Issues**: https://github.com/ntanwir10/GuardScan/issues
- **Supabase Support**: https://supabase.com/support
- **Cloudflare Support**: https://developers.cloudflare.com/support/

---

**Last Updated**: 2025-11-14
**Version**: 1.0.0

**Estimated Time**: 30-45 minutes for complete setup
