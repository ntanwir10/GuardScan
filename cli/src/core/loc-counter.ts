import * as fs from 'fs';
import * as path from 'path';
import {expand} from '@isaacs/brace-expansion';
import globParent from 'glob-parent';
import {glob, isDynamicPattern} from 'tinyglobby';
import ignore from 'ignore';

const LOC_IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
]);
const LOC_DISCOVERY_IGNORES = [...LOC_IGNORED_DIRECTORIES].map(name => `**/${name}/**`);
const MAX_GLOB_PATTERN_EXPANSIONS = 10_000;
const MAX_GLOB_PATTERN_BRACE_DEPTH = 64;
const MAX_GLOB_PATTERN_BRACES = 64;
const MAX_GLOB_PATTERN_LENGTH = 16_384;
const MAX_GLOB_EXPANSION_WORK_BYTES = 8 * 1024 * 1024;

function expandGlobPattern(pattern: string): string[] {
  if (pattern.length > MAX_GLOB_PATTERN_LENGTH) {
    throw new Error(`Glob pattern length exceeds ${MAX_GLOB_PATTERN_LENGTH}`);
  }
  const braceStarts: number[] = [];
  const rangeSizes: number[] = [];
  let braceCount = 0;
  for (let index = 0; index < pattern.length; index++) {
    if (pattern[index] === '\\') {
      index++;
      continue;
    }
    if (pattern[index] === '{') {
      braceStarts.push(index);
      if (braceStarts.length > MAX_GLOB_PATTERN_BRACE_DEPTH) {
        throw new Error(`Glob pattern exceeds the maximum brace nesting depth of ${MAX_GLOB_PATTERN_BRACE_DEPTH}`);
      }
      if (++braceCount > MAX_GLOB_PATTERN_BRACES) {
        throw new Error(`Glob pattern exceeds the maximum brace count of ${MAX_GLOB_PATTERN_BRACES}`);
      }
    } else if (pattern[index] === '}' && braceStarts.length > 0) {
      const startIndex = braceStarts.pop()!;
      const range = pattern.slice(startIndex + 1, index)
        .match(/^(-?\d+|[a-zA-Z])\.\.(-?\d+|[a-zA-Z])(?:\.\.(-?\d+))?$/);
      if (!range) {continue;}
      const numeric = /^-?\d+$/.test(range[1]) && /^-?\d+$/.test(range[2]);
      const alphabetic = /^[a-zA-Z]$/.test(range[1]) && /^[a-zA-Z]$/.test(range[2]);
      if (!numeric && !alphabetic) {continue;}
      const start = numeric ? Number(range[1]) : range[1].charCodeAt(0);
      const end = numeric ? Number(range[2]) : range[2].charCodeAt(0);
      const step = range[3] === undefined ? 1 : Math.abs(Number(range[3]));
      if (step === 0) {throw new Error('Glob sequence step must be nonzero');}
      const distance = Math.abs(end - start);
      if (![start, end, step, distance].every(Number.isSafeInteger)) {
        throw new Error('Glob sequence values must be safe integers');
      }
      rangeSizes.push(Math.floor(distance / step) + 1);
    }
  }

  // Preserve escaped glob syntax: the expansion library otherwise unescapes it
  // before the glob matcher sees it (for example, a literal \{a,b\} directory).
  let escapePrefix = '__GUARDSCAN_GLOB_ESCAPE_';
  while (pattern.includes(escapePrefix)) {escapePrefix += '_';}
  const escapes: string[] = [];
  const protectedPattern = pattern.replace(/\\./g, value => {
    escapes.push(value);
    return `${escapePrefix}${escapes.length - 1}__`;
  });
  // The library's max caps final output only, not range allocations or recursive
  // intermediate arrays. Bound those paths before invoking it as well.
  const expansionLimit = Math.max(1, Math.min(MAX_GLOB_PATTERN_EXPANSIONS,
    Math.floor(MAX_GLOB_EXPANSION_WORK_BYTES /
      (Math.max(1, protectedPattern.length) * Math.max(1, braceCount) ** 2))));
  if (rangeSizes.some(size => size > expansionLimit)) {
    throw new Error(`Glob range expansion exceeds the bounded count of ${expansionLimit}`);
  }
  const expansions = expand(protectedPattern, {max: expansionLimit + 1});
  if (expansions.length > expansionLimit) {
    throw new Error(`Glob pattern exceeds the bounded expansion count of ${expansionLimit}`);
  }
  const escapePattern = new RegExp(`${escapePrefix}(\\d+)__`, 'g');
  return expansions.map(value => value.replace(escapePattern, (_token, index: string) => escapes[Number(index)]));
}

function isWithinDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function hasVirtualEnvironmentMarker(directory: string): boolean {
  try {
    return fs.statSync(path.join(directory, 'pyvenv.cfg')).isFile();
  } catch {
    return false;
  }
}

function discoverVirtualEnvironmentRoots(cwd: string, patterns: string[], expandedPatterns: string[]): string[] {
  const roots = new Set<string>();
  const positivePatterns = patterns.filter(pattern => !pattern.startsWith('!') || pattern.startsWith('!('));
  const targeted = positivePatterns.every(pattern => !isDynamicPattern(pattern));
  const bases = new Set(expandedPatterns
    .filter(pattern => !pattern.startsWith('!') || pattern.startsWith('!('))
    .map(pattern => path.resolve(cwd, globParent(pattern))));

  const findAncestor = (start: string): string | undefined => {
    let current = start;
    while (isWithinDirectory(cwd, current)) {
      if (hasVirtualEnvironmentMarker(current)) {return current;}
      if (current === cwd) {break;}
      const parent = path.dirname(current);
      if (parent === current) {break;}
      current = parent;
    }
    return undefined;
  };

  const visit = (directory: string): void => {
    if (hasVirtualEnvironmentMarker(directory)) {
      roots.add(directory);
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || LOC_IGNORED_DIRECTORIES.has(entry.name)) {continue;}
      visit(path.join(directory, entry.name));
    }
  };

  for (const base of bases) {
    if (!isWithinDirectory(cwd, base)) {continue;}
    const ancestor = findAncestor(base);
    if (ancestor) {
      roots.add(ancestor);
    } else if (!targeted) {
      visit(base);
    }
  }
  return [...roots];
}

export interface LOCResult {
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  fileCount: number;
  fileBreakdown: FileStats[];
  /** Files matched by discovery but omitted because their content could not be read. */
  skippedFiles: string[];
}

export interface FileStats {
  path: string;
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  language: string;
}

export class LOCCounter {
  private ignoreMatcher: ReturnType<typeof ignore>;

  constructor() {
    this.ignoreMatcher = ignore();
    this.loadIgnorePatterns();
  }

  /**
   * Load .gitignore and default ignore patterns
   */
  private loadIgnorePatterns(): void {
    const defaultIgnores = [
      ...LOC_DISCOVERY_IGNORES,
      '*.min.js',
      '*.min.css',
      '*.map',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      '.DS_Store',
      '*.log',
      '.env*',
      '*.tgz',
      '*.zip',
      '*.tar.gz',
    ];

    this.ignoreMatcher.add(defaultIgnores);

    // Load .gitignore if exists
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      const patterns = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      this.ignoreMatcher.add(patterns);
    }
  }

  /**
   * Count LOC for the entire repository or specific files
   */
  async count(patterns?: string[]): Promise<LOCResult> {
    const files = await this.getFiles(patterns);
    const fileStats: FileStats[] = [];
    const skippedFiles: string[] = [];

    for (const file of files) {
      const stats = this.countFile(file);
      if (stats) {
        fileStats.push(stats);
      } else {
        skippedFiles.push(file);
      }
    }

    const result: LOCResult = {
      totalLines: 0,
      codeLines: 0,
      commentLines: 0,
      blankLines: 0,
      fileCount: fileStats.length,
      fileBreakdown: fileStats,
      skippedFiles,
    };

    for (const stats of fileStats) {
      result.totalLines += stats.totalLines;
      result.codeLines += stats.codeLines;
      result.commentLines += stats.commentLines;
      result.blankLines += stats.blankLines;
    }

    return result;
  }

  /**
   * Get list of files to analyze
   */
  private async getFiles(patterns?: string[]): Promise<string[]> {
    const defaultPatterns = [
      '**/*.{js,jsx,ts,tsx,py,java,go,rs,c,cpp,h,hpp,cs,rb,php,swift,kt,scala,sh,bash}',
    ];

    const cwd = process.cwd();
    const globPatterns = patterns || defaultPatterns;
    const expandedPatterns = globPatterns.flatMap(expandGlobPattern);
    const virtualEnvironmentRoots = discoverVirtualEnvironmentRoots(cwd, globPatterns, expandedPatterns);
    const virtualEnvironmentIgnores = virtualEnvironmentRoots.map(environment => {
      const directory = path.relative(cwd, environment).split(path.sep).join('/');
      return directory === '' ? '**/*' : `${directory}/**`;
    });
    const files = await glob(expandedPatterns, {
      cwd,
      absolute: true, // Get absolute paths first
      dot: true,
      expandDirectories: false,
      followSymbolicLinks: false,
      ignore: [...LOC_DISCOVERY_IGNORES, ...virtualEnvironmentIgnores],
    });

    // Convert to relative paths and filter using ignore patterns
    return files
      .filter(file => !virtualEnvironmentRoots.some(environment => {
        return isWithinDirectory(environment, file);
      }))
      .map(file => path.relative(cwd, file))
      .filter(file => !this.ignoreMatcher.ignores(file));
  }

  /**
   * Count LOC for a single file
   */
  private countFile(filePath: string): FileStats | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const language = this.detectLanguage(filePath);

      let codeLines = 0;
      let commentLines = 0;
      let blankLines = 0;
      let inBlockComment = false;

      for (let line of lines) {
        line = line.trim();

        if (line === '') {
          blankLines++;
          continue;
        }

        // Detect comments based on language
        const commentInfo = this.isComment(line, language, inBlockComment);

        if (commentInfo.isComment) {
          commentLines++;
          inBlockComment = commentInfo.inBlockComment;
        } else {
          codeLines++;
          inBlockComment = commentInfo.inBlockComment;
        }
      }

      return {
        path: filePath,
        totalLines: lines.length,
        codeLines,
        commentLines,
        blankLines,
        language,
      };
    } catch (error) {
      // Skip files that can't be read
      return null;
    }
  }

  /**
   * Detect programming language from file extension
   */
  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.py': 'Python',
      '.java': 'Java',
      '.go': 'Go',
      '.rs': 'Rust',
      '.c': 'C',
      '.cpp': 'C++',
      '.h': 'C/C++',
      '.hpp': 'C++',
      '.cs': 'C#',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.swift': 'Swift',
      '.kt': 'Kotlin',
      '.scala': 'Scala',
      '.sh': 'Shell',
      '.bash': 'Shell',
    };

    return languageMap[ext] || 'Unknown';
  }

  /**
   * Check if a line is a comment
   */
  private isComment(
    line: string,
    language: string,
    inBlockComment: boolean
  ): { isComment: boolean; inBlockComment: boolean } {
    // C-style comments (JS, TS, Java, C, C++, Go, Rust, etc.)
    if (['JavaScript', 'TypeScript', 'Java', 'C', 'C++', 'Go', 'Rust', 'C#', 'Swift', 'Kotlin', 'Scala'].includes(language)) {
      if (inBlockComment) {
        if (line.includes('*/')) {
          return { isComment: true, inBlockComment: false };
        }
        return { isComment: true, inBlockComment: true };
      }

      if (line.startsWith('//')) {
        return { isComment: true, inBlockComment: false };
      }

      if (line.startsWith('/*')) {
        if (line.includes('*/')) {
          return { isComment: true, inBlockComment: false };
        }
        return { isComment: true, inBlockComment: true };
      }
    }

    // Python comments
    if (language === 'Python') {
      if (line.startsWith('#')) {
        return { isComment: true, inBlockComment: false };
      }
      if (line.startsWith('"""') || line.startsWith("'''")) {
        if (inBlockComment) {
          return { isComment: true, inBlockComment: false };
        }
        return { isComment: true, inBlockComment: true };
      }
      if (inBlockComment) {
        return { isComment: true, inBlockComment: true };
      }
    }

    // Ruby comments
    if (language === 'Ruby') {
      if (line.startsWith('#')) {
        return { isComment: true, inBlockComment: false };
      }
    }

    // Shell comments
    if (language === 'Shell') {
      if (line.startsWith('#')) {
        return { isComment: true, inBlockComment: false };
      }
    }

    return { isComment: false, inBlockComment };
  }
}

export const locCounter = new LOCCounter();
