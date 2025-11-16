/**
 * rag-context.ts - RAG Context Builder
 *
 * Purpose: Build optimized context for AI queries using retrieved embeddings.
 * Features: Token budget allocation, context prioritization, multi-source assembly
 */

import { CodeEmbedding, SearchResult } from './embeddings';
import { EmbeddingSearchEngine } from './embedding-search';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface RAGContext {
  query: string;
  relevantCode: CodeSnippet[];
  relevantDocs: DocumentationSnippet[];
  conversationHistory: ConversationTurn[];
  tokenBudget: number;
  tokensUsed: number;
  metadata: RAGMetadata;
}

export interface CodeSnippet {
  source: string;          // File path
  startLine?: number;
  endLine?: number;
  code: string;
  explanation?: string;    // AI-generated summary
  relevanceScore: number;  // 0.0 - 1.0
  type: 'function' | 'class' | 'file';
  language: string;
}

export interface DocumentationSnippet {
  source: string;
  content: string;
  type: 'readme' | 'api' | 'architecture' | 'contributing' | 'general';
  relevanceScore: number;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  tokens?: number;
}

export interface RAGMetadata {
  searchTimeMs: number;
  totalResults: number;
  resultsUsed: number;
  averageRelevance: number;
  budgetUtilization: number;  // 0.0 - 1.0
}

export interface ContextBuildOptions {
  maxTokens?: number;          // Total token budget (default: 4000)
  codeWeight?: number;         // 0-1 (default: 0.6)
  docsWeight?: number;         // 0-1 (default: 0.2)
  historyWeight?: number;      // 0-1 (default: 0.2)
  maxCodeSnippets?: number;    // Max code snippets (default: 10)
  maxDocSnippets?: number;     // Max doc snippets (default: 3)
  includeExplanations?: boolean;  // Generate AI summaries (default: false)
  diversityThreshold?: number;    // Diversity score 0-1 (default: 0.7)
}

// ============================================================================
// Token Manager
// ============================================================================

export class TokenManager {
  private readonly CHARS_PER_TOKEN = 4;  // Rough estimate

  /**
   * Estimate token count for text
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }

  /**
   * Estimate tokens for code snippet with formatting
   */
  estimateCodeSnippetTokens(snippet: CodeSnippet): number {
    const header = `// File: ${snippet.source}\n`;
    const location = snippet.startLine ? `// Lines: ${snippet.startLine}-${snippet.endLine}\n` : '';
    const code = snippet.code;
    const explanation = snippet.explanation ? `\n// Explanation: ${snippet.explanation}\n` : '';

    const total = header + location + code + explanation;
    return this.estimateTokens(total);
  }

  /**
   * Estimate tokens for doc snippet with formatting
   */
  estimateDocSnippetTokens(snippet: DocumentationSnippet): number {
    const header = `# Documentation: ${snippet.source}\n`;
    const content = snippet.content;

    const total = header + content;
    return this.estimateTokens(total);
  }

  /**
   * Estimate tokens for conversation turn
   */
  estimateConversationTokens(turn: ConversationTurn): number {
    if (turn.tokens) return turn.tokens;

    const rolePrefix = `${turn.role}: `;
    const total = rolePrefix + turn.content;
    return this.estimateTokens(total);
  }

  /**
   * Truncate text to fit within token budget
   */
  truncateToTokens(text: string, maxTokens: number): string {
    const maxChars = maxTokens * this.CHARS_PER_TOKEN;
    if (text.length <= maxChars) return text;

    return text.slice(0, maxChars) + '\n... (truncated)';
  }
}

// ============================================================================
// RAG Context Builder
// ============================================================================

export class RAGContextBuilder {
  private tokenManager: TokenManager;

  constructor(
    private searchEngine: EmbeddingSearchEngine
  ) {
    this.tokenManager = new TokenManager();
  }

  /**
   * Build context for RAG query
   */
  async buildContext(
    query: string,
    conversationHistory: ConversationTurn[] = [],
    options: ContextBuildOptions = {}
  ): Promise<RAGContext> {
    const startTime = Date.now();

    // Normalize options with defaults
    const opts = this.normalizeOptions(options);

    // Initialize context
    const context: RAGContext = {
      query,
      relevantCode: [],
      relevantDocs: [],
      conversationHistory: [],
      tokenBudget: opts.maxTokens,
      tokensUsed: 0,
      metadata: {
        searchTimeMs: 0,
        totalResults: 0,
        resultsUsed: 0,
        averageRelevance: 0,
        budgetUtilization: 0,
      },
    };

    // Calculate budget allocation
    const budgets = {
      code: Math.floor(opts.maxTokens * opts.codeWeight),
      docs: Math.floor(opts.maxTokens * opts.docsWeight),
      history: Math.floor(opts.maxTokens * opts.historyWeight),
    };

    // 1. Search for relevant code and docs
    const { results, stats } = await this.searchEngine.search(query, {
      k: opts.maxCodeSnippets * 2,  // Get more, then filter
      minSimilarity: 0.3,  // Lower threshold for broader search
      enableRanking: true,
    });

    context.metadata.searchTimeMs = stats.searchTimeMs;
    context.metadata.totalResults = results.length;

    // 2. Separate code and documentation results
    const codeResults = results.filter(r =>
      r.embedding.type === 'function' ||
      r.embedding.type === 'class' ||
      r.embedding.type === 'file'
    );

    const docResults = results.filter(r =>
      r.embedding.type === 'documentation'
    );

    // 3. Build code snippets (with diversity)
    const codeSnippets = await this.buildCodeSnippets(
      codeResults,
      budgets.code,
      opts
    );
    context.relevantCode = codeSnippets.snippets;
    context.tokensUsed += codeSnippets.tokensUsed;

    // 4. Build documentation snippets
    const docSnippets = await this.buildDocSnippets(
      docResults,
      budgets.docs,
      opts
    );
    context.relevantDocs = docSnippets.snippets;
    context.tokensUsed += docSnippets.tokensUsed;

    // 5. Add conversation history (most recent first)
    const historySnippets = this.buildConversationContext(
      conversationHistory,
      budgets.history
    );
    context.conversationHistory = historySnippets.turns;
    context.tokensUsed += historySnippets.tokensUsed;

    // 6. Calculate metadata
    context.metadata.resultsUsed = context.relevantCode.length + context.relevantDocs.length;
    context.metadata.averageRelevance = this.calculateAverageRelevance(
      context.relevantCode,
      context.relevantDocs
    );
    context.metadata.budgetUtilization = context.tokensUsed / context.tokenBudget;
    context.metadata.searchTimeMs = Date.now() - startTime;

    return context;
  }

  /**
   * Build code snippets from search results
   */
  private async buildCodeSnippets(
    results: SearchResult[],
    budget: number,
    options: ContextBuildOptions
  ): Promise<{ snippets: CodeSnippet[]; tokensUsed: number }> {
    const snippets: CodeSnippet[] = [];
    let tokensUsed = 0;
    const seenFiles = new Set<string>();

    for (const result of results) {
      if (snippets.length >= options.maxCodeSnippets!) break;
      if (tokensUsed >= budget) break;

      const emb = result.embedding;

      // Apply diversity - limit snippets from same file
      if (seenFiles.has(emb.source) && seenFiles.size > 3) {
        continue;  // Skip if we already have enough variety
      }

      const snippet: CodeSnippet = {
        source: emb.source,
        startLine: emb.startLine,
        endLine: emb.endLine,
        code: emb.content,
        relevanceScore: result.relevanceScore || result.similarityScore,
        type: emb.type as 'function' | 'class' | 'file',
        language: emb.metadata.language,
      };

      // Estimate tokens
      const tokens = this.tokenManager.estimateCodeSnippetTokens(snippet);

      // Check if it fits
      if (tokensUsed + tokens <= budget) {
        // Truncate if needed
        if (tokens > budget * 0.3) {  // No single snippet should use >30% of budget
          snippet.code = this.tokenManager.truncateToTokens(
            snippet.code,
            Math.floor(budget * 0.3)
          );
        }

        snippets.push(snippet);
        tokensUsed += this.tokenManager.estimateCodeSnippetTokens(snippet);
        seenFiles.add(emb.source);
      }
    }

    return { snippets, tokensUsed };
  }

  /**
   * Build documentation snippets from search results
   */
  private async buildDocSnippets(
    results: SearchResult[],
    budget: number,
    options: ContextBuildOptions
  ): Promise<{ snippets: DocumentationSnippet[]; tokensUsed: number }> {
    const snippets: DocumentationSnippet[] = [];
    let tokensUsed = 0;

    for (const result of results) {
      if (snippets.length >= options.maxDocSnippets!) break;
      if (tokensUsed >= budget) break;

      const emb = result.embedding;
      const docType = this.inferDocType(emb.source);

      const snippet: DocumentationSnippet = {
        source: emb.source,
        content: emb.content,
        type: docType,
        relevanceScore: result.relevanceScore || result.similarityScore,
      };

      // Estimate tokens
      const tokens = this.tokenManager.estimateDocSnippetTokens(snippet);

      // Check if it fits
      if (tokensUsed + tokens <= budget) {
        // Truncate if needed
        if (tokens > budget * 0.5) {  // Docs can use more space
          snippet.content = this.tokenManager.truncateToTokens(
            snippet.content,
            Math.floor(budget * 0.5)
          );
        }

        snippets.push(snippet);
        tokensUsed += this.tokenManager.estimateDocSnippetTokens(snippet);
      }
    }

    return { snippets, tokensUsed };
  }

  /**
   * Build conversation context from history
   */
  private buildConversationContext(
    history: ConversationTurn[],
    budget: number
  ): { turns: ConversationTurn[]; tokensUsed: number } {
    const turns: ConversationTurn[] = [];
    let tokensUsed = 0;

    // Process in reverse (most recent first)
    const reversedHistory = [...history].reverse();

    for (const turn of reversedHistory) {
      const tokens = this.tokenManager.estimateConversationTokens(turn);

      if (tokensUsed + tokens <= budget) {
        turns.unshift(turn);  // Add to beginning to maintain chronological order
        tokensUsed += tokens;
      } else {
        break;  // Budget exhausted
      }
    }

    return { turns, tokensUsed };
  }

  /**
   * Format context for AI prompt
   */
  formatContextForPrompt(context: RAGContext): string {
    const parts: string[] = [];

    // 1. System context
    parts.push('# Codebase Context\n');
    parts.push(`You are analyzing a codebase to answer: "${context.query}"\n`);
    parts.push(`Context retrieved from ${context.metadata.resultsUsed} relevant sources.\n`);

    // 2. Relevant code
    if (context.relevantCode.length > 0) {
      parts.push('\n## Relevant Code\n');
      context.relevantCode.forEach((snippet, i) => {
        parts.push(`\n### ${i + 1}. ${snippet.source}`);
        if (snippet.startLine) {
          parts.push(` (lines ${snippet.startLine}-${snippet.endLine})`);
        }
        parts.push(` [${snippet.language}]`);
        parts.push(` - Relevance: ${(snippet.relevanceScore * 100).toFixed(1)}%\n`);
        parts.push('```' + snippet.language + '\n');
        parts.push(snippet.code);
        parts.push('\n```\n');

        if (snippet.explanation) {
          parts.push(`**Explanation:** ${snippet.explanation}\n`);
        }
      });
    }

    // 3. Relevant documentation
    if (context.relevantDocs.length > 0) {
      parts.push('\n## Relevant Documentation\n');
      context.relevantDocs.forEach((doc, i) => {
        parts.push(`\n### ${i + 1}. ${doc.source} [${doc.type}]\n`);
        parts.push(doc.content);
        parts.push('\n');
      });
    }

    // 4. Conversation history
    if (context.conversationHistory.length > 0) {
      parts.push('\n## Recent Conversation\n');
      context.conversationHistory.forEach(turn => {
        const role = turn.role === 'user' ? 'User' : 'Assistant';
        parts.push(`\n**${role}:** ${turn.content}\n`);
      });
    }

    // 5. Query
    parts.push('\n## Current Question\n');
    parts.push(`**User:** ${context.query}\n`);

    return parts.join('');
  }

  /**
   * Get context statistics
   */
  getContextStats(context: RAGContext): {
    totalTokens: number;
    codeTokens: number;
    docsTokens: number;
    historyTokens: number;
    budgetUsed: string;
    snippetCount: number;
  } {
    const codeTokens = context.relevantCode.reduce(
      (sum, s) => sum + this.tokenManager.estimateCodeSnippetTokens(s),
      0
    );
    const docsTokens = context.relevantDocs.reduce(
      (sum, d) => sum + this.tokenManager.estimateDocSnippetTokens(d),
      0
    );
    const historyTokens = context.conversationHistory.reduce(
      (sum, t) => sum + this.tokenManager.estimateConversationTokens(t),
      0
    );

    return {
      totalTokens: context.tokensUsed,
      codeTokens,
      docsTokens,
      historyTokens,
      budgetUsed: `${(context.metadata.budgetUtilization * 100).toFixed(1)}%`,
      snippetCount: context.relevantCode.length + context.relevantDocs.length,
    };
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  private normalizeOptions(options: ContextBuildOptions): Required<ContextBuildOptions> {
    return {
      maxTokens: options.maxTokens || 4000,
      codeWeight: options.codeWeight || 0.6,
      docsWeight: options.docsWeight || 0.2,
      historyWeight: options.historyWeight || 0.2,
      maxCodeSnippets: options.maxCodeSnippets || 10,
      maxDocSnippets: options.maxDocSnippets || 3,
      includeExplanations: options.includeExplanations || false,
      diversityThreshold: options.diversityThreshold || 0.7,
    };
  }

  private inferDocType(source: string): DocumentationSnippet['type'] {
    if (source.includes('README')) return 'readme';
    if (source.includes('API')) return 'api';
    if (source.includes('ARCHITECTURE')) return 'architecture';
    if (source.includes('CONTRIBUTING')) return 'contributing';
    return 'general';
  }

  private calculateAverageRelevance(
    code: CodeSnippet[],
    docs: DocumentationSnippet[]
  ): number {
    const allScores = [
      ...code.map(c => c.relevanceScore),
      ...docs.map(d => d.relevanceScore),
    ];

    if (allScores.length === 0) return 0;

    const sum = allScores.reduce((a, b) => a + b, 0);
    return sum / allScores.length;
  }
}
