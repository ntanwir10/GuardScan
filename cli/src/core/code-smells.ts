import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface CodeSmell {
  type: string;
  file: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
  details?: any;
}

export class CodeSmellDetector {
  /**
   * Detect code smells in repository
   */
  async detect(repoPath: string = process.cwd()): Promise<CodeSmell[]> {
    const smells: CodeSmell[] = [];
    const files = this.findCodeFiles(repoPath);

    // Build content map for duplicate detection
    const fileContents = new Map<string, string>();
    for (const file of files) {
      try {
        fileContents.set(file, fs.readFileSync(file, 'utf-8'));
      } catch {
        // Skip
      }
    }

    // Detect duplicates across files
    smells.push(...this.detectDuplicateCode(fileContents));

    // Detect smells in individual files
    for (const [file, content] of fileContents) {
      const language = this.detectLanguage(file);

      smells.push(...this.detectDeadCode(file, content, language));
      smells.push(...this.detectGodObjects(file, content, language));
      smells.push(...this.detectLongParameterList(file, content, language));
      smells.push(...this.detectMagicNumbers(file, content, language));
      smells.push(...this.detectCommentedCode(file, content, language));
      smells.push(...this.detectEmptyCatchBlocks(file, content, language));
      smells.push(...this.detectTooManyReturns(file, content, language));
    }

    // Detect circular dependencies (needs multiple files)
    smells.push(...this.detectCircularDependencies(fileContents));

    return smells;
  }

  /**
   * Find code files to analyze
   */
  private findCodeFiles(dir: string): string[] {
    const files: string[] = [];

    const search = (currentDir: string, depth: number) => {
      if (depth > 5) return;

      try {
        const items = fs.readdirSync(currentDir);
        for (const item of items) {
          if (item === 'node_modules' || item === '.git' || item === 'vendor' || item === 'dist') continue;

          const fullPath = path.join(currentDir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            search(fullPath, depth + 1);
          } else if (this.isCodeFile(item)) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip
      }
    };

    search(dir, 0);
    return files;
  }

  /**
   * Check if file is a code file
   */
  private isCodeFile(filename: string): boolean {
    const extensions = ['.js', '.ts', '.py', '.go', '.java', '.rb', '.php'];
    return extensions.some(ext => filename.endsWith(ext));
  }

  /**
   * Detect programming language
   */
  private detectLanguage(file: string): string {
    const ext = path.extname(file);
    const langMap: Record<string, string> = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.py': 'python',
      '.go': 'go',
      '.java': 'java',
      '.rb': 'ruby',
      '.php': 'php',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Detect duplicate code blocks
   * Uses hash-based similarity detection
   */
  private detectDuplicateCode(fileContents: Map<string, string>): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const blockHashes = new Map<string, Array<{ file: string; line: number; block: string }>>();

    // Extract code blocks and hash them
    for (const [file, content] of fileContents) {
      const blocks = this.extractCodeBlocks(content);

      for (const block of blocks) {
        // Normalize and hash the block
        const normalized = this.normalizeCode(block.code);
        if (normalized.length < 100) continue; // Skip small blocks

        const hash = crypto.createHash('md5').update(normalized).digest('hex');

        if (!blockHashes.has(hash)) {
          blockHashes.set(hash, []);
        }

        blockHashes.get(hash)!.push({
          file,
          line: block.startLine,
          block: block.code,
        });
      }
    }

    // Find duplicates
    for (const [hash, instances] of blockHashes) {
      if (instances.length > 1) {
        // Report each instance
        for (const instance of instances) {
          const others = instances.filter(i => i.file !== instance.file || i.line !== instance.line);
          smells.push({
            type: 'Duplicate Code',
            file: instance.file,
            line: instance.line,
            severity: instances.length > 3 ? 'high' : 'medium',
            description: `Code block duplicated in ${instances.length} locations`,
            recommendation: 'Extract common logic into a shared function',
            details: {
              duplicateCount: instances.length,
              otherLocations: others.map(o => `${o.file}:${o.line}`),
            },
          });
        }
      }
    }

    return smells;
  }

  /**
   * Extract code blocks from content
   */
  private extractCodeBlocks(content: string): Array<{ code: string; startLine: number }> {
    const blocks: Array<{ code: string; startLine: number }> = [];
    const lines = content.split('\n');

    // Use sliding window to extract blocks (10 lines each)
    const BLOCK_SIZE = 10;
    for (let i = 0; i < lines.length - BLOCK_SIZE; i++) {
      const blockLines = lines.slice(i, i + BLOCK_SIZE);
      const code = blockLines.join('\n');

      // Skip blocks that are mostly comments or whitespace
      const codeLines = blockLines.filter(l => {
        const trimmed = l.trim();
        return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#') && !trimmed.startsWith('*');
      });

      if (codeLines.length >= BLOCK_SIZE / 2) {
        blocks.push({ code, startLine: i + 1 });
      }
    }

    return blocks;
  }

  /**
   * Normalize code for comparison (remove whitespace, comments, variable names)
   */
  private normalizeCode(code: string): string {
    return code
      .replace(/\/\/.*$/gm, '') // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
      .replace(/#.*$/gm, '') // Remove Python comments
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Detect dead code (unused functions, variables)
   */
  private detectDeadCode(file: string, content: string, language: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = content.split('\n');

    // Simple heuristic: look for unreachable code after return/throw
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Code after return/throw (same indentation level)
      if (/^\s*(return|throw)\s+/.test(line)) {
        const indent = line.match(/^(\s*)/)?.[1].length || 0;

        // Check next few lines
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = lines[j];
          const nextIndent = nextLine.match(/^(\s*)/)?.[1].length || 0;
          const nextTrimmed = nextLine.trim();

          // Skip empty lines and closing braces
          if (!nextTrimmed || /^}/.test(nextTrimmed)) break;

          // Found code at same or greater indent level
          if (nextIndent >= indent && nextTrimmed) {
            smells.push({
              type: 'Unreachable Code',
              file,
              line: j + 1,
              severity: 'medium',
              description: 'Code after return/throw statement is unreachable',
              recommendation: 'Remove unreachable code',
            });
            break;
          }
        }
      }

      // Unused variables (very simple heuristic)
      const varMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=/);
      if (varMatch) {
        const varName = varMatch[1];
        const remainingContent = lines.slice(i + 1).join('\n');

        // Check if variable is used later (simple search)
        const usagePattern = new RegExp(`\\b${varName}\\b`, 'g');
        const usages = remainingContent.match(usagePattern);

        if (!usages || usages.length === 0) {
          smells.push({
            type: 'Unused Variable',
            file,
            line: i + 1,
            severity: 'low',
            description: `Variable "${varName}" is declared but never used`,
            recommendation: 'Remove unused variable or use it',
          });
        }
      }
    }

    return smells;
  }

  /**
   * Detect god objects (classes with too many responsibilities)
   */
  private detectGodObjects(file: string, content: string, language: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = content.split('\n');

    let classStart = -1;
    let className = '';
    let methodCount = 0;
    let fieldCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect class start
      const classMatch = line.match(/class\s+(\w+)/);
      if (classMatch) {
        // Report previous class if it was a god object
        if (classStart >= 0 && (methodCount > 15 || fieldCount > 10)) {
          smells.push({
            type: 'God Object',
            file,
            line: classStart,
            severity: 'high',
            description: `Class "${className}" has too many responsibilities (${methodCount} methods, ${fieldCount} fields)`,
            recommendation: 'Break down into smaller, focused classes following Single Responsibility Principle',
            details: { methodCount, fieldCount },
          });
        }

        // Reset for new class
        classStart = i + 1;
        className = classMatch[1];
        methodCount = 0;
        fieldCount = 0;
      }

      // Count methods
      if (classStart >= 0) {
        if (/^\s*(public|private|protected)?\s*(static)?\s*\w+\s+\w+\s*\(/.test(line) ||
            /^\s*(async\s+)?\w+\s*\([^)]*\)\s*{/.test(line)) {
          methodCount++;
        }

        // Count fields
        if (/^\s*(public|private|protected)?\s*(static)?\s*\w+\s+\w+\s*[=;]/.test(line) ||
            /^\s*this\.\w+\s*=/.test(line)) {
          fieldCount++;
        }
      }
    }

    // Check last class
    if (classStart >= 0 && (methodCount > 15 || fieldCount > 10)) {
      smells.push({
        type: 'God Object',
        file,
        line: classStart,
        severity: 'high',
        description: `Class "${className}" has too many responsibilities (${methodCount} methods, ${fieldCount} fields)`,
        recommendation: 'Break down into smaller, focused classes',
        details: { methodCount, fieldCount },
      });
    }

    return smells;
  }

  /**
   * Detect long parameter lists
   */
  private detectLongParameterList(file: string, content: string, language: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match function declarations
      const funcMatch = line.match(/function\s+(\w+)\s*\(([^)]*)\)|(\w+)\s*\(([^)]*)\)\s*[{:]/);
      if (funcMatch) {
        const params = (funcMatch[2] || funcMatch[4] || '').split(',').filter(p => p.trim());

        if (params.length > 5) {
          smells.push({
            type: 'Long Parameter List',
            file,
            line: i + 1,
            severity: params.length > 8 ? 'high' : 'medium',
            description: `Function has ${params.length} parameters`,
            recommendation: 'Consider using parameter object or builder pattern',
            details: { parameterCount: params.length },
          });
        }
      }
    }

    return smells;
  }

  /**
   * Detect magic numbers
   */
  private detectMagicNumbers(file: string, content: string, language: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Look for numeric literals (excluding common values like 0, 1, -1, 100)
      const numberPattern = /[^a-zA-Z_](\d{2,}|\d+\.\d+)[^a-zA-Z_]/g;
      const matches = [...line.matchAll(numberPattern)];

      for (const match of matches) {
        const number = match[1];

        // Skip common/safe numbers
        if (['0', '1', '-1', '100', '1000'].includes(number)) continue;
        if (number.startsWith('0x')) continue; // Hex literals
        if (/const|final|readonly/.test(line)) continue; // Already a constant

        smells.push({
          type: 'Magic Number',
          file,
          line: i + 1,
          severity: 'low',
          description: `Magic number "${number}" should be extracted to a named constant`,
          recommendation: 'Define as a named constant to improve readability',
        });
      }
    }

    return smells;
  }

  /**
   * Detect commented-out code
   */
  private detectCommentedCode(file: string, content: string, language: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check if line is a comment
      if (/^(\/\/|#|\*)/.test(trimmed)) {
        // Remove comment markers
        const commentContent = trimmed.replace(/^(\/\/|#|\*)\s*/, '');

        // Check if it looks like code (has keywords, braces, semicolons)
        const codeIndicators = [
          /\bfunction\b/, /\bif\b/, /\bfor\b/, /\bwhile\b/, /\bclass\b/,
          /[{};]/, /\breturn\b/, /\bconst\b/, /\blet\b/, /\bvar\b/,
        ];

        if (codeIndicators.some(pattern => pattern.test(commentContent))) {
          smells.push({
            type: 'Commented-Out Code',
            file,
            line: i + 1,
            severity: 'low',
            description: 'Commented-out code should be removed',
            recommendation: 'Use version control instead of commenting out code',
          });
        }
      }
    }

    return smells;
  }

  /**
   * Detect empty catch blocks
   */
  private detectEmptyCatchBlocks(file: string, content: string, language: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Look for catch blocks
      if (/catch\s*\(/.test(line)) {
        // Check if the catch block is empty or only has a closing brace
        const nextFewLines = lines.slice(i, Math.min(i + 5, lines.length)).join('\n');

        // Empty catch: catch (e) {} or catch (e) { }
        if (/catch\s*\([^)]*\)\s*{\s*}/.test(nextFewLines)) {
          smells.push({
            type: 'Empty Catch Block',
            file,
            line: i + 1,
            severity: 'high',
            description: 'Empty catch block swallows errors silently',
            recommendation: 'Handle errors appropriately or at least log them',
          });
        }
      }
    }

    return smells;
  }

  /**
   * Detect functions with too many return statements
   */
  private detectTooManyReturns(file: string, content: string, language: string): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = content.split('\n');

    let functionStart = -1;
    let functionName = '';
    let returnCount = 0;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect function start
      if (/function\s+(\w+)\s*\(|(\w+)\s*\([^)]*\)\s*{/.test(line)) {
        // Report previous function if needed
        if (functionStart >= 0 && returnCount > 5) {
          smells.push({
            type: 'Too Many Returns',
            file,
            line: functionStart,
            severity: 'medium',
            description: `Function "${functionName}" has ${returnCount} return statements`,
            recommendation: 'Simplify control flow to reduce number of exit points',
            details: { returnCount },
          });
        }

        // Start tracking new function
        const match = line.match(/function\s+(\w+)|(\w+)\s*\([^)]*\)\s*{/);
        functionName = match?.[1] || match?.[2] || 'anonymous';
        functionStart = i + 1;
        returnCount = 0;
        braceDepth = 0;
      }

      if (functionStart >= 0) {
        // Track braces to know when function ends
        braceDepth += (line.match(/{/g) || []).length;
        braceDepth -= (line.match(/}/g) || []).length;

        // Count returns
        if (/\breturn\b/.test(line)) {
          returnCount++;
        }

        // Function ended
        if (braceDepth <= 0 && i > functionStart) {
          if (returnCount > 5) {
            smells.push({
              type: 'Too Many Returns',
              file,
              line: functionStart,
              severity: 'medium',
              description: `Function "${functionName}" has ${returnCount} return statements`,
              recommendation: 'Simplify control flow',
              details: { returnCount },
            });
          }
          functionStart = -1;
        }
      }
    }

    return smells;
  }

  /**
   * Detect circular dependencies
   */
  private detectCircularDependencies(fileContents: Map<string, string>): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const imports = new Map<string, Set<string>>();

    // Build dependency graph
    for (const [file, content] of fileContents) {
      const deps = new Set<string>();

      // Extract imports/requires
      const importPatterns = [
        /import\s+.*\s+from\s+['"]([^'"]+)['"]/g,
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        /from\s+['"]([^'"]+)['"]\s+import/g, // Python
      ];

      for (const pattern of importPatterns) {
        const matches = [...content.matchAll(pattern)];
        for (const match of matches) {
          let importPath = match[1];

          // Resolve relative imports to absolute
          if (importPath.startsWith('.')) {
            importPath = path.resolve(path.dirname(file), importPath);
          }

          deps.add(importPath);
        }
      }

      imports.set(file, deps);
    }

    // Find circular dependencies using DFS
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const findCycle = (file: string, path: string[]): string[] | null => {
      visited.add(file);
      recStack.add(file);

      const deps = imports.get(file) || new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          const cycle = findCycle(dep, [...path, file]);
          if (cycle) return cycle;
        } else if (recStack.has(dep)) {
          // Found cycle
          return [...path, file, dep];
        }
      }

      recStack.delete(file);
      return null;
    };

    for (const file of imports.keys()) {
      if (!visited.has(file)) {
        const cycle = findCycle(file, []);
        if (cycle) {
          smells.push({
            type: 'Circular Dependency',
            file: cycle[0],
            line: 1,
            severity: 'high',
            description: 'Circular dependency detected',
            recommendation: 'Refactor to remove circular dependencies, consider dependency injection',
            details: { cycle },
          });
        }
      }
    }

    return smells;
  }
}

export const codeSmellDetector = new CodeSmellDetector();
