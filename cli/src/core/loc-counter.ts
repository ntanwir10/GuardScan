import * as fs from 'fs';
import * as path from 'path';
import fastGlob from 'fast-glob';
import ignore from 'ignore';

const LOC_IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
]);
const LOC_DISCOVERY_IGNORES = [...LOC_IGNORED_DIRECTORIES].map(name => `**/${name}/**`);

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

function discoverVirtualEnvironmentRoots(cwd: string, patterns: string[]): string[] {
  const roots = new Set<string>();
  const targeted = patterns.every(pattern => !fastGlob.isDynamicPattern(pattern));
  const bases = new Set(fastGlob.generateTasks(patterns, {cwd}).map(task =>
    path.resolve(cwd, task.base)
  ));

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
    const virtualEnvironmentRoots = discoverVirtualEnvironmentRoots(cwd, globPatterns);
    const virtualEnvironmentIgnores = virtualEnvironmentRoots.map(environment => {
      const directory = path.relative(cwd, environment).split(path.sep).join('/');
      return directory === '' ? '**/*' : `${directory}/**`;
    });
    const files = await fastGlob(globPatterns, {
      cwd,
      absolute: true, // Get absolute paths first
      dot: true,
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
