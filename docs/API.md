# API Documentation

Backend API documentation for GuardScan.

## Base URL

```
Production: https://api.guardscan.dev
Development: http://localhost:8787
```

## Authentication

Currently, authentication is done via `client_id` passed in request bodies. No API keys required for basic usage.

## Endpoints

### Health Check

Check API status.

**Endpoint:** `GET /health`

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

### Validate Credits

Validate if client has sufficient credits for a review.

**Endpoint:** `POST /api/validate`

**Request Body:**

```json
{
  "clientId": "uuid-here",
  "repoId": "hashed-repo-id",
  "locCount": 1250
}
```

**Response:**

```json
{
  "allowed": true,
  "remainingLoc": 8750
}
```

**Status Codes:**
- `200`: Success
- `400`: Invalid request
- `500`: Server error

---

### Submit Telemetry

Submit anonymized telemetry data.

**Endpoint:** `POST /api/telemetry`

**Request Body:**

```json
{
  "clientId": "uuid-here",
  "repoId": "hashed-repo-id",
  "events": [
    {
      "action": "review",
      "loc": 350,
      "durationMs": 2100,
      "model": "gpt-4",
      "timestamp": 1705320000000
    }
  ]
}
```

**Response:**

```json
{
  "status": "ok"
}
```

**Status Codes:**
- `200`: Success
- `400`: Invalid request
- `500`: Server error

---

### Get Credits

Get remaining credit balance for a client.

**Endpoint:** `GET /api/credits/:clientId`

**Parameters:**
- `clientId` (path): Client UUID

**Response:**

```json
{
  "clientId": "uuid-here",
  "remainingLoc": 5000,
  "plan": "tier_2"
}
```

**Status Codes:**
- `200`: Success
- `404`: Client not found
- `500`: Server error

---

### Stripe Webhook

Handle Stripe payment webhooks.

**Endpoint:** `POST /api/stripe-webhook`

**Headers:**
- `stripe-signature`: Webhook signature for verification

**Events Handled:**
- `checkout.session.completed`: Credit purchase completed
- `invoice.payment_failed`: Payment failed

**Response:**

```json
{
  "received": true
}
```

**Status Codes:**
- `200`: Success
- `400`: Invalid signature
- `500`: Server error

---

## Rate Limiting

Currently no rate limiting is implemented. Consider adding rate limiting in production:

- 100 requests per minute per client_id
- 1000 requests per hour per IP

## Error Responses

All errors return JSON in this format:

```json
{
  "error": "Error message here"
}
```

## CORS

CORS is enabled for all origins (`*`). Restrict in production if needed.

## Webhook Security

### Stripe Webhooks

Stripe webhooks are verified using the signature from the `stripe-signature` header. Always verify signatures before processing events.

Example verification:

```typescript
const signature = request.headers.get('stripe-signature');
const event = stripe.webhooks.constructEvent(
  body,
  signature,
  webhookSecret
);
```

## Data Privacy

- No source code is transmitted or stored
- Repository IDs are cryptographically hashed
- Client IDs are UUIDs with no PII
- Telemetry is anonymized and aggregated

## Client Libraries

### JavaScript/TypeScript

```typescript
import { APIClient } from 'ai-code-review';

const client = new APIClient('https://api.guardscan.dev');

// Validate credits
const validation = await client.validate({
  clientId: 'uuid',
  repoId: 'hash',
  locCount: 1000,
});

// Get credits
const credits = await client.getCredits('uuid');

// Send telemetry
await client.sendTelemetry({
  clientId: 'uuid',
  repoId: 'hash',
  events: [...],
});
```

### cURL Examples

**Validate Credits:**

```bash
curl -X POST https://api.guardscan.dev/api/validate \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "uuid",
    "repoId": "hash",
    "locCount": 1000
  }'
```

**Get Credits:**

```bash
curl https://api.guardscan.dev/api/credits/uuid
```

**Submit Telemetry:**

```bash
curl -X POST https://api.guardscan.dev/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "uuid",
    "repoId": "hash",
    "events": [
      {
        "action": "review",
        "loc": 350,
        "durationMs": 2100,
        "model": "gpt-4",
        "timestamp": 1705320000000
      }
    ]
  }'
```

## Status Monitoring

Monitor API status at: https://status.guardscan.dev (if implemented)

## Support

For API issues or questions:
- GitHub Issues: https://github.com/yourusername/ai-code-review/issues
- Email: api-support@guardscan.dev
