/**
 * embeddings.ts - Vector Embeddings System for RAG
 *
 * Purpose: Generate and manage semantic embeddings of code for similarity search.
 * This enables deep codebase understanding through vector search.
 */

import * as crypto from 'crypto';

// ============================================================================
// Data Structures
// ============================================================================

/**
 * Represents a code chunk with its embedding
 */
export interface CodeEmbedding {
  id: string;                    // Unique identifier: "function-<hash>" or "class-<hash>"
  type: 'function' | 'class' | 'file' | 'documentation' | 'comment';
  source: string;                // File path
  startLine: number;
  endLine: number;
  content: string;               // Original code/text
  contentSummary: string;        // AI-generated summary (for context)
  embedding: number[];           // Vector (1536 or 768 dimensions)
  metadata: EmbeddingMetadata;
  hash: string;                  // Content hash for change detection
}

/**
 * Metadata associated with each embedding
 */
export interface EmbeddingMetadata {
  language: string;              // 'typescript', 'python', etc.
  symbolName?: string;           // Function/class name
  complexity?: number;           // Cyclomatic complexity
  dependencies: string[];        // Imported modules
  exports: string[];             // Exported symbols
  tags: string[];                // Auto-generated tags (e.g., 'authentication', 'database')
  lastModified: Date;
}

/**
 * Storage format for embeddings on disk
 */
export interface EmbeddingIndex {
  version: string;               // Index format version
  repoId: string;
  generatedAt: Date;
  totalEmbeddings: number;
  embeddings: CodeEmbedding[];
  metadata: {
    model: string;               // 'text-embedding-3-small', 'nomic-embed-text'
    dimensions: number;          // 1536, 768, etc.
    costUSD?: number;            // Total cost to generate
  };
}

/**
 * Search filters for embeddings
 */
export interface SearchFilters {
  language?: string;             // Filter by programming language
  type?: CodeEmbedding['type'];  // Filter by chunk type
  filePattern?: string;          // Regex pattern for file path
  minComplexity?: number;        // Minimum complexity
  maxComplexity?: number;        // Maximum complexity
  tags?: string[];               // Must include all tags
}

/**
 * Search result with relevance scoring
 */
export interface SearchResult {
  embedding: CodeEmbedding;
  similarityScore: number;       // 0.0 - 1.0 (cosine similarity)
  relevanceScore?: number;       // 0.0 - 1.0 (multi-factor score)
  rankingFactors?: {
    similarity: number;
    recency: number;
    importance: number;
  };
}

/**
 * Code chunk for embedding generation
 */
export interface CodeChunk {
  type: CodeEmbedding['type'];
  content: string;
  metadata: Partial<EmbeddingMetadata>;
  source?: string;
  startLine?: number;
  endLine?: number;
}

// ============================================================================
// Embedding Provider Interface
// ============================================================================

/**
 * Abstract interface for embedding providers (OpenAI, Ollama, etc.)
 */
export interface EmbeddingProvider {
  /**
   * Get the name of the provider
   */
  getName(): string;

  /**
   * Get the embedding dimensions for this provider
   */
  getDimensions(): number;

  /**
   * Get the model name
   */
  getModel(): string;

  /**
   * Generate embedding for a single text
   */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts (batched for efficiency)
   */
  generateBulkEmbeddings(texts: string[]): Promise<number[][]>;

  /**
   * Estimate cost in USD for generating embeddings
   * Returns 0 for free/local providers
   */
  estimateCost(tokenCount: number): number;

  /**
   * Check if provider is available and configured
   */
  isAvailable(): boolean;

  /**
   * Test connection to provider
   */
  testConnection(): Promise<boolean>;
}

/**
 * Base class for embedding providers
 */
export abstract class BaseEmbeddingProvider implements EmbeddingProvider {
  constructor(
    protected name: string,
    protected model: string,
    protected dimensions: number
  ) {}

  getName(): string {
    return this.name;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModel(): string {
    return this.model;
  }

  abstract generateEmbedding(text: string): Promise<number[]>;
  abstract generateBulkEmbeddings(texts: string[]): Promise<number[][]>;
  abstract estimateCost(tokenCount: number): number;
  abstract isAvailable(): boolean;
  abstract testConnection(): Promise<boolean>;

  /**
   * Helper: Chunk array into batches
   */
  protected chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Helper: Estimate token count (rough approximation)
   */
  protected estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}

// ============================================================================
// Embedding Store Interface
// ============================================================================

/**
 * Interface for storing and retrieving embeddings
 */
export interface EmbeddingStore {
  /**
   * Initialize storage (create directories, tables, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Save embeddings to storage
   */
  saveEmbeddings(embeddings: CodeEmbedding[]): Promise<void>;

  /**
   * Load all embeddings from storage
   */
  loadEmbeddings(): Promise<CodeEmbedding[]>;

  /**
   * Load embeddings with filters
   */
  loadEmbeddingsWithFilters(filters: SearchFilters): Promise<CodeEmbedding[]>;

  /**
   * Update a single embedding
   */
  updateEmbedding(embedding: CodeEmbedding): Promise<void>;

  /**
   * Delete embeddings by IDs
   */
  deleteEmbeddings(ids: string[]): Promise<void>;

  /**
   * Clear all embeddings
   */
  clear(): Promise<void>;

  /**
   * Get metadata about the index
   */
  getMetadata(): Promise<EmbeddingIndex['metadata'] | null>;

  /**
   * Check if embeddings exist
   */
  exists(): Promise<boolean>;

  /**
   * Get total number of embeddings
   */
  count(): Promise<number>;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate hash for content (for change detection)
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Generate unique ID for embedding
 */
export function generateEmbeddingId(type: CodeEmbedding['type'], source: string, name?: string): string {
  const components = [type, source];
  if (name) components.push(name);
  const hash = hashContent(components.join(':'));
  return `${type}-${hash}`;
}

/**
 * Validate embedding dimensions
 */
export function validateEmbedding(embedding: number[], expectedDimensions: number): boolean {
  if (!Array.isArray(embedding)) return false;
  if (embedding.length !== expectedDimensions) return false;
  if (embedding.some(v => typeof v !== 'number' || !isFinite(v))) return false;
  return true;
}

/**
 * Normalize embedding vector (for cosine similarity)
 */
export function normalizeEmbedding(embedding: number[]): number[] {
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) return embedding; // Avoid division by zero
  return embedding.map(v => v / magnitude);
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

  if (magnitudeA === 0 || magnitudeB === 0) return 0;

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Calculate Euclidean distance between two embeddings
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  const sumSquaredDiff = a.reduce((sum, val, i) => {
    const diff = val - b[i];
    return sum + diff * diff;
  }, 0);

  return Math.sqrt(sumSquaredDiff);
}

/**
 * Format file size for display
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Estimate storage size for embeddings
 */
export function estimateStorageSize(count: number, dimensions: number): number {
  // Each embedding: dimensions * 8 bytes (float64) + metadata overhead (~500 bytes)
  const embeddingSize = dimensions * 8;
  const metadataSize = 500;
  return count * (embeddingSize + metadataSize);
}
