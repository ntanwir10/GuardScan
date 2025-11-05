import * as fs from 'fs';
import * as path from 'path';

export interface CodeMetrics {
  file: string;
  language: string;
  metrics: {
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    maintainabilityIndex: number;
    linesOfCode: number;
    functionCount: number;
    averageFunctionLength: number;
    maxFunctionLength: number;
    technicalDebt: string; // e.g., "2 hours", "1 day"
  };
  issues: MetricIssue[];
}

export interface MetricIssue {
  type: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
  value: number;
  threshold: number;
}

export class CodeMetricsAnalyzer {
  // Thresholds based on industry standards
  private readonly THRESHOLDS = {
    cyclomaticComplexity: {
      low: 10,
      medium: 20,
      high: 50,
    },
    cognitiveComplexity: {
      low: 15,
      medium: 25,
      high: 50,
    },
    functionLength: {
      low: 50,
      medium: 100,
      high: 200,
    },
    maintainability: {
      good: 80,
      moderate: 60,
      poor: 40,
    },
  };

  /**
   * Analyze code quality metrics for a repository
   */
  async analyze(repoPath: string = process.cwd()): Promise<CodeMetrics[]> {
    const results: CodeMetrics[] = [];
    const files = this.findCodeFiles(repoPath);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const language = this.detectLanguage(file);
        const metrics = this.calculateMetrics(file, content, language);
        results.push(metrics);
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
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
          if (item === 'node_modules' || item === '.git' || item === 'vendor' || item === 'dist' || item === 'build') continue;

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
    const extensions = ['.js', '.ts', '.py', '.go', '.java', '.rb', '.php', '.cpp', '.c', '.cs'];
    return extensions.some(ext => filename.endsWith(ext)) && !filename.endsWith('.test.js') && !filename.endsWith('.spec.ts');
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
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Calculate all metrics for a file
   */
  private calculateMetrics(file: string, content: string, language: string): CodeMetrics {
    const lines = content.split('\n');
    const issues: MetricIssue[] = [];

    // Calculate cyclomatic complexity
    const cyclomaticComplexity = this.calculateCyclomaticComplexity(content, language);

    // Calculate cognitive complexity
    const cognitiveComplexity = this.calculateCognitiveComplexity(content, language);

    // Analyze functions
    const functions = this.extractFunctions(content, language);
    const functionLengths = functions.map(f => f.endLine - f.startLine);
    const avgFunctionLength = functionLengths.length > 0
      ? functionLengths.reduce((a, b) => a + b, 0) / functionLengths.length
      : 0;
    const maxFunctionLength = functionLengths.length > 0 ? Math.max(...functionLengths) : 0;

    // Calculate maintainability index
    const linesOfCode = lines.filter(l => l.trim() && !this.isComment(l, language)).length;
    const maintainabilityIndex = this.calculateMaintainabilityIndex(
      linesOfCode,
      cyclomaticComplexity,
      content.length
    );

    // Technical debt estimation
    const technicalDebt = this.estimateTechnicalDebt(
      cyclomaticComplexity,
      maintainabilityIndex,
      linesOfCode
    );

    // Identify issues

    // High cyclomatic complexity
    if (cyclomaticComplexity > this.THRESHOLDS.cyclomaticComplexity.high) {
      issues.push({
        type: 'High Cyclomatic Complexity',
        line: 1,
        severity: 'critical',
        description: `File has very high cyclomatic complexity (${cyclomaticComplexity})`,
        recommendation: 'Break down complex logic into smaller functions',
        value: cyclomaticComplexity,
        threshold: this.THRESHOLDS.cyclomaticComplexity.high,
      });
    } else if (cyclomaticComplexity > this.THRESHOLDS.cyclomaticComplexity.medium) {
      issues.push({
        type: 'Moderate Cyclomatic Complexity',
        line: 1,
        severity: 'medium',
        description: `File has moderate cyclomatic complexity (${cyclomaticComplexity})`,
        recommendation: 'Consider refactoring to reduce complexity',
        value: cyclomaticComplexity,
        threshold: this.THRESHOLDS.cyclomaticComplexity.medium,
      });
    }

    // High cognitive complexity
    if (cognitiveComplexity > this.THRESHOLDS.cognitiveComplexity.high) {
      issues.push({
        type: 'High Cognitive Complexity',
        line: 1,
        severity: 'high',
        description: `File has very high cognitive complexity (${cognitiveComplexity})`,
        recommendation: 'Simplify logic to improve readability',
        value: cognitiveComplexity,
        threshold: this.THRESHOLDS.cognitiveComplexity.high,
      });
    }

    // Low maintainability
    if (maintainabilityIndex < this.THRESHOLDS.maintainability.poor) {
      issues.push({
        type: 'Poor Maintainability',
        line: 1,
        severity: 'critical',
        description: `File has poor maintainability index (${maintainabilityIndex.toFixed(1)})`,
        recommendation: 'Refactor to improve code quality and reduce complexity',
        value: maintainabilityIndex,
        threshold: this.THRESHOLDS.maintainability.poor,
      });
    } else if (maintainabilityIndex < this.THRESHOLDS.maintainability.moderate) {
      issues.push({
        type: 'Low Maintainability',
        line: 1,
        severity: 'medium',
        description: `File has low maintainability index (${maintainabilityIndex.toFixed(1)})`,
        recommendation: 'Consider refactoring to improve maintainability',
        value: maintainabilityIndex,
        threshold: this.THRESHOLDS.maintainability.moderate,
      });
    }

    // Long functions
    functions.forEach(func => {
      const length = func.endLine - func.startLine;
      if (length > this.THRESHOLDS.functionLength.high) {
        issues.push({
          type: 'Very Long Function',
          line: func.startLine,
          severity: 'high',
          description: `Function "${func.name}" is very long (${length} lines)`,
          recommendation: 'Break down into smaller, focused functions',
          value: length,
          threshold: this.THRESHOLDS.functionLength.high,
        });
      } else if (length > this.THRESHOLDS.functionLength.medium) {
        issues.push({
          type: 'Long Function',
          line: func.startLine,
          severity: 'medium',
          description: `Function "${func.name}" is long (${length} lines)`,
          recommendation: 'Consider breaking into smaller functions',
          value: length,
          threshold: this.THRESHOLDS.functionLength.medium,
        });
      }
    });

    return {
      file,
      language,
      metrics: {
        cyclomaticComplexity,
        cognitiveComplexity,
        maintainabilityIndex,
        linesOfCode,
        functionCount: functions.length,
        averageFunctionLength: Math.round(avgFunctionLength),
        maxFunctionLength,
        technicalDebt,
      },
      issues,
    };
  }

  /**
   * Calculate cyclomatic complexity (McCabe's complexity)
   * Counts decision points: if, for, while, case, &&, ||, etc.
   */
  private calculateCyclomaticComplexity(content: string, language: string): number {
    let complexity = 1; // Base complexity

    const patterns = [
      /\bif\s*\(/g,
      /\belse\s+if\b/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bdo\s*{/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /\b\?\s*.*\s*:/g, // Ternary operator
      /&&/g,
      /\|\|/g,
    ];

    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  /**
   * Calculate cognitive complexity
   * Similar to cyclomatic but considers nesting depth
   */
  private calculateCognitiveComplexity(content: string, language: string): number {
    let complexity = 0;
    let nestingLevel = 0;
    const lines = content.split('\n');

    for (const line of lines) {
      // Track nesting
      if (/{/.test(line)) nestingLevel++;
      if (/}/.test(line)) nestingLevel = Math.max(0, nestingLevel - 1);

      // Add complexity for control structures
      if (/\b(if|for|while|switch|catch)\b/.test(line)) {
        complexity += 1 + nestingLevel; // More complex when nested
      }

      // Logical operators add less complexity
      const logicalOps = (line.match(/&&|\|\|/g) || []).length;
      complexity += logicalOps * 0.5;
    }

    return Math.round(complexity);
  }

  /**
   * Calculate maintainability index
   * Based on Halstead Volume, Cyclomatic Complexity, and Lines of Code
   * Scale: 0-100 (higher is better)
   */
  private calculateMaintainabilityIndex(
    linesOfCode: number,
    cyclomaticComplexity: number,
    halsteadVolume: number
  ): number {
    // Simplified maintainability index formula
    // MI = 171 - 5.2 * ln(HV) - 0.23 * CC - 16.2 * ln(LOC)

    const HV = Math.max(1, halsteadVolume / 100); // Approximate Halstead volume
    const CC = cyclomaticComplexity;
    const LOC = Math.max(1, linesOfCode);

    let mi = 171 - 5.2 * Math.log(HV) - 0.23 * CC - 16.2 * Math.log(LOC);

    // Normalize to 0-100 scale
    mi = Math.max(0, Math.min(100, mi));

    return mi;
  }

  /**
   * Estimate technical debt in time units
   */
  private estimateTechnicalDebt(
    complexity: number,
    maintainability: number,
    linesOfCode: number
  ): string {
    // Very rough estimation based on industry averages
    // Assumes fixing 1 complexity point = 15 minutes
    // Low maintainability adds proportional time

    let minutes = 0;

    // Complexity debt
    if (complexity > this.THRESHOLDS.cyclomaticComplexity.medium) {
      minutes += (complexity - this.THRESHOLDS.cyclomaticComplexity.medium) * 15;
    }

    // Maintainability debt
    if (maintainability < this.THRESHOLDS.maintainability.moderate) {
      const debtFactor = (this.THRESHOLDS.maintainability.moderate - maintainability) / 10;
      minutes += debtFactor * (linesOfCode / 10);
    }

    // Convert to human-readable format
    if (minutes < 60) {
      return `${Math.round(minutes)} minutes`;
    } else if (minutes < 480) {
      return `${(minutes / 60).toFixed(1)} hours`;
    } else {
      return `${(minutes / 480).toFixed(1)} days`;
    }
  }

  /**
   * Extract function information from code
   */
  private extractFunctions(content: string, language: string): Array<{
    name: string;
    startLine: number;
    endLine: number;
  }> {
    const functions: Array<{ name: string; startLine: number; endLine: number }> = [];
    const lines = content.split('\n');

    // Language-specific function patterns
    const patterns: Record<string, RegExp> = {
      javascript: /function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*\([^)]*\)\s*=>|(\w+)\s*:\s*function/,
      typescript: /function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*\([^)]*\)\s*=>|(\w+)\s*:\s*function|private\s+(\w+)\s*\(/,
      python: /def\s+(\w+)\s*\(/,
      go: /func\s+(\w+)\s*\(/,
      java: /(public|private|protected)?\s*(static)?\s*\w+\s+(\w+)\s*\(/,
      ruby: /def\s+(\w+)/,
      php: /function\s+(\w+)\s*\(/,
    };

    const pattern = patterns[language];
    if (!pattern) return functions;

    let currentFunction: { name: string; startLine: number; braceCount: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Look for function start
      const match = line.match(pattern);
      if (match && !currentFunction) {
        const name = match.filter(Boolean).find((g, idx) => idx > 0) || 'anonymous';
        currentFunction = {
          name,
          startLine: i + 1,
          braceCount: 0,
        };
      }

      // Track braces to find function end
      if (currentFunction) {
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;
        currentFunction.braceCount += openBraces - closeBraces;

        // Function ended
        if (currentFunction.braceCount === 0 && openBraces > 0) {
          functions.push({
            name: currentFunction.name,
            startLine: currentFunction.startLine,
            endLine: i + 1,
          });
          currentFunction = null;
        }
      }
    }

    return functions;
  }

  /**
   * Check if line is a comment
   */
  private isComment(line: string, language: string): boolean {
    const trimmed = line.trim();

    const commentPatterns: Record<string, RegExp[]> = {
      javascript: [/^\/\//, /^\/\*/, /^\*/],
      typescript: [/^\/\//, /^\/\*/, /^\*/],
      python: [/^#/, /^'''/, /^"""/],
      go: [/^\/\//, /^\/\*/],
      java: [/^\/\//, /^\/\*/, /^\*/],
      ruby: [/^#/, /^=begin/],
      php: [/^\/\//, /^#/, /^\/\*/],
    };

    const patterns = commentPatterns[language] || [];
    return patterns.some(p => p.test(trimmed));
  }
}

export const codeMetricsAnalyzer = new CodeMetricsAnalyzer();
