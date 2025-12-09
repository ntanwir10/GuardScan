# Changelog

All notable changes to GuardScan will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.5] - 2025-12-09

### Added

#### AI Model Selection
- **Model Selection in Configuration**: Added ability to select specific AI models during `guardscan config`:
  - **OpenAI**: Choose from `gpt-5.1`, `gpt-4o`, `gpt-4.1-mini`, `gpt-3.5-turbo`
  - **Claude**: Choose from `claude-opus-4.5`, `claude-sonnet-4.5`, `claude-haiku-4.5`
  - **Gemini**: Choose from `gemini-3-pro`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`
- **Model Override**: Added `--model` flag to override AI model for individual commands

#### Enhanced Chat Experience
- **Improved Chat Output Formatting**: Enhanced `guardscan chat` with rich terminal formatting:
  - Colored file paths (cyan) for better visibility
  - Highlighted inline code snippets (yellow)
  - Formatted code blocks with language labels and borders
  - Bold text styling for emphasis
  - Word wrapping for better readability
  - Structured statistics display with clear formatting
- **Chat Export Functionality**: Added `/export` command to save conversations:
  - Exports to markdown format with full conversation history
  - Automatically saves to parent directory with timestamped filename
  - Includes session metadata and relevant files referenced
  - Format: `guardscan-chat-{sessionId}-{timestamp}.md`
- **Interactive Chat Commands**: Enhanced chat interface with commands:
  - `/help` - Display available commands and example questions
  - `/clear` - Clear conversation history
  - `/stats` - Show session statistics (messages, tokens, duration)
  - `/export` - Export conversation to markdown
  - `/exit` or `/quit` - Exit chat session

#### Documentation
- **Comprehensive Chat Guide**: Added detailed `docs/CHAT_GUIDE.md` covering:
  - RAG (Retrieval-Augmented Generation) explanation
  - Interactive commands and usage
  - CLI options and customization
  - Example use cases and best practices
  - Troubleshooting guide
  - Privacy and security information
- **Updated Getting Started Guide**: Enhanced `docs/GETTING_STARTED.md` with interactive chat section
- **Updated Quick Start**: Added chat commands and export functionality to `QUICKSTART.md`
- **Updated README**: Added references to chat features and new documentation

### Changed

#### AI Provider Updates
- **Updated OpenAI Models**: 
  - Added `gpt-5.1`, `gpt-4o`, `gpt-4.1-mini`
  - Removed deprecated models (`gpt-4-turbo-preview`, `gpt-4-vision-preview`, `gpt-4-32k`)
  - Updated default model to `gpt-4o`
  - Updated pricing for current models
- **Updated Claude Models**:
  - Added `claude-opus-4.5`, `claude-sonnet-4.5`, `claude-haiku-4.5`
  - Removed deprecated models (`claude-3-opus`, `claude-3-sonnet`, `claude-3-haiku`, `claude-2.1`)
  - Updated default model to `claude-sonnet-4.5`
  - Updated pricing for current models
- **Updated Gemini Models**:
  - Added `gemini-3-pro`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`
  - Removed deprecated models (`gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-pro`)
  - Updated `testConnection()` to try multiple models in priority order
  - Enhanced error handling with specific error messages for API key validation
  - Updated pricing for current models

#### Configuration Improvements
- **Enhanced Config Display**: Improved `guardscan config` output with:
  - Numbered section headings for better organization
  - Detailed descriptions for each configuration option
  - Clear status indicators for enabled/disabled features
  - Better visual hierarchy and readability
- **Better Error Messages**: Enhanced error reporting for AI provider connection issues:
  - Specific error messages for invalid API keys
  - Model availability checking with fallback logic
  - Clear instructions for troubleshooting

#### CI/CD Improvements
- **Simplified NPM Publishing**: Updated GitHub Actions workflow:
  - Publish job now only runs on version tags (not on every main branch push)
  - Removed unnecessary dry-run step
  - Simplified conditional logic for better maintainability
- **Updated Node.js Testing**: Changed test matrix to only test on Node.js 20 (removed Node.js 18)

### Fixed

#### Test Suite
- **Fixed Embedding Search Tests**: Resolved TypeScript errors in `embedding-search.test.ts`:
  - Added missing `loadIndex()` method to `MockEmbeddingStore`
  - Added missing `checkCompatibility()` method to `MockEmbeddingStore`
  - Updated `saveEmbeddings()` signature to match interface
- **Fixed Empty Store Handling**: Improved `embedding-search.ts` to properly handle empty embedding stores:
  - Returns empty results instead of throwing error for empty stores
  - Only throws error when embeddings exist but have incompatible dimensions
  - Better error messages for dimension mismatch scenarios

#### Embedding Provider Factory
- **Fixed TypeScript Compilation**: Resolved type error in `embedding-factory.ts`:
  - Fixed `embeddingFallback` type checking logic
  - Improved fallback selection for Claude provider

#### Chat Engine
- **Fixed Model Parameter Passing**: Ensured model selection is properly passed through the entire call chain:
  - Updated `ChatOptions` to include `model` parameter
  - Modified `callAI()` to pass model to AI provider
  - Updated all command files to pass `config.model` to provider factory
  - Fixed `assistantMsg.metadata.modelUsed` to use actual model from API response

### Technical Improvements

#### Code Quality
- All 327 tests passing across 25 test suites
- Improved type safety with proper TypeScript interfaces
- Enhanced error handling throughout the codebase
- Better separation of concerns in provider implementations

#### Architecture
- Consistent model parameter handling across all AI providers
- Improved factory pattern for provider instantiation
- Better metadata tracking for AI responses
- Enhanced session management for chat feature

## [1.0.4] - 2025-11-26

### Fixed

#### TypeScript Compilation Errors

- **Fixed 65 TypeScript Build Errors**: Resolved all TypeScript compilation errors in `ast-parser.ts`:
  - Added proper type imports (`import type * as ts from "typescript"`) for type annotations without runtime dependency
  - Fixed lazy loading return type handling in `getTypeScript()` function
  - Added explicit type annotations to 20+ arrow function parameters (`.some()`, `.forEach()`, `.map()`, `.find()` callbacks)
  - Fixed `ModifierLike` vs `Modifier` type issues by using `ts.isModifier()` checks to handle both `Modifier` and `Decorator` types
  - Fixed JSDoc type from `ts.JSDocComment` to `ts.JSDoc` to match actual return types
  - All methods now properly call `getTypeScript()` before using TypeScript runtime APIs

#### Docker Testing

- **Alpine Docker Installation**: Fixed Alpine Docker tests by automatically installing build dependencies (python3, make, g++, cairo-dev, pango-dev, libjpeg-turbo-dev, giflib-dev, pixman-dev, freetype-dev, build-base, git) before `npm install`. This resolves native module compilation issues with `canvas` dependency from `chartjs-node-canvas`.
- **Docker Path Handling**: Fixed Docker volume mount path issues in test scripts by ensuring proper absolute path resolution and log output redirection to stderr.

#### CLI Options

- **Unknown Option Error**: Fixed "unknown option '--debug'" error when using `guardscan security --debug`. The command now properly accepts and processes the debug flag.
- **Commit Command Flag Mismatch**: Fixed `--no-body` flag not working in `guardscan commit` command. Commander.js converts `--no-body` to `body: false`, but the handler was checking for `includeBody` property. The command now correctly handles both the `body` property (from `--no-body`) and maintains backward compatibility with `includeBody`.

### Added

#### Comprehensive Testing Infrastructure

- **Test All Commands Script**: Created `cli/scripts/test-all-commands.sh` - comprehensive test script that:
  - Tests all 21 CLI commands with various flag combinations locally (37 tests)
  - Tests commands in Docker (Alpine and Debian environments, 14 tests)
  - Generates JSON test reports (`test-all-commands-results.json`)
  - Supports `--verbose`, `--local-only`, and `--docker-only` flags
  - Validates 51+ test scenarios across all environments
  - Properly handles Alpine build dependencies and path resolution

#### Docker Testing Infrastructure

- **Enhanced Docker Test Scripts**: Improved Docker test infrastructure:
  - Automatic build dependency detection and installation for Alpine
  - Support for both Alpine (`node:lts-alpine`) and Debian (`node:lts`) Linux distributions
  - Proper error handling and binary path resolution
  - Comprehensive test coverage for all major commands

#### Documentation

- **Docker Testing Guide**: Added `cli/scripts/DOCKER_TESTING_GUIDE.md` with:
  - Step-by-step instructions for testing in Alpine and Debian
  - Troubleshooting guide for common Docker issues (path errors, build dependencies)
  - Quick test scripts for manual testing
  - Comparison table (Alpine vs Debian characteristics)
  - Examples for both environments
- **WSL/SSH Testing Documentation**: Added comprehensive testing documentation for:
  - WSL (Windows Subsystem for Linux) environments
  - SSH into Docker containers/VMs (simulated via `docker exec`)
  - Remote server testing scenarios
- Updated `DOCKER_GUIDE.md` to document the new `--debug` flag option alongside the existing `GUARDSCAN_DEBUG` environment variable
- Updated `GETTING_STARTED.md` to mention the `--debug` flag for security scans
- Added troubleshooting section with both environment variable and flag-based debug options
- Added comprehensive "Command Flags and Options" section to `GETTING_STARTED.md` documenting flag naming conventions (kebab-case in CLI, camelCase in code) and negated flag behavior

#### Debug Flag Support

- **Security Command Debug Flag**: Added `--debug` flag to `guardscan security` command for verbose debug logging. This provides an alternative to setting the `GUARDSCAN_DEBUG` environment variable.
  - Usage: `guardscan security --debug`
  - Automatically sets `GUARDSCAN_DEBUG=true` when the flag is used
  - Provides user confirmation when debug mode is enabled

### Technical Details

- **Breaking Changes**: None
- **Migration**: No migration required from v1.0.3
- **Dependencies**: No new dependencies added
- **Build**: All TypeScript compilation errors resolved, `npm run build` and `npm pack` now succeed without errors
- **Test Coverage**: 51+ tests passing (37 local + 14 Docker) across all environments
- **Docker Support**: Full support for Alpine and Debian Linux distributions with automatic build dependency handling

---

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

## [1.0.3] - 2025-11-23

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
