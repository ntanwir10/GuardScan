import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../core/config';
import { codeMetricsAnalyzer } from '../core/code-metrics';
import { codeSmellDetector } from '../core/code-smells';
import { licenseScanner, LicenseReport } from '../core/license-scanner';
import { linterIntegration } from '../core/linter-integration';
import { locCounter } from '../core/loc-counter';
import { collectPackageInventory, PackageInventory } from '../core/package-inventory';
import { repositoryManager } from '../core/repository';
import {
  evaluateScanPolicy,
  ScanEngineResult,
  ScanExecutionError,
  ScanExecutionStatus,
  ScanOutputFormat,
  ScanPolicy,
  ScanPolicyResult,
  scanEngine,
  writeScanResult,
} from '../core/scan-engine';
import { createTelemetryManager } from '../core/telemetry';
import { testRunner } from '../core/test-runner';
import { handleCommandError } from '../utils/error-handler';
import { reporter, ReviewResult } from '../utils/reporter';
import { EffectiveExecutionPolicy, resolveExecutionPolicy } from '../utils/execution-policy';

interface ScanOptions {
  skipTests?: boolean;
  skipPerf?: boolean;
  skipMutation?: boolean;
  skipAi?: boolean;
  coverage?: boolean;
  licenses?: boolean;
  cve?: boolean;
  allowPartial?: boolean;
  runProjectCode?: boolean;
  isolateProjectNetwork?: boolean;
  concurrency?: string;
  scope?: string;
  cloud?: boolean;
  cache?: boolean;
  ci?: boolean;
  offline?: boolean;
  format?: 'markdown' | ScanOutputFormat;
  output?: string;
  failOn?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  maxFindings?: string;
}

type CheckStatus = 'succeeded' | 'failed' | 'skipped';

export interface CheckResult {
  status: CheckStatus;
  durationMs: number;
  data?: unknown;
  error?: { code: string; message: string; retryable: boolean };
  reason?: string;
}

export interface QualitySection {
  status: 'complete' | 'partial' | 'failed' | 'skipped';
  checks: {
    tests: CheckResult;
    metrics: CheckResult;
    smells: CheckResult;
    lint: CheckResult;
    performance: CheckResult;
    mutation: CheckResult;
  };
}

export interface SbomSection {
  status: 'succeeded' | 'partial' | 'failed';
  format?: string;
  document?: unknown;
  error?: { code: string; message: string; retryable: boolean };
}

export async function scanCommand(options: ScanOptions): Promise<void> {
  const startedAt = Date.now();
  console.log(chalk.cyan.bold('\n🛡️  GuardScan - Comprehensive Security & Quality Analysis\n'));

  try {
    const repoInfo = repositoryManager.getRepoInfo();
    const config = new ConfigManager().loadOrInit();
    warnDeprecatedNoCloud(options.cloud);
    const executionPolicy = resolveExecutionPolicy({
      configOffline: config.offlineMode,
      offline: options.offline,
      cloud: options.cloud,
      runProjectCode: options.runProjectCode,
      isolateProjectNetwork: options.isolateProjectNetwork,
      cve: options.cve === true && config.vulnerabilities?.enabled !== false,
      allowPartial: options.allowPartial,
    });
    const { offline } = executionPolicy;
    const allowPartial = executionPolicy.allowPartial;
    const concurrency = parseConcurrency(options.concurrency);
    const vulnerabilityScope = parseScope(options.scope || config.vulnerabilities?.scope);
    const useCache = options.cache !== false &&
      process.env.GUARDSCAN_NO_CACHE !== 'true' &&
      config.cache?.enabled !== false;
    const includeVulnerabilities = executionPolicy.includeCve;
    const inventory = collectPackageInventory(repoInfo.path);
    const locResult = await locCounter.count();

    const executionNotices = [chalk.gray(`Repository: ${repoInfo.name}`)];
    if (!includeVulnerabilities) {
      executionNotices.push(chalk.gray('Dependency vulnerability scanning: disabled'));
    }
    if (executionPolicy.runProjectCode) {
      executionNotices.push(chalk.yellow.bold('\n⚠ Trust warning: repository-controlled code execution enabled.'));
      executionNotices.push(chalk.yellow(
        executionPolicy.isolateProjectNetwork
          ? '  Tests and linters can read accessible files and modify the repository; network isolation was requested.'
          : '  Tests and linters can read accessible files, modify the repository, and use the network.'
      ));
      executionNotices.push(chalk.yellow('  Run this only for repositories you trust.\n'));
    }
    console.log(executionNotices.join('\n'));

    // One inventory and one license report feed CVE, license, and SBOM work.
    const licenseReportPromise = licenseScanner.scan(repoInfo.path, 'proprietary', {
      offline,
      runProjectCode: executionPolicy.runProjectCode,
      networkIsolation: executionPolicy.isolateProjectNetwork,
      inventory,
    });

    const securityPromise = scanEngine.runSecurityScan({
      repoPath: repoInfo.path,
      files: locResult.fileBreakdown,
      offline,
      includeLicenses: options.licenses === true,
      includeVulnerabilities,
      allowPartial,
      cache: useCache,
      concurrency,
      vulnerabilityScope,
      vulnerabilityEndpoint: config.vulnerabilities?.endpoint,
      vulnerabilitySnapshotMaxAgeDays: config.vulnerabilities?.snapshotMaxAgeDays,
      vulnerabilityEnrichKnownExploited:
        config.vulnerabilities?.enrichKnownExploited !== false,
      vulnerabilityKevMaxCacheAgeDays: config.vulnerabilities?.snapshotMaxAgeDays,
      packageInventory: inventory,
      licenseReport: licenseReportPromise,
    });
    const qualityPromise = runQualityAnalysis(repoInfo.path, options, executionPolicy);
    const sbomPromise = createSbomSection(licenseReportPromise, inventory);

    const [securityResult, quality, sbom] = await Promise.all([
      securityPromise,
      qualityPromise,
      sbomPromise,
    ]);

    const ai = aiState(options.skipAi === true, config.provider);
    const policy: ScanPolicy = {
      failOn: options.failOn,
      maxFindings: parseMaxFindings(options.maxFindings),
      allowPartial,
    };
    const { result: policyResult, executionStatus, errors } = evaluateComprehensivePolicy(
      securityResult,
      quality,
      sbom,
      policy
    );

    const outputFormat = resolveOutputFormat(options.format, options.ci);
    let reportPath: string;
    if (outputFormat === 'markdown') {
      const review = comprehensiveReview(
        securityResult,
        quality,
        sbom,
        policyResult,
        repoInfo,
        locResult,
        Date.now() - startedAt,
        executionPolicy.runProjectCode
      );
      reportPath = await reporter.saveReport(review, 'markdown', options.output, 'comprehensive');
    } else {
      reportPath = writeScanResult(
        securityResult,
        outputFormat,
        options.output || `guardscan-scan.${outputFormat === 'sarif' ? 'sarif' : 'json'}`,
        repoInfo.path,
        {
          command: 'scan',
          ci: options.ci,
          allowPartial,
          quality,
          sbom,
          ai,
          policy,
          policyResult,
          executionStatus,
          executionErrors: errors,
          executionMode: executionPolicy.runProjectCode
            ? 'project-code-executed'
            : 'static-analysis',
        }
      );
    }

    console.log(chalk.green(`\n✓ Report saved: ${reportPath}`));
    displaySummary(securityResult, quality, sbom, policyResult, Date.now() - startedAt);
    applyExitCode(policyResult.exitCode);

    await createTelemetryManager(config).record({
      action: 'scan',
      loc: locResult.codeLines,
      durationMs: Date.now() - startedAt,
      model: 'comprehensive-scan',
    });
  } catch (error) {
    handleCommandError(error, 'Scan', 2);
  }
}

export async function runQualityAnalysis(
  repoPath: string,
  options: ScanOptions,
  executionPolicy: EffectiveExecutionPolicy = resolveExecutionPolicy()
): Promise<QualitySection> {
  const skippedTests: CheckResult = {
    status: 'skipped',
    durationMs: 0,
    reason: executionPolicy.runProjectCode ? 'disabled-by---skip-tests' : 'project-code-execution-not-enabled',
  };
  const [rawTests, metrics, smells, rawLint] = await Promise.all([
    options.skipTests || !executionPolicy.runProjectCode
      ? Promise.resolve(skippedTests)
      : runCheck('tests', () => testRunner.runTests(repoPath, options.coverage === true, executionPolicy)),
    runCheck('metrics', () => codeMetricsAnalyzer.analyze(repoPath)),
    runCheck('smells', () => codeSmellDetector.detect(repoPath)),
    executionPolicy.runProjectCode
      ? runCheck('lint', () => linterIntegration.runAll(repoPath, executionPolicy))
      : Promise.resolve(skippedTests),
  ]);
  const tests = requireConfiguredToolOutput(
    'tests',
    rawTests,
    hasConfiguredNodeTool(repoPath, ['jest', 'vitest', 'mocha'])
  );
  const lint = requireConfiguredToolOutput(
    'lint',
    rawLint,
    hasConfiguredNodeTool(repoPath, ['eslint'])
  );
  const checks = {
    tests,
    metrics,
    smells,
    lint,
    performance: {
      status: 'skipped' as const,
      durationMs: 0,
      reason: options.skipPerf ? 'disabled-by---skip-perf' : 'not-part-of-default-scan',
    },
    mutation: {
      status: 'skipped' as const,
      durationMs: 0,
      reason: options.skipMutation ? 'disabled-by---skip-mutation' : 'not-part-of-default-scan',
    },
  };
  const attempted = [tests, metrics, smells, lint].filter(check => check.status !== 'skipped');
  const failures = attempted.filter(check => check.status === 'failed').length;
  return {
    status: attempted.length === 0
      ? 'skipped'
      : failures === 0
        ? 'complete'
        : failures === attempted.length
          ? 'failed'
          : 'partial',
    checks,
  };
}

function hasConfiguredNodeTool(repoPath: string, tools: string[]): boolean {
  const packagePath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return false;
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return tools.some(tool => Boolean(
      manifest.dependencies?.[tool] || manifest.devDependencies?.[tool]
    ));
  } catch {
    // Inventory scanning reports malformed package manifests separately.
    return false;
  }
}

function requireConfiguredToolOutput(
  name: string,
  check: CheckResult,
  configured: boolean
): CheckResult {
  if (configured && check.status === 'succeeded' && Array.isArray(check.data) && check.data.length === 0) {
    return {
      status: 'failed',
      durationMs: check.durationMs,
      error: {
        code: 'TOOL_OUTPUT_UNAVAILABLE',
        message: `${name} tool was configured but produced no parseable result`,
        retryable: false,
      },
    };
  }
  return check;
}

async function runCheck(name: string, operation: () => Promise<unknown>): Promise<CheckResult> {
  const startedAt = Date.now();
  try {
    const data = await operation();
    return {
      status: 'succeeded',
      durationMs: Date.now() - startedAt,
      data,
    };
  } catch (error) {
    return {
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: safeOperationalError(name, error),
    };
  }
}

async function createSbomSection(
  report: Promise<LicenseReport>,
  inventory: PackageInventory
): Promise<SbomSection> {
  try {
    const resolved = await report;
    const incomplete = inventory.errors.length > 0;
    return {
      status: incomplete ? 'partial' : 'succeeded',
      format: 'spdx',
      document: licenseScanner.generateSBOM(resolved.findings, 'spdx', 'repository'),
      error: incomplete
        ? {
          code: 'INVENTORY_INCOMPLETE',
          message: `SBOM inventory is incomplete (${inventory.errors.length} package metadata error(s))`,
          retryable: false,
        }
        : undefined,
    };
  } catch (error) {
    return { status: 'failed', error: safeOperationalError('sbom', error) };
  }
}

export function evaluateComprehensivePolicy(
  security: ScanEngineResult,
  quality: QualitySection,
  sbom: SbomSection,
  policy: ScanPolicy
): { result: ScanPolicyResult; executionStatus: ScanExecutionStatus; errors: ScanExecutionError[] } {
  const findingPolicy = evaluateScanPolicy(security.findings, {
    failOn: policy.failOn,
    maxFindings: policy.maxFindings,
  });
  const coveragePolicy = evaluateScanPolicy(security, {
    allowPartial: false,
  });
  const securityOperationalReasons = coveragePolicy.operationalFailure ? coveragePolicy.reasons : [];
  const nonCveSecurityFailure = security.scannerResults.some(scanner =>
    scanner.required && scanner.status === 'failed' && scanner.scanner !== 'dependencies'
  );
  const operationalReasons = policy.allowPartial && !nonCveSecurityFailure
    ? []
    : [...securityOperationalReasons];
  const policyReasons = [...findingPolicy.reasons];
  const errors: ScanExecutionError[] = [...security.errors];

  for (const [name, check] of Object.entries(quality.checks)) {
    if (check.status === 'failed' && check.error) {
      if (!policy.allowPartial || quality.status === 'failed') {
        operationalReasons.push(`Quality check failed to execute: ${name}`);
      }
      errors.push({ scanner: `quality.${name}`, ...check.error });
    }
  }
  if (sbom.status !== 'succeeded' && sbom.error) {
    if (!policy.allowPartial || sbom.status === 'failed') {
      operationalReasons.push(
        sbom.status === 'failed' ? 'SBOM generation failed' : 'SBOM inventory is incomplete'
      );
    }
    errors.push({ scanner: 'sbom', ...sbom.error });
  }

  const tests = successfulArray(quality.checks.tests);
  const failedTests = tests.reduce((total, result: any) => total + finiteCount(result?.failed), 0);
  if (failedTests > 0) {
    policyReasons.push(`${failedTests} test(s) failed`);
  }
  const lintReports = successfulArray(quality.checks.lint);
  const lintErrors = lintReports.reduce((total, report: any) => total + finiteCount(report?.errors), 0);
  if (lintErrors > 0) {
    policyReasons.push(`${lintErrors} lint error(s) found`);
  }

  const reasons = [...operationalReasons, ...policyReasons];
  const operationalFailure = operationalReasons.length > 0;
  const outcome = operationalFailure
    ? 'operational-failed' as const
    : policyReasons.length > 0
      ? 'policy-failed' as const
      : 'passed' as const;
  const result: ScanPolicyResult = {
    failed: outcome !== 'passed',
    operationalFailure,
    outcome,
    exitCode: outcome === 'operational-failed' ? 2 : outcome === 'policy-failed' ? 1 : 0,
    reasons,
  };
  const anyOperationalFailure = operationalReasons.length > 0
    || security.status !== 'complete'
    || quality.status !== 'complete'
    || sbom.status !== 'succeeded';
  const everyMajorSectionFailed = security.status === 'failed' && quality.status === 'failed' && sbom.status === 'failed';
  return {
    result,
    executionStatus: everyMajorSectionFailed ? 'failed' : anyOperationalFailure ? 'partial' : 'complete',
    errors,
  };
}

function successfulArray(check: CheckResult): any[] {
  return check.status === 'succeeded' && Array.isArray(check.data) ? check.data : [];
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function safeOperationalError(name: string, error: unknown): CheckResult['error'] {
  const candidate = error as { code?: unknown } | undefined;
  const code = typeof candidate?.code === 'string'
    ? candidate.code.toUpperCase().replace(/[^A-Z0-9_.-]/g, '').slice(0, 64)
    : 'CHECK_FAILED';
  return {
    code: code || 'CHECK_FAILED',
    message: `${name} check failed`,
    retryable: ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(code),
  };
}

function comprehensiveReview(
  security: ScanEngineResult,
  quality: QualitySection,
  sbom: SbomSection,
  policy: ScanPolicyResult,
  repoInfo: ReturnType<typeof repositoryManager.getRepoInfo>,
  locStats: Awaited<ReturnType<typeof locCounter.count>>,
  durationMs: number,
  ranProjectCode: boolean
): ReviewResult {
  const tests = successfulArray(quality.checks.tests);
  const failedTests = tests.reduce((sum, result: any) => sum + finiteCount(result?.failed), 0);
  const summary = [
    `Security findings: ${security.findings.length}`,
    `Security coverage: ${security.status}`,
    `Quality coverage: ${quality.status}`,
    `Failing tests: ${failedTests}`,
    `SBOM: ${sbom.status}`,
    `Policy: ${policy.outcome}`,
  ].join('\n');
  return {
    summary,
    findings: security.findings,
    recommendations: policy.reasons.length > 0
      ? policy.reasons.map(reason => `Resolve: ${reason}`)
      : ['Continue scanning on every pull request.'],
    metadata: {
      timestamp: new Date().toISOString(),
      repoInfo,
      locStats,
      provider: 'comprehensive-scan',
      model: 'multi-tool',
      durationMs,
      executionMode: ranProjectCode ? 'project-code-executed' : 'static-analysis',
    },
  };
}

function displaySummary(
  security: ScanEngineResult,
  quality: QualitySection,
  sbom: SbomSection,
  policy: ScanPolicyResult,
  durationMs: number
): void {
  console.log(chalk.white.bold('\n📊 Scan Summary'));
  console.log(`  Security: ${security.findings.length} finding(s), coverage ${security.status}`);
  console.log(`  Quality: ${quality.status}`);
  console.log(`  SBOM: ${sbom.status}`);
  console.log(`  Policy: ${policy.outcome}`);
  for (const reason of policy.reasons) {
    console.log(chalk.red(`    - ${reason}`));
  }
  console.log(chalk.gray(`  Duration: ${(durationMs / 1000).toFixed(1)}s`));
}

function aiState(skipAi: boolean, provider: string): Record<string, unknown> {
  if (skipAi) {
    return { status: 'skipped', reason: 'disabled-by---skip-ai' };
  }
  if (!provider || provider === 'none') {
    return { status: 'skipped', reason: 'provider-not-configured' };
  }
  return {
    status: 'not-run',
    reason: 'AI review is a separate workflow; use guardscan run',
    provider,
  };
}

function warnDeprecatedNoCloud(cloud?: boolean): void {
  if (cloud === false || process.argv.slice(2).includes('--no-cloud')) {
    console.warn('Warning: --no-cloud is deprecated; use --offline instead.');
  }
}

function resolveOutputFormat(format: ScanOptions['format'], ci?: boolean): 'markdown' | ScanOutputFormat {
  const resolved = format || (ci ? 'json' : 'markdown');
  if (resolved !== 'markdown' && resolved !== 'json' && resolved !== 'sarif') {
    throw new Error(`Invalid report format: ${resolved}. Use markdown, json, or sarif.`);
  }
  return resolved;
}

function parseConcurrency(value?: string): number {
  const parsed = value === undefined ? 4 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) {
    throw new Error('Invalid --concurrency value. Use an integer from 1 to 16.');
  }
  return parsed;
}

function parseScope(value?: string): 'all' | 'runtime' {
  const scope = value || 'all';
  if (scope !== 'all' && scope !== 'runtime') {
    throw new Error('Invalid --scope value. Use all or runtime.');
  }
  return scope;
}

function parseMaxFindings(value?: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Invalid --max-findings value. Use a non-negative integer.');
  }
  return parsed;
}

function applyExitCode(exitCode: 0 | 1 | 2): void {
  const current = Number(process.exitCode || 0);
  process.exitCode = Math.max(Number.isFinite(current) ? current : 0, exitCode);
}
