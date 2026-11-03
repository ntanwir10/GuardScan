# Telemetry Collector Rate Limiting

GuardScan does not ship, configure, or operate a hosted collector.
`guardscan telemetry sync` sends one bounded batch to the user-operated HTTPS
endpoint selected with `GUARDSCAN_TELEMETRY_URL`. The former
`api.guardscancli.com` endpoint and `GUARDSCAN_API_URL` setting are retired and
must not be used as collector configuration.

The CLI sends no client or repository identifier. A collector that applies rate limits must therefore use transport-level information such as source IP, an operator-provided authentication mechanism, or aggregate endpoint limits. Collector operators must document their limits, retention, deletion, access-control, and jurisdiction policies independently of GuardScan.

## CLI behavior

- At most `TELEMETRY_CONSTANTS.BATCH_SIZE` oldest events are sent per explicit sync.
- HTTP 408, 429, and 5xx responses are treated as retryable delivery failures.
- Failed and unacknowledged events remain in the local spool.
- GuardScan does not automatically retry or transmit in the background.
- `--offline` and `--no-telemetry` block both recording and delivery.
- `guardscan config --telemetry=false` deletes queued events.

Inspect or clear local state through the CLI rather than editing spool files:

```bash
guardscan telemetry status
guardscan telemetry clear --force
```

## Collector guidance

- Return `429 Too Many Requests` and a standard `Retry-After` header when limiting requests.
- Validate the `guardscan.telemetry.v1` schema and cap request size.
- Deduplicate canonically by `eventId` across batches; `batchId` is request correlation only.
- Return accepted event IDs for partial acknowledgements, and return `duplicate` only for a complete duplicate batch.
- Do not infer that an anonymous event identifies a stable installation or repository.

See [Self-Hosted Telemetry Collector Protocol](./API.md) for the exact request
and acknowledgement contract.
