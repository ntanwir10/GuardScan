import * as fs from 'fs';
import { analyzeSource, findSourceFiles, languageOf, SourceAnalysis } from './source-analysis';

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
    const files = findSourceFiles(
      repoPath,
      ['node_modules', '.git', 'vendor', 'dist', 'build'],
      name => languageOf(name) !== undefined && !name.endsWith('.test.js') && !name.endsWith('.spec.ts')
    );

    for (const file of files) {
      try {
        const analysis = analyzeSource(fs.readFileSync(file, 'utf-8'), file);
        if (analysis) {
          results.push(this.calculateMetrics(file, analysis));
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return results;
  }

  /**
   * Calculate all metrics for a file
   */
  private calculateMetrics(file: string, analysis: SourceAnalysis): CodeMetrics {
    const language = analysis.language;
    const issues: MetricIssue[] = [];

    // File-level McCabe total (1 + every decision point) and cognitive total
    const cyclomaticComplexity = analysis.cyclomatic;
    const cognitiveComplexity = analysis.cognitive;

    // Function lengths come from real function bodies, not a brace-count heuristic
    const functions = analysis.functions;
    const functionLengths = functions.map(f => f.endLine - f.startLine);
    const avgFunctionLength = functionLengths.length > 0
      ? functionLengths.reduce((a, b) => a + b, 0) / functionLengths.length
      : 0;
    const maxFunctionLength = functionLengths.reduce((a, b) => Math.max(a, b), 0);

    // Lines of code exclude blank lines and comments (including multi-line comments)
    const linesOfCode = analysis.noComments.split('\n').filter(l => l.trim() !== '').length;
    const maintainabilityIndex = this.calculateMaintainabilityIndex(
      linesOfCode,
      cyclomaticComplexity,
      analysis.noComments.length
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
}

export const codeMetricsAnalyzer = new CodeMetricsAnalyzer();
