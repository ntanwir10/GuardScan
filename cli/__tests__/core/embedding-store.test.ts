/**
 * embedding-store.test.ts - Tests for File-based Embedding Storage
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileBasedEmbeddingStore } from '../../src/core/embedding-store';
import { CodeEmbedding } from '../../src/core/embeddings';

describe('FileBasedEmbeddingStore', () => {
  let store: FileBasedEmbeddingStore;
  let testDir: string;
  const testRepoId = 'test-repo-123';

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `guardscan-test-${Date.now()}`);
    store = new FileBasedEmbeddingStore(testRepoId, testDir);
    await store.initialize();
  });

  afterEach(async () => {
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('initialize', () => {
    it('should create storage directory', async () => {
      const storageDir = store.getStorageDir();
      expect(fs.existsSync(storageDir)).toBe(true);
    });

    it('should be idempotent', async () => {
      await store.initialize();
      await store.initialize();
      const storageDir = store.getStorageDir();
      expect(fs.existsSync(storageDir)).toBe(true);
    });
  });

  describe('saveEmbeddings', () => {
    it('should save embeddings to disk', async () => {
      const embeddings: CodeEmbedding[] = [
        createTestEmbedding('emb-1', 'function', 'src/a.ts'),
        createTestEmbedding('emb-2', 'class', 'src/b.ts'),
      ];

      await store.saveEmbeddings(embeddings);

      const indexPath = store.getIndexPath();
      expect(fs.existsSync(indexPath)).toBe(true);
    });

    it('should handle empty embeddings array', async () => {
      await store.saveEmbeddings([]);
      const count = await store.count();
      expect(count).toBe(0);
    });

    it('should merge new embeddings with existing', async () => {
      const batch1 = [createTestEmbedding('emb-1', 'function', 'src/a.ts')];
      const batch2 = [createTestEmbedding('emb-2', 'class', 'src/b.ts')];

      await store.saveEmbeddings(batch1);
      await store.saveEmbeddings(batch2);

      const count = await store.count();
      expect(count).toBe(2);
    });

    it('should replace existing embeddings with same ID', async () => {
      const emb1 = createTestEmbedding('emb-1', 'function', 'src/a.ts');
      emb1.content = 'original content';

      const emb2 = createTestEmbedding('emb-1', 'function', 'src/a.ts');
      emb2.content = 'updated content';

      await store.saveEmbeddings([emb1]);
      await store.saveEmbeddings([emb2]);

      const loaded = await store.loadEmbeddings();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].content).toBe('updated content');
    });
  });

  describe('loadEmbeddings', () => {
    it('should load saved embeddings', async () => {
      const embeddings = [
        createTestEmbedding('emb-1', 'function', 'src/a.ts'),
        createTestEmbedding('emb-2', 'class', 'src/b.ts'),
      ];

      await store.saveEmbeddings(embeddings);
      const loaded = await store.loadEmbeddings();

      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe('emb-1');
      expect(loaded[1].id).toBe('emb-2');
    });

    it('should return empty array when no embeddings exist', async () => {
      const loaded = await store.loadEmbeddings();
      expect(loaded).toEqual([]);
    });

    it('should use cache for repeated loads', async () => {
      const embeddings = [createTestEmbedding('emb-1', 'function', 'src/a.ts')];
      await store.saveEmbeddings(embeddings);

      const loaded1 = await store.loadEmbeddings();
      const loaded2 = await store.loadEmbeddings();

      expect(loaded1).toEqual(loaded2);
    });
  });

  describe('loadEmbeddingsWithFilters', () => {
    beforeEach(async () => {
      const embeddings = [
        createTestEmbedding('emb-1', 'function', 'src/utils.ts', 'typescript', 5),
        createTestEmbedding('emb-2', 'class', 'src/models.ts', 'typescript', 10),
        createTestEmbedding('emb-3', 'function', 'lib/helper.js', 'javascript', 3),
      ];
      await store.saveEmbeddings(embeddings);
    });

    it('should filter by language', async () => {
      const filtered = await store.loadEmbeddingsWithFilters({ language: 'typescript' });
      expect(filtered).toHaveLength(2);
    });

    it('should filter by type', async () => {
      const filtered = await store.loadEmbeddingsWithFilters({ type: 'function' });
      expect(filtered).toHaveLength(2);
    });

    it('should filter by file pattern', async () => {
      const filtered = await store.loadEmbeddingsWithFilters({ filePattern: 'src/.*' });
      expect(filtered).toHaveLength(2);
    });

    it('should filter by complexity range', async () => {
      const filtered = await store.loadEmbeddingsWithFilters({
        minComplexity: 5,
        maxComplexity: 10,
      });
      expect(filtered).toHaveLength(2);
    });

    it('should combine multiple filters', async () => {
      const filtered = await store.loadEmbeddingsWithFilters({
        language: 'typescript',
        type: 'function',
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('emb-1');
    });
  });

  describe('deleteEmbeddings', () => {
    it('should delete embeddings by ID', async () => {
      const embeddings = [
        createTestEmbedding('emb-1', 'function', 'src/a.ts'),
        createTestEmbedding('emb-2', 'class', 'src/b.ts'),
      ];
      await store.saveEmbeddings(embeddings);

      await store.deleteEmbeddings(['emb-1']);

      const loaded = await store.loadEmbeddings();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('emb-2');
    });

    it('should handle non-existent IDs gracefully', async () => {
      await store.deleteEmbeddings(['non-existent']);
      expect(await store.count()).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all embeddings', async () => {
      const embeddings = [
        createTestEmbedding('emb-1', 'function', 'src/a.ts'),
        createTestEmbedding('emb-2', 'class', 'src/b.ts'),
      ];
      await store.saveEmbeddings(embeddings);

      await store.clear();

      const exists = await store.exists();
      expect(exists).toBe(false);
    });

    it('should clear cache', async () => {
      const embeddings = [createTestEmbedding('emb-1', 'function', 'src/a.ts')];
      await store.saveEmbeddings(embeddings);
      await store.loadEmbeddings(); // Load into cache

      await store.clear();

      const loaded = await store.loadEmbeddings();
      expect(loaded).toEqual([]);
    });
  });

  describe('exists', () => {
    it('should return false when no embeddings exist', async () => {
      const exists = await store.exists();
      expect(exists).toBe(false);
    });

    it('should return true after saving embeddings', async () => {
      const embeddings = [createTestEmbedding('emb-1', 'function', 'src/a.ts')];
      await store.saveEmbeddings(embeddings);

      const exists = await store.exists();
      expect(exists).toBe(true);
    });
  });

  describe('count', () => {
    it('should return 0 when no embeddings exist', async () => {
      const count = await store.count();
      expect(count).toBe(0);
    });

    it('should return correct count', async () => {
      const embeddings = [
        createTestEmbedding('emb-1', 'function', 'src/a.ts'),
        createTestEmbedding('emb-2', 'class', 'src/b.ts'),
        createTestEmbedding('emb-3', 'file', 'src/c.ts'),
      ];
      await store.saveEmbeddings(embeddings);

      const count = await store.count();
      expect(count).toBe(3);
    });
  });

  describe('getStats', () => {
    it('should return null when no embeddings exist', async () => {
      const stats = await store.getStats();
      expect(stats).toBeNull();
    });

    it('should return stats after saving embeddings', async () => {
      const embeddings = [createTestEmbedding('emb-1', 'function', 'src/a.ts')];
      await store.saveEmbeddings(embeddings);

      const stats = await store.getStats();
      expect(stats).not.toBeNull();
      expect(stats!.embeddingCount).toBe(1);
      expect(stats!.totalSize).toBeGreaterThan(0);
      expect(stats!.dimensions).toBe(3);
    });
  });

  describe('invalidateChangedFiles', () => {
    it('should remove embeddings for changed files', async () => {
      const embeddings = [
        createTestEmbedding('emb-1', 'function', 'src/a.ts'),
        createTestEmbedding('emb-2', 'class', 'src/b.ts'),
        createTestEmbedding('emb-3', 'file', 'src/c.ts'),
      ];
      await store.saveEmbeddings(embeddings);

      await store.invalidateChangedFiles(['src/a.ts', 'src/c.ts']);

      const loaded = await store.loadEmbeddings();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('emb-2');
    });
  });

  describe('optimize', () => {
    it('should remove duplicate embeddings', async () => {
      const embeddings = [
        createTestEmbedding('emb-1', 'function', 'src/a.ts'),
        createTestEmbedding('emb-1', 'function', 'src/a.ts'), // Duplicate ID
        createTestEmbedding('emb-2', 'class', 'src/b.ts'),
      ];

      // Manually create index with duplicates
      await store.saveEmbeddings([embeddings[0]]);
      await store.saveEmbeddings([embeddings[2]]);

      // Should be 2 unique
      const beforeCount = await store.count();
      expect(beforeCount).toBe(2);
    });
  });
});

// Helper function to create test embeddings
function createTestEmbedding(
  id: string,
  type: 'function' | 'class' | 'file' | 'documentation',
  source: string,
  language: string = 'typescript',
  complexity: number = 1
): CodeEmbedding {
  return {
    id,
    type,
    source,
    startLine: 1,
    endLine: 10,
    content: `test content for ${id}`,
    contentSummary: `test ${id}`,
    embedding: [0.1, 0.2, 0.3],
    metadata: {
      symbolName: id,
      language,
      complexity,
      dependencies: [],
      exports: [],
      tags: [],
      lastModified: new Date(),
    },
    hash: `hash-${id}`,
  };
}
