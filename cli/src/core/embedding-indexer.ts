/**
 * embedding-indexer.ts - Embedding Indexing Workflow
 *
 * Purpose: Orchestrate embedding generation for entire codebase with progress tracking.
 * Features: Background indexing, progress bars, incremental updates, validation
 */

import chalk from 'chalk';
import * as cliProgress from 'cli-progress';
import { CodebaseIndexer, CodebaseIndex } from './codebase-indexer';
import { EmbeddingChunker, ChunkingStats } from './embedding-chunker';
import { EmbeddingProvider, CodeEmbedding, generateEmbeddingId, hashContent } from './embeddings';
import { FileBasedEmbeddingStore } from './embedding-store';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface IndexingOptions {
  incremental?: boolean;       // Only index changed files (default: true)
  batchSize?: number;          // Embeddings per batch (default: 50)
  showProgress?: boolean;      // Show progress bars (default: true)
  validateEmbeddings?: boolean; // Validate generated embeddings (default: true)
  maxConcurrency?: number;     // Max parallel embedding requests (default: 5)
}

export interface IndexingResult {
  success: boolean;
  stats: IndexingStats;
  errors: IndexingError[];
  duration: number;
}

export interface IndexingStats {
  totalChunks: number;
  chunksProcessed: number;
  chunksCached: number;
  chunksSkipped: number;
  totalTokens: number;
  estimatedCost: number;
  embeddingsGenerated: number;
  filesAnalyzed: number;
}

export interface IndexingError {
  type: 'chunking' | 'embedding' | 'storage' | 'validation';
  message: string;
  file?: string;
  details?: any;
}

export interface IndexingProgress {
  phase: 'analyzing' | 'chunking' | 'embedding' | 'storing' | 'complete';
  current: number;
  total: number;
  percentage: number;
  message: string;
}

// ============================================================================
// Embedding Indexer
// ============================================================================

export class EmbeddingIndexer {
  private progressBar?: cliProgress.SingleBar;

  constructor(
    private codebaseIndexer: CodebaseIndexer,
    private chunker: EmbeddingChunker,
    private embeddingProvider: EmbeddingProvider,
    private store: FileBasedEmbeddingStore,
    private repoRoot: string
  ) {}

  /**
   * Index entire codebase and generate embeddings
   */
  async indexCodebase(options: IndexingOptions = {}): Promise<IndexingResult> {
    const startTime = Date.now();
    const opts = this.normalizeOptions(options);
    const errors: IndexingError[] = [];
    const stats: IndexingStats = {
      totalChunks: 0,
      chunksProcessed: 0,
      chunksCached: 0,
      chunksSkipped: 0,
      totalTokens: 0,
      estimatedCost: 0,
      embeddingsGenerated: 0,
      filesAnalyzed: 0,
    };

    try {
      // Phase 1: Analyze codebase
      if (opts.showProgress) {
        console.log(chalk.blue('\n📊 Analyzing codebase...'));
      }

      const codebaseIndex = await this.codebaseIndexer.buildIndex();
      stats.filesAnalyzed = codebaseIndex.totalFiles;

      // Phase 2: Chunk code
      if (opts.showProgress) {
        console.log(chalk.blue('✂️  Chunking code into semantic units...'));
      }

      const { chunks, stats: chunkStats } = await this.chunker.chunkCodebase(
        codebaseIndex,
        {
          maxFunctionSize: 2000,
          maxClassSize: 5000,
          maxFileSize: 1000,
          includeDocumentation: true,
        }
      );

      stats.totalChunks = chunks.length;
      stats.totalTokens = chunkStats.estimatedTokens;

      if (chunks.length === 0) {
        console.log(chalk.yellow('\n⚠️  No code chunks found to index'));
        return {
          success: true,
          stats,
          errors,
          duration: Date.now() - startTime,
        };
      }

      // Phase 3: Check for existing embeddings (incremental mode)
      let chunksToProcess = chunks;

      if (opts.incremental) {
        if (opts.showProgress) {
          console.log(chalk.blue('🔍 Checking for existing embeddings...'));
        }

        const existingEmbeddings = await this.store.loadEmbeddings();
        const existingHashes = new Map(
          existingEmbeddings.map(emb => [emb.id, emb.hash])
        );

        chunksToProcess = chunks.filter(chunk => {
          const id = this.generateChunkId(chunk);
          const currentHash = hashContent(chunk.content);
          const existingHash = existingHashes.get(id);

          if (existingHash === currentHash) {
            stats.chunksCached++;
            return false; // Skip unchanged chunks
          }

          return true;
        });

        if (opts.showProgress) {
          console.log(
            chalk.gray(
              `  Cached: ${stats.chunksCached}, To process: ${chunksToProcess.length}`
            )
          );
        }
      }

      // Phase 4: Generate embeddings
      if (chunksToProcess.length > 0) {
        if (opts.showProgress) {
          console.log(chalk.blue('\n🧠 Generating embeddings with AI...\n'));
          this.initProgressBar(chunksToProcess.length);
        }

        const embeddings = await this.generateEmbeddings(
          chunksToProcess,
          opts,
          stats,
          errors
        );

        stats.embeddingsGenerated = embeddings.length;
        stats.chunksProcessed = embeddings.length;

        // Phase 5: Validate embeddings
        if (opts.validateEmbeddings) {
          const invalidEmbeddings = this.validateEmbeddings(embeddings);
          if (invalidEmbeddings.length > 0) {
            errors.push({
              type: 'validation',
              message: `${invalidEmbeddings.length} embeddings failed validation`,
              details: invalidEmbeddings,
            });
          }
        }

        // Phase 6: Store embeddings
        if (opts.showProgress) {
          console.log(chalk.blue('\n💾 Storing embeddings...'));
        }

        await this.store.saveEmbeddings(embeddings);

        if (this.progressBar) {
          this.progressBar.stop();
        }
      }

      // Calculate final stats
      stats.estimatedCost = this.embeddingProvider.estimateCost(stats.totalTokens);

      // Success summary
      if (opts.showProgress) {
        this.printSummary(stats, Date.now() - startTime);
      }

      return {
        success: errors.length === 0,
        stats,
        errors,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      errors.push({
        type: 'embedding',
        message: `Fatal error: ${error.message}`,
        details: error,
      });

      if (this.progressBar) {
        this.progressBar.stop();
      }

      return {
        success: false,
        stats,
        errors,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Update index for changed files only
   */
  async updateIndex(
    changedFiles: string[],
    options: IndexingOptions = {}
  ): Promise<IndexingResult> {
    // Invalidate old embeddings for changed files
    await this.store.invalidateChangedFiles(changedFiles);

    // Re-index (will only process changed files due to incremental mode)
    return this.indexCodebase({ ...options, incremental: true });
  }

  /**
   * Get indexing statistics
   */
  async getIndexStats(): Promise<{
    indexed: boolean;
    totalEmbeddings: number;
    storageSize: number;
    lastIndexed: Date | null;
    model: string;
  }> {
    const exists = await this.store.exists();
    if (!exists) {
      return {
        indexed: false,
        totalEmbeddings: 0,
        storageSize: 0,
        lastIndexed: null,
        model: this.embeddingProvider.getModel(),
      };
    }

    const count = await this.store.count();
    const stats = await this.store.getStats();

    return {
      indexed: true,
      totalEmbeddings: count,
      storageSize: stats?.totalSize || 0,
      lastIndexed: stats?.indexedAt || null,
      model: stats?.model || this.embeddingProvider.getModel(),
    };
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  /**
   * Generate embeddings for chunks (batched)
   */
  private async generateEmbeddings(
    chunks: any[],
    options: Required<IndexingOptions>,
    stats: IndexingStats,
    errors: IndexingError[]
  ): Promise<CodeEmbedding[]> {
    const embeddings: CodeEmbedding[] = [];
    const batches = this.batchChunks(chunks, options.batchSize);

    for (const batch of batches) {
      try {
        // Extract text content from chunks
        const texts = batch.map(chunk => chunk.content);

        // Generate embeddings in bulk
        const embeddingVectors = await this.embeddingProvider.generateBulkEmbeddings(texts);

        // Create CodeEmbedding objects
        for (let i = 0; i < batch.length; i++) {
          const chunk = batch[i];
          const embedding: CodeEmbedding = {
            id: this.generateChunkId(chunk),
            type: chunk.type,
            source: chunk.source,
            startLine: chunk.startLine || 0,
            endLine: chunk.endLine || 0,
            content: chunk.content,
            contentSummary: this.generateSummary(chunk.content),
            embedding: embeddingVectors[i],
            metadata: chunk.metadata,
            hash: hashContent(chunk.content),
          };

          embeddings.push(embedding);
        }

        // Update progress
        if (this.progressBar) {
          this.progressBar.increment(batch.length);
        }
      } catch (error: any) {
        errors.push({
          type: 'embedding',
          message: `Batch embedding failed: ${error.message}`,
          details: { batchSize: batch.length, error },
        });

        // Skip this batch but continue
        stats.chunksSkipped += batch.length;
      }
    }

    return embeddings;
  }

  /**
   * Batch chunks into groups
   */
  private batchChunks<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Validate embeddings
   */
  private validateEmbeddings(embeddings: CodeEmbedding[]): CodeEmbedding[] {
    const invalid: CodeEmbedding[] = [];
    const expectedDimensions = this.embeddingProvider.getDimensions();

    for (const emb of embeddings) {
      // Check dimensions
      if (emb.embedding.length !== expectedDimensions) {
        invalid.push(emb);
        continue;
      }

      // Check for NaN or Infinity
      if (emb.embedding.some(v => !isFinite(v))) {
        invalid.push(emb);
        continue;
      }

      // Check magnitude (should be normalized or reasonable)
      const magnitude = Math.sqrt(
        emb.embedding.reduce((sum, v) => sum + v * v, 0)
      );
      if (magnitude === 0 || magnitude > 100) {
        invalid.push(emb);
      }
    }

    return invalid;
  }

  /**
   * Generate chunk ID
   */
  private generateChunkId(chunk: any): string {
    return generateEmbeddingId(chunk.type, chunk.source, chunk.metadata?.symbolName);
  }

  /**
   * Generate short summary for content
   */
  private generateSummary(content: string): string {
    // Take first 100 characters + first line
    const firstLine = content.split('\n')[0];
    return firstLine.length > 100
      ? firstLine.slice(0, 100) + '...'
      : firstLine;
  }

  /**
   * Initialize progress bar
   */
  private initProgressBar(total: number): void {
    this.progressBar = new cliProgress.SingleBar(
      {
        format:
          chalk.cyan('{bar}') +
          ' | {percentage}% | {value}/{total} chunks | ETA: {eta}s',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic
    );

    this.progressBar.start(total, 0);
  }

  /**
   * Print indexing summary
   */
  private printSummary(stats: IndexingStats, duration: number): void {
    console.log(chalk.green('\n✓ Indexing complete!\n'));
    console.log(chalk.white.bold('📊 Indexing Summary:\n'));
    console.log(chalk.cyan('─'.repeat(60)));
    console.log(chalk.gray(`Files Analyzed:      ${stats.filesAnalyzed}`));
    console.log(chalk.gray(`Total Chunks:        ${stats.totalChunks}`));
    console.log(chalk.gray(`Embeddings Created:  ${stats.embeddingsGenerated}`));
    console.log(chalk.gray(`Cached (Skipped):    ${stats.chunksCached}`));
    console.log(chalk.gray(`Total Tokens:        ${stats.totalTokens.toLocaleString()}`));

    if (stats.estimatedCost > 0) {
      console.log(
        chalk.gray(`Estimated Cost:      $${stats.estimatedCost.toFixed(4)}`)
      );
    } else {
      console.log(chalk.gray(`Cost:                Free (local embeddings)`));
    }

    console.log(chalk.gray(`Duration:            ${(duration / 1000).toFixed(2)}s`));
    console.log(chalk.cyan('─'.repeat(60)));

    const storageDir = this.store.getStorageDir();
    console.log(chalk.gray(`\nEmbeddings stored in: ${storageDir}`));
  }

  /**
   * Normalize indexing options
   */
  private normalizeOptions(options: IndexingOptions): Required<IndexingOptions> {
    return {
      incremental: options.incremental !== false,
      batchSize: options.batchSize || 50,
      showProgress: options.showProgress !== false,
      validateEmbeddings: options.validateEmbeddings !== false,
      maxConcurrency: options.maxConcurrency || 5,
    };
  }

  /**
   * Clear all embeddings
   */
  async clearIndex(): Promise<void> {
    await this.store.clear();
  }

  /**
   * Optimize storage
   */
  async optimizeIndex(): Promise<void> {
    await this.store.optimize();
  }

  /**
   * Export embeddings to file
   */
  async exportIndex(outputPath: string): Promise<void> {
    await this.store.exportToFile(outputPath);
  }

  /**
   * Import embeddings from file
   */
  async importIndex(inputPath: string): Promise<void> {
    await this.store.importFromFile(inputPath);
  }
}
