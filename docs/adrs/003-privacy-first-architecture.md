# ADR 003: Privacy-First Architecture

## Status

Accepted; amended August 2, 2026.

## Context

GuardScan analyzes sensitive repositories. Its product contract must distinguish built-in local scanning, user-selected AI providers, public advisory services, local caches, and optional GuardScan telemetry.

## Decision

- Built-in static analysis runs locally and does not upload source to GuardScan.
- Cloud AI is BYOK and sends selected context directly to the configured provider; loopback Ollama and LM Studio remain local options.
- Offline mode blocks GuardScan cloud AI, cloud embeddings, advisory lookups, update checks, and telemetry recording and delivery.
- Telemetry is disabled by default, requires explicit consent, queues locally,
  and is delivered only by `guardscan telemetry sync` to a user-operated HTTPS
  collector selected with `GUARDSCAN_TELEMETRY_URL`.
- GuardScan does not operate a hosted telemetry collector or provide a default
  endpoint. The former Cloudflare service at `api.guardscancli.com` is retired
  under [ADR 007](./007-retire-hosted-cloudflare-telemetry.md).
- Telemetry contains only event ID, action category, aggregate LOC, duration, coarse execution mode, and timestamp.
- Telemetry excludes installation and repository identifiers, source, paths, prompts, responses, findings, model names, languages, errors, dependency data, and arbitrary metadata.
- Disabling telemetry deletes queued events. Local telemetry is retained for at most 30 days and 1,000 events while consent remains enabled.
- API credentials and source-derived caches are stored locally with restrictive permissions and explicit clearing commands.

## Consequences

- GuardScan cannot correlate anonymous telemetry across installations or repositories.
- GuardScan receives no first-party product telemetry. A user-operated
  collector may receive only explicitly synchronized aggregate events.
- Cloud-provider and advisory-service privacy terms remain separate from GuardScan telemetry.
- The CLI remains useful without a GuardScan backend, account, or network connection.
- Privacy regressions require release-blocking tests for persistent and command-level offline controls.

## Active contract

The self-hosted collector wire schema is `guardscan.telemetry.v1`; see
[API Documentation](../API.md). The earlier client-ID, repository-hash,
free-form metadata, hosted monitoring endpoint, automatic batching, and
`GUARDSCAN_API_URL` designs are retired and are not compatibility contracts.
