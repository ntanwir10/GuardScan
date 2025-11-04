# Deployment Guide

## Prerequisites

- Node.js 18+ installed
- Cloudflare account
- Supabase account
- Stripe account

## 1. Database Setup

### Supabase

1. Create a new Supabase project
2. Run the SQL schema from `docs/database-schema.md`
3. Note your:
   - Project URL (e.g., `https://xxx.supabase.co`)
   - Service role key (from Settings > API)

## 2. Stripe Setup

1. Create a Stripe account
2. Get your API keys from the Dashboard
3. Create a webhook endpoint:
   - URL: `https://your-worker.workers.dev/api/stripe-webhook`
   - Events: `checkout.session.completed`, `invoice.payment_failed`
4. Note your webhook secret

## 3. Backend Deployment (Cloudflare Workers)

### Configure Secrets

```bash
cd backend

# Set secrets (never commit these!)
wrangler secret put SUPABASE_URL
# Enter: https://xxx.supabase.co

wrangler secret put SUPABASE_KEY
# Enter: your-service-role-key

wrangler secret put STRIPE_SECRET_KEY
# Enter: sk_live_xxx or sk_test_xxx

wrangler secret put STRIPE_WEBHOOK_SECRET
# Enter: whsec_xxx
```

### Create KV Namespace

```bash
# Create KV namespace for caching
wrangler kv:namespace create "CACHE"

# Update wrangler.toml with the ID from output
# Replace 'your-kv-namespace-id' with actual ID
```

### Deploy

```bash
# Install dependencies
npm install

# Deploy to Cloudflare Workers
npm run deploy
```

Your API will be available at: `https://ai-code-review-api.your-subdomain.workers.dev`

## 4. CLI Configuration

### Update API Endpoint

Users should set the API endpoint via environment variable or config:

```bash
export API_BASE_URL=https://ai-code-review-api.your-subdomain.workers.dev
```

Or in `~/.ai-review/config.yml`:

```yaml
apiEndpoint: https://ai-code-review-api.your-subdomain.workers.dev
```

### Publish to NPM

```bash
cd cli

# Build
npm run build

# Login to NPM
npm login

# Publish
npm publish
```

## 5. Environment Variables

### Backend (Cloudflare Workers Secrets)

- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_KEY`: Supabase service role key
- `STRIPE_SECRET_KEY`: Stripe secret key
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook signing secret

### CLI (User Environment)

Optional environment variables users can set:

- `OPENAI_API_KEY`: OpenAI API key
- `ANTHROPIC_API_KEY`: Anthropic API key
- `GOOGLE_API_KEY`: Google API key
- `OLLAMA_ENDPOINT`: Ollama server endpoint
- `API_BASE_URL`: Backend API URL

## 6. Monitoring

### Cloudflare Analytics

- View real-time metrics in Cloudflare dashboard
- Monitor request volume, errors, and latency

### Supabase Monitoring

- Use Supabase dashboard for database metrics
- Set up alerts for high usage

### Logs

```bash
# Tail live logs
cd backend
npm run tail
```

## 7. Cost Estimates

### Free Tier Usage

- **Cloudflare Workers**: 100,000 requests/day free
- **Supabase**: 500MB database, 1GB bandwidth free
- **Stripe**: No monthly fee, 2.9% + $0.30 per transaction

### Expected Costs (1000 users, 10 reviews/month each)

- Cloudflare Workers: **$0** (within free tier)
- Supabase: **$0-5/month** (depending on data size)
- Stripe: **~2.9%** of revenue

**Total: ~$5-10/month + transaction fees**

## 8. Scaling

### When to Upgrade

- **Cloudflare Workers**: Upgrade to $5/month for 10M requests/month
- **Supabase**: Upgrade to $25/month for 8GB database
- **Consider**: Moving to dedicated infrastructure at 10,000+ active users

## 9. Security Best Practices

1. **Never commit secrets** - Use Wrangler secrets
2. **Enable RLS** on Supabase tables
3. **Validate webhooks** - Always verify Stripe signatures
4. **Rate limiting** - Add rate limits to API endpoints
5. **HTTPS only** - Enforce HTTPS for all traffic

## 10. Backup & Recovery

### Database Backups

Supabase provides automatic daily backups. Configure additional backups:

```bash
# Use Supabase CLI to export data
npx supabase db dump > backup.sql
```

### Disaster Recovery

1. Keep secrets backed up securely (1Password, AWS Secrets Manager, etc.)
2. Document all configuration in this repository
3. Test recovery procedure quarterly

## Troubleshooting

### Common Issues

**Workers deployment fails**
- Check wrangler.toml configuration
- Verify all secrets are set
- Ensure KV namespace ID is correct

**Database connection errors**
- Verify SUPABASE_URL and SUPABASE_KEY
- Check Supabase project is active
- Confirm IP allowlist settings

**Stripe webhook not working**
- Verify webhook secret is correct
- Check webhook endpoint URL
- Review Stripe webhook logs

### Getting Help

- Check logs: `wrangler tail`
- Review Cloudflare dashboard for errors
- Check Supabase logs in dashboard
- Review Stripe webhook delivery attempts
