/**
 * refactoring-suggestions.ts - AI-Powered Refactoring Suggestions
 *
 * Detects code smells, suggests design patterns, generates refactored code,
 * and provides impact analysis for refactoring changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AIProvider } from '../providers/base';
import { ASTParser, ParsedFunction, ParsedClass } from '../core/ast-parser';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Types of code smells that can be detected
 */
export type CodeSmellType =
  | 'long-method'
  | 'large-class'
  | 'duplicated-code'
  | 'long-parameter-list'
  | 'feature-envy'
  | 'data-clumps'
  | 'primitive-obsession'
  | 'switch-statements'
  | 'lazy-class'
  | 'speculative-generality'
  | 'temporary-field'
  | 'message-chains'
  | 'middle-man'
  | 'inappropriate-intimacy'
  | 'god-class'
  | 'shotgun-surgery';

/**
 * Design patterns that can be suggested
 */
export type DesignPattern =
  | 'factory'
  | 'singleton'
  | 'observer'
  | 'strategy'
  | 'decorator'
  | 'adapter'
  | 'facade'
  | 'proxy'
  | 'command'
  | 'iterator'
  | 'composite'
  | 'template-method'
  | 'chain-of-responsibility'
  | 'state'
  | 'visitor'
  | 'mediator'
  | 'memento'
  | 'prototype'
  | 'builder'
  | 'abstract-factory';

/**
 * Detected code smell
 */
export interface CodeSmell {
  type: CodeSmellType;
  severity: 'critical' | 'high' | 'medium' | 'low';
  file: string;
  startLine: number;
  endLine: number;
  symbolName: string;
  description: string;
  metrics?: {
    complexity?: number;
    lines?: number;
    parameters?: number;
    dependencies?: number;
  };
  suggestedRefactoring: string;
}

/**
 * Design pattern suggestion
 */
export interface PatternSuggestion {
  pattern: DesignPattern;
  confidence: number; // 0-1
  file: string;
  targetSymbol: string;
  rationale: string;
  benefits: string[];
  implementation: string;
  estimatedEffort: 'low' | 'medium' | 'high';
}

/**
 * Refactored code output
 */
export interface RefactoredCode {
  original: {
    file: string;
    startLine: number;
    endLine: number;
    code: string;
  };
  refactored: {
    files: RefactoredFile[];
    explanation: string;
    changes: string[];
  };
  improvements: {
    complexity: number; // Improvement percentage
    maintainability: number;
    readability: number;
  };
  confidence: number; // 0-1
}

export interface RefactoredFile {
  path: string;
  content: string;
  isNew: boolean;
  changes: string;
}

/**
 * Impact analysis for refactoring
 */
export interface ImpactAnalysis {
  affectedFiles: string[];
  affectedTests: string[];
  breakingChanges: BreakingChange[];
  dependencies: {
    internal: string[]; // Files that depend on refactored code
    external: string[]; // npm packages affected
  };
  estimatedEffort: {
    hours: number;
    complexity: 'low' | 'medium' | 'high' | 'very-high';
  };
  risks: Risk[];
  recommendations: string[];
}

export interface BreakingChange {
  type: 'api-change' | 'signature-change' | 'removal' | 'behavior-change';
  description: string;
  file: string;
  symbol: string;
  mitigation: string;
}

export interface Risk {
  level: 'low' | 'medium' | 'high' | 'critical';
  category: 'compatibility' | 'performance' | 'security' | 'maintainability';
  description: string;
  mitigation: string;
}

/**
 * Refactoring options
 */
export interface RefactoringOptions {
  includeTests?: boolean;
  preserveComments?: boolean;
  modernize?: boolean; // Use latest language features
  maxComplexity?: number; // Target complexity after refactoring
  patterns?: DesignPattern[]; // Specific patterns to apply
  aggressive?: boolean; // More aggressive refactoring
}

/**
 * Refactoring report
 */
export interface RefactoringReport {
  summary: {
    smellsDetected: number;
    patternssuggested: number;
    filesAnalyzed: number;
    estimatedImprovementScore: number; // 0-100
  };
  smells: CodeSmell[];
  patterns: PatternSuggestion[];
  recommendations: {
    priority: 'high' | 'medium' | 'low';
    refactoring: string;
    impact: string;
    estimatedHours: number;
  }[];
  prioritizedSuggestions?: {
    priority: 'high' | 'medium' | 'low';
    refactoring: string;
    impact: string;
    estimatedHours: number;
  }[];
}

// ============================================================================
// Refactoring Suggestions Engine
// ============================================================================

export class RefactoringSuggestionsEngine {
  private parser: ASTParser;
  private indexer: CodebaseIndexer;
  private cache: AICache;

  constructor(
    private aiProvider: AIProvider,
    private repoRoot: string,
    private repoId: string
  ) {
    this.parser = new ASTParser();
    this.indexer = new CodebaseIndexer(repoRoot, repoId);
    this.cache = new AICache(repoId);
  }

  /**
   * Detect code smells in a file or entire codebase
   */
  async detectCodeSmells(targetPath?: string): Promise<CodeSmell[]> {
    const smells: CodeSmell[] = [];

    // Get files to analyze
    let files: string[];
    if (targetPath) {
      files = [targetPath];
    } else {
      const index = await this.indexer.buildIndex();
      files = Array.from(index.files.keys());
    }

    for (const file of files) {
      if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;

      const parsed = await this.parser.parseFile(file);
      if (!parsed) continue;

      // Check each function for smells
      for (const func of parsed.functions) {
        smells.push(...this.detectFunctionSmells(func, file));
      }

      // Check each class for smells
      for (const cls of parsed.classes) {
        smells.push(...this.detectClassSmells(cls, file));
      }

      // Check file-level smells
      smells.push(...this.detectFileSmells(parsed, file));
    }

    return smells;
  }

  /**
   * Detect smells in a function
   */
  private detectFunctionSmells(func: ParsedFunction, file: string): CodeSmell[] {
    const smells: CodeSmell[] = [];

    // Long Method (>50 lines)
    // Calculate actual function body lines
    const bodyLines = func.body ? func.body.split('\n').length : 0;
    // Also check if we have endLine info
    const lines = func.endLine && func.endLine > func.line ? (func.endLine - func.line + 1) : bodyLines;
    if (lines > 50) {
      smells.push({
        type: 'long-method',
        severity: lines > 100 ? 'high' : 'medium',
        file,
        startLine: func.line,
        endLine: func.line + lines,
        symbolName: func.name,
        description: `Function '${func.name}' is ${lines} lines long (threshold: 50)`,
        metrics: { lines, complexity: func.complexity },
        suggestedRefactoring: 'Extract smaller methods from this function'
      });
    }

    // Long Parameter List (>4 parameters)
    if (func.parameters.length > 4) {
      smells.push({
        type: 'long-parameter-list',
        severity: func.parameters.length > 7 ? 'high' : 'medium',
        file,
        startLine: func.line,
        endLine: func.line + lines,
        symbolName: func.name,
        description: `Function '${func.name}' has ${func.parameters.length} parameters (threshold: 4)`,
        metrics: { parameters: func.parameters.length },
        suggestedRefactoring: 'Introduce parameter object or builder pattern'
      });
    }

    // High Complexity
    if (func.complexity && func.complexity > 10) {
      smells.push({
        type: 'switch-statements',
        severity: func.complexity > 20 ? 'critical' : 'high',
        file,
        startLine: func.line,
        endLine: func.line + lines,
        symbolName: func.name,
        description: `Function '${func.name}' has cyclomatic complexity of ${func.complexity} (threshold: 10)`,
        metrics: { complexity: func.complexity },
        suggestedRefactoring: 'Simplify conditional logic or extract methods'
      });
    }

    return smells;
  }

  /**
   * Detect smells in a class
   */
  private detectClassSmells(cls: ParsedClass, file: string): CodeSmell[] {
    const smells: CodeSmell[] = [];

    // Large Class (>500 lines or >20 methods)
    const methodCount = cls.methods.length;
    if (methodCount > 20) {
      smells.push({
        type: 'large-class',
        severity: methodCount > 40 ? 'critical' : 'high',
        file,
        startLine: cls.line || 0,
        endLine: cls.line || 0,
        symbolName: cls.name,
        description: `Class '${cls.name}' has ${methodCount} methods (threshold: 20)`,
        metrics: { lines: methodCount },
        suggestedRefactoring: 'Split class into smaller, focused classes'
      });
    }

    // God Class (many responsibilities)
    const propertyCount = cls.properties.length;
    if (propertyCount > 15 && methodCount > 15) {
      smells.push({
        type: 'god-class',
        severity: 'critical',
        file,
        startLine: cls.line || 0,
        endLine: cls.line || 0,
        symbolName: cls.name,
        description: `Class '${cls.name}' has ${propertyCount} properties and ${methodCount} methods`,
        metrics: { lines: propertyCount + methodCount },
        suggestedRefactoring: 'Apply Single Responsibility Principle - split into focused classes'
      });
    }

    return smells;
  }

  /**
   * Detect file-level smells
   */
  private detectFileSmells(parsed: any, file: string): CodeSmell[] {
    const smells: CodeSmell[] = [];

    // Too many exports (>10)
    const exportCount = parsed.exports?.length || 0;
    if (exportCount > 10) {
      smells.push({
        type: 'shotgun-surgery',
        severity: 'medium',
        file,
        startLine: 1,
        endLine: 1,
        symbolName: path.basename(file),
        description: `File exports ${exportCount} symbols (threshold: 10)`,
        metrics: { lines: exportCount },
        suggestedRefactoring: 'Split file into multiple modules with focused responsibilities'
      });
    }

    return smells;
  }

  /**
   * Suggest design patterns for code
   */
  async suggestPatterns(targetPath: string): Promise<PatternSuggestion[]> {
    const parsed = await this.parser.parseFile(targetPath);
    if (!parsed) return [];

    const suggestions: PatternSuggestion[] = [];

    // Analyze with AI
    const cacheKey = `pattern-suggestions-${targetPath}`;
    const cached = await this.cache.get(cacheKey, this.aiProvider.getName(), [targetPath]);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache, continue
      }
    }

    const prompt = this.buildPatternPrompt(parsed, targetPath);
    const response = await this.aiProvider.chat([
      {
        role: 'system',
        content: 'You are an expert software architect. Analyze code and suggest appropriate design patterns.'
      },
      {
        role: 'user',
        content: prompt
      }
    ], {
      temperature: 0.3,
      maxTokens: 2000
    });

    // Parse AI response (expecting JSON)
    try {
      const aiSuggestions = JSON.parse(response.content);
      suggestions.push(...aiSuggestions);
      await this.cache.set(cacheKey, this.aiProvider.getName(), response.content, [targetPath]);
    } catch (error) {
      console.error('Failed to parse pattern suggestions:', error);
    }

    return suggestions;
  }

  /**
   * Generate refactored code
   */
  async generateRefactoredCode(
    targetPath: string,
    smell: CodeSmell,
    options: RefactoringOptions = {}
  ): Promise<RefactoredCode> {
    const fileContent = fs.readFileSync(targetPath, 'utf-8');
    const targetCode = this.extractCode(fileContent, smell.startLine, smell.endLine);

    const cacheKey = `refactored-${targetPath}-${smell.type}-${smell.startLine}`;
    const cached = await this.cache.get(cacheKey, this.aiProvider.getName(), [targetPath]);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache, continue with generation
      }
    }

    const prompt = this.buildRefactoringPrompt(targetCode, smell, options, targetPath);
    const response = await this.aiProvider.chat([
      {
        role: 'system',
        content: 'You are an expert software engineer specializing in code refactoring. Generate clean, maintainable refactored code.'
      },
      {
        role: 'user',
        content: prompt
      }
    ], {
      temperature: 0.2,
      maxTokens: 3000
    });

    const refactoredCode = this.parseRefactoredResponse(response.content, targetPath, smell);
    await this.cache.set(cacheKey, this.aiProvider.getName(), JSON.stringify(refactoredCode), [targetPath]);

    return refactoredCode;
  }

  /**
   * Analyze impact of refactoring
   */
  async analyzeImpact(
    targetPath: string,
    refactoredCode: RefactoredCode
  ): Promise<ImpactAnalysis> {
    const index = await this.indexer.buildIndex();

    // Find files that depend on the target
    const affectedFiles: string[] = [];
    const affectedTests: string[] = [];

    for (const [file, fileIndex] of index.files.entries()) {
      if (file === targetPath) continue;

      // Check if this file imports the target
      const hasImport = fileIndex.imports.some(imp =>
        imp.includes(path.basename(targetPath, path.extname(targetPath)))
      );

      if (hasImport) {
        affectedFiles.push(file);
        if (file.includes('.test.') || file.includes('.spec.')) {
          affectedTests.push(file);
        }
      }
    }

    // Detect breaking changes
    const breakingChanges = this.detectBreakingChanges(refactoredCode);

    // Estimate effort
    const effort = this.estimateEffort(affectedFiles.length, breakingChanges.length);

    // Identify risks
    const risks = this.identifyRisks(refactoredCode, affectedFiles.length, breakingChanges);

    return {
      affectedFiles,
      affectedTests,
      breakingChanges,
      dependencies: {
        internal: affectedFiles,
        external: [] // Would need to analyze package.json
      },
      estimatedEffort: effort,
      risks,
      recommendations: this.generateRecommendations(affectedFiles.length, breakingChanges.length, risks)
    };
  }

  /**
   * Generate comprehensive refactoring report
   */
  async generateReport(targetPath?: string): Promise<RefactoringReport> {
    const smells = await this.detectCodeSmells(targetPath);
    const patterns: PatternSuggestion[] = [];

    // Get pattern suggestions for files with smells
    const filesWithSmells = [...new Set(smells.map(s => s.file))];
    for (const file of filesWithSmells.slice(0, 5)) { // Limit to 5 files
      try {
        const filePatterns = await this.suggestPatterns(file);
        patterns.push(...filePatterns);
      } catch (error) {
        console.error(`Error getting patterns for ${file}:`, error);
      }
    }

    // Prioritize refactorings
    const recommendations = this.prioritizeRefactorings(smells, patterns);

    // Calculate improvement score
    const improvementScore = this.calculateImprovementScore(smells, patterns);

    return {
      summary: {
        smellsDetected: smells.length,
        patternssuggested: patterns.length,
        filesAnalyzed: filesWithSmells.length,
        estimatedImprovementScore: improvementScore
      },
      smells,
      patterns,
      recommendations,
      prioritizedSuggestions: recommendations // Alias for backward compatibility
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private extractCode(content: string, startLine: number, endLine: number): string {
    const lines = content.split('\n');
    return lines.slice(startLine - 1, endLine).join('\n');
  }

  private buildPatternPrompt(parsed: any, file: string): string {
    return `Analyze this TypeScript/JavaScript code and suggest appropriate design patterns.

File: ${file}

Classes: ${parsed.classes.map((c: any) => c.name).join(', ')}
Functions: ${parsed.functions.map((f: any) => f.name).join(', ')}

Return a JSON array of pattern suggestions with this format:
[
  {
    "pattern": "factory",
    "confidence": 0.8,
    "file": "${file}",
    "targetSymbol": "className",
    "rationale": "Why this pattern fits",
    "benefits": ["benefit 1", "benefit 2"],
    "implementation": "How to implement",
    "estimatedEffort": "medium"
  }
]

Focus on patterns that would genuinely improve the code structure.`;
  }

  private buildRefactoringPrompt(
    code: string,
    smell: CodeSmell,
    options: RefactoringOptions,
    file: string
  ): string {
    return `Refactor this code to address the following code smell:

Smell Type: ${smell.type}
Severity: ${smell.severity}
Description: ${smell.description}

Original Code:
\`\`\`typescript
${code}
\`\`\`

Options:
- Include tests: ${options.includeTests || false}
- Preserve comments: ${options.preserveComments !== false}
- Modernize: ${options.modernize || false}
- Target complexity: ${options.maxComplexity || 10}

Provide refactored code in JSON format:
{
  "refactored": {
    "files": [
      {
        "path": "${file}",
        "content": "refactored code here",
        "isNew": false,
        "changes": "summary of changes"
      }
    ],
    "explanation": "Explain the refactoring",
    "changes": ["change 1", "change 2"]
  },
  "improvements": {
    "complexity": 30,
    "maintainability": 40,
    "readability": 25
  },
  "confidence": 0.9
}`;
  }

  private parseRefactoredResponse(response: string, file: string, smell: CodeSmell): RefactoredCode {
    try {
      const parsed = JSON.parse(response);
      return {
        original: {
          file,
          startLine: smell.startLine,
          endLine: smell.endLine,
          code: ''
        },
        ...parsed
      };
    } catch (error) {
      // Fallback if JSON parsing fails
      return {
        original: { file, startLine: smell.startLine, endLine: smell.endLine, code: '' },
        refactored: {
          files: [],
          explanation: 'Failed to parse refactored code',
          changes: []
        },
        improvements: { complexity: 0, maintainability: 0, readability: 0 },
        confidence: 0
      };
    }
  }

  private detectBreakingChanges(refactoredCode: RefactoredCode): BreakingChange[] {
    // This would analyze the refactored code for API changes
    // For now, return empty array (would need AST comparison)
    return [];
  }

  private estimateEffort(affectedFiles: number, breakingChanges: number): {
    hours: number;
    complexity: 'low' | 'medium' | 'high' | 'very-high';
  } {
    const baseHours = 2;
    const fileHours = affectedFiles * 0.5;
    const breakingHours = breakingChanges * 2;
    const totalHours = baseHours + fileHours + breakingHours;

    let complexity: 'low' | 'medium' | 'high' | 'very-high';
    if (totalHours < 4) complexity = 'low';
    else if (totalHours < 8) complexity = 'medium';
    else if (totalHours < 16) complexity = 'high';
    else complexity = 'very-high';

    return { hours: Math.round(totalHours), complexity };
  }

  private identifyRisks(
    refactoredCode: RefactoredCode,
    affectedFiles: number,
    breakingChanges: BreakingChange[]
  ): Risk[] {
    const risks: Risk[] = [];

    if (affectedFiles > 10) {
      risks.push({
        level: 'high',
        category: 'maintainability',
        description: `${affectedFiles} files depend on this code`,
        mitigation: 'Thoroughly test all dependent files after refactoring'
      });
    }

    if (breakingChanges.length > 0) {
      risks.push({
        level: 'critical',
        category: 'compatibility',
        description: `${breakingChanges.length} breaking changes detected`,
        mitigation: 'Update all call sites and add deprecation warnings'
      });
    }

    if (refactoredCode.confidence < 0.7) {
      risks.push({
        level: 'medium',
        category: 'maintainability',
        description: 'Low confidence in refactoring quality',
        mitigation: 'Manual code review required before applying'
      });
    }

    return risks;
  }

  private generateRecommendations(
    affectedFiles: number,
    breakingChanges: number,
    risks: Risk[]
  ): string[] {
    const recommendations: string[] = [];

    recommendations.push('Create a new branch for this refactoring');
    recommendations.push('Write or update tests before refactoring');

    if (affectedFiles > 5) {
      recommendations.push('Refactor incrementally, file by file');
      recommendations.push('Use feature flags to gradually roll out changes');
    }

    if (breakingChanges > 0) {
      recommendations.push('Version the API and maintain backward compatibility');
      recommendations.push('Add deprecation warnings before removing old code');
    }

    if (risks.some(r => r.level === 'critical' || r.level === 'high')) {
      recommendations.push('Conduct thorough code review with team');
      recommendations.push('Increase test coverage before proceeding');
    }

    return recommendations;
  }

  private prioritizeRefactorings(
    smells: CodeSmell[],
    patterns: PatternSuggestion[]
  ): Array<{
    priority: 'high' | 'medium' | 'low';
    refactoring: string;
    impact: string;
    estimatedHours: number;
  }> {
    const recommendations: Array<{
      priority: 'high' | 'medium' | 'low';
      refactoring: string;
      impact: string;
      estimatedHours: number;
    }> = [];

    // Prioritize critical smells
    const criticalSmells = smells.filter(s => s.severity === 'critical');
    for (const smell of criticalSmells) {
      recommendations.push({
        priority: 'high' as const,
        refactoring: `Fix ${smell.type} in ${smell.symbolName}`,
        impact: smell.description,
        estimatedHours: 4
      });
    }

    // Add high-confidence pattern suggestions
    const highConfidencePatterns = patterns.filter(p => p.confidence > 0.8);
    for (const pattern of highConfidencePatterns) {
      recommendations.push({
        priority: 'medium' as const,
        refactoring: `Apply ${pattern.pattern} pattern to ${pattern.targetSymbol}`,
        impact: pattern.rationale,
        estimatedHours: pattern.estimatedEffort === 'low' ? 2 : pattern.estimatedEffort === 'medium' ? 4 : 8
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  private calculateImprovementScore(smells: CodeSmell[], patterns: PatternSuggestion[]): number {
    // Calculate based on severity of smells and confidence of patterns
    const smellScore = smells.reduce((sum, smell) => {
      const weights = { critical: 10, high: 7, medium: 4, low: 2 };
      return sum + weights[smell.severity];
    }, 0);

    const patternScore = patterns.reduce((sum, pattern) => {
      return sum + (pattern.confidence * 10);
    }, 0);

    return Math.min(100, smellScore + patternScore);
  }
}
