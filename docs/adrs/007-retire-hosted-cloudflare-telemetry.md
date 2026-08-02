# ADR 007: Retire GuardScan-Hosted Cloudflare Telemetry

## Status

Accepted.

Supersedes [ADR 001](./001-cloudflare-workers-backend.md).

## Date

2026-08-02

## Context

GuardScan originally operated an optional telemetry backend on Cloudflare
Workers at `api.guardscancli.com`. The current CLI is local-first, has no
account requirement, and already supports a stricter model: telemetry is
disabled by default, queued locally after explicit consent, and synchronized
only when the user names a collector and runs `guardscan telemetry sync`.

Continuing to operate a first-party ingestion service adds infrastructure,
privacy, retention, incident-response, and legacy-client obligations without
being necessary for the CLI product. The private `GuardScan-Monitoring`
repository may still support future Prometheus/Grafana work, but it is not a
GuardScan telemetry service or a compatibility promise to CLI users.

## Decision

- Permanently retire the GuardScan-hosted Cloudflare Worker and
  `api.guardscancli.com` telemetry service.
- GuardScan will not provide a default or implicit telemetry endpoint.
- Self-hosted telemetry remains available only through an explicit
  `GUARDSCAN_TELEMETRY_URL` value and the `guardscan telemetry sync` command.
- The legacy `GUARDSCAN_API_URL` setting is not part of the new contract.
- Consent allows events to be queued locally; it does not authorize background
  delivery. Queued events remain local until an explicit successful sync or an
  explicit clear/disable/reset action.
- After `1.1.0` is published, the retired endpoint will return `410 Gone` for
  seven days without accepting, storing, or redirecting telemetry. The hosted
  route is then deleted. Ownership of the apex domain and GuardScan website is
  retained.
- `GuardScan-Monitoring` remains private and unchanged for possible future
  Grafana work. Reusing it for CLI ingestion would require a new ADR and a new
  explicit user contract.

## Migration

- Users of `1.0.5` and earlier should upgrade to `1.1.0` or disable telemetry
  before the hosted endpoint is retired:

  ```bash
  guardscan config --telemetry=false
  ```

- Operators of a compatible self-hosted collector must replace
  `GUARDSCAN_API_URL` with `GUARDSCAN_TELEMETRY_URL`.
- No queued event is migrated to GuardScan or another provider. Existing local
  queues remain on the user's machine and retain the documented inspection,
  explicit-sync, and deletion controls.
- The retired endpoint must not redirect. Older clients followed redirects,
  which could forward telemetry to a different origin without a new user
  decision.

## Consequences

### Positive

- GuardScan no longer operates a telemetry ingestion or storage service.
- The network contract is explicit, local-first, and controlled by the user or
  self-hosted collector operator.
- Cloudflare deployment, Worker, KV, DNS-route, and telemetry-data obligations
  can be retired independently of the CLI.

### Negative

- GuardScan receives no first-party product telemetry.
- Existing self-hosted operators must update the environment variable name.
- Older clients may attempt the retired endpoint until they are upgraded or
  telemetry is disabled; the temporary `410 Gone` response makes that failure
  explicit without forwarding or accepting data.

## Unchanged contracts

- `guardscancli.com`, the GuardScan website, schema identifiers, package
  metadata, and SBOM namespaces remain active.
- BYOK AI requests continue to go directly to the provider selected by the
  user.
- Local static analysis, advisory lookups, update checks, and the private
  `GuardScan-Monitoring` roadmap are separate decisions.

## Related decisions

- [ADR 001: Cloudflare Workers for Backend Infrastructure](./001-cloudflare-workers-backend.md)
- [ADR 003: Privacy-First Architecture](./003-privacy-first-architecture.md)
- [ADR 005: BYOK AI Model](./005-byok-ai-model.md)
