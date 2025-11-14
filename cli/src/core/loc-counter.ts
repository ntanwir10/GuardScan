import * as fs from 'fs';
import * as path from 'path';
import fastGlob from 'fast-glob';
import ignore from 'ignore';

export interface LOCResult {
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  fileCount: number;
  fileBreakdown: FileStats[];
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
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      'coverage/**',
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

    for (const file of files) {
      const stats = this.countFile(file);
      if (stats) {
        fileStats.push(stats);
      }
    }

    const result: LOCResult = {
      totalLines: 0,
      codeLines: 0,
      commentLines: 0,
      blankLines: 0,
      fileCount: fileStats.length,
      fileBreakdown: fileStats,
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

    const globPatterns = patterns || defaultPatterns;
    const files = await fastGlob(globPatterns, {
      cwd: process.cwd(),
      absolute: true, // Get absolute paths first
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
    });

    // Convert to relative paths and filter using ignore patterns
    const cwd = process.cwd();
    return files
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
