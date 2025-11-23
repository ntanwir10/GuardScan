import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { repositoryManager } from '../core/repository';
import { secretsDetector } from '../core/secrets-detector';
import { dependencyScanner } from '../core/dependency-scanner';
import { dockerfileScanner } from '../core/dockerfile-scanner';
import { iacScanner } from '../core/iac-scanner';
import { owaspScanner } from '../core/owasp-scanner';
import { apiScanner } from '../core/api-scanner';
import { complianceChecker } from '../core/compliance-checker';
import { licenseScanner } from '../core/license-scanner';
import { testRunner } from '../core/test-runner';
import { codeMetricsAnalyzer } from '../core/code-metrics';
import { codeSmellDetector } from '../core/code-smells';
import { linterIntegration } from '../core/linter-integration';
import { locCounter } from '../core/loc-counter';
import { reporter, ReviewResult } from '../utils/reporter';
import { telemetryManager } from '../core/telemetry';
import { ConfigManager } from '../core/config';
import { createProgressBar } from '../utils/progress';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('scan');
const perfTracker = createPerformanceTracker('guardscan scan');

interface ScanOptions {
  skipTests?: boolean;
  skipPerf?: boolean;
  skipMutation?: boolean;
  skipAi?: boolean;
  coverage?: boolean;
  licenses?: boolean;
  noCloud?: boolean;
}

interface ScanResults {
  security: any;
  quality: any;
  sbom: any;
  aiReview?: any;
  timestamp: string;
  duration: number;
}

export async function scanCommand(options: ScanOptions): Promise<void> {
  logger.debug('Scan command started', { options });
  perfTracker.start('scan-total');
  const startTime = Date.now();

  console.log(chalk.cyan.bold('\n🛡️  GuardScan - Comprehensive Security & Quality Analysis\n'));

  perfTracker.start('detect-repository');
  const repoInfo = repositoryManager.getRepoInfo();
  perfTracker.end('detect-repository');
  logger.debug('Repository detected', { name: repoInfo.name, repoId: repoInfo.repoId });
  console.log(chalk.gray(`Repository: ${repoInfo.name}\n`));

  const results: ScanResults = {
    security: {},
    quality: {},
    sbom: null,
    timestamp: new Date().toISOString(),
    duration: 0,
  };

  try {
    // Calculate total tasks for progress tracking
    const securityTasks = options.licenses ? 8 : 7;
    const qualityTasks = options.skipTests ? 0 : 4;
    const totalTasks = securityTasks + qualityTasks + 1; // +1 for SBOM

    let completed = 0;
    const overallProgress = createProgressBar(totalTasks, 'Overall Progress');

    // Run all scans in parallel with progress tracking
    logger.debug('Starting parallel scans', { totalTasks, securityTasks, qualityTasks });
    perfTracker.start('security-scans');
    const scanPromises: Promise<any>[] = [];

    // 1. Security Scans (run in parallel)
    const securityPromises = runSecurityScans(process.cwd(), options, () => {
      completed++;
      overallProgress.update(completed, { status: `${completed}/${totalTasks} checks complete` });
    });
    scanPromises.push(...securityPromises);

    // 2. Quality Analysis (run in parallel)
    if (!options.skipTests) {
      const qualityPromises = runQualityAnalysis(process.cwd(), options, () => {
        completed++;
        overallProgress.update(completed, { status: `${completed}/${totalTasks} checks complete` });
      });
      scanPromises.push(...qualityPromises);
    }

    // 3. SBOM Generation
    const sbomPromise = runSBOMGeneration(process.cwd()).then(result => {
      completed++;
      overallProgress.update(completed, { status: `${completed}/${totalTasks} checks complete` });
      return result;
    });
    scanPromises.push(sbomPromise);

    // Wait for all scans to complete
    const allResults = await Promise.allSettled(scanPromises);
    perfTracker.end('security-scans'); // Complete security-scans timing after all scans finish
    overallProgress.stop();
    logger.debug('All scans completed', { totalResults: allResults.length });

    // Process results
    processResults(allResults, results);

    // 4. Optional: AI Code Review
    if (!options.skipAi) {
      perfTracker.start('ai-review');
      await runAIReview(results, options);
      perfTracker.end('ai-review');
      logger.debug('AI review completed');
    }

    // Calculate total duration
    results.duration = Date.now() - startTime;

    // Generate comprehensive report
    console.log(chalk.gray('\nGenerating comprehensive report...'));
    perfTracker.start('report-generation');
    const report = generateComprehensiveReport(results, repoInfo);
    const reportPath = reporter.saveReport(report, 'markdown', undefined, 'comprehensive');
    perfTracker.end('report-generation');
    logger.debug('Report generated', { reportPath });
    console.log(chalk.green(`✓ Report saved: ${reportPath}`));

    // Display summary
    displaySummary(results);

    // Record telemetry
    perfTracker.start('record-telemetry');
    await telemetryManager.record({
      action: 'scan',
      loc: 0,
      durationMs: results.duration,
      model: 'comprehensive-scan',
    });
    perfTracker.end('record-telemetry');

    perfTracker.end('scan-total');
    logger.debug('Scan command completed successfully', { duration: results.duration });
    perfTracker.displaySummary();

    console.log(chalk.cyan('\n✨ Scan complete!\n'));

  } catch (error: any) {
    perfTracker.end('scan-total');
    perfTracker.displaySummary();
    handleCommandError(error, 'Scan');
  }
}

/**
 * Run all security scans in parallel
 */
function runSecurityScans(
  repoPath: string,
  options: ScanOptions,
  onProgress?: () => void
): Promise<any>[] {
  const promises: Promise<any>[] = [];

  // Get file list for scanners that need it
  const getFilePaths = async (): Promise<string[]> => {
    try {
      const locResult = await locCounter.count();
      return locResult.fileBreakdown.map((f: any) => f.path);
    } catch {
      return [];
    }
  };

  // 1. Secrets detection
  const secretsSpinner = ora('Scanning for secrets...').start();
  promises.push(
    (async () => {
      perfTracker.start('scanner-secrets');
      try {
        const filePaths = await getFilePaths();
        const results = await secretsDetector.detectInFiles(filePaths);
        const gitResults = await secretsDetector.scanGitHistory(repoPath);
        const allResults = [...results, ...gitResults];
        const duration = perfTracker.end('scanner-secrets');
        logger.performance('scanner-secrets', duration, { findings: allResults.length });
        secretsSpinner.succeed(`Secrets scan complete (${allResults.length} findings)`);
        if (onProgress) onProgress();
        return { type: 'secrets', results: allResults };
      } catch (error: any) {
        perfTracker.end('scanner-secrets');
        logger.error('Secrets scan failed', error);
        secretsSpinner.fail('Secrets scan failed');
        if (onProgress) onProgress();
        return { type: 'secrets', results: [], error };
      }
    })()
  );

  // 2. Dependency vulnerabilities
  const depsSpinner = ora('Scanning dependencies...').start();
  promises.push(
    (async () => {
      perfTracker.start('scanner-dependencies');
      try {
        const results = await dependencyScanner.scan(repoPath);
        const duration = perfTracker.end('scanner-dependencies');
        logger.performance('scanner-dependencies', duration, { findings: results.length });
        depsSpinner.succeed(`Dependency scan complete (${results.length} findings)`);
        if (onProgress) onProgress();
        return { type: 'dependencies', results };
      } catch (error: any) {
        perfTracker.end('scanner-dependencies');
        logger.error('Dependency scan failed', error);
        depsSpinner.fail('Dependency scan failed');
        if (onProgress) onProgress();
        return { type: 'dependencies', results: [], error };
      }
    })()
  );

  // 3. Dockerfile security
  const dockerSpinner = ora('Scanning Dockerfiles...').start();
  promises.push(
    (async () => {
      perfTracker.start('scanner-dockerfile');
      try {
        const results = await dockerfileScanner.scan(repoPath);
        const duration = perfTracker.end('scanner-dockerfile');
        logger.performance('scanner-dockerfile', duration, { findings: results.length });
        dockerSpinner.succeed(`Dockerfile scan complete (${results.length} findings)`);
        if (onProgress) onProgress();
        return { type: 'dockerfile', results };
      } catch (error: any) {
        perfTracker.end('scanner-dockerfile');
        logger.error('Dockerfile scan failed', error);
        dockerSpinner.fail('Dockerfile scan failed');
        if (onProgress) onProgress();
        return { type: 'dockerfile', results: [], error };
      }
    })()
  );

  // 4. Infrastructure as Code
  const iacSpinner = ora('Scanning IaC files...').start();
  promises.push(
    (async () => {
      perfTracker.start('scanner-iac');
      try {
        const results = await iacScanner.scan(repoPath);
        const duration = perfTracker.end('scanner-iac');
        logger.performance('scanner-iac', duration, { findings: results.length });
        iacSpinner.succeed(`IaC scan complete (${results.length} findings)`);
        if (onProgress) onProgress();
        return { type: 'iac', results };
      } catch (error: any) {
        perfTracker.end('scanner-iac');
        logger.error('IaC scan failed', error);
        iacSpinner.fail('IaC scan failed');
        if (onProgress) onProgress();
        return { type: 'iac', results: [], error };
      }
    })()
  );

  // 5. OWASP Top 10
  const owaspSpinner = ora('Checking OWASP Top 10...').start();
  promises.push(
    (async () => {
      perfTracker.start('scanner-owasp');
      try {
        const results = await owaspScanner.scan(repoPath);
        const duration = perfTracker.end('scanner-owasp');
        logger.performance('scanner-owasp', duration, { findings: results.length });
        owaspSpinner.succeed(`OWASP scan complete (${results.length} findings)`);
        if (onProgress) onProgress();
        return { type: 'owasp', results };
      } catch (error: any) {
        perfTracker.end('scanner-owasp');
        logger.error('OWASP scan failed', error);
        owaspSpinner.fail('OWASP scan failed');
        if (onProgress) onProgress();
        return { type: 'owasp', results: [], error };
      }
    })()
  );

  // 6. API Security
  const apiSpinner = ora('Scanning API endpoints...').start();
  promises.push(
    (async () => {
      perfTracker.start('scanner-api');
      try {
        const results = await apiScanner.scan(repoPath);
        const duration = perfTracker.end('scanner-api');
        logger.performance('scanner-api', duration, { findings: results.length });
        apiSpinner.succeed(`API scan complete (${results.length} findings)`);
        if (onProgress) onProgress();
        return { type: 'api', results };
      } catch (error: any) {
        perfTracker.end('scanner-api');
        logger.error('API scan failed', error);
        apiSpinner.fail('API scan failed');
        if (onProgress) onProgress();
        return { type: 'api', results: [], error };
      }
    })()
  );

  // 7. License scanning (if requested)
  if (options.licenses) {
    const licenseSpinner = ora('Scanning licenses...').start();
    promises.push(
      (async () => {
        perfTracker.start('scanner-licenses');
        try {
          const results = await licenseScanner.scan(repoPath, 'proprietary');
          const duration = perfTracker.end('scanner-licenses');
          logger.performance('scanner-licenses', duration, { packages: results.totalDependencies });
          licenseSpinner.succeed(`License scan complete (${results.totalDependencies} packages)`);
          if (onProgress) onProgress();
          return { type: 'licenses', results };
        } catch (error: any) {
          perfTracker.end('scanner-licenses');
          logger.error('License scan failed', error);
          licenseSpinner.fail('License scan failed');
          if (onProgress) onProgress();
          return { type: 'licenses', results: null, error };
        }
      })()
    );
  }

  // 8. Compliance checking
  const complianceSpinner = ora('Checking compliance...').start();
  promises.push(
    (async () => {
      perfTracker.start('scanner-compliance');
      try {
        const results = await complianceChecker.check(repoPath);
        const duration = perfTracker.end('scanner-compliance');
        logger.performance('scanner-compliance', duration, { reports: results.length });
        complianceSpinner.succeed(`Compliance check complete`);
        if (onProgress) onProgress();
        return { type: 'compliance', results };
      } catch (error: any) {
        perfTracker.end('scanner-compliance');
        logger.error('Compliance check failed', error);
        complianceSpinner.fail('Compliance check failed');
        if (onProgress) onProgress();
        return { type: 'compliance', results: [], error };
      }
    })()
  );

  return promises;
}

/**
 * Run quality analysis in parallel
 */
function runQualityAnalysis(
  repoPath: string,
  options: ScanOptions,
  onProgress?: () => void
): Promise<any>[] {
  const promises: Promise<any>[] = [];

  // 1. Test execution
  const testSpinner = ora('Running tests...').start();
  promises.push(
    (async () => {
      perfTracker.start('scanner-tests');
      try {
        const results = await testRunner.runTests(repoPath, options.coverage || false);
        const duration = perfTracker.end('scanner-tests');
        logger.performance('scanner-tests', duration, { frameworks: results.length });
        if (results.length > 0) {
          testSpinner.succeed(`Tests complete (${results.length} framework(s))`);
        } else {
          testSpinner.info('No test frameworks detected');
        }
        if (onProgress) onProgress();
        return { type: 'tests', results };
      } catch (error: any) {
        perfTracker.end('scanner-tests');
        logger.error('Test execution failed', error);
        testSpinner.fail('Test execution failed');
        if (onProgress) onProgress();
        return { type: 'tests', results: [], error };
      }
    })()
  );

  // 2. Code metrics
  const metricsSpinner = ora('Analyzing code metrics...').start();
  promises.push(
    (async () => {
      perfTracker.start('scanner-metrics');
      try {
        const results = await codeMetricsAnalyzer.analyze(repoPath);
        const duration = perfTracker.end('scanner-metrics');
        logger.performance('scanner-metrics', duration, { files: results.length });
        metricsSpinner.succeed(`Metrics analyzed (${results.length} files)`);
        if (onProgress) onProgress();
        return { type: 'metrics', results };
      } catch (error: any) {
        perfTracker.end('scanner-metrics');
        logger.error('Metrics analysis failed', error);
        metricsSpinner.fail('Metrics analysis failed');
        if (onProgress) onProgress();
        return { type: 'metrics', results: [], error };
      }
    })()
  );

  // 3. Code smells
  const smellSpinner = ora('Detecting code smells...').start();
  promises.push(
    (async () => {
      perfTracker.start('scanner-smells');
      try {
        const results = await codeSmellDetector.detect(repoPath);
        const duration = perfTracker.end('scanner-smells');
        logger.performance('scanner-smells', duration, { issues: results.length });
        smellSpinner.succeed(`Code smells detected (${results.length} issues)`);
        if (onProgress) onProgress();
        return { type: 'smells', results };
      } catch (error: any) {
        perfTracker.end('scanner-smells');
        logger.error('Code smell detection failed', error);
        smellSpinner.fail('Code smell detection failed');
        if (onProgress) onProgress();
        return { type: 'smells', results: [], error };
      }
    })()
  );

  // 4. Linting
  const lintSpinner = ora('Running linters...').start();
  promises.push(
    (async () => {
      perfTracker.start('scanner-linting');
      try {
        const results = await linterIntegration.runAll(repoPath);
        const duration = perfTracker.end('scanner-linting');
        logger.performance('scanner-linting', duration, { linters: results.length });
        if (results.length > 0) {
          lintSpinner.succeed(`Linting complete (${results.length} linter(s))`);
        } else {
          lintSpinner.info('No linters detected');
        }
        if (onProgress) onProgress();
        return { type: 'linting', results };
      } catch (error: any) {
        perfTracker.end('scanner-linting');
        logger.error('Linting failed', error);
        lintSpinner.fail('Linting failed');
        if (onProgress) onProgress();
        return { type: 'linting', results: [], error };
      }
    })()
  );

  return promises;
}

/**
 * Generate SBOM
 */
async function runSBOMGeneration(repoPath: string): Promise<any> {
  perfTracker.start('sbom-generation');
  const sbomSpinner = ora('Generating SBOM...').start();

  try {
    const licenseReport = await licenseScanner.scan(repoPath, 'proprietary');
    const sbom = licenseScanner.generateSBOM(licenseReport.findings, 'spdx', 'repository');
    const duration = perfTracker.end('sbom-generation');
    logger.performance('sbom-generation', duration);
    sbomSpinner.succeed('SBOM generated');
    return { type: 'sbom', results: sbom };
  } catch (error: any) {
    perfTracker.end('sbom-generation');
    logger.error('SBOM generation failed', error);
    sbomSpinner.fail('SBOM generation failed');
    return { type: 'sbom', results: null, error };
  }
}

/**
 * Optional AI code review
 */
async function runAIReview(results: ScanResults, options: ScanOptions): Promise<void> {
  try {
    const configManager = new ConfigManager();
    const config = configManager.loadOrInit();

    if (config.provider === 'none') {
      console.log(chalk.gray('\n💡 AI code review skipped (no AI provider configured)'));
      console.log(chalk.gray('   Run `guardscan config` to set up AI-enhanced reviews\n'));
      return;
    }

    console.log(chalk.white.bold('\n📋 AI Code Review\n'));
    const aiSpinner = ora('Running AI code review...').start();

    // Import and run AI review
    const { runCommand } = await import('./run');

    // This is a simplified approach - in a real implementation,
    // we'd want to integrate the AI review more directly
    aiSpinner.info('AI review available via `guardscan run` command');

  } catch (error) {
    console.log(chalk.gray('\n💡 AI code review skipped (not configured)\n'));
  }
}

/**
 * Process all scan results
 */
function processResults(allResults: PromiseSettledResult<any>[], results: ScanResults): void {
  for (const result of allResults) {
    if (result.status === 'fulfilled' && result.value) {
      const { type, results: data } = result.value;

      if (type === 'sbom') {
        results.sbom = data;
      } else if (['tests', 'metrics', 'smells', 'linting'].includes(type)) {
        results.quality[type] = data;
      } else {
        results.security[type] = data;
      }
    }
  }
}

/**
 * Generate comprehensive report
 */
function generateComprehensiveReport(results: ScanResults, repoInfo: any): ReviewResult {
  const findings: any[] = [];
  const summary: string[] = [];

  // Security findings
  summary.push('# Comprehensive Security & Quality Report\n');
  summary.push(`**Repository:** ${repoInfo.name}`);
  summary.push(`**Scanned:** ${new Date(results.timestamp).toLocaleString()}`);
  summary.push(`**Duration:** ${(results.duration / 1000).toFixed(1)}s\n`);

  summary.push('## Security Analysis\n');

  Object.entries(results.security).forEach(([type, data]: [string, any]) => {
    if (Array.isArray(data)) {
      summary.push(`- **${type}**: ${data.length} findings`);

      data.forEach((finding: any) => {
        findings.push({
          severity: finding.severity || 'medium',
          category: type,
          file: finding.file || 'unknown',
          line: finding.line,
          description: finding.message || finding.description || 'Issue detected',
          suggestion: finding.recommendation || finding.fix || 'Review and fix',
        });
      });
    }
  });

  summary.push('\n## Quality Analysis\n');

  Object.entries(results.quality).forEach(([type, data]: [string, any]) => {
    if (Array.isArray(data)) {
      summary.push(`- **${type}**: ${data.length} items analyzed`);
    }
  });

  summary.push('\n## SBOM\n');
  if (results.sbom) {
    const packages = results.sbom.packages?.length || 0;
    summary.push(`- **Total packages:** ${packages}`);
  }

  return {
    summary: summary.join('\n'),
    findings,
    recommendations: generateRecommendations(results),
    metadata: {
      timestamp: results.timestamp,
      repoInfo,
      locStats: {
        totalLines: 0,
        codeLines: 0,
        commentLines: 0,
        blankLines: 0,
        fileCount: 0,
        fileBreakdown: [],
      },
      provider: 'comprehensive-scan',
      model: 'multi-tool',
      durationMs: results.duration,
    },
  };
}

/**
 * Generate recommendations
 */
function generateRecommendations(results: ScanResults): string[] {
  const recommendations: string[] = [];

  // Security recommendations
  const totalSecurityIssues = Object.values(results.security)
    .reduce((sum: number, data: any) => sum + (Array.isArray(data) ? data.length : 0), 0);

  if (totalSecurityIssues > 0) {
    recommendations.push(`Address ${totalSecurityIssues} security finding(s) identified in the scan`);
  }

  // Quality recommendations
  if (results.quality.tests) {
    const failedTests = results.quality.tests.reduce((sum: number, t: any) => sum + (t.failed || 0), 0);
    if (failedTests > 0) {
      recommendations.push(`Fix ${failedTests} failing test(s)`);
    }
  }

  if (results.quality.smells && results.quality.smells.length > 10) {
    recommendations.push(`Refactor code to address ${results.quality.smells.length} code smell(s)`);
  }

  recommendations.push('Set up CI/CD integration for continuous security and quality monitoring');
  recommendations.push('Run `guardscan scan` regularly to catch issues early');

  return recommendations;
}

/**
 * Display summary
 */
function displaySummary(results: ScanResults): void {
  console.log(chalk.white.bold('\n📊 Scan Summary\n'));

  // Security summary
  const totalSecurityIssues = Object.values(results.security)
    .reduce((sum: number, data: any) => sum + (Array.isArray(data) ? data.length : 0), 0);

  console.log(chalk.cyan('Security:'));
  if (totalSecurityIssues > 0) {
    console.log(chalk.yellow(`  ⚠️  ${totalSecurityIssues} security finding(s)`));
  } else {
    console.log(chalk.green('  ✓ No security issues detected'));
  }

  // Quality summary
  console.log(chalk.cyan('\nQuality:'));
  if (results.quality.tests && results.quality.tests.length > 0) {
    const totalTests = results.quality.tests.reduce((sum: number, t: any) => sum + (t.totalTests || 0), 0);
    const passedTests = results.quality.tests.reduce((sum: number, t: any) => sum + (t.passed || 0), 0);
    console.log(chalk.gray(`  Tests: ${passedTests}/${totalTests} passing`));
  }

  if (results.quality.smells) {
    console.log(chalk.gray(`  Code smells: ${results.quality.smells.length}`));
  }

  // SBOM summary
  if (results.sbom) {
    const packages = results.sbom.packages?.length || 0;
    console.log(chalk.cyan('\nSBOM:'));
    console.log(chalk.gray(`  ${packages} package(s) documented`));
  }

  console.log(chalk.gray(`\nTotal duration: ${(results.duration / 1000).toFixed(1)}s`));
}
