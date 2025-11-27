import chalk from 'chalk';
import ora from 'ora';
import { configManager } from '../core/config';
import { repositoryManager } from '../core/repository';
import { locCounter } from '../core/loc-counter';
import { reporter, ReviewResult, Finding } from '../utils/reporter';
import { telemetryManager } from '../core/telemetry';
import { dependencyScanner } from '../core/dependency-scanner';
import { secretsDetector } from '../core/secrets-detector';
import { dockerfileScanner } from '../core/dockerfile-scanner';
import { iacScanner } from '../core/iac-scanner';
import { owaspScanner } from '../core/owasp-scanner';
import { apiScanner } from '../core/api-scanner';
import { complianceChecker } from '../core/compliance-checker';
import { licenseScanner } from '../core/license-scanner';
import { displaySimpleBanner } from '../utils/ascii-art';
import { createProgressBar } from '../utils/progress';
import { ProviderFactory } from '../providers/factory';
import { FixSuggestionsGenerator, SecurityIssue } from '../features/fix-suggestions';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';
import * as fs from 'fs';
import * as path from 'path';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('security');
const perfTracker = createPerformanceTracker('guardscan security');

interface SecurityOptions {
  files?: string[];
  licenses?: boolean;
  aiFix?: boolean;
  interactive?: boolean;
  debug?: boolean;
}

export async function securityCommand(options: SecurityOptions): Promise<void> {
  // Log debug mode activation if enabled
  if (options.debug || process.env.GUARDSCAN_DEBUG === 'true') {
    logger.info('Debug mode enabled - verbose logging active');
  }
  
  logger.debug('Security command started', { options });
  perfTracker.start('security-total');
  const startTime = Date.now();

  displaySimpleBanner('security');

  try {
    // Load config
    perfTracker.start('load-config');
    const config = configManager.loadOrInit();
    perfTracker.end('load-config');
    logger.debug('Config loaded', { provider: config.provider });

    // Get repository info
    perfTracker.start('detect-repository');
    const repoInfo = repositoryManager.getRepoInfo();
    perfTracker.end('detect-repository');
    logger.debug('Repository detected', { name: repoInfo.name, repoId: repoInfo.repoId });
    console.log(chalk.gray(`Repository: ${repoInfo.name}\n`));

    // Initialize progress tracking
    const totalSteps = 3; // Scan files, Run checks, Generate report
    const progressBar = createProgressBar(totalSteps, 'Security Scan');

    // Step 1: Count LOC
    progressBar.update(0, { status: 'Scanning files...' });
    perfTracker.start('count-loc');
    const locResult = await locCounter.count(options.files);
    perfTracker.end('count-loc');
    logger.debug('LOC counted', { fileCount: locResult.fileCount, codeLines: locResult.codeLines });
    progressBar.update(1, { status: `Scanned ${locResult.fileCount} files` });

    // Step 2: Run security checks
    progressBar.update(1, { status: 'Running security analysis...' });
    perfTracker.start('security-checks');
    const findings = await runSecurityChecks(locResult.fileBreakdown);
    perfTracker.end('security-checks');
    logger.debug('Security checks completed', { findingsCount: findings.length });
    progressBar.update(2, { status: `Found ${findings.length} findings` });

    // Create review result
    const reviewResult: ReviewResult = {
      summary: generateSecuritySummary(findings),
      findings,
      recommendations: generateSecurityRecommendations(findings),
      metadata: {
        timestamp: new Date().toISOString(),
        repoInfo,
        locStats: locResult,
        provider: 'security-scanner',
        model: 'sast-rules',
        durationMs: Date.now() - startTime,
      },
    };

    // Step 3: Generate AI fixes if requested
    if (options.aiFix && findings.length > 0) {
      progressBar.update(2, { status: 'Generating AI fixes...' });
      perfTracker.start('ai-fixes');
      await generateAIFixes(findings, repoInfo.path, config, options.interactive || false);
      perfTracker.end('ai-fixes');
      logger.debug('AI fixes generated', { findingsCount: findings.length });
      progressBar.update(2.5, { status: 'AI fixes generated' });
    }

    // Step 4: Generate report
    progressBar.update(2.5, { status: 'Generating report...' });
    perfTracker.start('report-generation');
    const reportPath = reporter.saveReport(reviewResult, 'markdown', undefined, 'security');
    perfTracker.end('report-generation');
    logger.debug('Report generated', { reportPath });
    progressBar.update(3, { status: 'Complete' });
    progressBar.stop();

    console.log(chalk.green(`✓ Report saved: ${reportPath}`));

    // Display summary
    displaySecuritySummary(findings);

    // Record telemetry
    perfTracker.start('record-telemetry');
    await telemetryManager.record({
      action: 'security',
      loc: locResult.codeLines,
      durationMs: Date.now() - startTime,
      model: 'sast',
    });
    perfTracker.end('record-telemetry');

    perfTracker.end('security-total');
    logger.debug('Security command completed successfully', { 
      duration: Date.now() - startTime,
      findingsCount: findings.length
    });
    perfTracker.displaySummary();

    console.log();
  } catch (error) {
    perfTracker.end('security-total');
    perfTracker.displaySummary();
    handleCommandError(error, 'Security scan');
  }
}

/**
 * Run security checks on files
 */
async function runSecurityChecks(files: any[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  const repoPath = process.cwd();

  // 1. Basic pattern-based scanning (existing)
  perfTracker.start('check-patterns');
  for (const file of files) {
    try {
      const content = fs.readFileSync(file.path, 'utf-8');
      const fileFindings = scanFileForVulnerabilities(file.path, content, file.language);
      findings.push(...fileFindings);
    } catch {
      // Skip files that can't be read
    }
  }
  const duration = perfTracker.end('check-patterns');
  logger.performance('check-patterns', duration, { filesScanned: files.length, findings: findings.length });

  // 2. Dependency vulnerability scanning
  perfTracker.start('check-dependencies');
  try {
    const depResults = await dependencyScanner.scan(repoPath);
    for (const result of depResults) {
      for (const vuln of result.vulnerabilities) {
        findings.push({
          severity: vuln.severity,
          category: `Dependency Vulnerability (${result.ecosystem})`,
          file: 'package.json', // or requirements.txt, etc.
          description: `${vuln.package}@${vuln.version}: ${vuln.title}`,
          suggestion: vuln.recommendation,
        });
      }
    }
    const duration = perfTracker.end('check-dependencies');
    logger.performance('check-dependencies', duration, { findings: findings.length });
  } catch (error) {
    perfTracker.end('check-dependencies');
    logger.error('Dependency scanning failed', error);
  }

  // 3. Advanced secrets detection
  perfTracker.start('check-secrets');
  try {
    const filePaths = files.map(f => f.path);
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
    }
    const duration = perfTracker.end('check-secrets');
    logger.performance('check-secrets', duration, { findings: secretFindings.length + gitSecrets.length });
  } catch (error) {
    perfTracker.end('check-secrets');
    logger.error('Secret scanning failed', error);
  }

  // 4. Dockerfile security scanning
  perfTracker.start('check-dockerfile');
  try {
    const dockerFindings = await dockerfileScanner.scan(repoPath);
    findings.push(...dockerFindings);
    const duration = perfTracker.end('check-dockerfile');
    logger.performance('check-dockerfile', duration, { findings: dockerFindings.length });
  } catch (error) {
    perfTracker.end('check-dockerfile');
    logger.error('Dockerfile scanning failed', error);
  }

  // 5. Infrastructure-as-Code security scanning
  perfTracker.start('check-iac');
  try {
    const iacFindings = await iacScanner.scan(repoPath);
    findings.push(...iacFindings);
    const duration = perfTracker.end('check-iac');
    logger.performance('check-iac', duration, { findings: iacFindings.length });
  } catch (error) {
    perfTracker.end('check-iac');
    logger.error('IaC scanning failed', error);
  }

  // 6. OWASP Top 10 scanning
  perfTracker.start('check-owasp');
  try {
    const owaspFindings = await owaspScanner.scan(repoPath);
    findings.push(...owaspFindings);
    const duration = perfTracker.end('check-owasp');
    logger.performance('check-owasp', duration, { findings: owaspFindings.length });
  } catch (error) {
    perfTracker.end('check-owasp');
    logger.error('OWASP scanning failed', error);
  }

  // 7. API security scanning
  perfTracker.start('check-api');
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
    }
    const duration = perfTracker.end('check-api');
    logger.performance('check-api', duration, { findings: apiFindings.length });
  } catch (error) {
    perfTracker.end('check-api');
    logger.error('API scanning failed', error);
  }

  // 8. Compliance checking
  perfTracker.start('check-compliance');
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
      }
    }
    const duration = perfTracker.end('check-compliance');
    logger.performance('check-compliance', duration, { reports: complianceReports.length });
  } catch (error) {
    perfTracker.end('check-compliance');
    logger.error('Compliance checking failed', error);
  }

  // 9. License compliance scanning
  perfTracker.start('check-licenses');
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
    }
    const duration = perfTracker.end('check-licenses');
    logger.performance('check-licenses', duration, { findings: licenseReport.findings.length });
  } catch (error) {
    perfTracker.end('check-licenses');
    logger.error('License scanning failed', error);
  }

  return findings;
}

/**
 * Scan a single file for security vulnerabilities
 */
function scanFileForVulnerabilities(filePath: string, content: string, language: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split('\n');

  // Define security patterns to check
  const securityPatterns = [
    // Hardcoded secrets
    {
      pattern: /(password|passwd|pwd|secret|api[_-]?key|apikey|token|auth[_-]?token)\s*[=:]\s*['"][^'"]+['"]/i,
      severity: 'critical' as const,
      category: 'Hardcoded Secrets',
      description: 'Potential hardcoded credentials or secrets detected',
      suggestion: 'Use environment variables or secure secret management',
    },
    // SQL Injection
    {
      pattern: /(SELECT|INSERT|UPDATE|DELETE).*\+.*\$|.*\+.*WHERE/i,
      severity: 'high' as const,
      category: 'SQL Injection',
      description: 'Potential SQL injection vulnerability',
      suggestion: 'Use parameterized queries or prepared statements',
    },
    // XSS vulnerabilities (JavaScript/TypeScript)
    {
      pattern: /innerHTML\s*=|document\.write\(/,
      severity: 'high' as const,
      category: 'XSS',
      description: 'Potential cross-site scripting (XSS) vulnerability',
      suggestion: 'Use textContent or properly sanitize HTML',
    },
    // eval() usage
    {
      pattern: /eval\s*\(/,
      severity: 'high' as const,
      category: 'Code Injection',
      description: 'Use of eval() can lead to code injection',
      suggestion: 'Avoid eval() and use safer alternatives',
    },
    // Insecure random
    {
      pattern: /Math\.random\(\)/,
      severity: 'medium' as const,
      category: 'Weak Randomness',
      description: 'Math.random() is not cryptographically secure',
      suggestion: 'Use crypto.randomBytes() for security-sensitive operations',
    },
    // HTTP in URLs (not HTTPS)
    {
      pattern: /['"]http:\/\//,
      severity: 'medium' as const,
      category: 'Insecure Protocol',
      description: 'HTTP connection detected (not encrypted)',
      suggestion: 'Use HTTPS for all network communications',
    },
    // Weak cryptography
    {
      pattern: /md5|sha1/i,
      severity: 'medium' as const,
      category: 'Weak Cryptography',
      description: 'Use of weak cryptographic algorithm',
      suggestion: 'Use SHA-256 or stronger algorithms',
    },
  ];

  // Check each pattern
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of securityPatterns) {
      if (pattern.pattern.test(line)) {
        findings.push({
          severity: pattern.severity,
          category: pattern.category,
          file: filePath,
          line: i + 1,
          description: pattern.description,
          suggestion: pattern.suggestion,
        });
      }
    }
  }

  // Language-specific checks
  if (language === 'JavaScript' || language === 'TypeScript') {
    findings.push(...checkJavaScriptSecurity(filePath, content));
  } else if (language === 'Python') {
    findings.push(...checkPythonSecurity(filePath, content));
  }

  return findings;
}

/**
 * JavaScript/TypeScript specific security checks
 */
function checkJavaScriptSecurity(filePath: string, content: string): Finding[] {
  const findings: Finding[] = [];

  // Check for require() with dynamic paths
  if (/require\s*\([^'"]/.test(content)) {
    findings.push({
      severity: 'medium',
      category: 'Dynamic Require',
      file: filePath,
      description: 'Dynamic require() detected',
      suggestion: 'Use static imports when possible',
    });
  }

  // Check for dangerouslySetInnerHTML (React)
  if (/dangerouslySetInnerHTML/.test(content)) {
    findings.push({
      severity: 'high',
      category: 'XSS',
      file: filePath,
      description: 'dangerouslySetInnerHTML usage detected',
      suggestion: 'Ensure content is properly sanitized',
    });
  }

  return findings;
}

/**
 * Python specific security checks
 */
function checkPythonSecurity(filePath: string, content: string): Finding[] {
  const findings: Finding[] = [];

  // Check for pickle usage
  if (/import\s+pickle|from\s+pickle/.test(content)) {
    findings.push({
      severity: 'high',
      category: 'Insecure Deserialization',
      file: filePath,
      description: 'pickle module can execute arbitrary code',
      suggestion: 'Use JSON or other safe serialization formats',
    });
  }

  // Check for shell=True in subprocess
  if (/subprocess.*shell\s*=\s*True/.test(content)) {
    findings.push({
      severity: 'high',
      category: 'Command Injection',
      file: filePath,
      description: 'subprocess with shell=True can lead to command injection',
      suggestion: 'Avoid shell=True or properly sanitize inputs',
    });
  }

  return findings;
}

/**
 * Generate security summary
 */
function generateSecuritySummary(findings: Finding[]): string {
  const critical = findings.filter(f => f.severity === 'critical').length;
  const high = findings.filter(f => f.severity === 'high').length;
  const medium = findings.filter(f => f.severity === 'medium').length;
  const low = findings.filter(f => f.severity === 'low').length;

  let summary = 'Security scan completed.\n\n';

  if (findings.length === 0) {
    summary += 'No security issues detected.';
  } else {
    summary += `Found ${findings.length} potential security issue(s):\n`;
    if (critical > 0) summary += `- ${critical} Critical\n`;
    if (high > 0) summary += `- ${high} High\n`;
    if (medium > 0) summary += `- ${medium} Medium\n`;
    if (low > 0) summary += `- ${low} Low\n`;
  }

  return summary;
}

/**
 * Generate security recommendations
 */
function generateSecurityRecommendations(findings: Finding[]): string[] {
  const recommendations = new Set<string>();

  if (findings.some(f => f.category === 'Hardcoded Secrets')) {
    recommendations.add('Implement a secure secrets management solution');
  }

  if (findings.some(f => f.category === 'SQL Injection')) {
    recommendations.add('Review all database queries and use parameterized statements');
  }

  if (findings.some(f => f.category === 'XSS')) {
    recommendations.add('Implement input validation and output encoding');
  }

  if (findings.some(f => f.severity === 'critical')) {
    recommendations.add('Address critical security issues immediately');
  }

  recommendations.add('Consider implementing security headers');
  recommendations.add('Keep dependencies up to date');
  recommendations.add('Run security scans regularly');

  return Array.from(recommendations);
}

/**
 * Display security summary
 */
function displaySecuritySummary(findings: Finding[]): void {
  console.log(chalk.white.bold('\n🔒 Security Summary:'));

  const criticalCount = findings.filter(f => f.severity === 'critical').length;
  const highCount = findings.filter(f => f.severity === 'high').length;
  const mediumCount = findings.filter(f => f.severity === 'medium').length;
  const lowCount = findings.filter(f => f.severity === 'low').length;

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

  if (findings.length === 0) {
    console.log(chalk.green('  ✅ No security issues found!'));
  }
}

/**
 * Generate AI fixes for security findings
 */
async function generateAIFixes(
  findings: Finding[],
  repoRoot: string,
  config: any,
  interactive: boolean
): Promise<void> {
  // Check if AI provider is configured
  if (!config.provider || config.provider === 'none' || !config.apiKey) {
    console.log(chalk.yellow('\n⚠ AI provider not configured. Run `guardscan config` to set up.'));
    return;
  }

  try {
    // Create AI provider
    const provider = ProviderFactory.create(config.provider, config.apiKey, config.apiEndpoint);

    // Get repo ID for cache
    const repoInfo = repositoryManager.getRepoInfo();

    // Create AI cache
    const cache = new AICache(repoInfo.repoId, 100); // 100MB cache

    // Create indexer
    const indexer = new CodebaseIndexer(repoRoot, repoInfo.repoId);

    // Create fix generator
    const fixGenerator = new FixSuggestionsGenerator(provider, indexer, cache, repoRoot);

    // Convert findings to SecurityIssue format
    const issues: SecurityIssue[] = findings
      .filter(f => f.file && f.line) // Only issues with file and line info
      .map(f => ({
        severity: f.severity as 'high' | 'medium' | 'low',
        category: f.category,
        file: f.file!,
        line: f.line!,
        codeSnippet: extractCodeSnippet(f.file!, f.line!),
        description: f.description,
      }));

    if (issues.length === 0) {
      console.log(chalk.yellow('\n⚠ No fixable issues found (issues must have file and line information).'));
      return;
    }

    console.log(chalk.blue(`\n🤖 Generating AI fixes for ${issues.length} issue(s)...`));

    // Generate fixes
    const fixes = await fixGenerator.generateFixes(issues, 5); // Max 5 concurrent

    // Display fixes
    console.log(chalk.white.bold('\n💡 AI Fix Suggestions:\n'));

    let fixCount = 0;
    for (const [key, fix] of fixes) {
      fixCount++;
      const issue = issues.find(i => `${i.file}:${i.line}` === key);
      if (!issue) continue;

      console.log(chalk.cyan(`\n[${fixCount}] ${issue.file}:${issue.line}`));
      console.log(chalk.white(`   Issue: ${issue.description}`));
      console.log(chalk.gray(`   Confidence: ${(fix.confidence * 100).toFixed(0)}%\n`));

      console.log(chalk.yellow('   Explanation:'));
      console.log(chalk.gray(`   ${fix.explanation}\n`));

      console.log(chalk.green('   Suggested Fix:'));
      console.log(chalk.gray(`   \`\`\`\n${fix.fixedCode.split('\n').slice(0, 15).join('\n')}\n   ...\`\`\`\n`));

      if (fix.alternatives && fix.alternatives.length > 0) {
        console.log(chalk.blue('   Alternatives:'));
        fix.alternatives.forEach((alt, i) => {
          console.log(chalk.gray(`   ${i + 1}. ${alt}`));
        });
        console.log();
      }

      if (fix.bestPractices && fix.bestPractices.length > 0) {
        console.log(chalk.magenta('   Best Practices:'));
        fix.bestPractices.forEach(bp => {
          console.log(chalk.gray(`   • ${bp}`));
        });
        console.log();
      }
    }

    console.log(chalk.green(`\n✓ Generated ${fixes.size} AI fix suggestion(s)`));
    console.log(chalk.gray('  Review these fixes carefully before applying them to your code.'));

    // Save fixes to file
    const fixesDir = path.join(repoRoot, '.guardscan', 'fixes');
    if (!fs.existsSync(fixesDir)) {
      fs.mkdirSync(fixesDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fixesPath = path.join(fixesDir, `fixes-${timestamp}.json`);

    const fixesData = Array.from(fixes.entries()).map(([key, fix]) => {
      const issue = issues.find(i => `${i.file}:${i.line}` === key);
      return {
        issue,
        fix,
      };
    });

    fs.writeFileSync(fixesPath, JSON.stringify(fixesData, null, 2), 'utf-8');
    console.log(chalk.gray(`\n  Fixes saved to: ${fixesPath}`));

  } catch (error) {
    console.error(chalk.red('\n✗ Failed to generate AI fixes:'), error);
  }
}

import { SECURITY_CONSTANTS } from '../constants/security-constants';

/**
 * Extract code snippet around a line
 */
function extractCodeSnippet(filePath: string, line: number, context: number = SECURITY_CONSTANTS.CODE_SNIPPET_CONTEXT_LINES): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, line - context - 1);
    const end = Math.min(lines.length, line + context);

    return lines.slice(start, end).join('\n');
  } catch {
    return '';
  }
}
