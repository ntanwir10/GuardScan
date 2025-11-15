# GuardScan AI Features - Implementation Decisions

**Version**: 1.0.0
**Last Updated**: 2025-11-15

This document outlines key technical decisions needed before implementation.

---

## Decision 1: Embedding Provider

### Options

| Option | Pros | Cons | Cost | Recommendation |
|--------|------|------|------|----------------|
| **OpenAI text-embedding-3-small** | • High quality<br>• 1536 dimensions<br>• Good for code<br>• Fast | • Requires API key<br>• Costs money<br>• Cloud dependency | $0.02/1M tokens<br>(~$1 for 100k LOC) | ✅ **Best for cloud** |
| **Ollama (nomic-embed-text)** | • 100% local<br>• Free<br>• Privacy-first<br>• No API needed | • Requires Ollama install<br>• Slower (CPU)<br>• Lower quality | $0 | ✅ **Best for privacy** |
| **Sentence Transformers (local)** | • Good quality<br>• Free<br>• Python library | • Requires Python<br>• Setup complexity<br>• Slower | $0 | ⚠️ **Complex setup** |
| **ChromaDB (built-in)** | • Includes embeddings<br>• All-in-one<br>• Easy setup | • Less control<br>• Tied to ChromaDB | $0 | ⚠️ **Vendor lock-in** |

### Recommendation

**Hybrid Approach**:
```typescript
// Auto-detect and fall back
if (config.provider === 'openai' && config.apiKey) {
  return new OpenAIEmbeddings();
} else if (isOllamaInstalled()) {
  return new OllamaEmbeddings();
} else {
  console.warn('No embedding provider. Using basic search.');
  return new KeywordSearch();  // Fallback
}
```

**Rationale**:
- Users with OpenAI/Claude can use cloud embeddings
- Privacy-focused users can use Ollama
- Degrades gracefully without embeddings (keyword search)

---

## Decision 2: Vector Storage

### Options

| Option | Pros | Cons | Storage | Recommendation |
|--------|------|------|---------|----------------|
| **JSON files + In-memory search** | • Simple<br>• No dependencies<br>• Fast for small codebases | • Slow for >10k chunks<br>• Memory intensive<br>• No indexing | ~100MB/100k LOC | ✅ **Start here (MVP)** |
| **SQLite + vector extension** | • SQL queries<br>• Good performance<br>• Single file | • Requires native extension<br>• Setup complexity | ~80MB/100k LOC | ⚠️ **Complex** |
| **ChromaDB** | • Purpose-built<br>• Good API<br>• Built-in embeddings | • Extra dependency<br>• ~50MB install<br>• Overkill for small | ~120MB/100k LOC | ✅ **Good for scale** |
| **LanceDB** | • Excellent performance<br>• Columnar storage<br>• Production-ready | • Rust dependency<br>• Larger install<br>• Less documentation | ~60MB/100k LOC | ⚠️ **Overkill for MVP** |

### Recommendation

**Tiered Approach**:
```typescript
class EmbeddingStore {
  // Auto-select based on codebase size
  static create(codebaseSize: number): EmbeddingStore {
    if (codebaseSize < 10_000) {
      return new InMemoryStore();  // Simple, fast
    } else if (codebaseSize < 100_000) {
      return new JSONFileStore();  // File-based, lazy load
    } else {
      return new ChromaDBStore();  // Database, indexed
    }
  }
}
```

**Migration Path**:
1. **Phase 1** (MVP): JSON files + in-memory
2. **Phase 2** (v0.2): Add ChromaDB option for large codebases
3. **Phase 3** (v0.3): Optimize with LanceDB if needed

---

## Decision 3: Language Support Priority

### Options

| Language | Usage % | Difficulty | Priority |
|----------|---------|------------|----------|
| **JavaScript/TypeScript** | 40% | Easy | ✅ **P0 - Must have** |
| **Python** | 25% | Medium | ✅ **P0 - Must have** |
| **Java** | 15% | Hard | ⚠️ **P1 - Should have** |
| **Go** | 10% | Medium | ⚠️ **P2 - Nice to have** |
| **Rust** | 5% | Hard | ❌ **P3 - Future** |
| **Ruby** | 3% | Medium | ❌ **P3 - Future** |
| **PHP** | 2% | Medium | ❌ **P3 - Future** |

### Recommendation

**Phase 1**: TypeScript + JavaScript only
- Covers 40% of use cases
- Easy to implement (existing parsers)
- GuardScan itself is TS
- Quick win for demonstration

**Phase 2**: Add Python
- Covers 65% cumulative
- Good parser available
- Popular for data science/ML

**Phase 3**: Add Java + Go
- Covers 90% cumulative
- More complex parsers
- Broader appeal

**Implementation**:
```typescript
// Extensible language system
interface LanguageAdapter {
  name: string;
  extensions: string[];
  parse(code: string): Promise<AST>;
  extract(ast: AST): CodeElements;
}

// Start with TypeScript
const SUPPORTED_LANGUAGES = [
  new TypeScriptAdapter(),
  // new PythonAdapter(),     // Phase 2
  // new JavaAdapter(),        // Phase 3
];
```

---

## Decision 4: Test Framework Support

### Options

| Framework | Language | Usage | Priority |
|-----------|----------|-------|----------|
| **Jest** | JS/TS | 60% | ✅ **P0** |
| **Mocha** | JS/TS | 15% | ⚠️ **P1** |
| **Vitest** | JS/TS | 10% | ⚠️ **P1** |
| **Pytest** | Python | 80% | ✅ **P0** (when Python supported) |
| **JUnit** | Java | 70% | ⚠️ **P2** (when Java supported) |

### Recommendation

**Start with Jest + Pytest**:
```typescript
async function detectTestFramework(): Promise<string> {
  const pkg = await readPackageJson();

  // Auto-detect
  if (pkg.devDependencies?.jest) return 'jest';
  if (pkg.devDependencies?.pytest) return 'pytest';
  if (pkg.devDependencies?.vitest) return 'vitest';
  if (pkg.devDependencies?.mocha) return 'mocha';

  // Default by language
  if (language === 'typescript') return 'jest';
  if (language === 'python') return 'pytest';

  return 'jest';  // Safe default
}
```

---

## Decision 5: AI Provider Default

### Options

| Provider | Quality | Speed | Cost | Privacy | Recommendation |
|----------|---------|-------|------|---------|----------------|
| **OpenAI GPT-4** | 9/10 | Medium | High | Low | ✅ **Best quality** |
| **Claude Sonnet** | 9/10 | Fast | Low | Low | ✅ **Best value** |
| **Gemini Pro** | 7/10 | Fast | Free tier | Low | ⚠️ **Budget option** |
| **Ollama (local)** | 6/10 | Slow | Free | High | ✅ **Best privacy** |

### Recommendation

**No default - user choice required**:
```typescript
// On first run
if (!config.provider) {
  const choice = await prompt({
    type: 'list',
    message: 'Choose AI provider:',
    choices: [
      { name: 'OpenAI (GPT-4) - Best quality', value: 'openai' },
      { name: 'Claude (Sonnet) - Best value', value: 'claude' },
      { name: 'Gemini (Pro) - Free tier available', value: 'gemini' },
      { name: 'Ollama (Local) - Complete privacy', value: 'ollama' }
    ]
  });

  config.provider = choice;
  await setupProvider(choice);
}
```

**For specific features**:
- **Fix suggestions**: Claude Sonnet (fast, accurate, cheap)
- **Test generation**: OpenAI GPT-4 (best at code generation)
- **Code explanation**: Any (all work well)
- **Chat mode**: Claude Opus (largest context, best for RAG)

---

## Decision 6: Context Window Strategy

### Options

| Strategy | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **Fixed budget** | Simple, predictable | May truncate important context | ✅ **Start here** |
| **Dynamic allocation** | Optimal usage | Complex logic | ⚠️ **Phase 2** |
| **Multi-pass** | Can handle large context | Slower, more expensive | ❌ **Not needed** |

### Recommendation

**Fixed budgets by feature**:
```typescript
const TOKEN_BUDGETS = {
  fixSuggestion: 4000,    // Small, focused
  testGeneration: 8000,   // Need full function context
  codeExplanation: 6000,  // Medium context
  chat: 16000,            // Large context for RAG
  refactoring: 12000,     // Need architectural context
};
```

**With overflow handling**:
```typescript
function buildContext(target, budget) {
  let context = [];
  let tokens = 0;

  // Priority 1: Target (always include)
  context.push(formatTarget(target));
  tokens += estimateTokens(target);

  // Priority 2: Dependencies (fit as many as possible)
  for (const dep of target.dependencies) {
    const depTokens = estimateTokens(dep);
    if (tokens + depTokens <= budget) {
      context.push(formatDependency(dep));
      tokens += depTokens;
    } else {
      // Include summary instead
      context.push(formatSummary(dep));
      tokens += estimateTokens(summary);
    }
  }

  return context.join('\n\n');
}
```

---

## Decision 7: Caching Strategy

### Options

| What to Cache | Duration | Invalidation | Recommendation |
|---------------|----------|--------------|----------------|
| **AI responses** | Forever | On file change | ✅ **Yes** |
| **Embeddings** | Forever | On file change | ✅ **Yes** |
| **Parsed ASTs** | Session | On file change | ⚠️ **Optional** |
| **Index** | Forever | On file change | ✅ **Yes** |

### Recommendation

**Cache everything, invalidate intelligently**:
```typescript
class CacheManager {
  // Cache AI responses
  async cacheAIResponse(prompt, files, response) {
    const key = hashPrompt(prompt);
    const entry = {
      prompt,
      response,
      files: files.map(f => ({ path: f, hash: hashFile(f) })),
      created: Date.now()
    };
    await saveCache(key, entry);
  }

  // Invalidate on file change
  async invalidate(changedFiles: string[]) {
    const entries = await loadAllCaches();

    for (const entry of entries) {
      for (const file of entry.files) {
        if (changedFiles.includes(file.path)) {
          const currentHash = hashFile(file.path);
          if (currentHash !== file.hash) {
            await deleteCache(entry.key);
            break;
          }
        }
      }
    }
  }
}
```

**Cache hit rate target**: >50%

---

## Decision 8: Error Handling Philosophy

### Options

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **Fail fast** | Clear errors | Poor UX | ❌ **No** |
| **Silent fallback** | Good UX | Hides issues | ❌ **No** |
| **Graceful degradation** | Best UX, clear about limitations | More code | ✅ **Yes** |

### Recommendation

**Graceful degradation with clear communication**:
```typescript
async function generateFix(issue) {
  try {
    // Try AI fix
    return await aiProvider.generateFix(issue);
  } catch (error) {
    if (error.code === 'RATE_LIMIT') {
      console.warn('⚠️ Rate limited. Using cached fixes.');
      return await getCachedFix(issue);
    }

    if (error.code === 'NO_API_KEY') {
      console.warn('⚠️ No API key. Install Ollama for local AI:');
      console.log('   brew install ollama');
      return null;
    }

    if (error.code === 'NETWORK_ERROR') {
      console.warn('⚠️ Network error. Running in offline mode.');
      return await getBasicFix(issue);  // Rule-based fallback
    }

    // Unknown error - fail with helpful message
    console.error('✗ AI fix generation failed:', error.message);
    console.log('  Try: guardscan security (without --ai-fix)');
    return null;
  }
}
```

---

## Decision 9: Performance vs Accuracy Trade-off

### Options

| Aspect | Performance-focused | Accuracy-focused | Recommendation |
|--------|-------------------|------------------|----------------|
| **Embedding chunks** | Larger chunks | Smaller chunks | ⚠️ **Balance: 500 lines** |
| **Context size** | Minimal | Maximum | ⚠️ **Balance: 4k-16k tokens** |
| **Search results** | Top 3 | Top 10 | ⚠️ **Balance: Top 5** |
| **AI model** | Fast (GPT-3.5) | Slow (GPT-4) | ✅ **User choice** |
| **Caching** | Aggressive | Conservative | ✅ **Aggressive** |

### Recommendation

**Tiered performance based on use case**:
```typescript
const PERFORMANCE_PROFILES = {
  quick: {
    chunkSize: 1000,
    contextTokens: 2000,
    searchResults: 3,
    model: 'gpt-3.5-turbo',
  },
  balanced: {
    chunkSize: 500,
    contextTokens: 8000,
    searchResults: 5,
    model: 'gpt-4-turbo-preview',
  },
  thorough: {
    chunkSize: 200,
    contextTokens: 16000,
    searchResults: 10,
    model: 'claude-3-opus',
  }
};

// User can choose
guardscan security --ai-fix --mode=quick     // Fast
guardscan security --ai-fix                   // Balanced (default)
guardscan security --ai-fix --mode=thorough  // Slow but accurate
```

---

## Decision 10: Feature Rollout Strategy

### Options

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **Big bang** (all at once) | Complete feature set | High risk, long development | ❌ **No** |
| **Feature flags** | Safe rollout | Complex configuration | ⚠️ **Maybe** |
| **Progressive** (one by one) | Low risk, iterative feedback | Slower to complete | ✅ **Yes** |

### Recommendation

**Progressive rollout with beta flags**:

**Phase 1** (Week 1-2): Foundation
```bash
# Available to everyone
guardscan init --ai-index  # Build embeddings (opt-in)
```

**Phase 2** (Week 3-4): First features
```bash
# Beta flag required
guardscan security --ai-fix --beta
guardscan commit --ai --beta
```

**Phase 3** (Week 5-6): More features
```bash
# Beta graduates, new features beta
guardscan security --ai-fix          # Stable
guardscan test --generate --beta     # Beta
guardscan explain <file> --beta      # Beta
```

**Phase 4** (Week 7+): Advanced features
```bash
# Complex features stay beta longer
guardscan chat --beta                # Beta
```

**Implementation**:
```typescript
function checkBetaAccess(feature: string): boolean {
  if (!config.betaFeatures) {
    console.log(`${feature} is in beta. Enable with:`);
    console.log(`  guardscan config --beta=true`);
    return false;
  }
  return true;
}
```

---

## Summary: Recommended Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| **Embeddings** | Hybrid (OpenAI + Ollama fallback) | Flexibility + privacy |
| **Vector Storage** | Start with JSON, upgrade to ChromaDB | Simple MVP, scalable future |
| **Languages** | TypeScript first, then Python | 40% coverage, easy win |
| **Test Frameworks** | Jest + Pytest | Covers most use cases |
| **AI Provider** | User choice (no default) | Respect user preference |
| **Context Strategy** | Fixed budgets per feature | Simple, predictable |
| **Caching** | Cache everything, smart invalidation | Performance + cost |
| **Error Handling** | Graceful degradation | Best UX |
| **Performance** | Balanced profile (user configurable) | Middle ground |
| **Rollout** | Progressive with beta flags | Low risk, fast feedback |

---

## Configuration Example

Based on these decisions, here's how the config would look:

```yaml
# ~/.guardscan/config.yml

# AI Configuration
ai:
  provider: claude               # User's choice
  apiKey: ${CLAUDE_API_KEY}     # From environment

  # Embedding provider (auto-detected)
  embeddings:
    provider: auto               # openai | ollama | auto

  # Vector storage (auto-selected by codebase size)
  vectorStore: auto              # json | chromadb | auto

  # Performance profile
  performance: balanced          # quick | balanced | thorough

  # Feature flags
  betaFeatures: false            # Enable beta features

  # Caching
  cache:
    enabled: true
    maxSize: 500                 # MB
    ttl: forever                 # Never expire (file-based invalidation)

# Features
features:
  fixSuggestions: true
  testGeneration: true
  commitMessages: true
  codeExplanation: true
  chat: false                    # Beta

# Language support
languages:
  - typescript
  - javascript
  # - python                     # Phase 2
  # - java                       # Phase 3

# Test frameworks
testFrameworks:
  - jest
  # - pytest                     # When Python supported
```

---

## Next Steps

1. **Review these decisions** - Approve or suggest changes
2. **Choose starting point** - Which phase to implement first?
3. **Set up development** - Install dependencies, create structure
4. **Start coding!** 🚀

**Recommended starting point**:
- ✅ Phase 1 (Foundation) - 2 weeks
- ✅ Phase 2 (Quick Wins) - 2 weeks
- Total to first useful features: **4 weeks**

Ready to start? 🎯
