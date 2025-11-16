# GuardScan Architecture

**Version:** 1.0.0
**Model:** 100% Free & Open Source (BYOK - Bring Your Own Key)
**Last Updated:** 2025-11-16

---

## Architecture Overview

GuardScan follows a **privacy-first, client-side architecture** where all code analysis happens locally on the user's machine. There is NO server-side code processing.

```
┌─────────────────────────────────────────────────────────────┐
│                    USER'S MACHINE                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         GuardScan CLI (Node.js/TypeScript)          │   │
│  │                                                      │   │
│  │  • 21 Commands (security, run, test, etc.)          │   │
│  │  • 30 Core Modules (scanners, parsers, metrics)     │   │
│  │  • 9 AI Features (explain, review, test-gen, etc.)  │   │
│  │  • 7 Language Parsers (Python, Java, Go, Rust...)   │   │
│  │  • 8 AI Provider Integrations                       │   │
│  │                                                      │   │
│  │  Configuration: ~/.guardscan/config.yml            │   │
│  │  Cache: ~/.guardscan/cache/                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           │ (Optional)                       │
│                           │ Anonymized telemetry only        │
│                           │ Can be disabled: --no-telemetry  │
│                           ▼                                  │
└───────────────────────────────────────────────────────────────┘
                            │
                            │
                ┌───────────┴──────────┐
                │                      │
                ▼                      ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│  User's AI Provider      │  │  GuardScan Backend       │
│  (User pays directly)    │  │  (Optional telemetry)    │
│                          │  │                          │
│  • OpenAI (GPT-4)        │  │  Cloudflare Workers      │
│  • Anthropic (Claude)    │  │  + Supabase              │
│  • Google (Gemini)       │  │                          │
│  • Ollama (Local)        │  │  • Health checks         │
│                          │  │  • Anonymous telemetry   │
│  User's API Key →        │  │  • Error tracking        │
│  User's billing →        │  │  • Performance metrics   │
└──────────────────────────┘  └──────────────────────────┘
```

---

## Core Principles

### 1. **Privacy First**
- ✅ Source code NEVER leaves user's machine
- ✅ NO file paths or file names sent anywhere
- ✅ AI processing: User's own API key → User's chosen provider
- ✅ Telemetry: Optional, anonymized, can be disabled
- ✅ Works 100% offline (no internet required for static analysis)

### 2. **100% Free & Open Source**
- ✅ NO subscriptions
- ✅ NO credit system
- ✅ NO paywalls
- ✅ NO user accounts
- ✅ BYOK model: User pays AI provider directly (not GuardScan)
- ✅ MIT License

### 3. **Client-Side First**
- All code analysis happens locally
- All reports generated locally
- All caching happens locally
- User has full control

---

## Components

### CLI Application (`cli/` - 34,213 LOC)

#### **Commands (21 files)**
User-facing commands accessible via `guardscan <command>`:
- `init`, `config`, `status`, `reset` - Configuration
- `security`, `run`, `scan` - Code analysis
- `test`, `perf`, `mutation` - Testing & performance
- `explain`, `commit`, `docs`, `refactor`, `review` - AI features
- `chat`, `threat-model`, `migrate` - Advanced AI
- `sbom`, `rules` - Utilities

#### **Core Modules (30 files)**
Internal business logic:
- **Infrastructure**: config, repository, loc-counter, telemetry, ai-cache, codebase-indexer, ast-parser, context-builder
- **Security Scanners**: secrets-detector, owasp-scanner, dependency-scanner, dockerfile-scanner, iac-scanner, api-scanner
- **Code Quality**: code-metrics, code-smells, linter-integration, compliance-checker, license-scanner
- **Testing**: test-runner, mutation-tester, performance-tester
- **RAG/AI**: embeddings, embedding-chunker, embedding-indexer, embedding-search, embedding-store, rag-context, chatbot-engine, rule-engine

#### **AI Features (9 files)**
Advanced AI-powered features (optional, BYOK):
- code-explainer, code-review, commit-generator, docs-generator
- fix-suggestions, migration-assistant, refactoring-suggestions
- test-generator, threat-modeling

#### **Multi-Language Parsers (7 files)**
AST parsing for multiple languages:
- python-parser, java-parser, go-parser, rust-parser
- ruby-parser, php-parser, csharp-parser

#### **AI Providers (8 files)**
Integrations with AI services:
- base (abstract interface)
- factory (provider instantiation)
- openai, claude, gemini, ollama
- embedding-openai, embedding-ollama

#### **Utilities (9 files)**
Helper modules:
- api-client, reporter, report-templates, monitoring
- chart-generator, network, version, progress, ascii-art

---

### Backend (Optional - `backend/` - 913 LOC)

**Purpose:** Optional telemetry and monitoring ONLY. Can be disabled entirely.

#### **Handlers (3 files)**
- `health.ts` - Health check endpoint (always available)
- `telemetry.ts` - Anonymous usage analytics (optional)
- `monitoring.ts` - Error/performance tracking (optional)

#### **Database (Supabase - Optional)**
Only used if telemetry is enabled:
- `telemetry` - Anonymous usage data (command, LOC count, duration)
- `errors` - Error tracking for debugging
- `metrics` - Performance metrics
- `usage_events` - Command usage analytics

**Privacy Note:** NO source code, file paths, or identifiable information is ever stored.

#### **Removed (No longer exist):**
- ❌ `credits.ts` - Removed (no credit system)
- ❌ `stripe-webhook.ts` - Removed (no payments)
- ❌ `validate.ts` - Removed (no credit validation)
- ❌ `clients`, `credits`, `transactions` tables - Removed from schema

---

## Data Flow

### Static Analysis (Offline)

```
1. User runs: guardscan security

2. CLI (local):
   ├─ Scans codebase (9 security scanners)
   ├─ Generates findings
   ├─ Creates markdown report
   └─ Saves to: ./guardscan-report.md

3. Backend: NOT CONTACTED (100% offline)

4. AI Provider: NOT CONTACTED (no AI in static analysis)
```

### AI-Enhanced Review (BYOK)

```
1. User runs: guardscan run

2. CLI (local):
   ├─ Parses code with AST parser
   ├─ Builds context (no source code, just structure)
   ├─ User's API key → User's chosen AI provider
   │  (OpenAI, Claude, Gemini, or local Ollama)
   ├─ Receives AI insights
   └─ Generates report locally

3. Backend (optional telemetry):
   └─ IF telemetry enabled:
      └─ Sends: { command: "run", loc: 5000, duration: 30s }
         (NO source code, NO file names)

4. User's AI Provider:
   ├─ Receives anonymized context
   ├─ Processes with user's API key
   ├─ Returns insights
   └─ Bills user directly (not GuardScan)
```

### Chat Mode (RAG)

```
1. User runs: guardscan chat

2. CLI (local):
   ├─ Builds vector embeddings of codebase
   ├─ Stores in: ~/.guardscan/cache/<repo>/embeddings/
   ├─ User asks question
   ├─ Retrieves relevant context via similarity search
   ├─ Sends context + question to user's AI provider
   ├─ Displays AI response
   └─ Maintains conversation history locally

3. Backend: NOT CONTACTED (100% local RAG)

4. User's AI Provider:
   └─ Only receives: context snippets + user question
      (NO full source code sent)
```

---

## Configuration

### Local Configuration (`~/.guardscan/config.yml`)

```yaml
clientId: "uuid-generated-locally"
provider: "openai"  # or "claude", "gemini", "ollama", "none"
apiKey: "user-provided-key"  # NOT stored in GuardScan backend
telemetryEnabled: true  # Optional, can be disabled
offlineMode: false
```

### Environment Variables (Backend - Optional)

```bash
# Only needed if running optional backend
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=service-role-key

# NOT NEEDED (removed):
# STRIPE_SECRET_KEY - Removed
# STRIPE_WEBHOOK_SECRET - Removed
```

---

## Telemetry & Privacy

### What's Sent (if telemetry enabled):

```json
{
  "clientId": "uuid-local-only",
  "repoId": "sha256-hash-of-git-remote",
  "command": "security",
  "loc": 5000,
  "durationMs": 30000,
  "model": "gpt-4"
}
```

### What's NEVER Sent:

- ❌ Source code
- ❌ File paths
- ❌ File names
- ❌ Code snippets
- ❌ API keys
- ❌ Secrets
- ❌ User identity
- ❌ Repository URL (only hash)

### How to Disable:

```bash
# Option 1: CLI flag
guardscan security --no-telemetry

# Option 2: Configuration
guardscan config
# Select: Disable telemetry

# Option 3: Edit config file
echo "telemetryEnabled: false" >> ~/.guardscan/config.yml

# Option 4: Offline mode (disables telemetry + monitoring)
guardscan config
# Enable offline mode
```

---

## Deployment

### CLI (NPM Package)

```bash
# User installation
npm install -g guardscan

# No account needed
# No registration needed
# No API key needed (for static analysis)
```

### Backend (Optional)

**Deployment:** Cloudflare Workers + Supabase
**Purpose:** Optional telemetry only
**Can be disabled:** Yes, completely optional

**If you want to run your own backend:**
```bash
cd backend
npm install
wrangler deploy
```

**If you want to skip backend entirely:**
- Just use CLI with `--no-telemetry` or `offlineMode: true`
- Backend is NOT required for any functionality

---

## Cost Model

### GuardScan Cost: **$0**

- No subscriptions
- No credits
- No paywalls
- No user accounts
- 100% free forever

### AI Provider Costs (Optional, BYOK):

**If you choose to use AI features, you pay the AI provider directly:**

| Provider | Cost | Billing |
|----------|------|---------|
| OpenAI GPT-4 | ~$0.01-0.03/1K tokens | User → OpenAI |
| Claude Sonnet | ~$0.003/1K tokens | User → Anthropic |
| Gemini Pro | Free tier available | User → Google |
| Ollama | $0 (runs locally) | Free |

**GuardScan receives $0** - You pay AI providers directly with your own API key.

---

## Security

### Code Security
- Strict TypeScript mode (no `any` types)
- Input validation on all endpoints
- Row Level Security (RLS) on database
- Secrets detection to prevent leaking API keys

### Privacy Security
- No source code transmission
- Client-generated UUIDs (not server-assigned)
- Cryptographic hash for repo IDs
- Optional telemetry (can be disabled)
- Local caching only

### API Key Security
- API keys stored locally only (`~/.guardscan/config.yml`)
- Never sent to GuardScan backend
- Sent directly to user's chosen AI provider
- Masked in CLI output

---

## Technology Stack

### CLI
- **Runtime:** Node.js 18+
- **Language:** TypeScript (strict mode)
- **Framework:** Commander.js
- **Styling:** Chalk
- **HTTP:** Axios
- **Testing:** Jest
- **Build:** TypeScript Compiler (tsc)

### Backend (Optional)
- **Platform:** Cloudflare Workers (serverless)
- **Database:** Supabase (PostgreSQL)
- **Payments:** ❌ Removed (no payments)
- **CI/CD:** GitHub Actions

### AI Providers (User's Choice)
- OpenAI SDK
- Anthropic SDK
- Google Generative AI SDK
- Ollama (local HTTP API)

---

## Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| Small codebase (10k LOC) | <5s | ✅ Achieved |
| Medium codebase (50k LOC) | <15s | ✅ Achieved |
| Large codebase (100k LOC) | <30s | ✅ Achieved |
| Peak memory usage | <500MB | ✅ Achieved |
| Throughput | >3k LOC/sec | ✅ Achieved |

---

## Testing

### Test Coverage: **70%+**

```
Core Modules:       ██████████░ 80%
AI Features:        ████████░░░ 75%
Commands:           ██████░░░░░ 60%
Parsers:            ███████░░░░ 65%
Providers:          ████████░░░ 70%
Utils:              █████████░░ 85%
────────────────────────────────
Overall:            ███████░░░░ 70%
```

### Test Types
- Unit tests (15 files, 100+ test cases)
- Integration tests (RAG E2E)
- Performance tests (load testing)
- Provider tests (factory pattern)

---

## Future Architecture Considerations

### Potential Enhancements (NOT IMPLEMENTED YET)

1. **Browser Extension**
   - In-browser code review
   - Still privacy-first (no server upload)

2. **VS Code Extension**
   - Inline code suggestions
   - Real-time security scanning

3. **Self-Hosted Backend**
   - Docker container for teams
   - Private telemetry dashboard

4. **Plugin System**
   - Custom security rules
   - Custom report templates
   - Community plugins

**Note:** All future enhancements must maintain privacy-first, free, and open-source principles.

---

## Licensing

**License:** MIT
**Commercial Use:** Allowed
**Modifications:** Allowed
**Distribution:** Allowed
**Patent Use:** Allowed
**Private Use:** Allowed
**Liability:** None (use at own risk)
**Warranty:** None

---

**Last Updated:** 2025-11-16
**Maintained By:** GuardScan Community
**Repository:** https://github.com/ntanwir10/GuardScan
