import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import {
  dependencyScanner,
  DependencyScanner,
  DependencyScanResult,
  DependencyVulnerability,
} from '../core/dependency-scanner';
import { configManager } from '../core/config';
import { PackageEcosystem } from '../core/package-inventory';
import { resolveExecutionPolicy } from '../utils/execution-policy';

type VulnerabilityFormat = 'table' | 'json' | 'sarif';
type FailureSeverity = 'critical' | 'high' | 'medium' | 'low';

interface VulnerabilityOptions {
  ecosystem?: string[];
  scope?: string;
  offline?: boolean;
  cloud?: boolean;
  refresh?: boolean;
  allowPartial?: boolean;
  concurrency?: string;
  format?: string;
  output?: string;
  ci?: boolean;
  failOn?: string;
  maxVulnerabilities?: string;
  cache?: boolean;
}

const ECOSYSTEMS: PackageEcosystem[] = ['npm', 'pip', 'go', 'ruby', 'cargo', 'maven'];
const SEVERITY_RANK: Record<FailureSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function createVulnerabilityCommand(scanner: DependencyScanner = dependencyScanner): Command {
  const command = new Command('vuln')
    .aliases(['cve', 'audit'])
    .description('Scan exact dependency versions for known vulnerabilities using OSV')
    .argument('[path]', 'Repository to scan', '.')
    .option('--ecosystem <names...>', 'Limit scanning to npm, pip, go, ruby, cargo, or maven')
    .option('--scope <scope>', 'Dependency scope (all or runtime)')
    .option('--offline', 'Use a matching local vulnerability snapshot without network access')
    .option('--no-cloud', 'Deprecated alias for --offline')
    .option('--refresh', 'Bypass prior coverage and atomically replace the vulnerability snapshot')
    .option('--allow-partial', 'Allow missing, stale, or incomplete vulnerability coverage')
    .option('--concurrency <number>', 'Maximum concurrent advisory detail requests', '4')
    .option('--format <format>', 'Output format (table, json, or sarif)', 'table')
    .option('-o, --output <path>', 'Write output to a file')
    .option('--ci', 'Use CI failure defaults')
    .option('--fail-on <severity>', 'Fail at or above critical, high, medium, or low')
    .option('--max-vulnerabilities <number>', 'Fail when the vulnerability count exceeds this value')
    .option('--no-cache', 'Disable vulnerability snapshot reads and writes')
    .action(async (repoPath: string, options: VulnerabilityOptions) => {
      try {
        const config = configManager.loadOrInit({ touchLastUsed: false });
        if (config.vulnerabilities?.enabled === false) {
          throw new Error('Vulnerability scanning is disabled in config; enable vulnerabilities.enabled to use this command');
        }
        validateVulnerabilitySource(config.vulnerabilities?.source);
        const snapshotMaxAgeDays = parseSnapshotMaxAge(config.vulnerabilities?.snapshotMaxAgeDays);
        const parsed = parseOptions(options, config.vulnerabilities?.scope || 'all');
        const noCloud = options.cloud === false;
        const executionPolicy = resolveExecutionPolicy({
          configOffline: config.offlineMode,
          offline: options.offline,
          cloud: options.cloud,
          cve: true,
          allowPartial: options.allowPartial,
        });
        const { offline, allowPartial } = executionPolicy;
        if (noCloud) {console.error(chalk.yellow('Warning: --no-cloud is deprecated; use --offline instead.'));}
        if (offline && options.refresh) {throw new Error('--refresh cannot be combined with offline mode');}
        if (offline && !parsed.cache) {
          throw new Error('Offline vulnerability scanning requires an existing snapshot; --no-cache disables snapshot access');
        }

        const absoluteRepository = path.resolve(repoPath);
        const results = await scanner.scan(absoluteRepository, {
          offline,
          refresh: options.refresh,
          allowPartial,
          cache: parsed.cache,
          strictInventory: true,
          concurrency: parsed.concurrency,
          ecosystems: parsed.ecosystems,
          scope: parsed.scope,
          endpoint: config.vulnerabilities?.endpoint,
          maxSnapshotAgeDays: snapshotMaxAgeDays,
          enrichKnownExploited: config.vulnerabilities?.enrichKnownExploited !== false,
          kevMaxCacheAgeDays: snapshotMaxAgeDays,
        });
        const document = vulnerabilityDocument(absoluteRepository, results, offline, allowPartial);
        const rendered = parsed.format === 'json'
          ? JSON.stringify(document, null, 2)
          : parsed.format === 'sarif'
            ? JSON.stringify(toSarif(results), null, 2)
            : renderTable(results);

        if (options.output) {
          fs.writeFileSync(path.resolve(options.output), `${rendered}\n`, 'utf8');
          if (parsed.format === 'table') {console.log(chalk.green(`Vulnerability report written to ${path.resolve(options.output)}`));}
        } else {
          console.log(rendered);
        }

        const vulnerabilities = results.flatMap(result => result.vulnerabilities);
        const policyFailed = vulnerabilities.some(value =>
          parsed.failOn !== undefined && SEVERITY_RANK[value.policySeverity] >= SEVERITY_RANK[parsed.failOn]
        ) || (parsed.maxVulnerabilities !== undefined && vulnerabilities.length > parsed.maxVulnerabilities);
        if (policyFailed && process.exitCode !== 2) {process.exitCode = 1;}
      } catch (error: any) {
        console.error(chalk.red(`Vulnerability scan failed: ${error?.message || error}`));
        process.exitCode = 2;
      }
    });

  const database = command.command('db').description('Manage repository vulnerability coverage snapshots');
  database
    .command('update [path]')
    .description('Fetch OSV coverage for the current exact dependency inventory')
    .option('--concurrency <number>', 'Maximum concurrent advisory detail requests', '4')
    .action(async (repoPath: string = '.', options: { concurrency?: string }) => {
      try {
        const config = configManager.loadOrInit({ touchLastUsed: false });
        if (config.vulnerabilities?.enabled === false) {
          throw new Error('Vulnerability scanning is disabled in config');
        }
        validateVulnerabilitySource(config.vulnerabilities?.source);
        if (resolveExecutionPolicy({ configOffline: config.offlineMode }).offline) {
          throw new Error('Disable offline mode before updating the vulnerability database');
        }
        const concurrency = parseInteger(options.concurrency || '4', '--concurrency', 1, 16);
        const results = await scanner.updateSnapshot(path.resolve(repoPath), {
          concurrency,
          endpoint: config.vulnerabilities?.endpoint,
          scope: config.vulnerabilities?.scope,
          enrichKnownExploited: config.vulnerabilities?.enrichKnownExploited !== false,
          kevMaxCacheAgeDays: parseSnapshotMaxAge(config.vulnerabilities?.snapshotMaxAgeDays),
        });
        const packages = results.reduce((sum, result) => sum + result.queriedPackages, 0);
        const advisories = results.reduce((sum, result) => sum + result.totalVulnerabilities, 0);
        console.log(chalk.green(`Vulnerability snapshot updated: ${packages} packages, ${advisories} affected package/advisory pairs`));
      } catch (error: any) {
        console.error(chalk.red(`Vulnerability database update failed: ${error?.message || error}`));
        process.exitCode = 2;
      }
    });
  database
    .command('status [path]')
    .description('Show vulnerability snapshot coverage and freshness')
    .action((repoPath: string = '.') => {
      try {
        const config = configManager.loadOrInit({ touchLastUsed: false });
        const maxAgeDays = parseSnapshotMaxAge(config.vulnerabilities?.snapshotMaxAgeDays);
        const { inventory, status } = scanner.snapshotStatus(path.resolve(repoPath), maxAgeDays);
        const kevStatus = scanner.knownExploitedStatus(maxAgeDays);
        console.log(JSON.stringify({
          schemaVersion: 'guardscan.vulnerability-snapshot-status.v1',
          exists: status.exists,
          fresh: status.fresh,
          inventoryMatches: status.inventoryMatches,
          ageDays: status.ageDays,
          packages: inventory.coordinates.length,
          unresolvedPackages: inventory.errors.length,
          inventoryDigest: inventory.digest,
          createdAt: status.snapshot?.createdAt,
          sourceEndpoint: status.snapshot?.sourceEndpoint,
          knownExploited: {
            source: 'cisa-kev',
            exists: kevStatus.exists,
            fresh: kevStatus.fresh,
            ageDays: kevStatus.ageDays,
            retrievedAt: kevStatus.entry?.retrievedAt,
            catalogVersion: kevStatus.entry?.catalog.catalogVersion,
            dateReleased: kevStatus.entry?.catalog.dateReleased,
          },
        }, null, 2));
      } catch (error: any) {
        console.error(chalk.red(`Vulnerability database status failed: ${error?.message || error}`));
        process.exitCode = 2;
      }
    });
  database
    .command('clear [path]')
    .description('Delete vulnerability coverage snapshots')
    .option('--repo', 'Clear the selected repository snapshot')
    .option('--all', 'Clear every vulnerability snapshot')
    .option('--force', 'Confirm destructive deletion')
    .action((repoPath: string = '.', options: { repo?: boolean; all?: boolean; force?: boolean }) => {
      try {
        if (options.repo && options.all) {throw new Error('Choose either --repo or --all');}
        if (!options.force) {throw new Error('Use --force to confirm snapshot deletion');}
        if (options.all) {
          scanner.clearAllSnapshots();
          scanner.clearKnownExploitedCache();
          console.log(chalk.green('All vulnerability snapshots cleared'));
        } else {
          scanner.clearSnapshot(path.resolve(repoPath));
          console.log(chalk.green('Repository vulnerability snapshot cleared'));
        }
      } catch (error: any) {
        console.error(chalk.red(`Vulnerability database clear failed: ${error?.message || error}`));
        process.exitCode = 2;
      }
    });

  return command;
}

function parseOptions(options: VulnerabilityOptions, defaultScope: 'all' | 'runtime'): {
  ecosystems?: PackageEcosystem[];
  scope: 'all' | 'runtime';
  concurrency: number;
  format: VulnerabilityFormat;
  failOn?: FailureSeverity;
  maxVulnerabilities?: number;
  cache: boolean;
} {
  const ecosystems = options.ecosystem?.map(value => value.toLowerCase() as PackageEcosystem);
  if (ecosystems?.some(value => !ECOSYSTEMS.includes(value))) {
    throw new Error(`--ecosystem must contain only: ${ECOSYSTEMS.join(', ')}`);
  }
  const scope = options.scope || defaultScope;
  if (scope !== 'all' && scope !== 'runtime') {throw new Error('--scope must be all or runtime');}
  if (options.format !== 'table' && options.format !== 'json' && options.format !== 'sarif') {
    throw new Error('--format must be table, json, or sarif');
  }
  const failOn = (options.failOn || (options.ci ? 'high' : undefined)) as FailureSeverity | undefined;
  if (failOn && !Object.prototype.hasOwnProperty.call(SEVERITY_RANK, failOn)) {
    throw new Error('--fail-on must be critical, high, medium, or low');
  }
  return {
    ecosystems: ecosystems ? [...new Set(ecosystems)] : undefined,
    scope,
    concurrency: parseInteger(options.concurrency || '4', '--concurrency', 1, 16),
    format: options.format,
    failOn,
    maxVulnerabilities: options.maxVulnerabilities === undefined
      ? undefined
      : parseInteger(options.maxVulnerabilities, '--max-vulnerabilities', 0, Number.MAX_SAFE_INTEGER),
    cache: options.cache !== false && process.env.GUARDSCAN_NO_CACHE !== 'true',
  };
}

function parseInteger(value: string, flag: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flag} must be an integer from ${min} through ${max}`);
  }
  return parsed;
}

function validateVulnerabilitySource(source: unknown): void {
  if (source !== undefined && source !== 'osv') {throw new Error(`Unsupported vulnerability source: ${String(source)}`);}
}

function parseSnapshotMaxAge(value: unknown): number {
  const parsed = value === undefined ? 7 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) {
    throw new Error('vulnerabilities.snapshotMaxAgeDays must be an integer from 0 through 3650');
  }
  return parsed;
}

function vulnerabilityDocument(repository: string, results: DependencyScanResult[], offline: boolean, allowPartial: boolean) {
  const vulnerabilities = results.flatMap(result => result.vulnerabilities);
  return {
    schemaVersion: 'guardscan.vulnerability.v1',
    run: {
      repository,
      offline,
      allowPartial,
      status: results.some(result => result.status === 'partial') ? 'partial' : 'complete',
    },
    summary: {
      queriedPackages: results.reduce((sum, result) => sum + result.queriedPackages, 0),
      unresolvedPackages: Math.max(0, ...results.map(result => result.unresolvedPackages)),
      vulnerabilities: vulnerabilities.length,
      critical: vulnerabilities.filter(value => value.policySeverity === 'critical').length,
      high: vulnerabilities.filter(value => value.policySeverity === 'high').length,
      medium: vulnerabilities.filter(value => value.policySeverity === 'medium').length,
      low: vulnerabilities.filter(value => value.policySeverity === 'low').length,
    },
    enrichment: results[0]?.knownExploitedEnrichment,
    ecosystems: results,
    errors: results.flatMap(result => result.errors),
  };
}

function renderTable(results: DependencyScanResult[]): string {
  const vulnerabilities = results.flatMap(result => result.vulnerabilities);
  const lines = [chalk.cyan.bold('Dependency Vulnerabilities'), ''];
  if (vulnerabilities.length === 0) {
    lines.push(chalk.green('No known vulnerabilities found in covered dependencies.'));
  } else {
    for (const vulnerability of vulnerabilities) {
      const color = vulnerability.policySeverity === 'critical' || vulnerability.policySeverity === 'high' ? chalk.red :
        vulnerability.policySeverity === 'medium' ? chalk.yellow : chalk.gray;
      lines.push(color(`${vulnerability.policySeverity.toUpperCase().padEnd(8)} ${vulnerability.canonicalId} ${vulnerability.package}@${vulnerability.version}`));
      lines.push(`  ${vulnerability.title}`);
      lines.push(`  ${vulnerability.recommendation} (${vulnerability.lockfilePath})`);
    }
  }
  const packages = results.reduce((sum, result) => sum + result.queriedPackages, 0);
  lines.push('', `${packages} packages covered; ${vulnerabilities.length} affected package/advisory pairs`);
  for (const error of results.flatMap(result => result.errors)) {lines.push(chalk.yellow(`Partial coverage: ${error.message}`));}
  const enrichment = results[0]?.knownExploitedEnrichment;
  if (enrichment) {
    lines.push(chalk.gray(`CISA KEV enrichment: ${enrichment.status}`));
    if (enrichment.error) {lines.push(chalk.yellow(`KEV enrichment warning: ${enrichment.error.message}`));}
  }
  return lines.join('\n');
}

function toSarif(results: DependencyScanResult[]): Record<string, unknown> {
  const vulnerabilities = results.flatMap(result => result.vulnerabilities);
  const uniqueRules = new Map<string, DependencyVulnerability>();
  vulnerabilities.forEach(value => uniqueRules.set(value.canonicalId, value));
  const enrichmentError = results[0]?.knownExploitedEnrichment.error;
  return {
    version: '2.1.0',
    $schema: 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json',
    runs: [{
      tool: {
        driver: {
          name: 'GuardScan',
          informationUri: 'https://guardscancli.com',
          rules: [...uniqueRules.values()].map(value => ({
            id: value.canonicalId,
            name: value.canonicalId,
            shortDescription: { text: value.title },
            helpUri: value.references[0],
            properties: { aliases: value.aliases, cweIds: value.cweIds, fixedVersions: value.fixedVersions, source: 'osv' },
          })),
        },
      },
      invocations: [{
        executionSuccessful: results.every(result => result.status === 'complete'),
        toolExecutionNotifications: results.flatMap(result => result.errors.map(error => ({
          level: 'error', message: { text: error.message }, descriptor: { id: error.code },
        }))).concat(enrichmentError ? [{
          level: 'warning',
          message: { text: enrichmentError.message },
          descriptor: { id: enrichmentError.code },
        }] : []),
      }],
      results: vulnerabilities.map(value => ({
        ruleId: value.canonicalId,
        level: value.policySeverity === 'critical' || value.policySeverity === 'high' ? 'error' : value.policySeverity === 'medium' ? 'warning' : 'note',
        message: { text: `${value.package}@${value.version}: ${value.title}. ${value.recommendation}` },
        partialFingerprints: { 'guardscan/vulnerabilityFingerprint/v1': value.fingerprint },
        locations: [{ physicalLocation: { artifactLocation: { uri: value.lockfilePath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/') } } }],
        properties: {
          package: value.package,
          installedVersion: value.version,
          aliases: value.aliases,
          advisorySeverity: value.advisorySeverity,
          policySeverity: value.policySeverity,
          fixedVersions: value.fixedVersions,
          knownExploited: value.knownExploited,
        },
      })),
    }],
  };
}
