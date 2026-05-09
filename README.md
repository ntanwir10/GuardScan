# 🛡️ GuardScan

**100% Free & Open Source** • Privacy-First Security Scanning and AI Code Review CLI

```
  ____ _   _   _    ____  ____    ____   ____    _    _   _            ____ _     ___ 
 / ___| | | | / \  |  _ \|  _ \  / ___| / ___|  / \  | \ | |          / ___| |   |_ _|
| |  _| | | |/ _ \ | |_) | | | | \___ \| |     / _ \ |  \| |  _____  | |   | |    | |
| |_| | |_| / ___ \|  _ <| |_| |  ___) | |___ / ___ \| |\  | |_____| | |___| |___ | | 
 \____|\___/_/   \_\_| \_\____/  |____/ \____/_/   \_\_| \_|          \____|_____|___|

 Privacy-First AI Code Review & Security Scanning
```

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)

---

## 🎉 Completely Free - No Subscriptions, No Limits

GuardScan is **100% free and open source**! No credit system, no paywalls, no subscriptions.

### What You Get (All FREE)

- ✅ **Unlimited static analysis** - 9 security scanners + code quality tools
- ✅ **AI-enhanced code review** - Bring your own API key (OpenAI, Claude, Gemini, Ollama)
- ✅ **Works fully offline** - No internet required for static analysis
- ✅ **Privacy-first** - Never uploads your source code
- ✅ **No usage limits** - Scan unlimited LOC, unlimited repositories

---

## 🚀 Quick Start

```bash
# Install globally via npm
npm install -g guardscan

# Initialize GuardScan
guardscan init

# Run comprehensive security scan (100% FREE, offline)
guardscan security

# Configure AI provider for enhanced review (optional, BYOK)
guardscan config

# Run AI-enhanced code review
guardscan run

# Check status
guardscan status
```

### 🐳 Docker / Alpine Linux

For Docker environments, especially Alpine Linux:

```bash
# Install dependencies first
apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
  libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git

# Install GuardScan
npm install -g guardscan

# Set home directory (important for Docker)
export GUARDSCAN_HOME=/app/.guardscan

# Initialize
guardscan init
```

**Documentation:**

- 📖 [Comprehensive Docker Guide](./docs/DOCKER_GUIDE.md) - Complete guide for Linux, macOS, and Windows
- 🐧 [Docker & Alpine Quick Reference](./docs/DOCKER_ALPINE_GUIDE.md) - Alpine Linux-specific quick reference

---

## 📋 Core Features

### 🔒 Security Scanning (FREE, Offline)

GuardScan includes **comprehensive security scanners**:

1. **Secrets Detection** - Find hardcoded API keys, passwords, tokens (20+ patterns)
2. **Dependency Vulnerabilities** - Scan npm, pip, Maven, Cargo dependencies
3. **OWASP Top 10** - SQL injection, XSS, insecure configs, CSRF, XXE
4. **Docker Security** - Dockerfile and container scanning
5. **Infrastructure as Code** - Terraform, CloudFormation, Kubernetes security
6. **API Security** - REST and GraphQL endpoint analysis

### 📊 Code Quality & Analysis (FREE, Offline)

7. **Code Metrics** - Cyclomatic complexity, Halstead metrics, maintainability index
8. **Code Smells** - 30+ anti-patterns (god classes, long methods, magic numbers)
9. **License Compliance** - Check dependency licenses (MIT, GPL, Apache, etc.)
10. **Compliance Checks** - GDPR, HIPAA, PCI-DSS compliance scanning
11. **Linter Integration** - ESLint, Pylint, RuboCop, etc.
12. **LOC Counter** - Language-aware line counting (20+ languages)

### 🧪 Testing & Performance (FREE, Offline)

13. **Test Runner** - Execute and analyze Jest, pytest, JUnit tests
14. **Mutation Testing** - Validate test suite effectiveness (requires Stryker - optional)
15. **Performance Testing** - Load testing and benchmarking (requires k6 - optional)
16. **SBOM Generation** - Software Bill of Materials (CycloneDX, SPDX)

**Note**: Performance and mutation testing require optional external tools.

### 🤖 AI-Enhanced Features (BYOK - Bring Your Own Key)

**9 Advanced AI-Powered Features:**

1. **Code Explainer** (`guardscan explain`) - Understand complex code
2. **Code Review** (`guardscan review`) - Comprehensive AI code review
3. **Commit Generator** (`guardscan commit`) - Generate commit messages
4. **Docs Generator** (`guardscan docs`) - Auto-generate documentation
5. **Test Generator** (`guardscan test-gen`) - Generate unit tests
6. **Refactoring Suggestions** (`guardscan refactor`) - Improve code quality
7. **Threat Modeling** (`guardscan threat-model`) - Security architecture analysis
8. **Migration Assistant** (`guardscan migrate`) - Framework/language migrations
9. **Interactive Chat** (`guardscan chat`) - RAG-powered codebase Q&A

### 🌍 Multi-Language Support

**AST Parsers for 7+ Languages:**

- TypeScript/JavaScript
- Python
- Java
- Go
- Rust
- Ruby
- PHP
- C#

### 🔌 AI Provider Integrations

Configure any AI provider you prefer:

- **OpenAI** (GPT-4, GPT-4 Turbo, GPT-3.5)
- **Anthropic Claude** (Claude 3 Opus, Sonnet, Haiku)
- **Google Gemini** (Gemini Pro)
- **Ollama** (Local, privacy-focused - llama2, codellama, mistral)
- **LM Studio** (Local models)
- **OpenRouter** (Access to multiple models)

**You pay the AI provider directly** - GuardScan charges nothing!

---

## 🛠️ Commands

All commands are **100% FREE** with no limits!

### Configuration Commands

| Command            | Description                           |
| ------------------ | ------------------------------------- |
| `guardscan init`   | Initialize config, generate client_id |
| `guardscan config` | Configure AI provider & settings      |
| `guardscan status` | Show configuration and repo info      |
| `guardscan reset`  | Clear local cache & config            |

### Security & Analysis Commands

| Command              | Description                               |
| -------------------- | ----------------------------------------- |
| `guardscan security` | Run comprehensive security scan (offline) |
| `guardscan scan`     | Quick security scan                       |
| `guardscan run`      | AI-enhanced full code review (BYOK)       |

### Testing & Quality Commands

| Command              | Description                                                     |
| -------------------- | --------------------------------------------------------------- |
| `guardscan test`     | Run tests & code quality analysis                               |
| `guardscan perf`     | Performance testing & load testing (requires k6 - optional)     |
| `guardscan mutation` | Mutation testing for test quality (requires Stryker - optional) |

**Note**: `perf` and `mutation` commands require optional external tools. See [Testing Tools Guide](./cli/docs/TESTING_TOOLS.md) for installation and usage details.

### Utility Commands

| Command           | Description                         |
| ----------------- | ----------------------------------- |
| `guardscan sbom`  | Generate Software Bill of Materials |
| `guardscan rules` | Custom YAML-based rule engine       |

### AI-Powered Commands (BYOK)

| Command                     | Description                          |
| --------------------------- | ------------------------------------ |
| `guardscan explain <file>`  | Explain how code works               |
| `guardscan review <file>`   | Comprehensive AI code review         |
| `guardscan commit`          | Generate commit messages             |
| `guardscan docs <file>`     | Auto-generate documentation          |
| `guardscan test-gen <file>` | Generate unit tests                  |
| `guardscan refactor <file>` | Get refactoring suggestions          |
| `guardscan threat-model`    | Security architecture analysis       |
| `guardscan migrate`         | Framework/language migration help    |
| `guardscan chat`            | Interactive Q&A about codebase (RAG) |

---

## 🔒 Privacy Guarantees

We take privacy seriously:

### ❌ Never Stored or Transmitted

- Your source code
- File paths or file names
- Code snippets
- API keys or secrets
- Proprietary information

### ✅ Optional Telemetry (Anonymized)

- Command usage (e.g., "security" command ran)
- Execution duration
- LOC count (aggregate number only)
- AI model used (e.g., "gpt-4")

**Telemetry is:**

- Optional (easily disabled: `guardscan config --telemetry=false`)
- Completely anonymized
- Only used to improve GuardScan
- Never sold or shared

---

## 🎯 How It Works

### Static Analysis (Offline, No AI)

```bash
guardscan security
```

Runs **9 security scanners** locally:

- Scans your codebase
- Generates markdown report
- **100% offline** - no internet needed
- **100% free** - no limits

### AI-Enhanced Review (Your API Key)

```bash
# Step 1: Configure your AI provider (one-time)
guardscan config
# Choose provider: OpenAI, Claude, Gemini, Ollama
# Enter your API key

# Step 2: Run AI review
guardscan run
```

How it works:

1. GuardScan analyzes your code locally
2. Sends anonymized context to **your AI provider** (using **your API key**)
3. AI provides insights and suggestions
4. Report saved locally

**You pay your AI provider directly** - GuardScan is free!

---

## 💰 Pricing

### GuardScan: **$0** (100% Free)

No credit system. No subscriptions. No paywalls.

### AI Providers (If You Use AI Features)

**You pay them directly (not GuardScan):**

- **OpenAI GPT-4**: ~$0.01-0.03 per 1K tokens
- **Claude Sonnet**: ~$0.003 per 1K tokens
- **Gemini Pro**: Free tier available
- **Ollama**: 100% free (runs locally)

**Example costs for 10K LOC codebase:**

- Static analysis only: **$0**
- With OpenAI GPT-4: **~$2-5** (paid to OpenAI)
- With Ollama (local): **$0**

---

## 🏗️ Architecture

GuardScan follows a **privacy-first, client-side architecture** where all code analysis happens locally.

```
┌─────────────────────────────────────────────────────────────┐
│                    USER'S MACHINE                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         GuardScan CLI (Node.js/TypeScript)          │   │
│  │                                                      │   │
│  │  • 21 Commands (security, run, test, explain...)    │   │
│  │  • 30 Core Modules (scanners, parsers, metrics)     │   │
│  │  • 9 AI Features (explain, review, test-gen, etc.)  │   │
│  │  • 7 Language Parsers (Python, Java, Go, Rust...)   │   │
│  │  • 6 AI Provider Integrations                       │   │
│  │                                                      │   │
│  │  Config: ~/.guardscan/config.yml                   │   │
│  │  Cache: ~/.guardscan/cache/                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           │ Optional telemetry only          │
│                           ▼                                  │
└───────────────────────────────────────────────────────────────┘
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
│  User's API Key →        │  │  • NO source code        │
│  User's billing →        │  │  • NO credit validation  │
└──────────────────────────┘  └──────────────────────────┘
```

### Technology Stack

**CLI (34,213 LOC):**

- Language: TypeScript 5.3+ (strict mode)
- Runtime: Node.js 18+
- Framework: Commander.js
- Testing: Jest (70%+ coverage)
- Build: TypeScript Compiler (tsc)

**Monitoring service (separate repo, optional):**

- Lives in [ntanwir10/GuardScan-Monitoring](https://github.com/ntanwir10/GuardScan-Monitoring)
- Platform: Cloudflare Workers + Supabase PostgreSQL
- Purpose: Anonymous telemetry and error/usage analytics
- The CLI talks to it over HTTP only; override the URL with `GUARDSCAN_API_URL`

---

## 📦 Installation

### Via NPM (Recommended)

```bash
npm install -g guardscan
```

### Via Source

```bash
# Clone repository
git clone https://github.com/ntanwir10/GuardScan.git
cd GuardScan/cli

# Install dependencies
npm install

# Build
npm run build

# Link globally
npm link

# Verify
guardscan --help
```

---

## 🤝 Contributing

GuardScan is **open source** and we welcome contributions!

- **Report bugs**: [GitHub Issues](https://github.com/ntanwir10/GuardScan/issues)
- **Request features**: [GitHub Issues](https://github.com/ntanwir10/GuardScan/issues)
- **Submit PRs**: See [CONTRIBUTING.md](docs/CONTRIBUTING.md)

---

## 📚 Documentation

- [Installation Guide](docs/GETTING_STARTED.md)
- [Configuration Guide](docs/CONFIGURATION.md)
- [Chat Guide](docs/CHAT_GUIDE.md)
- [API Documentation](docs/API.md)
- [Security Scanners](docs/SECURITY_SCANNERS.md)
- [Contributing Guidelines](docs/CONTRIBUTING.md)

---

## ❓ FAQ

**Q: Is GuardScan really free?**
A: Yes! 100% free, no credit system, no subscriptions, no limits.

**Q: Do I need to create an account?**
A: No! Just `npm install -g guardscan` and run `guardscan init`.

**Q: Do I need an AI API key?**
A: Only if you want AI-enhanced review. Static analysis (9 security scanners) works without any API key.

**Q: Which AI provider should I use?**
A: Your choice! OpenAI (powerful), Claude (balanced), Gemini (affordable), Ollama (free, local).

**Q: Does GuardScan upload my code?**
A: **Never**. GuardScan only uploads anonymized metadata for optional telemetry.

**Q: Can I disable telemetry?**
A: Yes! Run `guardscan config --telemetry=false` or set `telemetryEnabled: false` in `~/.guardscan/config.yml`.

**Q: How do I support this project?**
A: Star the repo on GitHub, contribute code, report bugs, or sponsor the project!

---

## 📝 License

MIT License - see [LICENSE](LICENSE)

---

## 🙏 Acknowledgments

GuardScan is built with these amazing open-source tools:

- [Commander.js](https://github.com/tj/commander.js) - CLI framework
- [Chalk](https://github.com/chalk/chalk) - Terminal styling
- [Axios](https://github.com/axios/axios) - HTTP client
- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless backend
- [Supabase](https://supabase.com/) - Open-source Firebase alternative

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/ntanwir10/GuardScan/issues)
- **Discussions**: [GitHub Discussions](https://github.com/ntanwir10/GuardScan/discussions)
- **Email**: <support@guardscan.com> (coming soon)

---

<div align="center">

**Made with ❤️ by developers, for developers**

[⭐ Star us on GitHub](https://github.com/ntanwir10/GuardScan) • [🐛 Report Bug](https://github.com/ntanwir10/GuardScan/issues) • [💡 Request Feature](https://github.com/ntanwir10/GuardScan/issues)

</div>
