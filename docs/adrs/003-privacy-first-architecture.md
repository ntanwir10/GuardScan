# ADR 003: Privacy-First Architecture

## Status

Accepted; amended July 20, 2026.

## Context

GuardScan analyzes sensitive repositories. Its product contract must distinguish built-in local scanning, user-selected AI providers, public advisory services, local caches, and optional GuardScan telemetry.

## Decision

- Built-in static analysis runs locally and does not upload source to GuardScan.
- Cloud AI is BYOK and sends selected context directly to the configured provider; loopback Ollama and LM Studio remain local options.
- Offline mode blocks GuardScan cloud AI, cloud embeddings, advisory lookups, update checks, and telemetry recording and delivery.
- Telemetry is disabled by default, requires explicit consent, queues locally, and is delivered only by `guardscan telemetry sync` to a user-configured HTTPS collector.
- Telemetry contains only event ID, action category, aggregate LOC, duration, coarse execution mode, and timestamp.
- Telemetry excludes installation and repository identifiers, source, paths, prompts, responses, findings, model names, languages, errors, dependency data, and arbitrary metadata.
- Disabling telemetry deletes queued events. Local telemetry is retained for at most 30 days and 1,000 events while consent remains enabled.
- API credentials and source-derived caches are stored locally with restrictive permissions and explicit clearing commands.

## Consequences

- GuardScan cannot correlate anonymous telemetry across installations or repositories.
- Product analytics are intentionally limited to explicitly synchronized aggregate events.
- Cloud-provider and advisory-service privacy terms remain separate from GuardScan telemetry.
- The CLI remains useful without a GuardScan backend, account, or network connection.
- Privacy regressions require release-blocking tests for persistent and command-level offline controls.

## Active contract

The wire schema is `guardscan.telemetry.v1`; see [API Documentation](../API.md). The earlier client-ID, repository-hash, free-form metadata, monitoring endpoint, and automatic batching designs are retired and are not compatibility contracts.
