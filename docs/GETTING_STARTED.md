# Getting Started with GuardScan

## What is GuardScan?

GuardScan is a privacy-first CLI tool that uses AI to automatically review your code for:

- Code quality issues
- Potential bugs
- Security vulnerabilities
- Performance problems
- Best practice violations

## Key Features

- **Privacy-First**: Built-in scanners stay local; cloud AI receives context only when you configure and invoke it
- **Multi-Provider**: Supports OpenAI, Claude, Gemini, Ollama, and more
- **Offline-Capable**: Works without internet using local AI models
- **Universal**: Works with any git-based repository
- **Free Security Scans**: Built-in SAST-like security scanning

## Installation

### Via NPM (Recommended)

```bash
npm install -g guardscan
```

### From Source

```bash
git clone https://github.com/ntanwir10/GuardScan.git
cd GuardScan/cli
npm install
npm run build
npm link
```

## Quick Start

### 1. Initialize

```bash
cd your-project
guardscan init
```

This creates local configuration under `~/.guardscan/config.yml`.
New non-interactive configurations default to offline mode with telemetry disabled.

### 2. Configure AI Provider

```bash
guardscan config
```

Choose your AI provider and enter API key:

- **OpenAI** (GPT-4): Get key from [platform.openai.com](https://platform.openai.com)
- **Claude**: Get key from [console.anthropic.com](https://console.anthropic.com)
- **Gemini**: Get key from [makersuite.google.com](https://makersuite.google.com)
- **Ollama** (Local): Install from [ollama.ai](https://ollama.ai)

### 3. Run Your First Review

```bash
guardscan run
```

This will:

1. Count lines of code
2. Analyze your codebase with the configured AI provider
3. Generate a detailed report

### 4. Check Your Status

```bash
guardscan status
```

View your configuration, repository info, and local status.

## Using Local AI (Offline)

### With Ollama

1. Install Ollama: <https://ollama.ai>
2. Pull a model:

```bash
ollama pull codellama
```

3. Configure GuardScan:

```bash
guardscan config
# Select "ollama" as provider
# Default endpoint: http://localhost:11434
```

4. Run offline:

```bash
guardscan run
```

### With LM Studio

1. Install LM Studio: <https://lmstudio.ai>
2. Start server (default port 1234)
3. Configure:

```bash
guardscan config
# Select "lmstudio" as provider
# Endpoint may be entered as http://localhost:1234; GuardScan normalizes the OpenAI-compatible /v1 base
```

## Security Scanning

Run a free security scan:

```bash
guardscan security
```

For a guaranteed local-only run, disable CVE lookup or prepare an offline snapshot first:

```bash
guardscan security --offline --no-cve

# Prepare exact-version CVE coverage, then reuse it offline
guardscan config --offline=false
guardscan vuln db update .
guardscan vuln . --offline
```

For verbose debug output, use the `--debug` flag:

```bash
guardscan security --debug
```

This performs SAST-like scanning for:

- Hardcoded secrets
- SQL injection vulnerabilities
- XSS vulnerabilities
- Insecure cryptography
- Code injection risks
- And more...

See [Dependency Vulnerability Scanning](./VULNERABILITY_SCANNING.md) for supported ecosystems, snapshot freshness, OSV/CVSS/CISA limitations, and CI thresholds.

## Review Specific Files

Target specific files or patterns:

```bash
# Review specific files
guardscan run -f src/main.ts src/utils/*.ts

# Security scan on specific directory
guardscan security -f src/auth/**/*.js
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
guardscan run

# Review and generate HTML report
guardscan run > review.md
# Open review.md in browser
```

### Pre-Commit Security Check

```bash
# Add to .git/hooks/pre-commit
#!/bin/bash
guardscan security --offline --no-cve --ci --format json --output guardscan.json
case $? in
  0) exit 0 ;;
  1) echo "GuardScan policy failed; review guardscan.json." ; exit 1 ;;
  2) echo "GuardScan could not complete required coverage." ; exit 2 ;;
esac
```

### CI/CD Integration

```yaml
# GitHub Actions example
- name: Run GuardScan
  run: |
    npm install -g guardscan
    guardscan --no-telemetry init
    guardscan security --offline --no-cve --ci \
      --format sarif --output guardscan.sarif --fail-on high
```

## Command Flags and Options

GuardScan commands support various flags to customize behavior. Flags use kebab-case in the CLI (e.g., `--with-ai`, `--no-body`) and are automatically converted to camelCase in the code.

### Common Flags

- **File Selection**: `-f, --files <patterns...>` - Specify files or patterns to analyze
- **Debug Mode**: `--debug` - Enable verbose debug logging (available for `security` command)
- **Output**: `-o, --output <path>` - Specify output file path
- **Offline boundary**: `--offline` - Block GuardScan cloud/advisory/telemetry clients for the invocation
- **Cache boundary**: `--no-cache` - Disable exact, semantic, and advisory cache reads and writes
- **Scanner completeness**: `--allow-partial` - Explicitly accept incomplete scanner coverage
- **Negated Flags**: Flags like `--no-body` disable features

### Examples

```bash
# Security scan with debug output
guardscan security --debug

# Scan specific files
guardscan security -f src/**/*.ts

# Generate commit message without body
guardscan commit --no-body

# Run with AI enhancement disabled
guardscan run --no-with-ai
```

### CI results

`scan` and `security` support versioned JSON and SARIF output:

```bash
guardscan security --ci --format json --output guardscan.json --fail-on high
guardscan scan --ci --format sarif --output guardscan.sarif --max-findings 25
```

Exit code `0` means execution and policy passed, `1` means findings violated policy, and `2` means a required scanner or coverage step failed. JSON includes the same policy exit code and each scanner's succeeded, failed, or skipped state.

### Flag Naming Convention

- CLI flags use **kebab-case**: `--with-ai`, `--test-command`, `--embedding-provider`
- Code properties use **camelCase**: `withAi`, `testCommand`, `embeddingProvider`
- Negated flags (`--no-*`) are converted to boolean properties: `--no-body` → `body: false`

## Troubleshooting

### Missing Dependencies

If you encounter errors like "Cannot find module 'typescript'", this means a required runtime dependency is missing.

**Solution:**

```bash
# Install missing dependency
npm install typescript

# Or reinstall GuardScan globally
npm install -g guardscan
```

**Common Issues:**

- **"TypeScript is required but not installed"**: Run `npm install typescript` or reinstall GuardScan
- **"Cannot find module 'typescript'"**: Ensure TypeScript is in your `package.json` dependencies
- **Docker/Alpine errors**: See [Docker Guide](DOCKER_GUIDE.md) for Alpine-specific setup

### Debug Mode

Enable verbose logging to troubleshoot issues:

```bash
# Using environment variable
GUARDSCAN_DEBUG=true guardscan <command>

# Or using --debug flag (for security command)
guardscan security --debug
```

## Configuration Options

Edit `~/.guardscan/config.yml`:

```yaml
provider: openai
apiKey: sk-...
telemetryEnabled: false
offlineMode: true
createdAt: '2024-01-15T10:00:00Z'
lastUsed: '2024-01-15T15:30:00Z'
```

## Privacy & Telemetry

### What is queued after opt-in?

Only a strict aggregate allowlist:

- Random event ID
- Action category
- Aggregate lines of code
- Processing duration
- Coarse execution mode
- Timestamp

### What is NOT Collected?

- Source code
- File names or paths
- Prompts or AI responses
- Findings, dependency names, or errors
- API keys

### Disabling Telemetry

```bash
guardscan config
# Select "No" for telemetry
```

Or edit config:

```yaml
telemetryEnabled: false
```

Telemetry is disabled by default and never uploads automatically. GuardScan
operates no hosted collector or default endpoint. After explicit consent,
events are queued only while online and remain local until you configure a
user-operated HTTPS collector and sync explicitly:

```bash
export GUARDSCAN_TELEMETRY_URL=https://telemetry.example.com
guardscan telemetry sync
```

Failed delivery leaves the batch queued. `guardscan config --telemetry=false`
deletes the queue. Use `guardscan telemetry status` and
`guardscan telemetry clear --force` to inspect or delete it explicitly.
`GUARDSCAN_API_URL` and the former `api.guardscancli.com` service are retired.

## Troubleshooting

### "Configuration not found"

Run `guardscan init` first.

### "AI provider not configured"

Run `guardscan config` and set up your provider.

### "AI provider not configured"

Either run `guardscan config` to set up a BYOK provider or switch to a local AI provider such as Ollama or LM Studio.

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
guardscan run
```

### Multiple Profiles

You can maintain different configs by using environment variables:

```bash
export AI_REVIEW_CONFIG_DIR=~/.guardscan-work
guardscan init
```

### Batch Processing

```bash
#!/bin/bash
for repo in ~/projects/*; do
  cd $repo
  guardscan run -f "src/**/*.ts"
done
```

## Getting Help

- Documentation: <https://guardscancli.com/docs>
- Issues: <https://github.com/ntanwir10/GuardScan/issues>

## Next Steps

- Read the [API Documentation](./API.md)
- Open a focused pull request with tests and a clear rationale
