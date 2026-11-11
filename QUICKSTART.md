# GuardScan Quick Start

A one-page cheat sheet. For the full walkthrough see [Getting Started](docs/GETTING_STARTED.md); for install options see [Install, upgrade and uninstall](docs/INSTALL.md).

## Install and first scan

```bash
npm install -g guardscan   # Node.js 22+
guardscan init
guardscan security --offline --no-cve
```

Homebrew, Scoop, pipx and standalone binaries (Node.js bundled) are also available, and WinGet and Chocolatey follow once their moderation accepts the package; see [docs/INSTALL.md](docs/INSTALL.md).

## Optional: add AI review (bring your own key)

```bash
guardscan config                       # choose a provider and enter a key
guardscan config --provider ollama     # or a local model, no key
guardscan run
```

## 📋 Available Commands

```text
guardscan init                  Initialize local configuration
guardscan config                Configure AI provider, privacy and local settings
guardscan status                Show provider, repository and local status
guardscan reset                 Clear local context and cache
guardscan security              Local heuristic security checks
guardscan scan                  Security, quality and SBOM scan in parallel
guardscan vuln                  Exact-version dependency vulnerabilities via OSV (aliases: cve, audit)
guardscan run                   Local review with optional AI enrichment
guardscan test                  Run tests and code quality analysis
guardscan sbom                  Generate an SBOM (SPDX or CycloneDX)
guardscan perf                  Performance testing
guardscan mutation              Mutation testing
guardscan rules                 Custom YAML rule engine
guardscan review                AI review of git changes
guardscan explain               Explain code
guardscan commit                Generate commit messages
guardscan docs                  Generate documentation
guardscan test-gen              Generate tests
guardscan refactor              Refactoring suggestions
guardscan threat-model          STRIDE threat modeling
guardscan migrate               Code migration assistant
guardscan chat                  Interactive Q&A about the codebase
guardscan models                List and compare AI models
guardscan routing               Model routing per task
guardscan budget                AI spending budgets
guardscan metrics               AI operation metrics
guardscan cache                 Inspect or clear local caches
guardscan telemetry             Inspect or sync opt-in telemetry
guardscan capabilities          Optional runtime capabilities
```

---

## Common recipes

```bash
guardscan scan --ci --format sarif --output guardscan.sarif --fail-on high
guardscan vuln . --offline                 # reuse a prepared snapshot
guardscan review --file src/index.ts       # AI review of one file
guardscan config --telemetry=false         # telemetry is already off by default
```

Exit codes: `0` passed, `1` policy violated, `2` required coverage failed or the command itself errored (for `scan`, `security`, `vuln`, `run`). See [COMMANDS.md](docs/COMMANDS.md#exit-codes).

## More

[Command reference](docs/COMMANDS.md) · [Offline mode and CI](docs/OFFLINE_AND_CI.md) · [Vulnerability scanning](docs/VULNERABILITY_SCANNING.md) · [Docker](docs/DOCKER_GUIDE.md) · [Languages](docs/LANGUAGE_PARSERS.md)
