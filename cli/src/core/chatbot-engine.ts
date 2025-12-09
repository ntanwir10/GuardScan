/**
 * chatbot-engine.ts - Interactive AI Chatbot for Codebase Q&A
 *
 * Purpose: Manage conversations with AI about the codebase using RAG.
 * Features: Conversation history, context tracking, streaming responses
 */

import { AIProvider } from '../providers/base';
import { RAGContextBuilder, RAGContext, ConversationTurn, TokenManager } from './rag-context';
import { EmbeddingSearchEngine } from './embedding-search';
import { CodebaseIndexer } from './codebase-indexer';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: ChatMessageMetadata;
}

export interface ChatMessageMetadata {
  tokensUsed?: number;
  relevantFiles?: string[];
  searchTimeMs?: number;
  modelUsed?: string;
  temperature?: number;
}

export interface ChatSession {
  id: string;
  repoId: string;
  createdAt: Date;
  lastActiveAt: Date;
  messages: ChatMessage[];
  totalTokens: number;
  metadata: ChatSessionMetadata;
}

export interface ChatSessionMetadata {
  projectName?: string;
  primaryLanguage?: string;
  totalFiles?: number;
  codebaseSize?: number;
}

export interface ChatOptions {
  temperature?: number;        // 0-1 (default: 0.7)
  maxTokens?: number;          // Max response tokens (default: 1000)
  contextTokens?: number;      // Max context tokens (default: 4000)
  streaming?: boolean;         // Enable streaming (default: false)
  includeHistory?: boolean;    // Include conversation history (default: true)
  maxHistoryTurns?: number;    // Max conversation turns to include (default: 5)
  systemPrompt?: string;       // Custom system prompt
  model?: string;              // Override AI model for this chat session
}

export interface ChatResponse {
  message: ChatMessage;
  context: RAGContext;
  stats: ChatStats;
}

export interface ChatStats {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  searchTimeMs: number;
  responseTimeMs: number;
  relevantSnippets: number;
}

// ============================================================================
// Chatbot Engine
// ============================================================================

export class ChatbotEngine {
  private tokenManager: TokenManager;
  private sessions: Map<string, ChatSession> = new Map();

  constructor(
    private aiProvider: AIProvider,
    private ragContextBuilder: RAGContextBuilder,
    private searchEngine: EmbeddingSearchEngine,
    private indexer: CodebaseIndexer,
    private repoId: string,
    private repoRoot: string
  ) {
    this.tokenManager = new TokenManager();
  }

  /**
   * Create a new chat session
   */
  async createSession(metadata?: Partial<ChatSessionMetadata>): Promise<ChatSession> {
    const session: ChatSession = {
      id: this.generateSessionId(),
      repoId: this.repoId,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      messages: [],
      totalTokens: 0,
      metadata: {
        projectName: metadata?.projectName,
        primaryLanguage: metadata?.primaryLanguage,
        totalFiles: metadata?.totalFiles,
        codebaseSize: metadata?.codebaseSize,
      },
    };

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Send a message and get AI response
   */
  async chat(
    sessionId: string,
    userMessage: string,
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    const startTime = Date.now();

    // Get or create session
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.createSession();
    }

    // Normalize options
    const opts = this.normalizeOptions(options);

    // Add user message to history
    const userMsg: ChatMessage = {
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    };
    session.messages.push(userMsg);

    // Build conversation history
    const conversationHistory = this.buildConversationHistory(
      session,
      opts.maxHistoryTurns
    );

    // Build RAG context
    const ragContext = await this.ragContextBuilder.buildContext(
      userMessage,
      conversationHistory,
      {
        maxTokens: opts.contextTokens,
        codeWeight: 0.6,
        docsWeight: 0.2,
        historyWeight: 0.2,
      }
    );

    // Build AI prompt with context
    const prompt = this.buildPrompt(ragContext, opts.systemPrompt);

    // Call AI provider
    const aiResponse = await this.callAI(prompt, opts);

    // Get accurate token count - prefer API response, fallback to estimation
    const actualTokensUsed = aiResponse.tokensUsed ?? 
      (this.tokenManager.estimateTokens(prompt) + 
       this.tokenManager.estimateTokens(aiResponse.content));

    // Get actual model name from API response, fallback to provider name
    const actualModelName = aiResponse.model || this.aiProvider.getName();

    // Create assistant message
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: aiResponse.content,
      timestamp: new Date(),
      metadata: {
        tokensUsed: actualTokensUsed,
        relevantFiles: this.extractRelevantFiles(ragContext),
        searchTimeMs: ragContext.metadata.searchTimeMs,
        modelUsed: actualModelName, // Use actual model name from API
        temperature: opts.temperature,
      },
    };

    session.messages.push(assistantMsg);
    session.lastActiveAt = new Date();
    session.totalTokens += actualTokensUsed;

    // Calculate stats with accurate values
    const stats: ChatStats = {
      totalTokens: actualTokensUsed,
      promptTokens: aiResponse.tokensUsed 
        ? (this.tokenManager.estimateTokens(prompt)) // If we have total, estimate prompt
        : this.tokenManager.estimateTokens(prompt),
      completionTokens: aiResponse.tokensUsed
        ? (actualTokensUsed - this.tokenManager.estimateTokens(prompt)) // Estimate completion
        : this.tokenManager.estimateTokens(aiResponse.content),
      searchTimeMs: ragContext.metadata.searchTimeMs,
      responseTimeMs: Date.now() - startTime,
      relevantSnippets: ragContext.relevantCode.length + ragContext.relevantDocs.length,
    };

    return {
      message: assistantMsg,
      context: ragContext,
      stats,
    };
  }

  /**
   * Get chat session
   */
  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all sessions
   */
  listSessions(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Clear session messages
   */
  clearSessionMessages(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages = [];
      session.totalTokens = 0;
    }
  }

  /**
   * Save session to disk
   */
  async saveSession(sessionId: string, filePath: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const fs = await import('fs');
    await fs.promises.writeFile(
      filePath,
      JSON.stringify(session, null, 2),
      'utf-8'
    );
  }

  /**
   * Load session from disk
   */
  async loadSession(filePath: string): Promise<ChatSession> {
    const fs = await import('fs');
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const session: ChatSession = JSON.parse(content);

    // Convert date strings back to Date objects
    session.createdAt = new Date(session.createdAt);
    session.lastActiveAt = new Date(session.lastActiveAt);
    session.messages.forEach(msg => {
      msg.timestamp = new Date(msg.timestamp);
    });

    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Export conversation as markdown
   */
  exportAsMarkdown(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const lines: string[] = [];

    // Header
    lines.push(`# Chat Session: ${session.id}`);
    lines.push(`**Repository:** ${session.metadata.projectName || session.repoId}`);
    lines.push(`**Created:** ${session.createdAt.toLocaleString()}`);
    lines.push(`**Total Tokens:** ${session.totalTokens}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Messages
    session.messages.forEach((msg, i) => {
      const role = msg.role === 'user' ? '👤 User' : '🤖 Assistant';
      lines.push(`## ${i + 1}. ${role}`);
      lines.push(`**Time:** ${msg.timestamp.toLocaleString()}`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');

      if (msg.metadata?.relevantFiles && msg.metadata.relevantFiles.length > 0) {
        lines.push('**Relevant Files:**');
        msg.metadata.relevantFiles.forEach(file => {
          lines.push(`- ${file}`);
        });
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    });

    return lines.join('\n');
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  /**
   * Build conversation history for RAG context
   */
  private buildConversationHistory(
    session: ChatSession,
    maxTurns: number
  ): ConversationTurn[] {
    const turns: ConversationTurn[] = [];

    // Get last N messages (excluding current user message)
    const messages = session.messages.slice(-maxTurns * 2);

    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        turns.push({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          tokens: msg.metadata?.tokensUsed,
        });
      }
    }

    return turns;
  }

  /**
   * Build AI prompt with RAG context
   */
  private buildPrompt(ragContext: RAGContext, systemPrompt?: string): string {
    const parts: string[] = [];

    // System prompt
    const defaultSystemPrompt = `You are an expert software engineer assistant helping developers understand and work with their codebase.

Your capabilities:
- Analyze code structure, patterns, and architecture
- Explain how features work across multiple files
- Identify bugs, security issues, and code smells
- Suggest improvements and refactorings
- Answer questions about the codebase with specific code references

Guidelines:
- Always cite specific files and line numbers when referencing code
- Be concise but thorough
- If you don't know something, say so rather than guessing
- Provide actionable insights and specific examples
- Format code snippets with proper syntax highlighting`;

    parts.push(systemPrompt || defaultSystemPrompt);
    parts.push('\n\n---\n');

    // RAG context
    const formattedContext = this.ragContextBuilder.formatContextForPrompt(ragContext);
    parts.push(formattedContext);

    // Final instruction
    parts.push('\n\n---\n');
    parts.push('Based on the above context, please provide a helpful, accurate, and well-formatted response.');

    return parts.join('');
  }

  /**
   * Call AI provider with prompt
   */
  private async callAI(
    prompt: string,
    options: Required<Omit<ChatOptions, 'model'>> & { model?: string }
  ): Promise<{ content: string; tokensUsed?: number; model?: string }> {
    const chatOptions: any = {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    };
    
    // Only include model if provided
    if (options.model) {
      chatOptions.model = options.model;
    }
    
    const response = await this.aiProvider.chat(
      [
        {
          role: 'user',
          content: prompt,
        },
      ],
      chatOptions
    );

    return {
      content: response.content,
      tokensUsed: response.usage?.totalTokens,
      model: response.model, // Include actual model name from API response
    };
  }

  /**
   * Extract relevant files from RAG context
   */
  private extractRelevantFiles(ragContext: RAGContext): string[] {
    const files = new Set<string>();

    ragContext.relevantCode.forEach(snippet => {
      files.add(snippet.source);
    });

    ragContext.relevantDocs.forEach(doc => {
      files.add(doc.source);
    });

    return Array.from(files);
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 9);
    return `chat-${timestamp}-${randomPart}`;
  }

  /**
   * Normalize chat options with defaults
   */
  private normalizeOptions(options: ChatOptions): Required<Omit<ChatOptions, 'model'>> & { model?: string } {
    return {
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 1000,
      contextTokens: options.contextTokens ?? 4000,
      streaming: options.streaming ?? false,
      includeHistory: options.includeHistory !== false,
      maxHistoryTurns: options.maxHistoryTurns ?? 5,
      systemPrompt: options.systemPrompt ?? '',
      model: options.model, // Pass through model if provided
    };
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId: string): {
    messageCount: number;
    totalTokens: number;
    averageTokensPerMessage: number;
    duration: number;
    questionsAsked: number;
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const messageCount = session.messages.length;
    const questionsAsked = session.messages.filter(m => m.role === 'user').length;
    const duration = session.lastActiveAt.getTime() - session.createdAt.getTime();

    return {
      messageCount,
      totalTokens: session.totalTokens,
      averageTokensPerMessage: messageCount > 0 ? session.totalTokens / messageCount : 0,
      duration,
      questionsAsked,
    };
  }

  /**
   * Summarize long conversations (for context compression)
   */
  async summarizeConversation(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Build summary prompt
    const conversationText = session.messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n\n');

    const summaryPrompt = `Summarize the following conversation in 2-3 paragraphs, focusing on:
1. Main topics discussed
2. Key questions asked
3. Important findings or conclusions

Conversation:
${conversationText}`;

    const response = await this.aiProvider.chat([
      { role: 'user', content: summaryPrompt },
    ]);

    return response.content;
  }
}
