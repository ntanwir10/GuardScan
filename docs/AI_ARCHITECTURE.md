# GuardScan AI Features - Technical Architecture

**Version**: 1.0.0
**Last Updated**: 2025-11-15

---

## System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      GuardScan CLI                          │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   Commands   │   │  Core Engine │   │  AI Features │
│              │   │              │   │              │
│ • security   │   │ • Parser     │   │ • Fixes      │
│ • test       │   │ • Indexer    │   │ • Tests      │
│ • commit     │   │ • Embeddings │   │ • Explainer  │
│ • explain    │   │ • Context    │   │ • Chat       │
│ • chat       │   │ • Cache      │   │ • Refactor   │
└──────────────┘   └──────────────┘   └──────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │       AI Provider Abstraction         │
        │                                       │
        │  ┌─────────┐  ┌─────────┐  ┌────────┐│
        │  │ OpenAI  │  │ Claude  │  │ Ollama ││
        │  └─────────┘  └─────────┘  └────────┘│
        └───────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │      Local Storage & Cache            │
        │                                       │
        │  ~/.guardscan/cache/<repo-id>/       │
        │  ├── index.json                      │
        │  ├── embeddings/                     │
        │  └── ai-cache/                       │
        └───────────────────────────────────────┘
```

---

## Core Components

### 1. AST Parser

**Purpose**: Parse source code into Abstract Syntax Tree for analysis

**Flow**:
```
Source File
    ↓
Language Detection
    ↓
Parser Selection (TS/Babel/Python/Java)
    ↓
AST Generation
    ↓
Symbol Extraction (functions, classes, variables)
    ↓
Dependency Analysis
    ↓
Complexity Calculation
    ↓
ParsedFile Object
```

**Data Structure**:
```typescript
ParsedFile {
  path: string
  language: string
  ast: AST
  functions: ParsedFunction[]
  classes: ParsedClass[]
  imports: Import[]
  exports: Export[]
  complexity: number
}
```

---

### 2. Codebase Indexer

**Purpose**: Create searchable index of entire codebase

**Indexing Flow**:
```
Repository Root
    ↓
Scan Files (*.ts, *.js, *.py, *.java)
    ↓
Parse Each File → AST Parser
    ↓
Extract Symbols
    ↓
Build Dependency Graph
    ↓
Calculate Metrics
    ↓
Save Index (JSON)
```

**Index Structure**:
```typescript
CodebaseIndex {
  version: "1.0.0"
  repoId: string
  lastUpdated: Date
  files: Map<string, FileIndex>
  functions: Map<string, ParsedFunction>
  classes: Map<string, ParsedClass>
  dependencies: DependencyGraph {
    nodes: Symbol[]
    edges: Dependency[]
  }
  metrics: {
    totalFiles: number
    totalLOC: number
    totalFunctions: number
    totalClasses: number
  }
}
```

**Update Strategy**:
```
Git Status Check
    ↓
Changed Files Detected
    ↓
Re-parse Changed Files
    ↓
Update Affected Symbols
    ↓
Rebuild Dependency Graph
    ↓
Invalidate Affected Embeddings
    ↓
Incremental Save
```

---

### 3. Vector Embeddings System (RAG)

**Purpose**: Enable semantic search and context retrieval

**Embedding Generation Flow**:
```
Codebase Index
    ↓
Chunk Strategy
    ├── Functions (complete)
    ├── Classes (complete)
    ├── Large Files (split into sections)
    └── Documentation (by section)
    ↓
Format for Embedding
    ├── Add context (imports, types)
    ├── Add metadata (file, line, language)
    └── Optimize for retrieval
    ↓
Batch Embeddings (100 at a time)
    ↓
AI Provider → Generate Vectors
    ↓
Store Embeddings + Metadata
    ↓
Build Search Index
```

**Embedding Format**:
```typescript
CodeEmbedding {
  id: string                    // Unique ID
  type: 'function' | 'class' | 'file' | 'docs'
  source: {
    file: string
    line: number
    language: string
  }
  content: string              // Original code/text
  embedding: number[]          // Vector (1536 dimensions)
  metadata: {
    name: string
    complexity?: number
    dependencies: string[]
    tags: string[]
  }
}
```

**Search Flow**:
```
User Query
    ↓
Generate Query Embedding
    ↓
Similarity Search (Cosine)
    ↓
Top K Results (k=10)
    ↓
Re-rank by Relevance
    ├── Exact matches +10 points
    ├── Same file +5 points
    ├── Recent edits +3 points
    └── High complexity -2 points
    ↓
Return Top N (n=5)
```

---

### 4. Context Builder

**Purpose**: Build optimal context for AI prompts within token limits

**Context Building Flow**:
```
User Request
    ↓
Identify Target (file/function/query)
    ↓
Gather Context Levels
    ├── Level 1: Target code (priority: 100%)
    ├── Level 2: Direct dependencies (priority: 80%)
    ├── Level 3: Type definitions (priority: 60%)
    ├── Level 4: Usage examples (priority: 40%)
    └── Level 5: Documentation (priority: 20%)
    ↓
Token Budget Allocation
    ├── Calculate total tokens needed
    ├── Allocate by priority
    └── Truncate if needed
    ↓
Format Context
    ├── Add file headers
    ├── Add code blocks
    ├── Add explanatory comments
    └── Add separators
    ↓
Return Formatted Context
```

**Token Budget Example** (8k token limit):
```
Target File:           2000 tokens (25%)
Direct Dependencies:   1600 tokens (20%)
Type Definitions:      1200 tokens (15%)
Usage Examples:        800 tokens  (10%)
Documentation:         400 tokens  (5%)
System Prompt:         1000 tokens (12%)
Reserve for Response:  1000 tokens (12%)
───────────────────────────────────────
Total:                 8000 tokens (100%)
```

---

### 5. AI Cache Layer

**Purpose**: Cache AI responses to minimize costs and improve performance

**Cache Strategy**:
```
AI Request
    ↓
Generate Cache Key
    ├── Hash(prompt)
    ├── Model name
    ├── File versions
    └── Settings
    ↓
Check Cache
    ├── Hit? → Return cached response
    └── Miss? → Call AI API
        ↓
    Store Response
        ├── Key: cache key
        ├── Value: response
        ├── Files: affected files + hashes
        └── Timestamp: created at
        ↓
    Return Response
```

**Cache Invalidation**:
```
File Change Detected
    ↓
Get File Hash
    ↓
Find Cached Entries with File
    ↓
Remove Invalid Entries
    ↓
Update Cache Index
```

**Cache Structure**:
```typescript
CacheEntry {
  key: string                  // SHA256 hash
  created: Date
  accessed: Date              // For LRU
  prompt: string
  model: string
  response: string
  files: Map<string, string>  // file → hash
  metadata: {
    tokens: number
    cost: number
    duration: number
  }
}
```

---

## Feature Architectures

### AI Fix Suggestions

```
Security Scan Results
    ↓
For Each Vulnerability
    ├── Extract Issue Context
    │   ├── File, line, snippet
    │   ├── Containing function
    │   └── Dependencies
    ↓
    ├── Build Fix Context
    │   ├── Issue description
    │   ├── Vulnerable code
    │   ├── Relevant imports
    │   └── Security best practices
    ↓
    ├── Check Cache (by issue hash)
    │   ├── Hit? → Use cached fix
    │   └── Miss? → Generate fix
    ↓
    ├── AI Generate Fix
    │   ├── Prompt: security expert
    │   ├── Context: vulnerability + code
    │   └── Output: JSON fix suggestion
    ↓
    ├── Validate Fix
    │   ├── Syntax check (AST parse)
    │   ├── Type check (if TypeScript)
    │   └── Semantic check
    ↓
    ├── Cache Fix
    ↓
    └── Add to Report
        ├── Explanation
        ├── Fixed code
        ├── Alternatives
        └── Best practices
```

---

### Test Generation

```
Target Function/File
    ↓
Analyze Function
    ├── Extract signature
    ├── Identify dependencies
    ├── Detect side effects
    └── Find edge cases
    ↓
Detect Test Framework
    ├── Check package.json
    ├── Find existing tests
    └── Default to Jest
    ↓
Build Test Context
    ├── Function code
    ├── Dependencies (for mocking)
    ├── Example tests (for style)
    └── Framework conventions
    ↓
AI Generate Tests
    ├── Prompt: testing expert
    ├── Context: function + framework
    └── Output: Complete test file
    ↓
Validate Tests
    ├── Syntax check
    ├── Run tests (sandbox)
    └── Check coverage
    ↓
Save Test File
```

---

### Code Chat (RAG)

```
User Query
    ↓
Query Classification
    ├── Code search? → "find function X"
    ├── Explanation? → "how does Y work"
    ├── Modification? → "how to add Z"
    └── General? → "what does this do"
    ↓
Retrieve Context (RAG)
    ├── Generate query embedding
    ├── Similarity search (top 10)
    ├── Re-rank by relevance
    └── Select top 5 chunks
    ↓
Build Conversation Context
    ├── System prompt (codebase expert)
    ├── Retrieved code chunks
    ├── Conversation history (last 10)
    └── Current query
    ↓
AI Response
    ├── Answer question
    ├── Show code snippets
    ├── Suggest related code
    └── Ask clarifying questions
    ↓
Update Conversation History
    ├── Add user query
    ├── Add AI response
    └── Trim if > 20 messages
    ↓
Display Response
    ├── Format code blocks
    ├── Highlight syntax
    └── Show file references
```

---

## Data Flow Diagrams

### Indexing Flow

```
┌──────────┐
│ User     │
│ Command  │
└────┬─────┘
     │
     │ guardscan init (first time)
     │ or file change detected
     ▼
┌──────────────────┐
│ Codebase Indexer │
└────┬─────────────┘
     │
     ├─→ Scan files
     │
     ├─→ Parse files (AST Parser)
     │   ┌─────────────────┐
     │   │ - TypeScript    │
     │   │ - Python        │
     │   │ - Java          │
     │   └─────────────────┘
     │
     ├─→ Extract symbols
     │   ┌─────────────────┐
     │   │ - Functions     │
     │   │ - Classes       │
     │   │ - Variables     │
     │   └─────────────────┘
     │
     ├─→ Build dependency graph
     │
     ├─→ Calculate metrics
     │
     └─→ Save index
         ┌────────────────────────┐
         │ ~/.guardscan/cache/    │
         │   └── repo-id/         │
         │       └── index.json   │
         └────────────────────────┘
```

### AI Feature Flow

```
┌──────────┐
│ User     │
│ Command  │
└────┬─────┘
     │
     │ guardscan security --ai-fix
     │
     ▼
┌──────────────────┐
│ Security Scanner │
└────┬─────────────┘
     │
     │ Finds vulnerabilities
     │
     ▼
┌──────────────────┐
│ AI Fix Generator │
└────┬─────────────┘
     │
     ├─→ Load codebase index
     │
     ├─→ For each vulnerability:
     │   │
     │   ├─→ Build context
     │   │   ┌────────────────────┐
     │   │   │ Context Builder    │
     │   │   │ - Issue details    │
     │   │   │ - Vulnerable code  │
     │   │   │ - Dependencies     │
     │   │   └────────────────────┘
     │   │
     │   ├─→ Check cache
     │   │   ┌────────────────────┐
     │   │   │ AI Cache           │
     │   │   │ - Hash(issue+code) │
     │   │   │ - Invalidation     │
     │   │   └────────────────────┘
     │   │
     │   ├─→ Generate fix (if not cached)
     │   │   ┌────────────────────┐
     │   │   │ AI Provider        │
     │   │   │ - OpenAI / Claude  │
     │   │   │ - Prompt + Context │
     │   │   └────────────────────┘
     │   │
     │   ├─→ Validate fix
     │   │   ┌────────────────────┐
     │   │   │ Validator          │
     │   │   │ - Syntax check     │
     │   │   │ - Type check       │
     │   │   └────────────────────┘
     │   │
     │   └─→ Cache fix
     │
     └─→ Generate report
         ┌────────────────────┐
         │ Reporter           │
         │ - Markdown format  │
         │ - With AI fixes    │
         └────────────────────┘
```

### Chat (RAG) Flow

```
┌──────────┐
│ User     │
│ Query    │
└────┬─────┘
     │
     │ "How does auth work?"
     │
     ▼
┌──────────────────┐
│ Chat Manager     │
└────┬─────────────┘
     │
     ├─→ Generate query embedding
     │   ┌────────────────────┐
     │   │ AI Provider        │
     │   │ - text-embedding   │
     │   └────────────────────┘
     │
     ├─→ Search embeddings
     │   ┌────────────────────┐
     │   │ Embedding Store    │
     │   │ - Cosine similarity│
     │   │ - Top K results    │
     │   └────────────────────┘
     │
     ├─→ Retrieve relevant code
     │   ┌────────────────────┐
     │   │ Top 5 chunks:      │
     │   │ 1. auth.ts:login() │
     │   │ 2. jwt.ts:verify() │
     │   │ 3. middleware.ts   │
     │   │ 4. types.ts:User   │
     │   │ 5. README.md:auth  │
     │   └────────────────────┘
     │
     ├─→ Build prompt
     │   ┌────────────────────┐
     │   │ - System: expert   │
     │   │ - Context: code    │
     │   │ - History: last 10 │
     │   │ - Query: current   │
     │   └────────────────────┘
     │
     ├─→ Get AI response
     │   ┌────────────────────┐
     │   │ AI Provider        │
     │   │ - Streaming        │
     │   └────────────────────┘
     │
     ├─→ Update conversation
     │
     └─→ Display response
         ┌────────────────────┐
         │ "Auth uses JWT..."  │
         │ - Explanation      │
         │ - Code snippets    │
         │ - File references  │
         └────────────────────┘
```

---

## Storage Architecture

### Local Storage Structure

```
~/.guardscan/
├── config.yml                    # User config
├── cache/
│   └── <repo-id>/               # Per-repository cache
│       ├── index.json           # Codebase index
│       ├── metadata.json        # Index metadata
│       │
│       ├── ast/                 # Parsed ASTs (optional)
│       │   └── <file-hash>.json
│       │
│       ├── embeddings/          # Vector embeddings
│       │   ├── index.json       # Embedding index
│       │   └── vectors/
│       │       └── <chunk-id>.bin  # Binary vectors
│       │
│       └── ai-cache/            # AI response cache
│           ├── index.json       # Cache index
│           └── entries/
│               └── <hash>.json  # Cached responses
│
└── logs/                        # Optional logs
    └── guardscan.log
```

### Cache Size Estimates

**100k LOC Codebase**:
- Index: ~50 MB
- Embeddings: ~100 MB (1000 chunks × 1536 dimensions × 4 bytes)
- AI Cache: ~200 MB (100 cached responses)
- **Total**: ~350 MB

**1M LOC Codebase**:
- Index: ~500 MB
- Embeddings: ~1 GB
- AI Cache: ~500 MB
- **Total**: ~2 GB

---

## Performance Optimizations

### 1. Lazy Loading
```
Don't load everything at startup
    ↓
Load on-demand:
    - Parse files when needed
    - Load embeddings when searching
    - Load cache entries when querying
```

### 2. Incremental Updates
```
Don't re-index entire codebase on change
    ↓
Incremental strategy:
    - Track file hashes
    - Detect changed files
    - Re-parse only changed
    - Update affected dependencies
    - Invalidate affected cache
```

### 3. Parallel Processing
```
Use worker threads for:
    - Parallel file parsing
    - Concurrent embedding generation
    - Parallel AI requests (when safe)
```

### 4. Caching Layers
```
Multi-level cache:
    L1: In-memory (parsed ASTs)
    L2: Disk (parsed files)
    L3: AI responses
```

### 5. Compression
```
Compress stored data:
    - JSON indices (gzip)
    - Vector embeddings (quantization)
    - Cache entries (lz4)
```

---

## Scalability Considerations

### Small Codebases (<10k LOC)
- In-memory index
- No compression needed
- Simple linear search for embeddings

### Medium Codebases (10k-100k LOC)
- Disk-based index with caching
- Compression recommended
- Efficient similarity search (sorted vectors)

### Large Codebases (100k-1M LOC)
- Chunked index loading
- Required compression
- Vector database (ChromaDB/LanceDB)
- Parallel processing

### Very Large Codebases (>1M LOC)
- Selective indexing (exclude node_modules, etc.)
- Aggressive caching
- Vector database required
- Consider cloud-based embedding service

---

## Error Handling Strategy

### Parse Errors
```
File has syntax errors
    ↓
Try to parse anyway (error recovery)
    ├── Success → Continue with partial AST
    └── Failure → Skip file, log error
```

### AI API Errors
```
API call fails
    ↓
Retry strategy:
    1st attempt → Immediate
    2nd attempt → Wait 1s
    3rd attempt → Wait 5s
    ├── Success → Return result
    └── Failure → Return graceful error
        ├── Use cached result if available
        └── Suggest offline mode
```

### Cache Corruption
```
Cache file corrupted
    ↓
Detection:
    - JSON parse error
    - Invalid schema
    - Missing required fields
    ↓
Recovery:
    - Remove corrupted entry
    - Rebuild if critical
    - Log warning
```

---

## Security Considerations

### API Key Storage
```
Never store API keys in:
    - Git repository
    - Plain text config
    - Logs

Store securely in:
    - OS keychain (preferred)
    - Encrypted config file
    - Environment variables
```

### Code Privacy
```
When using cloud AI:
    - User explicitly opts in
    - Clear privacy policy
    - Minimal code in prompts
    - No persistent storage on AI provider

When using local AI (Ollama):
    - Everything stays local
    - No network calls
    - Complete privacy
```

### Cache Security
```
Cache may contain sensitive code
    ↓
Protections:
    - Store in user directory only
    - Set proper file permissions (600)
    - Exclude from backups (optional)
    - Clear cache on demand
```

---

## Monitoring & Observability

### Metrics to Track

**Performance**:
- Parse time per file
- Index build time
- Embedding generation time
- AI response time
- Cache hit rate

**Quality**:
- AI fix acceptance rate
- Test generation success rate
- Chat answer accuracy
- User satisfaction ratings

**Cost**:
- Total tokens used
- Cost per feature
- Cache savings
- Model distribution

### Logging Strategy

```typescript
interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  component: string;
  action: string;
  duration?: number;
  metadata?: Record<string, any>;
}

// Example logs
logger.info('embeddings', 'generate', {
  chunks: 1000,
  duration: 12000,  // ms
  model: 'text-embedding-3-small'
});

logger.warn('ai-cache', 'invalidate', {
  reason: 'file_changed',
  file: 'src/auth.ts',
  entries: 5
});
```

---

## Testing Strategy

### Unit Tests
- AST parser (various languages)
- Context builder (token management)
- Cache layer (invalidation logic)
- Embedding search (similarity accuracy)

### Integration Tests
- End-to-end fix generation
- Complete test generation
- Chat conversation flow
- Index build and update

### Performance Tests
- Large codebase indexing
- Concurrent AI requests
- Cache performance
- Memory usage

---

**This architecture supports**:
- ✅ Modular design (easy to extend)
- ✅ High performance (caching, lazy loading)
- ✅ Scalability (handles 1M+ LOC)
- ✅ Cost efficiency (caching reduces AI calls)
- ✅ Privacy (local-first, optional cloud)
- ✅ Reliability (error handling, retries)

**Next**: Review architecture, then proceed to implementation! 🚀
