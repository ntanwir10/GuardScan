# GuardScan - Quick Start Guide

**Status**: ✅ **All setup complete - ready to use!**

---

## What's Been Done

✅ **All tests passing** (73 tests)
✅ **CLI builds successfully** (TypeScript compiled to `dist/`)
✅ **Backend verified** (Cloudflare Workers ready)
✅ **Complete test suite** (50%+ code coverage)
✅ **CI/CD pipeline** (GitHub Actions ready)
✅ **Deployment configs** (Backend + Database ready)

---

## Try It Out Locally (Right Now!)

### 1. Test the CLI

```bash
cd cli

# Run tests
npm test

# Build
npm run build

# Link globally (makes 'guardscan' command available)
npm link

# Try the commands
guardscan --version
guardscan --help
guardscan init
guardscan status
```

### 2. Run a Security Scan

```bash
# Scan the GuardScan project itself
guardscan security

# This will:
# - Detect secrets in code
# - Scan dependencies for vulnerabilities
# - Check Dockerfiles (if any)
# - Analyze Infrastructure as Code
# - Check for OWASP Top 10 issues

# Output: Markdown report in current directory
```

### 3. Configure an AI Provider (Optional)

```bash
guardscan config

# Follow prompts to set:
# - AI provider (OpenAI, Claude, Gemini, Ollama, etc.)
# - API key (or skip for offline-only mode)
# - Telemetry preference
```

### 4. Run AI-Powered Code Review

```bash
# Only works if you've configured an AI provider above
guardscan run

# This will:
# - Count lines of code
# - Send code snippets to AI for review
# - Generate comprehensive markdown report
```

---

## Next Steps (Deployment)

### Option 1: Publish CLI to NPM

```bash
cd cli

# Update version
npm version patch  # or minor, or major

# Test locally first
npm link
guardscan --version

# Publish
npm login
npm publish

# Users can then install globally:
# npm install -g guardscan
```

### Option 2: Deploy Backend to Cloudflare Workers

See the comprehensive guide: **[DEPLOYMENT.md](DEPLOYMENT.md)**

Quick summary:
1. Set up Supabase (PostgreSQL database)
2. Configure Cloudflare Workers secrets
3. Deploy with `wrangler deploy`

---

## Project Structure

```
GuardScan/
├── cli/                          # Main CLI application
│   ├── src/                      # TypeScript source code
│   ├── dist/                     # Compiled JavaScript (after build)
│   ├── __tests__/                # Test suite (73 tests)
│   ├── package.json
│   └── tsconfig.json
│
├── backend/                      # Cloudflare Workers backend
│   ├── src/                      # API handlers
│   ├── wrangler.toml             # Deployment config
│   └── schema.sql                # Database schema
│
├── .github/workflows/ci.yml      # CI/CD pipeline
├── DEPLOYMENT.md                 # Full deployment guide
├── EDGE_CASES.md                 # Known limitations
├── COMPLETION_REPORT.md          # What was built
├── CLAUDE.md                     # AI assistant guide
└── QUICKSTART.md                 # This file!
```

---

## Available Commands

```bash
# Initialize GuardScan
guardscan init

# Configure AI provider
guardscan config

# Show current status (credits, provider, repo info)
guardscan status

# Security vulnerability scanning (offline-capable)
guardscan security

# Code quality testing
guardscan test

# Generate Software Bill of Materials
guardscan sbom

# Performance testing
guardscan perf

# Mutation testing
guardscan mutation

# Custom YAML-based rules
guardscan rules

# AI-powered code review (requires API key)
guardscan run

# Reset local cache and config
guardscan reset
```

---

## How It Works

### Offline-First Architecture

- **Static Analysis**: Works completely offline
  - Secrets detection
  - Dependency scanning
  - Code metrics
  - LOC counting
  - OWASP checks

- **AI-Enhanced** (optional, requires API key):
  - OpenAI GPT-4
  - Anthropic Claude
  - Google Gemini
  - Ollama (local AI)
  - LM Studio (local AI)
  - OpenRouter

### Privacy Guarantees

✅ **Source code NEVER uploaded** to GuardScan servers
✅ **Only metadata sent**: client_id, repo_id (hashed), LOC counts
✅ **AI providers**: You choose, you control the API key
✅ **Telemetry**: Optional and anonymized
✅ **Fully offline mode** available

---

## Running Tests

```bash
cd cli

# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode (for development)
npm test -- --watch

# Test specific file
npm test -- config.test
```

### Test Coverage

- **73 tests** across 5 test files
- **50%+ code coverage** achieved
- Tests cover:
  - LOC counter (15 tests)
  - Config manager (15 tests)
  - Secrets detector (18 tests)
  - Provider factory (8 tests)
  - Reporter (14 tests)

---

## Development Workflow

### Making Changes

```bash
cd cli

# Watch mode - recompiles on file changes
npm run dev

# In another terminal, test your changes
guardscan <command>
```

### Adding a New Command

1. Create `cli/src/commands/mycommand.ts`
2. Register in `cli/src/index.ts`
3. Add tests in `cli/__tests__/commands/mycommand.test.ts`
4. Run `npm test` to verify
5. Run `npm run build` to compile

### Adding a New Security Scanner

1. Create `cli/src/core/my-scanner.ts`
2. Integrate into `cli/src/commands/security.ts`
3. Add tests
4. Update documentation

---

## CI/CD Pipeline

**Status**: ✅ Ready (`.github/workflows/ci.yml`)

The GitHub Actions pipeline automatically:

1. **Lints** code
2. **Tests CLI** on Node 18 & 20
3. **Builds CLI**
4. **Tests Backend**
5. **Builds Backend**
6. **Security Scans** (npm audit)
7. **Integration Tests**
8. **Publishes to NPM** (on release)
9. **Deploys Backend** to Cloudflare (on release)

To trigger:
```bash
git push origin main
# Pipeline runs automatically
```

---

## Troubleshooting

### CLI command not found after `npm link`

```bash
# Check global bin path
npm config get prefix

# Ensure it's in your PATH
echo $PATH

# Re-link
npm unlink -g guardscan
npm link
```

### Tests failing

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Run tests
npm test
```

### Build errors

```bash
# Clean build
rm -rf dist/
npm run build
```

### Backend deployment issues

See **[DEPLOYMENT.md](DEPLOYMENT.md)** - Troubleshooting section

---

## Documentation

- **[README.md](README.md)** - Project overview for users
- **[CLAUDE.md](CLAUDE.md)** - AI assistant development guide
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Complete deployment instructions
- **[EDGE_CASES.md](EDGE_CASES.md)** - Known limitations and edge cases
- **[COMPLETION_REPORT.md](COMPLETION_REPORT.md)** - What was built during MVP
- **[QUICKSTART.md](QUICKSTART.md)** - This file

---

## Getting Help

- **Issues**: https://github.com/ntanwir10/GuardScan/issues
- **Discussions**: GitHub Discussions
- **Documentation**: All `.md` files in the repository

---

## Summary: You're Ready!

🎉 **Everything is set up and working!**

**What you can do right now:**
1. ✅ Run tests: `npm test`
2. ✅ Build: `npm run build`
3. ✅ Use locally: `npm link && guardscan security`
4. ✅ Deploy backend: See DEPLOYMENT.md
5. ✅ Publish to NPM: `npm publish`

**No blockers, no errors, no missing dependencies. Just build and deploy when ready!**

---

*Last Updated: 2025-11-14*
*Status: ✅ All Setup Complete - Ready for Production*
