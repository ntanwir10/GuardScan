/**
 * review.ts - CLI Command for Interactive Code Review
 *
 * Provides AI-powered code review for git diffs with:
 * - Automated review comments
 * - Inline suggestions
 * - Best practice recommendations
 * - Overall assessment
 *
 * Phase 5, Feature 4
 */

import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import {
  CodeReviewEngine,
  ReviewOptions,
  ReviewCategory,
  ReviewSeverity
} from '../features/code-review';
import { AICache } from '../core/ai-cache';
import { repositoryManager } from '../core/repository';
import { ProviderFactory } from '../providers/factory';
import { ConfigManager } from '../core/config';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('review');
const perfTracker = createPerformanceTracker('guardscan review');

interface ReviewCommandOptions {
  base?: string;
  head?: string;
  file?: string;
  severity?: ReviewSeverity;
  category?: string;
  report?: boolean;
  output?: string;
}

/**
 * Main review command
 */
export async function reviewCommand(options: ReviewCommandOptions): Promise<void> {
  logger.debug('Review command started', { options });
  perfTracker.start('review-total');
  
  console.log(chalk.blue('\n📝 GuardScan Code Review\n'));

  const spinner = ora('Initializing code review...').start();

  try {
    // Load configuration
    perfTracker.start('load-config');
    const configManager = new ConfigManager();
    const config = configManager.loadOrInit();
    perfTracker.end('load-config');
    logger.debug('Config loaded', { provider: config.provider });

    // Check AI provider
    if (!config.provider || config.provider === 'none' || !config.apiKey) {
      spinner.fail('No AI provider configured');
      console.log(chalk.yellow('\nCode review requires an AI provider.'));
      console.log(chalk.gray('Configure with: guardscan config\n'));
      return;
    }

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    if (!repoInfo.isGit) {
      spinner.fail('Not a git repository');
      console.log(chalk.yellow('\nCode review requires a git repository'));
      return;
    }

    spinner.succeed(`Repository: ${repoInfo.path}`);

    // Initialize components
    const provider = ProviderFactory.create(config.provider, config.apiKey, config.apiEndpoint, config.model);
    const cache = new AICache(repoInfo.repoId);
    const engine = new CodeReviewEngine(provider, cache, repoInfo.path);

    spinner.text = 'Analyzing changes...';

    // Build review options
    const reviewOptions: ReviewOptions = {
      base: options.base || 'HEAD',
      head: options.head,
      files: options.file ? [options.file] : undefined,
      minSeverity: options.severity,
      categories: options.category ? [options.category as ReviewCategory] : undefined
    };

    // Perform review
    const report = await engine.reviewChanges(reviewOptions);
    spinner.succeed('Review completed');

    // Display or save report
    if (options.report) {
      await generateFullReport(report, options.output);
    } else {
      displaySummary(report);
    }

  } catch (error: any) {
    spinner.fail('Review failed');
    handleCommandError(error, 'Code review');
  }
}

/**
 * Display review summary
 */
function displaySummary(report: any): void {
  console.log(chalk.blue('\n=== Review Summary ===\n'));

  // Changes
  console.log(chalk.white('Changes:'));
  console.log(`  Files changed: ${report.summary.filesChanged}`);
  console.log(chalk.green(`  Additions:     ${report.summary.additions}`));
  console.log(chalk.red(`  Deletions:     ${report.summary.deletions}`));

  // Comments by severity
  console.log(chalk.white('\nComments:'));
  console.log(`  Total:         ${report.summary.totalComments}`);
  if (report.summary.critical > 0) {
    console.log(chalk.red.bold(`  Critical:      ${report.summary.critical}`));
  }
  if (report.summary.high > 0) {
    console.log(chalk.red(`  High:          ${report.summary.high}`));
  }
  if (report.summary.medium > 0) {
    console.log(chalk.yellow(`  Medium:        ${report.summary.medium}`));
  }
  if (report.summary.low > 0) {
    console.log(chalk.gray(`  Low:           ${report.summary.low}`));
  }

  // Overall assessment
  console.log(chalk.blue('\n=== Assessment ===\n'));
  console.log(`Score:   ${getScoreDisplay(report.overallAssessment.score)}`);
  console.log(`Verdict: ${getVerdictDisplay(report.overallAssessment.verdict)}`);
  console.log(`\n${report.overallAssessment.summary}\n`);

  if (report.overallAssessment.strengths.length > 0) {
    console.log(chalk.green('Strengths:'));
    for (const strength of report.overallAssessment.strengths) {
      console.log(chalk.green(`  ✓ ${strength}`));
    }
    console.log('');
  }

  if (report.overallAssessment.concerns.length > 0) {
    console.log(chalk.yellow('Concerns:'));
    for (const concern of report.overallAssessment.concerns) {
      console.log(chalk.yellow(`  ! ${concern}`));
    }
    console.log('');
  }

  // Top comments
  if (report.comments.length > 0) {
    console.log(chalk.blue('=== Top Issues ===\n'));

    const topComments = report.comments
      .filter((c: any) => c.severity === 'critical' || c.severity === 'high')
      .slice(0, 10);

    for (const comment of topComments) {
      const severityColor = getSeverityColor(comment.severity);
      console.log(severityColor(`[${comment.severity.toUpperCase()}] ${comment.file}:${comment.line}`));
      console.log(`  ${comment.message}`);

      if (comment.suggestion) {
        console.log(chalk.gray(`  Suggestion: ${comment.suggestion}`));
      }

      console.log(chalk.gray(`  Category: ${comment.category}`));
      console.log('');
    }
  }

  // Next steps
  console.log(chalk.gray('Run with --report to generate full detailed report'));
  console.log(chalk.gray('Run with --severity <level> to filter by severity'));
}

/**
 * Generate full report
 */
async function generateFullReport(report: any, outputPath?: string): Promise<void> {
  let markdown = '# Code Review Report\n\n';
  markdown += `**Generated:** ${report.generatedAt.toISOString()}\n\n`;

  // Summary
  markdown += '## Summary\n\n';
  markdown += `- **Files Changed:** ${report.summary.filesChanged}\n`;
  markdown += `- **Additions:** ${report.summary.additions}\n`;
  markdown += `- **Deletions:** ${report.summary.deletions}\n`;
  markdown += `- **Total Comments:** ${report.summary.totalComments}\n`;
  markdown += `- **Critical:** ${report.summary.critical}\n`;
  markdown += `- **High:** ${report.summary.high}\n`;
  markdown += `- **Medium:** ${report.summary.medium}\n`;
  markdown += `- **Low:** ${report.summary.low}\n\n`;

  // Overall Assessment
  markdown += '## Overall Assessment\n\n';
  markdown += `**Score:** ${report.overallAssessment.score}/100\n\n`;
  markdown += `**Verdict:** ${report.overallAssessment.verdict}\n\n`;
  markdown += `${report.overallAssessment.summary}\n\n`;

  if (report.overallAssessment.strengths.length > 0) {
    markdown += '### Strengths\n\n';
    for (const strength of report.overallAssessment.strengths) {
      markdown += `- ✅ ${strength}\n`;
    }
    markdown += '\n';
  }

  if (report.overallAssessment.concerns.length > 0) {
    markdown += '### Concerns\n\n';
    for (const concern of report.overallAssessment.concerns) {
      markdown += `- ⚠️ ${concern}\n`;
    }
    markdown += '\n';
  }

  // Comments by severity
  const severities: ReviewSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

  for (const severity of severities) {
    const comments = report.comments.filter((c: any) => c.severity === severity);
    if (comments.length === 0) continue;

    markdown += `## ${severity.charAt(0).toUpperCase() + severity.slice(1)} Issues\n\n`;

    for (const comment of comments) {
      markdown += `### ${comment.file}:${comment.line}\n\n`;
      markdown += `**Category:** ${comment.category}\n\n`;
      markdown += `${comment.message}\n\n`;

      if (comment.suggestion) {
        markdown += `**Suggestion:**\n\`\`\`\n${comment.suggestion}\n\`\`\`\n\n`;
      }

      markdown += `**Reasoning:** ${comment.reasoning}\n\n`;
      markdown += `**Auto-fixable:** ${comment.autoFixable ? 'Yes' : 'No'}\n\n`;
      markdown += '---\n\n';
    }
  }

  // File changes
  markdown += '## Changed Files\n\n';
  markdown += '| File | Status | Additions | Deletions |\n';
  markdown += '|------|--------|-----------|----------|\n';
  for (const diff of report.diffs) {
    markdown += `| ${diff.file} | ${diff.status} | +${diff.additions} | -${diff.deletions} |\n`;
  }
  markdown += '\n';

  // Save or display
  if (outputPath) {
    fs.writeFileSync(outputPath, markdown);
    console.log(chalk.green(`\n✓ Report saved to: ${outputPath}`));
  } else {
    console.log('\n' + markdown);
  }
}

/**
 * Get score display with color
 */
function getScoreDisplay(score: number): string {
  if (score >= 90) return chalk.green.bold(`${score}/100`);
  if (score >= 75) return chalk.green(`${score}/100`);
  if (score >= 60) return chalk.yellow(`${score}/100`);
  return chalk.red(`${score}/100`);
}

/**
 * Get verdict display with color
 */
function getVerdictDisplay(verdict: string): string {
  switch (verdict) {
    case 'approved':
      return chalk.green.bold('✓ APPROVED');
    case 'approved-with-comments':
      return chalk.green('✓ APPROVED (with comments)');
    case 'changes-requested':
      return chalk.yellow('⚠ CHANGES REQUESTED');
    case 'rejected':
      return chalk.red('✗ REJECTED');
    default:
      return verdict;
  }
}

/**
 * Get severity color
 */
function getSeverityColor(severity: string): (text: string) => string {
  switch (severity) {
    case 'critical':
      return chalk.red.bold;
    case 'high':
      return chalk.red;
    case 'medium':
      return chalk.yellow;
    case 'low':
      return chalk.gray;
    case 'info':
      return chalk.blue;
    default:
      return chalk.white;
  }
}
