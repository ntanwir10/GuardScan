/**
 * embedding-search.ts - Semantic Code Search Engine
 *
 * Purpose: Find relevant code chunks using vector similarity search.
 * Features: Cosine similarity, multi-factor ranking, filtering
 */

import {
  CodeEmbedding,
  SearchFilters,
  SearchResult,
  EmbeddingProvider,
  EmbeddingStore,
  cosineSimilarity,
} from './embeddings';

export interface SearchOptions {
  k?: number;                    // Number of results (default: 10)
  filters?: SearchFilters;       // Filter by language, type, etc.
  minSimilarity?: number;        // Min similarity score (0-1, default: 0.5)
  enableRanking?: boolean;       // Enable multi-factor ranking (default: true)
  rankingWeights?: RankingWeights;
}

export interface RankingWeights {
  similarity: number;   // 0-1 (default: 0.6)
  recency: number;      // 0-1 (default: 0.2)
  importance: number;   // 0-1 (default: 0.2)
}

export interface SearchStats {
  totalEmbeddings: number;
  filteredCount: number;
  searchTimeMs: number;
  averageSimilarity: number;
}

export class EmbeddingSearchEngine {
  private defaultWeights: RankingWeights = {
    similarity: 0.6,
    recency: 0.2,
    importance: 0.2,
  };

  constructor(
    private embeddingProvider: EmbeddingProvider,
    private store: EmbeddingStore
  ) {}

  /**
   * Find K most similar code chunks for a query
   */
  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<{ results: SearchResult[]; stats: SearchStats }> {
    const startTime = Date.now();

    const {
      k = 10,
      filters,
      minSimilarity = 0.5,
      enableRanking = true,
      rankingWeights = this.defaultWeights,
    } = options;

    // 1. Generate query embedding
    const queryEmbedding = await this.embeddingProvider.generateEmbedding(query);
    const queryDimensions = queryEmbedding.length;

    // 2. Load embeddings (with optional filters)
    let embeddings: CodeEmbedding[];
    if (filters) {
      embeddings = await this.store.loadEmbeddingsWithFilters(filters);
    } else {
      embeddings = await this.store.loadEmbeddings();
    }

    const totalEmbeddings = embeddings.length;

    // 3. Filter compatible embeddings (same dimensions)
    const compatibleEmbeddings = embeddings.filter(emb => {
      return emb.embedding.length === queryDimensions;
    });

    const incompatibleCount = totalEmbeddings - compatibleEmbeddings.length;

    if (incompatibleCount > 0) {
      console.warn(
        `⚠️  Warning: ${incompatibleCount} embeddings have incompatible dimensions ` +
        `(${queryDimensions} expected). These will be skipped. ` +
        `Use --rebuild to regenerate embeddings with the current provider.`
      );
    }

    if (compatibleEmbeddings.length === 0) {
      throw new Error(
        `No compatible embeddings found. ` +
        `Query embedding dimensions: ${queryDimensions}, ` +
        `but all stored embeddings have different dimensions. ` +
        `Use --rebuild to regenerate embeddings.`
      );
    }

    // 4. Calculate similarities
    const similarities = compatibleEmbeddings.map(emb => {
      const score = cosineSimilarity(queryEmbedding, emb.embedding);
      return {
        embedding: emb,
        similarityScore: score,
      };
    });

    // 5. Filter by minimum similarity
    const filtered = similarities.filter(s => s.similarityScore >= minSimilarity);

    // 6. Apply multi-factor ranking if enabled
    let results: SearchResult[];
    if (enableRanking) {
      results = this.applyRanking(filtered, rankingWeights, query);
    } else {
      results = filtered;
    }

    // 7. Sort by final score (relevanceScore if ranked, similarityScore otherwise)
    results.sort((a, b) => {
      const scoreA = a.relevanceScore ?? a.similarityScore;
      const scoreB = b.relevanceScore ?? b.similarityScore;
      return scoreB - scoreA;
    });

    // 8. Take top K
    const topK = results.slice(0, k);

    // 9. Calculate stats
    const searchTimeMs = Date.now() - startTime;
    const averageSimilarity =
      topK.length > 0
        ? topK.reduce((sum, r) => sum + r.similarityScore, 0) / topK.length
        : 0;

    const stats: SearchStats = {
      totalEmbeddings: compatibleEmbeddings.length,
      filteredCount: filtered.length,
      searchTimeMs,
      averageSimilarity,
    };

    return { results: topK, stats };
  }

  /**
   * Find similar code to a given embedding
   */
  async findSimilarToEmbedding(
    targetEmbedding: CodeEmbedding,
    k: number = 5
  ): Promise<SearchResult[]> {
    const embeddings = await this.store.loadEmbeddings();

    const similarities = embeddings
      .filter((emb: CodeEmbedding) => emb.id !== targetEmbedding.id) // Exclude self
      .map((emb: CodeEmbedding) => ({
        embedding: emb,
        similarityScore: cosineSimilarity(targetEmbedding.embedding, emb.embedding),
      }));

    // Sort and take top K
    similarities.sort((a: SearchResult, b: SearchResult) => b.similarityScore - a.similarityScore);
    return similarities.slice(0, k);
  }

  /**
   * Find all code chunks related to a specific file
   */
  async findByFile(filePath: string): Promise<CodeEmbedding[]> {
    const embeddings = await this.store.loadEmbeddings();
    return embeddings.filter((emb: CodeEmbedding) => emb.source === filePath);
  }

  /**
   * Find code chunks by tags
   */
  async findByTags(tags: string[], matchAll: boolean = false): Promise<CodeEmbedding[]> {
    const embeddings = await this.store.loadEmbeddings();

    return embeddings.filter((emb: CodeEmbedding) => {
      if (matchAll) {
        // Must have all tags
        return tags.every((tag: string) => emb.metadata.tags.includes(tag));
      } else {
        // Must have at least one tag
        return tags.some((tag: string) => emb.metadata.tags.includes(tag));
      }
    });
  }

  /**
   * Find code chunks by complexity range
   */
  async findByComplexity(
    min: number,
    max: number
  ): Promise<CodeEmbedding[]> {
    const embeddings = await this.store.loadEmbeddings();

    return embeddings.filter((emb: CodeEmbedding) => {
      const complexity = emb.metadata.complexity;
      if (complexity === undefined) return false;
      return complexity >= min && complexity <= max;
    });
  }

  // ========================================================================
  // Ranking System
  // ========================================================================

  /**
   * Apply multi-factor ranking to search results
   */
  private applyRanking(
    results: SearchResult[],
    weights: RankingWeights,
    query: string
  ): SearchResult[] {
    const now = Date.now();
    const maxAge = 365 * 24 * 60 * 60 * 1000; // 1 year in ms

    return results.map(result => {
      const emb = result.embedding;

      // 1. Similarity score (already calculated)
      const similarityScore = result.similarityScore;

      // 2. Recency score (0-1, newer is better)
      const age = now - new Date(emb.metadata.lastModified).getTime();
      const recencyScore = Math.max(0, 1 - age / maxAge);

      // 3. Importance score (based on multiple factors)
      const importanceScore = this.calculateImportance(emb, query);

      // 4. Combine scores with weights
      const relevanceScore =
        similarityScore * weights.similarity +
        recencyScore * weights.recency +
        importanceScore * weights.importance;

      return {
        ...result,
        relevanceScore,
        rankingFactors: {
          similarity: similarityScore,
          recency: recencyScore,
          importance: importanceScore,
        },
      };
    });
  }

  /**
   * Calculate importance score for a code chunk
   */
  private calculateImportance(emb: CodeEmbedding, query: string): number {
    let score = 0.5; // Base score

    // Factor 1: Complexity (moderate complexity is often important)
    if (emb.metadata.complexity !== undefined) {
      const complexity = emb.metadata.complexity;
      if (complexity >= 5 && complexity <= 15) {
        score += 0.2; // Sweet spot for important code
      } else if (complexity > 15) {
        score += 0.1; // Very complex might be important
      }
    }

    // Factor 2: Exports (exported items are often public API)
    if (emb.metadata.exports.length > 0) {
      score += 0.15;
    }

    // Factor 3: Dependencies (well-connected code is often important)
    const depCount = emb.metadata.dependencies.length;
    if (depCount > 0) {
      score += Math.min(0.15, depCount * 0.03);
    }

    // Factor 4: Tags match (if query contains tag keywords)
    const queryLower = query.toLowerCase();
    const matchingTags = emb.metadata.tags.filter(tag =>
      queryLower.includes(tag.toLowerCase())
    );
    if (matchingTags.length > 0) {
      score += Math.min(0.2, matchingTags.length * 0.1);
    }

    // Factor 5: Type priority (functions > classes > files)
    if (emb.type === 'function') score += 0.1;
    else if (emb.type === 'class') score += 0.05;

    // Factor 6: Documentation chunks are often important
    if (emb.type === 'documentation') score += 0.15;

    // Normalize to 0-1 range
    return Math.min(1, score);
  }

  // ========================================================================
  // Batch Operations
  // ========================================================================

  /**
   * Search multiple queries in batch
   */
  async batchSearch(
    queries: string[],
    options: SearchOptions = {}
  ): Promise<Map<string, SearchResult[]>> {
    const results = new Map<string, SearchResult[]>();

    for (const query of queries) {
      const { results: searchResults } = await this.search(query, options);
      results.set(query, searchResults);
    }

    return results;
  }

  /**
   * Find diverse results (avoid too many from same file)
   */
  async searchDiverse(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const { results } = await this.search(query, {
      ...options,
      k: (options.k || 10) * 3, // Get 3x more results for diversity
    });

    // Group by source file
    const byFile = new Map<string, SearchResult[]>();
    results.forEach(result => {
      const file = result.embedding.source;
      if (!byFile.has(file)) {
        byFile.set(file, []);
      }
      byFile.get(file)!.push(result);
    });

    // Take top result from each file, round-robin style
    const diverse: SearchResult[] = [];
    const maxPerFile = 2;

    for (const [_file, fileResults] of byFile) {
      diverse.push(...fileResults.slice(0, maxPerFile));
    }

    // Sort by score and take top K
    diverse.sort((a, b) => {
      const scoreA = a.relevanceScore ?? a.similarityScore;
      const scoreB = b.relevanceScore ?? b.similarityScore;
      return scoreB - scoreA;
    });

    return diverse.slice(0, options.k || 10);
  }

  // ========================================================================
  // Analytics
  // ========================================================================

  /**
   * Get search quality metrics
   */
  async getSearchMetrics(
    testQueries: string[]
  ): Promise<{
    averageResults: number;
    averageSimilarity: number;
    averageSearchTime: number;
    coverageByType: Record<string, number>;
  }> {
    let totalResults = 0;
    let totalSimilarity = 0;
    let totalSearchTime = 0;
    const typeCount = new Map<string, number>();

    for (const query of testQueries) {
      const { results, stats } = await this.search(query);

      totalResults += results.length;
      totalSimilarity += stats.averageSimilarity;
      totalSearchTime += stats.searchTimeMs;

      results.forEach(r => {
        const type = r.embedding.type;
        typeCount.set(type, (typeCount.get(type) || 0) + 1);
      });
    }

    const count = testQueries.length;
    const coverageByType: Record<string, number> = {};
    typeCount.forEach((count, type) => {
      coverageByType[type] = count;
    });

    return {
      averageResults: totalResults / count,
      averageSimilarity: totalSimilarity / count,
      averageSearchTime: totalSearchTime / count,
      coverageByType,
    };
  }

  /**
   * Get embedding coverage statistics
   */
  async getCoverageStats(): Promise<{
    totalEmbeddings: number;
    byType: Record<string, number>;
    byLanguage: Record<string, number>;
    oldestEmbedding: Date;
    newestEmbedding: Date;
  }> {
    const embeddings = await this.store.loadEmbeddings();

    const byType: Record<string, number> = {};
    const byLanguage: Record<string, number> = {};
    let oldest = new Date();
    let newest = new Date(0);

    embeddings.forEach((emb: CodeEmbedding) => {
      // Count by type
      byType[emb.type] = (byType[emb.type] || 0) + 1;

      // Count by language
      const lang = emb.metadata.language;
      byLanguage[lang] = (byLanguage[lang] || 0) + 1;

      // Track dates
      const modified = new Date(emb.metadata.lastModified);
      if (modified < oldest) oldest = modified;
      if (modified > newest) newest = modified;
    });

    return {
      totalEmbeddings: embeddings.length,
      byType,
      byLanguage,
      oldestEmbedding: oldest,
      newestEmbedding: newest,
    };
  }
}
