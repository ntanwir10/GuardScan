# Changelog

All notable changes to GuardScan will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-11-17

### Initial Release

GuardScan - 100% Free & Open Source Privacy-First Security Scanning and AI Code Review CLI

#### Features

**Security Scanning (FREE, Offline)**

- Secrets detection with 20+ patterns (API keys, passwords, tokens)
- Dependency vulnerability scanning (npm, pip, Maven, Cargo)
- OWASP Top 10 detection (SQL injection, XSS, CSRF, XXE, etc.)
- Docker security scanning
- Infrastructure as Code security (Terraform, CloudFormation, Kubernetes)
- API security analysis (REST and GraphQL)

**Code Quality & Analysis (FREE, Offline)**

- Code metrics (cyclomatic complexity, Halstead metrics, maintainability index)
- Code smell detection (30+ anti-patterns)
- License compliance checking
- Compliance scanning (GDPR, HIPAA, PCI-DSS)
- Linter integration (ESLint, Pylint, RuboCop)
- LOC counter (20+ languages)

**Testing & Performance (FREE, Offline)**

- Test runner integration (Jest, pytest, JUnit)
- Mutation testing
- Performance testing and benchmarking
- SBOM generation (CycloneDX, SPDX formats)

**AI-Enhanced Features (BYOK - Bring Your Own Key)**

- Code explainer (`guardscan explain`)
- AI code review (`guardscan review`)
- Commit message generator (`guardscan commit`)
- Documentation generator (`guardscan docs`)
- Test generator (`guardscan test-gen`)
- Refactoring suggestions (`guardscan refactor`)
- Threat modeling (`guardscan threat-model`)
- Migration assistant (`guardscan migrate`)
- Interactive RAG-powered chat (`guardscan chat`)

**Supported AI Providers**

- OpenAI (GPT-4, GPT-3.5)
- Anthropic Claude (Claude 3 Opus, Sonnet, Haiku)
- Google Gemini
- Ollama (local/offline models)

#### Technical Details

- Node.js >= 18.0.0 required
- Privacy-first architecture (never uploads source code)
- Works completely offline for static analysis
- MIT License

---

## Future Releases

See [GitHub Releases](https://github.com/ntanwir10/GuardScan/releases) for upcoming versions.
T
