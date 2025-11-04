import chalk from 'chalk';
import ora from 'ora';
import { configManager } from '../core/config';
import { repositoryManager } from '../core/repository';
import { locCounter } from '../core/loc-counter';
import { ProviderFactory } from '../providers/factory';
import { reporter, ReviewResult } from '../utils/reporter';
import { telemetryManager } from '../core/telemetry';
import { apiClient } from '../utils/api-client';
import { isOnline } from '../utils/network';
import * as fs from 'fs';
import * as path from 'path';

interface RunOptions {
  files?: string[];
  noCloud?: boolean;
}

export async function runCommand(options: RunOptions): Promise<void> {
  const startTime = Date.now();

  console.log(chalk.cyan.bold('\n🔍 AI Code Review\n'));

  try {
    // Load config
    const config = configManager.load();

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    console.log(chalk.gray(`Repository: ${repoInfo.name}`));
    if (repoInfo.branch) {
      console.log(chalk.gray(`Branch: ${repoInfo.branch}`));
    }

    // Count LOC
    const spinner = ora('Analyzing codebase...').start();
    const locResult = await locCounter.count(options.files);
    spinner.succeed(`Analyzed ${locResult.fileCount} files (${locResult.codeLines.toLocaleString()} LOC)`);

    // Validate credits (if online and not in offline mode)
    const online = await isOnline();
    if (online && !config.offlineMode && !options.noCloud) {
      const validateSpinner = ora('Validating credits...').start();
      try {
        const validation = await apiClient.validate({
          clientId: config.clientId,
          repoId: repoInfo.repoId,
          locCount: locResult.codeLines,
        });

        if (!validation.allowed) {
          validateSpinner.fail('Insufficient credits');
          console.log(chalk.yellow('\n⚠ You do not have enough credits for this review'));
          console.log(chalk.gray(`  Required: ${locResult.codeLines.toLocaleString()} LOC`));
          console.log(chalk.gray(`  Available: ${validation.remainingLoc.toLocaleString()} LOC`));
          console.log(chalk.cyan('\n  Purchase more credits or run with --no-cloud flag\n'));
          process.exit(1);
        }

        validateSpinner.succeed(`Credits validated (${validation.remainingLoc.toLocaleString()} LOC remaining)`);
      } catch (error) {
        validateSpinner.warn('Could not validate credits (proceeding anyway)');
      }
    }

    // Initialize AI provider
    const reviewSpinner = ora('Running code review...').start();
    const provider = ProviderFactory.create(config.provider, config.apiKey, config.apiEndpoint);

    if (!provider.isAvailable()) {
      reviewSpinner.fail('AI provider not configured');
      console.log(chalk.red('\n✗ AI provider is not available'));
      console.log(chalk.gray('  Run "ai-review config" to set up your AI provider\n'));
      process.exit(1);
    }

    // Prepare context for AI
    const context = await prepareReviewContext(repoInfo, locResult, options.files);

    // Send to AI for review
    const aiResponse = await provider.chat([
      {
        role: 'system',
        content: `You are an expert code reviewer. Analyze the provided code and identify:
- Code quality issues
- Potential bugs
- Security vulnerabilities
- Performance problems
- Best practice violations
- Maintainability concerns

Provide constructive feedback with specific suggestions for improvement.`,
      },
      {
        role: 'user',
        content: context,
      },
    ]);

    reviewSpinner.succeed('Code review completed');

    // Parse AI response into structured format
    const reviewResult = parseAIResponse(aiResponse.content, repoInfo, locResult, config.provider, aiResponse.model, Date.now() - startTime);

    // Generate report
    console.log(chalk.gray('\nGenerating report...'));
    const reportPath = reporter.saveReport(reviewResult, 'markdown');
    console.log(chalk.green(`✓ Report saved: ${reportPath}`));

    // Display summary
    displaySummary(reviewResult);

    // Record telemetry
    await telemetryManager.record({
      action: 'review',
      loc: locResult.codeLines,
      durationMs: Date.now() - startTime,
      model: aiResponse.model,
    });

    console.log();
  } catch (error) {
    console.error(chalk.red('\n✗ Code review failed:'), error);
    process.exit(1);
  }
}

/**
 * Prepare context for AI review
 */
async function prepareReviewContext(repoInfo: any, locResult: any, filePatterns?: string[]): Promise<string> {
  let context = `# Code Review Request\n\n`;
  context += `Repository: ${repoInfo.name}\n`;
  context += `Total Files: ${locResult.fileCount}\n`;
  context += `Code Lines: ${locResult.codeLines}\n\n`;

  // Include file breakdown
  context += `## Files Analyzed:\n\n`;
  for (const file of locResult.fileBreakdown.slice(0, 20)) {
    context += `- ${file.path} (${file.codeLines} LOC, ${file.language})\n`;
  }

  if (locResult.fileBreakdown.length > 20) {
    context += `\n... and ${locResult.fileBreakdown.length - 20} more files\n`;
  }

  // Sample some file contents (limited to avoid token limits)
  context += `\n## Code Samples:\n\n`;
  const filesToSample = locResult.fileBreakdown
    .filter((f: any) => f.codeLines > 10 && f.codeLines < 500)
    .slice(0, 5);

  for (const file of filesToSample) {
    try {
      const content = fs.readFileSync(file.path, 'utf-8');
      const lines = content.split('\n').slice(0, 100); // Limit to first 100 lines
      context += `### ${file.path}\n\n\`\`\`${file.language.toLowerCase()}\n${lines.join('\n')}\n\`\`\`\n\n`;
    } catch {
      // Skip files that can't be read
    }
  }

  context += `\nPlease provide a comprehensive code review covering code quality, potential bugs, security issues, performance, and best practices.`;

  return context;
}

/**
 * Parse AI response into structured review result
 */
function parseAIResponse(
  content: string,
  repoInfo: any,
  locResult: any,
  provider: string,
  model: string,
  durationMs: number
): ReviewResult {
  // Basic parsing - in production, you'd want more sophisticated parsing
  const lines = content.split('\n');

  const summary = content.substring(0, 500); // First 500 chars as summary

  const findings = []; // Parse findings from AI response
  const recommendations = []; // Parse recommendations

  // Simple pattern matching (you'd want to improve this)
  for (const line of lines) {
    if (line.toLowerCase().includes('critical') || line.toLowerCase().includes('security')) {
      findings.push({
        severity: 'high' as const,
        category: 'Security',
        file: 'various',
        description: line.trim(),
      });
    }
  }

  return {
    summary: content.trim(),
    findings,
    recommendations,
    metadata: {
      timestamp: new Date().toISOString(),
      repoInfo,
      locStats: locResult,
      provider,
      model,
      durationMs,
    },
  };
}

/**
 * Display review summary
 */
function displaySummary(result: ReviewResult): void {
  console.log(chalk.white.bold('\n📋 Review Summary:'));

  const criticalCount = result.findings.filter(f => f.severity === 'critical').length;
  const highCount = result.findings.filter(f => f.severity === 'high').length;
  const mediumCount = result.findings.filter(f => f.severity === 'medium').length;
  const lowCount = result.findings.filter(f => f.severity === 'low').length;

  if (criticalCount > 0) {
    console.log(chalk.red(`  🔴 Critical: ${criticalCount}`));
  }
  if (highCount > 0) {
    console.log(chalk.red(`  🟠 High: ${highCount}`));
  }
  if (mediumCount > 0) {
    console.log(chalk.yellow(`  🟡 Medium: ${mediumCount}`));
  }
  if (lowCount > 0) {
    console.log(chalk.blue(`  🔵 Low: ${lowCount}`));
  }

  if (result.findings.length === 0) {
    console.log(chalk.green('  ✅ No major issues found!'));
  }

  if (result.recommendations.length > 0) {
    console.log(chalk.white(`\n  ${result.recommendations.length} recommendations provided`));
  }
}
