# API Documentation

GuardScan is local-first and BYOK. Built-in scanners do not send source code to GuardScan services. Cloud AI requests go directly to the provider selected by the user.

## Optional telemetry

Telemetry is anonymous, opt-in, and delivered only by an explicit `guardscan telemetry sync`. Recording and delivery are suppressed when telemetry consent is disabled, persistent offline mode is enabled, `GUARDSCAN_OFFLINE=true`, `GUARDSCAN_NO_TELEMETRY=true`, `--offline`, or `--no-telemetry` applies.

### Endpoint

```text
POST /api/telemetry
```

### Request: `guardscan.telemetry.v1`

```json
{
  "schemaVersion": "guardscan.telemetry.v1",
  "batchId": "00000000-0000-4000-8000-000000000001",
  "sentAt": 1705320001000,
  "cliVersion": "1.1.0",
  "events": [
    {
      "eventId": "00000000-0000-4000-8000-000000000002",
      "action": "review",
      "loc": 350,
      "durationMs": 2100,
      "executionMode": "cloud-ai",
      "occurredAt": 1705320000000
    }
  ]
}
```

The payload never includes installation or repository identifiers, source, paths, prompts, responses, findings, model names, errors, dependency names, or arbitrary metadata.

### Response

```json
{
  "status": "accepted",
  "batchId": "00000000-0000-4000-8000-000000000001",
  "accepted": 1,
  "acceptedEventIds": ["00000000-0000-4000-8000-000000000002"]
}
```

`status` is `accepted` or `duplicate`. `eventId` is the canonical idempotency
key across batches. A partial `accepted` acknowledgement must list exactly the
accepted requested IDs. A `duplicate` acknowledgement is valid only when it
covers the complete batch; when IDs are included they must equal the complete
requested set. Inconsistent, unknown, failed, or unacknowledged events stay
local.

## Local CLI output

Use CI mode for machine-readable scan output:

```bash
guardscan --no-telemetry scan --ci --offline --format json --output guardscan-results.json
guardscan --no-telemetry security --ci --format sarif --output guardscan.sarif
```

The JSON report schema is `guardscan.scan.v1`. SARIF output uses SARIF 2.1.0.
