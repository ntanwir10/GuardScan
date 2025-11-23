import chalk from 'chalk';
import ora from 'ora';
import { testRunner } from '../core/test-runner';
import { codeMetricsAnalyzer } from '../core/code-metrics';
import { codeSmellDetector } from '../core/code-smells';
import { linterIntegration } from '../core/linter-integration';
import { reporter, ReviewResult } from '../utils/reporter';
import { telemetryManager } from '../core/telemetry';
import { repositoryManager } from '../core/repository';
import { createProgressBar } from '../utils/progress';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('test');
const perfTracker = createPerformanceTracker('guardscan test');

interface TestOptions {
  coverage?: boolean;
  metrics?: boolean;
  smells?: boolean;
  lint?: boolean;
  all?: boolean;
}

export async function testCommand(options: TestOptions): Promise<void> {
  logger.debug('Test command started', { options });
  perfTracker.start('test-total');
  const startTime = Date.now();

  console.log(chalk.cyan.bold('\n🧪 Test & Quality Analysis\n'));

  try {
    perfTracker.start('detect-repository');
    const repoInfo = repositoryManager.getRepoInfo();
    perfTracker.end('detect-repository');
    logger.debug('Repository detected', { name: repoInfo.name });
    console.log(chalk.gray(`Repository: ${repoInfo.name}\n`));

    // Calculate total steps for progress tracking
    let totalSteps = 1; // Report generation
    if (options.all || !options.metrics && !options.smells && !options.lint) totalSteps++;
    if (options.all || options.metrics) totalSteps++;
    if (options.all || options.smells) totalSteps++;
    if (options.all || options.lint) totalSteps++;

    const progressBar = createProgressBar(totalSteps, 'Quality Analysis');
    let completedSteps = 0;

    const results: any = {
      tests: null,
      metrics: null,
      smells: null,
      linting: null,
    };

    // Run tests
    if (options.all || !options.metrics && !options.smells && !options.lint) {
      progressBar.update(completedSteps, { status: 'Running tests...' });
      try {
        results.tests = await testRunner.runTests(process.cwd(), options.coverage || false);
        completedSteps++;
        if (results.tests.length > 0) {
          progressBar.update(completedSteps, { status: `Tests: ${results.tests.length} framework(s)` });
          displayTestResults(results.tests);
        } else {
          progressBar.update(completedSteps, { status: 'No test frameworks detected' });
        }
      } catch (error) {
        completedSteps++;
        progressBar.update(completedSteps, { status: 'Test execution failed' });
      }
    }

    // Run code metrics analysis
    if (options.all || options.metrics) {
      progressBar.update(completedSteps, { status: 'Analyzing code metrics...' });
      try {
        results.metrics = await codeMetricsAnalyzer.analyze(process.cwd());
        completedSteps++;
        progressBar.update(completedSteps, { status: `Metrics: ${results.metrics.length} files` });
        displayMetricsResults(results.metrics);
      } catch (error) {
        completedSteps++;
        progressBar.update(completedSteps, { status: 'Metrics analysis failed' });
      }
    }

    // Detect code smells
    if (options.all || options.smells) {
      progressBar.update(completedSteps, { status: 'Detecting code smells...' });
      try {
        results.smells = await codeSmellDetector.detect(process.cwd());
        completedSteps++;
        progressBar.update(completedSteps, { status: `Smells: ${results.smells.length} issues` });
        displaySmellResults(results.smells);
      } catch (error) {
        completedSteps++;
        progressBar.update(completedSteps, { status: 'Code smell detection failed' });
      }
    }

    // Run linters
    if (options.all || options.lint) {
      progressBar.update(completedSteps, { status: 'Running linters...' });
      try {
        results.linting = await linterIntegration.runAll(process.cwd());
        completedSteps++;
        if (results.linting.length > 0) {
          progressBar.update(completedSteps, { status: `Linting: ${results.linting.length} linter(s)` });
          displayLintResults(results.linting);
        } else {
          progressBar.update(completedSteps, { status: 'No linters detected' });
        }
      } catch (error) {
        completedSteps++;
        progressBar.update(completedSteps, { status: 'Linting failed' });
      }
    }

    // Generate comprehensive report
    progressBar.update(completedSteps, { status: 'Generating report...' });
    const reviewResult: ReviewResult = {
      summary: generateQualitySummary(results),
      findings: convertToFindings(results),
      recommendations: generateQualityRecommendations(results),
      metadata: {
        timestamp: new Date().toISOString(),
        repoInfo,
        locStats: {
          totalLines: 0,
          codeLines: 0,
          commentLines: 0,
          blankLines: 0,
          fileCount: 0,
          fileBreakdown: [],
        },
        provider: 'quality-analyzer',
        model: 'multi-tool',
        durationMs: Date.now() - startTime,
      },
    };

    const reportPath = reporter.saveReport(reviewResult, 'markdown', undefined, 'quality');
    completedSteps++;
    progressBar.update(completedSteps, { status: 'Complete' });
    progressBar.stop();

    console.log(chalk.green(`✓ Report saved: ${reportPath}`));

    // Record telemetry
    await telemetryManager.record({
      action: 'test',
      loc: 0, // We don't count LOC for test command
      durationMs: Date.now() - startTime,
      model: 'quality-tools',
    });

    console.log();
  } catch (error) {
    handleCommandError(error, 'Test command');
  }
}

/**
 * Display test results
 */
function displayTestResults(testResults: any[]): void {
  console.log(chalk.white.bold('\n📊 Test Results:\n'));

  for (const result of testResults) {
    console.log(chalk.cyan(`  ${result.framework}:`));
    console.log(chalk.gray(`    Total: ${result.totalTests} tests`));

    if (result.passed > 0) {
      console.log(chalk.green(`    ✓ Passed: ${result.passed}`));
    }
    if (result.failed > 0) {
      console.log(chalk.red(`    ✗ Failed: ${result.failed}`));
    }
    if (result.skipped > 0) {
      console.log(chalk.yellow(`    ⊘ Skipped: ${result.skipped}`));
    }

    if (result.coverage) {
      console.log(chalk.gray(`    Coverage:`));
      console.log(chalk.gray(`      Lines: ${result.coverage.lines.toFixed(1)}%`));
      console.log(chalk.gray(`      Branches: ${result.coverage.branches.toFixed(1)}%`));
      console.log(chalk.gray(`      Functions: ${result.coverage.functions.toFixed(1)}%`));
    }

    if (result.failures.length > 0) {
      console.log(chalk.red(`\n    Failed Tests:`));
      result.failures.slice(0, 5).forEach((failure: any) => {
        console.log(chalk.red(`      • ${failure.testName}`));
        if (failure.file) {
          console.log(chalk.gray(`        ${failure.file}`));
        }
      });
      if (result.failures.length > 5) {
        console.log(chalk.gray(`      ... and ${result.failures.length - 5} more`));
      }
    }

    console.log();
  }
}

/**
 * Display metrics results
 */
function displayMetricsResults(metrics: any[]): void {
  console.log(chalk.white.bold('\n📏 Code Metrics Summary:\n'));

  const criticalIssues = metrics.flatMap(m => m.issues.filter((i: any) => i.severity === 'critical'));
  const highIssues = metrics.flatMap(m => m.issues.filter((i: any) => i.severity === 'high'));

  if (criticalIssues.length > 0) {
    console.log(chalk.red(`  🔴 Critical Issues: ${criticalIssues.length}`));
    criticalIssues.slice(0, 3).forEach((issue: any) => {
      console.log(chalk.red(`    • ${issue.type}: ${issue.description}`));
    });
  }

  if (highIssues.length > 0) {
    console.log(chalk.yellow(`  🟠 High Priority Issues: ${highIssues.length}`));
    highIssues.slice(0, 3).forEach((issue: any) => {
      console.log(chalk.yellow(`    • ${issue.type}: ${issue.description}`));
    });
  }

  // Average metrics
  const avgComplexity = metrics.reduce((sum, m) => sum + m.metrics.cyclomaticComplexity, 0) / metrics.length;
  const avgMaintainability = metrics.reduce((sum, m) => sum + m.metrics.maintainabilityIndex, 0) / metrics.length;

  console.log(chalk.gray(`\n  Average Cyclomatic Complexity: ${avgComplexity.toFixed(1)}`));
  console.log(chalk.gray(`  Average Maintainability Index: ${avgMaintainability.toFixed(1)}/100`));
  console.log();
}

/**
 * Display code smell results
 */
function displaySmellResults(smells: any[]): void {
  console.log(chalk.white.bold('\n👃 Code Smells:\n'));

  if (smells.length === 0) {
    console.log(chalk.green('  ✅ No code smells detected!'));
    return;
  }

  const byType = smells.reduce((acc, smell) => {
    acc[smell.type] = (acc[smell.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const sortedTypes = Object.entries(byType).sort(([, a], [, b]) => (b as number) - (a as number));

  sortedTypes.slice(0, 10).forEach(([type, count]) => {
    const severity = smells.find(s => s.type === type)?.severity;
    const color = severity === 'critical' || severity === 'high' ? chalk.red :
                  severity === 'medium' ? chalk.yellow : chalk.gray;
    console.log(color(`  • ${type}: ${count}`));
  });

  if (sortedTypes.length > 10) {
    console.log(chalk.gray(`  ... and ${sortedTypes.length - 10} more types`));
  }

  console.log(chalk.gray(`\n  Total: ${smells.length} code smells`));
  console.log();
}

/**
 * Display linting results
 */
function displayLintResults(lintReports: any[]): void {
  console.log(chalk.white.bold('\n🔍 Linting Results:\n'));

  for (const report of lintReports) {
    console.log(chalk.cyan(`  ${report.linter}:`));

    if (report.errors > 0) {
      console.log(chalk.red(`    ✗ Errors: ${report.errors}`));
    }
    if (report.warnings > 0) {
      console.log(chalk.yellow(`    ⚠ Warnings: ${report.warnings}`));
    }
    if (report.errors === 0 && report.warnings === 0) {
      console.log(chalk.green(`    ✓ No issues found`));
    }

    // Show top issues
    if (report.results.length > 0) {
      const topErrors = report.results.filter((r: any) => r.severity === 'error').slice(0, 3);
      if (topErrors.length > 0) {
        console.log(chalk.red(`\n    Top Errors:`));
        topErrors.forEach((error: any) => {
          console.log(chalk.red(`      • ${error.rule}: ${error.message}`));
          console.log(chalk.gray(`        ${error.file}:${error.line}`));
        });
      }
    }

    console.log();
  }
}

/**
 * Generate quality summary
 */
function generateQualitySummary(results: any): string {
  let summary = '# Code Quality Analysis Report\n\n';

  // Test summary
  if (results.tests && results.tests.length > 0) {
    summary += '## Test Results\n\n';
    for (const test of results.tests) {
      summary += `- **${test.framework}**: ${test.passed}/${test.totalTests} tests passing`;
      if (test.coverage) {
        summary += ` (${test.coverage.lines.toFixed(1)}% coverage)`;
      }
      summary += '\n';
    }
    summary += '\n';
  }

  // Metrics summary
  if (results.metrics && results.metrics.length > 0) {
    const issueCount = results.metrics.reduce((sum: number, m: any) => sum + m.issues.length, 0);
    summary += `## Code Metrics\n\n`;
    summary += `- Analyzed ${results.metrics.length} files\n`;
    summary += `- Found ${issueCount} metric issues\n\n`;
  }

  // Smells summary
  if (results.smells && results.smells.length > 0) {
    summary += `## Code Smells\n\n`;
    summary += `- Detected ${results.smells.length} code smells\n\n`;
  }

  // Linting summary
  if (results.linting && results.linting.length > 0) {
    summary += `## Linting\n\n`;
    for (const lint of results.linting) {
      summary += `- **${lint.linter}**: ${lint.errors} errors, ${lint.warnings} warnings\n`;
    }
    summary += '\n';
  }

  return summary;
}

/**
 * Convert results to findings
 */
function convertToFindings(results: any): any[] {
  const findings: any[] = [];

  // Test failures
  if (results.tests) {
    for (const test of results.tests) {
      for (const failure of test.failures || []) {
        findings.push({
          severity: 'high',
          category: `Test Failure (${test.framework})`,
          file: failure.file || 'unknown',
          line: failure.line,
          description: failure.testName,
          suggestion: 'Fix failing test',
        });
      }
    }
  }

  // Metrics issues
  if (results.metrics) {
    for (const metric of results.metrics) {
      for (const issue of metric.issues || []) {
        findings.push({
          severity: issue.severity,
          category: `Code Metrics: ${issue.type}`,
          file: metric.file,
          line: issue.line,
          description: issue.description,
          suggestion: issue.recommendation,
        });
      }
    }
  }

  // Code smells
  if (results.smells) {
    for (const smell of results.smells) {
      findings.push({
        severity: smell.severity,
        category: `Code Smell: ${smell.type}`,
        file: smell.file,
        line: smell.line,
        description: smell.description,
        suggestion: smell.recommendation,
      });
    }
  }

  // Linting issues
  if (results.linting) {
    for (const lint of results.linting) {
      for (const result of lint.results || []) {
        findings.push({
          severity: result.severity === 'error' ? 'high' : result.severity === 'warning' ? 'medium' : 'low',
          category: `${lint.linter}: ${result.rule}`,
          file: result.file,
          line: result.line,
          description: result.message,
          suggestion: 'Fix linting issue',
        });
      }
    }
  }

  return findings;
}

/**
 * Generate quality recommendations
 */
function generateQualityRecommendations(results: any): string[] {
  const recommendations: string[] = [];

  if (results.tests) {
    const failedTests = results.tests.reduce((sum: number, t: any) => sum + t.failed, 0);
    if (failedTests > 0) {
      recommendations.push(`Fix ${failedTests} failing test(s)`);
    }

    const lowCoverage = results.tests.some((t: any) => t.coverage && t.coverage.lines < 80);
    if (lowCoverage) {
      recommendations.push('Improve test coverage to at least 80%');
    }
  }

  if (results.metrics) {
    const highComplexity = results.metrics.some((m: any) => m.metrics.cyclomaticComplexity > 20);
    if (highComplexity) {
      recommendations.push('Reduce cyclomatic complexity by breaking down complex functions');
    }

    const lowMaintainability = results.metrics.some((m: any) => m.metrics.maintainabilityIndex < 60);
    if (lowMaintainability) {
      recommendations.push('Improve code maintainability through refactoring');
    }
  }

  if (results.smells && results.smells.length > 10) {
    recommendations.push(`Address ${results.smells.length} code smells to improve code quality`);
  }

  if (results.linting) {
    const totalErrors = results.linting.reduce((sum: number, l: any) => sum + l.errors, 0);
    if (totalErrors > 0) {
      recommendations.push(`Fix ${totalErrors} linting error(s)`);
    }
  }

  // General recommendations
  recommendations.push('Run quality checks regularly as part of CI/CD pipeline');
  recommendations.push('Consider setting up pre-commit hooks for automated checks');

  return recommendations;
}
