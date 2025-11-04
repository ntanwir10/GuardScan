# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

**AI Code Review** is a privacy-first CLI tool that provides automated code review and security scanning using AI, with an optional cloud sync and billing layer. The system is split into two parts:
- **CLI** (TypeScript/Node.js) - Runs locally, performs all code analysis
- **Backend** (Cloudflare Workers) - Serverless API for credit validation and telemetry

**Core Privacy Principle**: Source code never leaves the developer's machine. Only anonymized metadata (client_id, repo_id hash, LOC counts) is transmitted to the backend.

## Commands

### CLI Development

```bash
# Install dependencies
cd cli && npm install

# Build the CLI
npm run build

# Watch mode for development
npm run dev

# Link globally for testing
npm link

# Test the CLI
ai-review init
ai-review config
ai-review status
ai-review run --help
```

### Backend Development

```bash
# Install dependencies
cd backend && npm install

# Run locally (requires wrangler installed)
npm run dev

# Deploy to Cloudflare Workers
npm run deploy

# Stream live logs
npm run tail

# Test health endpoint
curl http://localhost:8787/health
```

### Running Tests

The CLI can be tested locally after linking:

```bash
# Initialize (generates client_id)
ai-review init

# Configure AI provider
ai-review config

# Run code review
ai-review run

# Run security scan
ai-review security

# Check status
ai-review status

# Reset cache
ai-review reset
```

## Architecture Overview

### Two-Part System

1. **CLI** (`/cli`): Offline-first TypeScript application
   - Handles all code analysis locally
   - Never transmits source code
   - Supports multiple AI providers (OpenAI, Claude, Gemini, Ollama, LM Studio, OpenRouter)
   - Manages client identity (UUID) and repo fingerprinting
   - Generates reports and collects telemetry

2. **Backend** (`/backend`): Cloudflare Workers API
   - Lightweight request router with regex-based path matching
   - Credit validation before reviews
   - Telemetry ingestion
   - Stripe webhook handling for payments
   - Supabase/PostgreSQL for data storage

### Repository & Client Identification

**Repository Fingerprinting** (Priority order):
1. SHA-256 hash of git remote URL → 16 char hex
2. SHA-256 hash of .git metadata (config + HEAD)
3. UUID fallback for non-git repos

**Client Identity**: RFC4122 UUID v4 generated at `ai-review init`

### AI Provider System

The system uses a factory pattern for AI providers:
- **Base class**: `/cli/src/providers/base.ts` defines `AIProvider` interface
- **Factory**: `/cli/src/providers/factory.ts` creates provider instances
- **Implementations**:
  - `openai.ts` - GPT-4o via OpenAI SDK
  - `claude.ts` - Claude 3.5 Sonnet via Anthropic SDK
  - `gemini.ts` - Gemini Pro via Google SDK
  - `ollama.ts` - Local models via HTTP API (also used for LM Studio)

Each provider implements: `chat()`, `isAvailable()`, `getName()`, `testConnection()`

### Backend Router

Custom lightweight router in `/backend/src/router.ts`:
- Regex-based path matching with parameter extraction (e.g., `:clientId`)
- Supports GET and POST methods
- Handlers organized in `/backend/src/handlers/`

**Endpoints**:
- `GET /health` - Health check
- `POST /api/validate` - Validate LOC credits before review
- `POST /api/telemetry` - Ingest usage telemetry
- `GET /api/credits/:clientId` - Get credit balance
- `POST /api/stripe-webhook` - Handle payment events

### Credit Validation Flow

1. CLI counts LOC using `/cli/src/core/loc-counter.ts`
2. POST to `/api/validate` with `{client_id, repo_id, loc_count}`
3. Backend queries:
   - Total purchased: `SUM(transactions.loc_purchased)`
   - Total used: `clients.total_loc_used`
   - Returns: `{allowed: boolean, remaining: number}`
4. CLI proceeds or shows error

### Telemetry System

- Events recorded locally in JSON files
- Batched up to 50 events
- Synced when: batch full, manual trigger, or online + telemetry enabled
- Exponential backoff retry logic

## Key Implementation Details

### Configuration Management

**Location**: `~/.ai-review/config.yml` (managed by `/cli/src/core/config.ts`)

**Structure**:
```yaml
clientId: <uuid>
provider: openai|claude|gemini|ollama|lmstudio|openrouter
apiKey: <key>
apiEndpoint: <optional-custom-endpoint>
telemetryEnabled: true|false
offlineMode: false
createdAt: <iso-timestamp>
lastUsed: <iso-timestamp>
```

Cache directory: `~/.ai-review/cache/`

### LOC Counter

**Location**: `/cli/src/core/loc-counter.ts`

Features:
- Language-aware comment detection (supports 15+ languages)
- Respects `.gitignore` patterns
- Default ignores: `node_modules`, `.git`, `dist`, `build`, minified files
- Returns: `{totalLines, codeLines, commentLines, blankLines, fileBreakdown}`
- Uses `fast-glob` for file discovery
- Uses `ignore` library for gitignore parsing

### Security Scanning

**Patterns** checked (in `/cli/src/commands/security.ts`):
- Hardcoded secrets (password=, api_key=)
- SQL injection (string concatenation in queries)
- XSS (innerHTML, document.write)
- Code injection (eval(), exec())
- Weak crypto (MD5, SHA1)
- Insecure protocols (http://)
- Language-specific issues (Python pickle, shell=True)

**Output**: Severity (critical/high/medium/low), file, line, description, suggestion

### Database Layer

**Location**: `/backend/src/db.ts`

**Tables** (see `/docs/database-schema.md`):
- `clients` - Client records and usage tracking
- `repos` - Repository metadata (hashed repo_id)
- `transactions` - Purchase history (Stripe integration)
- `telemetry` - Anonymized usage metrics

All database interactions use Supabase client with service role key.

## Development Setup

### Prerequisites

- **Node.js**: 18+ (see `cli/package.json` and `backend/package.json`)
- **TypeScript**: 5.3+ (included in devDependencies)
- **Wrangler**: For Cloudflare Workers development

### CLI Setup

1. Install dependencies: `cd cli && npm install`
2. Build: `npm run build`
3. Link globally: `npm link`
4. Config stored at: `~/.ai-review/config.yml`

### Backend Setup

1. Install dependencies: `cd backend && npm install`
2. Create Cloudflare account and install wrangler
3. Set up Supabase project (see `/docs/database-schema.md`)
4. Create Stripe account for payments
5. Configure secrets:
   ```bash
   wrangler secret put SUPABASE_URL
   wrangler secret put SUPABASE_KEY
   wrangler secret put STRIPE_SECRET_KEY
   wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
6. Create KV namespace: `wrangler kv:namespace create "CACHE"`
7. Update `wrangler.toml` with KV namespace ID
8. Deploy: `npm run deploy`

### Environment Variables

**Backend** (Cloudflare Workers secrets):
- `SUPABASE_URL`, `SUPABASE_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `ENVIRONMENT` (set in wrangler.toml)

**CLI** (optional user environment):
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`
- `OLLAMA_ENDPOINT`, `API_BASE_URL`

## Important Notes

### Privacy Architecture

**Transmitted to Backend**:
- ✅ Hashed repository ID (16 char hex)
- ✅ Client UUID
- ✅ LOC count
- ✅ Usage duration, provider name

**NEVER Transmitted**:
- ❌ Source code
- ❌ File names/paths
- ❌ Variable names
- ❌ Comments
- ❌ Any PII

### Pricing Tiers

LOC = non-blank, non-comment lines (language-aware)

- **Tier 1**: 500–999 LOC → $0.010/LOC
- **Tier 2**: 1000–4999 LOC → $0.009/LOC
- **Tier 3**: 5000+ LOC → $0.008/LOC

Minimum purchase: 500 LOC

### Database Schema

See `/docs/database-schema.md` for complete SQL schema and setup instructions.

**Tables**: clients, repos, transactions, telemetry

**Indexes**: Optimized for client_id lookups and timestamp queries

### Documentation

- `/docs/GETTING_STARTED.md` - User guide
- `/docs/API.md` - API documentation
- `/docs/database-schema.md` - Database setup
- `/docs/deployment.md` - Deployment guide
- `/docs/CONTRIBUTING.md` - Contributor guide
- `PROJECT_SUMMARY.md` - Comprehensive project overview

## Project Structure

```
ai-code-review/
├── cli/                    # CLI application (TypeScript)
│   ├── src/
│   │   ├── commands/       # Command implementations (init, run, security, etc.)
│   │   ├── core/          # Core functionality (config, repository, loc-counter, telemetry)
│   │   ├── providers/     # AI provider implementations
│   │   ├── utils/         # Utilities (api-client, network, reporter, version)
│   │   └── index.ts       # CLI entry point
│   ├── package.json
│   └── tsconfig.json
├── backend/               # Cloudflare Workers API (TypeScript)
│   ├── src/
│   │   ├── handlers/      # API handlers (health, validate, telemetry, credits, stripe-webhook)
│   │   ├── db.ts          # Database abstraction layer
│   │   ├── router.ts      # Request router
│   │   └── index.ts       # Worker entry point
│   ├── wrangler.toml
│   └── package.json
└── docs/                  # Documentation
```
