# ADR 003: Privacy-First Architecture

## Status
Accepted

## Date
2024-11-19

## Context
GuardScan is a code analysis and security scanning tool that processes potentially sensitive source code. Users rightfully have concerns about:

1. **Code privacy** - Source code should never leave their machines
2. **Data ownership** - Users own their code and analysis results
3. **Vendor trust** - Minimal trust required in third-party services
4. **Compliance** - GDPR, CCPA, SOC 2, ISO 27001 requirements
5. **Transparency** - Clear understanding of what data (if any) is collected

Traditional SaaS code analysis tools typically:
- Upload source code to cloud servers
- Analyze code on vendor infrastructure
- Store code and results in vendor databases
- Require significant trust from users

This model is problematic for:
- Enterprises with strict data policies
- Developers working on confidential projects
- Organizations in regulated industries
- Privacy-conscious developers

## Decision
We adopted a **privacy-first, client-side architecture** where:

1. **All code analysis happens locally** on the user's machine
2. **Source code never leaves the user's environment**
3. **Telemetry is optional** and **anonymized**
4. **AI features require user's own API keys** (BYOK - Bring Your Own Key)
5. **No user accounts or authentication required**
6. **Open source** for full transparency

## Rationale

### Core Privacy Principles

1. **Zero Trust Model**
   - We don't want access to user code
   - We can't see what we don't receive
   - No code = no liability, no compliance burden
   - Users retain complete control

2. **Local-First Processing**
   - All scanning, analysis, and metrics computed locally
   - No dependency on backend availability
   - Works completely offline
   - Fast (no network latency)

3. **Optional, Anonymized Telemetry**
   - **Opt-in only** (disabled by default with `--no-telemetry`)
   - **No source code** sent
   - **No file names** or paths
   - **Only anonymized metadata**: LOC counts, action types, duration
   - **Client ID**: Random UUID (not tied to identity)
   - **Repo ID**: Cryptographic hash of git remote URL
   
4. **BYOK for AI Features**
   - Users provide their own API keys (OpenAI, Claude, Gemini, etc.)
   - AI requests go directly from user to AI provider
   - We never see API keys or AI requests/responses
   - Users control costs and usage

5. **Open Source Transparency**
   - Full source code available on GitHub
   - Users can audit exactly what is collected
   - Can be forked and self-hosted
   - Community can verify privacy claims

### What We Collect (Optional Telemetry)

**Metadata Only:**
```json
{
  "clientId": "uuid-generated-locally",  // Random UUID, not tied to user
  "repoId": "sha256-hash-of-git-remote", // One-way hash
  "events": [{
    "action": "scan",                    // Action type (scan, review, etc.)
    "loc": 10000,                        // Lines of code analyzed
    "durationMs": 5000,                  // How long it took
    "model": "gpt-4",                    // Which AI model used (if any)
    "timestamp": 1700000000000,          // When it happened
    "metadata": {                        // Generic metadata
      "language": "typescript"           // Programming language
    }
  }]
}
```

**Never Collected:**
- ❌ Source code
- ❌ File names or paths
- ❌ Variable/function names
- ❌ Code structure or AST
- ❌ Security findings (specific vulnerabilities)
- ❌ User identity (name, email, IP)
- ❌ API keys
- ❌ Git commit messages or diffs
- ❌ Environment variables

### Why Collect Telemetry at All?

**Product Improvement:**
- Understand which features are used
- Identify performance bottlenecks
- Prioritize development efforts
- Track adoption and growth

**Error Monitoring:**
- Crash reports (stack traces only, no code)
- API errors (generic errors, no request content)
- Performance issues

**Business Metrics:**
- Active users (counted anonymously)
- Feature adoption rates
- Geographic distribution (for CDN optimization)

**Important:** All telemetry is **optional** and can be:
- Disabled with `--no-telemetry` flag
- Disabled in config: `"telemetryEnabled": false`
- Worked around by firewall/network blocks (graceful degradation)

## Consequences

### Positive
- **User trust**: Users know their code is safe
- **Compliance**: No data = no GDPR/CCPA/SOC2 compliance burden
- **Performance**: Local analysis is faster than cloud
- **Offline**: Works without internet connection
- **Cost**: No expensive cloud processing
- **Enterprise-friendly**: Meets strictest security policies

### Negative
- **Limited insights**: Can't see actual code to help debug
- **Harder to support**: Can't reproduce issues without access
- **Feature limitations**: Some features harder without backend
  - *Mitigation*: BYOK model for AI features
  - *Mitigation*: Local vector embeddings for RAG
- **Adoption metrics**: Less detailed than typical SaaS
  - *Mitigation*: Optional telemetry provides sufficient insights

### Trade-offs

**What We Give Up:**
1. **Detailed error reports**: Can't see user code causing errors
   - *Mitigation*: Stack traces and logs still useful
   - *Mitigation*: Users can share code voluntarily for debugging

2. **Usage analytics**: Less granular than typical SaaS
   - *Mitigation*: Anonymized telemetry sufficient for product decisions
   - *Mitigation*: User surveys and feedback

3. **Centralized features**: Can't offer cloud-based features easily
   - *Mitigation*: BYOK model for AI
   - *Mitigation*: Local-first alternatives (embeddings, caching)

**What We Gain:**
1. **User trust**: Developers trust tools that respect privacy
2. **Enterprise adoption**: Can be used in highly regulated industries
3. **Competitive advantage**: Differentiation from SaaS competitors
4. **Simplicity**: No user accounts, authentication, or authorization
5. **Lower costs**: No expensive AI API bills on our end

## Implementation Details

### Client-Side Architecture
```
User's Machine:
┌─────────────────────────────────────┐
│ GuardScan CLI                       │
│                                     │
│ ┌─────────────────┐                │
│ │ Code Scanners   │ (all local)    │
│ │ - Secrets       │                │
│ │ - OWASP         │                │
│ │ - Dependencies  │                │
│ └─────────────────┘                │
│                                     │
│ ┌─────────────────┐                │
│ │ AI Features     │ (BYOK)         │
│ │ - Code Review   │ ────────────┐  │
│ │ - Explain       │             │  │
│ │ - Test Gen      │             │  │
│ └─────────────────┘             │  │
│                                  │  │
│ ┌─────────────────┐             │  │
│ │ Telemetry       │ (optional)  │  │
│ │ - Anonymizer    │ ─────┐      │  │
│ │ - Batch Sender  │      │      │  │
│ └─────────────────┘      │      │  │
└──────────────────────────┼──────┼──┘
                           │      │
                           │      │
                      Optional  Direct
                      Metadata   API
                           │      │
                           ▼      ▼
                  ┌──────────┐ ┌────────┐
                  │ Backend  │ │   AI   │
                  │(Our API) │ │Provider│
                  └──────────┘ └────────┘
                  Stores only  User's API
                  anonymized   key required
                  metadata
```

### Privacy Features in Code

**1. Client ID Generation**
```typescript
// Generated once, stored locally
const clientId = crypto.randomUUID();
// Never sent to any identity service
// Never tied to user information
```

**2. Repo ID Hashing**
```typescript
// One-way hash of git remote URL
const repoId = crypto.createHash('sha256')
  .update(gitRemoteUrl)
  .digest('hex');
// Impossible to reverse to original URL
```

**3. Telemetry Anonymization**
```typescript
function anonymizeTelemetry(event: TelemetryEvent): SafeTelemetry {
  return {
    action: event.action,        // Generic action name
    loc: event.loc,              // Numeric count only
    durationMs: event.durationMs,// Timing only
    model: event.model,          // AI model name (if used)
    // ❌ No file paths
    // ❌ No code content
    // ❌ No user identity
    // ❌ No specific findings
  };
}
```

**4. BYOK Implementation**
```typescript
// User's API key stored locally only
const apiKey = config.get('providers.openai.apiKey');

// Direct request to AI provider (not through our backend)
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  headers: {
    'Authorization': `Bearer ${apiKey}`,  // User's key
  },
  body: JSON.stringify({
    messages: [{ role: 'user', content: prompt }]  // User controls prompt
  })
});

// We never see the request or response
```

**5. Offline Mode**
```typescript
// All features work offline except AI (requires user's API key)
if (config.offlineMode) {
  // Disable telemetry
  // Disable update checks
  // All scanning still works
}
```

### Privacy Documentation

1. **README.md**: Clear privacy section
2. **Privacy Policy**: Simple, understandable
3. **Telemetry docs**: Exact data collected
4. **Source code**: Audit-able on GitHub

## Related Decisions
- [ADR 001: Cloudflare Workers Backend](./001-cloudflare-workers-backend.md) - Backend for optional telemetry
- [ADR 005: BYOK AI Model](./005-byok-ai-model.md) - User brings their own AI keys

## Compliance

### GDPR (EU General Data Protection Regulation)
- ✅ No personal data collected (anonymous UUIDs)
- ✅ Opt-in telemetry (consent)
- ✅ Right to be forgotten (delete config file)
- ✅ Data portability (local storage)
- ✅ Transparency (open source)

### CCPA (California Consumer Privacy Act)
- ✅ No personal information sale
- ✅ Opt-out available (`--no-telemetry`)
- ✅ Data access (local files)
- ✅ Data deletion (delete config)

### SOC 2 (Service Organization Control 2)
- ✅ Security: No code transmission
- ✅ Availability: Local-first architecture
- ✅ Confidentiality: No code access
- ✅ Processing integrity: Local validation
- ✅ Privacy: No personal data

## References
- [GDPR Guidelines](https://gdpr.eu/)
- [CCPA Overview](https://oag.ca.gov/privacy/ccpa)
- [Privacy by Design](https://www.privacy-first.com/)
- [Open Source Privacy Benefits](https://opensource.com/article/21/12/open-source-privacy)

## Review
This decision is fundamental and should rarely change. Review if:
- Major feature requires cloud processing
- Privacy regulations significantly change
- Competitive landscape shifts dramatically

**Next review date**: 2025-11-19 (1 year)

