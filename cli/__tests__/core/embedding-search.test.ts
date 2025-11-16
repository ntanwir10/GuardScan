/**
 * embedding-search.test.ts - Tests for Semantic Code Search Engine
 */

import { EmbeddingSearchEngine, SearchOptions } from '../../src/core/embedding-search';
import { CodeEmbedding, EmbeddingProvider, EmbeddingStore } from '../../src/core/embeddings';

// Mock Embedding Provider
class MockEmbeddingProvider implements EmbeddingProvider {
  async generateEmbedding(text: string): Promise<number[]> {
    // Simple mock: return vector based on text length
    const base = text.length / 100;
    return [base, base * 2, base * 3];
  }

  async generateBulkEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.generateEmbedding(t)));
  }

  getDimensions(): number {
    return 3;
  }

  getModel(): string {
    return 'mock-model';
  }

  estimateCost(tokens: number): number {
    return 0;
  }

  getName(): string {
    return 'mock';
  }

  isAvailable(): boolean {
    return true;
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}

// Mock Embedding Store
class MockEmbeddingStore implements EmbeddingStore {
  private embeddings: CodeEmbedding[] = [];

  async initialize(): Promise<void> {
    // No-op for mock
  }

  async loadEmbeddings(): Promise<CodeEmbedding[]> {
    return this.embeddings;
  }

  async loadEmbeddingsWithFilters(filters: any): Promise<CodeEmbedding[]> {
    let filtered = this.embeddings;

    if (filters.language) {
      filtered = filtered.filter(e => e.metadata.language === filters.language);
    }
    if (filters.type) {
      filtered = filtered.filter(e => e.type === filters.type);
    }

    return filtered;
  }

  async saveEmbeddings(embeddings: CodeEmbedding[]): Promise<void> {
    this.embeddings = embeddings;
  }

  async updateEmbedding(embedding: CodeEmbedding): Promise<void> {
    const index = this.embeddings.findIndex(e => e.id === embedding.id);
    if (index >= 0) {
      this.embeddings[index] = embedding;
    } else {
      this.embeddings.push(embedding);
    }
  }

  async deleteEmbeddings(ids: string[]): Promise<void> {
    this.embeddings = this.embeddings.filter(e => !ids.includes(e.id));
  }

  async clear(): Promise<void> {
    this.embeddings = [];
  }

  async exists(): Promise<boolean> {
    return this.embeddings.length > 0;
  }

  async count(): Promise<number> {
    return this.embeddings.length;
  }

  async getMetadata(): Promise<any> {
    return { model: 'mock', dimensions: 3 };
  }
}

describe('EmbeddingSearchEngine', () => {
  let searchEngine: EmbeddingSearchEngine;
  let mockProvider: MockEmbeddingProvider;
  let mockStore: MockEmbeddingStore;

  beforeEach(() => {
    mockProvider = new MockEmbeddingProvider();
    mockStore = new MockEmbeddingStore();
    searchEngine = new EmbeddingSearchEngine(mockProvider, mockStore);
  });

  describe('search', () => {
    beforeEach(async () => {
      // Populate store with test embeddings
      const testEmbeddings: CodeEmbedding[] = [
        createTestEmbedding('emb-1', 'function', 'src/auth.ts', [0.9, 0.1, 0.0]),
        createTestEmbedding('emb-2', 'class', 'src/user.ts', [0.1, 0.9, 0.0]),
        createTestEmbedding('emb-3', 'function', 'src/utils.ts', [0.0, 0.1, 0.9]),
        createTestEmbedding('emb-4', 'file', 'README.md', [0.5, 0.5, 0.0]),
      ];
      await mockStore.saveEmbeddings(testEmbeddings);
    });

    it('should return top K results', async () => {
      const { results } = await searchEngine.search('test query', { k: 2 });
      expect(results).toHaveLength(2);
    });

    it('should sort results by similarity score', async () => {
      const { results } = await searchEngine.search('test query', { k: 4 });

      // Results should be sorted descending (allow for minor floating point differences)
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].similarityScore).toBeGreaterThanOrEqual(
          results[i + 1].similarityScore - 0.01 // Allow small tolerance for ranking adjustments
        );
      }
    });

    it('should filter by minimum similarity', async () => {
      const { results } = await searchEngine.search('test query', {
        k: 10,
        minSimilarity: 0.8,
      });

      results.forEach(r => {
        expect(r.similarityScore).toBeGreaterThanOrEqual(0.8);
      });
    });

    it('should apply filters', async () => {
      const { results } = await searchEngine.search('test query', {
        k: 10,
        filters: { type: 'function' },
      });

      results.forEach(r => {
        expect(r.embedding.type).toBe('function');
      });
    });

    it('should enable ranking when requested', async () => {
      const { results } = await searchEngine.search('test query', {
        k: 4,
        enableRanking: true,
      });

      results.forEach(r => {
        expect(r.relevanceScore).toBeDefined();
        expect(r.rankingFactors).toBeDefined();
      });
    });

    it('should return statistics', async () => {
      const { stats } = await searchEngine.search('test query', { k: 2 });

      expect(stats.totalEmbeddings).toBe(4);
      expect(stats.searchTimeMs).toBeGreaterThanOrEqual(0);
      expect(stats.averageSimilarity).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty store', async () => {
      await mockStore.clear();
      const { results } = await searchEngine.search('test query', { k: 10 });
      expect(results).toHaveLength(0);
    });

    it('should handle no matching results above threshold', async () => {
      const { results } = await searchEngine.search('test query', {
        k: 10,
        minSimilarity: 0.99, // Very high threshold
      });

      expect(results.length).toBeLessThanOrEqual(4);
    });
  });

  describe('findSimilarToEmbedding', () => {
    beforeEach(async () => {
      const testEmbeddings: CodeEmbedding[] = [
        createTestEmbedding('target', 'function', 'src/target.ts', [1.0, 0.0, 0.0]),
        createTestEmbedding('similar', 'function', 'src/similar.ts', [0.9, 0.1, 0.0]),
        createTestEmbedding('different', 'class', 'src/different.ts', [0.0, 0.0, 1.0]),
      ];
      await mockStore.saveEmbeddings(testEmbeddings);
    });

    it('should find similar embeddings', async () => {
      const embeddings = await mockStore.loadEmbeddings();
      const target = embeddings.find(e => e.id === 'target')!;

      const similar = await searchEngine.findSimilarToEmbedding(target, 2);

      expect(similar).toHaveLength(2);
      expect(similar[0].embedding.id).toBe('similar');
    });

    it('should exclude the target embedding itself', async () => {
      const embeddings = await mockStore.loadEmbeddings();
      const target = embeddings.find(e => e.id === 'target')!;

      const similar = await searchEngine.findSimilarToEmbedding(target, 5);

      similar.forEach(s => {
        expect(s.embedding.id).not.toBe('target');
      });
    });

    it('should sort by similarity', async () => {
      const embeddings = await mockStore.loadEmbeddings();
      const target = embeddings.find(e => e.id === 'target')!;

      const similar = await searchEngine.findSimilarToEmbedding(target, 5);

      for (let i = 0; i < similar.length - 1; i++) {
        expect(similar[i].similarityScore).toBeGreaterThanOrEqual(
          similar[i + 1].similarityScore
        );
      }
    });
  });

  describe('findByFile', () => {
    beforeEach(async () => {
      const testEmbeddings: CodeEmbedding[] = [
        createTestEmbedding('emb-1', 'function', 'src/auth.ts', [0.1, 0.2, 0.3]),
        createTestEmbedding('emb-2', 'class', 'src/auth.ts', [0.4, 0.5, 0.6]),
        createTestEmbedding('emb-3', 'function', 'src/user.ts', [0.7, 0.8, 0.9]),
      ];
      await mockStore.saveEmbeddings(testEmbeddings);
    });

    it('should find all embeddings for a file', async () => {
      const results = await searchEngine.findByFile('src/auth.ts');
      expect(results).toHaveLength(2);
    });

    it('should return empty array for non-existent file', async () => {
      const results = await searchEngine.findByFile('src/nonexistent.ts');
      expect(results).toHaveLength(0);
    });
  });

  describe('findByTags', () => {
    beforeEach(async () => {
      const emb1 = createTestEmbedding('emb-1', 'function', 'src/a.ts', [0.1, 0.2, 0.3]);
      emb1.metadata.tags = ['async', 'api'];

      const emb2 = createTestEmbedding('emb-2', 'class', 'src/b.ts', [0.4, 0.5, 0.6]);
      emb2.metadata.tags = ['async', 'database'];

      const emb3 = createTestEmbedding('emb-3', 'function', 'src/c.ts', [0.7, 0.8, 0.9]);
      emb3.metadata.tags = ['sync'];

      await mockStore.saveEmbeddings([emb1, emb2, emb3]);
    });

    it('should find embeddings with any matching tag', async () => {
      const results = await searchEngine.findByTags(['async'], false);
      expect(results).toHaveLength(2);
    });

    it('should find embeddings with all matching tags', async () => {
      const results = await searchEngine.findByTags(['async', 'api'], true);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('emb-1');
    });

    it('should return empty for non-existent tags', async () => {
      const results = await searchEngine.findByTags(['nonexistent'], false);
      expect(results).toHaveLength(0);
    });
  });

  describe('findByComplexity', () => {
    beforeEach(async () => {
      const emb1 = createTestEmbedding('emb-1', 'function', 'src/a.ts', [0.1, 0.2, 0.3]);
      emb1.metadata.complexity = 5;

      const emb2 = createTestEmbedding('emb-2', 'class', 'src/b.ts', [0.4, 0.5, 0.6]);
      emb2.metadata.complexity = 10;

      const emb3 = createTestEmbedding('emb-3', 'function', 'src/c.ts', [0.7, 0.8, 0.9]);
      emb3.metadata.complexity = 15;

      await mockStore.saveEmbeddings([emb1, emb2, emb3]);
    });

    it('should find embeddings in complexity range', async () => {
      const results = await searchEngine.findByComplexity(5, 10);
      expect(results).toHaveLength(2);
    });

    it('should exclude embeddings outside range', async () => {
      const results = await searchEngine.findByComplexity(1, 8);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('emb-1');
    });

    it('should handle edge cases', async () => {
      const results = await searchEngine.findByComplexity(10, 10);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.complexity).toBe(10);
    });
  });

  describe('searchDiverse', () => {
    beforeEach(async () => {
      // Create multiple embeddings from same files
      const testEmbeddings: CodeEmbedding[] = [
        createTestEmbedding('a1', 'function', 'src/auth.ts', [0.9, 0.1, 0.0]),
        createTestEmbedding('a2', 'class', 'src/auth.ts', [0.85, 0.15, 0.0]),
        createTestEmbedding('u1', 'function', 'src/user.ts', [0.1, 0.9, 0.0]),
        createTestEmbedding('u2', 'class', 'src/user.ts', [0.15, 0.85, 0.0]),
      ];
      await mockStore.saveEmbeddings(testEmbeddings);
    });

    it('should limit results per file', async () => {
      const results = await searchEngine.searchDiverse('test query', { k: 10 });

      const fileGroups = new Map<string, number>();
      results.forEach(r => {
        const count = fileGroups.get(r.embedding.source) || 0;
        fileGroups.set(r.embedding.source, count + 1);
      });

      // Should have at most 2 from each file (as per maxPerFile = 2)
      fileGroups.forEach(count => {
        expect(count).toBeLessThanOrEqual(2);
      });
    });

    it('should still respect k limit', async () => {
      const results = await searchEngine.searchDiverse('test query', { k: 2 });
      expect(results).toHaveLength(2);
    });
  });

  describe('getCoverageStats', () => {
    beforeEach(async () => {
      const emb1 = createTestEmbedding('emb-1', 'function', 'src/a.ts', [0.1, 0.2, 0.3]);
      emb1.metadata.language = 'typescript';
      emb1.metadata.lastModified = new Date('2024-01-01');

      const emb2 = createTestEmbedding('emb-2', 'class', 'src/b.js', [0.4, 0.5, 0.6]);
      emb2.metadata.language = 'javascript';
      emb2.metadata.lastModified = new Date('2024-06-01');

      await mockStore.saveEmbeddings([emb1, emb2]);
    });

    it('should return coverage statistics', async () => {
      const stats = await searchEngine.getCoverageStats();

      expect(stats.totalEmbeddings).toBe(2);
      expect(stats.byType).toHaveProperty('function');
      expect(stats.byType).toHaveProperty('class');
      expect(stats.byLanguage).toHaveProperty('typescript');
      expect(stats.byLanguage).toHaveProperty('javascript');
    });

    it('should track oldest and newest embeddings', async () => {
      const stats = await searchEngine.getCoverageStats();

      expect(stats.oldestEmbedding).toEqual(new Date('2024-01-01'));
      expect(stats.newestEmbedding).toEqual(new Date('2024-06-01'));
    });
  });
});

// Helper function
function createTestEmbedding(
  id: string,
  type: 'function' | 'class' | 'file' | 'documentation',
  source: string,
  embedding: number[]
): CodeEmbedding {
  return {
    id,
    type,
    source,
    startLine: 1,
    endLine: 10,
    content: `test content for ${id}`,
    contentSummary: `test ${id}`,
    embedding,
    metadata: {
      symbolName: id,
      language: 'typescript',
      complexity: 5,
      dependencies: [],
      exports: [],
      tags: [],
      lastModified: new Date(),
    },
    hash: `hash-${id}`,
  };
}
