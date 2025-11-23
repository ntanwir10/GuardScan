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

## [1.0.3] - 2025-01-XX

### Fixed

#### Version Checking

- **Version Comparison Bug**: Fixed incorrect update notification showing "Current: 1.0.2 → Latest: 1.0.1" when current version was actually newer. Replaced string comparison with proper semantic version comparison using the `semver` library.
- **Version Source**: Changed version check to use npm registry instead of GitHub releases, ensuring we check against what's actually published and available to users via npm.

### Changed

#### Version Management

- **Semantic Versioning**: Now uses the `semver` library for proper version comparison, handling edge cases like pre-release versions, build metadata, and invalid versions.
- **Update Source**: Version checks now query `https://registry.npmjs.org/guardscan/latest` instead of GitHub releases API for more accurate version information.

#### Backend Configuration

- **Production Deployment**: Updated deployment script to use `--env production` flag when deploying to production, ensuring the API always runs in production mode.

### Technical Details

- **Dependencies**: Added `semver@^7.7.3` and `@types/semver@^7.7.1` for proper semantic version comparison
- **Breaking Changes**: None
- **Migration**: No migration required from v1.0.2

---

## [1.0.2] - 2025-11-22

### Fixed

#### Critical Bug Fixes

- **Config Loading**: Fixed `TypeError: Cannot set properties of undefined (setting 'lastUsed')` when loading empty or invalid YAML configuration files. The system now gracefully reinitializes corrupted config files instead of crashing.
- **Provider Factory Errors**: Fixed "Unknown provider: none" errors across all AI-dependent commands. All commands now properly check for `'none'` provider before attempting to create ProviderFactory instances:
  - `guardscan run`
  - `guardscan docs`
  - `guardscan refactor`
  - `guardscan commit`
  - `guardscan chat`
  - `guardscan test-gen`
  - `guardscan explain`
  - `guardscan review`
  - `guardscan threat-model`
  - `guardscan security`
  - `guardscan migrate`
- **Code Explainer**: Fixed "Class not found" errors in code explanation tests. The `CodebaseIndexer` now caches the index in memory for immediate access after building, eliminating race conditions and disk I/O delays.
- **Directory Creation**: Fixed `ENOENT` errors when writing cache/index files. Both `CodebaseIndexer` and `AICache` now ensure directories exist before writing files using `fs.mkdirSync` with recursive option.

#### Test Fixes

- Fixed Singleton pattern detection test in code-explainer
- Fixed OWASP scanner tests for path traversal, command injection, and insecure random detection
- Fixed injection tests for Windows path traversal and numeric validation
- Fixed refactoring suggestions tests for complexity detection and report generation
- Fixed config lifecycle integration tests
- Fixed E2E tests for non-interactive mode handling
- All 300 tests now passing

### Added

#### Documentation

- **Testing Tools Guide**: Added comprehensive `TESTING_TOOLS.md` documentation explaining:
  - When and why to use k6 for performance testing
  - When and why to use Stryker for mutation testing
  - Installation instructions for all platforms (macOS, Windows, Linux)
  - Decision guides and use case matrices
  - FAQ section addressing common questions
- **Docker Documentation**: Added comprehensive Docker guides:
  - `DOCKER_GUIDE.md` - Complete guide for Linux, macOS, and Windows
  - `DOCKER_ALPINE_GUIDE.md` - Alpine Linux-specific quick reference
- **Performance Guide**: Added `PERFORMANCE.md` with performance profiling, optimization tips, and k6 integration details
- **Debugging Guide**: Added `DEBUGGING.md` with debug logging instructions

#### Developer Experience

- **Debug Logging**: Added comprehensive debug logging utilities for both CLI and backend
- **Performance Tracking**: Added performance profiler to track execution times and memory usage
- **Error Handling**: Added centralized error handling with `handleCommandError` function for consistent error reporting
- **Path Helper**: Added `path-helper.ts` for safe home directory resolution, especially for Docker/Alpine environments
- **Global Options**: Added `--no-telemetry` global option to disable telemetry for any command
- **Command Options**: 
  - Added `--force` option to `guardscan reset` command
  - Added `--from` and `--to` options to `guardscan migrate` command

#### Infrastructure

- **Non-Interactive Mode**: All commands now gracefully handle non-interactive environments (CI/CD) without requiring TTY
- **Config Management**: Improved config lifecycle with `loadOrInit()` pattern for safer configuration handling
- **Cache Management**: Enhanced cache directory creation with proper error handling and recursive directory creation

### Changed

#### Code Quality

- Standardized error handling across all 21 CLI commands
- Improved TypeScript type safety with better null/undefined checks
- Enhanced AST parser to correctly handle more TypeScript export syntaxes
- Improved JSDoc comment parsing to capture both main descriptions and tags
- Refined OWASP scanner detection patterns for better accuracy

#### Performance

- Index caching in `CodebaseIndexer` for faster searches
- Improved directory creation with try-catch error handling
- Better memory management in cache operations

### Technical Details

- **Node.js**: Requires >= 18.0.0 (unchanged)
- **TypeScript**: Strict mode enabled
- **Test Coverage**: 300 tests, all passing
- **Breaking Changes**: None
- **Migration**: No migration required from v1.0.1

---

## Future Releases

See [GitHub Releases](https://github.com/ntanwir10/GuardScan/releases) for upcoming versions.
