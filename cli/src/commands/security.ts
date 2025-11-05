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
import * as fs from 'fs';
import * as path from 'path';

interface SecurityOptions {
  files?: string[];
}

export async function securityCommand(options: SecurityOptions): Promise<void> {
  const startTime = Date.now();

  console.log(chalk.cyan.bold('\n🔒 Security Scan\n'));

  try {
    // Load config
    const config = configManager.load();

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    console.log(chalk.gray(`Repository: ${repoInfo.name}`));

    // Count LOC
    const spinner = ora('Scanning files...').start();
    const locResult = await locCounter.count(options.files);
    spinner.succeed(`Scanned ${locResult.fileCount} files`);

    // Run security checks
    const scanSpinner = ora('Running security analysis...').start();
    const findings = await runSecurityChecks(locResult.fileBreakdown);
    scanSpinner.succeed(`Security analysis complete (${findings.length} findings)`);

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

    // Generate report
    console.log(chalk.gray('\nGenerating security report...'));
    const reportPath = reporter.saveReport(reviewResult, 'markdown');
    console.log(chalk.green(`✓ Report saved: ${reportPath}`));

    // Display summary
    displaySecuritySummary(findings);

    // Record telemetry
    await telemetryManager.record({
      action: 'security',
      loc: locResult.codeLines,
      durationMs: Date.now() - startTime,
      model: 'sast',
    });

    console.log();
  } catch (error) {
    console.error(chalk.red('\n✗ Security scan failed:'), error);
    process.exit(1);
  }
}

/**
 * Run security checks on files
 */
async function runSecurityChecks(files: any[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  const repoPath = process.cwd();

  // 1. Basic pattern-based scanning (existing)
  for (const file of files) {
    try {
      const content = fs.readFileSync(file.path, 'utf-8');
      const fileFindings = scanFileForVulnerabilities(file.path, content, file.language);
      findings.push(...fileFindings);
    } catch {
      // Skip files that can't be read
    }
  }

  // 2. Dependency vulnerability scanning
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
  } catch {
    // Dependency scanning failed (tools not available)
  }

  // 3. Advanced secrets detection
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
  } catch {
    // Secret scanning failed
  }

  // 4. Dockerfile security scanning
  try {
    const dockerFindings = await dockerfileScanner.scan(repoPath);
    findings.push(...dockerFindings);
  } catch {
    // Dockerfile scanning failed
  }

  // 5. Infrastructure-as-Code security scanning
  try {
    const iacFindings = await iacScanner.scan(repoPath);
    findings.push(...iacFindings);
  } catch {
    // IaC scanning failed
  }

  // 6. OWASP Top 10 scanning
  try {
    const owaspFindings = await owaspScanner.scan(repoPath);
    findings.push(...owaspFindings);
  } catch {
    // OWASP scanning failed
  }

  // 7. API security scanning
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
  } catch {
    // API scanning failed
  }

  // 8. Compliance checking
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
  } catch {
    // Compliance checking failed
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
