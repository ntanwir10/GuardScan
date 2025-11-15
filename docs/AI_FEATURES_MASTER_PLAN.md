# GuardScan AI Features - Master Implementation Plan

**Version**: 1.0.0
**Date**: 2025-11-15
**Status**: Planning Phase

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Core Infrastructure Requirements](#core-infrastructure-requirements)
3. [Feature Analysis & Requirements](#feature-analysis--requirements)
4. [Architecture Design](#architecture-design)
5. [Implementation Roadmap](#implementation-roadmap)
6. [Technical Specifications](#technical-specifications)
7. [Risk Analysis](#risk-analysis)

---

## Executive Summary

### Goal
Transform GuardScan from a static analysis tool into an **AI-powered development assistant** with deep codebase understanding and context-aware features.

### Key Challenges
1. **Context Awareness**: Understanding entire codebase, not just individual files
2. **Performance**: Processing large codebases efficiently
3. **Accuracy**: Ensuring AI suggestions are correct and relevant
4. **Cost Control**: Minimizing AI API costs (user pays, but we want efficiency)
5. **User Experience**: Making complex features simple to use

### Success Metrics
- **Accuracy**: >85% of AI suggestions are applicable
- **Performance**: Process 100k LOC codebases in <30 seconds
- **Adoption**: >50% of users try at least one AI feature
- **Satisfaction**: >4.0/5.0 rating for AI features

---

## Core Infrastructure Requirements

### 1. Code Understanding System

#### 1.1 Abstract Syntax Tree (AST) Parser

**Purpose**: Parse code into structured format for analysis

**Requirements**:
- Multi-language support (JavaScript/TypeScript, Python, Java, Go, Rust)
- Extract:
  - Functions/methods (name, parameters, return type, body)
  - Classes/interfaces (properties, methods, inheritance)
  - Imports/dependencies
  - Comments/documentation
  - Type information

**Technology Stack**:
```typescript
// Language-specific parsers
- JavaScript/TypeScript: @typescript-eslint/parser, @babel/parser
- Python: py-ast-parser (via Python bridge)
- Java: java-parser
- Go: go-parser (via Go bridge)
- Rust: rust-parser (via Rust bridge)
```

**Implementation**:
```typescript
// cli/src/core/ast-parser.ts
export interface ParsedFunction {
  name: string;
  file: string;
  line: number;
  parameters: Parameter[];
  returnType: string;
  body: string;
  complexity: number;
  dependencies: string[];
  documentation?: string;
}

export interface ParsedClass {
  name: string;
  file: string;
  extends?: string[];
  implements?: string[];
  properties: Property[];
  methods: ParsedFunction[];
  documentation?: string;
}

export class ASTParser {
  async parseFile(filePath: string): Promise<ParsedFile>;
  async parseDirectory(dirPath: string): Promise<ParsedCodebase>;
  extractFunctions(ast: any): ParsedFunction[];
  extractClasses(ast: any): ParsedClass[];
  calculateComplexity(node: any): number;
}
```

**Challenges**:
- Different syntax for each language
- Handling syntax errors gracefully
- Performance for large files
- Memory management

**Solution**:
- Incremental parsing (parse on-demand)
- Caching parsed results
- Worker threads for parallel parsing
- Language adapters pattern

---

#### 1.2 Codebase Indexing System

**Purpose**: Create searchable index of entire codebase

**Requirements**:
- Index all code elements (functions, classes, variables)
- Build dependency graph
- Track file relationships
- Support incremental updates

**Data Structure**:
```typescript
// cli/src/core/codebase-index.ts
export interface CodebaseIndex {
  version: string;
  lastUpdated: Date;
  files: Map<string, FileIndex>;
  functions: Map<string, ParsedFunction>;
  classes: Map<string, ParsedClass>;
  dependencies: DependencyGraph;
  symbols: Map<string, Symbol[]>;
}

export interface FileIndex {
  path: string;
  hash: string;  // For change detection
  language: string;
  loc: number;
  functions: string[];  // IDs
  classes: string[];    // IDs
  imports: string[];
  exports: string[];
}

export class CodebaseIndexer {
  async buildIndex(rootPath: string): Promise<CodebaseIndex>;
  async updateIndex(changedFiles: string[]): Promise<void>;
  async searchFunctions(query: string): Promise<ParsedFunction[]>;
  async getDependencies(symbol: string): Promise<string[]>;
  async findReferences(symbol: string): Promise<Reference[]>;
}
```

**Storage**:
```
~/.guardscan/cache/
  └── <repo-id>/
      ├── index.json          # Main index
      ├── files/              # Individual file data
      ├── embeddings/         # Vector embeddings (for RAG)
      └── metadata.json       # Index metadata
```

**Performance Optimizations**:
- Lazy loading (load files on-demand)
- LRU cache for frequently accessed files
- Incremental updates (only changed files)
- Compression for storage

---

#### 1.3 Vector Embeddings & RAG System

**Purpose**: Enable semantic search and context-aware AI features

**Requirements**:
- Generate embeddings for code chunks
- Similarity search for relevant context
- Efficient storage and retrieval
- Support for large codebases (1M+ LOC)

**Architecture**:
```typescript
// cli/src/core/embeddings.ts
export interface CodeEmbedding {
  id: string;          // Unique identifier
  type: 'function' | 'class' | 'file' | 'documentation';
  source: string;      // File path
  content: string;     // Original code/text
  embedding: number[]; // Vector (e.g., 1536 dimensions for OpenAI)
  metadata: {
    language: string;
    complexity?: number;
    dependencies?: string[];
  };
}

export class EmbeddingManager {
  // Generate embeddings
  async generateEmbedding(text: string): Promise<number[]>;
  async generateBulkEmbeddings(texts: string[]): Promise<number[][]>;

  // Storage
  async saveEmbeddings(embeddings: CodeEmbedding[]): Promise<void>;
  async loadEmbeddings(): Promise<CodeEmbedding[]>;

  // Search
  async findSimilar(query: string, k: number): Promise<CodeEmbedding[]>;
  async findRelevantContext(query: string, maxTokens: number): Promise<string>;
}
```

**Embedding Strategy**:
1. **Chunking**: Break code into semantic chunks
   - Functions (complete)
   - Classes (complete)
   - Files (if small, <500 lines)
   - File summaries (if large)

2. **Content Types**:
   - Code with context (imports, comments)
   - Function/class documentation
   - Architecture documentation
   - README sections

3. **Optimization**:
   - Batch embedding generation (reduce API calls)
   - Cache embeddings (invalidate on file change)
   - Quantization for storage efficiency

**Similarity Search**:
```typescript
// Cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

// K-nearest neighbors
async function findKNearest(
  queryEmbedding: number[],
  embeddings: CodeEmbedding[],
  k: number
): Promise<CodeEmbedding[]> {
  const similarities = embeddings.map(emb => ({
    embedding: emb,
    score: cosineSimilarity(queryEmbedding, emb.embedding)
  }));

  return similarities
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(s => s.embedding);
}
```

**Alternative: Vector Database** (for very large codebases):
- **Option 1**: Local SQLite with vector extension (sqlite-vss)
- **Option 2**: LanceDB (embedded vector database)
- **Option 3**: ChromaDB (lightweight, local-first)

---

#### 1.4 Context Building System

**Purpose**: Build relevant context for AI prompts

**Requirements**:
- Gather relevant code snippets
- Stay within token limits
- Prioritize by relevance
- Include dependencies

**Strategy**:
```typescript
// cli/src/core/context-builder.ts
export interface ContextBuildingOptions {
  maxTokens: number;          // Token budget
  includeImports: boolean;    // Include imported code
  includeDependencies: boolean; // Include dependency code
  includeTests: boolean;      // Include test files
  includeDocs: boolean;       // Include documentation
}

export class ContextBuilder {
  async buildContext(
    targetFile: string,
    options: ContextBuildingOptions
  ): Promise<string>;

  async buildFunctionContext(
    functionName: string,
    options: ContextBuildingOptions
  ): Promise<string>;

  async buildThemeContext(
    theme: string,  // e.g., "authentication"
    options: ContextBuildingOptions
  ): Promise<string>;
}
```

**Context Prioritization**:
1. **Primary**: Target file/function (100% include)
2. **Secondary**: Direct dependencies (80% include)
3. **Tertiary**: Type definitions, interfaces (60% include)
4. **Quaternary**: Related tests (40% include)
5. **Quinary**: Documentation (20% include)

**Token Management**:
```typescript
interface TokenBudget {
  total: number;
  used: number;
  remaining: number;
}

class TokenManager {
  estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  truncateToFit(text: string, maxTokens: number): string {
    const tokens = this.estimateTokens(text);
    if (tokens <= maxTokens) return text;

    // Truncate proportionally
    const ratio = maxTokens / tokens;
    return text.slice(0, Math.floor(text.length * ratio));
  }

  allocateBudget(sections: Section[], totalBudget: number): Map<string, number> {
    // Allocate based on priority
    const allocations = new Map<string, number>();
    let remaining = totalBudget;

    for (const section of sections.sort((a, b) => b.priority - a.priority)) {
      const allocation = Math.min(section.idealSize, remaining * section.priority);
      allocations.set(section.id, allocation);
      remaining -= allocation;
    }

    return allocations;
  }
}
```

---

#### 1.5 Caching Layer

**Purpose**: Minimize redundant AI API calls and improve performance

**Requirements**:
- Cache AI responses
- Invalidate on code changes
- LRU eviction policy
- Configurable size limits

**Implementation**:
```typescript
// cli/src/core/ai-cache.ts
export interface CacheEntry {
  key: string;           // Hash of prompt + model
  prompt: string;
  model: string;
  response: string;
  timestamp: Date;
  fileHashes: Map<string, string>;  // For invalidation
}

export class AICache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number = 100;  // MB

  async get(prompt: string, model: string): Promise<string | null>;
  async set(prompt: string, model: string, response: string, files: string[]): Promise<void>;
  async invalidate(changedFiles: string[]): Promise<void>;
  async clear(): Promise<void>;

  private generateKey(prompt: string, model: string): string {
    return crypto.createHash('sha256')
      .update(prompt + model)
      .digest('hex');
  }
}
```

**Cache Strategy**:
- **Key**: Hash(prompt + model + file versions)
- **Invalidation**: On file modification (check file hash)
- **Eviction**: LRU when cache size exceeds limit
- **Storage**: `~/.guardscan/cache/<repo-id>/ai-cache/`

---

### 2. AI Provider Abstraction

**Current State**: Basic provider abstraction exists

**Enhancements Needed**:
```typescript
// cli/src/providers/base.ts (enhanced)
export abstract class AIProvider {
  // Existing
  abstract chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse>;

  // New additions
  abstract generateEmbedding(text: string): Promise<number[]>;
  abstract generateEmbeddings(texts: string[]): Promise<number[][]>;
  abstract streamChat(messages: AIMessage[]): AsyncIterableIterator<string>;
  abstract estimateCost(messages: AIMessage[]): number;  // Estimated $ cost

  // Token management
  countTokens(text: string): number;
  getMaxTokens(): number;
  getMaxResponseTokens(): number;
}
```

**Provider-Specific Implementations**:
```typescript
// OpenAI
- Model: gpt-4-turbo-preview
- Embeddings: text-embedding-3-small (1536 dimensions)
- Max tokens: 128k input, 4k output
- Cost: $0.01/1k input, $0.03/1k output

// Anthropic Claude
- Model: claude-3-sonnet-20240229
- Embeddings: N/A (use OpenAI or local)
- Max tokens: 200k input, 4k output
- Cost: $0.003/1k input, $0.015/1k output

// Google Gemini
- Model: gemini-pro
- Embeddings: embedding-001
- Max tokens: 32k input, 2k output
- Cost: Free tier available

// Ollama (local)
- Model: codellama, deepseek-coder
- Embeddings: nomic-embed-text
- Max tokens: Varies by model
- Cost: $0 (local)
```

---

## Feature Analysis & Requirements

### Feature 1: AI Fix Suggestions

#### Overview
For each security/quality issue found, generate AI-powered fix suggestions with code examples.

#### Requirements

**Functional**:
- Analyze vulnerability/issue context
- Generate working code fix
- Provide multiple solutions (if applicable)
- Explain why fix works
- Show before/after comparison

**Non-Functional**:
- Generate fixes in <5 seconds per issue
- Fixes must be syntactically correct (>95%)
- Fixes must address root cause (>85%)

#### Context Needs
- **Primary**: Issue location (file, line, code snippet)
- **Secondary**: Function/class containing issue
- **Tertiary**: Imported dependencies
- **Quaternary**: Related tests

#### Implementation Approach

**Step 1: Issue Analysis**
```typescript
interface SecurityIssue {
  severity: 'high' | 'medium' | 'low';
  category: string;
  file: string;
  line: number;
  codeSnippet: string;
  description: string;
}

async function analyzeIssue(issue: SecurityIssue): Promise<IssueContext> {
  // Extract function containing issue
  const ast = await astParser.parseFile(issue.file);
  const containingFunction = ast.findFunctionAtLine(issue.line);

  // Get imports and dependencies
  const imports = ast.getImports();
  const deps = await getDependencies(containingFunction);

  return {
    issue,
    function: containingFunction,
    imports,
    dependencies: deps
  };
}
```

**Step 2: Context Building**
```typescript
async function buildFixContext(context: IssueContext): Promise<string> {
  const parts = [
    `// File: ${context.issue.file}`,
    `// Issue: ${context.issue.description}`,
    ``,
    `// Current code:`,
    context.function.body,
    ``,
    `// Relevant imports:`,
    context.imports.join('\n'),
  ];

  return parts.join('\n');
}
```

**Step 3: AI Fix Generation**
```typescript
async function generateFix(context: IssueContext): Promise<FixSuggestion> {
  const prompt = buildFixPrompt(context);

  const response = await aiProvider.chat([{
    role: 'system',
    content: `You are a security expert. Generate fixes for code vulnerabilities.

    Output format (JSON):
    {
      "explanation": "Why this is vulnerable",
      "fix": "Complete fixed code",
      "alternatives": ["Alternative approach 1", "Alternative approach 2"],
      "bestPractices": ["Best practice 1", "Best practice 2"]
    }`
  }, {
    role: 'user',
    content: prompt
  }]);

  return JSON.parse(response.content);
}
```

**Step 4: Validation**
```typescript
async function validateFix(fix: FixSuggestion, original: string): Promise<boolean> {
  // 1. Syntax check
  try {
    await astParser.parse(fix.fix);
  } catch {
    return false;  // Invalid syntax
  }

  // 2. Semantic check (if possible)
  // - Still exports same interface?
  // - No new errors introduced?

  return true;
}
```

#### CLI Integration
```bash
guardscan security --ai-fix
guardscan security --ai-fix --interactive  # Apply fixes interactively
```

#### Performance
- Parallel fix generation (up to 5 concurrent)
- Cache fixes by issue hash
- Batch similar issues

---

### Feature 2: Test Generation

#### Overview
Automatically generate unit tests for functions/classes using AI.

#### Requirements

**Functional**:
- Generate comprehensive test suites
- Cover edge cases
- Follow project's test framework (Jest, Mocha, Pytest, etc.)
- Include setup/teardown if needed
- Generate mocks for dependencies

**Non-Functional**:
- Generate tests in <10 seconds per function
- Tests must compile/run (>90%)
- Cover >80% of function logic

#### Context Needs
- **Primary**: Target function/class
- **Secondary**: Function dependencies
- **Tertiary**: Existing tests (for style consistency)
- **Quaternary**: Type definitions

#### Implementation Approach

**Step 1: Function Analysis**
```typescript
interface FunctionForTesting {
  name: string;
  parameters: Parameter[];
  returnType: string;
  body: string;
  dependencies: Dependency[];
  sideEffects: SideEffect[];
}

async function analyzeFunctionForTesting(
  func: ParsedFunction
): Promise<FunctionForTesting> {
  return {
    name: func.name,
    parameters: func.parameters,
    returnType: func.returnType,
    body: func.body,
    dependencies: await extractDependencies(func),
    sideEffects: detectSideEffects(func)  // DB, API calls, etc.
  };
}
```

**Step 2: Test Template Detection**
```typescript
async function detectTestFramework(repoPath: string): Promise<TestFramework> {
  // Check package.json
  const pkg = await readPackageJson(repoPath);

  if (pkg.devDependencies?.jest) return 'jest';
  if (pkg.devDependencies?.mocha) return 'mocha';
  if (pkg.devDependencies?.vitest) return 'vitest';

  // Check for existing tests
  const testFiles = await findTestFiles(repoPath);
  if (testFiles.length > 0) {
    return detectFrameworkFromTests(testFiles[0]);
  }

  return 'jest';  // Default
}
```

**Step 3: AI Test Generation**
```typescript
async function generateTests(
  func: FunctionForTesting,
  framework: TestFramework
): Promise<string> {
  // Get example tests for style consistency
  const exampleTests = await getExampleTests(framework);

  const prompt = `Generate comprehensive unit tests for this function.

Framework: ${framework}

Function to test:
\`\`\`typescript
${func.body}
\`\`\`

Dependencies:
${func.dependencies.map(d => `- ${d.name}: ${d.type}`).join('\n')}

Requirements:
1. Follow ${framework} conventions
2. Test happy path
3. Test edge cases
4. Test error handling
5. Mock dependencies
6. Use this style: ${exampleTests}

Generate complete test file.`;

  const response = await aiProvider.chat([{
    role: 'system',
    content: 'You are a testing expert. Generate high-quality unit tests.'
  }, {
    role: 'user',
    content: prompt
  }]);

  return response.content;
}
```

**Step 4: Test Validation**
```typescript
async function validateTests(testCode: string): Promise<ValidationResult> {
  // 1. Syntax check
  try {
    await astParser.parse(testCode);
  } catch (e) {
    return { valid: false, error: 'Syntax error: ' + e.message };
  }

  // 2. Try to run tests (in sandbox)
  const result = await runTestsInSandbox(testCode);

  return {
    valid: result.passed,
    coverage: result.coverage,
    failures: result.failures
  };
}
```

#### CLI Integration
```bash
guardscan test --generate                    # Generate all missing tests
guardscan test --generate --file=auth.ts     # Generate for specific file
guardscan test --generate --coverage=80      # Generate until 80% coverage
```

---

### Feature 3: Commit Message & PR Description Generator

#### Overview
Analyze git changes and generate conventional commit messages and PR descriptions.

#### Requirements

**Functional**:
- Follow conventional commits format
- Categorize changes (feat, fix, docs, refactor, etc.)
- Identify breaking changes
- Generate detailed PR description with:
  - Summary
  - Changes
  - Testing checklist
  - Breaking changes (if any)

**Non-Functional**:
- Generate in <5 seconds
- Accuracy >90%

#### Context Needs
- **Primary**: Git diff
- **Secondary**: Changed files context
- **Tertiary**: Commit history (for style)

#### Implementation Approach

**Step 1: Git Diff Analysis**
```typescript
interface GitChange {
  file: string;
  additions: number;
  deletions: number;
  diff: string;
  type: 'added' | 'modified' | 'deleted' | 'renamed';
}

async function analyzeGitChanges(): Promise<GitChange[]> {
  const diff = await exec('git diff --cached');
  return parseGitDiff(diff);
}
```

**Step 2: Change Categorization**
```typescript
function categorizeChanges(changes: GitChange[]): ChangeCategory {
  const categories = {
    features: [],
    fixes: [],
    refactors: [],
    docs: [],
    tests: [],
    chores: []
  };

  for (const change of changes) {
    if (change.file.includes('.test.')) {
      categories.tests.push(change);
    } else if (change.file.includes('.md')) {
      categories.docs.push(change);
    } else if (isFeature(change.diff)) {
      categories.features.push(change);
    } else if (isFix(change.diff)) {
      categories.fixes.push(change);
    }
    // ... more categorization
  }

  return categories;
}
```

**Step 3: AI Message Generation**
```typescript
async function generateCommitMessage(changes: GitChange[]): Promise<string> {
  const prompt = `Analyze these git changes and generate a conventional commit message.

Changes:
${changes.map(c => `- ${c.file} (+${c.additions}, -${c.deletions})`).join('\n')}

Diff summary:
${changes.map(c => c.diff.slice(0, 500)).join('\n---\n')}

Format:
<type>(<scope>): <subject>

<body>

<footer>

Where:
- type: feat|fix|docs|style|refactor|test|chore
- scope: affected component
- subject: short description
- body: detailed explanation
- footer: breaking changes, refs

Example:
feat(auth): add OAuth2 authentication

Implemented OAuth2 flow with Google and GitHub providers.
Added user profile management and token refresh.

BREAKING CHANGE: Removed basic auth support`;

  const response = await aiProvider.chat([{
    role: 'system',
    content: 'You are a git expert. Generate clear, conventional commit messages.'
  }, {
    role: 'user',
    content: prompt
  }]);

  return response.content;
}
```

#### CLI Integration
```bash
git add .
guardscan commit --ai                # Generate and review message
guardscan commit --ai --auto         # Auto-commit with AI message
guardscan pr --ai                    # Generate PR description
```

---

### Feature 4: Code Explanation

#### Overview
Explain what code does in plain English, showing data flow and logic.

#### Requirements

**Functional**:
- Explain code at different levels:
  - Function level
  - Class level
  - File level
  - Module level
- Show data flow
- Identify design patterns
- Explain complex logic

**Non-Functional**:
- Generate explanation in <10 seconds
- Clarity: Understandable by junior developers

#### Context Needs
- **Primary**: Target code
- **Secondary**: Type definitions
- **Tertiary**: Usage examples
- **Quaternary**: Documentation

#### Implementation Approach

**Step 1: Code Analysis**
```typescript
interface CodeExplanation {
  summary: string;
  purpose: string;
  inputs: InputDescription[];
  outputs: OutputDescription[];
  dataFlow: DataFlowStep[];
  patterns: string[];
  complexity: 'low' | 'medium' | 'high';
}

async function analyzeCodeForExplanation(code: string): Promise<CodeAnalysis> {
  const ast = await astParser.parse(code);

  return {
    structure: extractStructure(ast),
    dataFlow: traceDataFlow(ast),
    dependencies: extractDependencies(ast),
    complexity: calculateComplexity(ast)
  };
}
```

**Step 2: AI Explanation**
```typescript
async function generateExplanation(
  code: string,
  analysis: CodeAnalysis
): Promise<CodeExplanation> {
  const prompt = `Explain this code in clear, simple language.

Code:
\`\`\`typescript
${code}
\`\`\`

Structure:
${JSON.stringify(analysis.structure, null, 2)}

Requirements:
1. Start with a one-sentence summary
2. Explain the purpose
3. Describe inputs and outputs
4. Trace the data flow step-by-step
5. Identify any design patterns
6. Rate complexity (low/medium/high)

Format as JSON.`;

  const response = await aiProvider.chat([{
    role: 'system',
    content: 'You are a code educator. Explain code clearly for all skill levels.'
  }, {
    role: 'user',
    content: prompt
  }]);

  return JSON.parse(response.content);
}
```

#### CLI Integration
```bash
guardscan explain <file>                    # Explain entire file
guardscan explain <file> --lines 20-50      # Explain specific lines
guardscan explain <file> --function=login   # Explain specific function
guardscan explain <file> --interactive      # Interactive Q&A mode
```

---

### Feature 5: Chat with Codebase (RAG)

#### Overview
Interactive chat mode where you can ask questions about your codebase and get context-aware answers.

#### Requirements

**Functional**:
- Answer questions about:
  - How features work
  - Where functionality is implemented
  - What code does
  - How to use APIs
  - Security concerns
- Maintain conversation context
- Show code snippets in responses
- Suggest related code to explore

**Non-Functional**:
- Response time <3 seconds
- Accuracy >85%
- Handle conversations up to 20 turns
- Support codebases up to 1M LOC

#### Context Needs
This is the **most complex feature** - requires full RAG system:
- Vector embeddings of entire codebase
- Efficient similarity search
- Context window management
- Conversation history

#### Architecture

**Step 1: Codebase Embedding** (One-time setup)
```typescript
async function embedCodebase(repoPath: string): Promise<void> {
  console.log('Indexing codebase...');

  // 1. Parse codebase
  const index = await codebaseIndexer.buildIndex(repoPath);

  // 2. Generate embeddings
  const chunks: CodeChunk[] = [];

  // Chunk functions
  for (const func of index.functions.values()) {
    chunks.push({
      type: 'function',
      content: formatFunctionForEmbedding(func),
      metadata: { file: func.file, name: func.name }
    });
  }

  // Chunk classes
  for (const cls of index.classes.values()) {
    chunks.push({
      type: 'class',
      content: formatClassForEmbedding(cls),
      metadata: { file: cls.file, name: cls.name }
    });
  }

  // Chunk documentation
  const docs = await extractDocumentation(repoPath);
  for (const doc of docs) {
    chunks.push({
      type: 'documentation',
      content: doc.content,
      metadata: { file: doc.file }
    });
  }

  // 3. Generate embeddings in batches
  const embeddings: CodeEmbedding[] = [];
  const batchSize = 100;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await aiProvider.generateEmbeddings(
      batch.map(c => c.content)
    );

    embeddings.push(...vectors.map((vector, j) => ({
      id: `${batch[j].type}-${i + j}`,
      type: batch[j].type,
      content: batch[j].content,
      embedding: vector,
      metadata: batch[j].metadata
    })));

    console.log(`Embedded ${i + batchSize} / ${chunks.length} chunks`);
  }

  // 4. Save embeddings
  await embeddingManager.saveEmbeddings(embeddings);

  console.log(`✓ Indexed ${embeddings.length} code chunks`);
}
```

**Step 2: Query Processing**
```typescript
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  context?: CodeEmbedding[];  // Retrieved context
}

async function processQuery(
  query: string,
  history: ChatMessage[]
): Promise<string> {
  // 1. Find relevant context
  const relevantCode = await embeddingManager.findRelevantContext(query, 4000);

  // 2. Build conversation history
  const messages: AIMessage[] = [{
    role: 'system',
    content: `You are a codebase expert assistant. Answer questions about this codebase using the provided context.

Relevant code context:
${relevantCode}

Guidelines:
- Be concise and accurate
- Show code snippets when helpful
- Admit if you're unsure
- Suggest related code to explore`
  }];

  // Add conversation history
  for (const msg of history) {
    messages.push({
      role: msg.role,
      content: msg.content
    });
  }

  // Add current query
  messages.push({
    role: 'user',
    content: query
  });

  // 3. Get AI response
  const response = await aiProvider.chat(messages);

  return response.content;
}
```

**Step 3: Conversation Management**
```typescript
class ConversationManager {
  private history: ChatMessage[] = [];
  private maxHistory: number = 20;

  async addMessage(role: 'user' | 'assistant', content: string): Promise<void> {
    this.history.push({ role, content });

    // Keep only recent messages
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  async processUserMessage(message: string): Promise<string> {
    await this.addMessage('user', message);
    const response = await processQuery(message, this.history);
    await this.addMessage('assistant', response);
    return response;
  }

  reset(): void {
    this.history = [];
  }
}
```

#### CLI Integration
```bash
guardscan chat                              # Start chat mode
guardscan chat --reindex                    # Rebuild embeddings
```

**Interactive Flow**:
```
$ guardscan chat

Indexing codebase... ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100%
✓ Indexed 1,234 code chunks

Chat mode started. Ask questions about your codebase.
Type 'exit' to quit, 'clear' to reset conversation.

You: How does authentication work?

AI: Authentication in this codebase uses JWT tokens. Here's the flow:

1. User logs in via POST /api/auth/login (src/routes/auth.ts:15)
2. Credentials are validated in src/auth/validator.ts:validateCredentials()
3. If valid, a JWT token is generated in src/auth/jwt.ts:generateToken()
4. Token is sent to client in response

Key files:
- src/routes/auth.ts - Auth endpoints
- src/auth/jwt.ts - Token generation/validation
- src/middleware/auth.ts - Auth middleware

Would you like to see the code for any of these?

You: Show me the token generation code

AI: Here's the token generation code from src/auth/jwt.ts:

```typescript
export function generateToken(user: User): string {
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}
```

This creates a JWT with:
- User ID and email as payload
- 24-hour expiration
- Signed with JWT_SECRET environment variable

You: Are there any security issues?

AI: Yes, I found a potential security issue:

**Issue**: No token expiration validation

The generateToken() function sets expiration, but I don't see validation
of expired tokens in the middleware (src/middleware/auth.ts).

**Recommendation**: Add expiration check:

```typescript
// src/middleware/auth.ts
try {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  req.user = decoded;
} catch (error) {
  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }
  throw error;
}
```

Would you like me to check for other security issues?
```

---

## Architecture Design

### Module Structure

```
cli/src/
├── core/
│   ├── ast-parser.ts           # Parse code to AST
│   ├── codebase-indexer.ts     # Index entire codebase
│   ├── embeddings.ts           # Vector embeddings & RAG
│   ├── context-builder.ts      # Build AI prompts
│   ├── ai-cache.ts             # Cache AI responses
│   └── token-manager.ts        # Manage token budgets
│
├── features/                   # AI feature implementations
│   ├── fix-suggestions.ts      # AI fix generator
│   ├── test-generator.ts       # AI test generator
│   ├── commit-generator.ts     # AI commit messages
│   ├── code-explainer.ts       # Code explanations
│   ├── chat.ts                 # RAG-based chat
│   ├── refactor.ts             # Refactoring suggestions
│   └── threat-model.ts         # Threat modeling
│
├── commands/                   # CLI commands
│   ├── security.ts             # Enhanced with --ai-fix
│   ├── test.ts                 # Enhanced with --generate
│   ├── commit.ts               # New: AI commit messages
│   ├── explain.ts              # New: Code explanation
│   ├── chat.ts                 # New: Interactive chat
│   └── refactor.ts             # New: Refactoring
│
├── providers/                  # AI provider abstraction
│   ├── base.ts                 # Enhanced base class
│   ├── openai.ts               # OpenAI implementation
│   ├── claude.ts               # Claude implementation
│   ├── gemini.ts               # Gemini implementation
│   └── ollama.ts               # Ollama implementation
│
└── utils/
    ├── code-formatter.ts       # Format code snippets
    ├── diff-generator.ts       # Generate diffs
    └── interactive-cli.ts      # Interactive prompts
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

**Goal**: Build core infrastructure

**Tasks**:
1. ✅ AST Parser
   - Multi-language support
   - Function/class extraction
   - Dependency analysis

2. ✅ Codebase Indexer
   - File indexing
   - Symbol extraction
   - Dependency graph

3. ✅ Enhanced Provider Interface
   - Embedding support
   - Token counting
   - Cost estimation

4. ✅ Cache Layer
   - AI response caching
   - Invalidation strategy

**Deliverables**:
- `cli/src/core/ast-parser.ts`
- `cli/src/core/codebase-indexer.ts`
- Enhanced `cli/src/providers/base.ts`
- `cli/src/core/ai-cache.ts`

**Success Criteria**:
- Can parse 10k LOC in <5 seconds
- Index 100k LOC in <30 seconds
- Cache hits save >50% of API calls

---

### Phase 2: Quick Wins (Week 3-4)

**Goal**: Implement high-ROI features

**Features**:
1. ✅ AI Fix Suggestions
   - Command: `guardscan security --ai-fix`
   - Integration with existing security scan

2. ✅ Commit Message Generator
   - Command: `guardscan commit --ai`
   - Git integration

3. ✅ Code Explanation
   - Command: `guardscan explain <file>`
   - Multiple explanation levels

**Deliverables**:
- `cli/src/features/fix-suggestions.ts`
- `cli/src/features/commit-generator.ts`
- `cli/src/features/code-explainer.ts`

**Success Criteria**:
- Fix suggestions >85% applicable
- Commit messages follow conventions
- Explanations clear to juniors

---

### Phase 3: Test & Docs (Week 5-6)

**Goal**: Automation features

**Features**:
1. ✅ Test Generation
   - Command: `guardscan test --generate`
   - Support Jest, Mocha, Pytest

2. ✅ Documentation Generator
   - Command: `guardscan docs --generate`
   - README, API docs, diagrams

**Deliverables**:
- `cli/src/features/test-generator.ts`
- `cli/src/features/docs-generator.ts`

**Success Criteria**:
- Generated tests compile >90%
- Test coverage improvement >20%
- Docs accuracy >85%

---

### Phase 4: RAG & Chat (Week 7-10)

**Goal**: Interactive AI assistant

**Features**:
1. ✅ Vector Embeddings
   - Codebase embedding
   - Similarity search
   - Context retrieval

2. ✅ Chat Mode
   - Command: `guardscan chat`
   - RAG-based Q&A
   - Conversation management

**Deliverables**:
- `cli/src/core/embeddings.ts`
- `cli/src/features/chat.ts`

**Success Criteria**:
- Can handle 1M LOC codebases
- Response time <3 seconds
- Answer accuracy >85%

---

### Phase 5: Advanced Features (Week 11-14)

**Goal**: Specialized AI features

**Features**:
1. ✅ Refactoring Suggestions
2. ✅ Threat Modeling
3. ✅ Migration Assistant
4. ✅ Interactive Code Review

**Deliverables**:
- `cli/src/features/refactor.ts`
- `cli/src/features/threat-model.ts`
- `cli/src/features/migration.ts`
- `cli/src/features/interactive-review.ts`

---

## Technical Specifications

### Performance Requirements

| Operation | Target | Max |
|-----------|--------|-----|
| Parse single file | <100ms | 500ms |
| Index 100k LOC | <30s | 60s |
| Generate embedding | <200ms | 1s |
| Similarity search (10k embeddings) | <100ms | 500ms |
| AI response (simple) | <3s | 10s |
| AI response (complex) | <10s | 30s |

### Storage Requirements

| Data | Size (100k LOC) | Storage Location |
|------|-----------------|------------------|
| Code index | ~50MB | `~/.guardscan/cache/<repo>/index.json` |
| Embeddings | ~100MB | `~/.guardscan/cache/<repo>/embeddings/` |
| AI cache | ~200MB | `~/.guardscan/cache/<repo>/ai-cache/` |
| **Total** | **~350MB** | |

### API Cost Estimates

**Assumptions**:
- 100k LOC codebase
- 10 AI features used per day
- OpenAI GPT-4 pricing

| Feature | Tokens/Use | Cost/Use | Daily Cost |
|---------|------------|----------|------------|
| Fix suggestions (10 issues) | 20k | $0.60 | $0.60 |
| Test generation (5 functions) | 15k | $0.45 | $0.45 |
| Commit messages | 5k | $0.15 | $0.15 |
| Code explanation (3 queries) | 12k | $0.36 | $0.36 |
| Chat mode (10 queries) | 30k | $0.90 | $0.90 |
| **Total** | **82k** | **$2.46** | **$2.46** |

**Cost Optimizations**:
- Cache responses (50% savings): **$1.23/day**
- Use Claude Sonnet (cheaper): **$0.74/day**
- Use Ollama (local): **$0/day**

---

## Risk Analysis

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| AI hallucinations (wrong fixes) | High | High | Validate syntax, run tests, user review |
| Large codebase performance | Medium | High | Incremental indexing, lazy loading |
| Token limits exceeded | Medium | Medium | Smart chunking, context prioritization |
| API costs too high | Low | Medium | Caching, cheaper models, local options |
| Embedding storage size | Low | Low | Compression, selective embedding |

### User Experience Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Complex setup | Medium | High | Auto-detection, good defaults |
| Slow initial indexing | High | Medium | Progress bars, background processing |
| Unclear AI suggestions | Medium | High | Clear formatting, explanations |
| Feature overload | Low | Medium | Progressive disclosure, good docs |

---

## Success Metrics

### Adoption Metrics
- **Target**: 50% of users try ≥1 AI feature
- **Measure**: Telemetry (opt-in)

### Quality Metrics
- **Fix suggestions**: >85% applicable
- **Test generation**: >90% compile successfully
- **Commit messages**: >80% follow conventions
- **Chat accuracy**: >85% correct answers

### Performance Metrics
- **Index time**: <30s for 100k LOC
- **Response time**: <3s for chat queries
- **Cache hit rate**: >50%

### Cost Metrics
- **Average daily cost**: <$5/user (with OpenAI)
- **With caching**: <$2.50/user
- **With Ollama**: $0/user

---

## Next Steps

### Immediate Actions
1. Review and approve this plan
2. Prioritize features (which to build first?)
3. Choose implementation approach:
   - **Option A**: Build foundation, then features sequentially
   - **Option B**: Build one complete feature at a time (vertical slice)
   - **Option C**: Hybrid (foundation + 1-2 quick wins)

### Questions to Resolve
1. **Embeddings**: Use OpenAI embeddings or local model (nomic-embed)?
2. **Vector storage**: File-based or use ChromaDB/LanceDB?
3. **Multi-language**: Start with TypeScript only or support Python/Java/Go?
4. **Test frameworks**: Support all or start with Jest/Pytest?

---

**Ready to start implementation?** 🚀

Which phase/feature should we tackle first?
