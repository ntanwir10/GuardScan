import chalk from 'chalk';
import ora from 'ora';
import { licenseScanner } from '../core/license-scanner';
import { repositoryManager } from '../core/repository';
import { createProgressBar } from '../utils/progress';
import * as fs from 'fs';
import * as path from 'path';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('sbom');
const perfTracker = createPerformanceTracker('guardscan sbom');

interface SBOMOptions {
  output?: string;
  format?: 'spdx' | 'cyclonedx';
}

export async function sbomCommand(options: SBOMOptions): Promise<void> {
  logger.debug('SBOM command started', { options });
  perfTracker.start('sbom-total');
  
  console.log(chalk.cyan.bold('\n📋 SBOM Generation\n'));

  try {
    perfTracker.start('detect-repository');
    const repoPath = process.cwd();
    const repoInfo = repositoryManager.getRepoInfo();
    perfTracker.end('detect-repository');
    logger.debug('Repository detected', { name: repoInfo.name });

    console.log(chalk.gray(`Repository: ${repoInfo.name}`));
    console.log(chalk.gray(`Format: ${options.format || 'spdx'}\n`));

    // Initialize progress tracking (3 steps)
    const totalSteps = 3; // Scan dependencies, Generate SBOM, Save SBOM
    const progressBar = createProgressBar(totalSteps, 'SBOM Generation');

    // Step 1: Scan licenses/dependencies
    progressBar.update(0, { status: 'Scanning dependencies...' });

    const licenseReport = await licenseScanner.scan(repoPath, 'proprietary');

    progressBar.update(1, { status: `Found ${licenseReport.totalDependencies} dependencies` });

    // Step 2: Generate SBOM
    progressBar.update(1, { status: 'Generating SBOM...' });

    const sbom = licenseScanner.generateSBOM(
      licenseReport.findings,
      options.format || 'spdx',
      repoInfo.name
    );

    progressBar.update(2, { status: 'SBOM generated' });

    // Display summary
    console.log(chalk.white.bold('\n📊 SBOM Summary:\n'));
    console.log(chalk.gray(`  Total Packages: ${sbom.packages.length}`));
    console.log(chalk.gray(`  Format: ${sbom.format.toUpperCase()}`));
    console.log(chalk.gray(`  Version: ${sbom.version}`));
    console.log(chalk.gray(`  Timestamp: ${sbom.timestamp}`));

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

    const outputPath = options.output || path.join(repoPath, `sbom-${sbom.format}.json`);

    fs.writeFileSync(outputPath, JSON.stringify(sbom, null, 2));

    progressBar.update(3, { status: 'Complete' });
    progressBar.stop();

    console.log(chalk.green(`\n✓ SBOM saved: ${outputPath}`));
    console.log();

  } catch (error) {
    handleCommandError(error, 'SBOM generation');
  }
}
