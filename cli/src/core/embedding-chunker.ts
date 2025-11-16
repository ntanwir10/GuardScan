/**
 * embedding-chunker.ts - Hierarchical Code Chunking for Embeddings
 *
 * Purpose: Break codebase into semantic chunks optimized for embedding generation.
 * Strategy: Hierarchical chunking - functions → classes → files → documentation
 */

import * as fs from 'fs';
import * as path from 'path';
import { CodebaseIndexer, CodebaseIndex } from './codebase-indexer';
import { ParsedFunction, ParsedClass } from './ast-parser';
import { CodeChunk, EmbeddingMetadata, hashContent } from './embeddings';

export interface ChunkingOptions {
  maxFunctionSize?: number;      // Max chars for function chunks (default: 2000)
  maxClassSize?: number;          // Max chars for class chunks (default: 5000)
  maxFileSize?: number;           // Max file size to embed whole (default: 1000 chars)
  includeDocumentation?: boolean; // Include README, docs (default: true)
  includeComments?: boolean;      // Include standalone comments (default: true)
  minComplexity?: number;         // Min complexity to include (default: 0)
}

export interface ChunkingStats {
  totalChunks: number;
  functionChunks: number;
  classChunks: number;
  fileChunks: number;
  documentationChunks: number;
  commentChunks: number;
  totalCharacters: number;
  estimatedTokens: number;
}

export class EmbeddingChunker {
  constructor(
    private indexer: CodebaseIndexer,
    private repoRoot: string
  ) {}

  /**
   * Break codebase into semantic chunks for embedding
   */
  async chunkCodebase(
    index: CodebaseIndex,
    options: ChunkingOptions = {}
  ): Promise<{
    chunks: CodeChunk[];
    stats: ChunkingStats;
  }> {
    const opts = this.normalizeOptions(options);
    const chunks: CodeChunk[] = [];
    const stats: ChunkingStats = {
      totalChunks: 0,
      functionChunks: 0,
      classChunks: 0,
      fileChunks: 0,
      documentationChunks: 0,
      commentChunks: 0,
      totalCharacters: 0,
      estimatedTokens: 0,
    };

    // 1. Function-level chunks (highest priority)
    console.log('Chunking functions...');
    const functionChunks = await this.chunkFunctions(index, opts);
    chunks.push(...functionChunks);
    stats.functionChunks = functionChunks.length;

    // 2. Class-level chunks
    console.log('Chunking classes...');
    const classChunks = await this.chunkClasses(index, opts);
    chunks.push(...classChunks);
    stats.classChunks = classChunks.length;

    // 3. File-level chunks (small files only)
    console.log('Chunking files...');
    const fileChunks = await this.chunkFiles(index, opts);
    chunks.push(...fileChunks);
    stats.fileChunks = fileChunks.length;

    // 4. Documentation chunks
    if (opts.includeDocumentation) {
      console.log('Chunking documentation...');
      const docChunks = await this.chunkDocumentation();
      chunks.push(...docChunks);
      stats.documentationChunks = docChunks.length;
    }

    // Calculate stats
    stats.totalChunks = chunks.length;
    stats.totalCharacters = chunks.reduce((sum, c) => sum + c.content.length, 0);
    stats.estimatedTokens = Math.ceil(stats.totalCharacters / 4); // Rough estimate

    return { chunks, stats };
  }

  /**
   * Chunk functions from codebase
   */
  private async chunkFunctions(
    index: CodebaseIndex,
    options: ChunkingOptions
  ): Promise<CodeChunk[]> {
    const chunks: CodeChunk[] = [];

    for (const [funcId, func] of index.functions) {
      // Skip if complexity too low
      if (options.minComplexity && func.complexity < options.minComplexity) {
        continue;
      }

      const content = this.formatFunctionForEmbedding(func);

      // Skip if too large
      if (content.length > options.maxFunctionSize!) {
        continue;
      }

      const language = this.detectLanguage(func.file);

      chunks.push({
        type: 'function',
        content,
        metadata: {
          language,
          symbolName: func.name,
          complexity: func.complexity,
          dependencies: func.dependencies,
          exports: func.isExported ? [func.name] : [],
          tags: this.generateTags(func),
          lastModified: await this.getFileModificationTime(func.file),
        },
        source: func.file,
        startLine: func.line,
        endLine: func.endLine,
      });
    }

    return chunks;
  }

  /**
   * Chunk classes from codebase
   */
  private async chunkClasses(
    index: CodebaseIndex,
    options: ChunkingOptions
  ): Promise<CodeChunk[]> {
    const chunks: CodeChunk[] = [];

    for (const [classId, cls] of index.classes) {
      const content = this.formatClassForEmbedding(cls);

      // Skip if too large
      if (content.length > options.maxClassSize!) {
        continue;
      }

      const language = this.detectLanguage(cls.file);

      chunks.push({
        type: 'class',
        content,
        metadata: {
          language,
          symbolName: cls.name,
          complexity: cls.methods.reduce((sum, m) => sum + (m.complexity || 0), 0),
          dependencies: [],
          exports: cls.isExported ? [cls.name] : [],
          tags: this.generateClassTags(cls),
          lastModified: await this.getFileModificationTime(cls.file),
        },
        source: cls.file,
        startLine: cls.line,
        endLine: cls.endLine,
      });
    }

    return chunks;
  }

  /**
   * Chunk small files
   */
  private async chunkFiles(
    index: CodebaseIndex,
    options: ChunkingOptions
  ): Promise<CodeChunk[]> {
    const chunks: CodeChunk[] = [];

    for (const [filePath, fileIndex] of index.files) {
      // Skip large files
      if (fileIndex.loc > options.maxFileSize! / 10) {
        // Rough estimate: 10 chars per LOC
        continue;
      }

      // Skip if file already chunked at function/class level
      const hasFunctionChunks = Array.from(index.functions.values()).some(
        f => f.file === filePath
      );
      const hasClassChunks = Array.from(index.classes.values()).some(
        c => c.file === filePath
      );

      if (hasFunctionChunks || hasClassChunks) {
        continue;
      }

      try {
        const fullPath = path.join(this.repoRoot, filePath);
        const content = await fs.promises.readFile(fullPath, 'utf-8');

        // Skip if still too large
        if (content.length > options.maxFileSize!) {
          continue;
        }

        const formattedContent = this.formatFileForEmbedding(filePath, content);

        chunks.push({
          type: 'file',
          content: formattedContent,
          metadata: {
            language: fileIndex.language,
            dependencies: fileIndex.imports,
            exports: fileIndex.exports,
            tags: this.generateFileTags(filePath, content),
            lastModified: await this.getFileModificationTime(filePath),
          },
          source: filePath,
          startLine: 1,
          endLine: content.split('\n').length,
        });
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }

    return chunks;
  }

  /**
   * Chunk documentation files (README, CONTRIBUTING, etc.)
   */
  private async chunkDocumentation(): Promise<CodeChunk[]> {
    const chunks: CodeChunk[] = [];
    const docPatterns = [
      'README.md',
      'CONTRIBUTING.md',
      'ARCHITECTURE.md',
      'API.md',
      'CHANGELOG.md',
      'docs/**/*.md',
    ];

    for (const pattern of docPatterns) {
      try {
        const docPath = path.join(this.repoRoot, pattern);

        if (fs.existsSync(docPath) && fs.statSync(docPath).isFile()) {
          const content = await fs.promises.readFile(docPath, 'utf-8');
          const formattedContent = this.formatDocumentationForEmbedding(
            pattern,
            content
          );

          chunks.push({
            type: 'documentation',
            content: formattedContent,
            metadata: {
              language: 'markdown',
              dependencies: [],
              exports: [],
              tags: ['documentation', this.inferDocType(pattern)],
              lastModified: await this.getFileModificationTime(pattern),
            },
            source: pattern,
          });
        }
      } catch (error) {
        // Skip docs that can't be read
        continue;
      }
    }

    return chunks;
  }

  // ========================================================================
  // Formatting Functions
  // ========================================================================

  /**
   * Format function with context for better embeddings
   */
  private formatFunctionForEmbedding(func: ParsedFunction): string {
    const parts: string[] = [];

    // File context
    parts.push(`// File: ${func.file}`);
    parts.push(`// Function: ${func.name}`);

    // Documentation
    if (func.documentation) {
      parts.push(`// Description: ${func.documentation}`);
    }

    // Signature
    const signature = this.formatFunctionSignature(func);
    parts.push(signature);

    // Dependencies context
    if (func.dependencies && func.dependencies.length > 0) {
      parts.push(`// Dependencies: ${func.dependencies.join(', ')}`);
    }

    // Body (truncated if too long)
    const body = func.body || '';
    const maxBodyLength = 1500;
    const truncatedBody =
      body.length > maxBodyLength
        ? body.slice(0, maxBodyLength) + '\n  // ... (truncated)'
        : body;

    parts.push(truncatedBody);

    return parts.join('\n');
  }

  /**
   * Format class with context
   */
  private formatClassForEmbedding(cls: ParsedClass): string {
    const parts: string[] = [];

    // File context
    parts.push(`// File: ${cls.file}`);
    parts.push(`// Class: ${cls.name}`);

    // Documentation
    if (cls.documentation) {
      parts.push(`// Description: ${cls.documentation}`);
    }

    // Class signature
    parts.push(`class ${cls.name} {`);

    // Properties
    if (cls.properties && cls.properties.length > 0) {
      parts.push('  // Properties:');
      cls.properties.forEach((prop: { name: string; type: string }) => {
        parts.push(`  ${prop.name}: ${prop.type || 'any'}`);
      });
    }

    // Methods (signatures only)
    if (cls.methods && cls.methods.length > 0) {
      parts.push('  // Methods:');
      cls.methods.forEach((method: ParsedFunction) => {
        const sig = this.formatFunctionSignature(method);
        parts.push(`  ${sig}`);
      });
    }

    parts.push('}');

    return parts.join('\n');
  }

  /**
   * Format file for embedding
   */
  private formatFileForEmbedding(filePath: string, content: string): string {
    return `// File: ${filePath}\n\n${content}`;
  }

  /**
   * Format documentation for embedding
   */
  private formatDocumentationForEmbedding(
    docPath: string,
    content: string
  ): string {
    return `# Documentation: ${docPath}\n\n${content}`;
  }

  /**
   * Format function signature
   */
  private formatFunctionSignature(func: ParsedFunction): string {
    const params = func.parameters
      ? func.parameters.map((p: { name: string; type: string }) => `${p.name}: ${p.type || 'any'}`).join(', ')
      : '';

    const asyncPrefix = func.isAsync ? 'async ' : '';
    const returnType = func.returnType || 'void';

    return `${asyncPrefix}function ${func.name}(${params}): ${returnType}`;
  }

  // ========================================================================
  // Tag Generation
  // ========================================================================

  /**
   * Generate semantic tags for a function
   */
  private generateTags(func: ParsedFunction): string[] {
    const tags: string[] = [];

    // Add based on name patterns
    const name = func.name.toLowerCase();

    if (name.includes('auth') || name.includes('login')) tags.push('authentication');
    if (name.includes('db') || name.includes('database')) tags.push('database');
    if (name.includes('api') || name.includes('fetch')) tags.push('api');
    if (name.includes('test')) tags.push('test');
    if (name.includes('util') || name.includes('helper')) tags.push('utility');
    if (name.includes('validate') || name.includes('check')) tags.push('validation');
    if (name.includes('encrypt') || name.includes('decrypt')) tags.push('security');
    if (name.includes('parse') || name.includes('format')) tags.push('parsing');

    // Add based on complexity
    if (func.complexity > 10) tags.push('complex');
    if (func.complexity <= 3) tags.push('simple');

    // Add based on async
    if (func.isAsync) tags.push('async');

    return tags;
  }

  /**
   * Generate tags for a class
   */
  private generateClassTags(cls: ParsedClass): string[] {
    const tags: string[] = [];
    const name = cls.name.toLowerCase();

    if (name.includes('service')) tags.push('service');
    if (name.includes('controller')) tags.push('controller');
    if (name.includes('model')) tags.push('model');
    if (name.includes('util') || name.includes('helper')) tags.push('utility');
    if (name.includes('test')) tags.push('test');
    if (name.includes('manager')) tags.push('manager');
    if (name.includes('provider')) tags.push('provider');
    if (name.includes('handler')) tags.push('handler');

    return tags;
  }

  /**
   * Generate tags for a file
   */
  private generateFileTags(filePath: string, content: string): string[] {
    const tags: string[] = [];

    if (filePath.includes('test')) tags.push('test');
    if (filePath.includes('config')) tags.push('configuration');
    if (filePath.includes('util')) tags.push('utility');
    if (filePath.includes('types') || filePath.includes('.d.ts')) tags.push('types');
    if (filePath.includes('constant')) tags.push('constants');

    // Content-based tags
    if (content.includes('import') || content.includes('require')) tags.push('module');

    return tags;
  }

  /**
   * Infer documentation type from path
   */
  private inferDocType(docPath: string): string {
    if (docPath.includes('README')) return 'readme';
    if (docPath.includes('CONTRIBUTING')) return 'contributing';
    if (docPath.includes('ARCHITECTURE')) return 'architecture';
    if (docPath.includes('API')) return 'api';
    if (docPath.includes('CHANGELOG')) return 'changelog';
    return 'general';
  }

  // ========================================================================
  // Utility Functions
  // ========================================================================

  /**
   * Detect programming language from file path
   */
  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.rb': 'ruby',
      '.php': 'php',
      '.cs': 'csharp',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Get file modification time
   */
  private async getFileModificationTime(filePath: string): Promise<Date> {
    try {
      const fullPath = path.join(this.repoRoot, filePath);
      const stats = await fs.promises.stat(fullPath);
      return stats.mtime;
    } catch (error) {
      return new Date();
    }
  }

  /**
   * Normalize chunking options with defaults
   */
  private normalizeOptions(options: ChunkingOptions): Required<ChunkingOptions> {
    return {
      maxFunctionSize: options.maxFunctionSize || 2000,
      maxClassSize: options.maxClassSize || 5000,
      maxFileSize: options.maxFileSize || 1000,
      includeDocumentation: options.includeDocumentation !== false,
      includeComments: options.includeComments !== false,
      minComplexity: options.minComplexity || 0,
    };
  }
}
