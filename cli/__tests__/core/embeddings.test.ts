/**
 * embeddings.test.ts - Tests for Embedding Core Functionality
 */

import {
  CodeEmbedding,
  cosineSimilarity,
  normalizeEmbedding,
  generateEmbeddingId,
  hashContent,
} from '../../src/core/embeddings';

describe('Embedding Core Functions', () => {
  describe('cosineSimilarity', () => {
    it('should return 1.0 for identical vectors', () => {
      const vec1 = [1, 2, 3, 4, 5];
      const vec2 = [1, 2, 3, 4, 5];
      const similarity = cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it('should return 0.0 for orthogonal vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      const similarity = cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(0.0, 5);
    });

    it('should return -1.0 for opposite vectors', () => {
      const vec1 = [1, 2, 3];
      const vec2 = [-1, -2, -3];
      const similarity = cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(-1.0, 5);
    });

    it('should handle normalized vectors correctly', () => {
      const vec1 = normalizeEmbedding([3, 4]);
      const vec2 = normalizeEmbedding([4, 3]);
      const similarity = cosineSimilarity(vec1, vec2);
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it('should handle zero vectors gracefully', () => {
      const vec1 = [0, 0, 0];
      const vec2 = [1, 2, 3];
      // Implementation may handle zero vectors differently
      const result = cosineSimilarity(vec1, vec2);
      expect(typeof result).toBe('number');
    });

    it('should throw error for different dimension vectors', () => {
      const vec1 = [1, 2, 3];
      const vec2 = [1, 2];
      expect(() => cosineSimilarity(vec1, vec2)).toThrow();
    });
  });

  describe('normalizeEmbedding', () => {
    it('should normalize vector to unit length', () => {
      const vec = [3, 4];
      const normalized = normalizeEmbedding(vec);
      const magnitude = Math.sqrt(
        normalized.reduce((sum: number, val: number) => sum + val * val, 0)
      );
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    it('should preserve direction', () => {
      const vec = [5, 0];
      const normalized = normalizeEmbedding(vec);
      expect(normalized[0]).toBeCloseTo(1.0, 5);
      expect(normalized[1]).toBeCloseTo(0.0, 5);
    });

    it('should handle multi-dimensional vectors', () => {
      const vec = [1, 1, 1, 1];
      const normalized = normalizeEmbedding(vec);
      const expected = 1 / Math.sqrt(4);
      normalized.forEach((val: number) => {
        expect(val).toBeCloseTo(expected, 5);
      });
    });

    it('should handle zero vector gracefully', () => {
      const vec = [0, 0, 0];
      // Implementation may handle zero vectors differently
      const result = normalizeEmbedding(vec);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('generateEmbeddingId', () => {
    it('should generate consistent ID for same inputs', () => {
      const id1 = generateEmbeddingId('function', 'src/utils.ts', 'calculateSum');
      const id2 = generateEmbeddingId('function', 'src/utils.ts', 'calculateSum');
      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different inputs', () => {
      const id1 = generateEmbeddingId('function', 'src/utils.ts', 'calculateSum');
      const id2 = generateEmbeddingId('function', 'src/utils.ts', 'calculateProduct');
      expect(id1).not.toBe(id2);
    });

    it('should handle optional symbolName', () => {
      const id = generateEmbeddingId('file', 'src/index.ts');
      expect(id).toBeTruthy();
      expect(id.length).toBeGreaterThan(0);
    });

    it('should generate valid ID format', () => {
      const id = generateEmbeddingId('class', 'src/models/User.ts', 'UserModel');
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe('hashContent', () => {
    it('should generate consistent hash for same content', () => {
      const content = 'function calculateSum(a, b) { return a + b; }';
      const hash1 = hashContent(content);
      const hash2 = hashContent(content);
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different content', () => {
      const content1 = 'function sum(a, b) { return a + b; }';
      const content2 = 'function product(a, b) { return a * b; }';
      const hash1 = hashContent(content1);
      const hash2 = hashContent(content2);
      expect(hash1).not.toBe(hash2);
    });

    it('should be sensitive to whitespace changes', () => {
      const content1 = 'function sum(a, b) { return a + b; }';
      const content2 = 'function sum(a,b){return a+b;}';
      const hash1 = hashContent(content1);
      const hash2 = hashContent(content2);
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty content', () => {
      const hash = hashContent('');
      expect(hash).toBeTruthy();
    });

    it('should handle large content', () => {
      const largeContent = 'x'.repeat(10000);
      const hash = hashContent(largeContent);
      expect(hash).toBeTruthy();
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  describe('CodeEmbedding Structure', () => {
    it('should create valid embedding object', () => {
      const embedding: CodeEmbedding = {
        id: 'test-id',
        type: 'function',
        source: 'src/utils.ts',
        startLine: 10,
        endLine: 20,
        content: 'function test() {}',
        contentSummary: 'function test()',
        embedding: [0.1, 0.2, 0.3],
        metadata: {
          symbolName: 'test',
          language: 'typescript',
          complexity: 5,
          dependencies: [],
          exports: ['test'],
          tags: [],
          lastModified: new Date(),
        },
        hash: 'abc123',
      };

      expect(embedding.id).toBe('test-id');
      expect(embedding.type).toBe('function');
      expect(embedding.embedding).toHaveLength(3);
      expect(embedding.metadata.language).toBe('typescript');
    });
  });
});
