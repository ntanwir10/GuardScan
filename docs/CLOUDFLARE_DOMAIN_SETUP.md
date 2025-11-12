# Cloudflare Domain Setup Guide

Complete guide for setting up guardscancli.com with Cloudflare Workers.

## Overview

This guide will help you:
1. Configure guardscancli.com in Cloudflare
2. Set up the API subdomain (api.guardscancli.com)
3. Deploy your Cloudflare Worker to the custom domain
4. Configure SSL/TLS settings

## Prerequisites

- Domain: guardscancli.com (purchased)
- Cloudflare account (free tier works)
- Cloudflare Workers account
- Wrangler CLI installed: `npm install -g wrangler`

## Step 1: Add Domain to Cloudflare

### 1.1 Add Site to Cloudflare

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **"Add a Site"**
3. Enter `guardscancli.com`
4. Select **Free Plan** (or your preferred plan)
5. Click **Continue**

### 1.2 Update Nameservers

Cloudflare will provide you with two nameservers (e.g., `ada.ns.cloudflare.com` and `cruz.ns.cloudflare.com`).

**Update nameservers at your domain registrar:**

1. Log in to your domain registrar (where you bought guardscancli.com)
2. Find DNS/Nameserver settings
3. Replace existing nameservers with Cloudflare's nameservers
4. Save changes

**Common registrars:**
- **Namecheap**: Domain List > Manage > Nameservers > Custom DNS
- **GoDaddy**: DNS > Nameservers > Change > Custom
- **Google Domains**: DNS > Name servers > Custom name servers
- **Cloudflare**: Already configured if purchased there

**Note:** DNS propagation can take 24-48 hours, but usually completes within a few hours.

### 1.3 Verify Domain

1. Return to Cloudflare dashboard
2. Click **"Check nameservers"**
3. Wait for status to change to **"Active"**

## Step 2: Configure DNS Records

### 2.1 Main Domain (guardscancli.com)

1. Go to **DNS** > **Records**
2. Add an **A record** for the main site:

```
Type: A
Name: @
IPv4 address: 192.0.2.1  (placeholder, will be proxied through Cloudflare)
Proxy status: Proxied (orange cloud)
TTL: Auto
```

**Note:** The IP doesn't matter when proxied; Cloudflare handles routing.

### 2.2 API Subdomain (api.guardscancli.com)

Add a CNAME record for the API:

```
Type: CNAME
Name: api
Target: guardscan-api.your-subdomain.workers.dev
Proxy status: Proxied (orange cloud)
TTL: Auto
```

**Important:** Replace `your-subdomain` with your actual Cloudflare Workers subdomain after deployment.

### 2.3 Optional: WWW Redirect

Add a CNAME for www:

```
Type: CNAME
Name: www
Target: guardscancli.com
Proxy status: Proxied (orange cloud)
TTL: Auto
```

## Step 3: Deploy Cloudflare Worker

### 3.1 Update wrangler.toml

Your `backend/wrangler.toml` should already have:

```toml
name = "guardscan-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# Add routes for custom domain
routes = [
  { pattern = "api.guardscancli.com/*", zone_name = "guardscancli.com" }
]

[vars]
ENVIRONMENT = "production"

[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-namespace-id"
```

### 3.2 Authenticate Wrangler

```bash
cd backend
wrangler login
```

This opens a browser window to authorize Wrangler.

### 3.3 Create KV Namespace

```bash
# Create production KV namespace
wrangler kv:namespace create "CACHE"

# Output will show: id = "abc123..."
# Copy this ID to wrangler.toml
```

Update the `id` in wrangler.toml with the actual namespace ID.

### 3.4 Set Secrets

```bash
# Supabase credentials
wrangler secret put SUPABASE_URL
# Enter: https://your-project.supabase.co

wrangler secret put SUPABASE_KEY
# Enter: your-service-role-key

# Stripe credentials
wrangler secret put STRIPE_SECRET_KEY
# Enter: sk_live_xxx or sk_test_xxx

wrangler secret put STRIPE_WEBHOOK_SECRET
# Enter: whsec_xxx
```

### 3.5 Deploy Worker

```bash
npm install
npm run build  # If you have TypeScript
npm run deploy
```

**Expected output:**
```
Total Upload: XX.XX KiB / gzip: XX.XX KiB
Uploaded guardscan-api (X.XX sec)
Published guardscan-api (X.XX sec)
  api.guardscancli.com/*
  https://guardscan-api.your-subdomain.workers.dev
Current Deployment ID: xxxx-xxxx-xxxx
```

### 3.6 Update DNS (if needed)

If you used a placeholder in Step 2.2, now update the CNAME:

```
Type: CNAME
Name: api
Target: guardscan-api.your-subdomain.workers.dev
```

## Step 4: Configure SSL/TLS

### 4.1 SSL/TLS Settings

1. Go to **SSL/TLS** in Cloudflare dashboard
2. Set encryption mode to **Full (strict)**
3. This ensures end-to-end encryption

### 4.2 Edge Certificates

Cloudflare automatically provisions SSL certificates. Verify:

1. Go to **SSL/TLS** > **Edge Certificates**
2. Check that status shows **"Active Certificate"**
3. Wait a few minutes if it shows "Initializing"

### 4.3 Always Use HTTPS

1. Go to **SSL/TLS** > **Edge Certificates**
2. Enable **"Always Use HTTPS"**
3. This redirects all HTTP traffic to HTTPS

## Step 5: Test Your Setup

### 5.1 Test Health Endpoint

```bash
curl https://api.guardscancli.com/health
```

**Expected response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### 5.2 Test from CLI

Update your local CLI configuration:

```bash
export API_BASE_URL=https://api.guardscancli.com
guardscan status
```

### 5.3 Test Full Flow

```bash
# Initialize (if not already done)
guardscan init

# Configure provider
guardscan config

# Run a review
guardscan run
```

## Step 6: Configure Main Site (Optional)

If you want to host a landing page at guardscancli.com:

### Option A: Cloudflare Pages

1. Create a `website` directory in your repo
2. Add your HTML/CSS/JS files
3. Deploy to Cloudflare Pages:

```bash
cd website
wrangler pages publish . --project-name=guardscan-website
```

4. In Cloudflare dashboard, set custom domain to `guardscancli.com`

### Option B: Simple HTML with Workers

Create a simple worker for the main domain:

```typescript
// workers/website/src/index.ts
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // If it's the API subdomain, pass through
    if (url.hostname.startsWith('api.')) {
      return fetch(request);
    }

    // Serve landing page
    return new Response(landingPageHTML, {
      headers: { 'content-type': 'text/html' }
    });
  }
};
```

## Step 7: Monitoring & Troubleshooting

### 7.1 View Logs

```bash
cd backend
wrangler tail
```

This shows real-time logs from your worker.

### 7.2 Check Analytics

1. Go to **Workers** > **guardscan-api** > **Metrics**
2. View request volume, success rate, and errors

### 7.3 Common Issues

**DNS not resolving**
- Check nameservers are correctly set
- Wait for DNS propagation (up to 48 hours)
- Use `dig api.guardscancli.com` to check DNS

**SSL Certificate errors**
- Ensure SSL/TLS mode is "Full (strict)"
- Wait for certificate provisioning (5-10 minutes)
- Check Edge Certificates status

**Worker not responding**
- Check deployment: `wrangler deployments list`
- View logs: `wrangler tail`
- Verify routes in wrangler.toml
- Ensure secrets are set: `wrangler secret list`

**API returns errors**
- Check Supabase connection
- Verify all secrets are set correctly
- Review worker logs for detailed errors

### 7.4 Testing Commands

```bash
# Check DNS resolution
dig api.guardscancli.com

# Check SSL certificate
curl -vI https://api.guardscancli.com/health

# Test API endpoint
curl -X POST https://api.guardscancli.com/api/validate \
  -H "Content-Type: application/json" \
  -d '{"clientId":"test","repoId":"test","locCount":100}'
```

## Step 8: Update Stripe Webhook

If you're using Stripe for payments:

1. Log in to [Stripe Dashboard](https://dashboard.stripe.com)
2. Go to **Developers** > **Webhooks**
3. Click **Add endpoint**
4. Set URL to: `https://api.guardscancli.com/api/stripe-webhook`
5. Select events:
   - `checkout.session.completed`
   - `invoice.payment_failed`
6. Copy the **Signing secret**
7. Update Cloudflare secret:

```bash
wrangler secret put STRIPE_WEBHOOK_SECRET
# Enter the signing secret
```

## Step 9: Production Checklist

Before going live, verify:

- [ ] Domain is active in Cloudflare
- [ ] DNS records are configured correctly
- [ ] SSL/TLS is set to "Full (strict)"
- [ ] Worker is deployed and accessible
- [ ] All secrets are set correctly
- [ ] Health endpoint returns 200 OK
- [ ] Stripe webhook is configured (if using payments)
- [ ] CLI can connect to API
- [ ] Logs show no errors
- [ ] Analytics are being tracked

## Pricing & Limits

### Cloudflare Workers (Free Tier)
- 100,000 requests per day
- 10ms CPU time per request
- 128MB memory

### Cloudflare Workers (Paid - $5/month)
- 10 million requests per month
- 50ms CPU time per request
- 128MB memory

### Cloudflare DNS/Proxy
- Free for basic features
- DDoS protection included
- CDN included

## Next Steps

1. Set up monitoring and alerts
2. Configure rate limiting
3. Set up custom error pages
4. Add more DNS records (docs, status, etc.)
5. Configure page rules for caching
6. Set up staging environment

## Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)
- [Custom Domains for Workers](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [SSL/TLS Best Practices](https://developers.cloudflare.com/ssl/)

## Support

If you encounter issues:
- Check [Cloudflare Community](https://community.cloudflare.com/)
- Review [Cloudflare Status](https://www.cloudflarestatus.com/)
- Contact Cloudflare Support (paid plans)
- GitHub Issues: https://github.com/ntanwir10/GuardScan/issues
