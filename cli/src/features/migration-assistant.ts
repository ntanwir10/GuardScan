/**
 * migration-assistant.ts - AI-Powered Migration Assistant
 *
 * Automated code migrations including:
 * - Framework migrations (React, Vue, Angular, etc.)
 * - Dependency upgrades (breaking changes analysis)
 * - Language conversion (JavaScript → TypeScript)
 * - Code modernization (ES5 → ES6+, callbacks → async/await)
 *
 * Phase 5, Feature 3
 */

import * as fs from 'fs';
import * as path from 'path';
import { AIProvider } from '../providers/base';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';

/**
 * Migration Types
 */
export type MigrationType =
  | 'framework'
  | 'dependency'
  | 'language'
  | 'modernization';

/**
 * Framework Migration Types
 */
export type FrameworkMigration =
  | 'react-class-to-hooks'
  | 'vue2-to-vue3'
  | 'angular-js-to-angular'
  | 'express-to-fastify'
  | 'jest-to-vitest'
  | 'webpack-to-vite'
  | 'cra-to-vite'
  | 'redux-to-zustand';

/**
 * Language Conversion Types
 */
export type LanguageConversion =
  | 'js-to-ts'
  | 'flow-to-ts'
  | 'commonjs-to-esm'
  | 'esm-to-commonjs';

/**
 * Modernization Types
 */
export type ModernizationType =
  | 'es5-to-es6'
  | 'callbacks-to-promises'
  | 'promises-to-async-await'
  | 'var-to-const-let'
  | 'function-to-arrow'
  | 'prototype-to-class';

/**
 * Migration Issue
 */
export interface MigrationIssue {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  file: string;
  startLine: number;
  endLine: number;
  issueType: string;
  description: string;
  currentCode: string;
  suggestedCode?: string;
  reasoning: string;
  effort: 'low' | 'medium' | 'high';
  autoFixable: boolean;
}

/**
 * Dependency Upgrade Analysis
 */
export interface DependencyUpgrade {
  package: string;
  currentVersion: string;
  targetVersion: string;
  breakingChanges: BreakingChange[];
  deprecations: Deprecation[];
  migrationSteps: string[];
  effort: 'low' | 'medium' | 'high' | 'very-high';
  risk: 'low' | 'medium' | 'high';
}

/**
 * Breaking Change
 */
export interface BreakingChange {
  change: string;
  impact: string;
  affectedFiles: string[];
  migrationPath: string;
}

/**
 * Deprecation
 */
export interface Deprecation {
  api: string;
  replacement: string;
  reason: string;
  examples: string[];
}

/**
 * Migration Result
 */
export interface MigrationResult {
  file: string;
  originalContent: string;
  migratedContent: string;
  changes: CodeChange[];
  issues: MigrationIssue[];
  success: boolean;
  manualStepsRequired: string[];
}

/**
 * Code Change
 */
export interface CodeChange {
  type: string;
  description: string;
  linesBefore: [number, number];
  linesAfter: [number, number];
  diff: string;
}

/**
 * Migration Plan
 */
export interface MigrationPlan {
  type: MigrationType;
  target: string;
  description: string;
  affectedFiles: string[];
  estimatedEffort: {
    hours: number;
    complexity: 'low' | 'medium' | 'high' | 'very-high';
  };
  phases: MigrationPhase[];
  risks: string[];
  dependencies: string[];
  rollbackPlan: string[];
}

/**
 * Migration Phase
 */
export interface MigrationPhase {
  name: string;
  description: string;
  steps: string[];
  automatable: boolean;
  estimatedHours: number;
}

/**
 * Migration Report
 */
export interface MigrationReport {
  summary: {
    totalFiles: number;
    migratedFiles: number;
    issues: number;
    autoFixable: number;
    manualIntervention: number;
  };
  plan: MigrationPlan;
  results: MigrationResult[];
  issues: MigrationIssue[];
  recommendations: string[];
  generatedAt: Date;
}

/**
 * Migration Options
 */
export interface MigrationOptions {
  targetPath?: string;
  dryRun?: boolean;
  autoFix?: boolean;
  backupOriginals?: boolean;
}

/**
 * Migration Assistant Engine
 */
export class MigrationAssistantEngine {
  constructor(
    private aiProvider: AIProvider,
    private indexer: CodebaseIndexer,
    private cache: AICache,
    private repoPath: string
  ) {}

  /**
   * Analyze framework migration requirements
   */
  async analyzeFrameworkMigration(
    migration: FrameworkMigration,
    options: MigrationOptions = {}
  ): Promise<MigrationPlan> {
    console.log(`Analyzing ${migration} migration...`);

    // Get affected files
    const affectedFiles = await this.findAffectedFiles(migration, options.targetPath);

    // Analyze complexity
    const issues = await this.findMigrationIssues(migration, affectedFiles);

    // Generate migration phases
    const phases = this.generateMigrationPhases(migration, issues);

    // Estimate effort
    const estimatedEffort = this.estimateMigrationEffort(issues, phases);

    // Identify risks
    const risks = this.identifyRisks(migration, issues);

    return {
      type: 'framework',
      target: migration,
      description: this.getMigrationDescription(migration),
      affectedFiles: affectedFiles.slice(0, 100), // Limit to 100 files in plan
      estimatedEffort,
      phases,
      risks,
      dependencies: this.getRequiredDependencies(migration),
      rollbackPlan: this.generateRollbackPlan(migration)
    };
  }

  /**
   * Perform dependency upgrade analysis
   */
  async analyzeDependencyUpgrades(
    packages?: string[]
  ): Promise<DependencyUpgrade[]> {
    const upgrades: DependencyUpgrade[] = [];

    // Read package.json
    const packageJsonPath = path.join(this.repoPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error('package.json not found');
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };

    // Filter packages if specified
    const targetPackages = packages || Object.keys(dependencies);

    for (const pkg of targetPackages) {
      if (!dependencies[pkg]) continue;

      const upgrade = await this.analyzeSingleDependencyUpgrade(
        pkg,
        dependencies[pkg]
      );
      upgrades.push(upgrade);
    }

    return upgrades;
  }

  /**
   * Convert JavaScript to TypeScript
   */
  async convertJsToTs(
    filePath: string,
    options: MigrationOptions = {}
  ): Promise<MigrationResult> {
    const content = fs.readFileSync(filePath, 'utf-8');

    const cacheKey = `js-to-ts-${filePath}`;
    const cached = await this.cache.get(cacheKey, this.aiProvider.getName(), [filePath]);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache
      }
    }

    const prompt = this.buildJsToTsPrompt(content, filePath);
    const response = await this.aiProvider.chat([
      {
        role: 'system',
        content: 'You are an expert TypeScript developer. Convert JavaScript code to TypeScript with proper types.'
      },
      {
        role: 'user',
        content: prompt
      }
    ], {
      temperature: 0.2,
      maxTokens: 4000
    });

    const result = this.parseConversionResponse(response.content, filePath, content);
    await this.cache.set(cacheKey, this.aiProvider.getName(), JSON.stringify(result), [filePath]);

    // Apply changes if autoFix is enabled
    if (options.autoFix && result.success) {
      this.applyMigration(result, options.backupOriginals);
    }

    return result;
  }

  /**
   * Modernize code (ES5 → ES6+, callbacks → async/await)
   */
  async modernizeCode(
    filePath: string,
    modernizations: ModernizationType[],
    options: MigrationOptions = {}
  ): Promise<MigrationResult> {
    const content = fs.readFileSync(filePath, 'utf-8');

    const cacheKey = `modernize-${filePath}-${modernizations.join('-')}`;
    const cached = await this.cache.get(cacheKey, this.aiProvider.getName(), [filePath]);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache
      }
    }

    const prompt = this.buildModernizationPrompt(content, filePath, modernizations);
    const response = await this.aiProvider.chat([
      {
        role: 'system',
        content: 'You are an expert JavaScript developer. Modernize code to use latest ES6+ features and best practices.'
      },
      {
        role: 'user',
        content: prompt
      }
    ], {
      temperature: 0.3,
      maxTokens: 4000
    });

    const result = this.parseModernizationResponse(response.content, filePath, content);
    await this.cache.set(cacheKey, this.aiProvider.getName(), JSON.stringify(result), [filePath]);

    // Apply changes if autoFix is enabled
    if (options.autoFix && result.success) {
      this.applyMigration(result, options.backupOriginals);
    }

    return result;
  }

  /**
   * Generate comprehensive migration report
   */
  async generateMigrationReport(
    type: MigrationType,
    target: string,
    options: MigrationOptions = {}
  ): Promise<MigrationReport> {
    let plan: MigrationPlan;
    const results: MigrationResult[] = [];
    const allIssues: MigrationIssue[] = [];

    // Generate migration plan based on type
    if (type === 'framework') {
      plan = await this.analyzeFrameworkMigration(target as FrameworkMigration, options);
    } else if (type === 'language' && target === 'js-to-ts') {
      plan = await this.generateJsToTsPlan(options);
    } else if (type === 'modernization') {
      plan = await this.generateModernizationPlan(
        options.targetPath || this.repoPath,
        [target as ModernizationType]
      );
    } else {
      throw new Error(`Unsupported migration type: ${type}`);
    }

    // Collect all issues
    for (const file of plan.affectedFiles.slice(0, 20)) { // Limit to 20 files for demo
      const issues = await this.analyzeFileForIssues(file, type, target);
      allIssues.push(...issues);
    }

    return {
      summary: {
        totalFiles: plan.affectedFiles.length,
        migratedFiles: results.length,
        issues: allIssues.length,
        autoFixable: allIssues.filter(i => i.autoFixable).length,
        manualIntervention: allIssues.filter(i => !i.autoFixable).length
      },
      plan,
      results,
      issues: allIssues,
      recommendations: this.generateRecommendations(plan, allIssues),
      generatedAt: new Date()
    };
  }

  // ==================== Helper Methods ====================

  private async findAffectedFiles(
    migration: FrameworkMigration,
    targetPath?: string
  ): Promise<string[]> {
    const patterns = this.getFilePatterns(migration);
    const index = await this.indexer.buildIndex();
    const allFiles = Array.from(index.files.keys());

    return allFiles.filter(file => {
      if (targetPath && !file.startsWith(targetPath)) return false;
      return patterns.some(pattern => file.match(pattern));
    });
  }

  private getFilePatterns(migration: FrameworkMigration): RegExp[] {
    const patterns: Record<FrameworkMigration, RegExp[]> = {
      'react-class-to-hooks': [/\.jsx?$/, /\.tsx?$/],
      'vue2-to-vue3': [/\.vue$/],
      'angular-js-to-angular': [/\.js$/, /\.ts$/],
      'express-to-fastify': [/server\.js$/, /app\.js$/, /routes\/.*\.js$/],
      'jest-to-vitest': [/\.test\.js$/, /\.spec\.js$/],
      'webpack-to-vite': [/webpack\.config\.js$/],
      'cra-to-vite': [/\.jsx?$/, /\.tsx?$/],
      'redux-to-zustand': [/store.*\.js$/, /reducer.*\.js$/]
    };
    return patterns[migration] || [/\.js$/];
  }

  private async findMigrationIssues(
    migration: FrameworkMigration,
    files: string[]
  ): Promise<MigrationIssue[]> {
    const issues: MigrationIssue[] = [];

    // Sample first 10 files for analysis
    for (const file of files.slice(0, 10)) {
      const fileIssues = await this.analyzeFileForIssues(file, 'framework', migration);
      issues.push(...fileIssues);
    }

    return issues;
  }

  private async analyzeFileForIssues(
    file: string,
    type: MigrationType,
    target: string
  ): Promise<MigrationIssue[]> {
    const content = fs.readFileSync(file, 'utf-8');
    const issues: MigrationIssue[] = [];

    // Pattern-based detection (simplified)
    if (type === 'framework' && target === 'react-class-to-hooks') {
      if (content.includes('extends React.Component') || content.includes('extends Component')) {
        issues.push({
          severity: 'medium',
          file,
          startLine: 1,
          endLine: 1,
          issueType: 'class-component',
          description: 'React class component should be converted to functional component with hooks',
          currentCode: 'class Component extends React.Component',
          suggestedCode: 'function Component() { ... }',
          reasoning: 'Hooks provide better reusability and less boilerplate',
          effort: 'medium',
          autoFixable: true
        });
      }
    }

    return issues;
  }

  private generateMigrationPhases(
    migration: FrameworkMigration,
    issues: MigrationIssue[]
  ): MigrationPhase[] {
    const phases: MigrationPhase[] = [
      {
        name: 'Preparation',
        description: 'Set up development environment and dependencies',
        steps: [
          'Create new branch for migration',
          'Install required dependencies',
          'Set up testing environment'
        ],
        automatable: false,
        estimatedHours: 2
      },
      {
        name: 'Automated Migration',
        description: 'Run automated migration tools',
        steps: [
          'Run code transformation tools',
          'Apply automated fixes',
          'Update imports and dependencies'
        ],
        automatable: true,
        estimatedHours: 4
      },
      {
        name: 'Manual Fixes',
        description: 'Address issues requiring manual intervention',
        steps: [
          'Fix breaking changes',
          'Update complex components',
          'Resolve type errors'
        ],
        automatable: false,
        estimatedHours: issues.filter(i => !i.autoFixable).length * 0.5
      },
      {
        name: 'Testing',
        description: 'Comprehensive testing of migrated code',
        steps: [
          'Run unit tests',
          'Run integration tests',
          'Manual QA testing'
        ],
        automatable: false,
        estimatedHours: 8
      }
    ];

    return phases;
  }

  private estimateMigrationEffort(
    issues: MigrationIssue[],
    phases: MigrationPhase[]
  ): { hours: number; complexity: 'low' | 'medium' | 'high' | 'very-high' } {
    const totalHours = phases.reduce((sum, phase) => sum + phase.estimatedHours, 0);
    const criticalIssues = issues.filter(i => i.severity === 'critical').length;

    let complexity: 'low' | 'medium' | 'high' | 'very-high';
    if (criticalIssues > 10 || totalHours > 40) {
      complexity = 'very-high';
    } else if (criticalIssues > 5 || totalHours > 20) {
      complexity = 'high';
    } else if (totalHours > 10) {
      complexity = 'medium';
    } else {
      complexity = 'low';
    }

    return { hours: totalHours, complexity };
  }

  private identifyRisks(migration: FrameworkMigration, issues: MigrationIssue[]): string[] {
    const risks: string[] = [];

    const criticalIssues = issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      risks.push(`${criticalIssues.length} critical issues require immediate attention`);
    }

    const manualIssues = issues.filter(i => !i.autoFixable);
    if (manualIssues.length > 10) {
      risks.push(`${manualIssues.length} issues require manual intervention`);
    }

    risks.push('Potential runtime errors after migration');
    risks.push('Performance regressions possible');
    risks.push('Breaking changes may affect downstream consumers');

    return risks;
  }

  private getMigrationDescription(migration: FrameworkMigration): string {
    const descriptions: Record<FrameworkMigration, string> = {
      'react-class-to-hooks': 'Convert React class components to functional components with hooks',
      'vue2-to-vue3': 'Migrate from Vue 2 to Vue 3 (Composition API)',
      'angular-js-to-angular': 'Migrate from AngularJS to modern Angular',
      'express-to-fastify': 'Migrate Express.js application to Fastify',
      'jest-to-vitest': 'Convert Jest tests to Vitest',
      'webpack-to-vite': 'Migrate Webpack configuration to Vite',
      'cra-to-vite': 'Migrate Create React App to Vite',
      'redux-to-zustand': 'Migrate Redux state management to Zustand'
    };
    return descriptions[migration];
  }

  private getRequiredDependencies(migration: FrameworkMigration): string[] {
    const deps: Record<FrameworkMigration, string[]> = {
      'react-class-to-hooks': ['react@^18.0.0'],
      'vue2-to-vue3': ['vue@^3.0.0', '@vue/compat'],
      'angular-js-to-angular': ['@angular/core@^15.0.0'],
      'express-to-fastify': ['fastify@^4.0.0'],
      'jest-to-vitest': ['vitest@^0.34.0'],
      'webpack-to-vite': ['vite@^4.0.0'],
      'cra-to-vite': ['vite@^4.0.0', '@vitejs/plugin-react'],
      'redux-to-zustand': ['zustand@^4.0.0']
    };
    return deps[migration] || [];
  }

  private generateRollbackPlan(migration: FrameworkMigration): string[] {
    return [
      'Ensure all changes are committed in a separate branch',
      'Keep original code backed up',
      'Document all manual changes for reversal',
      'Maintain feature flags for gradual rollout',
      'Monitor error rates and performance metrics'
    ];
  }

  private async analyzeSingleDependencyUpgrade(
    pkg: string,
    currentVersion: string
  ): Promise<DependencyUpgrade> {
    // Simplified implementation
    return {
      package: pkg,
      currentVersion,
      targetVersion: 'latest',
      breakingChanges: [],
      deprecations: [],
      migrationSteps: [
        `Update ${pkg} to latest version`,
        'Review CHANGELOG for breaking changes',
        'Update usage patterns if needed'
      ],
      effort: 'medium',
      risk: 'low'
    };
  }

  private buildJsToTsPrompt(content: string, filePath: string): string {
    return `Convert the following JavaScript file to TypeScript with proper type annotations:

File: ${filePath}

\`\`\`javascript
${content.substring(0, 2000)}
\`\`\`

Requirements:
1. Add proper TypeScript types for all variables, parameters, and return values
2. Use interfaces for object structures
3. Add type guards where appropriate
4. Maintain all functionality
5. Return the complete converted TypeScript code

Return JSON format:
{
  "migratedCode": "...",
  "changes": [{"type": "...", "description": "..."}],
  "issues": []
}`;
  }

  private buildModernizationPrompt(
    content: string,
    filePath: string,
    modernizations: ModernizationType[]
  ): string {
    return `Modernize the following JavaScript code with these improvements: ${modernizations.join(', ')}

File: ${filePath}

\`\`\`javascript
${content.substring(0, 2000)}
\`\`\`

Apply these modernizations:
${modernizations.map(m => `- ${m}`).join('\n')}

Return JSON format with migrated code, changes, and any issues.`;
  }

  private parseConversionResponse(
    content: string,
    filePath: string,
    originalContent: string
  ): MigrationResult {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          file: filePath,
          originalContent,
          migratedContent: parsed.migratedCode || originalContent,
          changes: parsed.changes || [],
          issues: parsed.issues || [],
          success: true,
          manualStepsRequired: []
        };
      }
    } catch {
      // Parse failed
    }

    return {
      file: filePath,
      originalContent,
      migratedContent: originalContent,
      changes: [],
      issues: [],
      success: false,
      manualStepsRequired: ['Manual conversion required - AI parsing failed']
    };
  }

  private parseModernizationResponse(
    content: string,
    filePath: string,
    originalContent: string
  ): MigrationResult {
    return this.parseConversionResponse(content, filePath, originalContent);
  }

  private applyMigration(result: MigrationResult, backup: boolean = true): void {
    if (backup) {
      fs.writeFileSync(`${result.file}.backup`, result.originalContent);
    }
    fs.writeFileSync(result.file, result.migratedContent);
  }

  private async generateJsToTsPlan(options: MigrationOptions): Promise<MigrationPlan> {
    const index = await this.indexer.buildIndex();
    const jsFiles = Array.from(index.files.keys()).filter(f => f.endsWith('.js') || f.endsWith('.jsx'));

    return {
      type: 'language',
      target: 'TypeScript',
      description: 'Convert JavaScript codebase to TypeScript',
      affectedFiles: jsFiles,
      estimatedEffort: {
        hours: jsFiles.length * 0.5,
        complexity: jsFiles.length > 50 ? 'high' : 'medium'
      },
      phases: [
        {
          name: 'Setup',
          description: 'Install TypeScript and configure tsconfig.json',
          steps: ['Install TypeScript', 'Create tsconfig.json', 'Configure build tools'],
          automatable: false,
          estimatedHours: 2
        },
        {
          name: 'Conversion',
          description: 'Convert JavaScript files to TypeScript',
          steps: ['Rename .js to .ts', 'Add type annotations', 'Fix type errors'],
          automatable: true,
          estimatedHours: jsFiles.length * 0.3
        }
      ],
      risks: ['Type errors may reveal hidden bugs', 'Build configuration changes needed'],
      dependencies: ['typescript', '@types/node'],
      rollbackPlan: ['Keep .js files backed up', 'Use git to revert changes']
    };
  }

  private async generateModernizationPlan(
    targetPath: string,
    modernizations: ModernizationType[]
  ): Promise<MigrationPlan> {
    const index = await this.indexer.buildIndex();
    const files = Array.from(index.files.keys()).filter(f => f.endsWith('.js'));

    return {
      type: 'modernization',
      target: modernizations.join(', '),
      description: 'Modernize JavaScript codebase with ES6+ features',
      affectedFiles: files,
      estimatedEffort: {
        hours: files.length * 0.3,
        complexity: 'medium'
      },
      phases: [
        {
          name: 'Automated Modernization',
          description: 'Apply automated modernization transformations',
          steps: modernizations.map(m => `Apply ${m}`),
          automatable: true,
          estimatedHours: files.length * 0.2
        }
      ],
      risks: ['Behavior changes possible with async/await conversions'],
      dependencies: [],
      rollbackPlan: ['Use git to revert changes']
    };
  }

  private generateRecommendations(plan: MigrationPlan, issues: MigrationIssue[]): string[] {
    const recommendations: string[] = [];

    if (plan.estimatedEffort.complexity === 'very-high') {
      recommendations.push('🚨 Consider breaking this migration into smaller, incremental steps');
    }

    const criticalIssues = issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      recommendations.push(`⚠️ Address ${criticalIssues.length} critical issues before proceeding`);
    }

    if (issues.filter(i => !i.autoFixable).length > issues.length * 0.5) {
      recommendations.push('📝 Significant manual intervention required - allocate sufficient time');
    }

    recommendations.push('✅ Create comprehensive test suite before migration');
    recommendations.push('🔄 Migrate in iterations, testing after each phase');
    recommendations.push('📊 Monitor performance and error metrics post-migration');

    return recommendations;
  }
}
