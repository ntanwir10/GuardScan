# 🧠 AI Code Review CLI

Privacy-first, developer-friendly AI Code Review CLI with optional cloud sync and billing.

## Core Principles

- **Works fully offline** with optional cloud sync
- **Never uploads source code** — only anonymized metadata
- **Developer controls AI provider** (OpenAI, Claude, Gemini, local Ollama, etc.)
- **Lightweight CLI first** with Cloudflare Workers backend
- **Transparent pricing** by LOC (lines of code)

## Features

- Automated code review using AI
- Security vulnerability scanning (SAST-like)
- Multi-provider support (OpenAI, Claude, Gemini, Ollama, LM Studio, OpenRouter)
- Offline-first operation
- Privacy-focused (only anonymized metadata transmitted)
- Works with any git-based repository

## Quick Start

```bash
# Install
npm install -g ai-code-review

# Initialize (generates client_id)
ai-review init

# Configure AI provider
ai-review config

# Run code review
ai-review run

# Run security scan
ai-review security

# Check status
ai-review status
```

## Commands

- `ai-review init` - Initialize CLI and generate client_id
- `ai-review run` - Perform code review using selected AI model
- `ai-review security` - Run vulnerability scan
- `ai-review config` - Set model provider, keys, preferences
- `ai-review reset` - Clear local context and cache
- `ai-review status` - Show current credits, provider, and repo info

## Pricing

Currency: USD

Minimum purchase: 500 LOC

Tiers:
- 500–999 LOC → $0.010/LOC
- 1000–4999 LOC → $0.009/LOC
- 5000+ LOC → $0.008/LOC

LOC counting: non-blank, non-comment lines (language-aware)

## Privacy

- No source code ever transmitted
- Only anonymized metadata (client_id, repo_id hash, LOC counts)
- Telemetry is optional and anonymized
- HTTPS enforced for all communications

## Architecture

### CLI (Node.js/TypeScript)
- Lightweight config system
- Local code analysis
- AI provider abstraction
- Report generation

### Backend (Cloudflare Workers + Supabase)
- Credit validation
- Telemetry ingestion
- Billing (Stripe)
- API key management

## Development

```bash
# Install dependencies
cd cli && npm install
cd ../backend && npm install

# Build CLI
cd cli && npm run build

# Run locally
npm link
ai-review --help
```

## License

MIT

## Support

Report issues at: https://github.com/yourusername/ai-code-review/issues
