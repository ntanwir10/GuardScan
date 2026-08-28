import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import fastGlob from 'fast-glob';
import { Finding } from '../utils/reporter';
import { apiScanner } from './api-scanner';
import { complianceChecker } from './compliance-checker';
import { dependencyScanner } from './dependency-scanner';
import { dockerfileScanner } from './dockerfile-scanner';
import { iacScanner } from './iac-scanner';
import { licenseScanner, LicenseReport } from './license-scanner';
import { owaspScanner } from './owasp-scanner';
import { PackageInventory } from './package-inventory';
import { secretsDetector } from './secrets-detector';

export type ScanSeverity = Finding['severity'];
export type ScanOutputFormat = 'json' | 'sarif';
export type ScannerStatus = 'succeeded' | 'failed' | 'skipped';
export type ScanExecutionStatus = 'complete' | 'partial' | 'failed';
export type ScannerSkipReason = 'not-applicable' | 'offline' | 'disabled';
export type ScanPolicyOutcome = 'passed' | 'policy-failed' | 'operational-failed';

export interface ScanFile {
  path: string;
  language?: string;
}

/**
 * A scanner error safe to expose in JSON, SARIF, and CI logs. Scanner adapters
 * should keep raw errors in their own debug-only logging rather than placing
 * paths, tokens, source, or response bodies here.
 */
export interface ScannerError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ScanFinding extends Finding {
  ruleId: string;
  fingerprint: string;
  scanners: string[];
  metadata?: Record<string, unknown>;
}

export interface ScannerTask {
  scanner: string;
  required?: boolean;
  skipReason?: ScannerSkipReason;
  run: () => Promise<Finding[] | ScannerTaskOutput>;
}

export interface ScannerTaskOutput {
  findings: Finding[];
  /** Marks useful-but-incomplete scanner output as an operational failure. */
  error?: ScannerError;
}

export interface ScanEngineOptions {
  repoPath?: string;
  files?: ScanFile[];
  offline?: boolean;
  includeLicenses?: boolean;
  includeVulnerabilities?: boolean;
  includeGitHistory?: boolean;
  allowPartial?: boolean;
  cache?: boolean;
  vulnerabilityScope?: 'all' | 'runtime';
  vulnerabilityEndpoint?: string;
  vulnerabilitySnapshotMaxAgeDays?: number;
  vulnerabilityEnrichKnownExploited?: boolean;
  vulnerabilityKevMaxCacheAgeDays?: number;
  /** Caller-owned inventory shared by vulnerability, license, and SBOM work. */
  packageInventory?: PackageInventory;
  /** Caller-owned report (or in-flight report) shared with SBOM generation. */
  licenseReport?: LicenseReport | Promise<LicenseReport>;
  concurrency?: number;
  onProgress?: (scanner: ScannerRunResult) => void;
  /** Test and extension seam. Supplying tasks replaces the built-in registry. */
  scannerTasks?: readonly ScannerTask[];
}

export interface ScannerRunResult {
  scanner: string;
  required: boolean;
  status: ScannerStatus;
  findings: ScanFinding[];
  rawCount: number;
  findingCount: number;
  deduplicatedCount: number;
  durationMs: number;
  skipReason?: ScannerSkipReason;
  /** Kept as an explicit legacy signal while commands migrate to status. */
  skipped?: boolean;
  error?: ScannerError;
}

export interface ScanExecutionError extends ScannerError {
  scanner: string;
}

export interface ScanEngineResult {
  runId: string;
  startedAt: string;
  completedAt: string;
  status: ScanExecutionStatus;
  findings: ScanFinding[];
  scannerResults: ScannerRunResult[];
  errors: ScanExecutionError[];
  durationMs: number;
  offline: boolean;
  repository: string;
}

export interface ScanPolicy {
  failOn?: ScanSeverity;
  maxFindings?: number;
  allowPartial?: boolean;
}

export interface ScanPolicyResult {
  failed: boolean;
  operationalFailure: boolean;
  outcome: ScanPolicyOutcome;
  exitCode: 0 | 1 | 2;
  reasons: string[];
}

export interface ScanSerializationContext {
  command?: 'scan' | 'security' | string;
  ci?: boolean;
  allowPartial?: boolean;
  quality?: unknown;
  sbom?: unknown;
  ai?: unknown;
  policy?: ScanPolicy;
  policyResult?: ScanPolicyResult;
  executionStatus?: ScanExecutionStatus;
  executionErrors?: ScanExecutionError[];
  executionMode?: 'static-analysis' | 'project-code-executed';
}

export interface GuardScanResultEnvelope {
  schemaVersion: 'guardscan.scan.v1';
  command: string;
  run: {
    id: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    status: ScanExecutionStatus;
    offline: boolean;
    ci: boolean;
    allowPartial: boolean;
    executionMode: 'static-analysis' | 'project-code-executed';
    repository: string;
  };
  summary: Record<ScanSeverity, number> & { total: number };
  security: {
    status: ScanExecutionStatus;
    findings: ScanFinding[];
    scanners: ScannerRunResult[];
    knownExploitedEnrichment?: Record<string, unknown>;
  };
  quality: Record<string, unknown>;
  sbom: Record<string, unknown>;
  ai: Record<string, unknown>;
  policy: {
    status: ScanPolicyOutcome;
    configuration: ScanPolicy;
    reasons: string[];
    exitCode: 0 | 1 | 2;
  };
  errors: ScanExecutionError[];
}

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;
const PACKAGE_VERSION = (require('../../package.json') as { version: string }).version;
const OFFICIAL_SARIF_SCHEMA =
  'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json';

const SEVERITY_RANK: Record<ScanSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export class ScanEngine {
  async runSecurityScan(options: ScanEngineOptions = {}): Promise<ScanEngineResult> {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const repoPath = resolveRepositoryRoot(options.repoPath || process.cwd());
    const offline = options.offline === true;
    const concurrency = validateConcurrency(options.concurrency);
    const files = options.files
      ? resolveScanFiles(options.files, repoPath)
      : await this.loadFiles(repoPath);
    const tasks = options.scannerTasks
      ? [...options.scannerTasks]
      : this.createBuiltInTasks(options, repoPath, files, offline);

    const scannerResults = await runBounded(
      tasks,
      concurrency,
      task => this.runScanner(task, repoPath, options.onProgress)
    );
    const findings = mergeAndSortFindings(
      scannerResults.flatMap(scanner => scanner.findings)
    );
    const errors: ScanExecutionError[] = scannerResults
      .filter((scanner): scanner is ScannerRunResult & { error: ScannerError } => Boolean(scanner.error))
      .map(scanner => ({ scanner: scanner.scanner, ...scanner.error }));
    const status = determineExecutionStatus(scannerResults);
    const completedAtMs = Date.now();

    return {
      runId: randomUUID(),
      startedAt,
      completedAt: new Date(completedAtMs).toISOString(),
      status,
      findings,
      scannerResults,
      errors,
      durationMs: completedAtMs - startedAtMs,
      offline,
      repository: '.',
    };
  }

  private createBuiltInTasks(
    options: ScanEngineOptions,
    repoPath: string,
    files: ScanFile[],
    offline: boolean
  ): ScannerTask[] {
    const tasks: ScannerTask[] = [
      {
        scanner: 'patterns',
        required: true,
        run: async () => {
          const patternFindings: Finding[] = [];
          let skippedFiles = 0;
          for (const file of files) {
            try {
              const content = fs.readFileSync(file.path, 'utf-8');
              patternFindings.push(...scanFileForVulnerabilities(file.path, content));
            } catch {
              skippedFiles += 1;
            }
          }
          if (skippedFiles > 0) {
            return {
              findings: patternFindings,
              error: {
                code: 'PATTERN_SCAN_PARTIAL',
                message: `Pattern coverage skipped ${skippedFiles} unreadable or missing file(s).`,
                retryable: true,
              },
            };
          }
          return patternFindings;
        },
      },
      options.includeVulnerabilities === false
        ? {
          scanner: 'dependencies',
          required: false,
          skipReason: 'disabled',
          run: async () => [],
        }
        : {
        scanner: 'dependencies',
        required: true,
        run: async () => {
          const results = await dependencyScanner.scan(repoPath, {
            offline,
            allowPartial: options.allowPartial,
            cache: options.cache,
            strictInventory: true,
            concurrency: options.concurrency,
            scope: options.vulnerabilityScope,
            endpoint: options.vulnerabilityEndpoint,
            maxSnapshotAgeDays: options.vulnerabilitySnapshotMaxAgeDays,
            enrichKnownExploited: options.vulnerabilityEnrichKnownExploited,
            kevMaxCacheAgeDays: options.vulnerabilityKevMaxCacheAgeDays,
            inventory: options.packageInventory,
          });
          const dependencyFindings: ScanFinding[] = [];
          for (const result of results) {
            for (const vuln of result.vulnerabilities) {
              dependencyFindings.push({
                severity: normalizeSeverity(vuln.severity),
                category: `Dependency Vulnerability (${result.ecosystem})`,
                file: vuln.lockfilePath || dependencyManifestFor(result.ecosystem),
                description: `${vuln.package}@${vuln.version}: ${vuln.title}`,
                suggestion: vuln.recommendation,
                ruleId: vuln.canonicalId,
                fingerprint: vuln.fingerprint,
                scanners: ['dependencies'],
                metadata: {
                  package: vuln.package,
                  version: vuln.version,
                  ecosystem: vuln.ecosystem,
                  aliases: vuln.aliases,
                  cveIds: vuln.cveIds,
                  fixedVersions: vuln.fixedVersions,
                  knownExploited: vuln.knownExploited,
                  knownExploitedEnrichment: result.knownExploitedEnrichment,
                  cvss: vuln.cvss,
                  scope: vuln.scope,
                  direct: vuln.direct,
                },
              });
            }
          }
          const partialResults = results.filter(result => result.status === 'partial');
          if (partialResults.length > 0) {
            const errorCodes = Array.from(new Set(
              partialResults.flatMap(result => result.errors.map(error => error.code))
            )).sort();
            return {
              findings: dependencyFindings,
              error: {
                code: 'DEPENDENCY_SCAN_PARTIAL',
                message: `Dependency vulnerability coverage is incomplete${
                  errorCodes.length > 0 ? ` (${errorCodes.join(', ')})` : ''
                }`,
                retryable: true,
              },
            };
          }
          return dependencyFindings;
        },
      },
      {
        scanner: 'secrets',
        required: true,
        run: async () => {
          const filePaths = files.map(file => file.path);
          const fileSecrets = await secretsDetector.detectInFiles(filePaths);
          const gitSecrets = options.includeGitHistory === false
            ? []
            : await secretsDetector.scanGitHistory(repoPath);

          return [...fileSecrets, ...gitSecrets].map(secret => {
            const normalizedFile = normalizeArtifactPath(secret.file, repoPath) || '<unknown>';
            const secretDigest = createHash('sha256').update(secret.secret).digest('hex');
            const fingerprint = createHash('sha256').update([
              'guardscan.secret.v1',
              normalizedFile,
              String(secret.line),
              secretDigest,
            ].join('\0')).digest('hex');
            return {
              severity: normalizeSeverity(secret.severity),
              category: secret.file.startsWith('commit:')
                ? `Secret in Git History: ${secret.type}`
                : `Secret Detection: ${secret.type}`,
              file: secret.file,
              line: secret.line,
              description: `Potential secret detected (entropy: ${secret.entropy.toFixed(2)})`,
              suggestion: secret.recommendation,
              ruleId: `guardscan.secret.${sanitizeRuleId(secret.type)}`,
              fingerprint,
              scanners: ['secrets'],
            };
          });
        },
      },
      {
        scanner: 'dockerfile',
        required: true,
        run: () => dockerfileScanner.scan(repoPath),
      },
      {
        scanner: 'iac',
        required: true,
        run: () => iacScanner.scan(repoPath),
      },
      {
        scanner: 'owasp',
        required: true,
        run: () => owaspScanner.scan(repoPath),
      },
      {
        scanner: 'api',
        required: true,
        run: async () => {
          const apiFindings = await apiScanner.scan(repoPath);
          return apiFindings.map(finding => ({
            severity: normalizeSeverity(finding.severity),
            category: `${finding.category} API: ${finding.type}`,
            file: finding.file,
            line: finding.line,
            description: finding.description,
            suggestion: finding.recommendation,
          }));
        },
      },
      {
        scanner: 'compliance',
        required: true,
        run: async () => {
          const complianceReports = await complianceChecker.check(repoPath);
          const complianceFindings: Finding[] = [];
          for (const report of complianceReports) {
            for (const violation of report.violations) {
              complianceFindings.push({
                severity: normalizeSeverity(violation.severity),
                category: `${report.standard} Compliance: ${violation.type}`,
                file: violation.file,
                line: violation.line,
                description: violation.description,
                suggestion: violation.recommendation,
              });
            }
          }
          return complianceFindings;
        },
      },
    ];

    if (options.includeLicenses) {
      tasks.push({
        scanner: 'licenses',
        required: true,
        run: async () => {
          const report = options.licenseReport
            ? await options.licenseReport
            : await licenseScanner.scan(repoPath, 'proprietary', {
              offline,
              inventory: options.packageInventory,
            });
          const licenseFindings: Finding[] = [];

          for (const licenseFinding of report.findings) {
            if (licenseFinding.risk === 'critical' || licenseFinding.risk === 'high') {
              licenseFindings.push({
                severity: normalizeSeverity(licenseFinding.risk),
                category: `License Compliance: ${licenseFinding.category}`,
                file: 'dependencies',
                description: `${licenseFinding.package}@${licenseFinding.version}: ${licenseFinding.license}`,
                suggestion: `Review license compatibility - ${licenseFinding.description}`,
              });
            }
          }

          for (const issue of report.compatibilityIssues) {
            licenseFindings.push({
              severity: normalizeSeverity(issue.severity),
              category: 'License Compatibility',
              file: 'dependencies',
              description: issue.conflict,
              suggestion: issue.recommendation,
            });
          }

          return licenseFindings;
        },
      });
    }

    return tasks;
  }

  private async runScanner(
    task: ScannerTask,
    repoRoot: string,
    onProgress?: (scanner: ScannerRunResult) => void
  ): Promise<ScannerRunResult> {
    const scannerStartedAt = Date.now();
    const required = task.required !== false;
    let result: ScannerRunResult;

    if (task.skipReason) {
      result = {
        scanner: task.scanner,
        required,
        status: 'skipped',
        findings: [],
        rawCount: 0,
        findingCount: 0,
        deduplicatedCount: 0,
        durationMs: Date.now() - scannerStartedAt,
        skipReason: task.skipReason,
        skipped: true,
      };
    } else {
      try {
        const output = await task.run();
        const rawFindings = Array.isArray(output) ? output : output.findings;
        const findings = normalizeAndDedupeFindings(rawFindings, task.scanner, repoRoot);
        const partialError = Array.isArray(output) ? undefined : output.error;
        result = {
          scanner: task.scanner,
          required,
          status: partialError ? 'failed' : 'succeeded',
          findings,
          rawCount: rawFindings.length,
          findingCount: findings.length,
          deduplicatedCount: rawFindings.length - findings.length,
          durationMs: Date.now() - scannerStartedAt,
          error: partialError,
        };
      } catch (error) {
        result = {
          scanner: task.scanner,
          required,
          status: 'failed',
          findings: [],
          rawCount: 0,
          findingCount: 0,
          deduplicatedCount: 0,
          durationMs: Date.now() - scannerStartedAt,
          error: sanitizeScannerError(task.scanner, error, repoRoot),
        };
      }
    }

    try {
      onProgress?.(result);
    } catch {
      // UI progress callbacks are advisory and must not alter scan integrity.
    }
    return result;
  }

  private async loadFiles(repoRoot: string): Promise<ScanFile[]> {
    const files = await fastGlob(
      ['**/*.{js,jsx,ts,tsx,py,java,go,rs,c,cpp,h,hpp,cs,rb,php,swift,kt,scala,sh,bash}'],
      {
        cwd: repoRoot,
        absolute: true,
        onlyFiles: true,
        followSymbolicLinks: false,
        unique: true,
        ignore: [
          'node_modules/**',
          '.git/**',
          'dist/**',
          'build/**',
          'coverage/**',
          '**/*.min.js',
          '**/*.map',
        ],
      }
    );

    const resolved: ScanFile[] = [];
    for (const file of files) {
      try {
        resolved.push({ path: assertInsideRepository(file, repoRoot) });
      } catch {
        // Files can disappear or become unreadable between globbing and canonicalization.
      }
    }
    return resolved.sort((a, b) => a.path.localeCompare(b.path));
  }
}

export function evaluateScanPolicy(
  scan: readonly Finding[] | ScanEngineResult,
  policy: ScanPolicy = {}
): ScanPolicyResult {
  const findings: readonly Finding[] = Array.isArray(scan)
    ? scan as readonly Finding[]
    : (scan as ScanEngineResult).findings;
  const scanResult = Array.isArray(scan) ? undefined : scan as ScanEngineResult;
  const policyReasons: string[] = [];
  const operationalReasons: string[] = [];
  const failOn = policy.failOn;

  if (failOn) {
    const threshold = SEVERITY_RANK[failOn];
    if (threshold === undefined) {
      throw new Error(`Invalid --fail-on severity: ${failOn}. Use critical, high, medium, low, or info.`);
    }
    const matching = findings.filter(
      finding => SEVERITY_RANK[finding.severity] >= threshold
    );
    if (matching.length > 0) {
      policyReasons.push(`${matching.length} finding(s) at or above ${failOn} severity`);
    }
  }

  if (policy.maxFindings !== undefined) {
    if (!Number.isInteger(policy.maxFindings) || policy.maxFindings < 0) {
      throw new Error('Invalid max findings policy. Use a non-negative integer.');
    }
    if (findings.length > policy.maxFindings) {
      policyReasons.push(`${findings.length} finding(s) exceeds maximum ${policy.maxFindings}`);
    }
  }

  if (scanResult && scanResult.status !== 'complete' && !policy.allowPartial) {
    const failedRequired = scanResult.scannerResults
      .filter(scanner => scanner.required && scanner.status === 'failed')
      .map(scanner => scanner.scanner)
      .sort();
    operationalReasons.push(
      failedRequired.length > 0
        ? `Required scanner failure(s): ${failedRequired.join(', ')}`
        : `Scan execution is ${scanResult.status}`
    );
  }

  const operationalFailure = operationalReasons.length > 0;
  const outcome: ScanPolicyOutcome = operationalFailure
    ? 'operational-failed'
    : policyReasons.length > 0
      ? 'policy-failed'
      : 'passed';

  return {
    failed: outcome !== 'passed',
    operationalFailure,
    outcome,
    exitCode: outcome === 'operational-failed' ? 2 : outcome === 'policy-failed' ? 1 : 0,
    reasons: [...operationalReasons, ...policyReasons],
  };
}

export function createScanEnvelope(
  result: ScanEngineResult,
  context: ScanSerializationContext = {}
): GuardScanResultEnvelope {
  const effectivePolicy: ScanPolicy = {
    ...context.policy,
    allowPartial: context.allowPartial ?? context.policy?.allowPartial,
  };
  const policyResult = context.policyResult || evaluateScanPolicy(result, effectivePolicy);

  return {
    schemaVersion: 'guardscan.scan.v1',
    command: context.command || 'security',
    run: {
      id: result.runId,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
      status: context.executionStatus || result.status,
      offline: result.offline,
      ci: context.ci === true,
      allowPartial: effectivePolicy.allowPartial === true,
      executionMode: context.executionMode || 'static-analysis',
      repository: result.repository || '.',
    },
    summary: summarizeFindings(result.findings),
    security: {
      status: result.status,
      findings: result.findings,
      scanners: result.scannerResults,
      knownExploitedEnrichment: collectKnownExploitedEnrichment(result),
    },
    quality: normalizeEnvelopeSection(context.quality, 'not-provided'),
    sbom: normalizeEnvelopeSection(context.sbom, 'not-provided'),
    ai: normalizeEnvelopeSection(context.ai, 'not-requested'),
    policy: {
      status: policyResult.outcome,
      configuration: effectivePolicy,
      reasons: policyResult.reasons,
      exitCode: policyResult.exitCode,
    },
    errors: mergeExecutionErrors(result.errors, context.executionErrors || []),
  };
}

function mergeExecutionErrors(
  left: readonly ScanExecutionError[],
  right: readonly ScanExecutionError[]
): ScanExecutionError[] {
  const errors = new Map<string, ScanExecutionError>();
  for (const error of [...left, ...right]) {
    const key = `${error.scanner}\0${error.code}\0${error.message}`;
    errors.set(key, error);
  }
  return [...errors.values()].sort((a, b) =>
    a.scanner.localeCompare(b.scanner) || a.code.localeCompare(b.code)
  );
}

function collectKnownExploitedEnrichment(
  result: ScanEngineResult
): Record<string, unknown> | undefined {
  for (const finding of result.findings) {
    const enrichment = finding.metadata?.knownExploitedEnrichment;
    if (enrichment && typeof enrichment === 'object' && !Array.isArray(enrichment)) {
      return enrichment as Record<string, unknown>;
    }
  }
  const unavailable = result.errors.find(error => error.code === 'KEV_COVERAGE_UNAVAILABLE');
  if (!unavailable) {return undefined;}
  return {
    status: 'unavailable',
    source: 'cisa-kev',
    error: {
      code: unavailable.code,
      message: unavailable.message,
      retryable: unavailable.retryable,
    },
  };
}

export function serializeScanResult(
  result: ScanEngineResult,
  format: ScanOutputFormat,
  repoRoot: string = process.cwd(),
  context: ScanSerializationContext = {}
): string {
  if (format === 'sarif') {
    return JSON.stringify(toSarif(result, repoRoot, context), null, 2);
  }

  return JSON.stringify(createScanEnvelope(result, context), null, 2);
}

export function writeScanResult(
  result: ScanEngineResult,
  format: ScanOutputFormat,
  outputPath: string,
  repoRoot: string = process.cwd(),
  context: ScanSerializationContext = {}
): string {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    serializeScanResult(result, format, repoRoot, context),
    'utf-8'
  );
  return outputPath;
}

function normalizeEnvelopeSection(
  value: unknown,
  reason: string
): Record<string, unknown> {
  if (value === undefined || value === null) {
    return { status: 'skipped', reason };
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return record.status ? record : { status: 'succeeded', data: record };
  }
  return { status: 'succeeded', data: value };
}

function summarizeFindings(
  findings: readonly Finding[]
): Record<ScanSeverity, number> & { total: number } {
  const summary = findings.reduce(
    (counts, finding) => {
      counts[finding.severity]++;
      return counts;
    },
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<ScanSeverity, number>
  );
  return { ...summary, total: findings.length };
}

function toSarif(
  result: ScanEngineResult,
  repoRoot: string,
  context: ScanSerializationContext = {}
): Record<string, unknown> {
  const failedScanners = result.scannerResults.filter(scanner => scanner.status === 'failed');
  const notifications = new Map<string, Record<string, unknown>>();
  for (const scanner of failedScanners) {
    notifications.set(scanner.scanner, {
      level: scanner.required ? 'error' : 'warning',
      message: {
        text: scanner.error?.message || `Scanner ${scanner.scanner} failed`,
      },
      descriptor: {
        id: `guardscan.scanner.${sanitizeRuleId(scanner.scanner)}`,
      },
    });
  }
  for (const error of context.executionErrors || []) {
    notifications.set(error.scanner, {
      level: 'error',
      message: { text: error.message },
      descriptor: {
        id: `guardscan.scanner.${sanitizeRuleId(error.scanner)}`,
      },
    });
  }
  const overallStatus = context.executionStatus || result.status;

  return {
    version: '2.1.0',
    $schema: OFFICIAL_SARIF_SCHEMA,
    runs: [
      {
        tool: {
          driver: {
            name: 'GuardScan',
            semanticVersion: PACKAGE_VERSION,
            informationUri: 'https://github.com/ntanwir10/GuardScan',
            rules: buildSarifRules(result.findings),
          },
        },
        invocations: [
          {
            executionSuccessful: overallStatus === 'complete',
            properties: {
              knownExploitedEnrichment: collectKnownExploitedEnrichment(result),
            },
            toolExecutionNotifications: notifications.size > 0
              ? [...notifications.values()]
              : undefined,
          },
        ],
        results: result.findings.map(finding => {
          const location = sarifLocationFor(finding, repoRoot);
          return {
            ruleId: finding.ruleId || ruleIdFor(finding),
            level: sarifLevelFor(finding.severity),
            message: { text: finding.description },
            locations: location ? [location] : undefined,
            partialFingerprints: {
              'guardscanFinding/v1': finding.fingerprint || fingerprintFor(finding, repoRoot),
            },
            properties: {
              severity: finding.severity,
              scanners: finding.scanners,
              suggestion: finding.suggestion,
              ...finding.metadata,
            },
          };
        }),
      },
    ],
  };
}

function buildSarifRules(findings: readonly ScanFinding[]): Record<string, unknown>[] {
  const rules = new Map<string, ScanFinding>();
  for (const finding of findings) {
    if (!rules.has(finding.ruleId)) {
      rules.set(finding.ruleId, finding);
    }
  }

  return Array.from(rules.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, finding]) => ({
      id,
      name: sanitizeRuleId(finding.category),
      shortDescription: { text: finding.category },
      help: finding.suggestion ? { text: finding.suggestion } : undefined,
      defaultConfiguration: { level: sarifLevelFor(finding.severity) },
      properties: { tags: ['security', `severity/${finding.severity}`] },
    }));
}

function sarifLocationFor(
  finding: Finding,
  repoRoot: string
): Record<string, unknown> | undefined {
  const normalized = normalizeArtifactPath(finding.file, repoRoot);
  if (!normalized || normalized.startsWith('<') || normalized.startsWith('commit:')) {
    return undefined;
  }

  return {
    physicalLocation: {
      artifactLocation: { uri: encodeSarifUri(normalized) },
      region: Number.isInteger(finding.line) && (finding.line || 0) > 0
        ? { startLine: finding.line }
        : undefined,
    },
  };
}

function encodeSarifUri(filePath: string): string {
  return filePath
    .split('/')
    .filter(segment => segment.length > 0)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function ruleIdFor(finding: Finding): string {
  const explicitRuleId = (finding as Partial<ScanFinding>).ruleId;
  return explicitRuleId || `guardscan.${sanitizeRuleId(finding.category)}`;
}

function sanitizeRuleId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-|-$/g, '') || 'finding';
}

function sarifLevelFor(severity: ScanSeverity): 'error' | 'warning' | 'note' {
  if (severity === 'critical' || severity === 'high') {
    return 'error';
  }
  if (severity === 'medium' || severity === 'low') {
    return 'warning';
  }
  return 'note';
}

function validateConcurrency(value?: number): number {
  const concurrency = value ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new Error(`Invalid scan concurrency: ${String(value)}. Use an integer from 1 to ${MAX_CONCURRENCY}.`);
  }
  return concurrency;
}

async function runBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= values.length) {
          return;
        }
        results[index] = await worker(values[index], index);
      }
    }
  );

  await Promise.all(runners);
  return results;
}

function determineExecutionStatus(scannerResults: readonly ScannerRunResult[]): ScanExecutionStatus {
  const required = scannerResults.filter(scanner => scanner.required);
  const failed = required.filter(scanner => scanner.status === 'failed');
  if (failed.length === 0) {
    return 'complete';
  }
  const succeeded = required.filter(scanner => scanner.status === 'succeeded');
  return succeeded.length === 0 ? 'failed' : 'partial';
}

function normalizeAndDedupeFindings(
  findings: readonly Finding[],
  scanner: string,
  repoRoot: string
): ScanFinding[] {
  const normalized = findings.map(finding => normalizeFinding(finding, scanner, repoRoot));
  return mergeAndSortFindings(normalized);
}

function normalizeFinding(finding: Finding, scanner: string, repoRoot: string): ScanFinding {
  const existing = finding as Partial<ScanFinding>;
  const normalizedFile = normalizeArtifactPath(finding.file, repoRoot) || '<unknown>';
  const ruleId = existing.ruleId || ruleIdFor(finding);
  const scanners = Array.from(new Set([...(existing.scanners || []), scanner])).sort();
  const normalized: ScanFinding = {
    ...finding,
    file: normalizedFile,
    ruleId,
    scanners,
    fingerprint: '',
  };
  normalized.fingerprint = existing.fingerprint || fingerprintFor(normalized, repoRoot);
  return normalized;
}

function mergeAndSortFindings(findings: readonly ScanFinding[]): ScanFinding[] {
  const merged = new Map<string, ScanFinding>();
  for (const finding of findings) {
    const current = merged.get(finding.fingerprint);
    if (!current) {
      merged.set(finding.fingerprint, { ...finding, scanners: [...finding.scanners] });
      continue;
    }
    current.scanners = Array.from(new Set([...current.scanners, ...finding.scanners])).sort();
    if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[current.severity]) {
      current.severity = finding.severity;
    }
    if (!current.suggestion && finding.suggestion) {
      current.suggestion = finding.suggestion;
    }
  }

  return Array.from(merged.values()).sort((left, right) =>
    left.file.localeCompare(right.file) ||
    (left.line || 0) - (right.line || 0) ||
    left.ruleId.localeCompare(right.ruleId) ||
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
    left.fingerprint.localeCompare(right.fingerprint)
  );
}

function fingerprintFor(finding: Finding, repoRoot: string): string {
  const file = normalizeArtifactPath(finding.file, repoRoot) || '<unknown>';
  const payload = [
    ruleIdFor(finding),
    file,
    Number.isInteger(finding.line) && (finding.line || 0) > 0 ? String(finding.line) : '',
    finding.description.replace(/\s+/g, ' ').trim().toLowerCase(),
  ].join('\u0000');
  return createHash('sha256').update(payload).digest('hex');
}

function resolveRepositoryRoot(repoPath: string): string {
  const resolved = fs.realpathSync(path.resolve(repoPath));
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error('Scan repository path must be a directory.');
  }
  return resolved;
}

function resolveScanFiles(files: readonly ScanFile[], repoRoot: string): ScanFile[] {
  return files
    .map(file => ({
      ...file,
      path: assertInsideRepository(
        path.isAbsolute(file.path) ? file.path : path.resolve(repoRoot, file.path),
        repoRoot
      ),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function assertInsideRepository(filePath: string, repoRoot: string): string {
  const resolved = fs.realpathSync(path.resolve(filePath));
  const relative = path.relative(repoRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Scan file resolves outside the repository root.');
  }
  return resolved;
}

function normalizeArtifactPath(filePath: string, repoRoot: string): string | undefined {
  if (!filePath) {
    return undefined;
  }
  if (filePath.startsWith('commit:')) {
    return filePath;
  }
  if (filePath.startsWith('<')) {
    return filePath;
  }

  const normalizedInput = filePath.replace(/\\/g, '/');
  const absolute = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(repoRoot, normalizedInput);
  const relative = path.relative(repoRoot, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return '<external>';
  }
  return relative.replace(/\\/g, '/') || '.';
}

function sanitizeScannerError(scanner: string, error: unknown, repoRoot: string): ScannerError {
  const source = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Unexpected scanner error';
  const errorCode = extractErrorCode(error);
  const message = sanitizeErrorMessage(source, repoRoot);
  return {
    code: errorCode,
    message: `${scanner} scanner failed${message ? `: ${message}` : ''}`,
    retryable: ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE']
      .includes(errorCode),
  };
}

function extractErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const raw = String((error as { code?: unknown }).code || '');
    const normalized = raw.toUpperCase().replace(/[^A-Z0-9_.-]/g, '');
    if (normalized) {
      return normalized.slice(0, 64);
    }
  }
  if (error instanceof Error && error.name && error.name !== 'Error') {
    return error.name.toUpperCase().replace(/[^A-Z0-9_.-]/g, '').slice(0, 64) || 'SCANNER_FAILED';
  }
  return 'SCANNER_FAILED';
}

function sanitizeErrorMessage(message: string, repoRoot: string): string {
  const escapedRoot = escapeRegExp(repoRoot);
  const escapedHome = escapeRegExp(os.homedir());
  return message
    .replace(new RegExp(escapedRoot, 'g'), '<repo>')
    .replace(new RegExp(escapedHome, 'g'), '~')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1')
    .replace(/\b(api[_-]?key|token|password|secret)\s*[=:]\s*[^\s,;]+/gi, '$1=<redacted>')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dependencyManifestFor(ecosystem: string): string {
  const manifests: Record<string, string> = {
    npm: 'package.json',
    pip: 'requirements.txt',
    go: 'go.mod',
    ruby: 'Gemfile',
    cargo: 'Cargo.toml',
    maven: 'pom.xml',
  };
  return manifests[ecosystem] || 'dependencies';
}

function normalizeSeverity(severity: string): ScanSeverity {
  if (
    severity === 'critical' ||
    severity === 'high' ||
    severity === 'medium' ||
    severity === 'low' ||
    severity === 'info'
  ) {
    return severity;
  }
  return 'medium';
}

function scanFileForVulnerabilities(filePath: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split('\n');
  const securityPatterns = [
    {
      pattern: /(password|passwd|pwd|secret|api[_-]?key|apikey|token|auth[_-]?token)\s*[=:]\s*['"][^'"]+['"]/i,
      severity: 'critical' as const,
      category: 'Hardcoded Secrets',
      description: 'Potential hardcoded credentials or secrets detected',
      suggestion: 'Use environment variables or secure secret management',
    },
    {
      pattern: /(SELECT|INSERT|UPDATE|DELETE).*\+.*\$|.*\+.*WHERE/i,
      severity: 'high' as const,
      category: 'SQL Injection',
      description: 'Potential SQL injection vulnerability',
      suggestion: 'Use parameterized queries or prepared statements',
    },
    {
      pattern: /innerHTML\s*=|document\.write\(/,
      severity: 'high' as const,
      category: 'XSS',
      description: 'Potential cross-site scripting vulnerability',
      suggestion: 'Use textContent or properly sanitize HTML',
    },
    {
      pattern: /\beval\s*\(|new Function\s*\(/,
      severity: 'high' as const,
      category: 'Code Injection',
      description: 'Dynamic code execution detected',
      suggestion: 'Avoid eval/new Function and use safer parsing strategies',
    },
    {
      pattern: /child_process\.(exec|execSync)\s*\(/,
      severity: 'high' as const,
      category: 'Command Injection',
      description: 'Shell command execution can be vulnerable when arguments are interpolated',
      suggestion: 'Use execFile/spawn with argv arrays and validate inputs',
    },
  ];

  lines.forEach((line, index) => {
    for (const pattern of securityPatterns) {
      if (pattern.pattern.test(line)) {
        findings.push({
          severity: pattern.severity,
          category: pattern.category,
          file: filePath,
          line: index + 1,
          description: pattern.description,
          suggestion: pattern.suggestion,
        });
      }
    }
  });

  return findings;
}

export const scanEngine = new ScanEngine();
