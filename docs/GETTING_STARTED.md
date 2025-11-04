# Getting Started with AI Code Review

## What is AI Code Review?

AI Code Review is a privacy-first CLI tool that uses AI to automatically review your code for:
- Code quality issues
- Potential bugs
- Security vulnerabilities
- Performance problems
- Best practice violations

## Key Features

- **Privacy-First**: Never uploads source code, only anonymized metadata
- **Multi-Provider**: Supports OpenAI, Claude, Gemini, Ollama, and more
- **Offline-Capable**: Works without internet using local AI models
- **Universal**: Works with any git-based repository
- **Free Security Scans**: Built-in SAST-like security scanning

## Installation

### Via NPM (Recommended)

```bash
npm install -g ai-code-review
```

### From Source

```bash
git clone https://github.com/yourusername/ai-code-review.git
cd ai-code-review/cli
npm install
npm run build
npm link
```

## Quick Start

### 1. Initialize

```bash
cd your-project
ai-review init
```

This generates a unique `client_id` stored locally in `~/.ai-review/config.yml`.

### 2. Configure AI Provider

```bash
ai-review config
```

Choose your AI provider and enter API key:
- **OpenAI** (GPT-4): Get key from [platform.openai.com](https://platform.openai.com)
- **Claude**: Get key from [console.anthropic.com](https://console.anthropic.com)
- **Gemini**: Get key from [makersuite.google.com](https://makersuite.google.com)
- **Ollama** (Local): Install from [ollama.ai](https://ollama.ai)

### 3. Run Your First Review

```bash
ai-review run
```

This will:
1. Count lines of code
2. Validate credits (if online)
3. Analyze your codebase with AI
4. Generate a detailed report

### 4. Check Your Status

```bash
ai-review status
```

View your configuration, repository info, and remaining credits.

## Using Local AI (Offline)

### With Ollama

1. Install Ollama: https://ollama.ai
2. Pull a model:

```bash
ollama pull codellama
```

3. Configure AI Code Review:

```bash
ai-review config
# Select "ollama" as provider
# Default endpoint: http://localhost:11434
```

4. Run offline:

```bash
ai-review run --no-cloud
```

### With LM Studio

1. Install LM Studio: https://lmstudio.ai
2. Start server (default port 1234)
3. Configure:

```bash
ai-review config
# Select "lmstudio" as provider
# Default endpoint: http://localhost:1234
```

## Security Scanning

Run a free security scan:

```bash
ai-review security
```

This performs SAST-like scanning for:
- Hardcoded secrets
- SQL injection vulnerabilities
- XSS vulnerabilities
- Insecure cryptography
- Code injection risks
- And more...

## Review Specific Files

Target specific files or patterns:

```bash
# Review specific files
ai-review run -f src/main.ts src/utils/*.ts

# Security scan on specific directory
ai-review security -f src/auth/**/*.js
```

## Understanding Reports

Reports are saved as Markdown files with:

### 1. Overview
- Repository information
- Branch name
- AI provider used
- Processing time

### 2. Code Statistics
- Total lines analyzed
- Code vs. comment vs. blank lines
- File count

### 3. Findings
Categorized by severity:
- 🔴 **Critical**: Urgent security or functional issues
- 🟠 **High**: Important issues affecting security or reliability
- 🟡 **Medium**: Quality or maintainability concerns
- 🔵 **Low**: Minor improvements or style issues

### 4. Recommendations
Actionable suggestions for improving your codebase.

## Common Workflows

### Daily Code Review

```bash
# Review changes in current branch
git checkout feature/my-feature
ai-review run

# Review and generate HTML report
ai-review run > review.md
# Open review.md in browser
```

### Pre-Commit Security Check

```bash
# Add to .git/hooks/pre-commit
#!/bin/bash
ai-review security --no-cloud
if [ $? -ne 0 ]; then
  echo "Security issues found! Review before committing."
  exit 1
fi
```

### CI/CD Integration

```yaml
# GitHub Actions example
- name: Run AI Code Review
  run: |
    npm install -g ai-code-review
    ai-review init
    ai-review config --provider openai --key ${{ secrets.OPENAI_API_KEY }}
    ai-review run --no-cloud
```

## Configuration Options

Edit `~/.ai-review/config.yml`:

```yaml
clientId: your-uuid
provider: openai
apiKey: sk-...
telemetryEnabled: true
offlineMode: false
createdAt: '2024-01-15T10:00:00Z'
lastUsed: '2024-01-15T15:30:00Z'
```

## Privacy & Telemetry

### What is Collected?

Only anonymized metadata:
- Hashed repository ID
- Lines of code count
- AI provider used
- Processing duration
- Action type (review/security)

### What is NOT Collected?

- Source code
- File names
- Variable names
- Comments
- Any PII

### Disabling Telemetry

```bash
ai-review config
# Select "No" for telemetry
```

Or edit config:

```yaml
telemetryEnabled: false
```

## Purchasing Credits

If you run out of free credits:

1. Visit: https://ai-review.dev/pricing
2. Select LOC package
3. Complete Stripe checkout
4. Credits added automatically to your `client_id`

### Pricing

- 500–999 LOC: $0.010/LOC
- 1000–4999 LOC: $0.009/LOC
- 5000+ LOC: $0.008/LOC

## Troubleshooting

### "Configuration not found"

Run `ai-review init` first.

### "AI provider not configured"

Run `ai-review config` and set up your provider.

### "Insufficient credits"

Either:
- Purchase more credits online
- Use `--no-cloud` flag
- Switch to local AI provider (Ollama)

### "Could not connect to provider"

- Check your API key
- Verify internet connection
- Test provider endpoint

### Rate Limited by AI Provider

Most providers have rate limits. Wait a minute and try again, or upgrade your provider account.

## Advanced Usage

### Custom API Endpoints

```bash
export API_BASE_URL=https://your-custom-api.com
ai-review run
```

### Multiple Profiles

You can maintain different configs by using environment variables:

```bash
export AI_REVIEW_CONFIG_DIR=~/.ai-review-work
ai-review init
```

### Batch Processing

```bash
#!/bin/bash
for repo in ~/projects/*; do
  cd $repo
  ai-review run -f "src/**/*.ts"
done
```

## Getting Help

- Documentation: https://docs.ai-review.dev
- Issues: https://github.com/yourusername/ai-code-review/issues
- Discord: https://discord.gg/ai-code-review
- Email: support@ai-review.dev

## Next Steps

- Read the [API Documentation](./API.md)
- Learn about [Deployment](./deployment.md)
- Check [Contributing Guide](./CONTRIBUTING.md)
- Explore [Database Schema](./database-schema.md)
