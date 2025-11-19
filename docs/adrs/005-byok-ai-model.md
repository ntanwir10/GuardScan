# ADR 005: BYOK (Bring Your Own Key) AI Model

## Status
Accepted

## Date
2024-11-19

## Context
GuardScan includes AI-enhanced features like code review, explanation, test generation, and refactoring suggestions. These features require Large Language Models (LLMs) which have several cost and privacy considerations:

1. **Cost**: AI API calls are expensive ($0.01-$0.10 per request)
2. **Privacy**: Sending code to AI providers raises concerns
3. **Control**: Users want choice in AI provider and model
4. **Vendor lock-in**: Don't want dependency on single AI provider
5. **Sustainability**: Hard to offer free AI features at scale

Traditional SaaS approaches:
- **Vendor-paid**: Company pays for all AI calls (expensive, unsustainable)
- **Subscription**: Users pay monthly fee (bundled cost, inflexible)
- **Credit system**: Pre-purchase credits (complexity, vendor lock-in)

## Decision
We adopted a **BYOK (Bring Your Own Key)** model where:

1. **Users provide their own AI API keys**
2. **Requests go directly from user to AI provider** (not through our backend)
3. **Support multiple AI providers** (OpenAI, Anthropic, Google, Ollama, etc.)
4. **Local AI option** (Ollama, LM Studio for full privacy)
5. **No AI costs for GuardScan** (users control their own spending)

## Rationale

### Advantages of BYOK

1. **User Control**
   - Choose their preferred AI provider
   - Select specific models (GPT-4, Claude, Gemini, etc.)
   - Control spending and usage limits
   - Switch providers anytime

2. **Privacy**
   - Direct requests to AI provider (we never see requests/responses)
   - Can use local AI (Ollama) for 100% privacy
   - No middleman processing code
   - Users trust their chosen provider

3. **Cost Transparency**
   - Users see exact AI costs on their bill
   - No markup or bundled pricing
   - Pay for what they use
   - Can optimize by choosing cheaper models

4. **Flexibility**
   - Try different models for different tasks
   - Use free tiers (Ollama, LM Studio)
   - Upgrade to premium models when needed
   - No vendor lock-in

5. **Sustainability**
   - No AI costs for GuardScan
   - Scales without financial burden
   - Removes barrier to open-sourcing
   - Community can contribute without cost concerns

### Real-World Cost Analysis

**Traditional SaaS Approach:**
```
Average user: 100 AI requests/month
Cost per request: $0.05 (GPT-4)
Monthly cost: $5/user

1,000 users = $5,000/month
10,000 users = $50,000/month  // Unsustainable! ❌
```

**BYOK Approach:**
```
GuardScan cost: $0
User pays: $5/month directly to OpenAI
User can optimize:
- GPT-3.5: $1/month (cheaper model)
- Ollama: $0/month (local AI)

Result: Sustainable at any scale ✅
```

### User Experience

**Setup Process:**
```bash
# 1. Get API key from provider (OpenAI example)
# Visit: https://platform.openai.com/api-keys
# Create key: sk-proj-...

# 2. Configure GuardScan
guardscan config set providers.openai.apiKey sk-proj-...
guardscan config set providers.openai.model gpt-4

# 3. Use AI features
guardscan review src/app.ts
guardscan explain src/utils.ts
guardscan test-gen src/calculator.ts
```

**Supported Providers:**
- **OpenAI**: GPT-3.5, GPT-4, GPT-4-Turbo
- **Anthropic**: Claude 3 Opus, Sonnet, Haiku
- **Google**: Gemini Pro, Gemini Ultra
- **Ollama**: Any local model (Llama 2, Mistral, CodeLlama)
- **LM Studio**: Local models with UI
- **OpenRouter**: Access to multiple models via one API

### Privacy Benefits

**Traditional (Code through GuardScan backend):**
```
User -> GuardScan Backend -> AI Provider
      ❌ GuardScan sees code
      ❌ Additional hop
      ❌ Potential logging
```

**BYOK (Direct to AI Provider):**
```
User -> AI Provider (direct)
      ✅ GuardScan never sees code
      ✅ Faster (no middleman)
      ✅ User controls data
```

**Local AI (Ultimate Privacy):**
```
User -> Ollama (localhost)
      ✅ Code never leaves machine
      ✅ 100% privacy
      ✅ Free
      ✅ Offline capable
```

## Consequences

### Positive
- **Sustainable**: No AI costs for GuardScan
- **Transparent**: Users see real costs
- **Flexible**: Support any AI provider
- **Private**: Direct requests, or local AI
- **Scalable**: Works at any user count
- **Open-source friendly**: No API costs blocking contributions

### Negative
- **Setup friction**: Users must get API keys
  - *Mitigation*: Clear documentation with screenshots
  - *Mitigation*: Support for free Ollama/LM Studio
  - *Mitigation*: CLI guides users through setup
  
- **Support burden**: Users may have issues with AI providers
  - *Mitigation*: Document common issues per provider
  - *Mitigation*: Link to provider documentation
  - *Mitigation*: Community can help in discussions
  
- **Usage limits**: Users hit AI provider rate limits
  - *Mitigation*: Implement retry logic with backoff
  - *Mitigation*: Batch requests where possible
  - *Mitigation*: Cache AI responses locally

### Trade-offs

**What We Give Up:**
- Seamless "just works" experience (requires setup)
- Revenue from AI markup (not our business model anyway)
- Central rate limiting (each user has their own)

**What We Gain:**
- Financial sustainability
- User trust (privacy)
- Flexibility (any AI provider)
- Open-source viability

## Implementation Details

### Provider Interface
```typescript
interface AIProvider {
  name: string;
  
  // Generate text completion
  complete(prompt: string, options?: CompletionOptions): Promise<string>;
  
  // Stream completion (for chat)
  completeStream(
    prompt: string,
    onToken: (token: string) => void,
    options?: CompletionOptions
  ): Promise<void>;
  
  // Count tokens (for cost estimation)
  countTokens(text: string): number;
  
  // Estimate cost
  estimateCost(prompt: string, completion: string): number;
}
```

### Provider Factory
```typescript
class ProviderFactory {
  static create(config: ProviderConfig): AIProvider {
    switch (config.provider) {
      case 'openai':
        return new OpenAIProvider(config.apiKey, config.model);
      case 'claude':
        return new ClaudeProvider(config.apiKey, config.model);
      case 'gemini':
        return new GeminiProvider(config.apiKey, config.model);
      case 'ollama':
        return new OllamaProvider(config.baseUrl, config.model);
      case 'lmstudio':
        return new LMStudioProvider(config.baseUrl, config.model);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }
}
```

### Configuration Storage
```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-proj-...",  // Stored locally, never sent to GuardScan
      "model": "gpt-4",
      "baseUrl": "https://api.openai.com/v1",
      "maxTokens": 4096,
      "temperature": 0.7
    },
    "ollama": {
      "enabled": true,
      "baseUrl": "http://localhost:11434",
      "model": "codellama"
    }
  },
  "defaultProvider": "openai"
}
```

### Request Flow
```typescript
async function reviewCode(filePath: string): Promise<string> {
  // 1. Load config
  const config = await loadConfig();
  const providerConfig = config.providers[config.defaultProvider];
  
  // 2. Create provider
  const provider = ProviderFactory.create(providerConfig);
  
  // 3. Prepare prompt
  const code = await fs.readFile(filePath, 'utf-8');
  const prompt = `Review this code for security issues:\n\n${code}`;
  
  // 4. Send directly to AI provider (not through our backend)
  const review = await provider.complete(prompt);
  
  // 5. Return result
  return review;
}
```

### Cost Estimation
```typescript
function estimateCost(prompt: string, model: string): number {
  const tokenCount = estimateTokens(prompt);
  
  const pricing: Record<string, number> = {
    'gpt-4': 0.03,          // $0.03 per 1K tokens
    'gpt-3.5-turbo': 0.002, // $0.002 per 1K tokens
    'claude-3-opus': 0.015, // $0.015 per 1K tokens
    'claude-3-sonnet': 0.003, // $0.003 per 1K tokens
    'ollama': 0,            // Free (local)
  };
  
  return (tokenCount / 1000) * (pricing[model] || 0);
}

// Show before API call
console.log(`Estimated cost: $${estimateCost(prompt, model).toFixed(4)}`);
```

## Alternatives Considered

**Vendor-Paid AI**
- ✅ Seamless user experience
- ❌ Unsustainable costs
- ❌ Forces subscription model
- ❌ $50k+/month at scale

**Subscription with Bundled AI**
- ✅ Predictable revenue
- ❌ Overhead pricing (need markup)
- ❌ Users pay even if not using AI
- ❌ Vendor lock-in

**Credit System**
- ✅ Pay-per-use
- ❌ Complex to implement
- ❌ Requires payment processing
- ❌ Users must pre-purchase

**Enterprise-Only AI**
- ✅ Higher willingness to pay
- ❌ Excludes individual developers
- ❌ Limits adoption
- ❌ Against open-source ethos

## User Education

### Documentation
1. **Provider Setup Guides**: Step-by-step for each provider
2. **Cost Comparison**: Help users choose cost-effective options
3. **Privacy Guide**: Explain data flow for each provider
4. **Troubleshooting**: Common issues and solutions

### In-App Guidance
```
$ guardscan review app.ts

⚠️  No AI provider configured. AI features require an API key.

Options:
1. OpenAI (GPT-4): https://platform.openai.com/api-keys
2. Anthropic (Claude): https://console.anthropic.com/
3. Ollama (Free, Local): https://ollama.ai/

Or run: guardscan config set providers.openai.apiKey YOUR_KEY
```

## Related Decisions
- [ADR 003: Privacy-First Architecture](./003-privacy-first-architecture.md) - Why direct requests
- [ADR 001: Cloudflare Workers Backend](./001-cloudflare-workers-backend.md) - Why no AI proxy

## References
- [OpenAI API Pricing](https://openai.com/pricing)
- [Anthropic Pricing](https://www.anthropic.com/pricing)
- [Ollama](https://ollama.ai/)
- [LM Studio](https://lmstudio.ai/)

## Review
This decision is strategic and should rarely change. Review if:
- AI pricing drops significantly (making vendor-paid viable)
- New business model emerges
- User feedback strongly negative

**Next review date**: 2025-05-19 (6 months)

