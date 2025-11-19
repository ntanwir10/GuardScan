# ADR 001: Cloudflare Workers for Backend Infrastructure

## Status
Accepted

## Date
2024-11-19

## Context
GuardScan needed a backend infrastructure for optional telemetry and monitoring. The backend requirements were:

1. **Minimal operational overhead** - No servers to manage
2. **Global distribution** - Low latency worldwide
3. **Cost-effective** - Pay only for actual usage
4. **Scalability** - Handle variable load automatically
5. **Privacy-first** - Must not store or process sensitive code
6. **Fast cold starts** - Responsive even with infrequent usage

We evaluated several options:
- **Traditional VPS** (DigitalOcean, Linode)
- **Serverless Functions** (AWS Lambda, Google Cloud Functions, Azure Functions)
- **Cloudflare Workers**
- **Vercel Edge Functions**
- **Self-hosted** (requires user infrastructure)

## Decision
We chose **Cloudflare Workers** as the backend infrastructure for GuardScan's optional telemetry and monitoring services.

## Rationale

### Advantages of Cloudflare Workers

1. **Edge Network Performance**
   - Runs on Cloudflare's global edge network (275+ cities)
   - <50ms response times globally
   - No cold starts (Workers are always warm)

2. **Cost Structure**
   - Free tier: 100,000 requests/day
   - Paid tier: $5/month for 10M requests
   - Extremely cost-effective for telemetry workloads
   - No bandwidth charges

3. **Developer Experience**
   - Simple TypeScript/JavaScript development
   - `wrangler` CLI for deployment and management
   - Built-in KV storage for caching and rate limiting
   - Seamless integration with other Cloudflare services

4. **Operational Benefits**
   - Zero infrastructure management
   - Automatic scaling
   - Built-in DDoS protection
   - 99.99% uptime SLA

5. **Privacy Alignment**
   - Data stays on Cloudflare's infrastructure
   - No data leaves the edge network unnecessarily
   - GDPR/CCPA compliant infrastructure
   - Can be self-hosted if needed (Cloudflare for Teams)

### Alternatives Considered

**AWS Lambda**
- ✅ Mature ecosystem, extensive integrations
- ❌ Cold starts (100-500ms)
- ❌ More complex deployment
- ❌ Higher costs for global distribution
- ❌ Requires API Gateway for HTTP endpoints

**Google Cloud Functions**
- ✅ Good integration with GCP services
- ❌ Cold starts
- ❌ Less edge presence than Cloudflare
- ❌ More expensive for high-volume telemetry

**Vercel Edge Functions**
- ✅ Excellent developer experience
- ✅ Good for frontend-focused apps
- ❌ More expensive than Cloudflare
- ❌ Limited to 1MB response size
- ❌ Primarily designed for frontend, not backend APIs

**Traditional VPS**
- ✅ Full control over infrastructure
- ❌ Requires manual scaling
- ❌ Operational overhead (updates, security, monitoring)
- ❌ Single region unless multi-region deployment
- ❌ Fixed costs regardless of usage

## Consequences

### Positive
- **Fast deployments**: `wrangler deploy` takes ~10 seconds
- **Global performance**: Sub-100ms response times worldwide
- **Cost savings**: Free tier sufficient for most users
- **Reliability**: Leverages Cloudflare's battle-tested infrastructure
- **Security**: Built-in DDoS protection and Web Application Firewall

### Negative
- **Vendor lock-in**: Some lock-in to Cloudflare ecosystem
  - *Mitigation*: Workers code is portable TypeScript/JavaScript
  - *Mitigation*: Can deploy to other edge platforms with minimal changes
- **Execution limits**: 
  - 50ms CPU time on free tier (sufficient for our use case)
  - 128MB memory limit
  - *Mitigation*: Our telemetry API is lightweight and well within limits
- **Learning curve**: Team needs to learn Workers-specific APIs
  - *Mitigation*: Workers API is similar to Service Workers
  - *Mitigation*: Excellent documentation and community support

### Risks
1. **Cloudflare outages**: Rare but possible
   - *Mitigation*: Telemetry is optional, CLI continues working
   - *Mitigation*: Graceful degradation in client code

2. **Pricing changes**: Cloudflare could change pricing
   - *Mitigation*: Telemetry can be disabled
   - *Mitigation*: Backend can be ported to other platforms

3. **Feature limitations**: Workers may not support all future features
   - *Mitigation*: For complex features, use Workers + other services
   - *Mitigation*: Cloudflare continuously adds new capabilities

## Implementation Details

### Tech Stack
- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Database**: Supabase PostgreSQL (accessed via REST API)
- **Caching**: Cloudflare KV
- **Rate Limiting**: Cloudflare KV + in-memory fallback
- **Deployment**: Wrangler CLI

### Key Design Decisions
1. **Stateless workers**: No shared state between requests
2. **KV for persistence**: Use KV for rate limiting and caching
3. **REST API to Supabase**: Database calls over HTTP (no direct Postgres connection)
4. **Graceful degradation**: If Supabase unavailable, accept but don't store telemetry

### Performance Characteristics
- **Latency**: p50 ~20ms, p95 ~50ms, p99 ~100ms
- **Throughput**: 1000+ requests/second per Worker instance
- **Cold starts**: None (Workers are always warm)
- **Memory**: ~10-20MB per request

## Related Decisions
- [ADR 002: Supabase PostgreSQL](./002-supabase-postgresql.md) - Why we chose Supabase for database
- [ADR 003: Privacy-First Architecture](./003-privacy-first-architecture.md) - Privacy guarantees

## References
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers KV](https://developers.cloudflare.com/kv/)

## Review
This decision should be reviewed if:
- Cloudflare significantly changes pricing or features
- We need features not available on Workers
- We experience significant operational issues
- A clearly superior alternative emerges

**Next review date**: 2025-05-19 (6 months)

