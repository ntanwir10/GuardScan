# GuardScan Deployment Guide

This guide covers deploying GuardScan CLI to NPM and the backend to Cloudflare Workers.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Backend Deployment](#backend-deployment)
3. [CLI Deployment](#cli-deployment)
4. [Post-Deployment Verification](#post-deployment-verification)
5. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Accounts
- **NPM Account**: For publishing CLI package
- **Cloudflare Account**: For Workers deployment
- **Supabase Account**: For PostgreSQL database
- **Stripe Account**: For payment processing

### Required Tools
```bash
# Node.js 18+
node --version  # Should be >= 18.0.0

# Wrangler CLI (Cloudflare Workers)
npm install -g wrangler

# Login to Wrangler
wrangler login
```

---

## Backend Deployment

### Step 1: Set Up Supabase Database

1. **Create Project**: Go to https://supabase.com and create a new project

2. **Run Schema**:
   ```bash
   # Copy the schema
   cat backend/schema.sql

   # In Supabase Dashboard:
   # - Go to SQL Editor
   # - Paste the schema
   # - Execute
   ```

3. **Get Credentials**:
   - Project URL: `https://xxxxx.supabase.co`
   - Service Role Key: (From Settings → API → service_role key)

4. **Enable RLS**: Ensure Row Level Security is enabled (schema does this)

### Step 2: Configure Cloudflare Workers

1. **Update wrangler.toml**:
   ```bash
   cd backend

   # Edit wrangler.toml
   # Set your account_id (get from: wrangler whoami)
   account_id = "your-cloudflare-account-id"
   ```

2. **Set Secrets**:
   ```bash
   # Set Supabase credentials
   wrangler secret put SUPABASE_URL
   # Enter: https://xxxxx.supabase.co

   wrangler secret put SUPABASE_KEY
   # Enter: your service_role key

   # Set Stripe credentials
   wrangler secret put STRIPE_SECRET_KEY
   # Enter: sk_live_... or sk_test_...

   wrangler secret put STRIPE_WEBHOOK_SECRET
   # Enter: whsec_... (from Stripe dashboard)
   ```

3. **Create KV Namespace** (optional, for caching):
   ```bash
   wrangler kv:namespace create "CACHE"
   wrangler kv:namespace create "CACHE" --preview

   # Add the IDs to wrangler.toml:
   [[kv_namespaces]]
   binding = "CACHE"
   id = "your-kv-id"
   preview_id = "your-preview-kv-id"
   ```

### Step 3: Deploy to Staging

```bash
cd backend

# Deploy to staging
wrangler deploy --env staging

# Test the deployment
curl https://api-staging.guardscancli.com/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-11-13T..."
}
```

### Step 4: Deploy to Production

```bash
# Deploy to production
wrangler deploy --env production

# Verify
curl https://api.guardscancli.com/health
```

### Step 5: Set Up Stripe Webhook

1. Go to Stripe Dashboard → Webhooks
2. Add endpoint: `https://api.guardscancli.com/api/stripe-webhook`
3. Select events:
   - `checkout.session.completed`
   - `invoice.payment_failed`
4. Copy webhook secret to Cloudflare:
   ```bash
   wrangler secret put STRIPE_WEBHOOK_SECRET --env production
   ```

---

## CLI Deployment

### Step 1: Pre-publish Checks

```bash
cd cli

# Run all tests
npm test

# Ensure tests pass with >50% coverage
npm run test:coverage

# Build
npm run build

# Verify dist/ exists
ls -la dist/
```

### Step 2: Update Version

```bash
# Update version in package.json
npm version patch  # or minor, or major

# This will:
# - Update package.json version
# - Create git commit
# - Create git tag
```

### Step 3: Test Locally

```bash
# Link globally
npm link

# Test commands
guardscan --version
guardscan --help
guardscan init
guardscan status

# Unlink
npm unlink -g guardscan
```

### Step 4: Publish to NPM

```bash
# Login to NPM
npm login

# Dry run (test without publishing)
npm publish --dry-run

# Publish to NPM
npm publish

# View on NPM
open https://www.npmjs.com/package/guardscan
```

### Step 5: Verify Installation

```bash
# In a different directory
npm install -g guardscan

# Test
guardscan --version
guardscan --help
```

---

## Post-Deployment Verification

### Backend Health Check

```bash
# Health endpoint
curl https://api.guardscancli.com/health

# Test validation (should fail without real client)
curl -X POST https://api.guardscancli.com/api/validate \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "test-client-id",
    "repoId": "test-repo-id",
    "locCount": 1000
  }'
```

### CLI Integration Test

```bash
# Initialize
guardscan init

# Check status
guardscan status

# Run security scan on GuardScan itself
cd path/to/guardscan
guardscan security

# Test with AI provider (if you have API key)
guardscan config
guardscan run
```

### Monitor Logs

```bash
# Cloudflare Workers logs
wrangler tail --env production

# Watch for errors
wrangler tail --env production --format pretty
```

---

## Environment Configuration

### Production Environment Variables

**Backend (Cloudflare Workers)**:
```bash
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJhbGc...  # service_role key
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
ENVIRONMENT=production
```

**CLI** (user's local `.guardscan/config.yml`):
```yaml
clientId: <uuid>
provider: openai
apiKey: sk-proj-...  # Optional, can use env var
telemetryEnabled: true
offlineMode: false
```

---

## Rollback Procedures

### Rollback Backend

```bash
# List deployments
wrangler deployments list

# Rollback to previous version
wrangler rollback <deployment-id>
```

### Rollback CLI

```bash
# Unpublish version (within 72 hours)
npm unpublish guardscan@<version>

# Or deprecate
npm deprecate guardscan@<version> "Version has issues, use X.Y.Z instead"
```

---

## Monitoring

### Cloudflare Analytics
- Go to Cloudflare Dashboard → Workers
- View requests, errors, CPU time

### Supabase Monitoring
- Dashboard → Database → Query Performance
- Monitor connection pool usage
- Check slow queries

### NPM Stats
- https://npm-stat.com/charts.html?package=guardscan
- Track downloads over time

---

## Troubleshooting

### Backend Issues

**Problem**: 500 Internal Server Error
```bash
# Check logs
wrangler tail --env production

# Common causes:
# - Missing secrets
# - Database connection failed
# - Stripe API error
```

**Problem**: Database connection fails
```bash
# Verify Supabase credentials
curl https://xxxxx.supabase.co/rest/v1/ \
  -H "apikey: your-anon-key"

# Check RLS policies
# Ensure service_role key is used, not anon key
```

**Problem**: Stripe webhook not working
```bash
# Test webhook locally
stripe listen --forward-to localhost:8787/api/stripe-webhook

# Verify secret matches
wrangler secret list
```

### CLI Issues

**Problem**: Command not found after install
```bash
# Ensure global bin is in PATH
npm config get prefix
echo $PATH

# Reinstall
npm install -g guardscan
```

**Problem**: TypeScript compilation errors
```bash
cd cli
npm run build

# Check for missing dependencies
npm install
```

**Problem**: Tests failing
```bash
# Run tests with verbose output
npm test -- --verbose

# Check coverage
npm run test:coverage
```

---

## Continuous Deployment

### GitHub Actions (Automated)

The CI/CD pipeline (`.github/workflows/ci.yml`) automatically:

1. **On Push to Main**:
   - Runs tests
   - Builds CLI
   - Builds backend
   - Deploys to staging (if configured)

2. **Manual Production Deploy**:
   - Requires manual approval
   - Deploys to production

### Manual Trigger

```bash
# Trigger workflow manually
gh workflow run ci.yml
```

---

## Security Checklist

Before deploying to production:

- [ ] All secrets set via `wrangler secret put`
- [ ] Row Level Security enabled on Supabase
- [ ] HTTPS enforced (Cloudflare does this automatically)
- [ ] Stripe webhook signature verification working
- [ ] CORS configured appropriately
- [ ] Rate limiting considered (Cloudflare can add this)
- [ ] Monitoring and alerting set up
- [ ] Backup strategy for database
- [ ] Environment variables not committed to git

---

## Cost Estimation

### Cloudflare Workers
- **Free Tier**: 100,000 requests/day
- **Paid**: $5/month for 10M requests

### Supabase
- **Free Tier**: 500MB database, 2GB bandwidth
- **Pro**: $25/month for 8GB database

### Stripe
- **Transaction Fee**: 2.9% + $0.30 per transaction

### NPM
- **Free**: Public packages

**Estimated Monthly Cost (low traffic)**: $0-30

---

## Support

- **Issues**: https://github.com/ntanwir10/GuardScan/issues
- **Cloudflare Docs**: https://developers.cloudflare.com/workers/
- **Supabase Docs**: https://supabase.com/docs
- **Wrangler Docs**: https://developers.cloudflare.com/workers/wrangler/

---

**Last Updated**: 2025-11-13
**Version**: 1.0.0
