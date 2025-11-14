# Product Requirements Document (PRD)
# GuardScan - Privacy-First AI Code Review CLI

**Version**: 1.0
**Date**: 2025-11-14
**Status**: MVP Complete
**Owner**: Product Team

---

## Executive Summary

GuardScan is a privacy-first, developer-friendly CLI tool that combines **offline-capable static analysis** with **optional AI-powered code review**. Unlike traditional code review tools that upload your source code to third-party servers, GuardScan guarantees privacy by performing all analysis locally and only sending anonymized metadata to backend services.

**Key Differentiators:**
- ✅ **Privacy Guarantee**: Source code never leaves your machine
- ✅ **Offline-First**: Full functionality without internet connection
- ✅ **AI-Agnostic**: Support for 6+ AI providers (user's choice)
- ✅ **Comprehensive**: Security + Quality + Testing in one tool
- ✅ **Transparent Pricing**: Pay per LOC (lines of code), no subscriptions

---

## Problem Statement

### Current Pain Points

1. **Privacy Concerns**: Existing code review tools (SonarQube, CodeClimate) upload source code to their servers, violating enterprise security policies and IP concerns

2. **Fragmented Tooling**: Developers need multiple tools for:
   - Security scanning (Snyk, Dependabot)
   - Code quality (ESLint, Pylint)
   - Test coverage (Jest, pytest)
   - AI review (ChatGPT, GitHub Copilot)

3. **Subscription Fatigue**: Most tools require expensive monthly subscriptions regardless of usage

4. **Platform Lock-In**: Choosing an AI provider (OpenAI, Claude) locks you into their ecosystem

5. **Always-Online Requirements**: Many tools fail completely without internet access

### Our Solution

GuardScan provides a **unified CLI** that:
- Performs **all analysis locally** (offline-capable)
- Supports **multiple AI providers** (user's choice)
- Uses **pay-per-use pricing** (LOC-based)
- Guarantees **source code privacy** (never uploaded)
- Works **completely offline** for static analysis

---

## Target Users

### Primary Personas

#### 1. **Security-Conscious Developer** (Priority 1)
- **Profile**: Works at enterprises with strict IP policies (finance, healthcare, government)
- **Need**: Code review without uploading source code
- **Pain**: Can't use SonarCloud, CodeClimate, or GitHub Copilot due to security policies
- **Value**: Privacy guarantee + comprehensive security scanning

#### 2. **Indie Developer / Freelancer** (Priority 2)
- **Profile**: Builds multiple small projects, budget-conscious
- **Need**: Affordable code quality tools without monthly subscriptions
- **Pain**: $50-200/month for code review tools is too expensive for side projects
- **Value**: Pay-per-use pricing (only pay for what you scan)

#### 3. **Open Source Maintainer** (Priority 3)
- **Profile**: Maintains popular OSS projects, wants quality control
- **Need**: Automated code review for pull requests
- **Pain**: Free tier limits on existing tools
- **Value**: Offline-capable scanning, no API rate limits for static analysis

#### 4. **AI Power User** (Priority 4)
- **Profile**: Wants cutting-edge AI review but doesn't want vendor lock-in
- **Need**: Flexibility to switch between AI providers (OpenAI, Claude, local Ollama)
- **Pain**: Locked into GitHub Copilot or specific AI provider
- **Value**: Multi-provider support, can use local AI (Ollama/LM Studio)

---

## Product Goals & Success Metrics

### North Star Metric
**Monthly Active Developers (MAD)** using GuardScan for code review

### Key Performance Indicators (KPIs)

| Metric | Target (6 months) | Measurement |
|--------|-------------------|-------------|
| Monthly Active Users | 10,000 developers | CLI telemetry (opt-in) |
| Scans per Week | 50,000 scans | Backend analytics |
| Privacy Compliance | 100% | Zero source code uploads |
| Offline Functionality | 100% | Static analysis works offline |
| Test Coverage | 70%+ | Jest coverage reports |
| NPM Downloads | 5,000/month | NPM stats |

### Business Metrics

| Metric | Target (12 months) |
|--------|-------------------|
| Total LOC Scanned | 1 billion lines |
| Paying Users | 500 developers |
| Monthly Revenue | $5,000 MRR |
| Churn Rate | <10% monthly |

---

## Core Features & Requirements

### 1. Privacy-First Architecture (P0 - Must Have)

**Requirement**: Source code must NEVER be uploaded to GuardScan servers.

**Implementation**:
- ✅ All static analysis runs locally
- ✅ Only anonymized metadata sent to backend:
  - `client_id` (UUID)
  - `repo_id` (SHA-256 hash of git remote URL)
  - `loc_count` (integer)
  - Command usage statistics
- ✅ AI review sends code snippets to **user-chosen** AI provider (not our servers)
- ✅ Clear privacy policy visible in CLI: `guardscan status`

**Acceptance Criteria**:
- [ ] Code audit confirms zero file uploads
- [ ] Privacy policy displayed on first run
- [ ] Telemetry is opt-out with clear messaging
- [ ] Documentation explicitly states privacy guarantees

---

### 2. Offline-Capable Static Analysis (P0 - Must Have)

**Requirement**: All security and quality scanning must work without internet.

**Features**:
- ✅ **Secrets Detection**: Detect 20+ types of hardcoded secrets
  - AWS keys, API keys, private keys, JWT tokens
  - High-entropy string detection (Shannon entropy)
  - Git history scanning (last 100 commits)

- ✅ **Dependency Scanning**: Vulnerability detection via npm audit
  - Support: npm, pip, cargo, composer, bundler
  - CVE mapping with severity levels

- ✅ **OWASP Top 10 Coverage**: Pattern-based security checks
  - SQL injection, XSS, CSRF detection
  - Insecure deserialization, XXE
  - Language-specific checks (JS, Python, Java, Go)

- ✅ **Dockerfile Security**: Container security best practices
  - Base image security
  - USER instruction checks
  - Secret exposure detection

- ✅ **IaC Scanning**: Infrastructure as Code security
  - Terraform resource exposure
  - Kubernetes security policies
  - Cloud provider misconfigurations

**Acceptance Criteria**:
- [ ] Works with airplane mode enabled
- [ ] No network calls for static analysis
- [ ] Graceful degradation when offline (skip credit validation)
- [ ] Clear messaging: "Offline mode - skipping cloud features"

---

### 3. Code Quality Analysis (P0 - Must Have)

**Features**:
- ✅ **LOC Counter**: Language-aware line counting
  - 20+ languages supported
  - Comment detection (single-line, block, docstrings)
  - .gitignore respect

- ✅ **Complexity Metrics**: Cyclomatic complexity, Halstead metrics
  - Function-level complexity scoring
  - Maintainability index calculation

- ✅ **Code Smells**: 30+ anti-patterns detected
  - God classes, long methods, duplicate code
  - Magic numbers, deep nesting

- ✅ **Test Coverage Integration**: Run existing test suites
  - Jest, pytest, JUnit, Go test support
  - Coverage report parsing

**Acceptance Criteria**:
- [ ] Accurate LOC counts (within 5% of manual count)
- [ ] Language detection for 20+ languages
- [ ] Code smell detection with actionable recommendations

---

### 4. Multi-Provider AI Integration (P1 - Should Have)

**Requirement**: Support multiple AI providers without vendor lock-in.

**Supported Providers**:
- ✅ **OpenAI**: GPT-4, GPT-3.5-turbo
- ✅ **Anthropic**: Claude 3 (Opus, Sonnet, Haiku)
- ✅ **Google**: Gemini Pro
- ✅ **Ollama**: Local AI (llama2, codellama, mistral)
- ✅ **LM Studio**: Local model server
- ✅ **OpenRouter**: Multi-model aggregator

**Features**:
- Smart context selection (5 files × 100 lines max)
- Provider-specific token limit handling
- Graceful fallback if AI unavailable
- Local AI support for complete offline usage

**Acceptance Criteria**:
- [ ] Users can switch providers without data migration
- [ ] Local AI (Ollama) works offline
- [ ] Clear error messages if API key invalid
- [ ] Token limit warnings before expensive scans

---

### 5. Markdown Report Generation (P0 - Must Have)

**Requirement**: All scan results exported as readable Markdown reports.

**Report Sections**:
- Executive summary with severity breakdown
- Security findings (critical, high, medium, low)
- Code quality metrics
- Test coverage results
- AI review insights (if enabled)
- Recommendations with priority

**Features**:
- ✅ Color-coded severity (in terminal)
- ✅ File and line number references
- ✅ Chart generation (PNG) for metrics
- ✅ Shareable reports (commit to repo or share with team)

**Acceptance Criteria**:
- [ ] Reports render correctly on GitHub
- [ ] Charts generate without errors
- [ ] All findings include file:line references
- [ ] Executive summary fits on one screen

---

### 6. Credit System & Backend (P1 - Should Have)

**Requirement**: Fair, transparent pricing based on LOC scanned with AI.

**Pricing Model**:
- **FREE Tier**: Unlimited static analysis (offline)
- **PAID Tier**: $5 per 100,000 LOC for AI-enhanced review
  - Example: 10,000 LOC repo = $0.50
  - Example: 100,000 LOC repo = $5.00

**Backend Features**:
- ✅ Credit validation before AI scans
- ✅ Supabase PostgreSQL database
- ✅ Stripe payment integration
- ✅ Cloudflare Workers serverless API
- ✅ Client auto-creation on first use

**Acceptance Criteria**:
- [ ] Credit balance displayed: `guardscan status`
- [ ] Purchase flow integrated (Stripe Checkout)
- [ ] Credits deducted accurately after scans
- [ ] Grace period for small scans (<1000 LOC)

---

### 7. Developer Experience (P0 - Must Have)

**CLI Commands**:
```bash
guardscan init          # Initialize config, generate client_id
guardscan config        # Configure AI provider & API key
guardscan status        # Show credits, provider, repo info
guardscan security      # Security vulnerability scanning (offline)
guardscan test          # Run tests & code quality analysis
guardscan sbom          # Generate Software Bill of Materials
guardscan perf          # Performance testing
guardscan mutation      # Mutation testing
guardscan rules         # Custom YAML-based rule engine
guardscan run           # AI-powered code review (requires credits)
guardscan reset         # Clear local cache & config
```

**Configuration**:
- Stored in `~/.guardscan/config.yml`
- Environment variable fallbacks
- Per-repo `.guardscanrc` overrides

**Acceptance Criteria**:
- [ ] Intuitive command names (no confusion)
- [ ] `--help` for every command
- [ ] Colored terminal output (chalk)
- [ ] Progress indicators for long operations (ora spinners)
- [ ] Clear error messages with suggested fixes

---

## Technical Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User's Machine                        │
│  ┌────────────────────────────────────────────────────┐ │
│  │  GuardScan CLI (TypeScript/Node.js)                │ │
│  │                                                      │ │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │ │
│  │  │ Commands    │  │ Core Modules │  │ Providers  │ │ │
│  │  │ (11 total)  │  │ (18 scanners)│  │ (6 AI)     │ │ │
│  │  └─────────────┘  └──────────────┘  └────────────┘ │ │
│  │                                                      │ │
│  │  Config: ~/.guardscan/config.yml                    │ │
│  │  Cache:  ~/.guardscan/cache/                        │ │
│  └────────────────────────────────────────────────────┘ │
│                         │                                │
│                         │ (Anonymized metadata only)     │
│                         ▼                                │
└─────────────────────────────────────────────────────────┘
                          │
            ┌─────────────┼─────────────┐
            │             │             │
            ▼             ▼             ▼
    ┌──────────────┐ ┌─────────┐ ┌──────────────┐
    │ AI Provider  │ │ Backend │ │ Supabase DB  │
    │ (User's API) │ │ (CF)    │ │ (PostgreSQL) │
    └──────────────┘ └─────────┘ └──────────────┘
```

### Technology Stack

**CLI**:
- Language: TypeScript 5.3+
- Runtime: Node.js 18+
- Framework: Commander.js (CLI)
- Dependencies: chalk, ora, fast-glob, ignore, js-yaml
- Build: tsc (TypeScript compiler)
- Tests: Jest + ts-jest (73 tests, 50%+ coverage)

**Backend**:
- Platform: Cloudflare Workers (serverless edge)
- Database: Supabase (PostgreSQL with Row Level Security)
- Payments: Stripe (Checkout + Webhooks)
- Deployment: Wrangler CLI

**CI/CD**:
- GitHub Actions (9-stage pipeline)
- Automated testing (Node 18, 20)
- Codecov integration
- Automated NPM publish
- Cloudflare Workers deployment

---

## User Stories

### Epic 1: Privacy-First Scanning

**US-1.1**: As a security-conscious developer, I want to scan my code for vulnerabilities without uploading it to third-party servers, so that I comply with my company's IP policy.

**Acceptance Criteria**:
- When I run `guardscan security`, no source code is uploaded
- I can verify this with network monitoring tools
- A privacy statement is displayed on first use

**US-1.2**: As an enterprise developer, I want to run GuardScan completely offline, so that I can scan classified code in air-gapped environments.

**Acceptance Criteria**:
- All commands work without internet (except AI review)
- Clear messaging when offline: "Offline mode - skipping credit validation"
- No errors or crashes due to network unavailability

---

### Epic 2: Multi-Provider AI Flexibility

**US-2.1**: As an AI power user, I want to switch between OpenAI and Claude without changing my workflow, so that I can compare results and avoid vendor lock-in.

**Acceptance Criteria**:
- `guardscan config` allows switching providers
- No data migration required
- Same report format regardless of provider

**US-2.2**: As a privacy-focused developer, I want to use local AI (Ollama) for code review, so that no code snippets leave my machine.

**Acceptance Criteria**:
- Ollama provider works with locally-run models
- No internet required for AI review (fully offline)
- Performance is acceptable (<2min for 10k LOC)

---

### Epic 3: Affordable Pay-Per-Use Pricing

**US-3.1**: As an indie developer, I want to pay only for the LOC I scan, so that I don't waste money on unused subscriptions.

**Acceptance Criteria**:
- No monthly fees
- Pricing displayed before scan: "This will cost $0.50 (10k LOC)"
- Can purchase credits in $5, $25, $100 increments

**US-3.2**: As a casual user, I want free static analysis, so that I can try GuardScan without payment.

**Acceptance Criteria**:
- `guardscan security` works without credits
- Only AI review requires credits
- Clear distinction between free and paid features

---

### Epic 4: Developer Experience

**US-4.1**: As a first-time user, I want to get started in under 2 minutes, so that I can evaluate GuardScan quickly.

**Acceptance Criteria**:
- `npm install -g guardscan && guardscan init && guardscan security`
- First scan completes in <2 minutes
- Report is easy to understand

**US-4.2**: As a busy developer, I want actionable recommendations, so that I know exactly what to fix.

**Acceptance Criteria**:
- Each finding includes file:line reference
- Recommendations are specific ("Change X to Y")
- Severity is clearly marked (critical, high, medium, low)

---

## Non-Functional Requirements

### Performance

| Metric | Target | Measurement |
|--------|--------|-------------|
| CLI startup time | <500ms | `time guardscan --help` |
| LOC counting (10k lines) | <2s | Benchmark tests |
| Security scan (10k lines) | <10s | Benchmark tests |
| Report generation | <1s | Benchmark tests |
| AI review (10k lines) | <60s | End-to-end test |

### Reliability

- **Uptime**: 99.9% for backend API (Cloudflare Workers SLA)
- **Error Recovery**: Graceful degradation when offline or AI unavailable
- **Data Integrity**: Credit transactions are ACID-compliant (PostgreSQL)
- **Backward Compatibility**: Config format versioned, migrations automated

### Security

- **No Code Uploads**: Enforced at code level, verified by tests
- **Secrets Management**: API keys stored in `~/.guardscan/config.yml` with 600 permissions
- **Database**: Row Level Security (RLS) enabled on all Supabase tables
- **Payments**: PCI-DSS compliant (Stripe Checkout)
- **Input Validation**: All CLI inputs sanitized to prevent command injection

### Scalability

- **Backend**: Auto-scales on Cloudflare Workers (handles 100k+ requests/day)
- **Database**: Supabase Pro plan supports 1M+ rows
- **CLI**: Single-threaded Node.js, acceptable for local dev machines

### Compatibility

- **Node.js**: 18.0.0+ (LTS versions)
- **Operating Systems**: macOS, Linux, Windows (via WSL)
- **Git**: Optional but recommended for repo detection
- **Package Managers**: npm, yarn, pnpm

---

## Roadmap

### Phase 1: MVP (Complete ✅)

**Status**: ✅ Complete (2025-11-14)

- [x] CLI with 11 commands
- [x] 5 security scanners (secrets, dependencies, OWASP, Dockerfile, IaC)
- [x] 4 quality analyzers (LOC, metrics, smells, linters)
- [x] 6 AI provider integrations
- [x] Backend API with credit system
- [x] Test suite (73 tests, 50%+ coverage)
- [x] CI/CD pipeline (GitHub Actions)
- [x] Deployment configs (Cloudflare + Supabase)

### Phase 2: Public Beta (Q1 2025)

**Goal**: Validate product-market fit with 100 beta users

- [ ] NPM public package publish
- [ ] Backend deployment to production
- [ ] Stripe payment integration live
- [ ] Documentation site (docs.guardscan.dev)
- [ ] Beta user onboarding flow
- [ ] User feedback collection (NPS survey)
- [ ] Analytics dashboard (Mixpanel/Amplitude)

**Success Criteria**:
- 100 active beta users
- 50+ GitHub stars
- NPS score >30
- <5% churn rate

### Phase 3: Growth & Monetization (Q2 2025)

**Goal**: Reach 1,000 paying users and $10k MRR

- [ ] Team plans (shared credit pools)
- [ ] CI/CD integration (GitHub Actions plugin)
- [ ] VS Code extension (inline suggestions)
- [ ] Enhanced AI features (auto-fix suggestions)
- [ ] Custom rule marketplace
- [ ] Enterprise SSO support
- [ ] Annual billing discounts

**Success Criteria**:
- 1,000 paying users
- $10,000 MRR
- 10,000 NPM downloads/month
- Featured on Product Hunt

### Phase 4: Enterprise & Scale (Q3-Q4 2025)

**Goal**: Serve enterprise customers with advanced needs

- [ ] Self-hosted backend option
- [ ] SAML/SSO authentication
- [ ] Audit logs & compliance reports
- [ ] Advanced analytics (security trends)
- [ ] White-labeling options
- [ ] Dedicated support (SLA)
- [ ] Multi-repo scanning

**Success Criteria**:
- 10 enterprise customers ($500+/month each)
- $50,000 MRR
- SOC 2 Type II compliance
- 99.99% uptime SLA

---

## Open Questions & Risks

### Open Questions

1. **Pricing Validation**: Is $5 per 100k LOC the right price point?
   - **Mitigation**: A/B test pricing during beta ($3, $5, $10)

2. **AI Provider Costs**: Can we maintain margins with AI API costs?
   - **Mitigation**: Pass through costs directly, take small markup

3. **Market Size**: How many developers care about privacy enough to pay?
   - **Mitigation**: Survey beta users, validate with early sales

### Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| AI providers raise prices | High | Medium | Support local AI (Ollama) as free alternative |
| Competitors copy our model | Medium | High | Build strong brand around privacy |
| Low adoption (privacy not valued) | High | Low | Pivot to emphasize cost savings vs subscriptions |
| Backend scaling costs | Medium | Medium | Cloudflare Workers auto-scales efficiently |
| Regulatory changes (AI usage) | Medium | Low | Stay informed, adapt quickly |

---

## Competitive Analysis

### Direct Competitors

| Competitor | Strengths | Weaknesses | Our Advantage |
|------------|-----------|------------|---------------|
| **SonarQube** | Mature, comprehensive | Uploads code, expensive SaaS | Privacy-first, offline-capable |
| **CodeClimate** | Good UX, integrations | Uploads code, subscription model | Pay-per-use, local execution |
| **Snyk** | Security focus, free tier | Uploads code, limited offline | Full offline, multi-scanner |
| **GitHub Copilot** | AI-powered, integrated | GitHub lock-in, privacy concerns | Multi-provider AI, privacy guarantee |

### Unique Value Proposition

**"GuardScan is the only code review tool that combines comprehensive security scanning, AI-powered insights, and absolute privacy guarantees—all in a single CLI that works completely offline."**

---

## Success Criteria (6-Month Horizon)

### Product Metrics
- [ ] 10,000 monthly active developers
- [ ] 50,000 scans per week
- [ ] 70%+ test coverage maintained
- [ ] <100ms p95 CLI startup time
- [ ] 99.9% backend uptime

### Business Metrics
- [ ] 500 paying users
- [ ] $5,000 MRR
- [ ] <10% monthly churn
- [ ] 1 billion LOC scanned (cumulative)

### Quality Metrics
- [ ] NPS score >30
- [ ] 4.5+ stars on NPM
- [ ] <1% error rate in production
- [ ] Zero privacy violations reported

---

## Appendix

### Glossary

- **LOC**: Lines of Code (excluding comments and blank lines)
- **SAST**: Static Application Security Testing
- **OWASP**: Open Web Application Security Project
- **IaC**: Infrastructure as Code
- **RLS**: Row Level Security (database)
- **PRD**: Product Requirements Document

### References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Supabase Documentation](https://supabase.com/docs)
- [Stripe API Reference](https://stripe.com/docs/api)

---

**Document Version**: 1.0
**Last Updated**: 2025-11-14
**Next Review**: 2025-12-14
**Status**: ✅ MVP Complete, Ready for Beta
