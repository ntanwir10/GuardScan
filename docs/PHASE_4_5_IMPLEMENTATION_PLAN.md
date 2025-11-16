# GuardScan Phase 4 & 5 Implementation Plan

**Version**: 2.0.0
**Date**: 2025-11-16
**Status**: Planning Phase
**Authors**: AI Architecture Team

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Phase 4: RAG & Chat - Detailed Plan](#phase-4-rag--chat---detailed-plan)
3. [Phase 5: Advanced Features - Detailed Plan](#phase-5-advanced-features---detailed-plan)
4. [Multi-Language Parser Architecture](#multi-language-parser-architecture)
5. [Framework-Specific Support](#framework-specific-support)
6. [Technical Architecture Decisions](#technical-architecture-decisions)
7. [Implementation Timeline](#implementation-timeline)
8. [Risk Analysis & Mitigation](#risk-analysis--mitigation)
9. [Success Metrics](#success-metrics)

---

## Executive Summary

### Current State
- ✅ **Phases 1-3 Complete**: Foundation, Quick Wins, Test & Docs
- ✅ **Core Infrastructure**: AST Parser (TypeScript/JavaScript only), Codebase Indexer, Context Builder, AI Cache
- ✅ **5 AI Features**: Fix Suggestions, Commit Generator, Code Explainer, Test Generator, Docs Generator
- ✅ **Production Ready**: 100% MVP complete, zero blockers

### Next Steps
- **Phase 4**: RAG & Chat (Interactive AI assistant with codebase understanding)
- **Phase 5**: Advanced Features (Refactoring, Threat Modeling, Migration, Interactive Review)
- **Multi-Language Support**: Extend AST parsers to Python, Java, Go, Rust, Ruby, PHP, C#

### Goals
1. **Deep Codebase Understanding**: Vector embeddings + semantic search
2. **Interactive Development**: Chat with codebase, ask questions, get instant answers
3. **Enterprise Features**: Threat modeling, refactoring at scale, migration assistance
4. **Universal Language Support**: Work with any modern programming language

### Estimated Timeline
- **Phase 4**: 3-4 weeks (RAG infrastructure + Chat mode)
- **Phase 5**: 2-3 weeks (4 advanced features)
- **Multi-Language Parsers**: 4-6 weeks (parallel development)
- **Total**: 9-13 weeks (~2-3 months)

---

## Phase 4: RAG & Chat - Detailed Plan

### Overview

**Goal**: Transform GuardScan into an interactive AI assistant that deeply understands your codebase.

**Key Capabilities**:
- Ask questions about any part of your codebase
- Get context-aware answers with code snippets
- Explore architecture and data flow
- Find security vulnerabilities through conversation
- Understand how features work across multiple files

### Architecture Components

#### 1. Vector Embeddings System

**File**: `cli/src/core/embeddings.ts` (~800 lines)

**Purpose**: Generate and manage semantic embeddings of code for similarity search.

##### 1.1 Data Structures

```typescript
// cli/src/core/embeddings.ts

/**
 * Represents a code chunk with its embedding
 */
export interface CodeEmbedding {
  id: string;                    // Unique identifier: "function-<hash>" or "class-<hash>"
  type: 'function' | 'class' | 'file' | 'documentation' | 'comment';
  source: string;                // File path
  startLine: number;
  endLine: number;
  content: string;               // Original code/text
  contentSummary: string;        // AI-generated summary (for context)
  embedding: number[];           // Vector (1536 dimensions for OpenAI)
  metadata: EmbeddingMetadata;
  hash: string;                  // Content hash for change detection
}

export interface EmbeddingMetadata {
  language: string;              // 'typescript', 'python', etc.
  symbolName?: string;           // Function/class name
  complexity?: number;           // Cyclomatic complexity
  dependencies: string[];        // Imported modules
  exports: string[];             // Exported symbols
  tags: string[];                // Auto-generated tags (e.g., 'authentication', 'database')
  lastModified: Date;
}

/**
 * Storage format for embeddings on disk
 */
export interface EmbeddingIndex {
  version: string;               // Index format version
  repoId: string;
  generatedAt: Date;
  totalEmbeddings: number;
  embeddings: CodeEmbedding[];
  metadata: {
    model: string;               // 'text-embedding-3-small', 'nomic-embed-text'
    dimensions: number;          // 1536, 768, etc.
    costUSD?: number;            // Total cost to generate
  };
}
```

##### 1.2 Embedding Generation Strategy

**Approach 1: Hierarchical Chunking** (Recommended)

```typescript
class EmbeddingChunker {
  /**
   * Break codebase into semantic chunks
   */
  async chunkCodebase(index: CodebaseIndex): Promise<CodeChunk[]> {
    const chunks: CodeChunk[] = [];

    // 1. Function-level chunks (highest priority)
    for (const [funcId, func] of index.functions) {
      chunks.push({
        type: 'function',
        content: this.formatFunctionForEmbedding(func),
        metadata: {
          symbolName: func.name,
          language: this.detectLanguage(func.file),
          complexity: func.complexity,
          dependencies: func.dependencies,
        }
      });
    }

    // 2. Class-level chunks
    for (const [classId, cls] of index.classes) {
      chunks.push({
        type: 'class',
        content: this.formatClassForEmbedding(cls),
        metadata: {
          symbolName: cls.name,
          language: this.detectLanguage(cls.file),
          methods: cls.methods.map(m => m.name),
        }
      });
    }

    // 3. File-level chunks (for small files)
    for (const [filePath, fileIndex] of index.files) {
      if (fileIndex.loc < 500) {  // Small files only
        chunks.push({
          type: 'file',
          content: await this.readFile(filePath),
          metadata: {
            language: fileIndex.language,
            loc: fileIndex.loc,
          }
        });
      }
    }

    // 4. Documentation chunks
    const docs = await this.extractDocumentation();
    for (const doc of docs) {
      chunks.push({
        type: 'documentation',
        content: doc.content,
        metadata: {
          docType: doc.type,  // 'README', 'API_DOCS', 'COMMENTS'
        }
      });
    }

    return chunks;
  }

  /**
   * Format function with context for better embeddings
   */
  private formatFunctionForEmbedding(func: ParsedFunction): string {
    const parts: string[] = [];

    // File context
    parts.push(`// File: ${func.file}`);
    parts.push(`// Function: ${func.name}`);

    // Documentation
    if (func.documentation) {
      parts.push(`// Description: ${func.documentation}`);
    }

    // Signature
    parts.push(`${func.isAsync ? 'async ' : ''}function ${func.name}(${
      func.parameters.map(p => `${p.name}: ${p.type}`).join(', ')
    }): ${func.returnType}`);

    // Dependencies context
    if (func.dependencies.length > 0) {
      parts.push(`// Dependencies: ${func.dependencies.join(', ')}`);
    }

    // Body (simplified, max 1000 chars)
    const body = func.body.length > 1000
      ? func.body.slice(0, 1000) + '...'
      : func.body;
    parts.push(body);

    return parts.join('\n');
  }
}
```

##### 1.3 Embedding API Integration

**Option 1: OpenAI (Best Quality, Costs Money)**

```typescript
class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',  // 1536 dimensions, $0.00002/1k tokens
      input: text,
    });

    return response.data[0].embedding;
  }

  async generateBulkEmbeddings(texts: string[]): Promise<number[][]> {
    // Batch in chunks of 100 to stay within API limits
    const batches = this.chunk(texts, 100);
    const allEmbeddings: number[][] = [];

    for (const batch of batches) {
      const response = await this.client.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch,
      });

      allEmbeddings.push(...response.data.map(d => d.embedding));
    }

    return allEmbeddings;
  }

  estimateCost(tokenCount: number): number {
    return (tokenCount / 1000) * 0.00002;  // $0.00002 per 1k tokens
  }
}
```

**Option 2: Local Embeddings (Free, Privacy-First)**

```typescript
class OllamaEmbeddingProvider implements EmbeddingProvider {
  private endpoint: string;

  async generateEmbedding(text: string): Promise<number[]> {
    // Use nomic-embed-text model (768 dimensions)
    const response = await axios.post(`${this.endpoint}/api/embeddings`, {
      model: 'nomic-embed-text',
      prompt: text,
    });

    return response.data.embedding;
  }

  async generateBulkEmbeddings(texts: string[]): Promise<number[][]> {
    // Process in parallel (local, so fast)
    return Promise.all(texts.map(t => this.generateEmbedding(t)));
  }

  estimateCost(): number {
    return 0;  // Free, local
  }
}
```

**Recommendation**: Support both, let user choose in config.

##### 1.4 Embedding Storage & Indexing

**Storage Format** (JSON for simplicity, SQLite for scale):

```
~/.guardscan/cache/<repo-id>/embeddings/
├── index.json              # Metadata + embedding IDs
├── embeddings/
│   ├── chunk-0-99.bin      # Binary format for efficiency
│   ├── chunk-100-199.bin
│   └── ...
└── metadata.json           # Generation metadata
```

**Alternative: SQLite with vector extension**

```typescript
class SQLiteEmbeddingStore implements EmbeddingStore {
  private db: Database;

  async initialize() {
    // Install sqlite-vss extension
    await this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vss0(
        embedding(${this.dimensions})
      );

      CREATE TABLE IF NOT EXISTS embedding_metadata (
        id TEXT PRIMARY KEY,
        type TEXT,
        source TEXT,
        content TEXT,
        metadata TEXT
      );
    `);
  }

  async saveEmbeddings(embeddings: CodeEmbedding[]): Promise<void> {
    for (const emb of embeddings) {
      // Save vector
      await this.db.run(
        'INSERT INTO embeddings(rowid, embedding) VALUES (?, ?)',
        [emb.id, this.serializeVector(emb.embedding)]
      );

      // Save metadata
      await this.db.run(
        'INSERT INTO embedding_metadata VALUES (?, ?, ?, ?, ?)',
        [emb.id, emb.type, emb.source, emb.content, JSON.stringify(emb.metadata)]
      );
    }
  }

  async findSimilar(queryEmbedding: number[], k: number): Promise<CodeEmbedding[]> {
    const results = await this.db.all(`
      SELECT
        e.rowid as id,
        distance,
        m.type,
        m.source,
        m.content,
        m.metadata
      FROM embeddings e
      JOIN embedding_metadata m ON e.rowid = m.id
      WHERE vss_search(embedding, ?)
      LIMIT ?
    `, [this.serializeVector(queryEmbedding), k]);

    return results.map(r => this.deserializeEmbedding(r));
  }
}
```

##### 1.5 Similarity Search

**Basic Implementation** (for file-based storage):

```typescript
class EmbeddingSearchEngine {
  /**
   * Find K most similar embeddings using cosine similarity
   */
  async findSimilar(
    query: string,
    k: number = 10,
    filters?: SearchFilters
  ): Promise<SearchResult[]> {
    // 1. Generate query embedding
    const queryEmbedding = await this.embeddingProvider.generateEmbedding(query);

    // 2. Load all embeddings (with caching)
    const embeddings = await this.loadEmbeddings();

    // 3. Apply filters (language, type, file path)
    const filtered = this.applyFilters(embeddings, filters);

    // 4. Calculate similarities
    const similarities = filtered.map(emb => ({
      embedding: emb,
      score: this.cosineSimilarity(queryEmbedding, emb.embedding),
    }));

    // 5. Sort and return top K
    return similarities
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(s => ({
        ...s.embedding,
        similarityScore: s.score,
      }));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  private applyFilters(
    embeddings: CodeEmbedding[],
    filters?: SearchFilters
  ): CodeEmbedding[] {
    if (!filters) return embeddings;

    return embeddings.filter(emb => {
      if (filters.language && emb.metadata.language !== filters.language) {
        return false;
      }
      if (filters.type && emb.type !== filters.type) {
        return false;
      }
      if (filters.filePattern) {
        const regex = new RegExp(filters.filePattern);
        if (!regex.test(emb.source)) return false;
      }
      return true;
    });
  }
}
```

**Advanced Implementation** (with HNSW for scale):

```typescript
// For very large codebases (1M+ LOC), use HNSW algorithm
// Library: hnswlib-node or faiss-node

import { HierarchicalNSW } from 'hnswlib-node';

class HNSWEmbeddingSearchEngine {
  private index: HierarchicalNSW;

  async initialize(dimensions: number, maxElements: number) {
    this.index = new HierarchicalNSW('cosine', dimensions);
    this.index.initIndex(maxElements);
  }

  async addEmbeddings(embeddings: CodeEmbedding[]) {
    for (let i = 0; i < embeddings.length; i++) {
      this.index.addPoint(embeddings[i].embedding, i);
    }
  }

  async findSimilar(queryEmbedding: number[], k: number): Promise<number[]> {
    const result = this.index.searchKnn(queryEmbedding, k);
    return result.neighbors;  // Indices of similar embeddings
  }
}
```

#### 2. RAG Context Retrieval System

**File**: `cli/src/core/rag-context.ts` (~500 lines)

```typescript
export interface RAGContext {
  query: string;
  relevantCode: CodeSnippet[];
  relevantDocs: DocumentationSnippet[];
  conversationHistory: ConversationTurn[];
  tokenBudget: number;
  tokensUsed: number;
}

export interface CodeSnippet {
  source: string;          // File path
  startLine: number;
  endLine: number;
  code: string;
  explanation?: string;    // AI-generated summary
  relevanceScore: number;  // 0.0 - 1.0
}

export class RAGContextBuilder {
  constructor(
    private searchEngine: EmbeddingSearchEngine,
    private contextBuilder: ContextBuilder,
    private tokenManager: TokenManager
  ) {}

  /**
   * Build context for RAG query
   */
  async buildRAGContext(
    query: string,
    conversationHistory: ConversationTurn[],
    maxTokens: number = 4000
  ): Promise<RAGContext> {
    const context: RAGContext = {
      query,
      relevantCode: [],
      relevantDocs: [],
      conversationHistory,
      tokenBudget: maxTokens,
      tokensUsed: 0,
    };

    // 1. Find relevant code via embedding search
    const searchResults = await this.searchEngine.findSimilar(query, 20);

    // 2. Rank by relevance + recency + importance
    const ranked = this.rankResults(searchResults, query);

    // 3. Build context within token budget
    const budget = {
      code: maxTokens * 0.6,        // 60% for code
      docs: maxTokens * 0.2,        // 20% for docs
      history: maxTokens * 0.2,     // 20% for conversation
    };

    // Add code snippets
    for (const result of ranked) {
      const snippet = await this.formatCodeSnippet(result);
      const tokens = this.tokenManager.estimateTokens(snippet.code);

      if (context.tokensUsed + tokens <= budget.code) {
        context.relevantCode.push(snippet);
        context.tokensUsed += tokens;
      } else {
        break;  // Budget exhausted
      }
    }

    // Add documentation (README, comments, etc.)
    const docs = await this.findRelevantDocs(query);
    for (const doc of docs) {
      const tokens = this.tokenManager.estimateTokens(doc.content);
      if (context.tokensUsed + tokens <= budget.code + budget.docs) {
        context.relevantDocs.push(doc);
        context.tokensUsed += tokens;
      }
    }

    // Conversation history already within budget (managed separately)

    return context;
  }

  /**
   * Rank search results by multiple factors
   */
  private rankResults(
    results: SearchResult[],
    query: string
  ): SearchResult[] {
    return results.map(r => ({
      ...r,
      finalScore: this.calculateFinalScore(r, query),
    })).sort((a, b) => b.finalScore - a.finalScore);
  }

  private calculateFinalScore(result: SearchResult, query: string): number {
    // Weighted scoring
    const weights = {
      similarity: 0.5,      // Embedding similarity
      recency: 0.2,         // Recently modified files
      importance: 0.2,      // Central files (many imports)
      exactMatch: 0.1,      // Exact keyword matches
    };

    let score = 0;

    // Similarity score
    score += result.similarityScore * weights.similarity;

    // Recency (files modified in last 30 days get boost)
    const daysSinceModified = this.getDaysSinceModified(result.source);
    const recencyScore = Math.max(0, 1 - daysSinceModified / 30);
    score += recencyScore * weights.recency;

    // Importance (files with many dependents)
    const dependentCount = this.getDependentCount(result.source);
    const importanceScore = Math.min(1, dependentCount / 10);
    score += importanceScore * weights.importance;

    // Exact match bonus
    if (this.hasExactMatch(result.content, query)) {
      score += weights.exactMatch;
    }

    return score;
  }
}
```

#### 3. Chat Mode Implementation

**File**: `cli/src/features/chat.ts` (~600 lines)

```typescript
export interface ChatSession {
  id: string;
  repoId: string;
  startedAt: Date;
  history: ConversationTurn[];
  context: Map<string, any>;  // Persistent context across turns
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  retrievedContext?: CodeSnippet[];  // What context was used
  tokensUsed?: number;
}

export class ChatbotEngine {
  private session: ChatSession;

  constructor(
    private provider: AIProvider,
    private ragContext: RAGContextBuilder,
    private embeddingSearch: EmbeddingSearchEngine
  ) {}

  /**
   * Start a new chat session
   */
  async startSession(repoId: string): Promise<ChatSession> {
    this.session = {
      id: uuidv4(),
      repoId,
      startedAt: new Date(),
      history: [],
      context: new Map(),
    };

    // Initial message
    console.log(chalk.green('\n🤖 Chat mode started!\n'));
    console.log(chalk.gray('Ask questions about your codebase.'));
    console.log(chalk.gray('Commands: /exit, /clear, /context, /save\n'));

    return this.session;
  }

  /**
   * Process user message
   */
  async processMessage(userMessage: string): Promise<string> {
    // Handle commands
    if (userMessage.startsWith('/')) {
      return this.handleCommand(userMessage);
    }

    // Build RAG context
    const ragContext = await this.ragContext.buildRAGContext(
      userMessage,
      this.session.history,
      4000  // Token budget for context
    );

    // Build AI prompt
    const messages = this.buildPrompt(userMessage, ragContext);

    // Get AI response
    const response = await this.provider.chat(messages, {
      temperature: 0.7,
      maxTokens: 1000,
    });

    // Save to history
    this.session.history.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
      retrievedContext: ragContext.relevantCode,
    });

    this.session.history.push({
      role: 'assistant',
      content: response.content,
      timestamp: new Date(),
      tokensUsed: response.usage?.totalTokens,
    });

    // Keep history manageable (last 20 turns)
    if (this.session.history.length > 40) {
      this.session.history = this.session.history.slice(-40);
    }

    return response.content;
  }

  /**
   * Build prompt with RAG context
   */
  private buildPrompt(
    userMessage: string,
    ragContext: RAGContext
  ): AIMessage[] {
    const messages: AIMessage[] = [];

    // System message with context
    messages.push({
      role: 'system',
      content: this.buildSystemPrompt(ragContext),
    });

    // Conversation history (last 10 turns)
    const recentHistory = this.session.history.slice(-20);
    for (const turn of recentHistory) {
      messages.push({
        role: turn.role,
        content: turn.content,
      });
    }

    // Current user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    return messages;
  }

  private buildSystemPrompt(ragContext: RAGContext): string {
    const parts: string[] = [];

    parts.push('You are an expert code assistant helping developers understand their codebase.');
    parts.push('');
    parts.push('Guidelines:');
    parts.push('- Be concise and accurate');
    parts.push('- Show relevant code snippets when helpful');
    parts.push('- Cite file paths and line numbers');
    parts.push('- Admit if you\'re unsure');
    parts.push('- Suggest related code to explore');
    parts.push('');
    parts.push('Relevant code context:');
    parts.push('');

    // Add code snippets
    for (const snippet of ragContext.relevantCode.slice(0, 5)) {
      parts.push(`\`\`\`${snippet.source}:${snippet.startLine}-${snippet.endLine}\``);
      parts.push(snippet.code);
      parts.push('```');
      parts.push('');
    }

    // Add documentation
    if (ragContext.relevantDocs.length > 0) {
      parts.push('Relevant documentation:');
      parts.push('');
      for (const doc of ragContext.relevantDocs.slice(0, 2)) {
        parts.push(doc.content);
        parts.push('');
      }
    }

    return parts.join('\n');
  }

  /**
   * Handle special commands
   */
  private handleCommand(command: string): string {
    const cmd = command.toLowerCase();

    if (cmd === '/exit' || cmd === '/quit') {
      this.saveSession();
      process.exit(0);
    }

    if (cmd === '/clear') {
      this.session.history = [];
      return 'Conversation history cleared.';
    }

    if (cmd === '/context') {
      return this.showCurrentContext();
    }

    if (cmd === '/save') {
      this.saveSession();
      return 'Session saved.';
    }

    if (cmd.startsWith('/filter')) {
      // /filter language:python
      // /filter file:src/auth/*
      const filter = cmd.replace('/filter ', '');
      this.session.context.set('filter', filter);
      return `Filter applied: ${filter}`;
    }

    return `Unknown command: ${command}`;
  }

  private showCurrentContext(): string {
    const lastTurn = this.session.history[this.session.history.length - 1];
    if (!lastTurn?.retrievedContext) {
      return 'No context retrieved yet.';
    }

    const files = new Set(lastTurn.retrievedContext.map(c => c.source));
    return `Last query used context from:\n${Array.from(files).map(f => `- ${f}`).join('\n')}`;
  }

  private saveSession() {
    // Save to ~/.guardscan/chat-sessions/<session-id>.json
    const sessionPath = path.join(
      os.homedir(),
      '.guardscan',
      'chat-sessions',
      `${this.session.id}.json`
    );

    fs.writeFileSync(sessionPath, JSON.stringify(this.session, null, 2));
  }
}
```

#### 4. CLI Integration

**File**: `cli/src/commands/chat.ts` (~300 lines)

```typescript
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';

interface ChatOptions {
  reindex?: boolean;  // Rebuild embeddings
  filter?: string;    // Filter to specific files/languages
  model?: string;     // Override AI model
}

export async function chatCommand(options: ChatOptions): Promise<void> {
  // Load config
  const config = configManager.loadOrInit();
  const repoInfo = repositoryManager.getRepoInfo();

  // Check AI provider
  if (!config.provider || !config.apiKey) {
    console.log(chalk.yellow('\n⚠ AI provider not configured.'));
    console.log(chalk.gray('Run `guardscan config` to set up.\n'));
    return;
  }

  // Initialize embedding system
  console.log(chalk.blue('🔍 Initializing chat mode...\n'));

  const embeddingProvider = createEmbeddingProvider(config);
  const searchEngine = new EmbeddingSearchEngine(embeddingProvider);
  const ragContext = new RAGContextBuilder(searchEngine);
  const chatbot = new ChatbotEngine(
    ProviderFactory.create(config.provider, config.apiKey),
    ragContext,
    searchEngine
  );

  // Check if embeddings exist
  const embeddingsExist = await checkEmbeddingsExist(repoInfo.repoId);

  if (!embeddingsExist || options.reindex) {
    console.log(chalk.yellow('Embeddings not found. Indexing codebase...'));
    await indexCodebase(repoInfo, embeddingProvider);
  } else {
    console.log(chalk.gray('✓ Using existing embeddings\n'));
  }

  // Start chat session
  const session = await chatbot.startSession(repoInfo.repoId);

  // Interactive loop
  while (true) {
    const { message } = await inquirer.prompt([
      {
        type: 'input',
        name: 'message',
        message: chalk.blue('You:'),
        prefix: '',
      },
    ]);

    if (!message.trim()) continue;

    // Show loading spinner
    const spinner = ora('Thinking...').start();

    try {
      const response = await chatbot.processMessage(message);
      spinner.stop();

      // Display response with syntax highlighting
      console.log(chalk.green('\nAI:'), formatResponse(response));
      console.log();

    } catch (error) {
      spinner.stop();
      console.error(chalk.red('\n✗ Error:'), error.message);
      console.log();
    }
  }
}

async function indexCodebase(
  repoInfo: RepositoryInfo,
  embeddingProvider: EmbeddingProvider
): Promise<void> {
  const indexer = new CodebaseIndexer(repoInfo.path, repoInfo.repoId);
  const chunker = new EmbeddingChunker();

  // Build code index
  const spinner = ora('Analyzing codebase...').start();
  const index = await indexer.buildIndex();
  spinner.succeed(`Analyzed ${index.totalFiles} files`);

  // Generate chunks
  spinner.start('Creating embeddings...');
  const chunks = await chunker.chunkCodebase(index);
  spinner.text = `Generating embeddings for ${chunks.length} chunks...`;

  // Generate embeddings in batches
  const embeddings: CodeEmbedding[] = [];
  const batchSize = 100;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await embeddingProvider.generateBulkEmbeddings(
      batch.map(c => c.content)
    );

    embeddings.push(...vectors.map((vector, j) => ({
      id: batch[j].id,
      type: batch[j].type,
      source: batch[j].source,
      content: batch[j].content,
      embedding: vector,
      metadata: batch[j].metadata,
    })));

    const progress = Math.round(((i + batchSize) / chunks.length) * 100);
    spinner.text = `Generating embeddings... ${progress}%`;
  }

  // Save embeddings
  const store = new FileBasedEmbeddingStore(repoInfo.repoId);
  await store.saveEmbeddings(embeddings);

  spinner.succeed(`✓ Indexed ${embeddings.length} code chunks`);

  // Show cost estimate
  if (embeddingProvider.estimateCost) {
    const cost = embeddingProvider.estimateCost(chunks.length);
    console.log(chalk.gray(`  Estimated cost: $${cost.toFixed(4)}`));
  }

  console.log();
}

function formatResponse(response: string): string {
  // Format code blocks with syntax highlighting
  return response.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    return chalk.gray('```') + (lang || '') + '\n' +
           chalk.white(code) +
           chalk.gray('```');
  });
}
```

### Phase 4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Embedding Generation** | <60s for 100k LOC | Time to generate all embeddings |
| **Search Latency** | <500ms | Time to find relevant context |
| **Response Time** | <3s | End-to-end query to response |
| **Answer Accuracy** | >85% | Manual evaluation on test queries |
| **Context Relevance** | >80% | Relevant code in retrieved context |
| **Cost per Query** | <$0.05 | With caching and optimization |

### Phase 4 Technical Challenges

| Challenge | Risk | Mitigation |
|-----------|------|------------|
| **Large codebase indexing** | High memory usage | Streaming, batch processing, lazy loading |
| **Embedding costs** | High API costs | Local embeddings (Ollama), aggressive caching |
| **Search accuracy** | Poor relevance | Hybrid search (embedding + keyword), re-ranking |
| **Token limits** | Context too large | Smart truncation, summarization |
| **Conversation drift** | Loses context | Periodic context refresh, conversation summarization |

---

## Phase 5: Advanced Features - Detailed Plan

### Overview

**Goal**: Enterprise-grade AI features for complex development workflows.

**Features**:
1. Refactoring Suggestions
2. Threat Modeling
3. Migration Assistant
4. Interactive Code Review

### Feature 1: Refactoring Suggestions

**File**: `cli/src/features/refactor.ts` (~700 lines)

**Capabilities**:
- Detect code smells and anti-patterns
- Suggest design pattern applications
- Recommend architectural improvements
- Generate refactored code
- Show before/after diffs
- Estimate impact (files affected, test changes)

**Key Components**:

```typescript
export interface RefactoringOpportunity {
  id: string;
  type: RefactoringType;
  severity: 'high' | 'medium' | 'low';
  location: CodeLocation;
  issue: string;
  suggestion: string;
  refactoredCode: string;
  impact: RefactoringImpact;
  confidence: number;  // 0.0 - 1.0
}

export type RefactoringType =
  | 'extract-function'
  | 'extract-class'
  | 'rename-variable'
  | 'simplify-conditional'
  | 'remove-duplication'
  | 'introduce-parameter-object'
  | 'replace-magic-number'
  | 'apply-design-pattern'
  | 'improve-naming'
  | 'reduce-complexity';

export interface RefactoringImpact {
  filesAffected: string[];
  linesChanged: number;
  testsAffected: string[];
  breakingChange: boolean;
  estimatedEffort: 'low' | 'medium' | 'high';
}

export class RefactoringSuggestionEngine {
  /**
   * Analyze codebase for refactoring opportunities
   */
  async analyzeCodebase(): Promise<RefactoringOpportunity[]> {
    const opportunities: RefactoringOpportunity[] = [];

    // 1. Detect long functions (>50 lines)
    const longFunctions = await this.findLongFunctions();
    for (const func of longFunctions) {
      const refactoring = await this.suggestFunctionExtraction(func);
      opportunities.push(refactoring);
    }

    // 2. Detect duplicated code
    const duplicates = await this.findDuplicatedCode();
    for (const dup of duplicates) {
      const refactoring = await this.suggestDuplicationRemoval(dup);
      opportunities.push(refactoring);
    }

    // 3. Detect high complexity
    const complexFunctions = await this.findComplexFunctions();
    for (const func of complexFunctions) {
      const refactoring = await this.suggestComplexityReduction(func);
      opportunities.push(refactoring);
    }

    // 4. Detect design pattern opportunities
    const patternOpportunities = await this.detectPatternOpportunities();
    opportunities.push(...patternOpportunities);

    return opportunities.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Apply refactoring (generate code)
   */
  async applyRefactoring(opportunity: RefactoringOpportunity): Promise<RefactoringResult> {
    // Use AI to generate refactored code
    const prompt = this.buildRefactoringPrompt(opportunity);
    const response = await this.provider.chat([
      {
        role: 'system',
        content: 'You are a refactoring expert. Generate clean, maintainable code.'
      },
      {
        role: 'user',
        content: prompt
      }
    ]);

    const refactoredCode = this.parseRefactoredCode(response.content);

    return {
      original: opportunity.location.code,
      refactored: refactoredCode,
      diff: this.generateDiff(opportunity.location.code, refactoredCode),
      testsToUpdate: await this.identifyAffectedTests(opportunity),
    };
  }
}
```

**CLI Integration**:

```bash
guardscan refactor                           # Analyze entire codebase
guardscan refactor --file=auth.ts            # Analyze specific file
guardscan refactor --type=extract-function   # Specific refactoring type
guardscan refactor --apply                   # Interactive apply mode
```

---

### Feature 2: Threat Modeling

**File**: `cli/src/features/threat-model.ts` (~800 lines)

**Capabilities**:
- Generate STRIDE threat model
- Identify attack surfaces
- Map data flows
- Suggest security controls
- Generate threat model diagrams
- Output OWASP format reports

**Key Components**:

```typescript
export interface ThreatModel {
  assets: Asset[];
  dataFlows: DataFlow[];
  trustBoundaries: TrustBoundary[];
  threats: Threat[];
  mitigations: Mitigation[];
}

export interface Threat {
  id: string;
  category: STRIDECategory;  // Spoofing, Tampering, Repudiation, etc.
  severity: 'critical' | 'high' | 'medium' | 'low';
  asset: string;
  description: string;
  attackScenario: string;
  likelihood: number;
  impact: number;
  riskScore: number;  // likelihood * impact
  affectedComponents: string[];
  mitigations: string[];
}

export type STRIDECategory =
  | 'spoofing'
  | 'tampering'
  | 'repudiation'
  | 'information-disclosure'
  | 'denial-of-service'
  | 'elevation-of-privilege';

export class ThreatModelingEngine {
  /**
   * Generate threat model for codebase
   */
  async generateThreatModel(): Promise<ThreatModel> {
    // 1. Identify assets
    const assets = await this.identifyAssets();

    // 2. Map data flows
    const dataFlows = await this.mapDataFlows();

    // 3. Identify trust boundaries
    const boundaries = await this.identifyTrustBoundaries();

    // 4. Generate threats (STRIDE)
    const threats = await this.generateThreats(assets, dataFlows, boundaries);

    // 5. Suggest mitigations
    const mitigations = await this.suggestMitigations(threats);

    return {
      assets,
      dataFlows,
      trustBoundaries: boundaries,
      threats,
      mitigations,
    };
  }

  private async identifyAssets(): Promise<Asset[]> {
    const assets: Asset[] = [];

    // User data
    const userDataFiles = await this.findFiles('**/models/user*');
    assets.push({
      type: 'data',
      name: 'User Personal Data',
      sensitivity: 'high',
      location: userDataFiles,
    });

    // Authentication tokens
    const authFiles = await this.findFiles('**/auth/*');
    assets.push({
      type: 'credential',
      name: 'Authentication Tokens',
      sensitivity: 'critical',
      location: authFiles,
    });

    // Database
    assets.push({
      type: 'infrastructure',
      name: 'Database',
      sensitivity: 'critical',
    });

    return assets;
  }

  private async generateThreats(
    assets: Asset[],
    dataFlows: DataFlow[],
    boundaries: TrustBoundary[]
  ): Promise<Threat[]> {
    const threats: Threat[] = [];

    // Use AI to generate context-aware threats
    const prompt = this.buildThreatPrompt(assets, dataFlows, boundaries);
    const response = await this.provider.chat([
      {
        role: 'system',
        content: 'You are a security expert. Generate STRIDE threat models.'
      },
      {
        role: 'user',
        content: prompt
      }
    ]);

    const generatedThreats = this.parseThreats(response.content);
    threats.push(...generatedThreats);

    return threats.sort((a, b) => b.riskScore - a.riskScore);
  }
}
```

**CLI Integration**:

```bash
guardscan threat-model                    # Generate full threat model
guardscan threat-model --format=owasp     # OWASP format
guardscan threat-model --diagram          # Generate Mermaid diagrams
guardscan threat-model --stride           # STRIDE analysis only
```

---

### Feature 3: Migration Assistant

**File**: `cli/src/features/migration.ts` (~600 lines)

**Capabilities**:
- Migrate between frameworks (Express → Fastify, React → Vue, etc.)
- Upgrade dependencies (React 17 → 18, Node 16 → 20)
- Convert languages (JavaScript → TypeScript)
- Modernize code (Callbacks → Promises → Async/Await)
- Generate migration plan with steps
- Show compatibility issues

**Key Components**:

```typescript
export interface MigrationPlan {
  from: MigrationSource;
  to: MigrationTarget;
  steps: MigrationStep[];
  estimatedEffort: string;  // "2-3 days", "1-2 weeks"
  risks: Risk[];
  compatibilityIssues: Issue[];
}

export interface MigrationStep {
  order: number;
  title: string;
  description: string;
  filesAffected: string[];
  changes: CodeChange[];
  automated: boolean;  // Can we auto-apply?
  testing: string;     // How to test this step
}

export class MigrationAssistant {
  /**
   * Generate migration plan
   */
  async generateMigrationPlan(
    fromFramework: string,
    toFramework: string
  ): Promise<MigrationPlan> {
    // Analyze current usage
    const currentUsage = await this.analyzeFrameworkUsage(fromFramework);

    // Generate migration steps with AI
    const steps = await this.generateMigrationSteps(
      fromFramework,
      toFramework,
      currentUsage
    );

    // Identify risks
    const risks = await this.identifyRisks(steps);

    // Check compatibility
    const issues = await this.checkCompatibility(toFramework);

    return {
      from: { framework: fromFramework, version: currentUsage.version },
      to: { framework: toFramework, version: 'latest' },
      steps,
      estimatedEffort: this.estimateEffort(steps),
      risks,
      compatibilityIssues: issues,
    };
  }

  /**
   * Apply migration step
   */
  async applyMigrationStep(step: MigrationStep): Promise<void> {
    for (const change of step.changes) {
      await this.applyCodeChange(change);
    }

    console.log(chalk.green(`✓ Step ${step.order}: ${step.title}`));
    console.log(chalk.gray(`  Testing: ${step.testing}`));
  }
}
```

**CLI Integration**:

```bash
guardscan migrate --from=express --to=fastify    # Framework migration
guardscan migrate --from=js --to=ts              # Language conversion
guardscan migrate --upgrade node                 # Dependency upgrade
guardscan migrate --plan                         # Show plan only
guardscan migrate --apply                        # Interactive apply
```

---

### Feature 4: Interactive Code Review

**File**: `cli/src/features/interactive-review.ts` (~500 lines)

**Capabilities**:
- AI-assisted PR review
- Line-by-line feedback
- Security, performance, style checks
- Suggest improvements
- Interactive Q&A about changes
- Generate review comments

**Key Components**:

```typescript
export interface CodeReview {
  prNumber?: string;
  commits: string[];
  changes: FileChange[];
  overallAssessment: ReviewAssessment;
  comments: ReviewComment[];
  suggestions: ReviewSuggestion[];
}

export interface ReviewComment {
  file: string;
  line: number;
  severity: 'blocker' | 'major' | 'minor' | 'suggestion';
  category: 'security' | 'performance' | 'style' | 'logic' | 'testing';
  message: string;
  suggestion?: string;
}

export class InteractiveCodeReviewer {
  async reviewChanges(options: ReviewOptions): Promise<CodeReview> {
    // Get git diff
    const diff = await this.getGitDiff(options);

    // Parse changes
    const changes = this.parseGitDiff(diff);

    // Review with AI
    const comments = await this.generateReviewComments(changes);

    // Overall assessment
    const assessment = await this.generateAssessment(changes, comments);

    return {
      commits: await this.getCommitHashes(),
      changes,
      overallAssessment: assessment,
      comments,
      suggestions: await this.generateSuggestions(changes),
    };
  }
}
```

**CLI Integration**:

```bash
guardscan review                           # Review staged changes
guardscan review --pr=123                  # Review PR
guardscan review --interactive             # Interactive mode
guardscan review --commit=abc123           # Review specific commit
```

---

## Multi-Language Parser Architecture

### Overview

**Goal**: Extend GuardScan to support all major programming languages and their frameworks.

**Current State**: Only TypeScript/JavaScript parsing via TypeScript Compiler API

**Target Languages** (Priority Order):
1. **Python** (20% of GitHub projects)
2. **Java** (15% of GitHub projects)
3. **Go** (8% of GitHub projects)
4. **Rust** (Growing rapidly, 5%)
5. **Ruby** (Rails ecosystem)
6. **PHP** (Web applications)
7. **C#** (.NET ecosystem)
8. **Kotlin** (Android development)
9. **Swift** (iOS development)
10. **C/C++** (Systems programming)

### Architecture Pattern: Language Adapters

**Design**: Plugin architecture where each language has its own adapter implementing a common interface.

```typescript
// cli/src/parsers/base.ts

export interface LanguageParser {
  /**
   * Language this parser supports
   */
  language: string;

  /**
   * File extensions this parser handles
   */
  extensions: string[];

  /**
   * Parse a file into structured format
   */
  parseFile(filePath: string): Promise<ParsedFile>;

  /**
   * Parse source code string
   */
  parseSource(source: string, filePath?: string): Promise<ParsedFile>;

  /**
   * Check if parser can handle this file
   */
  canParse(filePath: string): boolean;

  /**
   * Extract imports/dependencies
   */
  extractImports(ast: any): Import[];

  /**
   * Extract exports
   */
  extractExports(ast: any): Export[];

  /**
   * Extract functions
   */
  extractFunctions(ast: any): ParsedFunction[];

  /**
   * Extract classes
   */
  extractClasses(ast: any): ParsedClass[];

  /**
   * Calculate cyclomatic complexity
   */
  calculateComplexity(node: any): number;
}

/**
 * Unified parsed file format (language-agnostic)
 */
export interface ParsedFile {
  filePath: string;
  language: string;
  imports: Import[];
  exports: Export[];
  functions: ParsedFunction[];
  classes: ParsedClass[];
  interfaces: ParsedInterface[];
  types: ParsedType[];
  comments: Comment[];
  metadata: FileMetadata;
}

export interface Import {
  module: string;           // Module name (e.g., 'express', './utils')
  symbols: string[];        // Imported symbols
  isDefault: boolean;       // Default import?
  line: number;             // Line number
  type: 'package' | 'relative' | 'absolute';
}

export interface Export {
  name: string;             // Exported symbol name
  type: 'function' | 'class' | 'variable' | 'type';
  isDefault: boolean;       // Default export?
  line: number;
}

export interface ParsedFunction {
  name: string;
  file: string;
  line: number;
  endLine: number;
  parameters: Parameter[];
  returnType: string;
  body: string;
  complexity: number;
  isAsync: boolean;
  isExported: boolean;
  isPrivate: boolean;
  documentation?: string;
  dependencies: string[];
  decorators?: Decorator[];  // For Python, TypeScript, Java
}

export interface ParsedClass {
  name: string;
  file: string;
  line: number;
  endLine: number;
  isExported: boolean;
  isAbstract: boolean;
  extends?: string[];       // Parent classes
  implements?: string[];    // Interfaces
  properties: Property[];
  methods: ParsedFunction[];
  documentation?: string;
  decorators?: Decorator[];
  genericParameters?: string[];  // For TypeScript, Java generics
}
```

### Language-Specific Implementations

#### 1. Python Parser

**Technology**: `py-ast-parser` or bridge to Python's `ast` module

**File**: `cli/src/parsers/python-parser.ts` (~500 lines)

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class PythonParser implements LanguageParser {
  language = 'python';
  extensions = ['.py', '.pyw'];

  async parseFile(filePath: string): Promise<ParsedFile> {
    // Call Python script to parse using ast module
    const pythonScript = this.getPythonParserScript();
    const { stdout } = await execAsync(
      `python3 -c "${pythonScript}" "${filePath}"`
    );

    const rawData = JSON.parse(stdout);
    return this.convertToStandardFormat(rawData, filePath);
  }

  private getPythonParserScript(): string {
    // Python script that uses ast module to parse
    return `
import ast
import json
import sys

def parse_file(filepath):
    with open(filepath, 'r') as f:
        source = f.read()

    tree = ast.parse(source, filepath)

    result = {
        'functions': [],
        'classes': [],
        'imports': []
    }

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            result['functions'].append({
                'name': node.name,
                'line': node.lineno,
                'args': [arg.arg for arg in node.args.args],
                'decorators': [d.id for d in node.decorator_list if hasattr(d, 'id')],
                'is_async': isinstance(node, ast.AsyncFunctionDef),
            })

        elif isinstance(node, ast.ClassDef):
            result['classes'].append({
                'name': node.name,
                'line': node.lineno,
                'bases': [b.id for b in node.bases if hasattr(b, 'id')],
                'methods': [m.name for m in node.body if isinstance(m, ast.FunctionDef)],
            })

        elif isinstance(node, ast.Import):
            for alias in node.names:
                result['imports'].append({
                    'module': alias.name,
                    'line': node.lineno,
                    'type': 'import'
                })

        elif isinstance(node, ast.ImportFrom):
            result['imports'].append({
                'module': node.module,
                'symbols': [alias.name for alias in node.names],
                'line': node.lineno,
                'type': 'from'
            })

    print(json.dumps(result))

parse_file(sys.argv[1])
    `.replace(/\n/g, '\\n').replace(/"/g, '\\"');
  }

  extractFunctions(ast: any): ParsedFunction[] {
    return ast.functions.map((func: any) => ({
      name: func.name,
      line: func.line,
      parameters: func.args.map((arg: string) => ({
        name: arg,
        type: 'Any',  // Python is dynamically typed
        optional: false,
      })),
      returnType: 'Any',
      isAsync: func.is_async,
      isExported: !func.name.startsWith('_'),  // Convention
      isPrivate: func.name.startsWith('_'),
      decorators: func.decorators.map((d: string) => ({ name: d })),
      complexity: 1,  // Calculate separately
      body: '',  // Extract separately if needed
      dependencies: [],
    }));
  }

  calculateComplexity(func: any): number {
    // Simplified complexity calculation for Python
    let complexity = 1;

    // Count decision points
    const decisionKeywords = ['if', 'elif', 'for', 'while', 'and', 'or', 'except'];
    for (const keyword of decisionKeywords) {
      const matches = (func.body || '').match(new RegExp(`\\b${keyword}\\b`, 'g'));
      complexity += matches ? matches.length : 0;
    }

    return complexity;
  }
}
```

**Python-Specific Features**:
- Decorators (`@property`, `@staticmethod`, `@dataclass`)
- Type hints (for modern Python 3.6+)
- Async/await support
- List comprehensions
- Generator functions
- Context managers

---

#### 2. Java Parser

**Technology**: `java-parser` npm package or Tree-sitter

**File**: `cli/src/parsers/java-parser.ts` (~600 lines)

```typescript
import * as JavaParser from 'java-parser';

export class JavaParserAdapter implements LanguageParser {
  language = 'java';
  extensions = ['.java'];
  private parser: any;

  constructor() {
    this.parser = new JavaParser();
  }

  async parseFile(filePath: string): Promise<ParsedFile> {
    const source = fs.readFileSync(filePath, 'utf-8');
    const cst = this.parser.parse(source);
    const ast = this.cstToAst(cst);

    return {
      filePath,
      language: 'java',
      imports: this.extractImports(ast),
      exports: this.extractExports(ast),
      functions: this.extractFunctions(ast),
      classes: this.extractClasses(ast),
      interfaces: this.extractInterfaces(ast),
      types: [],
      comments: this.extractComments(source),
      metadata: {
        packageName: this.extractPackageName(ast),
        isPublic: true,
      },
    };
  }

  extractClasses(ast: any): ParsedClass[] {
    const classes: ParsedClass[] = [];

    for (const typeDecl of ast.typeDeclarations || []) {
      if (typeDecl.type === 'ClassDeclaration') {
        classes.push({
          name: typeDecl.name.identifier,
          file: ast.filePath,
          line: typeDecl.location.startLine,
          endLine: typeDecl.location.endLine,
          isExported: this.isPublic(typeDecl.modifiers),
          isAbstract: this.isAbstract(typeDecl.modifiers),
          extends: typeDecl.extends ? [typeDecl.extends.name] : [],
          implements: typeDecl.implements?.map((i: any) => i.name) || [],
          properties: this.extractFields(typeDecl),
          methods: this.extractMethods(typeDecl),
          documentation: this.extractJavadoc(typeDecl),
          genericParameters: typeDecl.typeParameters?.map((t: any) => t.name) || [],
        });
      }
    }

    return classes;
  }

  private extractFields(classDecl: any): Property[] {
    const fields: Property[] = [];

    for (const member of classDecl.classBody.classBodyDeclarations || []) {
      if (member.type === 'FieldDeclaration') {
        for (const declarator of member.variableDeclarators) {
          fields.push({
            name: declarator.variableDeclaratorId.identifier,
            type: this.typeToString(member.typeType),
            visibility: this.getVisibility(member.modifiers),
            isStatic: this.isStatic(member.modifiers),
            isFinal: this.isFinal(member.modifiers),
          });
        }
      }
    }

    return fields;
  }

  private extractMethods(classDecl: any): ParsedFunction[] {
    const methods: ParsedFunction[] = [];

    for (const member of classDecl.classBody.classBodyDeclarations || []) {
      if (member.type === 'MethodDeclaration') {
        methods.push({
          name: member.identifier,
          file: classDecl.file,
          line: member.location.startLine,
          endLine: member.location.endLine,
          parameters: this.extractParameters(member.formalParameters),
          returnType: this.typeToString(member.typeTypeOrVoid),
          body: this.extractMethodBody(member),
          complexity: this.calculateComplexity(member),
          isAsync: false,  // Java uses different patterns
          isExported: this.isPublic(member.modifiers),
          isPrivate: this.isPrivate(member.modifiers),
          documentation: this.extractJavadoc(member),
          dependencies: [],
        });
      }
    }

    return methods;
  }

  private getVisibility(modifiers: any[]): 'public' | 'private' | 'protected' {
    if (modifiers?.some(m => m === 'public')) return 'public';
    if (modifiers?.some(m => m === 'private')) return 'private';
    if (modifiers?.some(m => m === 'protected')) return 'protected';
    return 'public';  // Default in Java is package-private, but we'll call it public
  }
}
```

**Java-Specific Features**:
- Package structure
- Annotations (`@Override`, `@Autowired`, `@Entity`)
- Generics (`List<String>`, `Map<K, V>`)
- Interfaces and abstract classes
- Access modifiers (public, private, protected, package-private)
- Static methods and fields
- Inner classes
- Lambdas (Java 8+)

---

#### 3. Go Parser

**Technology**: Bridge to Go's `go/parser` package

**File**: `cli/src/parsers/go-parser.ts` (~400 lines)

```typescript
export class GoParser implements LanguageParser {
  language = 'go';
  extensions = ['.go'];

  async parseFile(filePath: string): Promise<ParsedFile> {
    // Call Go binary to parse using go/parser
    const goParserPath = path.join(__dirname, '../../bin/go-parser');
    const { stdout } = await execAsync(`${goParserPath} "${filePath}"`);

    const rawData = JSON.parse(stdout);
    return this.convertToStandardFormat(rawData, filePath);
  }

  // Go parser binary would be a separate Go program
  // We'd bundle it with the CLI
}
```

**Companion Go Binary** (`cli/bin/go-parser/main.go`):

```go
package main

import (
    "encoding/json"
    "go/ast"
    "go/parser"
    "go/token"
    "os"
)

type ParsedFile struct {
    Functions []Function `json:"functions"`
    Structs   []Struct   `json:"structs"`
    Imports   []Import   `json:"imports"`
}

type Function struct {
    Name       string   `json:"name"`
    Line       int      `json:"line"`
    Parameters []string `json:"parameters"`
    Receiver   string   `json:"receiver,omitempty"`
    Exported   bool     `json:"exported"`
}

type Struct struct {
    Name    string  `json:"name"`
    Line    int     `json:"line"`
    Fields  []Field `json:"fields"`
    Methods []string `json:"methods"`
}

func main() {
    filePath := os.Args[1]

    fset := token.NewFileSet()
    file, err := parser.ParseFile(fset, filePath, nil, parser.ParseComments)
    if err != nil {
        panic(err)
    }

    result := ParsedFile{
        Functions: extractFunctions(file, fset),
        Structs:   extractStructs(file, fset),
        Imports:   extractImports(file),
    }

    json.NewEncoder(os.Stdout).Encode(result)
}

func extractFunctions(file *ast.File, fset *token.FileSet) []Function {
    var functions []Function

    ast.Inspect(file, func(n ast.Node) bool {
        if fn, ok := n.(*ast.FuncDecl); ok {
            function := Function{
                Name:     fn.Name.Name,
                Line:     fset.Position(fn.Pos()).Line,
                Exported: ast.IsExported(fn.Name.Name),
            }

            // Extract parameters
            if fn.Type.Params != nil {
                for _, param := range fn.Type.Params.List {
                    for _, name := range param.Names {
                        function.Parameters = append(function.Parameters, name.Name)
                    }
                }
            }

            // Extract receiver (for methods)
            if fn.Recv != nil && len(fn.Recv.List) > 0 {
                if len(fn.Recv.List[0].Names) > 0 {
                    function.Receiver = fn.Recv.List[0].Names[0].Name
                }
            }

            functions = append(functions, function)
        }
        return true
    })

    return functions
}
```

**Go-Specific Features**:
- Package structure
- Exported vs unexported (capitalization)
- Methods with receivers
- Interfaces
- Goroutines and channels
- Defer statements
- Error handling patterns

---

#### 4. Rust Parser

**Technology**: `tree-sitter-rust` or bridge to Rust's `syn` crate

**File**: `cli/src/parsers/rust-parser.ts` (~500 lines)

```typescript
import Parser from 'tree-sitter';
import Rust from 'tree-sitter-rust';

export class RustParser implements LanguageParser {
  language = 'rust';
  extensions = ['.rs'];
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Rust);
  }

  async parseFile(filePath: string): Promise<ParsedFile> {
    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = this.parser.parse(source);

    return {
      filePath,
      language: 'rust',
      imports: this.extractImports(tree.rootNode),
      exports: this.extractExports(tree.rootNode),
      functions: this.extractFunctions(tree.rootNode),
      classes: this.extractStructs(tree.rootNode),  // Structs are like classes
      interfaces: this.extractTraits(tree.rootNode),
      types: this.extractTypes(tree.rootNode),
      comments: this.extractComments(source),
      metadata: {
        crateName: this.extractCrateName(source),
      },
    };
  }

  private extractFunctions(node: Parser.SyntaxNode): ParsedFunction[] {
    const functions: ParsedFunction[] = [];

    const query = this.parser.getLanguage().query(`
      (function_item
        name: (identifier) @name
        parameters: (parameters) @params
        body: (block) @body
      ) @function
    `);

    const matches = query.matches(node);

    for (const match of matches) {
      const funcNode = match.captures.find(c => c.name === 'function')?.node;
      const nameNode = match.captures.find(c => c.name === 'name')?.node;
      const paramsNode = match.captures.find(c => c.name === 'params')?.node;
      const bodyNode = match.captures.find(c => c.name === 'body')?.node;

      if (funcNode && nameNode) {
        functions.push({
          name: nameNode.text,
          file: filePath,
          line: funcNode.startPosition.row + 1,
          endLine: funcNode.endPosition.row + 1,
          parameters: this.extractParameters(paramsNode),
          returnType: this.extractReturnType(funcNode),
          body: bodyNode?.text || '',
          complexity: this.calculateComplexity(bodyNode),
          isAsync: this.isAsync(funcNode),
          isExported: this.isPublic(funcNode),
          isPrivate: !this.isPublic(funcNode),
          documentation: this.extractDocComment(funcNode),
          dependencies: [],
        });
      }
    }

    return functions;
  }

  private isPublic(node: Parser.SyntaxNode): boolean {
    // In Rust, items are private by default unless marked `pub`
    const parent = node.parent;
    if (!parent) return false;

    for (const child of parent.children) {
      if (child.type === 'visibility_modifier' && child.text === 'pub') {
        return true;
      }
    }

    return false;
  }
}
```

**Rust-Specific Features**:
- Ownership and lifetimes
- Traits (like interfaces)
- Macros
- Pattern matching
- Async/await
- Visibility (pub, pub(crate), private)
- Generics with trait bounds
- Enums with associated data

---

#### 5. Ruby Parser

**Technology**: `parser` gem via Ruby bridge

**Implementation**: Similar to Python - call Ruby script that uses `parser` gem

**Ruby-Specific Features**:
- Mixins and modules
- Blocks and procs
- Symbols
- Dynamic method definition
- Meta-programming
- Rails conventions (if Rails detected)

---

#### 6. PHP Parser

**Technology**: `php-parser` npm package

**PHP-Specific Features**:
- Namespaces
- Traits
- Magic methods
- Type hints (PHP 7+)
- Laravel/Symfony framework patterns

---

#### 7. C# Parser

**Technology**: Roslyn API via .NET bridge or Tree-sitter

**C#-Specific Features**:
- Namespaces and assemblies
- Properties and events
- LINQ
- Async/await
- Attributes
- Generics with constraints
- Extension methods

---

### Parser Manager

**File**: `cli/src/parsers/parser-manager.ts` (~300 lines)

```typescript
export class ParserManager {
  private parsers: Map<string, LanguageParser> = new Map();

  constructor() {
    this.registerDefaultParsers();
  }

  private registerDefaultParsers() {
    this.register(new TypeScriptParser());
    this.register(new PythonParser());
    this.register(new JavaParser());
    this.register(new GoParser());
    this.register(new RustParser());
    this.register(new RubyParser());
    this.register(new PHPParser());
    this.register(new CSharpParser());
  }

  register(parser: LanguageParser) {
    this.parsers.set(parser.language, parser);
  }

  /**
   * Auto-detect language and parse file
   */
  async parseFile(filePath: string): Promise<ParsedFile> {
    const language = this.detectLanguage(filePath);
    const parser = this.parsers.get(language);

    if (!parser) {
      throw new Error(`No parser available for language: ${language}`);
    }

    return parser.parseFile(filePath);
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath);

    for (const [lang, parser] of this.parsers) {
      if (parser.extensions.includes(ext)) {
        return lang;
      }
    }

    throw new Error(`Unknown file extension: ${ext}`);
  }

  getSupportedLanguages(): string[] {
    return Array.from(this.parsers.keys());
  }
}
```

---

## Framework-Specific Support

### Overview

Beyond language parsing, we need framework-specific understanding:

### 1. JavaScript/TypeScript Frameworks

#### React
- Detect components (function components, class components)
- Identify hooks usage
- Props and state analysis
- Context API detection

#### Express
- Route detection
- Middleware identification
- API endpoint mapping

#### NestJS
- Controllers and services
- Dependency injection
- Decorators analysis

### 2. Python Frameworks

#### Django
- Models, views, templates pattern
- URL routing
- Admin configuration
- ORM queries

#### FastAPI
- Route decorators
- Pydantic models
- Dependency injection
- OpenAPI schema

#### Flask
- Route decorators
- Blueprint detection
- Template rendering

### 3. Java Frameworks

#### Spring Boot
- `@RestController`, `@Service`, `@Repository` annotations
- Dependency injection via `@Autowired`
- Configuration properties
- JPA entities

### 4. Go Frameworks

#### Gin
- Router groups
- Middleware
- Handler functions

#### Echo
- Similar to Gin

### 5. Rust Frameworks

#### Actix-web
- Route macros
- Handlers
- Middleware

### Implementation Approach

```typescript
// cli/src/frameworks/base.ts

export interface FrameworkDetector {
  name: string;
  language: string;

  /**
   * Detect if this framework is used
   */
  detect(index: CodebaseIndex): Promise<boolean>;

  /**
   * Extract framework-specific patterns
   */
  extractPatterns(index: CodebaseIndex): Promise<FrameworkPattern[]>;
}

export interface FrameworkPattern {
  type: 'route' | 'controller' | 'service' | 'model' | 'middleware' | 'component';
  name: string;
  location: CodeLocation;
  metadata: any;
}

// Example: React detector
export class ReactDetector implements FrameworkDetector {
  name = 'react';
  language = 'typescript';

  async detect(index: CodebaseIndex): Promise<boolean> {
    // Check package.json for react dependency
    const packageJson = await this.readPackageJson(index.rootPath);
    if (packageJson.dependencies?.react || packageJson.devDependencies?.react) {
      return true;
    }

    // Check for React imports
    for (const [filePath, fileIndex] of index.files) {
      if (fileIndex.imports.some(imp => imp.module === 'react')) {
        return true;
      }
    }

    return false;
  }

  async extractPatterns(index: CodebaseIndex): Promise<FrameworkPattern[]> {
    const patterns: FrameworkPattern[] = [];

    for (const [funcId, func] of index.functions) {
      // Detect React component (returns JSX)
      if (this.isReactComponent(func)) {
        patterns.push({
          type: 'component',
          name: func.name,
          location: { file: func.file, line: func.line },
          metadata: {
            isHook: func.name.startsWith('use'),
            hooks: this.extractHooksUsage(func),
          },
        });
      }
    }

    return patterns;
  }

  private isReactComponent(func: ParsedFunction): boolean {
    // Check if function returns JSX
    return func.returnType.includes('JSX.Element') ||
           func.returnType.includes('React.Element') ||
           func.body.includes('return (') ||
           func.body.includes('return <');
  }
}
```

---

## Technical Architecture Decisions

### Decision 1: Embedding Provider

**Options**:
1. **OpenAI** (text-embedding-3-small)
   - Pros: Best quality, 1536 dimensions, established
   - Cons: Costs money ($0.00002/1k tokens)

2. **Local (Ollama + nomic-embed-text)**
   - Pros: Free, privacy-first, 768 dimensions
   - Cons: Requires local setup, slightly lower quality

3. **Hybrid**
   - Pros: Best of both worlds
   - Cons: More complexity

**Recommendation**: **Hybrid** - Default to local (Ollama), offer OpenAI as premium option

---

### Decision 2: Vector Storage

**Options**:
1. **File-based JSON**
   - Pros: Simple, no dependencies
   - Cons: Slow for large codebases (1M+ LOC)

2. **SQLite with vss extension**
   - Pros: Fast similarity search, SQL queries
   - Cons: Requires native extension compilation

3. **LanceDB** (embedded vector DB)
   - Pros: Purpose-built, fast, columnar storage
   - Cons: Newer library, less mature

4. **ChromaDB**
   - Pros: Popular, good docs, Python-based
   - Cons: Requires Python runtime

**Recommendation**: **SQLite + vss** for production, **File-based** for MVP/testing

---

### Decision 3: Multi-Language Parsing Strategy

**Options**:
1. **Native parsers** (TypeScript Compiler, go/parser, etc.)
   - Pros: Highest quality, language-native
   - Cons: Complex integration, multiple runtimes

2. **Tree-sitter** (universal parser)
   - Pros: Single unified API, many languages
   - Cons: Less detailed than native parsers

3. **Hybrid** (Native for priority languages, Tree-sitter fallback)
   - Pros: Best quality where it matters
   - Cons: More code to maintain

**Recommendation**: **Hybrid** approach
- Native: TypeScript, Python, Java (most popular)
- Tree-sitter: Go, Rust, Ruby, PHP, C# (good enough)

---

### Decision 4: Framework Detection

**Options**:
1. **Manual patterns** (check package.json, imports)
   - Pros: Simple, reliable
   - Cons: Need to maintain patterns for each framework

2. **AI-based detection**
   - Pros: Automatically adapts to new frameworks
   - Cons: Less reliable, costs API calls

3. **Hybrid**
   - Manual for top 10 frameworks
   - AI for unknown frameworks

**Recommendation**: **Manual patterns** for MVP, expand as needed

---

## Implementation Timeline

### Phase 4: RAG & Chat (4 weeks)

**Week 1: Embedding Infrastructure**
- Day 1-2: `EmbeddingProvider` interface + OpenAI implementation
- Day 3-4: `EmbeddingChunker` + content formatting
- Day 5: `EmbeddingStore` (file-based) + save/load

**Week 2: Search Engine**
- Day 1-2: Cosine similarity search
- Day 3: Result ranking algorithm
- Day 4-5: `RAGContextBuilder` + token management

**Week 3: Chat Mode**
- Day 1-2: `ChatbotEngine` + conversation management
- Day 3: Prompt engineering + context building
- Day 4-5: CLI integration + interactive UI

**Week 4: Testing & Optimization**
- Day 1-2: End-to-end testing
- Day 3: Performance optimization
- Day 4-5: Documentation + examples

---

### Phase 5: Advanced Features (3 weeks)

**Week 1:**
- Days 1-3: Refactoring Suggestions engine
- Days 4-5: Threat Modeling engine

**Week 2:**
- Days 1-3: Migration Assistant
- Days 4-5: Interactive Code Review

**Week 3: Integration & Polish**
- Days 1-2: CLI integration for all features
- Days 3-4: Testing
- Day 5: Documentation

---

### Multi-Language Parsers (6 weeks, parallel)

**Week 1-2: Priority 1 (Python)**
- Python parser implementation
- Framework detection (Django, FastAPI, Flask)
- Testing with real Python projects

**Week 3-4: Priority 2 (Java)**
- Java parser implementation
- Framework detection (Spring Boot)
- Testing with real Java projects

**Week 5-6: Priority 3 (Go, Rust)**
- Go parser (binary bridge)
- Rust parser (Tree-sitter)
- Basic framework detection

**Weeks 7-8: Remaining Languages**
- Ruby, PHP, C# (Tree-sitter)
- Framework detection for each
- Comprehensive testing

---

## Risk Analysis & Mitigation

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Embedding quality poor** | Medium | High | Hybrid search (embedding + keyword), fine-tune chunking |
| **Search latency high** | Medium | Medium | HNSW index, caching, pre-compute common queries |
| **Multi-language parsing complex** | High | Medium | Start with top 3 languages, use Tree-sitter for others |
| **Framework detection inaccurate** | Medium | Low | Manual patterns for top frameworks, AI fallback |
| **Memory usage high (large codebases)** | Medium | High | Streaming, lazy loading, pagination |
| **Cost too high (OpenAI embeddings)** | Low | Medium | Default to local embeddings (Ollama) |

### User Experience Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Indexing takes too long** | High | High | Background indexing, progress bars, incremental updates |
| **Chat responses too slow** | Medium | Medium | Streaming responses, caching, smaller context |
| **Incorrect answers** | Medium | High | Confidence scores, citations, "I don't know" responses |
| **Complex setup** | Low | Medium | Auto-detection, sensible defaults, guided setup |

---

## Success Metrics

### Phase 4: RAG & Chat

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Indexing Speed** | <60s for 100k LOC | Time to generate embeddings |
| **Search Latency** | <500ms | Query to results time |
| **Answer Accuracy** | >85% | Manual evaluation on 100 test queries |
| **Context Relevance** | >80% | % of retrieved code snippets that are relevant |
| **User Satisfaction** | >4.0/5.0 | User survey after using chat mode |

### Phase 5: Advanced Features

| Feature | Metric | Target |
|---------|--------|--------|
| **Refactoring** | Suggestions applicable | >80% |
| **Threat Modeling** | Threats identified vs manual | >90% coverage |
| **Migration** | Steps accurate | >85% |
| **Code Review** | Issues found vs manual | >75% |

### Multi-Language Support

| Language | Target | Status |
|----------|--------|--------|
| **TypeScript** | 100% feature parity | ✅ Complete |
| **Python** | 95% feature parity | 📅 Week 1-2 |
| **Java** | 95% feature parity | 📅 Week 3-4 |
| **Go** | 90% feature parity | 📅 Week 5 |
| **Rust** | 90% feature parity | 📅 Week 6 |
| **Others** | 80% feature parity | 📅 Week 7-8 |

---

## Next Steps

### Immediate Actions (Phase 4 Start)

1. **Week 1 Sprint Planning**
   - Set up development environment for embeddings
   - Install dependencies (ollama, sqlite-vss)
   - Create project structure for new modules

2. **Technical Spike**
   - Test OpenAI embeddings API
   - Test Ollama nomic-embed-text locally
   - Benchmark similarity search performance
   - Evaluate SQLite vs file-based storage

3. **Design Review**
   - Review this plan with team
   - Finalize architectural decisions
   - Create detailed task breakdown

### Questions to Resolve

1. **Embedding Provider**: OpenAI, Ollama, or both?
2. **Vector Storage**: SQLite+vss or file-based for MVP?
3. **Multi-Language Priority**: TypeScript → Python → Java → Go → Rust?
4. **Budget**: What's acceptable cost per user per month for embeddings?
5. **Scope**: All 4 Phase 5 features or prioritize top 2?

---

## Conclusion

This plan provides a comprehensive roadmap for:
- **Phase 4** (RAG & Chat): 4-week implementation
- **Phase 5** (Advanced Features): 3-week implementation
- **Multi-Language Parsers**: 6-8 week implementation (parallel)

**Total Timeline**: 9-13 weeks (~2-3 months) for full implementation

**Estimated Effort**: ~500-700 hours of engineering work

**Outcome**: GuardScan becomes a universal, AI-powered development assistant that works with any language and provides enterprise-grade features.

---

**Ready to begin Phase 4 implementation!** 🚀
