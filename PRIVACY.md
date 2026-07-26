# Privacy Policy

**Last updated: July 20, 2026**

GuardScan is a local-first security scanner and BYOK AI client. This document describes the CLI's network boundaries and the data it stores. It distinguishes local scanning, third-party AI providers, public vulnerability services, and optional GuardScan telemetry because they have different privacy properties.

## Defaults

A new non-interactive installation starts with:

- offline mode enabled;
- telemetry disabled;
- no AI provider selected; and
- local caches enabled for commands that use them.

View the active settings with:

```bash
guardscan config --show
guardscan telemetry status
```

## Source code and static analysis

GuardScan's built-in static scanners process source files locally. GuardScan does not send source code, source-derived prompts, file names, file paths, secrets, or API keys to a GuardScan-operated service.

Some commands deliberately invoke other software, such as a project test runner, linter, package manager, mutation tool, or configured AI provider. `guardscan scan` is static-only by default and requires `--run-project-code` before it invokes repository-controlled tests or linters. Those child processes receive a scrubbed environment and isolated temporary home, but they can still read accessible files and modify the repository. `--isolate-project-network` requests an OS-backed network sandbox and fails the affected check when that sandbox is unavailable. Other explicitly invoked project-tool commands retain their own behavior and privacy policies.

## Offline mode

Persist offline mode or apply it to one invocation:

```bash
guardscan config --offline=true
guardscan --offline security
```

`--no-cloud` remains a deprecated alias for `--offline`.

While offline mode is active, GuardScan blocks its cloud AI providers and cloud embedding providers, advisory lookups, update checks, and both telemetry recording and delivery. Ollama and LM Studio remain available only at literal IPv4 `127/8` or IPv6 `::1` endpoints; hostname aliases, private-network addresses, and remote endpoints are rejected. HTTP redirects are disabled for provider and telemetry transports. Dependency inventory and SBOM generation continue from local manifests, lockfiles, and installed package metadata.

Offline CVE scanning does not claim that an old local snapshot is current. It requires a fresh snapshot whose inventory digest matches the repository. Missing, stale, mismatched, or incomplete coverage is an operational failure unless `--allow-partial` is explicitly supplied.

## AI providers

AI features send selected repository context directly to the provider you configure. For OpenAI, Anthropic, Gemini, or OpenRouter, that is a third-party cloud service. For Ollama or LM Studio at a literal loopback address, it is a local service. A non-loopback self-hosted endpoint requires offline mode to be disabled and the separately named `allowRemoteSelfHosted: true` configuration approval.

`guardscan run` always completes its required local scanner pass before optional AI enrichment. Scanner status, errors, and coverage remain in the report; incomplete required coverage exits with code `2` unless the supported CVE-only partial policy was explicitly selected.

GuardScan does not proxy AI requests or receive the provider response. Review the chosen provider's retention and training policies before enabling cloud AI. API credentials can be read from the provider's environment variable or stored in the local configuration file; GuardScan does not include them in telemetry.

## Vulnerability advisory lookups

Online vulnerability scans send package ecosystem, package name, and exact version to the configured OSV-compatible endpoint. When known-exploitation enrichment is enabled, GuardScan also downloads the public CISA KEV catalog; that request contains no repository or package data. Neither request sends source files. Successful OSV coverage and the validated KEV catalog can be cached locally for later offline use.

Snapshots are stored beneath `~/.guardscan/cache/vulnerabilities` (or the equivalent directory under `GUARDSCAN_HOME`). Clear them with:

```bash
guardscan vuln db clear --repo --force
guardscan vuln db clear --all --force
```

See [Vulnerability Scanning](./docs/VULNERABILITY_SCANNING.md) for coverage and severity limitations.

## Telemetry

Telemetry is opt-in and never uploads automatically. Enabling consent allows GuardScan to queue an allowlisted event locally; delivery happens only when you run `guardscan telemetry sync`.

An event may contain:

- a random event ID;
- the command category;
- aggregate lines of code;
- execution duration;
- a coarse execution mode; and
- an event timestamp.

Events do not contain source code, prompts, responses, file names, file paths, repository names, repository hashes, stack traces, API keys, dependency names, or vulnerability details.

The telemetry schema is exact: `eventId`, `action`, `loc`, `durationMs`,
`executionMode`, and `occurredAt`. Unknown fields, invalid numeric values, and
timestamps outside the supported range are quarantined locally before status,
pruning, or synchronization. Quarantined files are never uploaded.

Maintenance retains the newest 1,000 valid events for at most 30 days. Separate
CLI processes publish without replacing one another, so concurrent writers may
briefly exceed the retention target until the next bounded maintenance pass. A
single pass examines at most 2,000 directory entries. Event and metadata files
are limited to 64 KiB; legacy migration inputs are limited to 8 MiB and 1,000
events. Invalid migrations are quarantined without partially importing them,
and only one process may synchronize an outbox at a time. A failed upload
remains queued for a later explicit retry. A successful response removes only
accepted events.

To use telemetry, enable consent, leave offline mode, configure an HTTPS collector, and sync explicitly:

```bash
guardscan config --telemetry=true --offline=false
export GUARDSCAN_TELEMETRY_URL=https://telemetry.example.com
guardscan telemetry status
guardscan telemetry sync
```

`GUARDSCAN_OFFLINE=true`, `--offline`, `GUARDSCAN_NO_TELEMETRY=true`, or `--no-telemetry` suppresses recording and delivery for the invocation. Persistently disabling telemetry also exhaustively deletes every queued event, including queues larger than the retention limit. Inspect or delete the local outbox at any time:

```bash
guardscan telemetry status
guardscan telemetry clear --force
```

No hosted telemetry endpoint is configured by default. Whoever operates the endpoint is responsible for publishing its retention, deletion, access-control, and jurisdiction terms.

## Local storage

GuardScan stores configuration and state beneath `~/.guardscan`, or beneath the directory selected by `GUARDSCAN_HOME`. Depending on enabled features, local data can include:

- configuration and API credentials;
- exact and semantic AI caches containing prompts, responses, file paths, and code-derived text;
- local embedding indexes;
- vulnerability coverage snapshots;
- circuit-breaker and metrics state; and
- the telemetry outbox.

GuardScan creates its private state directories with mode `0700` and sensitive
files with mode `0600` on platforms that support POSIX permissions. Local AI
metrics retain provider/model names, timing, token counts, cost estimates, and
structured error categories, but do not persist raw provider error messages.
Metrics are stored as bounded per-span event files so concurrent CLI processes
do not replace one another's snapshots. Persisted metrics use an exact,
allowlisted schema; malformed optional fields are quarantined before
aggregation. Metrics maintenance retains the newest 1,000 valid spans, limits
individual event files to 64 KiB and legacy inputs to 8 MiB/1,000 spans, and
keeps at most 20 recent quarantine artifacts per state area. A conflicting
write for the same span identity is rejected rather than silently replacing
the first value.

Configuration sections are parsed as partial overrides and normalized against
defaults. Unknown keys, invalid ranges, non-integer limits, malformed dates,
and unsafe service endpoints are rejected instead of being retained and
re-emitted.

If GuardScan cannot resolve a safe home directory it fails closed and asks for
an absolute `GUARDSCAN_HOME`; it does not silently use the shared `/tmp` root.

Cache entries expire according to the configured TTL and are pruned from disk. `--no-cache` disables exact, semantic, and vulnerability snapshot reads and writes for that invocation.

Delete cached source-derived data with:

```bash
guardscan cache clear --repo --force
guardscan cache clear --all --force
```

`cache clear` does not delete the telemetry outbox. Use `telemetry clear` for that data, or `guardscan reset --all --force` when you intend to reset all GuardScan configuration and state.

## Your controls

You can:

- keep GuardScan offline;
- choose a local or cloud AI provider;
- omit AI features entirely;
- disable cache reads and writes per invocation;
- inspect and clear repository or global caches;
- leave telemetry disabled; and
- inspect, explicitly synchronize, or delete queued telemetry.

For a sensitive privacy question, contact <ntanwir10@outlook.com>. Do not include source code, credentials, or proprietary findings in a public issue.
