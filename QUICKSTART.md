# GuardScan - Quick Start Guide

**Get started with GuardScan in under 2 minutes!**

GuardScan is a privacy-first, open-source security scanning and AI code review CLI. Local static analysis and SBOM inventory work offline without an API key. Current CVE data requires OSV access or a fresh matching local snapshot.

---

## 📦 Installation

```bash
# Install GuardScan globally
npm install -g guardscan

# Verify installation
guardscan --version
```

**Requirements:**

- Node.js >= 22.0.0
- npm (pnpm, Yarn, and Bun compatibility is release-gated before those install paths are advertised)

---

## 🚀 Quick Start (3 Steps)

### Step 1: Initialize GuardScan

```bash
guardscan init
```

This creates a private local configuration file. GuardScan does not generate or transmit an installation identifier.

### Step 2: Run Your First Security Scan

```bash
# Scan your current project with local checks only
guardscan security --offline --no-cve
```

This will:

- ✅ Detect secrets in your code (API keys, passwords, tokens)
- ✅ Scan dependencies for known vulnerabilities when OSV or a matching snapshot is available
- ✅ Check Dockerfiles for security issues
- ✅ Analyze Infrastructure as Code (Terraform, CloudFormation, K8s)
- ✅ Detect OWASP Top 10 vulnerabilities
- ✅ Generate a comprehensive markdown report

**No API key needed** - local security scanning and SBOM inventory work offline. Current CVE results need OSV access or a fresh matching local snapshot.

### Step 3: (Optional) Configure AI Provider

For AI-powered features like code review, documentation generation, and refactoring:

```bash
guardscan config
```

Follow the prompts to set:

- AI provider (OpenAI, Anthropic Claude, Google Gemini, or Ollama for local AI)
- API key (your own key - we never see it)
- Telemetry preference

**Note:** AI features are optional. All security scanning works without any API keys!

---

## 📋 Available Commands

GuardScan provides **29 top-level commands** organized by category:

### Setup & Configuration

```bash
guardscan init                    # Initialize local GuardScan configuration
guardscan config                  # Configure AI provider and settings (OpenAI, Claude, Gemini, Ollama)
guardscan status                  # Show provider, repo, and local config status
guardscan reset                   # Clear local cache and config
guardscan cache                   # Inspect or clear repository/global cache
guardscan telemetry               # Inspect, explicitly sync, or clear telemetry
guardscan capabilities            # Inspect optional runtime capabilities and safe fallbacks
```

### Security & Scanning (Offline-Capable, 100% FREE)

```bash
guardscan security                # Security vulnerability scanning
guardscan scan                    # Comprehensive scan (all security and quality checks)
guardscan test                    # Run tests and code quality analysis
guardscan sbom                    # Generate Software Bill of Materials (SBOM)
guardscan rules                   # Run custom YAML-based rules engine
guardscan vuln                    # Audit exact dependency versions with OSV
```

### Testing & Performance

```bash
guardscan perf                    # Performance testing (load, stress, Lighthouse)
guardscan mutation                # Mutation testing to assess test quality
```

### AI-Powered Code Review (Requires API Key)

```bash
guardscan run                     # AI-enhanced code review
guardscan review                  # AI-powered code review for git changes
```

### AI-Powered Code Generation (Requires API Key)

```bash
guardscan commit                  # Generate AI-powered commit messages
guardscan explain <target>        # Explain code using AI (function, class, file)
guardscan test-gen                # Generate tests using AI
guardscan docs                    # Generate documentation using AI
```

### AI-Powered Code Improvement (Requires API Key)

```bash
guardscan refactor                # AI-powered refactoring suggestions
guardscan threat-model            # AI-powered threat modeling with STRIDE analysis
guardscan migrate                 # AI-powered code migration assistant
```

### Interactive AI (Requires API Key)

```bash
guardscan chat                    # Interactive AI chat about your codebase (RAG feature)
```

### AI Model Operations

```bash
guardscan models                  # Inspect supported AI models
guardscan routing                 # Configure task-to-model routing
guardscan budget                  # Inspect and configure local budget limits
guardscan metrics                 # Inspect locally recorded AI metrics
```

---

## 💡 Common Use Cases

### Security Audit Before Deployment

```bash
# Run comprehensive security scan
guardscan security

# Check for dependency vulnerabilities
guardscan config --offline=false
guardscan vuln . --ci --format json --output vulnerabilities.json

# Generate SBOM for compliance
guardscan sbom --format spdx
guardscan sbom --format cyclonedx
```

SBOM output is validated against the official SPDX 2.3 and CycloneDX 1.7 JSON schemas.

For the combined security, quality, and SBOM workflow, `guardscan scan` remains
static-safe by default. Only add `--run-project-code` for a repository you trust;
add `--isolate-project-network` when you also require an available OS network sandbox.

### AI-Powered Code Review

```bash
# Review all changes in your git repository
guardscan review

# Review specific file
guardscan review --file src/api.ts

# Get AI suggestions for security issues
guardscan security --ai-fix
```

### Code Quality & Testing

```bash
# Run all quality checks
guardscan test --all

# Performance testing
guardscan perf --load --duration 1m

# Mutation testing
guardscan mutation --threshold 80
```

### AI Code Assistance

```bash
# Explain a function
guardscan explain getUserData --type function

# Generate tests
guardscan test-gen --function calculateTotal

# Generate documentation
guardscan docs --type api

# Interactive chat about your codebase
guardscan chat
```

---

## 🔒 Privacy & Security

### What GuardScan Does

- ✅ Scans your code **locally** on your machine
- ✅ Does not upload source code to GuardScan servers
- ✅ Runs local static analysis offline
- ✅ Does not execute repository tests or linters during `guardscan scan` unless explicitly enabled
- ✅ Uses your own AI API keys (BYOK - Bring Your Own Key)

### Optional telemetry

- Telemetry is disabled by default.
- After consent, GuardScan queues only action, aggregate LOC, duration, coarse execution mode, event ID, and timestamp.
- Source, paths, prompts, responses, findings, dependency names, and errors are excluded.
- Delivery happens only through `guardscan telemetry sync` to an HTTPS endpoint you configure.

Inspect or suppress it:

```bash
guardscan --no-telemetry security
guardscan telemetry status
```

---

## 🎯 How It Works

### Offline-First Architecture

**Static Analysis** (Offline-first, 100% FREE):

- Secrets detection (20+ patterns)
- Dependency inventory and vulnerability evaluation from a fresh matching snapshot
- Code metrics and complexity analysis
- LOC counting (20+ languages)
- OWASP Top 10 detection
- Docker security scanning
- Infrastructure as Code analysis

OSV lookups and snapshot refreshes require online mode:

```bash
guardscan config --offline=false
guardscan vuln db update .
guardscan vuln .
```

See [Dependency Vulnerability Scanning](./docs/VULNERABILITY_SCANNING.md) for supported lockfiles, limitations, and CI policy.

**AI-Enhanced** (Optional, requires your API key):

- OpenAI GPT-4, GPT-3.5
- Anthropic Claude (Opus, Sonnet, Haiku)
- Google Gemini
- Ollama (offline only at literal `127/8` or `::1` endpoints)
- LM Studio (offline only at literal `127/8` or `::1` endpoints)

Remote self-hosted Ollama or LM Studio endpoints require online mode and the
explicit `allowRemoteSelfHosted: true` configuration approval.

---

## 🆘 Troubleshooting

### Command Not Found

```bash
# Check if GuardScan is installed
npm list -g guardscan

# If not installed, install it
npm install -g guardscan

# Verify it's in your PATH
which guardscan
```

### Permission Errors (macOS/Linux)

```bash
# Use sudo if needed (not recommended)
sudo npm install -g guardscan

# Better: Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
npm install -g guardscan
```

### AI Features Not Working

```bash
# Check your configuration
guardscan status

# Reconfigure AI provider
guardscan config

# Verify API key is set correctly
guardscan config --show
```

### Clear Cache and Start Fresh

```bash
# Reset all local data
guardscan reset --all

# Re-initialize
guardscan init
```

---

## 📚 Documentation

- **[README.md](README.md)** - Complete project overview
- **[CLI README](cli/README.md)** - Detailed CLI documentation
- **[Getting Started](docs/GETTING_STARTED.md)** - Extended getting started guide
- **[Docker Guide](docs/DOCKER_GUIDE.md)** - Running GuardScan in Docker
- **[Language Support](docs/LANGUAGE_PARSERS.md)** - Supported languages and parsers

---

## 🆘 Getting Help

- **GitHub Issues**: <https://github.com/ntanwir10/GuardScan/issues>
- **Documentation**: Check the `docs/` directory
- **Examples**: See `examples/` directory (if available)

---

## ✅ Next Steps

1. ✅ **Install**: `npm install -g guardscan`
2. ✅ **Initialize**: `guardscan init`
3. ✅ **Scan**: `guardscan security --offline --no-cve` (local checks, 100% free)
4. ✅ **Configure AI** (optional): `guardscan config`
5. ✅ **Explore**: Try `guardscan --help` to see all commands

**That's it! You're ready to start scanning your code for security issues.**

---
