# CLAUDE.md - AI Assistant Guide for GuardScan

**Last Updated:** 2025-11-13
**Project:** GuardScan - Privacy-first AI Code Review CLI
**Repository:** https://github.com/ntanwir10/GuardScan

This document provides comprehensive guidance for AI assistants working on the GuardScan codebase. It covers architecture, conventions, workflows, and best practices.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Codebase Architecture](#codebase-architecture)
3. [Development Setup](#development-setup)
4. [Key Conventions](#key-conventions)
5. [Common Tasks](#common-tasks)
6. [Testing Strategy](#testing-strategy)
7. [Deployment](#deployment)
8. [AI Assistant Guidelines](#ai-assistant-guidelines)

---

## Project Overview

### Purpose
GuardScan is a privacy-first, developer-friendly CLI tool for AI-powered code review and comprehensive security scanning. It operates offline-first with optional cloud sync and never uploads source code.

### Core Principles
1. **Privacy First**: Never upload source code, only anonymized metadata
2. **Offline Capable**: Full functionality without internet connection
3. **Developer Control**: Users choose their AI provider (OpenAI, Claude, Gemini, Ollama, etc.)
4. **Lightweight**: CLI-first with minimal dependencies
5. **Transparent**: Clear pricing by LOC (lines of code)

### Technology Stack
- **CLI**: Node.js 18+, TypeScript, Commander.js
- **Backend**: Cloudflare Workers, Supabase (PostgreSQL)
- **Payments**: Stripe
- **AI Providers**: OpenAI, Anthropic (Claude), Google (Gemini), Ollama, LM Studio, OpenRouter
- **Build**: TypeScript Compiler (tsc)

### Project Status
- **Current Phase**: MVP Foundation Complete ✅
- **Build Status**: All TypeScript compilation errors fixed
- **CLI**: Fully functional with 11 commands
- **Backend**: Dependencies installed, needs deployment
- **Version**: 0.1.0

---

## Codebase Architecture

### Repository Structure

```
GuardScan/
├── cli/                          # Main CLI application
│   ├── src/
│   │   ├── commands/            # CLI command implementations (11 commands)
│   │   │   ├── init.ts         # Initialize GuardScan, generate client_id
│   │   │   ├── run.ts          # Code review with AI
│   │   │   ├── security.ts     # Security vulnerability scanning
│   │   │   ├── test.ts         # Test runner and code quality analysis
│   │   │   ├── sbom.ts         # Software Bill of Materials generation
│   │   │   ├── perf.ts         # Performance testing
│   │   │   ├── mutation.ts     # Mutation testing
│   │   │   ├── rules.ts        # Custom YAML-based rule engine
│   │   │   ├── config.ts       # AI provider configuration
│   │   │   ├── status.ts       # Show credits, provider, repo info
│   │   │   └── reset.ts        # Clear local cache and config
│   │   │
│   │   ├── core/               # Core business logic (18 modules)
│   │   │   ├── config.ts       # Configuration management
│   │   │   ├── repository.ts   # Git repository operations
│   │   │   ├── loc-counter.ts  # Language-aware LOC counting
│   │   │   ├── telemetry.ts    # Anonymized telemetry
│   │   │   ├── secrets-detector.ts      # Detect hardcoded secrets
│   │   │   ├── dependency-scanner.ts    # Scan package dependencies
│   │   │   ├── dockerfile-scanner.ts    # Docker security scanning
│   │   │   ├── iac-scanner.ts          # Infrastructure as Code scanning
│   │   │   ├── owasp-scanner.ts        # OWASP Top 10 coverage
│   │   │   ├── api-scanner.ts          # REST/GraphQL API scanning
│   │   │   ├── compliance-checker.ts   # GDPR, HIPAA, PCI-DSS
│   │   │   ├── license-scanner.ts      # License compliance
│   │   │   ├── code-metrics.ts         # Complexity metrics
│   │   │   ├── code-smells.ts          # Code smell detection
│   │   │   ├── linter-integration.ts   # ESLint, Pylint, etc.
│   │   │   ├── test-runner.ts          # Test execution & coverage
│   │   │   ├── performance-tester.ts   # Load/stress testing
│   │   │   ├── mutation-tester.ts      # Mutation testing
│   │   │   └── rule-engine.ts          # Custom YAML rule engine
│   │   │
│   │   ├── providers/          # AI provider implementations
│   │   │   ├── base.ts         # Abstract AIProvider base class
│   │   │   ├── factory.ts      # Provider factory pattern
│   │   │   ├── openai.ts       # OpenAI GPT integration
│   │   │   ├── claude.ts       # Anthropic Claude integration
│   │   │   ├── gemini.ts       # Google Gemini integration
│   │   │   └── ollama.ts       # Ollama local AI integration
│   │   │
│   │   ├── utils/              # Utility modules
│   │   │   ├── api-client.ts   # Backend API communication
│   │   │   ├── reporter.ts     # Markdown report generation
│   │   │   ├── chart-generator.ts  # Chart generation for reports
│   │   │   ├── network.ts      # Network status detection
│   │   │   ├── version.ts      # Version checking & updates
│   │   │   └── ascii-art.ts    # CLI logo display
│   │   │
│   │   └── index.ts            # CLI entry point, command registration
│   │
│   ├── package.json            # CLI dependencies
│   └── tsconfig.json           # TypeScript config (strict mode)
│
├── backend/                    # Cloudflare Workers backend
│   ├── src/
│   │   ├── handlers/           # API endpoint handlers
│   │   │   ├── health.ts       # Health check endpoint
│   │   │   ├── validate.ts     # Credit validation
│   │   │   ├── telemetry.ts    # Telemetry ingestion
│   │   │   ├── credits.ts      # Credit management
│   │   │   └── stripe-webhook.ts  # Stripe webhooks
│   │   │
│   │   ├── index.ts            # Worker entry point
│   │   ├── router.ts           # Request routing
│   │   └── db.ts               # Supabase database layer
│   │
│   ├── package.json            # Backend dependencies
│   └── tsconfig.json           # TypeScript config
│
├── docs/                       # Documentation
│   └── CONTRIBUTING.md         # Contribution guidelines
│
├── README.md                   # Project overview
├── BUILD_STATUS.md             # Build status report
├── LICENSE                     # MIT License
└── .gitignore                  # Git ignore rules
```

### Architecture Patterns

#### 1. Command Pattern (CLI)
- Each command is a separate module in `cli/src/commands/`
- Commands are registered in `cli/src/index.ts` using Commander.js
- Commands follow a consistent structure: options, validation, execution

#### 2. Abstract Factory Pattern (AI Providers)
- Base class: `AIProvider` in `cli/src/providers/base.ts`
- Concrete implementations: OpenAI, Claude, Gemini, Ollama
- Factory: `cli/src/providers/factory.ts` creates provider instances
- Interface: `AIMessage`, `AIResponse`, `ChatOptions`

#### 3. Configuration Management
- Location: `~/.guardscan/` (user home directory)
- Format: YAML (`config.yml`)
- Cache: `~/.guardscan/cache/`
- Manager: `ConfigManager` class in `cli/src/core/config.ts`

#### 4. Repository Detection
- Uses Git to identify repository root
- Generates deterministic `repo_id` hash from git remote URL
- Counts LOC with language-aware algorithms (ignores comments, blanks)

#### 5. Telemetry System
- **What's Sent**: client_id, repo_id (hashed), LOC counts, command usage
- **NOT Sent**: Source code, file paths, file names, sensitive data
- **Optional**: Users can disable with config flag
- **Endpoint**: `POST /api/telemetry` (backend)

---

## Development Setup

### Prerequisites
- **Node.js**: 18.0.0 or higher
- **Git**: For repository operations
- **NPM**: Package manager (comes with Node.js)
- **Code Editor**: VS Code recommended

### Initial Setup

```bash
# Clone repository
git clone https://github.com/ntanwir10/GuardScan.git
cd GuardScan

# Install CLI dependencies
cd cli
npm install

# Install Backend dependencies
cd ../backend
npm install
```

### Building the CLI

```bash
cd cli
npm run build           # Compiles TypeScript to dist/

# Watch mode for development
npm run dev            # Watches for changes and recompiles
```

### Testing Locally

```bash
cd cli
npm link               # Makes 'guardscan' command available globally

# Test commands
guardscan --help
guardscan init
guardscan status
guardscan security
```

### TypeScript Configuration

**CLI (`cli/tsconfig.json`):**
- Target: ES2020
- Module: CommonJS
- Strict mode: Enabled
- Source maps: Enabled
- Output: `dist/` directory

**Important Compiler Options:**
- `strict: true` - All strict type-checking enabled
- `esModuleInterop: true` - CommonJS/ES module interop
- `resolveJsonModule: true` - Import JSON files
- `skipLibCheck: true` - Skip .d.ts file checking

---

## Key Conventions

### Code Style

#### TypeScript Standards
- **Strict Mode**: Always enabled, no implicit `any`
- **Indentation**: 2 spaces (not tabs)
- **Line Length**: Prefer max 100 characters
- **Semicolons**: Required
- **Quotes**: Single quotes for strings

#### Naming Conventions
- **Variables/Functions**: camelCase (`getUserConfig`, `apiKey`)
- **Classes/Types**: PascalCase (`ConfigManager`, `AIProvider`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_API_ENDPOINT`)
- **Files**: kebab-case (`api-client.ts`, `code-metrics.ts`)
- **Interfaces**: PascalCase, prefix with `I` if ambiguous (`AIMessage`, `ChatOptions`)

#### File Organization
```typescript
// 1. Imports (external first, then internal)
import * as fs from 'fs';
import { Command } from 'commander';
import { ConfigManager } from '../core/config';

// 2. Type definitions and interfaces
export interface Config {
  clientId: string;
  provider: AIProvider;
}

// 3. Constants
const DEFAULT_TIMEOUT = 5000;

// 4. Class/Function implementations
export class ConfigManager {
  // ...
}

// 5. Helper functions (if not in class)
function parseYaml(content: string) {
  // ...
}
```

### Error Handling

#### Pattern 1: Try-Catch with User-Friendly Messages
```typescript
try {
  const config = configManager.load();
} catch (error) {
  console.error(chalk.red('Error loading configuration:'), error.message);
  console.log(chalk.yellow('Run `guardscan init` to initialize.'));
  process.exit(1);
}
```

#### Pattern 2: Graceful Degradation
```typescript
// Try AI-enhanced review, fall back to basic review
let aiResponse;
try {
  aiResponse = await provider.chat(messages);
} catch (error) {
  console.warn(chalk.yellow('AI provider unavailable, using basic analysis'));
  aiResponse = performBasicAnalysis(code);
}
```

#### Pattern 3: Network Error Handling
```typescript
// Check network before API calls
const isOnline = await checkNetwork();
if (!isOnline && !options.noCloud) {
  console.warn(chalk.yellow('Offline mode - skipping cloud validation'));
}
```

### Logging and Output

#### Use Chalk for Colors
- **Error**: `chalk.red()` - Critical errors
- **Warning**: `chalk.yellow()` - Warnings, fallbacks
- **Success**: `chalk.green()` - Successful operations
- **Info**: `chalk.blue()` - Informational messages
- **Muted**: `chalk.gray()` - Less important details

#### Example:
```typescript
console.log(chalk.green('✓ Configuration saved successfully'));
console.log(chalk.yellow('⚠ API key not set - limited functionality'));
console.error(chalk.red('✗ Failed to connect to provider'));
```

### API Integration

#### Backend Endpoints
- `GET /api/health` - Health check
- `POST /api/validate` - Validate credits before scan
- `POST /api/telemetry` - Submit anonymized telemetry
- `GET /api/credits/:clientId` - Get credit balance
- `POST /api/stripe/webhook` - Stripe payment webhooks

#### API Client Pattern (`cli/src/utils/api-client.ts`)
```typescript
// Always check network first
if (!(await checkNetwork())) {
  throw new Error('Network unavailable');
}

// Use axios with timeout
const response = await axios.post(endpoint, data, {
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
});
```

### Provider Pattern

#### All AI Providers Must Implement:
1. `chat(messages, options)` - Send chat messages, return response
2. `isAvailable()` - Check if credentials are configured
3. `getName()` - Return provider name string
4. `testConnection()` - Verify API connectivity

#### Example:
```typescript
export class CustomProvider extends AIProvider {
  async chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse> {
    // Implementation
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getName(): string {
    return 'custom';
  }

  async testConnection(): Promise<boolean> {
    // Try a simple API call
  }
}
```

---

## Common Tasks

### Adding a New CLI Command

**Step 1:** Create command file in `cli/src/commands/`
```typescript
// cli/src/commands/mycommand.ts
import { Command } from 'commander';
import chalk from 'chalk';

export async function myCommand(options: any) {
  console.log(chalk.blue('Running my command...'));

  // Command logic here

  console.log(chalk.green('✓ Command completed'));
}
```

**Step 2:** Register command in `cli/src/index.ts`
```typescript
import { myCommand } from './commands/mycommand';

program
  .command('mycommand')
  .description('Description of my command')
  .option('-f, --flag', 'Flag description')
  .action(myCommand);
```

**Step 3:** Update README.md with new command documentation

### Adding a New AI Provider

**Step 1:** Create provider class in `cli/src/providers/`
```typescript
// cli/src/providers/myprovider.ts
import { AIProvider, AIMessage, AIResponse } from './base';

export class MyProvider extends AIProvider {
  async chat(messages: AIMessage[]): Promise<AIResponse> {
    // API call implementation
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getName(): string {
    return 'myprovider';
  }

  async testConnection(): Promise<boolean> {
    // Test implementation
  }
}
```

**Step 2:** Register in factory (`cli/src/providers/factory.ts`)
```typescript
import { MyProvider } from './myprovider';

export function createProvider(
  providerName: string,
  apiKey?: string
): AIProvider {
  switch (providerName) {
    case 'myprovider':
      return new MyProvider(apiKey);
    // ... other cases
  }
}
```

**Step 3:** Add to config options in `cli/src/commands/config.ts`

### Adding a Security Scanner

**Step 1:** Create scanner module in `cli/src/core/`
```typescript
// cli/src/core/my-scanner.ts
export interface ScanResult {
  severity: 'high' | 'medium' | 'low';
  message: string;
  line?: number;
  suggestion?: string;
}

export async function scanFile(filePath: string): Promise<ScanResult[]> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const results: ScanResult[] = [];

  // Scanning logic

  return results;
}
```

**Step 2:** Integrate into `cli/src/commands/security.ts`
```typescript
import { scanFile } from '../core/my-scanner';

// In securityCommand function:
const results = await scanFile(file);
allFindings.push(...results);
```

### Modifying the Report Generator

Reports are generated in `cli/src/utils/reporter.ts`. The reporter creates Markdown-formatted reports.

**Example - Adding a New Section:**
```typescript
report += `\n## My New Section\n\n`;
report += `| Column 1 | Column 2 |\n`;
report += `|----------|----------|\n`;
data.forEach(item => {
  report += `| ${item.field1} | ${item.field2} |\n`;
});
```

### Working with the Config System

```typescript
import { ConfigManager } from './core/config';

const configManager = new ConfigManager();

// Initialize (creates config if not exists)
const config = configManager.init();

// Load existing config
const config = configManager.load();

// Update specific field
config.provider = 'claude';
configManager.save(config);

// Get cache directory
const cacheDir = configManager.getCacheDir();
```

### Counting Lines of Code

```typescript
import { countLOC } from './core/loc-counter';

const loc = await countLOC('/path/to/repo');
console.log(`Total LOC: ${loc.total}`);
console.log(`By language:`, loc.byLanguage);
```

---

## Testing Strategy

### Current State
- **Unit Tests**: Not yet implemented (Priority 3)
- **Manual Testing**: CLI commands tested end-to-end
- **Integration Tests**: Needed for provider integrations

### Testing Framework (When Implemented)
- **Framework**: Jest (already in devDependencies)
- **Coverage Target**: 50%+ for MVP
- **Run Tests**: `npm test`
- **Coverage Report**: `npm run test:coverage`

### Test Patterns to Follow

#### Unit Test Example
```typescript
// __tests__/loc-counter.test.ts
import { countLOC } from '../src/core/loc-counter';

describe('LOC Counter', () => {
  it('should count lines correctly', async () => {
    const result = await countLOC('./fixtures/sample-repo');
    expect(result.total).toBeGreaterThan(0);
  });

  it('should ignore blank lines', async () => {
    const result = await countLOC('./fixtures/blanks');
    expect(result.total).toBe(10); // Only non-blank
  });
});
```

#### Integration Test Example
```typescript
// __tests__/providers/openai.test.ts
import { OpenAIProvider } from '../src/providers/openai';

describe('OpenAI Provider', () => {
  it('should send chat messages', async () => {
    const provider = new OpenAIProvider(process.env.OPENAI_API_KEY);
    const response = await provider.chat([
      { role: 'user', content: 'Hello' }
    ]);
    expect(response.content).toBeDefined();
  });
});
```

### Manual Testing Checklist

Before any major release or feature merge:

- [ ] Build succeeds: `npm run build`
- [ ] All commands work: `guardscan <command> --help`
- [ ] Init creates config: `guardscan init`
- [ ] Config shows settings: `guardscan config --show`
- [ ] Security scan runs: `guardscan security`
- [ ] Status displays info: `guardscan status`
- [ ] Reset clears cache: `guardscan reset`
- [ ] Offline mode works: `guardscan run --no-cloud`

---

## Deployment

### CLI Deployment (NPM)

**Prerequisites:**
- NPM account
- Package name available on NPM registry

**Steps:**
1. Update version in `cli/package.json`
2. Build: `npm run build`
3. Test locally: `npm link`
4. Publish: `npm publish`

**Post-Publish:**
- Users install with: `npm install -g guardscan`
- Binary name: `guardscan`

### Backend Deployment (Cloudflare Workers)

**Prerequisites:**
- Cloudflare account
- Wrangler CLI installed (`npm install -g wrangler`)
- Supabase project set up

**Environment Variables (Secrets):**
```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

**Deploy:**
```bash
cd backend
npm run deploy    # Runs: wrangler deploy
```

**Monitor:**
```bash
npm run tail      # Runs: wrangler tail (live logs)
```

### Supabase Setup

**Database Schema** (see `docs/database-schema.md` if exists):
- `clients` table - Store client_id, created_at
- `credits` table - LOC credits per client
- `transactions` table - Purchase history
- `telemetry` table - Anonymized usage data

**Row Level Security (RLS):**
- Enable RLS on all tables
- Service role key for backend access only

---

## AI Assistant Guidelines

### When Working on GuardScan

#### 1. Always Prioritize Privacy
- **NEVER** add features that upload source code
- Only send anonymized metadata (client_id, repo_id hash, LOC counts)
- If adding telemetry, ensure it's optional and clearly documented
- Respect offline-first architecture

#### 2. Maintain Type Safety
- Use TypeScript strict mode
- Never use `any` without explicit justification
- Add proper type annotations for function parameters and returns
- Update interfaces when changing data structures

#### 3. Follow Established Patterns
- Use Commander.js for CLI commands
- Use Chalk for colored output
- Use the Provider pattern for AI integrations
- Use ConfigManager for configuration access

#### 4. Error Handling Best Practices
- Always catch errors from external APIs
- Provide user-friendly error messages
- Suggest next steps when errors occur
- Gracefully degrade when services unavailable

#### 5. Testing Mindset
- Write testable code (pure functions where possible)
- Avoid side effects in core logic
- Mock external dependencies
- Add tests when implementing new features

#### 6. Documentation Requirements
- Update README.md for user-facing changes
- Update CLAUDE.md for architectural changes
- Add JSDoc comments for public APIs
- Keep BUILD_STATUS.md current

#### 7. Commit Message Format
Follow conventional commits:
- `feat: add new security scanner for SQL injection`
- `fix: resolve LOC counting issue for Python files`
- `docs: update installation instructions`
- `refactor: simplify provider factory logic`
- `test: add unit tests for config manager`
- `chore: update dependencies`

#### 8. Before Committing
- [ ] Run `npm run build` to ensure it compiles
- [ ] Test the affected commands manually
- [ ] Check for console errors or warnings
- [ ] Update relevant documentation
- [ ] Verify no secrets or API keys in code

#### 9. Common Pitfalls to Avoid
- **Don't** hardcode API endpoints (use config/env vars)
- **Don't** commit `node_modules/` or `dist/`
- **Don't** break offline mode functionality
- **Don't** add dependencies without justification
- **Don't** modify core privacy guarantees

#### 10. When Adding Dependencies
- Justify why the dependency is needed
- Check the package size and maintenance status
- Ensure it's compatible with Node.js 18+
- Add to appropriate `package.json` (cli vs backend)
- Run `npm install` after adding

### Debugging Tips

#### CLI Not Working After Changes
```bash
cd cli
npm run build       # Rebuild
npm link           # Re-link
guardscan --help   # Test
```

#### TypeScript Errors
```bash
cd cli
npx tsc --noEmit   # Check types without building
```

#### Find All TODOs
```bash
grep -r "TODO" cli/src/
```

#### Check Config Location
```bash
cat ~/.guardscan/config.yml
ls -la ~/.guardscan/cache/
```

### Understanding the Codebase Quickly

**Entry Points:**
1. `cli/src/index.ts` - CLI command registration
2. `cli/src/commands/run.ts` - Main code review logic
3. `cli/src/providers/factory.ts` - AI provider selection
4. `backend/src/index.ts` - API request handling

**Critical Files:**
1. `cli/src/core/config.ts` - Configuration system
2. `cli/src/core/repository.ts` - Git operations
3. `cli/src/utils/api-client.ts` - Backend communication
4. `cli/src/utils/reporter.ts` - Report generation

**Security-Related:**
1. `cli/src/commands/security.ts` - Main security command
2. `cli/src/core/secrets-detector.ts` - Find hardcoded secrets
3. `cli/src/core/owasp-scanner.ts` - OWASP Top 10 checks
4. `cli/src/core/dependency-scanner.ts` - Vulnerable dependencies

### Quick Reference: File Responsibilities

| File | Purpose |
|------|---------|
| `cli/src/index.ts` | CLI entry point, command registration |
| `cli/src/commands/run.ts` | AI-powered code review |
| `cli/src/commands/security.ts` | Security vulnerability scanning |
| `cli/src/commands/init.ts` | Initialize config, generate client_id |
| `cli/src/core/config.ts` | Config management (`~/.guardscan/`) |
| `cli/src/core/repository.ts` | Git repo detection, repo_id generation |
| `cli/src/core/loc-counter.ts` | Language-aware LOC counting |
| `cli/src/providers/base.ts` | Abstract AIProvider interface |
| `cli/src/providers/factory.ts` | Create provider instances |
| `cli/src/utils/api-client.ts` | Backend API communication |
| `cli/src/utils/reporter.ts` | Markdown report generation |
| `backend/src/index.ts` | Cloudflare Worker entry point |
| `backend/src/router.ts` | API route handling |
| `backend/src/db.ts` | Supabase database layer |

---

## Additional Resources

### External Documentation
- **Commander.js**: https://github.com/tj/commander.js
- **Chalk**: https://github.com/chalk/chalk
- **Cloudflare Workers**: https://developers.cloudflare.com/workers/
- **Supabase**: https://supabase.com/docs
- **TypeScript**: https://www.typescriptlang.org/docs/

### Internal Documentation
- `README.md` - User-facing documentation
- `docs/CONTRIBUTING.md` - Contribution guidelines
- `BUILD_STATUS.md` - Current build status and roadmap
- `LICENSE` - MIT License

### Support
- **Issues**: https://github.com/ntanwir10/GuardScan/issues
- **Repository**: https://github.com/ntanwir10/GuardScan

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-13 | Initial comprehensive CLAUDE.md created |

---

**Last Updated:** 2025-11-13
**Maintainer:** AI Assistant Guidelines for GuardScan Project
**Purpose:** Enable AI assistants to work effectively on the GuardScan codebase
