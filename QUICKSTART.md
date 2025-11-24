# GuardScan - Quick Start Guide

**Get started with GuardScan in under 2 minutes!**

GuardScan is a privacy-first, open-source security scanning and AI code review CLI. All static analysis features work **100% free and offline** - no API keys required!

---

## 📦 Installation

```bash
# Install GuardScan globally
npm install -g guardscan

# Verify installation
guardscan --version
```

**Requirements:**

- Node.js >= 18.0.0
- npm or yarn

---

## 🚀 Quick Start (3 Steps)

### Step 1: Initialize GuardScan

```bash
guardscan init
```

This creates a local configuration file and generates a client ID for optional telemetry.

### Step 2: Run Your First Security Scan

```bash
# Scan your current project (100% FREE, works offline)
guardscan security
```

This will:

- ✅ Detect secrets in your code (API keys, passwords, tokens)
- ✅ Scan dependencies for known vulnerabilities
- ✅ Check Dockerfiles for security issues
- ✅ Analyze Infrastructure as Code (Terraform, CloudFormation, K8s)
- ✅ Detect OWASP Top 10 vulnerabilities
- ✅ Generate a comprehensive markdown report

**No API key needed** - all security scanning works completely offline!

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

GuardScan provides **21 commands** organized by category:

### Setup & Configuration

```bash
guardscan init                    # Initialize GuardScan (generates client_id for telemetry)
guardscan config                  # Configure AI provider and settings (OpenAI, Claude, Gemini, Ollama)
guardscan status                  # Show current status (credits, provider, repo info)
guardscan reset                   # Clear local cache and config
```

### Security & Scanning (Offline-Capable, 100% FREE)

```bash
guardscan security                # Security vulnerability scanning
guardscan scan                    # Comprehensive scan (all security and quality checks)
guardscan test                    # Run tests and code quality analysis
guardscan sbom                    # Generate Software Bill of Materials (SBOM)
guardscan rules                   # Run custom YAML-based rules engine
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

---

## 💡 Common Use Cases

### Security Audit Before Deployment

```bash
# Run comprehensive security scan
guardscan security

# Check for dependency vulnerabilities
guardscan security --licenses

# Generate SBOM for compliance
guardscan sbom --format spdx
```

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
- ✅ Never uploads source code to any server
- ✅ Works **completely offline** for static analysis
- ✅ Uses your own AI API keys (BYOK - Bring Your Own Key)

### What GuardScan Sends (Optional Telemetry)

- Client ID (anonymous identifier)
- Repository ID (hashed, anonymous)
- Lines of code count
- Command usage statistics

**You can disable telemetry:**

```bash
guardscan --no-telemetry security
```

---

## 🎯 How It Works

### Offline-First Architecture

**Static Analysis** (Works completely offline, 100% FREE):

- Secrets detection (20+ patterns)
- Dependency vulnerability scanning
- Code metrics and complexity analysis
- LOC counting (20+ languages)
- OWASP Top 10 detection
- Docker security scanning
- Infrastructure as Code analysis

**AI-Enhanced** (Optional, requires your API key):

- OpenAI GPT-4, GPT-3.5
- Anthropic Claude (Opus, Sonnet, Haiku)
- Google Gemini
- Ollama (local/offline AI)
- LM Studio (local AI)

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
3. ✅ **Scan**: `guardscan security` (works offline, 100% free!)
4. ✅ **Configure AI** (optional): `guardscan config`
5. ✅ **Explore**: Try `guardscan --help` to see all commands

**That's it! You're ready to start scanning your code for security issues.**

---
