# GuardScan Backend

Cloudflare Workers backend for GuardScan - handles credit validation, payment processing, and telemetry.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account
- Supabase account
- Wrangler CLI: `npm install -g wrangler`

### Installation

```bash
# Install dependencies
npm install

# Login to Cloudflare
wrangler login
```

### Database Setup

1. **Create Supabase Project**
   - Go to [https://app.supabase.com](https://app.supabase.com)
   - Create new project
   - Note your project URL and service_role key

2. **Run Migrations**
   - Open Supabase SQL Editor
   - Copy and run `supabase/migrations/001_initial_schema.sql`
   - Copy and run `supabase/migrations/002_row_level_security.sql`

3. **(Optional) Load Test Data**
   - Copy and run `supabase/seed/001_test_data.sql`

See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) for detailed instructions.

### Configure Secrets

Use the helper script:

```bash
./scripts/setup-secrets.sh
```

Or manually:

```bash
wrangler secret put SUPABASE_URL
# Paste: https://xxxxxxxxxxxxx.supabase.co

wrangler secret put SUPABASE_KEY
# Paste: eyJhbGci... (service_role key)
```

### Deploy

```bash
# Development deployment
npm run deploy

# Production deployment
wrangler deploy --env production
```

### Verify Deployment

```bash
# Using helper script
./scripts/verify-setup.sh https://your-worker.workers.dev

# Or manually test health endpoint
curl https://your-worker.workers.dev/api/health
```

Expected response:
```json
{"status":"healthy","timestamp":"2025-11-14T..."}
```

## 📁 Project Structure

```
backend/
├── src/
│   ├── index.ts              # Worker entry point
│   ├── router.ts             # Request routing
│   ├── db.ts                 # Supabase database layer
│   └── handlers/             # API endpoint handlers
│       ├── health.ts         # Health check
│       ├── validate.ts       # Credit validation
│       ├── credits.ts        # Credit management
│       ├── telemetry.ts      # Telemetry ingestion
│       └── stripe-webhook.ts # Stripe webhooks
│
├── supabase/
│   ├── migrations/           # Database migrations
│   │   ├── 001_initial_schema.sql
│   │   └── 002_row_level_security.sql
│   └── seed/                 # Test data
│       └── 001_test_data.sql
│
├── scripts/
│   ├── setup-secrets.sh      # Helper: Configure secrets
│   └── verify-setup.sh       # Helper: Test deployment
│
├── package.json
├── tsconfig.json
├── wrangler.toml             # Cloudflare Workers config
├── README.md                 # This file
└── SUPABASE_SETUP.md         # Detailed setup guide
```

## 🔌 API Endpoints

### Health Check
```bash
GET /api/health
```

Returns:
```json
{"status": "healthy", "timestamp": "2025-11-14T..."}
```

### Validate Credits
```bash
POST /api/validate
Content-Type: application/json

{
  "client_id": "uuid",
  "loc": 1000
}
```

Returns:
```json
{
  "valid": true,
  "remaining_credits": 49000,
  "plan_tier": "pro"
}
```

### Get Credits
```bash
GET /api/credits/:client_id
```

Returns:
```json
{
  "client_id": "uuid",
  "total_purchased": 50000,
  "total_used": 1000,
  "remaining": 49000,
  "plan_tier": "pro"
}
```

### Submit Telemetry
```bash
POST /api/telemetry
Content-Type: application/json

{
  "events": [
    {
      "client_id": "uuid",
      "repo_id": "hashed-repo-id",
      "action_type": "run",
      "duration_ms": 5000,
      "model": "gpt-4",
      "loc": 1000,
      "timestamp": "2025-11-14T..."
    }
  ]
}
```

### Stripe Webhook
```bash
POST /api/stripe/webhook
Stripe-Signature: ...
```

Handles Stripe payment events.

## 🛠️ Development

### Local Development

```bash
# Start local dev server
npm run dev

# Test locally
curl http://localhost:8787/api/health
```

### View Logs

```bash
# Live tail production logs
npm run tail

# Or use wrangler directly
wrangler tail --env production
```

### Update Secrets

```bash
# List current secrets
wrangler secret list

# Update a secret
wrangler secret put SUPABASE_KEY

# Delete a secret
wrangler secret delete OLD_SECRET
```

## 🔒 Security

### Environment Variables

**Public** (in `wrangler.toml`):
- `ENVIRONMENT` - development/staging/production
- `API_VERSION` - v1
- `MAX_REQUEST_SIZE_MB` - 10

**Secret** (via `wrangler secret`):
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_KEY` - Service role key (bypasses RLS)
- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signature secret

### Row Level Security (RLS)

All database tables have RLS enabled:
- **service_role**: Full access (used by backend)
- **authenticated**: Limited read access (future web dashboard)
- **public/anon**: No access

See `supabase/migrations/002_row_level_security.sql` for details.

## 📊 Monitoring

### Cloudflare Dashboard

- Go to: **Workers & Pages** → **guardscan-backend**
- View: Requests, CPU time, errors, bandwidth

### Supabase Dashboard

- Go to: **Database** → **Reports**
- View: Query performance, table sizes, slow queries

### Logs

```bash
# Real-time logs
wrangler tail

# Filter for errors
wrangler tail --format pretty | grep -i error
```

## 🧪 Testing

### Manual Testing

```bash
# Test health
curl https://your-worker.workers.dev/api/health

# Test validation (with test client_id from seed data)
curl -X POST https://your-worker.workers.dev/api/validate \
  -H "Content-Type: application/json" \
  -d '{"client_id":"test-client-pro-003","loc":1000}'

# Test credits
curl https://your-worker.workers.dev/api/credits/test-client-pro-003
```

### Load Testing

```bash
# Using Apache Bench
ab -n 1000 -c 10 https://your-worker.workers.dev/api/health

# Using wrk
wrk -t4 -c100 -d30s https://your-worker.workers.dev/api/health
```

## 🚢 Deployment

### Development
```bash
npm run deploy
# Deploys to: https://guardscan-backend.yourname.workers.dev
```

### Staging
```bash
wrangler deploy --env staging
# Deploys to: https://guardscan-backend-staging.yourname.workers.dev
```

### Production
```bash
wrangler deploy --env production
# Deploys to: https://guardscan-backend-production.yourname.workers.dev
# Or custom domain: https://api.guardscan.com
```

## 🐛 Troubleshooting

### "Error: No such secret: SUPABASE_URL"
**Solution**: Run `./scripts/setup-secrets.sh` or manually set secrets

### "Database query failed: relation does not exist"
**Solution**: Run database migrations in Supabase SQL Editor

### "Permission denied for table clients"
**Solution**: Verify you're using `service_role` key, not `anon` key

### "Worker script size exceeds limit"
**Solution**: Optimize imports, remove unused dependencies

### Deployment fails with 403
**Solution**: Run `wrangler login` to re-authenticate

## 📚 Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)
- [Supabase Docs](https://supabase.com/docs)
- [Stripe Webhooks Guide](https://stripe.com/docs/webhooks)

## 📝 License

MIT License - see [../LICENSE](../LICENSE)

## 🤝 Contributing

See [../docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md)

---

**Need Help?**
- Issues: https://github.com/ntanwir10/GuardScan/issues
- Detailed Setup: [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)
