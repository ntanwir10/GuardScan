import chalk from 'chalk';
import { licenseScanner } from '../core/license-scanner';
import type { CycloneDx17Document, Spdx23Document } from '../core/license-scanner';
import { configManager } from '../core/config';
import { repositoryManager } from '../core/repository';
import { createProgressBar } from '../utils/progress';
import * as path from 'path';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';
import { resolveExecutionPolicy } from '../utils/execution-policy';
import { atomicReplaceText, prepareAtomicOutputTarget } from '../utils/private-state';
import {collectPackageInventory} from '../core/package-inventory';
import type {PackageInventoryError} from '../core/package-inventory';
import {detectServices, ServiceDetection} from '../core/service-catalog';

const logger = createDebugLogger('sbom');
const perfTracker = createPerformanceTracker('guardscan sbom');

interface SBOMOptions {
  output?: string;
  format?: 'spdx' | 'cyclonedx';
  offline?: boolean;
  cloud?: boolean;
  services?: boolean;
}

export async function sbomCommand(options: SBOMOptions): Promise<void> {
  logger.debug('SBOM command started', { options });
  perfTracker.start('sbom-total');
  
  console.log(chalk.cyan.bold('\n📋 SBOM Generation\n'));

  try {
    perfTracker.start('detect-repository');
    const repoPath = process.cwd();
    const repoInfo = repositoryManager.getRepoInfo();
    const config = configManager.loadOrInit();
    const executionPolicy = resolveExecutionPolicy({
      configOffline: config.offlineMode,
      offline: options.offline,
      cloud: options.cloud,
    });
    perfTracker.end('detect-repository');
    logger.debug('Repository detected', { name: repoInfo.name });

    if (options.services) {
      // Detections come from the offline inventory only; no license scan or SBOM document is needed.
      const inventory = collectPackageInventory(repoPath);
      const services = detectServices(inventory.coordinates);
      process.stdout.write(formatServices(services));
      if (inventory.errors.length > 0) {
        console.warn(chalk.yellow(
          `Warning: dependency inventory has ${inventory.errors.length} coverage warning(s); detections may be incomplete.`
        ));
      }
      if (options.output) {
        const target = prepareAtomicOutputTarget(options.output, repoPath);
        atomicReplaceText(target, JSON.stringify({services}, null, 2), {privateParent: false});
        process.stdout.write(chalk.green(`\n✓ Services saved: ${options.output}\n`));
      }
      return;
    }

    console.log(chalk.gray(`Repository: ${repoInfo.name}`));
    console.log(chalk.gray(`Format: ${options.format || 'spdx'}\n`));

    // Initialize progress tracking (3 steps)
    const totalSteps = 3; // Scan dependencies, Generate SBOM, Save SBOM
    const progressBar = createProgressBar(totalSteps, 'SBOM Generation');

    // Step 1: Scan licenses/dependencies
    progressBar.update(0, { status: 'Scanning dependencies...' });

    const licenseReport = await licenseScanner.scan(repoPath, 'proprietary', { offline: executionPolicy.offline });

    const inventoryErrors = classifySbomInventoryErrors(licenseReport.inventoryErrors);
    if (inventoryErrors.fatal.length > 0) {
      const first = inventoryErrors.fatal[0];
      throw new Error(
        `SBOM inventory contains ${inventoryErrors.fatal.length} invalid manifest(s); ` +
        `${first.file}: ${first.message}`
      );
    }
    if (inventoryErrors.warnings.length > 0) {
      console.warn(chalk.yellow(
        `Warning: SBOM inventory has ${inventoryErrors.warnings.length} incomplete coverage warning(s).`
      ));
    }

    progressBar.update(1, { status: `Found ${licenseReport.totalDependencies} dependencies` });

    // Step 2: Generate SBOM
    progressBar.update(1, { status: 'Generating SBOM...' });

    const format = options.format || 'spdx';
    const sbom = licenseScanner.generateSBOM(
      licenseReport.findings,
      format,
      repoInfo.name
    );

    progressBar.update(2, { status: 'SBOM generated' });

    // Display summary
    console.log(chalk.white.bold('\n📊 SBOM Summary:\n'));
    const summary = format === 'spdx'
      ? summarizeSpdx(sbom as Spdx23Document)
      : summarizeCycloneDx(sbom as CycloneDx17Document);
    console.log(chalk.gray(`  ${summary.itemLabel}: ${summary.itemCount}`));
    console.log(chalk.gray(`  Format: ${summary.format} (${summary.specification})`));
    console.log(chalk.gray(`  Version: ${summary.version}`));
    console.log(chalk.gray(`  Timestamp: ${summary.timestamp}`));

    // License breakdown
    console.log(chalk.white.bold('\n📜 License Breakdown:\n'));
    console.log(chalk.green(`  ✓ Permissive: ${licenseReport.categorySummary.permissive}`));
    console.log(chalk.yellow(`  ⚠ Weak Copyleft: ${licenseReport.categorySummary['weak-copyleft']}`));
    console.log(chalk.red(`  ⚠ Strong Copyleft: ${licenseReport.categorySummary['strong-copyleft']}`));
    console.log(chalk.gray(`  ℹ Unknown: ${licenseReport.categorySummary.unknown}`));

    // Risk summary
    if (licenseReport.riskSummary.critical > 0 || licenseReport.riskSummary.high > 0) {
      console.log(chalk.white.bold('\n⚠️  Risk Summary:\n'));
      if (licenseReport.riskSummary.critical > 0) {
        console.log(chalk.red(`  🔴 Critical: ${licenseReport.riskSummary.critical}`));
      }
      if (licenseReport.riskSummary.high > 0) {
        console.log(chalk.red(`  🟠 High: ${licenseReport.riskSummary.high}`));
      }
      if (licenseReport.riskSummary.medium > 0) {
        console.log(chalk.yellow(`  🟡 Medium: ${licenseReport.riskSummary.medium}`));
      }
    }

    // Compatibility issues
    if (licenseReport.compatibilityIssues.length > 0) {
      console.log(chalk.white.bold('\n⚠️  Compatibility Issues:\n'));
      licenseReport.compatibilityIssues.slice(0, 5).forEach(issue => {
        console.log(chalk.red(`  • ${issue.conflict}`));
        console.log(chalk.gray(`    ${issue.package1} (${issue.license1}) ↔ ${issue.package2} (${issue.license2})`));
        console.log(chalk.gray(`    Recommendation: ${issue.recommendation}\n`));
      });

      if (licenseReport.compatibilityIssues.length > 5) {
        console.log(chalk.gray(`  ... and ${licenseReport.compatibilityIssues.length - 5} more issues\n`));
      }
    }

    // Step 3: Save SBOM
    progressBar.update(2, { status: 'Saving SBOM...' });

    const outputPath = options.output || path.join(repoPath, `sbom-${format}.json`);

    const outputTarget = prepareAtomicOutputTarget(outputPath, repoPath);
    atomicReplaceText(outputTarget, JSON.stringify(sbom, null, 2), {privateParent: false});

    progressBar.update(3, { status: 'Complete' });
    progressBar.stop();

    console.log(chalk.green(`\n✓ SBOM saved: ${outputPath}`));

    console.log();

  } catch (error) {
    handleCommandError(error, 'SBOM generation');
  }
}

/** Repository-supplied text must not carry terminal escape sequences into the console. */
const printable = (value: string): string =>
  // eslint-disable-next-line no-control-regex
  value.replace(/[\u0000-\u001f\u007f-\u009f]/g, character => `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`);

export function formatServices(services: ServiceDetection[]): string {
  if (services.length === 0) {
    return `${chalk.gray('No known services or SDKs found in direct dependencies.')}\n`;
  }
  return [
    chalk.white.bold('Services and SDKs:'),
    ...services.map(service =>
      printable(`  ${service.service} (${service.category}): ${service.package}@${service.version} ` +
      `in ${service.manifestPath} [${service.scope}]`)
    ),
    '',
  ].join('\n');
}

export function classifySbomInventoryErrors(errors: PackageInventoryError[]): {
  fatal: PackageInventoryError[];
  warnings: PackageInventoryError[];
} {
  return {
    fatal: errors.filter(error => error.code === 'INVALID_MANIFEST'),
    warnings: errors.filter(error => error.code !== 'INVALID_MANIFEST'),
  };
}

interface SbomSummary {
  itemLabel: 'Packages' | 'Components';
  itemCount: number;
  format: string;
  specification: string;
  version: string;
  timestamp: string;
}

function summarizeSpdx(document: Spdx23Document): SbomSummary {
  return {
    itemLabel: 'Packages',
    itemCount: document.packages.length,
    format: 'SPDX',
    specification: document.spdxVersion,
    version: document.spdxVersion.replace('SPDX-', ''),
    timestamp: document.creationInfo.created,
  };
}

function summarizeCycloneDx(document: CycloneDx17Document): SbomSummary {
  return {
    itemLabel: 'Components',
    itemCount: document.components.length,
    format: document.bomFormat,
    specification: document.specVersion,
    version: String(document.version),
    timestamp: document.metadata.timestamp,
  };
}
