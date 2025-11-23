/**
 * refactor.ts - CLI command for refactoring suggestions
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { ConfigManager } from '../core/config';
import { repositoryManager } from '../core/repository';
import { ProviderFactory } from '../providers/factory';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('refactor');
const perfTracker = createPerformanceTracker('guardscan refactor');
import {
  RefactoringSuggestionsEngine,
  CodeSmell,
  PatternSuggestion,
  RefactoredCode,
  ImpactAnalysis
} from '../features/refactoring-suggestions';

interface RefactorOptions {
  file?: string;
  function?: string;
  class?: string;
  smell?: string;
  pattern?: string;
  analyze?: boolean;
  apply?: boolean;
  interactive?: boolean;
  report?: boolean;
  output?: string;
}

export async function refactorCommand(options: RefactorOptions): Promise<void> {
  logger.debug('Refactor command started', { options });
  perfTracker.start('refactor-total');
  
  console.log(chalk.blue('\n🔧 GuardScan Refactoring Assistant\n'));

  // Load configuration
  perfTracker.start('load-config');
  const configManager = new ConfigManager();
  const config = configManager.loadOrInit();
  perfTracker.end('load-config');
  logger.debug('Config loaded', { provider: config.provider });

  // Check AI provider
  if (!config.provider || config.provider === 'none' || !config.apiKey) {
    handleCommandError(new Error('AI provider not configured. Refactoring features require an AI provider. Configure with: guardscan config'), 'Refactor');
  }

  // Get repository info
  const spinner = ora('Analyzing repository...').start();
  const repoInfo = repositoryManager.getRepoInfo();
  if (!repoInfo.isGit) {
    spinner.warn('Not a git repository (continuing anyway)');
  } else {
    spinner.succeed(`Repository: ${repoInfo.path}`);
  }

  // Initialize AI provider
  const aiProvider = ProviderFactory.create(config.provider, config.apiKey, config.apiEndpoint);
  const refactoringEngine = new RefactoringSuggestionsEngine(
    aiProvider,
    repoInfo.path,
    repoInfo.repoId
  );

  // Handle different command modes
  if (options.report) {
    await generateFullReport(refactoringEngine, options.output);
  } else if (options.analyze) {
    await analyzeCodeSmells(refactoringEngine, options.file);
  } else if (options.pattern) {
    await suggestPatterns(refactoringEngine, options.file || repoInfo.path);
  } else if (options.apply) {
    await applyRefactoring(refactoringEngine, options);
  } else if (options.interactive) {
    await interactiveRefactoring(refactoringEngine, repoInfo.path);
  } else {
    // Default: show menu
    await interactiveRefactoring(refactoringEngine, repoInfo.path);
  }
}

/**
 * Generate full refactoring report
 */
async function generateFullReport(
  engine: RefactoringSuggestionsEngine,
  outputPath?: string
): Promise<void> {
  const spinner = ora('Analyzing codebase for refactoring opportunities...').start();

  try {
    const report = await engine.generateReport();
    spinner.succeed('Analysis complete');

    console.log(chalk.green('\n📊 Refactoring Report\n'));
    console.log(chalk.gray('═'.repeat(70)));

    // Summary
    console.log(chalk.bold('\nSummary:'));
    console.log(chalk.gray(`  Files analyzed:      ${report.summary.filesAnalyzed}`));
    console.log(chalk.gray(`  Code smells found:   ${report.summary.smellsDetected}`));
    console.log(chalk.gray(`  Patterns suggested:  ${report.summary.patternssuggested}`));
    console.log(chalk.gray(`  Improvement score:   ${report.summary.estimatedImprovementScore}/100`));

    // Top smells
    if (report.smells.length > 0) {
      console.log(chalk.bold('\n\nTop Code Smells:'));
      const topSmells = report.smells
        .sort((a, b) => {
          const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return severityOrder[a.severity] - severityOrder[b.severity];
        })
        .slice(0, 10);

      topSmells.forEach((smell, index) => {
        const severityColor = smell.severity === 'critical' || smell.severity === 'high'
          ? chalk.red
          : smell.severity === 'medium' ? chalk.yellow : chalk.gray;

        console.log(`\n${index + 1}. ${severityColor(smell.severity.toUpperCase())} - ${smell.type}`);
        console.log(chalk.gray(`   ${smell.file}:${smell.startLine}`));
        console.log(chalk.gray(`   ${smell.description}`));
        console.log(chalk.blue(`   💡 ${smell.suggestedRefactoring}`));
      });
    }

    // Pattern suggestions
    if (report.patterns.length > 0) {
      console.log(chalk.bold('\n\nDesign Pattern Suggestions:'));
      const topPatterns = report.patterns
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5);

      topPatterns.forEach((pattern, index) => {
        console.log(`\n${index + 1}. ${chalk.cyan(pattern.pattern.toUpperCase())} Pattern`);
        console.log(chalk.gray(`   Target: ${pattern.targetSymbol} (${pattern.file})`));
        console.log(chalk.gray(`   Confidence: ${(pattern.confidence * 100).toFixed(0)}%`));
        console.log(chalk.gray(`   ${pattern.rationale}`));
      });
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      console.log(chalk.bold('\n\nPrioritized Recommendations:'));
      report.recommendations.slice(0, 5).forEach((rec, index) => {
        const priorityColor = rec.priority === 'high'
          ? chalk.red
          : rec.priority === 'medium' ? chalk.yellow : chalk.gray;

        console.log(`\n${index + 1}. ${priorityColor(rec.priority.toUpperCase())} - ${rec.refactoring}`);
        console.log(chalk.gray(`   Impact: ${rec.impact}`));
        console.log(chalk.gray(`   Estimated time: ${rec.estimatedHours} hours`));
      });
    }

    console.log(chalk.gray('\n' + '═'.repeat(70)));

    // Save report if output specified
    if (outputPath) {
      const reportContent = generateMarkdownReport(report);
      fs.writeFileSync(outputPath, reportContent);
      console.log(chalk.green(`\n✓ Report saved to: ${outputPath}\n`));
    }

  } catch (error: any) {
    spinner.fail('Analysis failed');
    handleCommandError(error, 'Refactoring');
  }
}

/**
 * Analyze code smells only
 */
async function analyzeCodeSmells(
  engine: RefactoringSuggestionsEngine,
  targetFile?: string
): Promise<void> {
  const spinner = ora('Detecting code smells...').start();

  try {
    const smells = await engine.detectCodeSmells(targetFile);
    spinner.succeed(`Found ${smells.length} code smell${smells.length !== 1 ? 's' : ''}`);

    if (smells.length === 0) {
      console.log(chalk.green('\n✓ No code smells detected! Your code looks clean.\n'));
      return;
    }

    console.log(chalk.yellow(`\n⚠ Found ${smells.length} code smell${smells.length !== 1 ? 's' : ''}\n`));

    // Group by severity
    const bySeverity = {
      critical: smells.filter(s => s.severity === 'critical'),
      high: smells.filter(s => s.severity === 'high'),
      medium: smells.filter(s => s.severity === 'medium'),
      low: smells.filter(s => s.severity === 'low')
    };

    // Display by severity
    for (const [severity, items] of Object.entries(bySeverity)) {
      if (items.length === 0) continue;

      const severityColor = severity === 'critical' || severity === 'high'
        ? chalk.red
        : severity === 'medium' ? chalk.yellow : chalk.gray;

      console.log(severityColor(`\n${severity.toUpperCase()} (${items.length}):`));
      items.forEach(smell => {
        console.log(chalk.gray(`  • ${smell.file}:${smell.startLine} - ${smell.symbolName}`));
        console.log(chalk.gray(`    ${smell.description}`));
        console.log(chalk.blue(`    💡 ${smell.suggestedRefactoring}`));
      });
    }

    console.log('\n');
  } catch (error: any) {
    spinner.fail('Analysis failed');
    handleCommandError(error, 'Refactoring');
  }
}

/**
 * Suggest design patterns
 */
async function suggestPatterns(
  engine: RefactoringSuggestionsEngine,
  targetFile: string
): Promise<void> {
  const spinner = ora('Analyzing code for design patterns...').start();

  try {
    const patterns = await engine.suggestPatterns(targetFile);
    spinner.succeed(`Found ${patterns.length} pattern suggestion${patterns.length !== 1 ? 's' : ''}`);

    if (patterns.length === 0) {
      console.log(chalk.gray('\nNo design pattern suggestions for this file.\n'));
      return;
    }

    console.log(chalk.cyan(`\n🎨 Design Pattern Suggestions for ${targetFile}\n`));

    patterns.forEach((pattern, index) => {
      console.log(`${index + 1}. ${chalk.bold(pattern.pattern.toUpperCase())} Pattern`);
      console.log(chalk.gray(`   Confidence: ${(pattern.confidence * 100).toFixed(0)}%`));
      console.log(chalk.gray(`   Target: ${pattern.targetSymbol}`));
      console.log(chalk.gray(`\n   Rationale:`));
      console.log(chalk.gray(`   ${pattern.rationale}`));
      console.log(chalk.gray(`\n   Benefits:`));
      pattern.benefits.forEach(benefit => {
        console.log(chalk.gray(`   • ${benefit}`));
      });
      console.log(chalk.gray(`\n   Estimated effort: ${pattern.estimatedEffort}`));
      console.log('');
    });

  } catch (error: any) {
    spinner.fail('Analysis failed');
    handleCommandError(error, 'Refactoring');
  }
}

/**
 * Apply refactoring (generate refactored code)
 */
async function applyRefactoring(
  engine: RefactoringSuggestionsEngine,
  options: RefactorOptions
): Promise<void> {
  if (!options.file || !options.smell) {
    console.log(chalk.yellow('\n⚠ Please specify --file and --smell options.\n'));
    return;
  }

  const spinner = ora('Detecting code smells...').start();
  const smells = await engine.detectCodeSmells(options.file);
  const targetSmell = smells.find(s => s.type === options.smell);

  if (!targetSmell) {
    spinner.fail(`No ${options.smell} smell found in ${options.file}`);
    return;
  }

  spinner.text = 'Generating refactored code...';
  const refactored = await engine.generateRefactoredCode(options.file, targetSmell);
  spinner.succeed('Refactoring complete');

  console.log(chalk.green('\n✨ Refactored Code\n'));
  console.log(chalk.gray('═'.repeat(70)));
  console.log(chalk.bold('\nExplanation:'));
  console.log(refactored.refactored.explanation);
  console.log(chalk.bold('\nChanges:'));
  refactored.refactored.changes.forEach(change => {
    console.log(chalk.gray(`  • ${change}`));
  });

  console.log(chalk.bold('\nImprovements:'));
  console.log(chalk.gray(`  Complexity:      ${refactored.improvements.complexity}% reduction`));
  console.log(chalk.gray(`  Maintainability: ${refactored.improvements.maintainability}% improvement`));
  console.log(chalk.gray(`  Readability:     ${refactored.improvements.readability}% improvement`));

  console.log(chalk.bold(`\nConfidence: ${(refactored.confidence * 100).toFixed(0)}%`));

  // Show impact analysis
  const impactSpinner = ora('Analyzing impact...').start();
  const impact = await engine.analyzeImpact(options.file, refactored);
  impactSpinner.succeed('Impact analysis complete');

  displayImpactAnalysis(impact);

  // Ask if user wants to see the code
  const { showCode } = await inquirer.prompt([{
    type: 'confirm',
    name: 'showCode',
    message: 'Show refactored code?',
    default: true
  }]);

  if (showCode) {
    console.log(chalk.bold('\n\nRefactored Code:\n'));
    refactored.refactored.files.forEach(file => {
      console.log(chalk.cyan(`${file.path}:`));
      console.log(chalk.gray('─'.repeat(70)));
      console.log(file.content);
      console.log(chalk.gray('─'.repeat(70)));
    });
  }

  console.log('\n');
}

/**
 * Interactive refactoring mode
 */
async function interactiveRefactoring(
  engine: RefactoringSuggestionsEngine,
  repoPath: string
): Promise<void> {
  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'What would you like to do?',
    choices: [
      { name: '🔍 Detect code smells', value: 'smells' },
      { name: '🎨 Suggest design patterns', value: 'patterns' },
      { name: '✨ Generate refactored code', value: 'refactor' },
      { name: '📊 Full refactoring report', value: 'report' },
      { name: '❌ Exit', value: 'exit' }
    ]
  }]);

  if (action === 'exit') {
    console.log(chalk.gray('\nGoodbye!\n'));
    return;
  }

  if (action === 'smells') {
    await analyzeCodeSmells(engine);
    await interactiveRefactoring(engine, repoPath);
  } else if (action === 'patterns') {
    const { file } = await inquirer.prompt([{
      type: 'input',
      name: 'file',
      message: 'Enter file path:',
      validate: (input: string) => {
        if (!input) return 'File path is required';
        if (!fs.existsSync(input)) return 'File not found';
        return true;
      }
    }]);
    await suggestPatterns(engine, file);
    await interactiveRefactoring(engine, repoPath);
  } else if (action === 'report') {
    await generateFullReport(engine);
    await interactiveRefactoring(engine, repoPath);
  } else if (action === 'refactor') {
    // Get list of smells first
    const spinner = ora('Finding refactoring candidates...').start();
    const smells = await engine.detectCodeSmells();
    spinner.stop();

    if (smells.length === 0) {
      console.log(chalk.green('\n✓ No code smells detected!\n'));
      await interactiveRefactoring(engine, repoPath);
      return;
    }

    const { selectedSmell } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedSmell',
      message: 'Select a code smell to refactor:',
      choices: smells.slice(0, 20).map((smell, index) => ({
        name: `${smell.severity.toUpperCase()} - ${smell.type} in ${smell.symbolName} (${smell.file}:${smell.startLine})`,
        value: index
      }))
    }]);

    const smell = smells[selectedSmell];
    const refactoringSpinner = ora('Generating refactored code...').start();
    const refactored = await engine.generateRefactoredCode(smell.file, smell);
    refactoringSpinner.succeed('Refactoring complete');

    console.log(chalk.green('\n✨ Refactoring Suggestion\n'));
    console.log(refactored.refactored.explanation);

    const { applyChanges } = await inquirer.prompt([{
      type: 'confirm',
      name: 'applyChanges',
      message: 'Show refactored code?',
      default: true
    }]);

    if (applyChanges) {
      refactored.refactored.files.forEach(file => {
        console.log(chalk.cyan(`\n${file.path}:\n`));
        console.log(file.content);
      });
    }

    await interactiveRefactoring(engine, repoPath);
  }
}

/**
 * Display impact analysis
 */
function displayImpactAnalysis(impact: ImpactAnalysis): void {
  console.log(chalk.bold('\n\n📊 Impact Analysis\n'));
  console.log(chalk.gray('═'.repeat(70)));

  console.log(chalk.bold('\nAffected Files:'));
  console.log(chalk.gray(`  Total: ${impact.affectedFiles.length} file${impact.affectedFiles.length !== 1 ? 's' : ''}`));
  if (impact.affectedFiles.length > 0) {
    impact.affectedFiles.slice(0, 5).forEach(file => {
      console.log(chalk.gray(`  • ${file}`));
    });
    if (impact.affectedFiles.length > 5) {
      console.log(chalk.gray(`  ... and ${impact.affectedFiles.length - 5} more`));
    }
  }

  if (impact.affectedTests.length > 0) {
    console.log(chalk.bold('\nAffected Tests:'));
    console.log(chalk.gray(`  Total: ${impact.affectedTests.length} test file${impact.affectedTests.length !== 1 ? 's' : ''}`));
  }

  if (impact.breakingChanges.length > 0) {
    console.log(chalk.bold('\n⚠ Breaking Changes:'));
    impact.breakingChanges.forEach(change => {
      console.log(chalk.yellow(`  • ${change.type}: ${change.description}`));
      console.log(chalk.gray(`    Mitigation: ${change.mitigation}`));
    });
  }

  console.log(chalk.bold('\nEstimated Effort:'));
  console.log(chalk.gray(`  Time: ${impact.estimatedEffort.hours} hours`));
  console.log(chalk.gray(`  Complexity: ${impact.estimatedEffort.complexity}`));

  if (impact.risks.length > 0) {
    console.log(chalk.bold('\nRisks:'));
    impact.risks.forEach(risk => {
      const riskColor = risk.level === 'critical' || risk.level === 'high'
        ? chalk.red
        : risk.level === 'medium' ? chalk.yellow : chalk.gray;
      console.log(riskColor(`  • ${risk.level.toUpperCase()} - ${risk.description}`));
      console.log(chalk.gray(`    Mitigation: ${risk.mitigation}`));
    });
  }

  if (impact.recommendations.length > 0) {
    console.log(chalk.bold('\nRecommendations:'));
    impact.recommendations.forEach(rec => {
      console.log(chalk.gray(`  • ${rec}`));
    });
  }
}

/**
 * Generate markdown report
 */
function generateMarkdownReport(report: any): string {
  let md = '# Refactoring Report\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += '## Summary\n\n';
  md += `- Files Analyzed: ${report.summary.filesAnalyzed}\n`;
  md += `- Code Smells Found: ${report.summary.smellsDetected}\n`;
  md += `- Patterns Suggested: ${report.summary.patternssuggested}\n`;
  md += `- Improvement Score: ${report.summary.estimatedImprovementScore}/100\n\n`;

  if (report.smells.length > 0) {
    md += '## Code Smells\n\n';
    report.smells.forEach((smell: CodeSmell, index: number) => {
      md += `### ${index + 1}. ${smell.type} (${smell.severity})\n\n`;
      md += `- **File**: ${smell.file}:${smell.startLine}\n`;
      md += `- **Symbol**: ${smell.symbolName}\n`;
      md += `- **Description**: ${smell.description}\n`;
      md += `- **Suggestion**: ${smell.suggestedRefactoring}\n\n`;
    });
  }

  if (report.patterns.length > 0) {
    md += '## Design Pattern Suggestions\n\n';
    report.patterns.forEach((pattern: PatternSuggestion, index: number) => {
      md += `### ${index + 1}. ${pattern.pattern} Pattern\n\n`;
      md += `- **Target**: ${pattern.targetSymbol}\n`;
      md += `- **File**: ${pattern.file}\n`;
      md += `- **Confidence**: ${(pattern.confidence * 100).toFixed(0)}%\n`;
      md += `- **Rationale**: ${pattern.rationale}\n`;
      md += `- **Benefits**:\n`;
      pattern.benefits.forEach((benefit: string) => {
        md += `  - ${benefit}\n`;
      });
      md += '\n';
    });
  }

  return md;
}
