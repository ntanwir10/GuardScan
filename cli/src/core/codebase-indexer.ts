import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ASTParser, ParsedFile, ParsedFunction, ParsedClass } from './ast-parser';
import { configManager } from './config';

/**
 * Symbol information in the codebase
 */
export interface Symbol {
  id: string;
  name: string;
  type: 'function' | 'class' | 'variable' | 'interface' | 'type';
  file: string;
  line: number;
  exported: boolean;
  documentation?: string;
}

/**
 * Reference to a symbol
 */
export interface Reference {
  symbol: string;
  file: string;
  line: number;
  context: string;
}

/**
 * Dependency graph edge
 */
export interface Dependency {
  from: string;  // File or symbol
  to: string;    // File or symbol
  type: 'import' | 'call' | 'extends' | 'implements';
}

/**
 * Dependency graph structure
 */
export interface DependencyGraph {
  nodes: Set<string>;
  edges: Map<string, Set<string>>;
  reverseEdges: Map<string, Set<string>>;  // For "who depends on me"
}

/**
 * Per-file index information
 */
export interface FileIndex {
  path: string;
  relativePath: string;
  hash: string;  // SHA-256 hash for change detection
  language: string;
  loc: number;
  lastModified: Date;
  functions: string[];  // Symbol IDs
  classes: string[];    // Symbol IDs
  imports: string[];
  exports: string[];
  parsed?: ParsedFile;  // Optional: full parsed data (lazy loaded)
}

/**
 * Main codebase index
 */
export interface CodebaseIndex {
  version: string;
  repoId: string;
  rootPath: string;
  lastUpdated: Date;
  totalFiles: number;
  totalLoc: number;
  files: Map<string, FileIndex>;
  functions: Map<string, ParsedFunction>;
  classes: Map<string, ParsedClass>;
  symbols: Map<string, Symbol>;
  dependencies: DependencyGraph;
  metadata: {
    languages: Map<string, number>;  // language -> file count
    complexity: {
      average: number;
      max: number;
      distribution: Map<number, number>;  // complexity -> count
    };
  };
}

/**
 * LRU Cache for parsed files
 */
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;
  private accessOrder: K[];

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.accessOrder = [];
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      this.accessOrder.push(key);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Update existing
      this.cache.set(key, value);
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      this.accessOrder.push(key);
    } else {
      // Add new
      if (this.cache.size >= this.maxSize) {
        // Evict least recently used
        const lru = this.accessOrder.shift();
        if (lru !== undefined) {
          this.cache.delete(lru);
        }
      }
      this.cache.set(key, value);
      this.accessOrder.push(key);
    }
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }
}

/**
 * Codebase Indexer
 *
 * Builds and maintains a searchable index of the entire codebase.
 */
export class CodebaseIndexer {
  private parser: ASTParser;
  private parsedFilesCache: LRUCache<string, ParsedFile>;
  private repoRoot: string;
  private repoId: string;

  constructor(repoRoot: string, repoId: string) {
    this.parser = new ASTParser();
    this.parsedFilesCache = new LRUCache(100);
    this.repoRoot = repoRoot;
    this.repoId = repoId;
  }

  /**
   * Build complete index from scratch
   */
  async buildIndex(): Promise<CodebaseIndex> {
    const files = await this.findCodeFiles(this.repoRoot);

    const index: CodebaseIndex = {
      version: '1.0.0',
      repoId: this.repoId,
      rootPath: this.repoRoot,
      lastUpdated: new Date(),
      totalFiles: 0,
      totalLoc: 0,
      files: new Map(),
      functions: new Map(),
      classes: new Map(),
      symbols: new Map(),
      dependencies: {
        nodes: new Set(),
        edges: new Map(),
        reverseEdges: new Map(),
      },
      metadata: {
        languages: new Map(),
        complexity: {
          average: 0,
          max: 0,
          distribution: new Map(),
        },
      },
    };

    // Process each file
    for (const filePath of files) {
      try {
        await this.indexFile(filePath, index);
      } catch (error) {
        console.warn(`Warning: Failed to index ${filePath}:`, error);
        // Continue with other files
      }
    }

    // Build dependency graph
    this.buildDependencyGraph(index);

    // Calculate metadata
    this.calculateMetadata(index);

    // Save to disk
    await this.saveIndex(index);

    return index;
  }

  /**
   * Update index for changed files only
   */
  async updateIndex(changedFiles: string[]): Promise<CodebaseIndex> {
    // Load existing index
    let index = await this.loadIndex();

    if (!index) {
      // No existing index, build from scratch
      return this.buildIndex();
    }

    // Update changed files
    for (const filePath of changedFiles) {
      const absolutePath = path.resolve(this.repoRoot, filePath);

      // Remove old data for this file
      this.removeFileFromIndex(filePath, index);

      // Re-index if file still exists
      if (fs.existsSync(absolutePath)) {
        try {
          await this.indexFile(absolutePath, index);
        } catch (error) {
          console.warn(`Warning: Failed to re-index ${filePath}:`, error);
        }
      }
    }

    // Rebuild dependency graph (dependencies may have changed)
    this.buildDependencyGraph(index);

    // Recalculate metadata
    this.calculateMetadata(index);

    // Update timestamp
    index.lastUpdated = new Date();

    // Save to disk
    await this.saveIndex(index);

    return index;
  }

  /**
   * Search for functions by name or pattern
   */
  async searchFunctions(query: string): Promise<ParsedFunction[]> {
    const index = await this.loadIndex();
    if (!index) return [];

    const results: ParsedFunction[] = [];
    const queryLower = query.toLowerCase();

    for (const [id, func] of index.functions) {
      if (func.name.toLowerCase().includes(queryLower)) {
        results.push(func);
      }
    }

    return results;
  }

  /**
   * Search for classes by name or pattern
   */
  async searchClasses(query: string): Promise<ParsedClass[]> {
    const index = await this.loadIndex();
    if (!index) return [];

    const results: ParsedClass[] = [];
    const queryLower = query.toLowerCase();

    for (const [id, cls] of index.classes) {
      if (cls.name.toLowerCase().includes(queryLower)) {
        results.push(cls);
      }
    }

    return results;
  }

  /**
   * Get all dependencies of a symbol
   */
  async getDependencies(symbolId: string): Promise<string[]> {
    const index = await this.loadIndex();
    if (!index) return [];

    const deps = index.dependencies.edges.get(symbolId);
    return deps ? Array.from(deps) : [];
  }

  /**
   * Get all reverse dependencies (who depends on this symbol)
   */
  async getReverseDependencies(symbolId: string): Promise<string[]> {
    const index = await this.loadIndex();
    if (!index) return [];

    const deps = index.dependencies.reverseEdges.get(symbolId);
    return deps ? Array.from(deps) : [];
  }

  /**
   * Find all references to a symbol
   */
  async findReferences(symbolName: string): Promise<Reference[]> {
    const index = await this.loadIndex();
    if (!index) return [];

    const references: Reference[] = [];

    // Search through all functions for calls to this symbol
    for (const [id, func] of index.functions) {
      if (func.dependencies.includes(symbolName)) {
        references.push({
          symbol: symbolName,
          file: func.file,
          line: func.line,
          context: `Called in ${func.name}()`,
        });
      }
    }

    return references;
  }

  /**
   * Get file index by path
   */
  async getFileIndex(filePath: string): Promise<FileIndex | null> {
    const index = await this.loadIndex();
    if (!index) return null;

    const relativePath = path.relative(this.repoRoot, filePath);
    return index.files.get(relativePath) || null;
  }

  /**
   * Get parsed file (with lazy loading and caching)
   */
  async getParsedFile(filePath: string): Promise<ParsedFile | null> {
    // Check cache first
    let parsed = this.parsedFilesCache.get(filePath);
    if (parsed) return parsed;

    // Parse and cache
    try {
      parsed = await this.parser.parseFile(filePath);
      this.parsedFilesCache.set(filePath, parsed);
      return parsed;
    } catch (error) {
      console.warn(`Failed to parse ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Index a single file
   */
  private async indexFile(filePath: string, index: CodebaseIndex): Promise<void> {
    const relativePath = path.relative(this.repoRoot, filePath);

    // Parse file
    const parsed = await this.getParsedFile(filePath);
    if (!parsed) return;

    // Calculate file hash
    const content = fs.readFileSync(filePath, 'utf-8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    // Count LOC (non-empty, non-comment lines)
    const loc = content.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
    }).length;

    // Create file index
    const fileIndex: FileIndex = {
      path: filePath,
      relativePath,
      hash,
      language: parsed.language,
      loc,
      lastModified: fs.statSync(filePath).mtime,
      functions: [],
      classes: [],
      imports: parsed.imports,
      exports: parsed.exports,
    };

    // Add functions to index
    for (const func of parsed.functions) {
      const funcId = `${relativePath}:${func.name}:${func.line}`;
      index.functions.set(funcId, func);
      fileIndex.functions.push(funcId);

      // Add as symbol
      index.symbols.set(funcId, {
        id: funcId,
        name: func.name,
        type: 'function',
        file: relativePath,
        line: func.line,
        exported: func.isExported,
        documentation: func.documentation,
      });
    }

    // Add classes to index
    for (const cls of parsed.classes) {
      const classId = `${relativePath}:${cls.name}:${cls.line}`;
      index.classes.set(classId, cls);
      fileIndex.classes.push(classId);

      // Add as symbol
      index.symbols.set(classId, {
        id: classId,
        name: cls.name,
        type: 'class',
        file: relativePath,
        line: cls.line,
        exported: cls.isExported,
        documentation: cls.documentation,
      });

      // Add class methods as symbols
      for (const method of cls.methods) {
        const methodId = `${relativePath}:${cls.name}.${method.name}:${method.line}`;
        index.symbols.set(methodId, {
          id: methodId,
          name: `${cls.name}.${method.name}`,
          type: 'function',
          file: relativePath,
          line: method.line,
          exported: cls.isExported,
          documentation: method.documentation,
        });
      }
    }

    // Add to index
    index.files.set(relativePath, fileIndex);
    index.totalFiles++;
    index.totalLoc += loc;

    // Track language
    const langCount = index.metadata.languages.get(parsed.language) || 0;
    index.metadata.languages.set(parsed.language, langCount + 1);
  }

  /**
   * Remove file from index
   */
  private removeFileFromIndex(filePath: string, index: CodebaseIndex): void {
    const relativePath = path.relative(this.repoRoot, filePath);
    const fileIndex = index.files.get(relativePath);

    if (!fileIndex) return;

    // Remove functions
    for (const funcId of fileIndex.functions) {
      index.functions.delete(funcId);
      index.symbols.delete(funcId);
    }

    // Remove classes
    for (const classId of fileIndex.classes) {
      index.classes.delete(classId);
      index.symbols.delete(classId);
    }

    // Remove file
    index.files.delete(relativePath);
    index.totalFiles--;
    index.totalLoc -= fileIndex.loc;

    // Update language count
    const langCount = index.metadata.languages.get(fileIndex.language);
    if (langCount !== undefined) {
      if (langCount === 1) {
        index.metadata.languages.delete(fileIndex.language);
      } else {
        index.metadata.languages.set(fileIndex.language, langCount - 1);
      }
    }
  }

  /**
   * Build dependency graph from indexed data
   */
  private buildDependencyGraph(index: CodebaseIndex): void {
    // Clear existing graph
    index.dependencies = {
      nodes: new Set(),
      edges: new Map(),
      reverseEdges: new Map(),
    };

    // Add all files as nodes
    for (const [relativePath] of index.files) {
      index.dependencies.nodes.add(relativePath);
    }

    // Add import dependencies
    for (const [relativePath, fileIndex] of index.files) {
      for (const importPath of fileIndex.imports) {
        // Resolve import to file path
        const resolvedPath = this.resolveImport(importPath, relativePath);
        if (resolvedPath && index.files.has(resolvedPath)) {
          this.addDependencyEdge(index.dependencies, relativePath, resolvedPath);
        }
      }
    }

    // Add function call dependencies
    for (const [funcId, func] of index.functions) {
      for (const dep of func.dependencies) {
        // Find symbol
        const symbol = this.findSymbolByName(dep, index);
        if (symbol) {
          this.addDependencyEdge(index.dependencies, funcId, symbol.id);
        }
      }
    }

    // Add class inheritance dependencies
    for (const [classId, cls] of index.classes) {
      if (cls.extends) {
        for (const baseClass of cls.extends) {
          const symbol = this.findSymbolByName(baseClass, index);
          if (symbol) {
            this.addDependencyEdge(index.dependencies, classId, symbol.id);
          }
        }
      }

      if (cls.implements) {
        for (const iface of cls.implements) {
          const symbol = this.findSymbolByName(iface, index);
          if (symbol) {
            this.addDependencyEdge(index.dependencies, classId, symbol.id);
          }
        }
      }
    }
  }

  /**
   * Add edge to dependency graph (both forward and reverse)
   */
  private addDependencyEdge(graph: DependencyGraph, from: string, to: string): void {
    graph.nodes.add(from);
    graph.nodes.add(to);

    // Forward edge
    if (!graph.edges.has(from)) {
      graph.edges.set(from, new Set());
    }
    graph.edges.get(from)!.add(to);

    // Reverse edge
    if (!graph.reverseEdges.has(to)) {
      graph.reverseEdges.set(to, new Set());
    }
    graph.reverseEdges.get(to)!.add(from);
  }

  /**
   * Resolve import path to actual file path
   */
  private resolveImport(importPath: string, fromFile: string): string | null {
    // Handle relative imports
    if (importPath.startsWith('.')) {
      const dir = path.dirname(fromFile);
      const resolved = path.normalize(path.join(dir, importPath));

      // Try with common extensions
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
      for (const ext of extensions) {
        const fullPath = resolved + ext;
        if (fs.existsSync(path.join(this.repoRoot, fullPath))) {
          return fullPath;
        }
      }
    }

    // TODO: Handle node_modules and path aliases
    // For now, return null for non-relative imports
    return null;
  }

  /**
   * Find symbol by name
   */
  private findSymbolByName(name: string, index: CodebaseIndex): Symbol | null {
    for (const [id, symbol] of index.symbols) {
      if (symbol.name === name) {
        return symbol;
      }
    }
    return null;
  }

  /**
   * Calculate metadata statistics
   */
  private calculateMetadata(index: CodebaseIndex): void {
    let totalComplexity = 0;
    let maxComplexity = 0;
    let functionCount = 0;

    const complexityDistribution = new Map<number, number>();

    for (const [id, func] of index.functions) {
      totalComplexity += func.complexity;
      maxComplexity = Math.max(maxComplexity, func.complexity);
      functionCount++;

      // Track distribution (bucket by ranges)
      const bucket = Math.floor(func.complexity / 5) * 5;
      complexityDistribution.set(bucket, (complexityDistribution.get(bucket) || 0) + 1);
    }

    index.metadata.complexity = {
      average: functionCount > 0 ? totalComplexity / functionCount : 0,
      max: maxComplexity,
      distribution: complexityDistribution,
    };
  }

  /**
   * Find all code files in directory
   */
  private async findCodeFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

    const walk = (currentDir: string): void => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        // Skip node_modules, .git, dist, build directories
        if (entry.isDirectory()) {
          const dirName = entry.name;
          if (!['node_modules', '.git', 'dist', 'build', '.next', 'coverage'].includes(dirName)) {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    };

    walk(dir);
    return files;
  }

  /**
   * Save index to disk
   */
  private async saveIndex(index: CodebaseIndex): Promise<void> {
    const cacheDir = this.getCacheDir();

    // Ensure cache directory exists
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Convert Maps to arrays for JSON serialization
    const serializable = {
      ...index,
      files: Array.from(index.files.entries()),
      functions: Array.from(index.functions.entries()),
      classes: Array.from(index.classes.entries()),
      symbols: Array.from(index.symbols.entries()),
      dependencies: {
        nodes: Array.from(index.dependencies.nodes),
        edges: Array.from(index.dependencies.edges.entries()).map(([k, v]) => [k, Array.from(v)]),
        reverseEdges: Array.from(index.dependencies.reverseEdges.entries()).map(([k, v]) => [k, Array.from(v)]),
      },
      metadata: {
        ...index.metadata,
        languages: Array.from(index.metadata.languages.entries()),
        complexity: {
          ...index.metadata.complexity,
          distribution: Array.from(index.metadata.complexity.distribution.entries()),
        },
      },
    };

    const indexPath = path.join(cacheDir, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(serializable, null, 2), 'utf-8');
  }

  /**
   * Load index from disk
   */
  private async loadIndex(): Promise<CodebaseIndex | null> {
    const cacheDir = this.getCacheDir();
    const indexPath = path.join(cacheDir, 'index.json');

    if (!fs.existsSync(indexPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      const data = JSON.parse(content);

      // Convert arrays back to Maps
      const index: CodebaseIndex = {
        ...data,
        files: new Map(data.files),
        functions: new Map(data.functions),
        classes: new Map(data.classes),
        symbols: new Map(data.symbols),
        dependencies: {
          nodes: new Set(data.dependencies.nodes),
          edges: new Map(data.dependencies.edges.map(([k, v]: [string, string[]]) => [k, new Set(v)])),
          reverseEdges: new Map(data.dependencies.reverseEdges.map(([k, v]: [string, string[]]) => [k, new Set(v)])),
        },
        metadata: {
          ...data.metadata,
          languages: new Map(data.metadata.languages),
          complexity: {
            ...data.metadata.complexity,
            distribution: new Map(data.metadata.complexity.distribution),
          },
        },
        lastUpdated: new Date(data.lastUpdated),
      };

      return index;
    } catch (error) {
      console.warn('Failed to load index:', error);
      return null;
    }
  }

  /**
   * Get cache directory path
   */
  private getCacheDir(): string {
    const baseCacheDir = configManager.getCacheDir();
    return path.join(baseCacheDir, this.repoId);
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    const cacheDir = this.getCacheDir();
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
    this.parsedFilesCache.clear();
  }
}
