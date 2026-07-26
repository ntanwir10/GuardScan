# AI Quick Reference

GuardScan is BYOK: configure a cloud provider API key or a local provider, then run AI-assisted commands. Advanced nested settings are edited directly in `~/.guardscan/config.yml`.

## Setup

```bash
guardscan config
guardscan config --provider openai --key "$OPENAI_API_KEY"
guardscan config --provider ollama
guardscan config --telemetry=false
guardscan config --offline=true
```

## Core AI Workflows

```bash
guardscan run --with-ai
guardscan review --base main
guardscan chat
guardscan explain src/index.ts --type file
guardscan test-gen --file src/index.ts
guardscan docs --type architecture
```

## Model And Budget Tools

```bash
guardscan models list
guardscan models info gpt-4o
guardscan routing list
guardscan routing set code-review --model gpt-4o
guardscan budget status
guardscan budget set --daily 10 --monthly 100
guardscan metrics show --days 7
guardscan cache stats
guardscan cache clear --repo --force
```

## Advanced Settings

Edit `~/.guardscan/config.yml` for nested settings:

```yaml
cache:
  enabled: true
  semanticThreshold: 0.95
  maxSizeMB: 100
  ttlSeconds: 3600
modelRouting:
  enabled: true
  strategy: balanced
observability:
  enabled: true
```

## CI Mode

```bash
guardscan --no-telemetry scan --ci --offline --format json --output guardscan-results.json --fail-on critical
guardscan --no-telemetry security --ci --format sarif --output guardscan.sarif --max-findings 50
```

## Privacy Controls

- `--no-telemetry` disables analytics for one command.
- `--no-cache` disables AI response caching for one command.
- `guardscan config --telemetry=false` persists telemetry opt-out and deletes queued events.
- `guardscan config --offline=true` blocks cloud AI, cloud embeddings, advisory lookups, update checks, and telemetry recording and delivery.
- `guardscan telemetry status` shows consent and local queue state; `guardscan telemetry sync` is the only delivery action.
- `guardscan cache clear --repo --force` clears the current repository, while `--all` clears every repository cache.

Telemetry is disabled by default. If enabled, it queues an aggregate allowlisted event locally while online; it never includes source, paths, prompts, responses, findings, or errors.
