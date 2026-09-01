import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { AICache } from '../core/ai-cache';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { configManager, Config } from '../core/config';
import { licenseScanner } from '../core/license-scanner';
import { locCounter } from '../core/loc-counter';
import { collectPackageInventory } from '../core/package-inventory';
import { repositoryManager } from '../core/repository';
import {
  evaluateScanPolicy,
  ScanOutputFormat,
  ScanPolicy,
  ScanPolicyResult,
  scanEngine,
  writeScanResult,
} from '../core/scan-engine';
import { createTelemetryManager } from '../core/telemetry';
import { FixSuggestionsGenerator, SecurityIssue } from '../features/fix-suggestions';
import {
  ProviderConfigurationError,
  ProviderFactory,
} from '../providers/factory';
import { displaySimpleBanner } from '../utils/ascii-art';
import { handleCommandError } from '../utils/error-handler';
import { resolveExecutionPolicy } from '../utils/execution-policy';
import { Finding, reporter, ReviewResult } from '../utils/reporter';
import { SECURITY_CONSTANTS } from '../constants/security-constants';

interface SecurityOptions {
  files?: string[];
  licenses?: boolean;
  cve?: boolean;
  allowPartial?: boolean;
  concurrency?: string;
  scope?: string;
  aiFix?: boolean;
  interactive?: boolean;
  debug?: boolean;
  ci?: boolean;
  cloud?: boolean;
  cache?: boolean;
  offline?: boolean;
  format?: 'markdown' | ScanOutputFormat;
  output?: string;
  failOn?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  maxFindings?: string;
}

export async function securityCommand(options: SecurityOptions): Promise<void> {
  const startedAt = Date.now();
  displaySimpleBanner('security');

  try {
    const config = configManager.loadOrInit();
    warnDeprecatedNoCloud(options.cloud);
    const repoInfo = repositoryManager.getRepoInfo();
    const includeVulnerabilities = options.cve !== false && config.vulnerabilities?.enabled !== false;
    const executionPolicy = resolveExecutionPolicy({
      configOffline: config.offlineMode,
      offline: options.offline,
      cloud: options.cloud,
      cve: includeVulnerabilities,
      allowPartial: options.allowPartial,
    });
    const { offline, allowPartial } = executionPolicy;
    const concurrency = parseConcurrency(options.concurrency);
    const vulnerabilityScope = parseScope(options.scope || config.vulnerabilities?.scope);
    const useCache = options.cache !== false &&
      process.env.GUARDSCAN_NO_CACHE !== 'true' &&
      config.cache?.enabled !== false;
    const inventory = includeVulnerabilities || options.licenses
      ? collectPackageInventory(repoInfo.path)
      : undefined;
    const locResult = await locCounter.count(options.files);
    const licenseReport = options.licenses
      ? licenseScanner.scan(repoInfo.path, 'proprietary', { offline, inventory })
      : undefined;

    console.log(chalk.gray(`Repository: ${repoInfo.name}\n`));
    const scanResult = await scanEngine.runSecurityScan({
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
      licenseReport,
    });

    let ai: Record<string, unknown> = {
      status: 'skipped',
      reason: options.aiFix ? 'no-findings' : 'not-requested',
    };
    if (options.aiFix && scanResult.findings.length > 0) {
      ai = await generateAIFixes(
        scanResult.findings,
        repoInfo.path,
        config,
        options.interactive === true,
        offline
      );
    }

    const policy: ScanPolicy = {
      failOn: options.failOn,
      maxFindings: parseMaxFindings(options.maxFindings),
      allowPartial,
    };
    const policyResult = evaluateScanPolicy(scanResult, policy);
    const outputFormat = resolveOutputFormat(options.format, options.ci);
    let reportPath: string;
    if (outputFormat === 'markdown') {
      reportPath = await reporter.saveReport(
        securityReview(scanResult.findings, policyResult, repoInfo, locResult, Date.now() - startedAt),
        'markdown',
        options.output,
        'security'
      );
    } else {
      reportPath = writeScanResult(
        scanResult,
        outputFormat,
        options.output || `guardscan-security.${outputFormat === 'sarif' ? 'sarif' : 'json'}`,
        repoInfo.path,
        {
          command: 'security',
          ci: options.ci,
          allowPartial,
          quality: { status: 'skipped', reason: 'not-part-of-security-command' },
          sbom: { status: 'skipped', reason: 'use-guardscan-sbom-or-scan' },
          ai,
          policy,
          policyResult,
        }
      );
    }

    console.log(chalk.green(`✓ Report saved: ${reportPath}`));
    displaySecuritySummary(scanResult.findings, scanResult.status, policyResult);
    applyExitCode(policyResult.exitCode);

    await createTelemetryManager(config).record({
      action: 'security',
      loc: locResult.codeLines,
      durationMs: Date.now() - startedAt,
      model: 'sast',
    });
  } catch (error) {
    handleCommandError(error, 'Security scan', 2);
  }
}

function securityReview(
  findings: Finding[],
  policy: ScanPolicyResult,
  repoInfo: ReturnType<typeof repositoryManager.getRepoInfo>,
  locStats: Awaited<ReturnType<typeof locCounter.count>>,
  durationMs: number
): ReviewResult {
  const counts = countSeverities(findings);
  return {
    summary: [
      `Security scan found ${findings.length} issue(s).`,
      ...Object.entries(counts).map(([severity, count]) => `${severity}: ${count}`),
      `Policy: ${policy.outcome}`,
    ].join('\n'),
    findings,
    recommendations: policy.reasons.length > 0
      ? policy.reasons.map(reason => `Resolve: ${reason}`)
      : ['Continue scanning on every pull request.'],
    metadata: {
      timestamp: new Date().toISOString(),
      repoInfo,
      locStats,
      provider: 'security-scanner',
      model: 'multi-scanner',
      durationMs,
    },
  };
}

function displaySecuritySummary(
  findings: Finding[],
  coverage: string,
  policy: ScanPolicyResult
): void {
  console.log(chalk.white.bold('\n🔒 Security Summary'));
  const counts = countSeverities(findings);
  for (const [severity, count] of Object.entries(counts)) {
    if (count > 0) {
      console.log(`  ${severity}: ${count}`);
    }
  }
  if (findings.length === 0) {
    console.log(chalk.green('  No security findings'));
  }
  console.log(`  Coverage: ${coverage}`);
  console.log(`  Policy: ${policy.outcome}`);
  for (const reason of policy.reasons) {
    console.log(chalk.red(`    - ${reason}`));
  }
}

function countSeverities(findings: Finding[]): Record<Finding['severity'], number> {
  const counts: Record<Finding['severity'], number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const finding of findings) {
    counts[finding.severity]++;
  }
  return counts;
}

async function generateAIFixes(
  findings: Finding[],
  repoRoot: string,
  config: Config,
  _interactive: boolean,
  offline: boolean
): Promise<Record<string, unknown>> {
  if (!ProviderFactory.isConfigured(config)) {
    console.log(chalk.yellow('\nAI fixes skipped: no usable provider or credential is configured.'));
    return { status: 'skipped', reason: 'provider-not-configured' };
  }

  try {
    // Enforce offline policy before reading source snippets or building context.
    const provider = ProviderFactory.createForCli(config, {
      task: 'code-review',
      offline,
    });
    const repoInfo = repositoryManager.getRepoInfo();
    const cache = new AICache(repoInfo.repoId, config.cache || { maxSizeMB: 100 });
    const indexer = new CodebaseIndexer(repoRoot, repoInfo.repoId);
    const generator = new FixSuggestionsGenerator(provider, indexer, cache, repoRoot);
    const issues: SecurityIssue[] = findings
      .filter(finding => finding.file && finding.line && !finding.file.startsWith('commit:'))
      .map(finding => ({
        severity: finding.severity === 'critical' ? 'high' :
          finding.severity === 'info' ? 'low' : finding.severity,
        category: finding.category,
        file: path.resolve(repoRoot, finding.file),
        line: finding.line!,
        codeSnippet: extractCodeSnippet(path.resolve(repoRoot, finding.file), finding.line!),
        description: finding.description,
      }));
    if (issues.length === 0) {
      return { status: 'skipped', reason: 'no-source-located-findings' };
    }

    console.log(chalk.blue(`\nGenerating AI fixes for ${issues.length} issue(s)...`));
    const fixes = await generator.generateFixes(issues, 5);
    const fixesDir = path.join(repoRoot, '.guardscan', 'fixes');
    fs.mkdirSync(fixesDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(fixesDir, `fixes-${timestamp}.json`);
    const data = Array.from(fixes.entries()).map(([key, fix]) => ({
      issue: issues.find(issue => `${issue.file}:${issue.line}` === key),
      fix,
    }));
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    console.log(chalk.green(`Generated ${fixes.size} AI fix suggestion(s): ${outputPath}`));
    return { status: 'succeeded', count: fixes.size, output: path.relative(repoRoot, outputPath) };
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      console.log(chalk.yellow(`\nAI fixes skipped: ${error.message}`));
      return { status: 'skipped', reason: error.code };
    }
    console.log(chalk.yellow('\nAI fixes failed; static security results are still available.'));
    return { status: 'failed', reason: 'AI_FIX_GENERATION_FAILED' };
  }
}

function extractCodeSnippet(
  filePath: string,
  line: number,
  context: number = SECURITY_CONSTANTS.CODE_SNIPPET_CONTEXT_LINES
): string {
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    return lines.slice(Math.max(0, line - context - 1), Math.min(lines.length, line + context)).join('\n');
  } catch {
    return '';
  }
}

function warnDeprecatedNoCloud(cloud?: boolean): void {
  if (cloud === false || process.argv.slice(2).includes('--no-cloud')) {
    console.warn('Warning: --no-cloud is deprecated; use --offline instead.');
  }
}

function resolveOutputFormat(format: SecurityOptions['format'], ci?: boolean): 'markdown' | ScanOutputFormat {
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
