# Rate Limiting Documentation

## Overview

The GuardScan backend implements rate limiting to prevent abuse and ensure fair resource allocation across all users. Rate limiting is applied to all telemetry and monitoring endpoints.

## Implementation

### Algorithm

- **Sliding Window**: Tracks requests within a time window
- **Per-Client Tracking**: Each client has independent rate limits
- **In-Memory Storage**: Lightweight, fast, edge-compatible
- **Automatic Cleanup**: Expired records are cleaned up every 5 minutes

### Rate Limits

| Endpoint                | Limit        | Window   | Notes                   |
| ----------------------- | ------------ | -------- | ----------------------- |
| `/api/telemetry`        | 100 requests | 1 minute | Per client ID           |
| `/api/monitoring`       | 50 requests  | 1 minute | Per client ID or IP     |
| `/api/monitoring/stats` | 30 requests  | 1 minute | Per IP (admin endpoint) |

## Response Headers

All responses include rate limit information in headers:

```
X-RateLimit-Limit: 100           # Maximum requests allowed
X-RateLimit-Remaining: 95        # Requests remaining in window
X-RateLimit-Reset: 2024-11-17... # When the window resets (ISO 8601)
```

## Rate Limit Exceeded Response

When rate limit is exceeded, the API returns a `429 Too Many Requests` response:

```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again later.",
  "retryAfter": 42,
  "limit": 100
}
```

**Response Headers:**

```
Status: 429 Too Many Requests
Retry-After: 42                  # Seconds until rate limit resets
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 2024-11-17...
```

## Client Identification

### Telemetry Endpoint

- Uses `clientId` from request body
- Each CLI instance has a unique client ID (UUID)
- Stored in `~/.guardscan/config.json`

### Monitoring Endpoint

- Prioritizes `clientId` from usage events
- Falls back to Cloudflare's `CF-Connecting-IP` header
- Last resort: "unknown" (shared rate limit)

### Stats Endpoint

- Uses `CF-Connecting-IP` header (Cloudflare's edge IP detection)
- Falls back to `X-Forwarded-For` header
- Stricter limit (admin/analytics endpoint)

## Configuration

Rate limits can be adjusted in `/backend/src/utils/rate-limiter.ts`:

```typescript
export const rateLimiters = {
  telemetry: new RateLimiter({
    windowMs: 60 * 1000,    // 1 minute
    maxRequests: 100,       // Adjust this value
  }),
  monitoring: new RateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 50,        // Adjust this value
  }),
  monitoringStats: new RateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,        // Adjust this value
  }),
};
```

## Monitoring

Rate limit warnings are logged:

```typescript
console.warn(`Rate limit exceeded for client: ${clientId}`);
```

Check Cloudflare Workers logs for rate limiting activity:

```bash
wrangler tail
```

## Best Practices

### For CLI Users

1. **Batching**: CLI automatically batches telemetry (50 events per sync)
2. **Offline Mode**: Use `--offline` flag to disable telemetry completely
3. **Respect Limits**: Normal usage stays well within limits

### For Backend Operators

1. **Monitor Logs**: Watch for repeated rate limit violations
2. **Adjust Limits**: Tune based on actual usage patterns
3. **Consider Cloudflare**: For production, consider Cloudflare's Rate Limiting product
4. **Add Metrics**: Track rate limit hits in monitoring system

## Advanced: Cloudflare Rate Limiting

For production deployments, consider using [Cloudflare's Rate Limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/):

### Benefits

- Distributed rate limiting across edge network
- More sophisticated rules (IP, headers, etc.)
- DDoS protection
- Persistent storage

### Example Rule

```
(http.request.uri.path eq "/api/telemetry") and
(rate(1m) > 100)
```

**Action**: Block or Challenge

### Migration Path

1. Deploy with in-memory rate limiting (current)
2. Monitor usage patterns for 1-2 weeks
3. Configure Cloudflare rules based on data
4. Gradually shift to Cloudflare Rate Limiting
5. Keep in-memory as fallback

## Testing

### Manual Testing

```bash
# Test telemetry endpoint
for i in {1..105}; do
  curl -X POST https://guardscan-backend.workers.dev/api/telemetry \
    -H "Content-Type: application/json" \
    -d '{
      "clientId": "test-client-123",
      "repoId": "test-repo",
      "events": [{"action": "scan", "loc": 100, "durationMs": 1000, "model": "gpt-4", "timestamp": 1234567890, "metadata": {}}]
    }'
  echo "Request $i"
done

# Should see 429 after 100 requests
```

### Load Testing

```bash
# Install hey (HTTP load generator)
go install github.com/rakyll/hey@latest

# Test with concurrent requests
hey -n 1000 -c 10 -m POST \
  -H "Content-Type: application/json" \
  -d '{"clientId": "load-test", "repoId": "test", "events": [...]}' \
  https://guardscan-backend.workers.dev/api/telemetry
```

### Unit Tests

```typescript
import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('should allow requests within limit', () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 5 });
    
    for (let i = 0; i < 5; i++) {
      const result = limiter.check('test-client');
      expect(result.allowed).toBe(true);
    }
  });

  it('should block requests exceeding limit', () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 5 });
    
    for (let i = 0; i < 5; i++) {
      limiter.check('test-client');
    }
    
    const result = limiter.check('test-client');
    expect(result.allowed).toBe(false);
  });

  it('should reset after window expires', async () => {
    const limiter = new RateLimiter({ windowMs: 100, maxRequests: 1 });
    
    limiter.check('test-client');
    const blocked = limiter.check('test-client');
    expect(blocked.allowed).toBe(false);
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    const allowed = limiter.check('test-client');
    expect(allowed.allowed).toBe(true);
  });
});
```

## Troubleshooting

### CLI Getting Rate Limited

**Symptoms**: `429 Too Many Requests` errors in CLI

**Solutions**:

1. Check if batching is working: `cat ~/.guardscan/cache/telemetry.json`
2. Enable offline mode temporarily: `guardscan scan --offline`
3. Clear local batch: `rm ~/.guardscan/cache/telemetry.json`
4. Contact support if legitimate usage is blocked

### High Rate Limit Hits

**Symptoms**: Many rate limit warnings in logs

**Investigation**:

1. Check client IDs hitting limits
2. Look for patterns (same IP, time of day)
3. Verify batch sizes aren't too large
4. Check for CLI bugs causing excessive requests

**Actions**:

1. Increase limits if legitimate usage
2. Block malicious IPs at Cloudflare level
3. Add authentication for verified users

### Memory Issues

**Symptoms**: Worker exceeding memory limits

**Solutions**:

1. Reduce cleanup interval (more frequent)
2. Add max entries limit
3. Implement LRU cache eviction
4. Consider external storage (KV, Durable Objects)

## Future Enhancements

1. **Persistent Storage**: Use Cloudflare Durable Objects for distributed rate limiting
2. **Token Bucket**: More flexible rate limiting algorithm
3. **Burst Allowance**: Allow short bursts above limit
4. **Per-User Tiers**: Different limits for different user types
5. **Analytics Dashboard**: Visualize rate limit metrics
6. **Auto-Scaling**: Increase limits based on load
7. **Exemptions**: Whitelist trusted clients

## References

- [Cloudflare Rate Limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [RFC 6585 - HTTP Status Code 429](https://tools.ietf.org/html/rfc6585)
- [Rate Limiting Headers](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers)

