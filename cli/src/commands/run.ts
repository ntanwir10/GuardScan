import chalk from 'chalk';
import ora from 'ora';
import { configManager } from '../core/config';
import { repositoryManager, RepositoryInfo } from '../core/repository';
import { locCounter, LOCResult } from '../core/loc-counter';
import {
  ProviderConfigurationError,
  ProviderFactory,
} from '../providers/factory';
import { Finding, reporter, ReviewResult } from '../utils/reporter';
import { createTelemetryManager } from '../core/telemetry';
import { displaySimpleBanner } from '../utils/ascii-art';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';
import { EffectiveExecutionPolicy, resolveExecutionPolicy } from '../utils/execution-policy';

const logger = createDebugLogger('run');
const perfTracker = createPerformanceTracker('guardscan run');
import { createProgressBar } from '../utils/progress';
import * as fs from 'fs';

interface RunOptions {
  files?: string[];
  /** Commander stores the negated --no-cloud option as cloud=false. */
  cloud?: boolean;
  noCloud?: boolean;
  offline?: boolean;
  cve?: boolean;
  allowPartial?: boolean;
  withAi?: boolean;  // Explicitly request AI enhancement
}

export async function runCommand(options: RunOptions): Promise<void> {
  logger.debug('Run command started', { options });
  perfTracker.start('run-total');
  const startTime = Date.now();

  displaySimpleBanner('run');

  try {
    // Load config
    perfTracker.start('load-config');
    const config = configManager.loadOrInit();
    perfTracker.end('load-config');
    logger.debug('Config loaded', { provider: config.provider });

    const noCloud = options.noCloud === true || options.cloud === false;
    const executionPolicy = resolveExecutionPolicy({
      configOffline: config.offlineMode,
      offline: options.offline,
      cloud: options.cloud,
      cve: options.cve,
      allowPartial: options.allowPartial,
    });
    if (noCloud) {
      console.warn(chalk.yellow('Warning: --no-cloud is deprecated; use --offline instead.'));
    }

    // Get repository info
    perfTracker.start('detect-repository');
    const repoInfo = repositoryManager.getRepoInfo();
    perfTracker.end('detect-repository');
    logger.debug('Repository detected', { name: repoInfo.name, repoId: repoInfo.repoId });
    const repositorySummary = [
      chalk.gray(`Repository: ${repoInfo.name}`),
      ...(repoInfo.branch ? [chalk.gray(`Branch: ${repoInfo.branch}`)] : []),
      '',
    ];
    console.log(repositorySummary.join('\n'));

    // Initialize progress tracking (3-4 steps depending on validation)
    const totalSteps = 3; // Analyze, Review, Report (validation is embedded in review)
    const progressBar = createProgressBar(totalSteps, 'Review Progress');

    // Step 1: Count LOC
    progressBar.update(0, { status: 'Analyzing codebase...' });
    perfTracker.start('count-loc');
    const locResult = await locCounter.count(options.files);
    perfTracker.end('count-loc');
    logger.debug('LOC counted', { fileCount: locResult.fileCount, codeLines: locResult.codeLines });
    progressBar.update(1, { status: `Analyzed ${locResult.fileCount} files` });

    // Resolve AI policy before preparing any repository-derived request context.
    perfTracker.start('init-ai-provider');
    let provider = null;
    if (options.withAi !== false) {
      try {
        provider = ProviderFactory.createForCli(config, {
          task: 'code-review',
          offline: executionPolicy.offline,
        });
      } catch (error) {
        if (!(error instanceof ProviderConfigurationError)) {
          throw error;
        }

        logger.debug('AI enhancement unavailable; using static analysis', {
          code: error.code,
          provider: config.provider,
        });
        console.warn(chalk.yellow(`AI enhancement skipped: ${error.message}`));
      }
    }
    perfTracker.end('init-ai-provider');
    logger.debug('AI provider initialized', { provider: config.provider, available: !!provider });
    const useAI = provider !== null;

    // Step 2: Local scanners are mandatory; AI can enrich but never replace them.
    progressBar.update(1, { status: 'Running local static analysis...' });
    perfTracker.start('static-analysis');
    let reviewResult = await runStaticAnalysis(
      repoInfo,
      locResult,
      options.files,
      executionPolicy
    );
    perfTracker.end('static-analysis');
    logger.debug('Static analysis completed', { findingsCount: reviewResult.findings.length });

    if (useAI && provider && !reviewResult.metadata.operationalFailure) {
      progressBar.update(1, { status: 'Running AI-enhanced review...' });

      perfTracker.start('prepare-context');
      const context = prepareReviewContext(repoInfo, locResult);
      perfTracker.end('prepare-context');
      logger.debug('Review context prepared', { contextLength: context.length });

      perfTracker.start('ai-api-call');
      logger.debug('Sending AI request', { 
        model: provider.getName(), 
        contextLength: context.length,
        provider: config.provider 
      });
      
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

      const aiCallDuration = perfTracker.end('ai-api-call');
      logger.performance('ai-api-call', aiCallDuration, { 
        model: aiResponse.model, 
        tokensUsed: aiResponse.usage?.totalTokens,
        provider: config.provider
      });
      logger.debug('AI response received', { 
        model: aiResponse.model,
        responseLength: aiResponse.content.length,
        tokensUsed: aiResponse.usage?.totalTokens
      });

      const aiReview = parseAIResponse(
        aiResponse.content,
        repoInfo,
        locResult,
        config.provider,
        aiResponse.model,
        Date.now() - startTime
      );
      reviewResult = mergeReviewResults(reviewResult, aiReview);
    }

    progressBar.update(2, { status: 'Analysis complete' });

    reviewResult.metadata.durationMs = Date.now() - startTime;

    // Step 3: Generate report
    progressBar.update(2, { status: 'Generating report...' });
    perfTracker.start('generate-report');
    const reportPath = await reporter.saveReport(reviewResult, 'markdown', undefined, 'ai-review');
    perfTracker.end('generate-report');
    logger.debug('Report generated', { reportPath });
    progressBar.update(3, { status: 'Complete' });
    progressBar.stop();

    console.log(chalk.green(`✓ Report saved: ${reportPath}`));

    // Display summary
    displaySummary(reviewResult);

    // Record telemetry (only if enabled)
    if (config.telemetryEnabled) {
      perfTracker.start('record-telemetry');
      const telemetryManager = createTelemetryManager(config);
      await telemetryManager.record({
        action: 'review',
        loc: locResult.codeLines,
        durationMs: Date.now() - startTime,
        model: reviewResult.metadata.model,
      });
      perfTracker.end('record-telemetry');
    }

    const duration = Date.now() - startTime;
    perfTracker.end('run-total');
    logger.debug('Run command completed successfully', {
      duration,
      findingsCount: reviewResult.findings.length
    });
    perfTracker.displaySummary();

    if (reviewResult.metadata.operationalFailure) {
      process.exitCode = 2;
    }

    console.log();
  } catch (error) {
    perfTracker.end('run-total');
    perfTracker.displaySummary();
    handleCommandError(error, 'Code review', 2);
  }
}

/**
 * Run comprehensive static analysis (FREE TIER)
 */
export async function runStaticAnalysis(
  repoInfo: RepositoryInfo,
  locResult: LOCResult,
  _filePatterns: string[] | undefined,
  executionPolicy: EffectiveExecutionPolicy = resolveExecutionPolicy()
): Promise<ReviewResult> {
  const repoPath = repoInfo.path;
  const findings: Finding[] = [];
  let securityCount = 0;
  let qualityCount = 0;
  let operationalFailure = false;
  const dependencyAllowPartial = executionPolicy.includeCve && executionPolicy.allowPartial;
  const scannerCoverage: NonNullable<ReviewResult['metadata']['scannerCoverage']> = {
    status: 'failed',
    scanners: [],
    errors: [],
  };

  // Import analysis engines
  const { scanEngine } = await import('../core/scan-engine');
  const { codeMetricsAnalyzer } = await import('../core/code-metrics');
  const { codeSmellDetector } = await import('../core/code-smells');

  // 1. Security Scanning
  const securitySpinner = ora('Running security scans...').start();
  try {
    const scanResult = await scanEngine.runSecurityScan({
      repoPath,
      files: locResult.fileBreakdown,
      offline: executionPolicy.offline,
      includeLicenses: true,
      includeVulnerabilities: executionPolicy.includeCve,
      allowPartial: dependencyAllowPartial,
    });
    findings.push(...scanResult.findings);
    securityCount = scanResult.findings.length;
    scannerCoverage.status = scanResult.status || 'complete';
    scannerCoverage.scanners = scanResult.scannerResults.map(scanner => ({
      name: scanner.scanner,
      status: scanner.status,
      required: scanner.required === true,
      detail: scanner.error?.message || scanner.skipReason,
    }));
    scannerCoverage.errors = scanResult.errors.map(error => ({
      scanner: error.scanner || 'security',
      code: error.code || 'SCANNER_FAILED',
      message: error.message || 'Scanner failed without an error message',
    }));
    const requiredLocalFailure = scanResult.scannerResults.some(scanner =>
      scanner.required === true && scanner.status === 'failed' && scanner.scanner !== 'dependencies'
    );
    operationalFailure = scanResult.status === 'failed' || requiredLocalFailure ||
      (scanResult.status === 'partial' && !dependencyAllowPartial);
    if (operationalFailure) {
      securitySpinner.fail(`Security coverage ${scannerCoverage.status}`);
    } else {
      securitySpinner.succeed(`Security scan ${scannerCoverage.status} - ${securityCount} issues found`);
    }
  } catch (error) {
    securitySpinner.fail('Security scan failed');
    operationalFailure = true;
    scannerCoverage.status = 'failed';
    scannerCoverage.errors.push({
      scanner: 'security',
      code: 'SCANNER_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // 2. Code Quality Analysis
  const qualitySpinner = ora('Analyzing code quality...').start();
  try {
    // Code metrics
    const metricsResults = await codeMetricsAnalyzer.analyze(repoPath);
    for (const fileMetrics of metricsResults) {
      if (fileMetrics.metrics.cyclomaticComplexity > 15) {
        findings.push({
          severity: 'medium' as const,
          category: 'Code Complexity',
          file: fileMetrics.file,
          description: `High cyclomatic complexity: ${fileMetrics.metrics.cyclomaticComplexity}`,
          suggestion: 'Consider refactoring to reduce complexity',
        });
        qualityCount++;
      }
      if (fileMetrics.metrics.maintainabilityIndex < 65) {
        findings.push({
          severity: 'low' as const,
          category: 'Maintainability',
          file: fileMetrics.file,
          description: `Low maintainability index: ${fileMetrics.metrics.maintainabilityIndex.toFixed(1)}`,
          suggestion: 'Improve code readability and reduce complexity',
        });
        qualityCount++;
      }
    }

    // Code smells
    const smellResults = await codeSmellDetector.detect(repoPath);
    for (const smell of smellResults) {
      findings.push({
        severity: smell.severity,
        category: `Code Smell: ${smell.type}`,
        file: smell.file,
        line: smell.line,
        description: smell.description,
        suggestion: smell.recommendation,
      });
      qualityCount++;
    }

    qualitySpinner.succeed(`Code quality analysis complete - ${qualityCount} issues found`);
  } catch (error) {
    qualitySpinner.fail('Code quality analysis failed');
    operationalFailure = true;
    if (scannerCoverage.status === 'complete') {
      scannerCoverage.status = 'partial';
    }
    scannerCoverage.errors.push({
      scanner: 'quality',
      code: 'QUALITY_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // Build summary
  const summary = `Comprehensive static analysis completed.

Found ${findings.length} total issues:
- Security issues: ${securityCount}
- Code quality issues: ${qualityCount}
- Security coverage: ${scannerCoverage.status}
- Operational errors: ${scannerCoverage.errors.length}

This analysis includes:
${executionPolicy.includeCve ? '✅' : '⏭️'} Dependency vulnerability scanning${executionPolicy.includeCve ? '' : ' (opt in with --cve)'}
✅ Secrets detection (files + git history)
✅ OWASP Top 10 security checks
✅ Docker & IaC security
✅ API security analysis
✅ Compliance checking (HIPAA, PCI-DSS, GDPR, SOC2)
✅ License compliance
✅ Code complexity analysis
✅ Code smell detection

AI-assisted review is available when a BYOK cloud provider or local model is configured.`;

  const recommendations: string[] = [];

  if (securityCount > 0) {
    recommendations.push('Address security vulnerabilities immediately, especially critical and high severity issues');
  }
  if (qualityCount > 0) {
    recommendations.push('Refactor complex code sections to improve maintainability');
  }
  if (findings.filter(f => f.severity === 'critical').length > 0) {
    recommendations.push('Critical issues require immediate attention before production deployment');
  }
  if (operationalFailure) {
    recommendations.push('Resolve scanner operational failures and rerun GuardScan before relying on this review');
  }

  return {
    summary,
    findings,
    recommendations,
    metadata: {
      timestamp: new Date().toISOString(),
      repoInfo,
      locStats: locResult,
      provider: 'static-analysis',
      model: 'local static scanners + quality analysis',
      durationMs: 0, // Will be set by caller
      executionMode: 'static-analysis',
      operationalFailure,
      scannerCoverage,
    },
  };
}

/**
 * Prepare context for AI review
 */
function prepareReviewContext(repoInfo: RepositoryInfo, locResult: LOCResult): string {
  logger.debug('Preparing review context', { fileCount: locResult.fileCount, codeLines: locResult.codeLines });
  
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
    .filter(file => file.codeLines > 10 && file.codeLines < 500)
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
  repoInfo: RepositoryInfo,
  locResult: LOCResult,
  provider: string,
  model: string,
  durationMs: number
): ReviewResult {
  // Basic parsing - in production, you'd want more sophisticated parsing
  const lines = content.split('\n');

  const findings: Finding[] = []; // Parse findings from AI response
  const recommendations: string[] = []; // Parse recommendations

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

function mergeReviewResults(local: ReviewResult, ai: ReviewResult): ReviewResult {
  const findings = new Map<string, ReviewResult['findings'][number]>();
  for (const finding of [...local.findings, ...ai.findings]) {
    const key = [
      finding.severity,
      finding.category,
      finding.file,
      finding.line || 0,
      finding.description,
    ].join('\0');
    findings.set(key, finding);
  }
  return {
    summary: `${local.summary}\n\nAI enhancement:\n${ai.summary}`,
    findings: [...findings.values()],
    recommendations: [...new Set([...local.recommendations, ...ai.recommendations])],
    metadata: {
      ...ai.metadata,
      executionMode: local.metadata.executionMode,
      operationalFailure: local.metadata.operationalFailure,
      scannerCoverage: local.metadata.scannerCoverage,
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

  if (result.findings.length === 0 && result.metadata.operationalFailure) {
    console.log(chalk.red('  ⚠ Review incomplete: required scanner coverage failed'));
  } else if (result.findings.length === 0) {
    console.log(chalk.green('  ✅ No major issues found!'));
  }

  if (result.recommendations.length > 0) {
    console.log(chalk.white(`\n  ${result.recommendations.length} recommendations provided`));
  }
}
