import chalk from 'chalk';
import ora from 'ora';
import { ruleEngine, Rule } from '../core/rule-engine';
import { repositoryManager } from '../core/repository';
import { createProgressBar } from '../utils/progress';
import * as fs from 'fs';
import * as path from 'path';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('rules');
const perfTracker = createPerformanceTracker('guardscan rules');

interface RulesOptions {
  list?: boolean;
  run?: boolean;
  fix?: boolean;
  ruleIds?: string;
  files?: string;
  customRules?: string;
  export?: string;
}

export async function rulesCommand(options: RulesOptions): Promise<void> {
  logger.debug('Rules command started', { options });
  perfTracker.start('rules-total');
  
  console.log(chalk.cyan.bold('\n📜 Custom Rules Engine\n'));

  try {
    perfTracker.start('detect-repository');
    const repoPath = process.cwd();
    const repoInfo = repositoryManager.getRepoInfo();
    perfTracker.end('detect-repository');
    logger.debug('Repository detected', { name: repoInfo.name });

    // List rules
    if (options.list) {
      // Load custom rules first
      if (options.customRules) {
        const spinner = ora('Loading custom rules...').start();
        ruleEngine.loadCustomRules(options.customRules);
        spinner.succeed(`Custom rules loaded from ${options.customRules}`);
      } else {
        ruleEngine.loadCustomRules();
      }

      displayRules();
      return;
    }

    // Export rule
    if (options.export) {
      // Load custom rules first
      if (options.customRules) {
        const spinner = ora('Loading custom rules...').start();
        ruleEngine.loadCustomRules(options.customRules);
        spinner.succeed(`Custom rules loaded from ${options.customRules}`);
      } else {
        ruleEngine.loadCustomRules();
      }

      const [ruleId, outputPath] = options.export.split(':');
      exportRule(ruleId, outputPath);
      return;
    }

    // Run rules (default mode)
    if (options.run !== false) {  // Default to true
      console.log(chalk.gray(`Repository: ${repoInfo.name}\n`));

      // Calculate total steps for progress tracking
      let totalSteps = 4; // Load rules, Scan files, Run rules, Save results
      if (options.fix) totalSteps++; // Apply autofixes

      const progressBar = createProgressBar(totalSteps, 'Rules Engine');
      let completedSteps = 0;

      // Step 1: Load custom rules
      progressBar.update(completedSteps, { status: 'Loading rules...' });

      if (options.customRules) {
        ruleEngine.loadCustomRules(options.customRules);
      } else {
        ruleEngine.loadCustomRules();
      }

      completedSteps++;
      progressBar.update(completedSteps, { status: 'Rules loaded' });

      // Step 2: Get files to scan
      progressBar.update(completedSteps, { status: 'Scanning files...' });

      const files = options.files
        ? options.files.split(',').map(f => f.trim())
        : getAllFiles(repoPath);

      completedSteps++;
      progressBar.update(completedSteps, { status: `Found ${files.length} files` });

      // Parse rule IDs if specified
      const ruleIds = options.ruleIds
        ? options.ruleIds.split(',').map(id => id.trim())
        : undefined;

      // Step 3: Run rules
      progressBar.update(completedSteps, { status: 'Running custom rules...' });

      const result = await ruleEngine.runRules(files, ruleIds);

      completedSteps++;
      progressBar.update(completedSteps, { status: `Found ${result.totalViolations} violations` });

      // Display results
      displayResults(result);

      // Step 4 (optional): Apply autofixes if requested
      if (options.fix && result.violations.some(v => v.autofix?.available)) {
        progressBar.update(completedSteps, { status: 'Applying auto-fixes...' });

        console.log(chalk.yellow('\n🔧 Applying auto-fixes...\n'));

        const fixableViolations = result.violations.filter(v => v.autofix?.available);
        console.log(chalk.gray(`  ${fixableViolations.length} violations can be auto-fixed\n`));

        const fixedCount = await ruleEngine.applyAutofixes(result.violations);

        console.log(chalk.green(`\n✓ Fixed ${fixedCount} violations automatically\n`));

        completedSteps++;
        progressBar.update(completedSteps, { status: `Applied ${fixedCount} auto-fixes` });
      }

      // Final step: Save results
      progressBar.update(completedSteps, { status: 'Saving results...' });

      const resultsPath = path.join(repoPath, '.guardscan', 'rules-results.json');
      const dir = path.dirname(resultsPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resultsPath, JSON.stringify(result, null, 2));

      completedSteps++;
      progressBar.update(completedSteps, { status: 'Complete' });
      progressBar.stop();

      console.log(chalk.gray(`  Results saved: ${resultsPath}\n`));

      // Exit with error if violations found
      if (result.totalViolations > 0 && (result.severitySummary.critical > 0 || result.severitySummary.high > 0)) {
        console.log(chalk.red('  ✗ Critical or high severity violations found\n'));
        handleCommandError(new Error('Critical or high severity violations found'), 'Rules');
      }
    }

  } catch (error: any) {
    handleCommandError(error, 'Rules engine');
  }
}

/**
 * Display all loaded rules
 */
function displayRules(): void {
  const rules = ruleEngine.getRules();

  console.log(chalk.white.bold(`📋 Loaded Rules (${rules.length}):\n`));

  // Group by category
  const byCategory = new Map<string, Rule[]>();
  for (const rule of rules) {
    if (!byCategory.has(rule.category)) {
      byCategory.set(rule.category, []);
    }
    byCategory.get(rule.category)!.push(rule);
  }

  // Display by category
  for (const [category, categoryRules] of byCategory.entries()) {
    console.log(chalk.cyan(`\n  ${category.toUpperCase()} (${categoryRules.length}):\n`));

    for (const rule of categoryRules) {
      const severityColor = getSeverityColor(rule.severity);
      const autofixBadge = rule.autofix ? chalk.green(' [autofix]') : '';
      const semgrepBadge = rule.semgrep ? chalk.blue(' [semgrep]') : '';

      console.log(severityColor(`    ${rule.severity.toUpperCase().padEnd(8)} `) +
        chalk.white(`${rule.id}`) +
        autofixBadge +
        semgrepBadge);
      console.log(chalk.gray(`              ${rule.name}`));

      if (rule.languages) {
        console.log(chalk.gray(`              Languages: ${rule.languages.join(', ')}`));
      }

      if (rule.metadata?.cwe) {
        console.log(chalk.gray(`              CWE: ${rule.metadata.cwe.join(', ')}`));
      }

      console.log();
    }
  }

  console.log(chalk.white.bold('Legend:'));
  console.log(chalk.gray('  [autofix] - Automatic fix available'));
  console.log(chalk.gray('  [semgrep] - Uses Semgrep pattern matching'));
  console.log();
}

/**
 * Display rule results
 */
function displayResults(result: any): void {
  console.log(chalk.white.bold('\n📊 Results:\n'));

  // Severity summary
  console.log(chalk.cyan('  Severity Summary:'));
  if (result.severitySummary.critical > 0) {
    console.log(chalk.red(`    🔴 Critical: ${result.severitySummary.critical}`));
  }
  if (result.severitySummary.high > 0) {
    console.log(chalk.red(`    🟠 High: ${result.severitySummary.high}`));
  }
  if (result.severitySummary.medium > 0) {
    console.log(chalk.yellow(`    🟡 Medium: ${result.severitySummary.medium}`));
  }
  if (result.severitySummary.low > 0) {
    console.log(chalk.blue(`    🔵 Low: ${result.severitySummary.low}`));
  }
  if (result.severitySummary.info > 0) {
    console.log(chalk.gray(`    ℹ️  Info: ${result.severitySummary.info}`));
  }

  // Rules summary
  console.log(chalk.cyan('\n  Rules Triggered:'));
  const sortedRules = Object.entries(result.rulesSummary)
    .sort((a: any, b: any) => b[1].count - a[1].count)
    .slice(0, 10);

  for (const [ruleId, stats] of sortedRules) {
    const statsTyped = stats as any;
    const severityColor = getSeverityColor(statsTyped.severity);
    console.log(severityColor(`    ${ruleId}: ${statsTyped.count} violations`));
  }

  if (Object.keys(result.rulesSummary).length > 10) {
    console.log(chalk.gray(`    ... and ${Object.keys(result.rulesSummary).length - 10} more rules`));
  }

  // Top violations
  if (result.violations.length > 0) {
    console.log(chalk.white.bold('\n🔴 Top Violations:\n'));

    const criticalAndHigh = result.violations
      .filter((v: any) => v.severity === 'critical' || v.severity === 'high')
      .slice(0, 10);

    for (const violation of criticalAndHigh) {
      const severityColor = getSeverityColor(violation.severity);
      console.log(severityColor(`  ${violation.severity.toUpperCase()} - ${violation.ruleName}`));
      console.log(chalk.gray(`    ${violation.file}:${violation.line}:${violation.column || 0}`));
      console.log(chalk.white(`    ${violation.message}`));

      if (violation.suggestion) {
        console.log(chalk.gray(`    💡 ${violation.suggestion}`));
      }

      if (violation.autofix?.available) {
        console.log(chalk.green(`    🔧 ${violation.autofix.description}`));
      }

      console.log();
    }

    if (result.violations.length > criticalAndHigh.length) {
      console.log(chalk.gray(`  ... and ${result.violations.length - criticalAndHigh.length} more violations\n`));
    }
  }

  // Autofix summary
  const autofixable = result.violations.filter((v: any) => v.autofix?.available).length;
  if (autofixable > 0) {
    console.log(chalk.white.bold('🔧 Auto-fix:'));
    console.log(chalk.green(`  ${autofixable} violations can be automatically fixed`));
    console.log(chalk.gray('  Run with --fix to apply auto-fixes\n'));
  }
}

/**
 * Export a rule to file
 */
function exportRule(ruleId: string, outputPath: string): void {
  const rule = ruleEngine.getRule(ruleId);

  if (!rule) {
    console.error(chalk.red(`\n✗ Rule not found: ${ruleId}\n`));
    process.exit(1);
  }

  const spinner = ora(`Exporting rule ${ruleId}...`).start();

  try {
    ruleEngine.exportRule(rule, outputPath);
    spinner.succeed(`Rule exported to ${outputPath}`);
    console.log();
  } catch (error: any) {
    spinner.fail('Export failed');
    console.error(chalk.red(`\n✗ Export failed: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * Get all files in directory (excluding node_modules, etc.)
 */
function getAllFiles(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    // Skip excluded directories
    if (stat.isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'build', 'coverage', '.next'].includes(file)) {
        getAllFiles(filePath, fileList);
      }
    } else {
      // Include source files
      const ext = path.extname(file);
      if (['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs', '.rb'].includes(ext)) {
        fileList.push(filePath);
      }
    }
  }

  return fileList;
}

/**
 * Get color for severity
 */
function getSeverityColor(severity: string): (text: string) => string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return chalk.red;
    case 'high':
      return chalk.red;
    case 'medium':
      return chalk.yellow;
    case 'low':
      return chalk.blue;
    case 'info':
      return chalk.gray;
    default:
      return chalk.white;
  }
}
