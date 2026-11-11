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
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)

---

## 🎉 Completely Free - No Subscriptions, No Limits

GuardScan is **100% free and open source**! No credit system, no paywalls, no subscriptions.

### What You Get (All FREE)

- ✅ **Unlimited static analysis** - 9 security scanners + code quality tools
- ✅ **AI-enhanced code review** - Bring your own API key (OpenAI, Claude, Gemini, OpenRouter, or local Ollama/LM Studio)
- ✅ **Offline-first static analysis** - Local scanners and SBOM inventory run without internet; CVEs can reuse a fresh matching snapshot
- ✅ **Privacy-first** - GuardScan does not upload your source code to GuardScan servers
- ✅ **No usage limits** - Scan unlimited LOC, unlimited repositories

---

## 🚀 Quick Start

```bash
# Install globally via npm (Node.js 22+)
npm install -g guardscan

# Initialize GuardScan
guardscan init

# Run comprehensive security scan (100% FREE, offline-first)
guardscan security

# Audit exact dependency versions against OSV (online)
guardscan config --offline=false
guardscan vuln .

# Configure AI provider for enhanced review (optional, BYOK)
guardscan config

# Run AI-enhanced code review
guardscan run

# Check status
guardscan status
```

### 🐳 Docker / Alpine Linux

No GuardScan Docker image is published; run the npm package inside a Node.js 22+ base image. See the [Docker guide](https://github.com/ntanwir10/GuardScan/blob/main/docs/DOCKER_GUIDE.md) for Alpine setup, `GUARDSCAN_HOME`, volumes and CI.

---

## 📋 Core Features

### 🔒 Security Scanning (FREE, Offline-First)

GuardScan includes **comprehensive security scanners**:

1. **Secrets Detection** - Find hardcoded API keys, passwords, tokens (20+ patterns)
2. **Dependency Vulnerabilities** - Scan exact npm, PyPI, Go, RubyGems, Cargo, and Maven versions with OSV; reuse fresh snapshots offline
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

**AST Parsers for 8 Languages:**

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

- **OpenAI**
- **Anthropic Claude**
- **Google Gemini**
- **Ollama** (local, privacy-focused)
- **LM Studio** (local models)
- **OpenRouter** (access to multiple models)

Run `guardscan models list` for the current model catalog.

**You pay the AI provider directly** - GuardScan charges nothing!

---

## 🛠️ Commands

All commands are **100% FREE** with no limits!

### Configuration Commands

| Command            | Description                           |
| ------------------ | ------------------------------------- |
| `guardscan init`   | Initialize local configuration        |
| `guardscan config` | Configure AI provider & settings      |
| `guardscan status` | Show configuration and repo info      |
| `guardscan reset`  | Clear local cache & config            |

### Security & Analysis Commands

| Command              | Description                               |
| -------------------- | ----------------------------------------- |
| `guardscan security` | Run comprehensive local security scan      |
| `guardscan scan`     | Static-safe security, quality, and SBOM scan |
| `guardscan vuln`     | Audit exact dependency versions with OSV  |
| `guardscan run`      | Required local review with optional AI enrichment |

Dependency scanning details, offline snapshots, severity limitations, and CI examples are documented in [Dependency Vulnerability Scanning](https://github.com/ntanwir10/GuardScan/blob/main/docs/VULNERABILITY_SCANNING.md).

### CI output and exit codes

```bash
guardscan security --ci --format json --output guardscan.json --fail-on high
guardscan security --format sarif --output guardscan.sarif
```

Structured scan output uses the `guardscan.scan.v1` envelope and includes security, quality, SBOM, AI, scanner status, errors, and policy state. Exit code `0` means the run and policy passed, `1` means findings violated policy, and `2` means scanner coverage or execution failed. `--allow-partial` is an explicit relaxation for incomplete coverage. See the [exit-code table](https://github.com/ntanwir10/GuardScan/blob/main/docs/COMMANDS.md#exit-codes) and [Offline mode and CI](https://github.com/ntanwir10/GuardScan/blob/main/docs/OFFLINE_AND_CI.md).

`guardscan scan` does not execute repository-controlled tests or linters by default. Use
`--run-project-code` only for a trusted repository; reports record whether they are
`static-analysis` or `project-code-executed`. Child processes receive a scrubbed
environment and isolated home. `--isolate-project-network` additionally requests an
OS-backed network sandbox and fails the affected checks if the platform sandbox is unavailable.

### Testing & Quality Commands

| Command              | Description                                                     |
| -------------------- | --------------------------------------------------------------- |
| `guardscan test`     | Run tests & code quality analysis                               |
| `guardscan perf`     | Performance testing & load testing (requires k6 - optional)     |
| `guardscan mutation` | Mutation testing for test quality (requires Stryker - optional) |

**Note**: `perf` and `mutation` commands require optional external tools. See the [Testing Tools Guide](https://github.com/ntanwir10/GuardScan/blob/main/cli/docs/TESTING_TOOLS.md) for installation and usage details.

### Utility Commands

| Command           | Description                         |
| ----------------- | ----------------------------------- |
| `guardscan sbom`  | Generate schema-valid SPDX 2.3 or CycloneDX 1.7 |
| `guardscan rules` | Custom YAML-based rule engine       |
| `guardscan cache` | Inspect or clear local AI caches     |
| `guardscan telemetry` | Inspect, sync, or clear opt-in telemetry |
| `guardscan capabilities` | Inspect optional runtime capabilities and safe fallbacks |

### AI-Powered Commands (BYOK)

| Command                     | Description                          |
| --------------------------- | ------------------------------------ |
| `guardscan explain <target>`        | Explain how code works               |
| `guardscan review --file <path>`    | Comprehensive AI code review         |
| `guardscan commit`                  | Generate commit messages             |
| `guardscan docs --type <type>`      | Auto-generate documentation          |
| `guardscan test-gen --file <path>`  | Generate unit tests                  |
| `guardscan refactor --file <path>`  | Get refactoring suggestions          |
| `guardscan threat-model`            | Security architecture analysis       |
| `guardscan migrate`                 | Framework/language migration help    |
| `guardscan chat`                    | Interactive Q&A about codebase (RAG) |

---

## 🔒 Privacy Guarantees

We take privacy seriously:

### ❌ No GuardScan-Hosted Processing

- Your source code
- File paths or file names
- Code snippets
- API keys or secrets
- Proprietary information

Local AI/RAG features can store prompts, responses, file paths, and code-derived snippets in your machine's `~/.guardscan/cache` for caching and retrieval. Use `guardscan cache clear --repo --force` or `guardscan cache clear --all --force` to remove cached source-derived data.

### ✅ Opt-In Aggregate Telemetry

- Command usage (e.g., "security" command ran)
- Execution duration
- LOC count (aggregate number only)
- Coarse execution mode (static, local AI, or cloud AI)

**Telemetry is:**

- Disabled by default and explicitly enabled with `guardscan config --telemetry=true`
- Queued locally only after consent
- Sent only by `guardscan telemetry sync` to a user-operated endpoint selected
  with `GUARDSCAN_TELEMETRY_URL`
- Recording and delivery are suppressed by offline mode or `--no-telemetry`
- Never sent to a GuardScan-hosted collector; GuardScan operates no telemetry
  ingestion service
- Strictly allowlisted; malformed or unknown persisted fields are quarantined locally and never sent
- Retained through bounded maintenance (newest 1,000 events, 30 days, 20 quarantine artifacts)
- Serialized across processes during explicit synchronization

See the [Privacy Policy](https://github.com/ntanwir10/GuardScan/blob/main/PRIVACY.md) for the exact event allowlist and local retention behavior.

---

## 🎯 How It Works

### Static Analysis (Offline-First, No AI)

```bash
guardscan security
```

Runs **9 security scanners** locally:

- Scans your codebase
- Generates markdown report
- **Offline-first** - local scanners and local SBOM inventory run without internet; CVE results require either OSV access or a fresh matching snapshot
- **100% free** - no limits

### AI-Enhanced Review (Your API Key)

```bash
# Step 1: Configure your AI provider (one-time)
guardscan config
# Choose provider: openai, claude, gemini, openrouter, ollama, lmstudio
# Enter your API key

# Step 2: Run AI review
guardscan run
```

How it works:

1. GuardScan runs its required local security and quality analysis.
2. If configured, it sends selected source-derived context to **your AI provider** using **your API key**.
3. AI findings enrich the local report; they never replace scanner coverage.
4. Incomplete required coverage is recorded in the report and exits with code `2`.
5. The report is saved locally.

**You pay your AI provider directly** - GuardScan is free!

---

## 💰 Costs

GuardScan is free. If you use AI features you pay your AI provider directly through your own account; GuardScan has no billing, credits, or hosted service. Ollama and LM Studio are local in offline mode only at literal `127/8` or `::1` endpoints (remote self-hosted endpoints require online mode and `allowRemoteSelfHosted: true`). Static analysis does not require an AI provider.

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
│  │  • 29 Commands (security, vuln, run, test...)       │   │
│  │  • 30 Core Modules (scanners, parsers, metrics)     │   │
│  │  • 9 AI Features (explain, review, test-gen, etc.)  │   │
│  │  • 8 Language Parsers (Python, Java, Go, Rust...)   │   │
│  │  • 6 AI Provider Integrations                       │   │
│  │                                                      │   │
│  │  Config: ~/.guardscan/config.yml                   │   │
│  │  Cache: ~/.guardscan/cache/                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           │ Explicit network actions only     │
│                           ▼                                  │
└───────────────────────────────────────────────────────────────┘
                            │
                ┌───────────┴──────────┐
                │                      │
                ▼                      ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│  User's AI Provider      │  │  User-operated HTTPS     │
│  (User pays directly)    │  │  telemetry endpoint      │
│                          │  │                          │
│  • OpenAI                │  │  • Explicit sync only    │
│  • Anthropic             │  │  • Aggregate allowlist   │
│  • Google Gemini         │  │  • No default endpoint   │
│  • Ollama/LM Studio      │  │  • No source or findings │
│  User's API Key →        │  │  • NO source code        │
│  User controls billing   │  │  • Optional telemetry    │
└──────────────────────────┘  └──────────────────────────┘
```

### Technology Stack

**CLI:**

- Language: TypeScript 5.3+ (strict mode)
- Runtime: Node.js 22+
- Framework: Commander.js
- Testing: Jest with enforced coverage thresholds
- Build: TypeScript Compiler (tsc)

**Self-hosted telemetry collector (optional):**

- GuardScan does not operate a hosted telemetry collector or provide a default
  endpoint.
- Operators may deploy their own compatible HTTPS collector.
- Delivery occurs only through `guardscan telemetry sync` after setting `GUARDSCAN_TELEMETRY_URL`.
- The payload is the strict aggregate event allowlist described in [PRIVACY.md](https://github.com/ntanwir10/GuardScan/blob/main/PRIVACY.md); errors and findings are excluded.

---

## 📦 Installation

```bash
npm install -g guardscan
guardscan --version
```

The npm install requires Node.js 22 or newer and installs its runtime dependencies (including `typescript`, needed for AST parsing) automatically. If you see "Cannot find module 'typescript'", reinstall GuardScan.

pnpm, Yarn and Bun are also supported (Node.js 22 or newer). Homebrew, Scoop, pipx and standalone binaries (Node.js bundled) are also available, and WinGet and Chocolatey follow once their moderation accepts the package. See the [install, upgrade and uninstall guide](https://github.com/ntanwir10/GuardScan/blob/main/docs/INSTALL.md) for every channel.

### From source

```bash
git clone https://github.com/ntanwir10/GuardScan.git
cd GuardScan/cli
npm ci
npm run build
npm link
guardscan --help
```

---

## 🤝 Contributing

GuardScan is **open source** and we welcome contributions!

- **Report bugs**: [GitHub Issues](https://github.com/ntanwir10/GuardScan/issues)
- **Request features**: [GitHub Issues](https://github.com/ntanwir10/GuardScan/issues)
- **Submit PRs**: Open a focused pull request with tests and a clear rationale

---

## 📚 Documentation

Website: <https://guardscancli.vercel.app>

- [Getting started](https://github.com/ntanwir10/GuardScan/blob/main/docs/GETTING_STARTED.md)
- [Install, upgrade and uninstall](https://github.com/ntanwir10/GuardScan/blob/main/docs/INSTALL.md)
- [Command reference](https://github.com/ntanwir10/GuardScan/blob/main/docs/COMMANDS.md) (every command, flag and exit code)
- [Offline mode and CI](https://github.com/ntanwir10/GuardScan/blob/main/docs/OFFLINE_AND_CI.md)
- [Chat guide](https://github.com/ntanwir10/GuardScan/blob/main/docs/CHAT_GUIDE.md) and [AI quick reference](https://github.com/ntanwir10/GuardScan/blob/main/docs/AI_QUICK_REFERENCE.md)
- [Dependency vulnerability scanning](https://github.com/ntanwir10/GuardScan/blob/main/docs/VULNERABILITY_SCANNING.md)
- [Docker guide](https://github.com/ntanwir10/GuardScan/blob/main/docs/DOCKER_GUIDE.md)
- [Language parsers](https://github.com/ntanwir10/GuardScan/blob/main/docs/LANGUAGE_PARSERS.md)
- [Self-hosted telemetry collector protocol](https://github.com/ntanwir10/GuardScan/blob/main/docs/TELEMETRY_COLLECTOR.md)
- [Privacy](https://github.com/ntanwir10/GuardScan/blob/main/PRIVACY.md), [Terms](https://github.com/ntanwir10/GuardScan/blob/main/TERMS.md), [Security policy](https://github.com/ntanwir10/GuardScan/blob/main/SECURITY.md)

---

## ❓ FAQ

**Q: Is GuardScan really free?**
A: Yes! 100% free, no credit system, no subscriptions, no limits.

**Q: Do I need to create an account?**
A: No! Just `npm install -g guardscan` and run `guardscan init`.

**Q: Do I need an AI API key?**
A: Only if you want AI-enhanced review. Static analysis (9 security scanners) works without any API key.

**Q: Which AI provider should I use?**
A: Your choice: OpenAI, Claude, Gemini, OpenRouter, or local Ollama/LM Studio. Static analysis needs no provider at all.

**Q: Does GuardScan upload my code?**
A: GuardScan does not upload source code to GuardScan servers. If you enable AI features, prompts are sent directly to your configured provider; local caches may store prompts/responses on your machine.

**Q: Can I disable telemetry?**
A: Yes. Telemetry is disabled by default. `guardscan config --telemetry=false` persists the setting and deletes queued events, while `--no-telemetry` suppresses one invocation.

**Q: How do I support this project?**
A: Star the repo on GitHub, contribute code, report bugs, or sponsor the project!

---

## 📝 License

MIT License - see [LICENSE](https://github.com/ntanwir10/GuardScan/blob/main/LICENSE)

---

## 🙏 Acknowledgments

GuardScan is built with these amazing open-source tools:

- [Commander.js](https://github.com/tj/commander.js) - CLI framework
- [Chalk](https://github.com/chalk/chalk) - Terminal styling
- [Axios](https://github.com/axios/axios) - HTTP client
- [OSV](https://osv.dev/) - Open vulnerability data and package-version queries

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/ntanwir10/GuardScan/issues)
- **Discussions**: [GitHub Discussions](https://github.com/ntanwir10/GuardScan/discussions)
- **Security reports**: see the [security policy](https://github.com/ntanwir10/GuardScan/blob/main/SECURITY.md)

---

<div align="center">

**Made with ❤️ by developers, for developers**

[⭐ Star us on GitHub](https://github.com/ntanwir10/GuardScan) • [🐛 Report Bug](https://github.com/ntanwir10/GuardScan/issues) • [💡 Request Feature](https://github.com/ntanwir10/GuardScan/issues)

</div>
