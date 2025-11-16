# GuardScan Deployment Guide

**100% Free & Open Source - BYOK (Bring Your Own Key) Model**

This guide covers deploying GuardScan CLI to NPM. The backend is **completely optional** and only provides telemetry/monitoring if desired.

---

## Table of Contents
1. [Quick Start](#quick-start)
2. [CLI Deployment](#cli-deployment-required)
3. [Backend Deployment](#backend-deployment-optional)
4. [Post-Deployment Verification](#post-deployment-verification)
5. [Troubleshooting](#troubleshooting)

---

## Quick Start

**For most users, only CLI deployment is needed:**

```bash
cd cli
npm run build
npm version 1.0.0
npm publish

# Users can now install:
npm install -g guardscan
```

**Backend is optional** - Only deploy if you want centralized telemetry/monitoring.

---

## Prerequisites

### Required (CLI Only)
- **NPM Account**: For publishing CLI package
- **Node.js 18+**: `node --version` >= 18.0.0

### Optional (If Deploying Backend)
- **Cloudflare Account**: For Workers deployment (free tier OK)
- **Supabase Account**: For PostgreSQL database (free tier OK)

### Required Tools
```bash
# Node.js 18+
node --version  # Should be >= 18.0.0

# Wrangler CLI (only if deploying backend)
npm install -g wrangler
wrangler login
```

---

## CLI Deployment (Required)

### Step 1: Build and Test

```bash
cd cli

# Install dependencies
npm install

# Build TypeScript
npm run build

# Verify build
npm run test

# Test locally
npm link
guardscan --help
```

### Step 2: Update Package Version

```bash
# Update version in package.json
npm version patch  # 0.1.0 → 0.1.1
# OR
npm version minor  # 0.1.0 → 0.2.0
# OR
npm version major  # 0.1.0 → 1.0.0
```

### Step 3: Publish to NPM

```bash
# Login to NPM (one-time)
npm login

# Publish package
npm publish

# For scoped packages:
npm publish --access public
```

### Step 4: Verify Publication

```bash
# Check if package is available
npm view guardscan

# Install and test
npm install -g guardscan
guardscan --version
guardscan init
```

---

## Backend Deployment (Optional)

**Note:** Backend is **COMPLETELY OPTIONAL**. GuardScan works 100% without it. Deploy only if you want centralized telemetry/monitoring.

### What the Backend Provides

- Anonymous usage telemetry (can be disabled)
- Error tracking for debugging
- Performance metrics
- Health checks

**Privacy:** No source code is ever sent. Only anonymized metadata like command usage, LOC counts, and execution times.

### Step 1: Set Up Supabase Database (Optional)

1. **Create Project**: Go to https://supabase.com and create a new project (free tier OK)

2. **Run Simplified Schema**:
   ```bash
   # Copy the simplified schema (telemetry only)
   cat backend/schema-simplified.sql

   # In Supabase Dashboard:
   # - Go to SQL Editor
   # - Paste the schema
   # - Execute
   ```

3. **Get Credentials**:
   - Project URL: `https://xxxxx.supabase.co`
   - Service Role Key: (From Settings → API → service_role key)

4. **Enable RLS**: Row Level Security is enabled by the schema

### Step 2: Configure Cloudflare Workers

1. **Update wrangler.toml**:
   ```bash
   cd backend

   # Edit wrangler.toml
   # Set your account_id (get from: wrangler whoami)
   account_id = "your-cloudflare-account-id"
   ```

2. **Set Secrets** (Optional - Only if using database):
   ```bash
   # Set Supabase credentials (optional)
   wrangler secret put SUPABASE_URL
   # Enter: https://xxxxx.supabase.co

   wrangler secret put SUPABASE_KEY
   # Enter: your service_role key
   ```

   **Note:** If you don't set these, the backend will gracefully degrade and accept telemetry without storing it.

3. **Create KV Namespace** (Optional, for caching):
   ```bash
   wrangler kv:namespace create "CACHE"
   wrangler kv:namespace create "CACHE" --preview

   # Add the IDs to wrangler.toml:
   [[kv_namespaces]]
   binding = "CACHE"
   id = "your-kv-id"
   preview_id = "your-preview-kv-id"
   ```

### Step 3: Deploy to Cloudflare Workers

```bash
cd backend

# Install dependencies
npm install

# Deploy
npm run deploy
# OR
wrangler deploy

# The backend will be available at:
# https://guardscan-backend.your-subdomain.workers.dev
```

### Step 4: Update CLI Configuration (If Using Backend)

If you deployed the backend and want telemetry:

```bash
# Update cli/src/utils/api-client.ts
# Set the backend URL to your deployed Workers URL

const API_BASE_URL = 'https://guardscan-backend.your-subdomain.workers.dev';
```

**Note:** If you don't deploy a backend, the CLI works perfectly with `--no-telemetry` or offline mode.

---

## Post-Deployment Verification

### Verify CLI

```bash
# Install from NPM
npm install -g guardscan

# Run init
guardscan init

# Run security scan (offline, no backend needed)
guardscan security

# Check status
guardscan status
```

### Verify Backend (If Deployed)

```bash
# Health check
curl https://guardscan-backend.your-subdomain.workers.dev/health

# Expected response:
# {"status":"ok","timestamp":"..."}

# Test telemetry (optional)
curl -X POST https://guardscan-backend.your-subdomain.workers.dev/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{"clientId":"test","repoId":"test","events":[]}'

# Expected response:
# {"status":"ok"}
```

---

## Architecture Options

### Option 1: CLI Only (Recommended for Most Users)

```
User → GuardScan CLI (100% local)
          ↓
    User's AI Provider (BYOK)
```

**Pros:**
- Simplest deployment
- No backend infrastructure
- Maximum privacy
- Zero ongoing costs

**Cons:**
- No centralized telemetry/analytics

### Option 2: CLI + Optional Backend

```
User → GuardScan CLI
          ├→ Optional Telemetry → Cloudflare Workers → Supabase
          └→ User's AI Provider (BYOK)
```

**Pros:**
- Product usage analytics
- Error tracking for debugging
- Performance monitoring

**Cons:**
- Requires backend infrastructure
- Ongoing costs (though Cloudflare/Supabase free tiers are generous)

---

## Cost Estimate

### CLI Only
- **NPM Hosting**: FREE
- **User Cost**: $0 (except their own AI provider API costs)

### CLI + Backend (Optional)

**Cloudflare Workers:**
- Free Tier: 100,000 requests/day
- Paid: $5/month for 10M requests
- **Recommended:** Start with free tier

**Supabase:**
- Free Tier: 500MB database, 2GB bandwidth
- Paid: $25/month for more resources
- **Recommended:** Start with free tier

**Total Backend Cost:** $0 (free tier) to $30/month (paid tiers)

**GuardScan Revenue:** $0 (we don't charge users!)

---

## Environment Variables

### CLI

**None required!** CLI works out of the box.

Optional configuration in `~/.guardscan/config.yml`:
```yaml
clientId: "generated-locally"
provider: "openai"  # or "claude", "gemini", "ollama"
apiKey: "user-provided-key"
telemetryEnabled: true
offlineMode: false
```

### Backend (Optional)

```bash
# Required if using database:
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=service-role-key

# Optional:
ENVIRONMENT=production
API_VERSION=v1
```

**Removed (no longer needed):**
- ❌ `STRIPE_SECRET_KEY` - No payment processing
- ❌ `STRIPE_WEBHOOK_SECRET` - No Stripe integration

---

## Continuous Deployment

### GitHub Actions (Automated)

The repository includes a CI/CD workflow (`.github/workflows/ci.yml`) that:

1. Runs tests on push
2. Builds the CLI
3. Can auto-publish to NPM on release tags

**To enable auto-publish:**

1. Add NPM token to GitHub Secrets:
   ```
   Settings → Secrets → New secret
   Name: NPM_TOKEN
   Value: (your NPM automation token)
   ```

2. Create a git tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. GitHub Actions will automatically build and publish

### Manual Deployment

```bash
# Update version
cd cli
npm version minor

# Build and test
npm run build
npm test

# Publish
npm publish

# Tag release
git tag v$(node -p "require('./package.json').version")
git push origin --tags
```

---

## Troubleshooting

### CLI Deployment Issues

**Issue:** `npm publish` fails with 403

**Solution:**
```bash
# Login again
npm login

# Verify you're logged in
npm whoami

# Check package name isn't taken
npm view guardscan

# Try publishing with access flag
npm publish --access public
```

**Issue:** TypeScript compilation errors

**Solution:**
```bash
cd cli
npm run build

# Fix any errors
# Re-build
npm run build
```

### Backend Deployment Issues (If Using)

**Issue:** Wrangler deployment fails

**Solution:**
```bash
# Login again
wrangler login

# Check account
wrangler whoami

# Verify wrangler.toml has correct account_id
```

**Issue:** Secrets not working

**Solution:**
```bash
# List secrets
wrangler secret list

# Delete and re-add
wrangler secret delete SUPABASE_URL
wrangler secret put SUPABASE_URL
```

**Issue:** Database connection fails

**Solution:**
```bash
# Verify Supabase credentials
# Check RLS policies are set
# Ensure service_role key is used (not anon key)
```

### Common Errors

**Error:** "Module not found"

```bash
cd cli
npm install
npm run build
```

**Error:** "Permission denied"

```bash
# Use sudo for global install (or use nvm)
sudo npm install -g guardscan

# Better: Use nvm to avoid sudo
nvm use 18
npm install -g guardscan
```

---

## Rollback Procedure

### Rollback CLI Version

```bash
# Unpublish latest version (within 72 hours)
npm unpublish guardscan@1.0.1

# Re-publish previous version
git checkout v1.0.0
cd cli
npm publish
```

### Rollback Backend (If Using)

```bash
# Deploy previous version
git checkout previous-tag
cd backend
wrangler deploy
```

---

## Security Best Practices

### CLI

1. **Never commit secrets**: API keys stay in `~/.guardscan/config.yml` (gitignored)
2. **Keep dependencies updated**: `npm audit fix`
3. **Review PRs carefully**: Especially around `providers/` directory

### Backend (If Using)

1. **Use Wrangler secrets**: Never commit credentials to git
2. **Enable RLS**: Row Level Security on all Supabase tables
3. **Rotate keys**: Periodically rotate Supabase service role keys
4. **Monitor logs**: Check Cloudflare Workers logs for suspicious activity

---

## Monitoring (If Backend Deployed)

### Cloudflare Workers Dashboard

- **Requests**: Monitor request volume
- **Errors**: Track error rates
- **Latency**: Monitor response times
- **Logs**: Real-time logs with `wrangler tail`

### Supabase Dashboard

- **Database Size**: Monitor storage usage
- **Connections**: Check connection pool
- **Slow Queries**: Optimize queries if needed

### Telemetry Queries

```sql
-- Most popular commands
SELECT command, COUNT(*) as usage_count
FROM usage_events
WHERE timestamp >= NOW() - INTERVAL '30 days'
GROUP BY command
ORDER BY usage_count DESC;

-- Error rate by command
SELECT command,
       COUNT(*) as total,
       SUM(CASE WHEN success THEN 0 ELSE 1 END) as failures
FROM usage_events
GROUP BY command;

-- Popular languages analyzed
SELECT language, SUM(loc_count) as total_loc
FROM telemetry
WHERE timestamp >= NOW() - INTERVAL '30 days'
GROUP BY language
ORDER BY total_loc DESC;
```

---

## Support

- **Issues**: https://github.com/ntanwir10/GuardScan/issues
- **Discussions**: https://github.com/ntanwir10/GuardScan/discussions
- **Email**: support@guardscan.com (coming soon)

---

## Summary

### Minimum Deployment (Recommended)

1. Build CLI: `npm run build`
2. Publish to NPM: `npm publish`
3. **Done!** Users can install with `npm install -g guardscan`

**Backend is optional** and only needed if you want centralized telemetry.

### Full Deployment (Optional)

1. Deploy CLI to NPM (required)
2. Set up Supabase database (optional)
3. Deploy backend to Cloudflare Workers (optional)
4. Configure CLI to use backend URL (optional)

**Total Time:**
- CLI only: 30 minutes
- CLI + Backend: 2-4 hours

**Total Cost:**
- CLI only: $0
- CLI + Backend (free tier): $0
- CLI + Backend (paid): ~$30/month

---

**Last Updated:** 2025-11-16
**GuardScan Version:** 1.0.0 (ready to deploy)
