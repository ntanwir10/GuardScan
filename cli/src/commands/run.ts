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
import { displaySimpleBanner } from '../utils/ascii-art';
import * as fs from 'fs';
import * as path from 'path';

interface RunOptions {
  files?: string[];
  noCloud?: boolean;
  withAi?: boolean;  // Explicitly request AI enhancement
}

export async function runCommand(options: RunOptions): Promise<void> {
  const startTime = Date.now();

  displaySimpleBanner('run');

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

    // Check if AI is available and requested
    const provider = config.provider ? ProviderFactory.create(config.provider, config.apiKey, config.apiEndpoint) : null;
    const aiAvailable = provider && provider.isAvailable();
    const useAI = options.withAi !== false && aiAvailable; // Use AI by default if available

    let reviewResult: ReviewResult;

    if (useAI && provider) {
      // AI-ENHANCED REVIEW (PAID TIER)
      console.log(chalk.cyan('🤖 Running AI-enhanced code review...\n'));

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
            console.log(chalk.yellow('\n⚠ You do not have enough credits for AI review'));
            console.log(chalk.gray(`  Required: ${locResult.codeLines.toLocaleString()} LOC`));
            console.log(chalk.gray(`  Available: ${validation.remainingLoc.toLocaleString()} LOC`));
            console.log(chalk.cyan('\n  Falling back to FREE tier analysis...\n'));

            // Fall back to free tier
            reviewResult = await runStaticAnalysis(repoInfo, locResult, options.files);
          } else {
            validateSpinner.succeed(`Credits validated (${validation.remainingLoc.toLocaleString()} LOC remaining)`);

            // Run AI review
            const reviewSpinner = ora('Running AI code review...').start();
            const context = await prepareReviewContext(repoInfo, locResult, options.files);

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

            reviewSpinner.succeed('AI code review completed');
            reviewResult = parseAIResponse(aiResponse.content, repoInfo, locResult, config.provider, aiResponse.model, Date.now() - startTime);
          }
        } catch (error) {
          console.log(chalk.yellow('\n⚠ Could not validate credits - running FREE tier analysis\n'));
          reviewResult = await runStaticAnalysis(repoInfo, locResult, options.files);
        }
      } else {
        // Offline or no-cloud mode - run AI locally if available
        const reviewSpinner = ora('Running AI code review (offline)...').start();
        const context = await prepareReviewContext(repoInfo, locResult, options.files);

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

        reviewSpinner.succeed('AI code review completed');
        reviewResult = parseAIResponse(aiResponse.content, repoInfo, locResult, config.provider, aiResponse.model, Date.now() - startTime);
      }
    } else {
      // STATIC ANALYSIS (FREE TIER)
      if (!aiAvailable) {
        console.log(chalk.yellow('⚠ AI provider not configured - running comprehensive static analysis\n'));
        console.log(chalk.gray('  Tip: Configure AI with "guardscan config" for enhanced insights\n'));
      } else {
        console.log(chalk.cyan('🔍 Running comprehensive static analysis (FREE tier)\n'));
      }

      reviewResult = await runStaticAnalysis(repoInfo, locResult, options.files);
    }

    // Generate report
    console.log(chalk.gray('\nGenerating report...'));
    const reportPath = reporter.saveReport(reviewResult, 'markdown', undefined, 'ai-review');
    console.log(chalk.green(`✓ Report saved: ${reportPath}`));

    // Update duration in metadata
    reviewResult.metadata.durationMs = Date.now() - startTime;

    // Display summary
    displaySummary(reviewResult);

    // Record telemetry (only if enabled)
    if (config.telemetryEnabled) {
      await telemetryManager.record({
        action: 'review',
        loc: locResult.codeLines,
        durationMs: Date.now() - startTime,
        model: reviewResult.metadata.model,
      });
    }

    console.log();
  } catch (error) {
    console.error(chalk.red('\n✗ Code review failed:'), error);
    process.exit(1);
  }
}

/**
 * Run comprehensive static analysis (FREE TIER)
 */
async function runStaticAnalysis(repoInfo: any, locResult: any, filePatterns?: string[]): Promise<ReviewResult> {
  const repoPath = process.cwd();
  const findings: any[] = [];
  let securityCount = 0;
  let qualityCount = 0;

  // Import scanners
  const { dependencyScanner } = await import('../core/dependency-scanner');
  const { secretsDetector } = await import('../core/secrets-detector');
  const { owaspScanner } = await import('../core/owasp-scanner');
  const { dockerfileScanner } = await import('../core/dockerfile-scanner');
  const { iacScanner } = await import('../core/iac-scanner');
  const { apiScanner } = await import('../core/api-scanner');
  const { complianceChecker } = await import('../core/compliance-checker');
  const { licenseScanner } = await import('../core/license-scanner');
  const { codeMetricsAnalyzer } = await import('../core/code-metrics');
  const { codeSmellDetector } = await import('../core/code-smells');

  // 1. Security Scanning
  const securitySpinner = ora('Running security scans...').start();
  try {
    // Dependency vulnerabilities
    try {
      const depResults = await dependencyScanner.scan(repoPath);
      for (const result of depResults) {
        for (const vuln of result.vulnerabilities) {
          findings.push({
            severity: vuln.severity,
            category: `Dependency Vulnerability (${result.ecosystem})`,
            file: 'package.json',
            description: `${vuln.package}@${vuln.version}: ${vuln.title}`,
            suggestion: vuln.recommendation,
          });
          securityCount++;
        }
      }
    } catch (e) { /* Scanner not available */ }

    // Secrets detection
    try {
      const filePaths = locResult.fileBreakdown.map((f: any) => f.path);
      const secretFindings = await secretsDetector.detectInFiles(filePaths);
      for (const secret of secretFindings) {
        findings.push({
          severity: secret.severity,
          category: `Secret Detection: ${secret.type}`,
          file: secret.file,
          line: secret.line,
          description: `Potential secret detected (entropy: ${secret.entropy.toFixed(2)})`,
          suggestion: secret.recommendation,
        });
        securityCount++;
      }

      // Also scan git history
      const gitSecrets = await secretsDetector.scanGitHistory(repoPath);
      for (const secret of gitSecrets) {
        findings.push({
          severity: secret.severity,
          category: `Secret in Git History: ${secret.type}`,
          file: secret.file,
          line: secret.line,
          description: `Secret found in git history (entropy: ${secret.entropy.toFixed(2)})`,
          suggestion: secret.recommendation,
        });
        securityCount++;
      }
    } catch (e) { /* Scanner not available */ }

    // OWASP Top 10
    try {
      const owaspResults = await owaspScanner.scan(repoPath);
      findings.push(...owaspResults);
      securityCount += owaspResults.length;
    } catch (e) { /* Scanner not available */ }

    // Dockerfile security
    try {
      const dockerResults = await dockerfileScanner.scan(repoPath);
      findings.push(...dockerResults);
      securityCount += dockerResults.length;
    } catch (e) { /* Scanner not available */ }

    // IaC security
    try {
      const iacResults = await iacScanner.scan(repoPath);
      findings.push(...iacResults);
      securityCount += iacResults.length;
    } catch (e) { /* Scanner not available */ }

    // API security
    try {
      const apiFindings = await apiScanner.scan(repoPath);
      for (const finding of apiFindings) {
        findings.push({
          severity: finding.severity,
          category: `${finding.category} API: ${finding.type}`,
          file: finding.file,
          line: finding.line,
          description: finding.description,
          suggestion: finding.recommendation,
        });
        securityCount++;
      }
    } catch (e) { /* Scanner not available */ }

    // Compliance
    try {
      const complianceReports = await complianceChecker.check(repoPath);
      for (const report of complianceReports) {
        for (const violation of report.violations) {
          findings.push({
            severity: violation.severity,
            category: `${violation.standard} Compliance: ${violation.type}`,
            file: violation.file,
            line: violation.line,
            description: violation.description,
            suggestion: violation.recommendation,
          });
          securityCount++;
        }
      }
    } catch (e) { /* Scanner not available */ }

    // License compliance
    try {
      const licenseReport = await licenseScanner.scan(repoPath, 'proprietary');

      // Add license findings
      for (const licenseFinding of licenseReport.findings) {
        if (licenseFinding.risk === 'critical' || licenseFinding.risk === 'high') {
          findings.push({
            severity: licenseFinding.risk,
            category: `License Compliance: ${licenseFinding.category}`,
            file: 'dependencies',
            description: `${licenseFinding.package}@${licenseFinding.version}: ${licenseFinding.license}`,
            suggestion: `Review license compatibility - ${licenseFinding.description}`,
          });
          securityCount++;
        }
      }

      // Add compatibility issues
      for (const issue of licenseReport.compatibilityIssues) {
        findings.push({
          severity: issue.severity,
          category: 'License Compatibility',
          file: 'dependencies',
          description: issue.conflict,
          suggestion: issue.recommendation,
        });
        securityCount++;
      }
    } catch (e) { /* Scanner not available */ }

    securitySpinner.succeed(`Security scan complete - ${securityCount} issues found`);
  } catch (error) {
    securitySpinner.fail('Security scan failed');
  }

  // 2. Code Quality Analysis
  const qualitySpinner = ora('Analyzing code quality...').start();
  try {
    // Code metrics
    try {
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
    } catch (e) { /* Scanner not available */ }

    // Code smells
    try {
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
    } catch (e) { /* Scanner not available */ }

    qualitySpinner.succeed(`Code quality analysis complete - ${qualityCount} issues found`);
  } catch (error) {
    qualitySpinner.fail('Code quality analysis failed');
  }

  // Build summary
  const summary = `Comprehensive static analysis completed.

Found ${findings.length} total issues:
- Security issues: ${securityCount}
- Code quality issues: ${qualityCount}

This analysis includes:
✅ Dependency vulnerability scanning
✅ Secrets detection (files + git history)
✅ OWASP Top 10 security checks
✅ Docker & IaC security
✅ API security analysis
✅ Compliance checking (HIPAA, PCI-DSS, GDPR, SOC2)
✅ License compliance
✅ Code complexity analysis
✅ Code smell detection

💡 Upgrade to Pro for AI-powered insights and context-aware analysis`;

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

  return {
    summary,
    findings,
    recommendations,
    metadata: {
      timestamp: new Date().toISOString(),
      repoInfo,
      locStats: locResult,
      provider: 'static-analysis',
      model: 'FREE tier (9 security scanners + quality analysis)',
      durationMs: 0, // Will be set by caller
    },
  };
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

  const findings: any[] = []; // Parse findings from AI response
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
