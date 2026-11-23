import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { analyzeSource, findSourceFiles, languageOf, SourceAnalysis } from './source-analysis';

export interface CodeSmell {
  type: string;
  file: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
  details?: any;
}

const KEYWORD_START = /^(?:if|elif|elsif|else|for|foreach|while|switch|case|catch|try|def|class|function|func|fn|return|throw|raise|import|from|const|let|var|print|puts|echo|console\.\w+|require|include|package|using|public|private|protected|static|end)\b/;

/** Does comment text look like source code that was commented out? Bounded, anchored checks only. */
function looksLikeCode(text: string): boolean {
  if (text === '' || text.length > 400 || text.startsWith('@')) {
    return false;
  }
  if (/[;{}]$/.test(text)) {
    return true;
  }
  if (KEYWORD_START.test(text) && /[;{}=]|\w\(|:\s|[:)]$/.test(text)) {
    return true;
  }
  return /^[\w.$]+(?:\[[^\]]*\])?\s*[+\-*/|&]?=(?!=)\s*\S/.test(text) || /^[\w.$]+\([^)]*\)\s*;?$/.test(text);
}

/** Push in a loop: spreading a very large array into push() overflows the call stack. */
function append<T>(target: T[], items: T[]): void {
  for (const item of items) {
    target.push(item);
  }
}

export class CodeSmellDetector {
  /**
   * Detect code smells in repository
   */
  async detect(repoPath: string = process.cwd()): Promise<CodeSmell[]> {
    const smells: CodeSmell[] = [];
    const files = findSourceFiles(repoPath, ['node_modules', '.git', 'vendor', 'dist'], name => languageOf(name) !== undefined);

    // Analyze every file once; both duplicate and per-file rules read the same result.
    const analyses = new Map<string, SourceAnalysis>();
    for (const file of files) {
      try {
        const analysis = analyzeSource(fs.readFileSync(file, 'utf-8'), file);
        if (analysis) {
          analyses.set(file, analysis);
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Detect duplicates across files
    append(smells, this.detectDuplicateCode(analyses));

    // Detect smells in individual files
    for (const [file, analysis] of analyses) {
      append(smells, this.detectDeadCode(file, analysis));
      append(smells, this.detectGodObjects(file, analysis));
      append(smells, this.detectLongParameterList(file, analysis));
      append(smells, this.detectMagicNumbers(file, analysis));
      append(smells, this.detectCommentedCode(file, analysis));
      append(smells, this.detectEmptyCatchBlocks(file, analysis));
      append(smells, this.detectTooManyReturns(file, analysis));
    }

    // Detect circular dependencies (needs multiple files)
    append(smells, this.detectCircularDependencies(repoPath, analyses));

    return smells;
  }

  /**
   * Detect duplicate code blocks
   * Uses hash-based similarity detection on comment-free text
   */
  private detectDuplicateCode(analyses: Map<string, SourceAnalysis>): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const blockHashes = new Map<string, Array<{ file: string; line: number }>>();

    for (const [file, analysis] of analyses) {
      for (const block of this.extractCodeBlocks(analysis.noComments)) {
        const normalized = block.code.replace(/\s+/g, ' ').trim();
        if (normalized.length < 100) {continue;} // Skip small blocks

        const hash = crypto.createHash('md5').update(normalized).digest('hex');
        const list = blockHashes.get(hash);
        if (list) {
          list.push({ file, line: block.startLine });
        } else {
          blockHashes.set(hash, [{ file, line: block.startLine }]);
        }
      }
    }

    for (const instances of blockHashes.values()) {
      if (instances.length > 1) {
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
   * Extract 10-line sliding-window blocks, ignoring blocks that are mostly blank (comments are already blanked)
   */
  private extractCodeBlocks(content: string): Array<{ code: string; startLine: number }> {
    const blocks: Array<{ code: string; startLine: number }> = [];
    const lines = content.split('\n');
    const BLOCK_SIZE = 10;
    for (let i = 0; i < lines.length - BLOCK_SIZE; i++) {
      const blockLines = lines.slice(i, i + BLOCK_SIZE);
      if (blockLines.filter(l => l.trim() !== '').length >= BLOCK_SIZE / 2) {
        blocks.push({ code: blockLines.join('\n'), startLine: i + 1 });
      }
    }
    return blocks;
  }

  /**
   * Detect dead code (unreachable statements, unused local variables)
   */
  private detectDeadCode(file: string, analysis: SourceAnalysis): CodeSmell[] {
    const smells: CodeSmell[] = [];

    for (const line of analysis.unreachableLines) {
      smells.push({
        type: 'Unreachable Code',
        file,
        line,
        severity: 'medium',
        description: 'Code after return/throw statement is unreachable',
        recommendation: 'Remove unreachable code',
      });
    }

    for (const variable of analysis.unusedVariables) {
      smells.push({
        type: 'Unused Variable',
        file,
        line: variable.line,
        severity: 'low',
        description: `Variable "${variable.name}" is declared but never used`,
        recommendation: 'Remove unused variable or use it',
      });
    }

    return smells.sort((a, b) => a.line - b.line);
  }

  /**
   * Detect god objects (classes with too many responsibilities)
   */
  private detectGodObjects(file: string, analysis: SourceAnalysis): CodeSmell[] {
    return analysis.classes
      .filter(c => c.methodCount > 15 || c.fieldCount > 10)
      .map(c => ({
        type: 'God Object',
        file,
        line: c.line,
        severity: 'high' as const,
        description: `Class "${c.name}" has too many responsibilities (${c.methodCount} methods, ${c.fieldCount} fields)`,
        recommendation: 'Break down into smaller, focused classes following Single Responsibility Principle',
        details: { methodCount: c.methodCount, fieldCount: c.fieldCount },
      }));
  }

  /**
   * Detect long parameter lists
   */
  private detectLongParameterList(file: string, analysis: SourceAnalysis): CodeSmell[] {
    return analysis.functions
      .filter(f => f.paramCount > 5)
      .map(f => ({
        type: 'Long Parameter List',
        file,
        line: f.startLine,
        severity: f.paramCount > 8 ? ('high' as const) : ('medium' as const),
        description: `Function has ${f.paramCount} parameters`,
        recommendation: 'Consider using parameter object or builder pattern',
        details: { parameterCount: f.paramCount },
      }));
  }

  /**
   * Detect magic numbers (literals only: comments and strings are excluded)
   */
  private detectMagicNumbers(file: string, analysis: SourceAnalysis): CodeSmell[] {
    return analysis.magicNumbers.map(n => ({
      type: 'Magic Number',
      file,
      line: n.line,
      severity: 'low' as const,
      description: `Magic number "${n.value}" should be extracted to a named constant`,
      recommendation: 'Define as a named constant to improve readability',
    }));
  }

  /**
   * Detect commented-out code (looks at comment text only)
   */
  private detectCommentedCode(file: string, analysis: SourceAnalysis): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const lines = analysis.comments.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === '') {continue;}

      const text = trimmed.replace(/^(?:\/\/+|#+|\/\*+|\*+\/?)\s*/, '').replace(/\s*\*\/$/, '');
      if (looksLikeCode(text)) {
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

    return smells;
  }

  /**
   * Detect empty catch blocks (a block holding only a comment is treated as intentional)
   */
  private detectEmptyCatchBlocks(file: string, analysis: SourceAnalysis): CodeSmell[] {
    return analysis.emptyCatchLines.map(line => ({
      type: 'Empty Catch Block',
      file,
      line,
      severity: 'high' as const,
      description: 'Empty catch block swallows errors silently',
      recommendation: 'Handle errors appropriately or at least log them',
    }));
  }

  /**
   * Detect functions with too many return statements
   */
  private detectTooManyReturns(file: string, analysis: SourceAnalysis): CodeSmell[] {
    return analysis.functions
      .filter(f => f.returnCount > 5)
      .map(f => ({
        type: 'Too Many Returns',
        file,
        line: f.startLine,
        severity: 'medium' as const,
        description: `Function "${f.name}" has ${f.returnCount} return statements`,
        recommendation: 'Simplify control flow to reduce number of exit points',
        details: { returnCount: f.returnCount },
      }));
  }

  /**
   * Resolve an import specifier to one of the scanned files (relative imports, with or without extension)
   */
  private resolveImport(from: string, spec: string, repoPath: string, known: Set<string>): string | undefined {
    const language = languageOf(from);
    const bases: string[] = [];
    if (spec.startsWith('.')) {
      bases.push(path.resolve(path.dirname(from), spec));
    } else if (language === 'python') {
      bases.push(path.resolve(path.dirname(from), spec), path.resolve(repoPath, spec));
    } else {
      return undefined;
    }
    const exts = ['', '.js', '.ts', '.py', '.rb', '.php', '.go', '.java', '.cs', '.c', '.cpp'];
    for (const base of bases) {
      const candidates = [base, ...exts.slice(1).map(e => base + e), ...exts.slice(1).map(e => path.join(base, `index${e}`)), path.join(base, '__init__.py')];
      const swapped = base.replace(/\.(?:m|c)?jsx?$/, '');
      if (swapped !== base) {
        candidates.push(`${swapped}.ts`, `${swapped}.tsx`);
      }
      const hit = candidates.find(c => known.has(c));
      if (hit) {return hit;}
    }
    return undefined;
  }

  /**
   * Detect circular dependencies between scanned files
   */
  private detectCircularDependencies(repoPath: string, analyses: Map<string, SourceAnalysis>): CodeSmell[] {
    const smells: CodeSmell[] = [];
    const known = new Set(analyses.keys());
    const imports = new Map<string, Set<string>>();

    for (const [file, analysis] of analyses) {
      const deps = new Set<string>();
      for (const spec of analysis.imports) {
        const resolved = this.resolveImport(file, spec, repoPath, known);
        if (resolved && resolved !== file) {deps.add(resolved);}
      }
      imports.set(file, deps);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    const findCycle = (file: string, trail: string[]): string[] | null => {
      visited.add(file);
      recStack.add(file);

      for (const dep of imports.get(file) || []) {
        if (!visited.has(dep)) {
          const cycle = findCycle(dep, [...trail, file]);
          if (cycle) {return cycle;}
        } else if (recStack.has(dep)) {
          const full = [...trail, file, dep];
          return full.slice(full.indexOf(dep));
        }
      }

      recStack.delete(file);
      return null;
    };

    try {
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
    } catch (error) {
      // A dependency chain deep enough to overflow the stack is reported as far as it got.
      if (!(error instanceof RangeError)) {throw error;}
    }

    return smells;
  }
}

export const codeSmellDetector = new CodeSmellDetector();
