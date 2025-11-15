# 🛡️ GuardScan

**100% Free & Open Source** • Privacy-First Security Scanning and AI Code Review CLI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)

---

## 🎉 Completely Free - No Subscriptions, No Limits

GuardScan is **100% free and open source**! No credit system, no paywalls, no subscriptions.

### What You Get (All FREE):

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

---

## 📋 Core Features

### Security Scanning (FREE, Offline)

GuardScan includes **9 comprehensive security scanners**:

1. **Secrets Detection** - Find hardcoded API keys, passwords, tokens
2. **Dependency Vulnerabilities** - Scan npm, pip, Maven dependencies
3. **OWASP Top 10** - SQL injection, XSS, insecure configs
4. **Docker Security** - Dockerfile and container scanning
5. **Infrastructure as Code** - Terraform, CloudFormation, Kubernetes
6. **API Security** - REST and GraphQL endpoint analysis
7. **License Compliance** - Check dependency licenses
8. **Code Quality** - Complexity metrics, code smells
9. **Compliance** - GDPR, HIPAA, PCI-DSS checks

### AI-Enhanced Review (BYOK - Bring Your Own Key)

Configure any AI provider you prefer:

- **OpenAI** (GPT-4, GPT-4 Turbo)
- **Anthropic Claude** (Claude 3 Opus, Sonnet, Haiku)
- **Google Gemini** (Gemini Pro)
- **Ollama** (Local, privacy-focused)
- **LM Studio** (Local models)
- **OpenRouter** (Access to multiple models)

**You pay the AI provider directly** - GuardScan charges nothing!

---

## 🛠️ Commands

| Command | Description | Cost |
|---------|-------------|------|
| `guardscan init` | Initialize config, generate client_id | FREE |
| `guardscan security` | Run 9 security scanners (offline) | FREE |
| `guardscan run` | AI-enhanced code review | FREE (BYOK) |
| `guardscan test` | Run tests & code quality analysis | FREE |
| `guardscan sbom` | Generate Software Bill of Materials | FREE |
| `guardscan perf` | Performance testing & benchmarks | FREE |
| `guardscan mutation` | Mutation testing | FREE |
| `guardscan rules` | Custom YAML-based rule engine | FREE |
| `guardscan config` | Configure AI provider & settings | FREE |
| `guardscan status` | Show configuration and repo info | FREE |
| `guardscan reset` | Clear local cache & config | FREE |

---

## 🔒 Privacy Guarantees

We take privacy seriously:

### ❌ Never Stored or Transmitted:
- Your source code
- File paths or file names
- Code snippets
- API keys or secrets
- Proprietary information

### ✅ Optional Telemetry (Anonymized):
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

### AI Providers (If You Use AI Features):

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

### CLI (Node.js/TypeScript)
- Runs locally on your machine
- No account required
- All security scanning happens offline
- Lightweight and fast

### Backend (Optional, Telemetry Only)
- Cloudflare Workers (serverless)
- Supabase (PostgreSQL)
- **Only for optional, anonymized telemetry**
- **Does NOT store source code**
- **Does NOT validate credits** (no credit system!)

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
- **Email**: support@guardscan.com (coming soon)

---

<div align="center">

**Made with ❤️ by developers, for developers**

[⭐ Star us on GitHub](https://github.com/ntanwir10/GuardScan) • [🐛 Report Bug](https://github.com/ntanwir10/GuardScan/issues) • [💡 Request Feature](https://github.com/ntanwir10/GuardScan/issues)

</div>
