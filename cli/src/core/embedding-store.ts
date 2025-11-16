/**
 * embedding-store.ts - File-based Embedding Storage
 *
 * Purpose: Persist and retrieve code embeddings from disk with efficient caching.
 * Storage: ~/.guardscan/cache/<repo-id>/embeddings/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  CodeEmbedding,
  EmbeddingIndex,
  EmbeddingStore,
  SearchFilters,
  formatBytes,
} from './embeddings';

export interface StoreStats {
  totalSize: number;
  embeddingCount: number;
  indexedAt: Date;
  model: string;
  dimensions: number;
}

export class FileBasedEmbeddingStore implements EmbeddingStore {
  private storageDir: string;
  private indexPath: string;
  private cache: Map<string, CodeEmbedding> = new Map();
  private cacheLoaded: boolean = false;

  constructor(
    private repoId: string,
    private basePath?: string
  ) {
    // Default to ~/.guardscan/cache/<repo-id>/embeddings
    const base =
      basePath || path.join(os.homedir(), '.guardscan', 'cache', repoId);
    this.storageDir = path.join(base, 'embeddings');
    this.indexPath = path.join(this.storageDir, 'index.json');
  }

  /**
   * Initialize storage (create directories)
   */
  async initialize(): Promise<void> {
    try {
      await fs.promises.mkdir(this.storageDir, { recursive: true });
    } catch (error: any) {
      throw new Error(`Failed to initialize embedding store: ${error.message}`);
    }
  }

  /**
   * Save embeddings to storage
   */
  async saveEmbeddings(embeddings: CodeEmbedding[]): Promise<void> {
    if (embeddings.length === 0) return;

    await this.initialize();

    // Load existing index if it exists
    let existingIndex = await this.loadIndex();

    if (!existingIndex) {
      // Create new index
      existingIndex = {
        version: '1.0.0',
        repoId: this.repoId,
        generatedAt: new Date(),
        totalEmbeddings: 0,
        embeddings: [],
        metadata: {
          model: embeddings[0]?.embedding ? this.inferModel(embeddings[0].embedding.length) : 'unknown',
          dimensions: embeddings[0]?.embedding.length || 0,
        },
      };
    }

    // Merge new embeddings (replace duplicates)
    const embeddingMap = new Map<string, CodeEmbedding>();

    // Add existing
    existingIndex.embeddings.forEach(emb => embeddingMap.set(emb.id, emb));

    // Add new (overwrites duplicates)
    embeddings.forEach(emb => embeddingMap.set(emb.id, emb));

    // Update index
    existingIndex.embeddings = Array.from(embeddingMap.values());
    existingIndex.totalEmbeddings = existingIndex.embeddings.length;
    existingIndex.generatedAt = new Date();

    // Save index
    await this.saveIndex(existingIndex);

    // Update cache
    this.cache = embeddingMap;
    this.cacheLoaded = true;
  }

  /**
   * Load all embeddings from storage
   */
  async loadEmbeddings(): Promise<CodeEmbedding[]> {
    if (this.cacheLoaded) {
      return Array.from(this.cache.values());
    }

    const index = await this.loadIndex();
    if (!index) return [];

    // Load into cache
    this.cache.clear();
    index.embeddings.forEach(emb => this.cache.set(emb.id, emb));
    this.cacheLoaded = true;

    return index.embeddings;
  }

  /**
   * Load embeddings with filters
   */
  async loadEmbeddingsWithFilters(filters: SearchFilters): Promise<CodeEmbedding[]> {
    const all = await this.loadEmbeddings();
    return this.applyFilters(all, filters);
  }

  /**
   * Update a single embedding
   */
  async updateEmbedding(embedding: CodeEmbedding): Promise<void> {
    await this.saveEmbeddings([embedding]);
  }

  /**
   * Delete embeddings by IDs
   */
  async deleteEmbeddings(ids: string[]): Promise<void> {
    const index = await this.loadIndex();
    if (!index) return;

    const idsToDelete = new Set(ids);
    index.embeddings = index.embeddings.filter(emb => !idsToDelete.has(emb.id));
    index.totalEmbeddings = index.embeddings.length;

    await this.saveIndex(index);

    // Update cache
    ids.forEach(id => this.cache.delete(id));
  }

  /**
   * Clear all embeddings
   */
  async clear(): Promise<void> {
    try {
      if (fs.existsSync(this.indexPath)) {
        await fs.promises.unlink(this.indexPath);
      }
      this.cache.clear();
      this.cacheLoaded = false;
    } catch (error: any) {
      throw new Error(`Failed to clear embeddings: ${error.message}`);
    }
  }

  /**
   * Get metadata about the index
   */
  async getMetadata(): Promise<EmbeddingIndex['metadata'] | null> {
    const index = await this.loadIndex();
    return index?.metadata || null;
  }

  /**
   * Check if embeddings exist
   */
  async exists(): Promise<boolean> {
    return fs.existsSync(this.indexPath);
  }

  /**
   * Get total number of embeddings
   */
  async count(): Promise<number> {
    const index = await this.loadIndex();
    return index?.totalEmbeddings || 0;
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StoreStats | null> {
    const index = await this.loadIndex();
    if (!index) return null;

    let totalSize = 0;
    try {
      const stats = await fs.promises.stat(this.indexPath);
      totalSize = stats.size;
    } catch (error) {
      // Ignore
    }

    return {
      totalSize,
      embeddingCount: index.totalEmbeddings,
      indexedAt: new Date(index.generatedAt),
      model: index.metadata.model,
      dimensions: index.metadata.dimensions,
    };
  }

  /**
   * Invalidate embeddings for changed files
   */
  async invalidateChangedFiles(changedFiles: string[]): Promise<void> {
    const index = await this.loadIndex();
    if (!index) return;

    const changedSet = new Set(changedFiles);
    const original = index.embeddings.length;

    index.embeddings = index.embeddings.filter(
      emb => !changedSet.has(emb.source)
    );

    const removed = original - index.embeddings.length;
    if (removed > 0) {
      index.totalEmbeddings = index.embeddings.length;
      await this.saveIndex(index);

      // Update cache
      this.cache.clear();
      index.embeddings.forEach(emb => this.cache.set(emb.id, emb));

      console.log(`Invalidated ${removed} embeddings for ${changedFiles.length} changed files`);
    }
  }

  /**
   * Optimize storage (compact, remove duplicates)
   */
  async optimize(): Promise<void> {
    const index = await this.loadIndex();
    if (!index) return;

    // Remove duplicates (keep latest by ID)
    const unique = new Map<string, CodeEmbedding>();
    index.embeddings.forEach(emb => unique.set(emb.id, emb));

    const before = index.embeddings.length;
    index.embeddings = Array.from(unique.values());
    index.totalEmbeddings = index.embeddings.length;

    await this.saveIndex(index);

    const removed = before - index.embeddings.length;
    if (removed > 0) {
      console.log(`Optimized storage: removed ${removed} duplicates`);
    }
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  /**
   * Load index from disk
   */
  private async loadIndex(): Promise<EmbeddingIndex | null> {
    try {
      if (!fs.existsSync(this.indexPath)) {
        return null;
      }

      const content = await fs.promises.readFile(this.indexPath, 'utf-8');
      const index: EmbeddingIndex = JSON.parse(content);

      // Convert date strings back to Date objects
      index.generatedAt = new Date(index.generatedAt);
      index.embeddings.forEach(emb => {
        emb.metadata.lastModified = new Date(emb.metadata.lastModified);
      });

      return index;
    } catch (error: any) {
      throw new Error(`Failed to load embedding index: ${error.message}`);
    }
  }

  /**
   * Save index to disk
   */
  private async saveIndex(index: EmbeddingIndex): Promise<void> {
    try {
      await this.initialize();

      const content = JSON.stringify(index, null, 2);
      await fs.promises.writeFile(this.indexPath, content, 'utf-8');
    } catch (error: any) {
      throw new Error(`Failed to save embedding index: ${error.message}`);
    }
  }

  /**
   * Apply filters to embeddings
   */
  private applyFilters(
    embeddings: CodeEmbedding[],
    filters: SearchFilters
  ): CodeEmbedding[] {
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

      if (filters.minComplexity !== undefined && emb.metadata.complexity !== undefined) {
        if (emb.metadata.complexity < filters.minComplexity) return false;
      }

      if (filters.maxComplexity !== undefined && emb.metadata.complexity !== undefined) {
        if (emb.metadata.complexity > filters.maxComplexity) return false;
      }

      if (filters.tags && filters.tags.length > 0) {
        // Must have all specified tags
        const hasAllTags = filters.tags.every(tag =>
          emb.metadata.tags.includes(tag)
        );
        if (!hasAllTags) return false;
      }

      return true;
    });
  }

  /**
   * Infer model name from dimensions
   */
  private inferModel(dimensions: number): string {
    if (dimensions === 1536) return 'text-embedding-3-small (OpenAI)';
    if (dimensions === 768) return 'nomic-embed-text (Ollama)';
    return `unknown-${dimensions}d`;
  }

  /**
   * Get storage directory path
   */
  getStorageDir(): string {
    return this.storageDir;
  }

  /**
   * Get index file path
   */
  getIndexPath(): string {
    return this.indexPath;
  }

  /**
   * Export embeddings to JSON file
   */
  async exportToFile(outputPath: string): Promise<void> {
    const index = await this.loadIndex();
    if (!index) {
      throw new Error('No embeddings to export');
    }

    await fs.promises.writeFile(
      outputPath,
      JSON.stringify(index, null, 2),
      'utf-8'
    );
  }

  /**
   * Import embeddings from JSON file
   */
  async importFromFile(inputPath: string): Promise<void> {
    const content = await fs.promises.readFile(inputPath, 'utf-8');
    const index: EmbeddingIndex = JSON.parse(content);

    // Validate
    if (!index.embeddings || !Array.isArray(index.embeddings)) {
      throw new Error('Invalid embedding index format');
    }

    await this.saveIndex(index);
  }
}
