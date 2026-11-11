# 🛡️ GuardScan

**Free, open-source, privacy-first security scanning and AI code review CLI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/guardscan)](https://www.npmjs.com/package/guardscan)

GuardScan runs static security and quality scanners locally, audits exact dependency versions against OSV, and optionally adds AI review with **your own** provider key (OpenAI, Claude, Gemini, OpenRouter, or local Ollama/LM Studio). It has no account, no billing and no hosted service, and it does not upload your source code to GuardScan.

Website: <https://guardscancli.vercel.app>

## Quick start

```bash
npm install -g guardscan
guardscan init
guardscan security --offline --no-cve   # local-only scan
guardscan config                        # optional: configure an AI provider
guardscan run                           # local review, with AI enrichment if configured
```

The npm install needs Node.js 22 or newer. Homebrew, Scoop, pipx and standalone binaries (Node.js bundled) are also available, and WinGet and Chocolatey follow once their moderation accepts the package; see [docs/INSTALL.md](docs/INSTALL.md).

## Documentation

The full user guide is the npm package README: **[cli/README.md](cli/README.md)** (also shown at <https://www.npmjs.com/package/guardscan>).

| Topic | Page |
|---|---|
| First steps | [Getting started](docs/GETTING_STARTED.md) |
| Install, upgrade, uninstall | [docs/INSTALL.md](docs/INSTALL.md) |
| Every command, flag and exit code | [docs/COMMANDS.md](docs/COMMANDS.md) |
| Offline mode, `--fail-on`, SARIF, GitHub Actions | [docs/OFFLINE_AND_CI.md](docs/OFFLINE_AND_CI.md) |
| Dependency vulnerability scanning | [docs/VULNERABILITY_SCANNING.md](docs/VULNERABILITY_SCANNING.md) |
| AI chat and providers | [Chat guide](docs/CHAT_GUIDE.md), [AI quick reference](docs/AI_QUICK_REFERENCE.md) |
| Docker | [docs/DOCKER_GUIDE.md](docs/DOCKER_GUIDE.md) |
| Language parsers | [docs/LANGUAGE_PARSERS.md](docs/LANGUAGE_PARSERS.md) |
| Self-hosted telemetry collector | [docs/TELEMETRY_COLLECTOR.md](docs/TELEMETRY_COLLECTOR.md) |
| Architecture decisions | [docs/adrs](docs/adrs/README.md) |
| Quick command cheat sheet | [QUICKSTART.md](QUICKSTART.md) |

Policies: [Privacy](PRIVACY.md) · [Terms](TERMS.md) · [Security](SECURITY.md) · [License](LICENSE)

## AI commands

Syntax reference for the AI-assisted commands (see [docs/COMMANDS.md](docs/COMMANDS.md) for all options):

- `guardscan review --file <path>`: AI code review
- `guardscan docs --type <type>`: generate documentation
- `guardscan test-gen --file <path>`: generate tests
- `guardscan refactor --file <path>`: refactoring suggestions

## Repository layout

| Path | Contents |
|---|---|
| `cli/` | The TypeScript CLI source, tests and the npm package |
| `docs/` | User documentation and architecture decision records |
| `catalog/` | Package-manager catalogs (Homebrew tap and others) used for release |
| `tasks/` | Maintainer working notes |

## Contributing

Report bugs and request features in [GitHub Issues](https://github.com/ntanwir10/GuardScan/issues); ask questions in [Discussions](https://github.com/ntanwir10/GuardScan/discussions). Open a focused pull request with tests and a clear rationale. To build from source:

```bash
cd cli
npm ci
npm run build
npm test
```

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE).
