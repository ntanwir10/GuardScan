# 🚀 Shipping Checklist for AI Code Review CLI MVP

## ✅ Current Status
- [x] CLI code complete and builds successfully
- [x] Backend code complete
- [x] Database schema designed
- [x] Documentation written
- [ ] **Ready to ship** - Follow steps below

---

## 📦 Phase 1: Local Testing (Do This First)

### Test CLI Locally
```bash
cd cli
npm install
npm run build
npm link                    # Makes 'ai-review' command available globally

# Test commands
ai-review --help
ai-review init
ai-review config
ai-review status
```

### What to Test:
- [ ] `init` creates config in `~/.ai-review/`
- [ ] `config` prompts work and save settings
- [ ] `status` shows configuration correctly
- [ ] Check no runtime errors

---

## 🗄️ Phase 2: Database Setup

### 1. Create Supabase Project
1. Go to https://supabase.com
2. Create new project
3. Wait for database to be ready (~2 minutes)
4. Note your:
   - Project URL: `https://xxxxx.supabase.co`
   - Service role key (Settings > API > service_role key)

### 2. Run SQL Schema
1. Open SQL Editor in Supabase dashboard
2. Copy entire SQL from `docs/database-schema.md`
3. Execute the schema
4. Verify tables created: clients, repos, transactions, telemetry

**Checklist:**
- [ ] Supabase project created
- [ ] SQL schema executed successfully
- [ ] All 4 tables exist
- [ ] Indexes and triggers created

---

## 💳 Phase 3: Stripe Setup

### 1. Create Stripe Account
1. Sign up at https://stripe.com
2. Activate account
3. Get API keys from Dashboard > Developers > API keys
   - Secret key: `sk_test_...` (test mode) or `sk_live_...` (production)

### 2. Create Webhook
1. Dashboard > Developers > Webhooks > Add endpoint
2. Endpoint URL: `https://your-worker-name.workers.dev/api/stripe-webhook` (get this after deploying backend)
3. Select events:
   - `checkout.session.completed`
   - `invoice.payment_failed`
4. Note webhook signing secret: `whsec_...`

**Checklist:**
- [ ] Stripe account created
- [ ] Test API keys obtained
- [ ] Webhook endpoint configured (after backend deployment)
- [ ] Webhook secret saved

---

## ☁️ Phase 4: Backend Deployment (Cloudflare Workers)

### 1. Install Wrangler CLI
```bash
npm install -g wrangler
wrangler login              # Authenticate with Cloudflare
```

### 2. Create KV Namespace
```bash
cd backend
wrangler kv:namespace create "CACHE"
# Copy the 'id' from output
```

### 3. Update wrangler.toml
Edit `backend/wrangler.toml` and replace:
```toml
[[kv_namespaces]]
binding = "CACHE"
id = "YOUR_KV_ID_HERE"    # ← Replace with ID from step 2
```

### 4. Set Secrets
```bash
cd backend

wrangler secret put SUPABASE_URL
# Paste: https://xxxxx.supabase.co

wrangler secret put SUPABASE_KEY
# Paste: your service_role key

wrangler secret put STRIPE_SECRET_KEY
# Paste: sk_test_... or sk_live_...

wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste: whsec_...
```

### 5. Deploy
```bash
cd backend
npm install
npm run deploy
```

You'll get a URL like: `https://ai-code-review-api.your-subdomain.workers.dev`

### 6. Update Stripe Webhook
Go back to Stripe dashboard and update webhook endpoint URL with your actual Workers URL.

**Checklist:**
- [ ] Wrangler installed and authenticated
- [ ] KV namespace created
- [ ] wrangler.toml updated with KV ID
- [ ] All 4 secrets configured
- [ ] Backend deployed successfully
- [ ] Workers URL noted
- [ ] Stripe webhook URL updated

---

## 🧪 Phase 5: Integration Testing

### Test Backend API
```bash
# Health check
curl https://your-worker-url.workers.dev/health

# Should return: {"status":"ok","timestamp":"..."}
```

### Test CLI with Backend
```bash
# Set backend URL
export API_BASE_URL=https://your-worker-url.workers.dev

# Test
ai-review init
ai-review config         # Configure with OpenAI/Claude API key
ai-review status        # Should show credits (or error if no credits)
```

**Checklist:**
- [ ] Health endpoint works
- [ ] CLI can reach backend
- [ ] Status command shows connection

---

## 📤 Phase 6: Publish CLI to NPM

### 1. Prepare Package
```bash
cd cli

# Update package.json if needed
# - Set correct version number
# - Add repository URL
# - Verify description
```

### 2. Build & Test
```bash
npm run build
npm pack                # Creates .tgz file for testing

# Test the package
npm install -g ./ai-code-review-0.1.0.tgz
ai-review --help
```

### 3. Publish
```bash
npm login               # Login to npm
npm publish            # Publish to npm registry
```

### 4. Verify
```bash
npm install -g ai-code-review
ai-review --version
```

**Checklist:**
- [ ] Package.json updated with correct info
- [ ] Built and tested locally
- [ ] Published to NPM
- [ ] Verified public installation works

---

## 📢 Phase 7: Launch Prep

### Documentation
- [ ] Update README with actual backend URL
- [ ] Add installation instructions
- [ ] Create CHANGELOG.md with v0.1.0 notes
- [ ] Update any placeholder URLs in docs

### Create Pricing Page (Optional)
Create a simple pricing page where users can:
- See pricing tiers
- Purchase LOC credits via Stripe Checkout
- Link to docs

### Announce
- [ ] Tweet/post about launch
- [ ] Submit to Product Hunt (optional)
- [ ] Post in relevant communities (Reddit, HN, etc.)

---

## 🎯 MVP Success Criteria

Before calling it "shipped":
- [ ] CLI installs globally via `npm install -g ai-code-review`
- [ ] Backend API is live and responding
- [ ] Database is set up and accessible
- [ ] At least ONE payment provider (Stripe) working
- [ ] Documentation is accurate and complete
- [ ] Basic error handling works (offline mode, invalid keys, etc.)

---

## 🐛 Known Limitations (MVP)

Document these for users:
- Security scanning has basic patterns (not comprehensive)
- AI review quality depends on selected model
- No team features (single user only)
- No web dashboard (CLI only)
- Limited telemetry visualization

---

## 📊 Post-Launch Monitoring

### Week 1 Checklist
- [ ] Monitor Cloudflare Workers logs
- [ ] Check Supabase database growth
- [ ] Review Stripe transactions
- [ ] Collect user feedback
- [ ] Fix any critical bugs

### Metrics to Track
- Number of CLI installations (npm stats)
- API request volume (Cloudflare dashboard)
- Active users (client count in database)
- Revenue (Stripe dashboard)
- Error rates (logs)

---

## 🚨 Emergency Contacts

Keep these handy:
- Cloudflare support: https://dash.cloudflare.com/
- Supabase support: https://supabase.com/dashboard
- Stripe support: https://dashboard.stripe.com/
- NPM support: https://www.npmjs.com/support

---

## Next Steps

1. ✅ Start with Phase 1 (Local Testing)
2. Work through phases sequentially
3. Don't skip phases - each builds on the previous
4. Test thoroughly before publishing to NPM
5. Launch! 🚀

---

**Estimated Time to Ship:**
- Phase 1-2: 1 hour (local testing + database)
- Phase 3-4: 1 hour (Stripe + backend deployment)
- Phase 5: 30 minutes (integration testing)
- Phase 6: 30 minutes (NPM publish)
- Phase 7: 1-2 hours (launch prep)

**Total: ~4-5 hours to go live**

---

Good luck shipping! 🎉
