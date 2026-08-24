/**
 * Deterministic end-to-end coverage for the local RAG pipeline.
 *
 * The provider doubles only the external embedding/chat boundaries. Real
 * repository indexing, chunking, persistence, retrieval, context budgeting,
 * and conversation state are exercised without network access or API keys.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {afterEach, beforeEach, describe, expect, it} from '@jest/globals';

import {ChatbotEngine} from '../../src/core/chatbot-engine';
import {CodebaseIndexer} from '../../src/core/codebase-indexer';
import {EmbeddingChunker} from '../../src/core/embedding-chunker';
import {EmbeddingIndexer} from '../../src/core/embedding-indexer';
import {EmbeddingSearchEngine} from '../../src/core/embedding-search';
import {FileBasedEmbeddingStore} from '../../src/core/embedding-store';
import {EMBEDDING_INDEX_VERSION, EmbeddingProvider} from '../../src/core/embeddings';
import {RAGContextBuilder} from '../../src/core/rag-context';
import {AIMessage, AIProvider, AIResponse, ProviderCapabilities} from '../../src/providers/base';

class DeterministicEmbeddingProvider implements EmbeddingProvider {
  getName(): string { return 'deterministic-local'; }
  getDimensions(): number { return 4; }
  getModel(): string { return 'keyword-v1'; }
  estimateCost(): number { return 0; }
  isAvailable(): boolean { return true; }
  async testConnection(): Promise<boolean> { return true; }

  async generateEmbedding(text: string): Promise<number[]> {
    const normalized = text.toLowerCase();
    const score = (terms: string[]) => terms.reduce(
      (total, term) => total + (normalized.match(new RegExp(term, 'g')) || []).length,
      0
    );
    return [
      score(['auth', 'login', 'credential', 'password', 'verify']) + 0.01,
      score(['user', 'account', 'profile', 'create']) + 0.01,
      score(['database', 'lookup', 'save', 'persist']) + 0.01,
      score(['readme', 'getting started', 'install', 'documentation']) + 0.01,
    ];
  }

  async generateBulkEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(text => this.generateEmbedding(text)));
  }
}

class RejectingEmbeddingProvider extends DeterministicEmbeddingProvider {
  async generateBulkEmbeddings(): Promise<number[][]> {
    throw new Error('intentional migration failure');
  }
}

class DeterministicChatProvider extends AIProvider {
  readonly prompts: string[] = [];

  getCapabilities(): ProviderCapabilities {
    return {
      supportsChat: true,
      supportsEmbeddings: false,
      supportsStreaming: false,
      maxContextTokens: 4096,
    };
  }

  async chat(messages: AIMessage[]): Promise<AIResponse> {
    const prompt = messages.map(message => message.content).join('\n');
    this.prompts.push(prompt);
    return {
      content: prompt.includes('AuthService')
        ? 'Authentication is implemented by AuthService.'
        : 'The indexed context was used.',
      model: 'deterministic-chat-v1',
      usage: {promptTokens: 20, completionTokens: 8, totalTokens: 28},
    };
  }

  async *stream(): AsyncGenerator<string, void, unknown> {
    yield 'unused';
  }

  isAvailable(): boolean { return true; }
  getName(): string { return 'deterministic-chat'; }
  async testConnection(): Promise<boolean> { return true; }
}

describe('RAG system end to end', () => {
  let repository: string;
  let stateRoot: string;
  let indexer: CodebaseIndexer;
  let store: FileBasedEmbeddingStore;
  let embeddingIndexer: EmbeddingIndexer;
  let embeddingProvider: DeterministicEmbeddingProvider;
  let search: EmbeddingSearchEngine;
  let contextBuilder: RAGContextBuilder;

  beforeEach(async () => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-rag-repo-'));
    stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-rag-state-'));
    fs.mkdirSync(path.join(repository, 'src'), {recursive: true});
    fs.writeFileSync(path.join(repository, 'src', 'auth.ts'), `
export class AuthService {
  async authenticate(username: string, password: string): Promise<boolean> {
    const user = await this.findUser(username);
    return user ? this.verifyPassword(user, password) : false;
  }
  private async findUser(username: string) { return { username }; }
  private verifyPassword(_user: unknown, password: string) { return password.length > 0; }
}
`);
    fs.writeFileSync(path.join(repository, 'src', 'user.ts'), `
export interface User { id: string; username: string; email: string; }
export class UserService {
  async createUser(username: string, email: string): Promise<User> {
    return this.saveUser({id: 'user-1', username, email});
  }
  private async saveUser(user: User): Promise<User> { return user; }
}
`);
    fs.writeFileSync(path.join(repository, 'README.md'), `
# Test Project

## Getting Started

Install dependencies with npm install. The project provides user authentication
and user management backed by a database.
`);

    const repoId = `rag-${path.basename(repository)}`;
    embeddingProvider = new DeterministicEmbeddingProvider();
    indexer = new CodebaseIndexer(repository, repoId);
    store = new FileBasedEmbeddingStore(repoId, stateRoot);
    embeddingIndexer = new EmbeddingIndexer(
      indexer,
      new EmbeddingChunker(indexer, repository),
      embeddingProvider,
      store,
      repository
    );
    search = new EmbeddingSearchEngine(embeddingProvider, store);
    contextBuilder = new RAGContextBuilder(search);
  });

  afterEach(async () => {
    await indexer?.clearCache();
    fs.rmSync(repository, {recursive: true, force: true});
    fs.rmSync(stateRoot, {recursive: true, force: true});
  });

  it('indexes, persists, retrieves, builds context, and answers a chat turn', async () => {
    const indexed = await embeddingIndexer.indexCodebase({
      incremental: false,
      showProgress: false,
      validateEmbeddings: true,
      batchSize: 10,
    });
    expect(indexed.success).toBe(true);
    expect(indexed.stats.filesAnalyzed).toBe(2);
    expect(indexed.stats.embeddingsGenerated).toBeGreaterThan(2);
    expect(await store.exists()).toBe(true);

    const persistedEmbeddings = await store.loadEmbeddings();
    expect(persistedEmbeddings.every(embedding => !path.isAbsolute(embedding.source))).toBe(true);
    expect(persistedEmbeddings.every(embedding => !embedding.source.includes('\\'))).toBe(true);
    expect(persistedEmbeddings.every(embedding => !embedding.content.includes(repository))).toBe(true);

    const auth = await search.search('How does user login authentication verify a password?', {
      k: 5,
      minSimilarity: 0.2,
    });
    expect(auth.results[0].embedding.source).toContain('auth.ts');
    expect(auth.results.some(result => result.embedding.content.includes('AuthService'))).toBe(true);

    const context = await contextBuilder.buildContext(
      'Explain authentication and the getting started installation',
      [],
      {maxTokens: 1200, codeWeight: 0.6, docsWeight: 0.3, historyWeight: 0.1}
    );
    expect(context.relevantCode.some(snippet => snippet.source.includes('auth.ts'))).toBe(true);
    expect(context.relevantDocs.some(snippet => snippet.source.endsWith('README.md'))).toBe(true);
    expect(context.tokensUsed).toBeLessThanOrEqual(context.tokenBudget);

    const chatProvider = new DeterministicChatProvider();
    const chatbot = new ChatbotEngine(
      chatProvider,
      contextBuilder,
      search,
      indexer,
      'test-repo',
      repository
    );
    const session = await chatbot.createSession({projectName: 'Test Project'});
    const response = await chatbot.chat(session.id, 'How does authentication work?');
    expect(response.message.content).toContain('AuthService');
    expect(response.message.metadata?.relevantFiles).toContain('src/auth.ts');
    expect(response.stats.relevantSnippets).toBeGreaterThan(0);
  });

  it('preserves unchanged embeddings and refreshes changed source incrementally', async () => {
    await embeddingIndexer.indexCodebase({incremental: false, showProgress: false});
    fs.appendFileSync(
      path.join(repository, 'src', 'auth.ts'),
      '\nexport const resetPassword = (user: string) => `reset:${user}`;\n'
    );
    await indexer.clearCache();

    const updated = await embeddingIndexer.updateIndex([
      path.join(repository, 'src', 'auth.ts'),
    ], {
      showProgress: false,
    });
    expect(updated.success).toBe(true);
    expect(updated.stats.chunksCached).toBeGreaterThan(0);
    expect(updated.stats.embeddingsGenerated).toBeGreaterThan(0);
    const stored = await store.loadEmbeddings();
    expect(stored.some(embedding => embedding.content.includes('resetPassword'))).toBe(true);
  });

  it('rebuilds legacy absolute-path embeddings without retaining stale vectors', async () => {
    await embeddingIndexer.indexCodebase({incremental: false, showProgress: false});
    const indexPath = path.join(stateRoot, 'embeddings', 'index.json');
    const legacyIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    legacyIndex.version = '1.0.0';
    legacyIndex.embeddings[0].id = 'legacy-absolute-path';
    legacyIndex.embeddings[0].source = path.join(repository, 'src', 'auth.ts');
    fs.writeFileSync(indexPath, JSON.stringify(legacyIndex));

    const migratedStore = new FileBasedEmbeddingStore(`rag-${path.basename(repository)}`, stateRoot);
    const migratedIndexer = new EmbeddingIndexer(
      indexer,
      new EmbeddingChunker(indexer, repository),
      embeddingProvider,
      migratedStore,
      repository
    );
    const result = await migratedIndexer.indexCodebase({incremental: true, showProgress: false});
    const migratedIndex = await migratedStore.loadIndex();
    const migratedEmbeddings = await migratedStore.loadEmbeddings();

    expect(result.success).toBe(true);
    expect(result.stats.chunksCached).toBe(0);
    expect(migratedIndex?.version).toBe(EMBEDDING_INDEX_VERSION);
    expect(migratedEmbeddings.some(embedding => embedding.id === 'legacy-absolute-path')).toBe(false);
    expect(migratedEmbeddings.every(embedding => !path.isAbsolute(embedding.source))).toBe(true);
  });

  it('preserves a legacy embedding index when its replacement fails', async () => {
    await embeddingIndexer.indexCodebase({incremental: false, showProgress: false});
    const indexPath = path.join(stateRoot, 'embeddings', 'index.json');
    const legacyIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    legacyIndex.version = '1.0.0';
    legacyIndex.embeddings[0].id = 'legacy-preserved';
    legacyIndex.embeddings[0].source = path.join(repository, 'src', 'auth.ts');
    fs.writeFileSync(indexPath, JSON.stringify(legacyIndex));
    const beforeMigration = fs.readFileSync(indexPath, 'utf-8');

    const legacyStore = new FileBasedEmbeddingStore(`rag-${path.basename(repository)}`, stateRoot);
    const failingIndexer = new EmbeddingIndexer(
      indexer,
      new EmbeddingChunker(indexer, repository),
      new RejectingEmbeddingProvider(),
      legacyStore,
      repository
    );
    const result = await failingIndexer.updateIndex([
      path.join(repository, 'src', 'auth.ts'),
    ], {showProgress: false});

    expect(result.success).toBe(false);
    expect(fs.readFileSync(indexPath, 'utf-8')).toBe(beforeMigration);
  });

  it('combines recent conversation history without exceeding its token budget', async () => {
    await embeddingIndexer.indexCodebase({incremental: false, showProgress: false});
    const history = [
      {role: 'user' as const, content: 'Which service authenticates users?', timestamp: new Date()},
      {role: 'assistant' as const, content: 'AuthService authenticates users.', timestamp: new Date()},
    ];
    const context = await contextBuilder.buildContext('How do I use it?', history, {
      maxTokens: 300,
      codeWeight: 0.5,
      docsWeight: 0.2,
      historyWeight: 0.3,
    });
    expect(context.conversationHistory).toEqual(history);
    expect(context.tokensUsed).toBeLessThanOrEqual(300);
    expect(contextBuilder.formatContextForPrompt(context)).toContain('Recent Conversation');
  });

  it('continues indexing valid files when another source file cannot be parsed', async () => {
    fs.writeFileSync(path.join(repository, 'src', 'invalid.ts'), 'function broken( {');
    const index = await indexer.buildIndex();
    expect(index.files.has('src/auth.ts')).toBe(true);
    expect(index.files.has('src/user.ts')).toBe(true);
  });

  it('handles an empty repository without creating fake embeddings', async () => {
    fs.rmSync(path.join(repository, 'src'), {recursive: true, force: true});
    fs.unlinkSync(path.join(repository, 'README.md'));
    const result = await embeddingIndexer.indexCodebase({showProgress: false});
    expect(result).toMatchObject({success: true});
    expect(result.stats.filesAnalyzed).toBe(0);
    expect(result.stats.totalChunks).toBe(0);
    expect(await store.count()).toBe(0);
  });
});
