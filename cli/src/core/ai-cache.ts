import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { configManager } from './config';

// Maximum size for a single cache entry (1MB)
const MAX_CACHE_ENTRY_SIZE = 1024 * 1024;

/**
 * Cache entry structure
 */
export interface CacheEntry {
  key: string;
  prompt: string;
  model: string;
  response: string;
  timestamp: Date;
  fileHashes: Map<string, string>;  // file path -> hash
  size: number;  // Size in bytes
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  totalEntries: number;
  totalSize: number;  // In bytes
  hitRate: number;    // Percentage
}

export interface AICacheOptions {
  enabled?: boolean;
  maxSizeMB?: number;
  ttlSeconds?: number;
}

/**
 * AI Response Cache
 *
 * Implements an LRU cache for AI responses with file-based invalidation.
 */
export class AICache {
  private cache: Map<string, CacheEntry>;
  private accessOrder: string[];  // Keys in LRU order (oldest first)
  private maxSizeBytes: number;   // Maximum cache size in bytes
  private currentSizeBytes: number;
  private repoId: string;
  private stats: CacheStats;
  private enabled: boolean;
  private ttlSeconds?: number;

  constructor(repoId: string, maxSizeOrOptions: number | AICacheOptions = 100) {
    const options: AICacheOptions =
      typeof maxSizeOrOptions === 'number'
        ? { maxSizeMB: maxSizeOrOptions }
        : maxSizeOrOptions;

    this.cache = new Map();
    this.accessOrder = [];
    this.maxSizeBytes = (options.maxSizeMB ?? 100) * 1024 * 1024; // Convert MB to bytes
    this.currentSizeBytes = 0;
    this.repoId = repoId;
    this.enabled =
      options.enabled !== false && process.env.GUARDSCAN_NO_CACHE !== 'true';
    this.ttlSeconds = options.ttlSeconds;
    this.stats = {
      hits: 0,
      misses: 0,
      totalEntries: 0,
      totalSize: 0,
      hitRate: 0,
    };

    // Load existing cache from disk
    if (this.enabled) {
      this.loadFromDisk();
      if (this.pruneExpiredEntries() > 0) {
        void this.saveToDisk();
      }
    }
  }

  /**
   * Get cached response
   */
  async get(prompt: string, model: string, files?: string[]): Promise<string | null> {
    if (!this.enabled) {
      return null;
    }

    const key = this.generateKey(prompt, model);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    if (this.isExpired(entry)) {
      this.removeEntry(key);
      this.stats.misses++;
      this.updateHitRate();
      await this.saveToDisk();
      return null;
    }

    // Check if any files have changed
    if (files && files.length > 0) {
      const hasChanged = await this.hasFilesChanged(files, entry.fileHashes);
      if (hasChanged) {
        // Invalidate this entry
        this.removeEntry(key);
        this.stats.misses++;
        this.updateHitRate();
        return null;
      }
    }

    // Update access order (move to end = most recently used)
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);

    this.stats.hits++;
    this.updateHitRate();

    return entry.response;
  }

  /**
   * Set cache entry
   */
  async set(
    prompt: string,
    model: string,
    response: string,
    files?: string[]
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const key = this.generateKey(prompt, model);

    // Calculate entry size first
    const size = Buffer.byteLength(prompt) + Buffer.byteLength(response);

    // Check size limit
    if (size > MAX_CACHE_ENTRY_SIZE) {
      console.warn(
        `Cache entry too large (${(size / 1024 / 1024).toFixed(2)}MB), ` +
        `skipping cache (max: 1MB)`
      );
      return; // Don't cache oversized entries
    }

    // Calculate file hashes
    const fileHashes = new Map<string, string>();
    if (files && files.length > 0) {
      for (const file of files) {
        if (fs.existsSync(file)) {
          const hash = await this.hashFile(file);
          fileHashes.set(file, hash);
        }
      }
    }

    const entry: CacheEntry = {
      key,
      prompt,
      model,
      response,
      timestamp: new Date(),
      fileHashes,
      size,
    };

    this.pruneExpiredEntries();

    // Check if we need to evict
    while (this.currentSizeBytes + size > this.maxSizeBytes && this.accessOrder.length > 0) {
      this.evictLRU();
    }

    // Remove old entry if exists
    const oldEntry = this.cache.get(key);
    if (oldEntry) {
      this.removeEntry(key);
    }

    // Add new entry
    this.cache.set(key, entry);
    this.accessOrder.push(key);
    this.currentSizeBytes += size;
    this.stats.totalEntries = this.cache.size;
    this.stats.totalSize = this.currentSizeBytes;

    // Persist to disk
    await this.saveToDisk();
  }

  /**
   * Invalidate cache entries for changed files
   */
  async invalidate(changedFiles: string[]): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const keysToRemove: string[] = [];

    for (const [key, entry] of this.cache) {
      for (const changedFile of changedFiles) {
        if (entry.fileHashes.has(changedFile)) {
          // Check if file actually changed
          const oldHash = entry.fileHashes.get(changedFile)!;
          const newHash = await this.hashFile(changedFile);

          if (oldHash !== newHash) {
            keysToRemove.push(key);
            break;
          }
        }
      }
    }

    // Remove invalidated entries
    for (const key of keysToRemove) {
      this.removeEntry(key);
    }

    this.stats.totalEntries = this.cache.size;
    this.stats.totalSize = this.currentSizeBytes;

    if (keysToRemove.length > 0) {
      await this.saveToDisk();
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.cache.clear();
    this.accessOrder = [];
    this.currentSizeBytes = 0;
    this.stats = {
      hits: 0,
      misses: 0,
      totalEntries: 0,
      totalSize: 0,
      hitRate: 0,
    };

    const cacheDir = this.getCacheDir();
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    if (this.accessOrder.length === 0) {return;}

    const lruKey = this.accessOrder.shift()!;
    const entry = this.cache.get(lruKey);

    if (entry) {
      this.removeEntry(lruKey);
    }
  }

  private removeEntry(key: string): void {
    const entry = this.cache.get(key);
    if (!entry) {
      return;
    }

    this.cache.delete(key);
    this.removeFromAccessOrder(key);
    this.currentSizeBytes -= entry.size;
    this.stats.totalEntries = this.cache.size;
    this.stats.totalSize = this.currentSizeBytes;
  }

  private isExpired(entry: CacheEntry): boolean {
    if (!this.ttlSeconds || this.ttlSeconds <= 0) {
      return false;
    }

    const ageMs = Date.now() - entry.timestamp.getTime();
    return ageMs > this.ttlSeconds * 1000;
  }

  private pruneExpiredEntries(): number {
    if (!this.ttlSeconds || this.ttlSeconds <= 0) {
      return 0;
    }

    const expiredKeys: string[] = [];
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.removeEntry(key);
    }
    return expiredKeys.length;
  }

  /**
   * Generate cache key from prompt and model
   */
  private generateKey(prompt: string, model: string): string {
    return crypto
      .createHash('sha256')
      .update(prompt + '::' + model)
      .digest('hex');
  }

  /**
   * Hash a file
   */
  private async hashFile(filePath: string): Promise<string> {
    if (!fs.existsSync(filePath)) {
      return '';
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Check if any files have changed
   */
  private async hasFilesChanged(
    files: string[],
    cachedHashes: Map<string, string>
  ): Promise<boolean> {
    for (const file of files) {
      const cachedHash = cachedHashes.get(file);
      if (!cachedHash) {
        // New file not in cache
        return true;
      }

      const currentHash = await this.hashFile(file);
      if (currentHash !== cachedHash) {
        return true;
      }
    }

    return false;
  }

  /**
   * Remove key from access order
   */
  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  /**
   * Update hit rate statistic
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  /**
   * Get cache directory path
   */
  private getCacheDir(): string {
    const baseCacheDir = configManager.getCacheDir();
    if (!/^[a-zA-Z0-9._-]+$/.test(this.repoId)) {
      throw new Error('Invalid repository cache identifier');
    }
    const aiCacheDir = path.resolve(baseCacheDir, this.repoId, 'ai-cache');
    const resolvedBase = path.resolve(baseCacheDir) + path.sep;
    if (!aiCacheDir.startsWith(resolvedBase)) {
      throw new Error('Repository cache path escapes the GuardScan cache directory');
    }
    return aiCacheDir;
  }

  /**
   * Save cache to disk
   */
  private async saveToDisk(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const cacheDir = this.getCacheDir();

    // Ensure directory and all parent directories exist
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
    } catch (error) {
      // If directory creation fails, log and continue (might already exist)
      console.warn(`Warning: Failed to create cache directory ${cacheDir}:`, error);
    }

    // Convert cache to serializable format
    const serializable = {
      entries: Array.from(this.cache.entries()).map(([key, entry]) => ({
        ...entry,
        timestamp: entry.timestamp.toISOString(),
        fileHashes: Array.from(entry.fileHashes.entries()),
      })),
      accessOrder: this.accessOrder,
      stats: this.stats,
    };

    const cachePath = path.join(cacheDir, 'cache.json');
    
    try {
      fs.writeFileSync(cachePath, JSON.stringify(serializable, null, 2), 'utf-8');
    } catch (error: any) {
      console.warn('Failed to save cache to disk:', error.message);
      // Continue without crashing - cache just won't persist
    }
  }

  /**
   * Load cache from disk
   */
  private loadFromDisk(): void {
    const cacheDir = this.getCacheDir();
    const cachePath = path.join(cacheDir, 'cache.json');

    if (!fs.existsSync(cachePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(cachePath, 'utf-8');
      const data = JSON.parse(content);

      // Restore cache entries
      this.cache.clear();
      this.currentSizeBytes = 0;

      for (const entry of data.entries) {
        const cacheEntry: CacheEntry = {
          ...entry,
          timestamp: new Date(entry.timestamp),
          fileHashes: new Map(entry.fileHashes),
        };

        this.cache.set(entry.key, cacheEntry);
        this.currentSizeBytes += cacheEntry.size;
      }

      // Restore access order
      this.accessOrder = data.accessOrder || [];

      // Restore stats
      if (data.stats) {
        this.stats = data.stats;
      }
      this.stats.totalEntries = this.cache.size;
      this.stats.totalSize = this.currentSizeBytes;
    } catch (error) {
      console.warn('Failed to load cache from disk:', error);
      try {
        fs.renameSync(cachePath, `${cachePath}.corrupt-${Date.now()}`);
      } catch {
        // Leave the malformed file in place if quarantine is not possible.
      }
      // Reset cache on error
      this.cache.clear();
      this.accessOrder = [];
      this.currentSizeBytes = 0;
    }
  }

  /**
   * Get cache size in MB
   */
  getSizeMB(): number {
    return this.currentSizeBytes / (1024 * 1024);
  }

  /**
   * Get number of entries
   */
  getEntryCount(): number {
    return this.cache.size;
  }

  /**
   * Check if cache is empty
   */
  isEmpty(): boolean {
    return this.cache.size === 0;
  }

  /**
   * Get cache utilization percentage
   */
  getUtilization(): number {
    return (this.currentSizeBytes / this.maxSizeBytes) * 100;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
