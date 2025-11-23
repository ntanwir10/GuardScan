/**
 * migrate.ts - CLI Command for Code Migrations
 *
 * Automated code migrations including:
 * - Framework migrations
 * - Dependency upgrades
 * - JavaScript to TypeScript conversion
 * - Code modernization
 *
 * Phase 5, Feature 3
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  MigrationAssistantEngine,
  FrameworkMigration,
  ModernizationType,
  MigrationType
} from '../features/migration-assistant';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';
import { repositoryManager } from '../core/repository';
import { ProviderFactory } from '../providers/factory';
import { ConfigManager } from '../core/config';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('migrate');
const perfTracker = createPerformanceTracker('guardscan migrate');

interface MigrateCommandOptions {
  type?: 'framework' | 'language' | 'modernization' | 'dependency';
  target?: string;
  from?: string;
  to?: string;
  file?: string;
  dryRun?: boolean;
  autoFix?: boolean;
  backup?: boolean;
  report?: boolean;
  output?: string;
}

/**
 * Main migrate command
 */
export async function migrateCommand(options: MigrateCommandOptions): Promise<void> {
  logger.debug('Migrate command started', { options });
  perfTracker.start('migrate-total');
  
  console.log(chalk.blue('\n🔄 GuardScan Migration Assistant\n'));

  const spinner = ora('Initializing migration assistant...').start();

  try {
    // Load configuration
    perfTracker.start('load-config');
    const configManager = new ConfigManager();
    const config = configManager.loadOrInit();
    perfTracker.end('load-config');
    logger.debug('Config loaded', { provider: config.provider });

    // Check AI provider
    if (!config.provider || config.provider === 'none' || !config.apiKey) {
      spinner.fail('No AI provider configured');
      console.log(chalk.yellow('\nMigration features require an AI provider.'));
      console.log(chalk.gray('Configure with: guardscan config\n'));
      return;
    }

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    spinner.succeed(`Repository: ${repoInfo.path}`);

    // Initialize components
    const provider = ProviderFactory.create(config.provider, config.apiKey, config.apiEndpoint);
    const indexer = new CodebaseIndexer(repoInfo.path, repoInfo.repoId);
    const cache = new AICache(repoInfo.repoId);
    const engine = new MigrationAssistantEngine(provider, indexer, cache, repoInfo.path);

    // Use --from and --to if provided, otherwise use --target
    const migrationTarget = options.from && options.to 
      ? `${options.from}-to-${options.to}` 
      : options.target;

    // Execute migration based on type
    if (options.report) {
      await generateMigrationReport(engine, options);
    } else if (options.type === 'framework' && migrationTarget) {
      await performFrameworkMigration(engine, migrationTarget as FrameworkMigration, options);
    } else if (options.type === 'language' && (migrationTarget === 'typescript' || (options.from === 'javascript' && options.to === 'typescript'))) {
      await performJsToTsMigration(engine, options);
    } else if (options.type === 'modernization' && migrationTarget) {
      await performModernization(engine, migrationTarget as ModernizationType, options);
    } else if (options.type === 'dependency') {
      await performDependencyAnalysis(engine, options);
    } else {
      // Interactive mode or show help
      showMigrationOptions();
    }

  } catch (error: any) {
    spinner.fail('Migration failed');
    handleCommandError(error, 'Migration');
  }
}

/**
 * Generate comprehensive migration report
 */
async function generateMigrationReport(
  engine: MigrationAssistantEngine,
  options: MigrateCommandOptions
): Promise<void> {
  if (!options.type || !options.target) {
    console.log(chalk.red('Error: --type and --target are required for migration reports'));
    return;
  }

  const spinner = ora('Generating migration report...').start();

  const report = await engine.generateMigrationReport(
    options.type as MigrationType,
    options.target,
    {
      targetPath: options.file,
      dryRun: true
    }
  );

  spinner.succeed('Migration report generated');

  // Format report
  let markdown = '# Migration Report\n\n';
  markdown += `**Type:** ${report.plan.type}\n`;
  markdown += `**Target:** ${report.plan.target}\n`;
  markdown += `**Generated:** ${report.generatedAt.toISOString()}\n\n`;

  // Summary
  markdown += '## Summary\n\n';
  markdown += `- **Total Files:** ${report.summary.totalFiles}\n`;
  markdown += `- **Issues Found:** ${report.summary.issues}\n`;
  markdown += `- **Auto-fixable:** ${report.summary.autoFixable}\n`;
  markdown += `- **Manual Intervention:** ${report.summary.manualIntervention}\n\n`;

  // Migration Plan
  markdown += '## Migration Plan\n\n';
  markdown += `${report.plan.description}\n\n`;
  markdown += `**Estimated Effort:** ${report.plan.estimatedEffort.hours} hours (${report.plan.estimatedEffort.complexity} complexity)\n\n`;

  // Phases
  markdown += '### Phases\n\n';
  for (const phase of report.plan.phases) {
    markdown += `#### ${phase.name}\n\n`;
    markdown += `${phase.description}\n\n`;
    markdown += `**Estimated Hours:** ${phase.estimatedHours}\n`;
    markdown += `**Automatable:** ${phase.automatable ? 'Yes' : 'No'}\n\n`;
    markdown += '**Steps:**\n';
    for (const step of phase.steps) {
      markdown += `- ${step}\n`;
    }
    markdown += '\n';
  }

  // Issues
  if (report.issues.length > 0) {
    markdown += '## Issues\n\n';
    markdown += '| Severity | File | Type | Description |\n';
    markdown += '|----------|------|------|-------------|\n';
    for (const issue of report.issues.slice(0, 50)) {
      markdown += `| ${issue.severity} | ${issue.file} | ${issue.issueType} | ${issue.description} |\n`;
    }
    markdown += '\n';
  }

  // Risks
  if (report.plan.risks.length > 0) {
    markdown += '## Risks\n\n';
    for (const risk of report.plan.risks) {
      markdown += `- ⚠️ ${risk}\n`;
    }
    markdown += '\n';
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    markdown += '## Recommendations\n\n';
    for (const rec of report.recommendations) {
      markdown += `${rec}\n\n`;
    }
  }

  // Dependencies
  if (report.plan.dependencies.length > 0) {
    markdown += '## Required Dependencies\n\n';
    markdown += '```bash\n';
    markdown += `npm install ${report.plan.dependencies.join(' ')}\n`;
    markdown += '```\n\n';
  }

  // Save or display
  if (options.output) {
    fs.writeFileSync(options.output, markdown);
    console.log(chalk.green(`\n✓ Report saved to: ${options.output}`));
  } else {
    console.log('\n' + markdown);
  }
}

/**
 * Perform framework migration
 */
async function performFrameworkMigration(
  engine: MigrationAssistantEngine,
  migration: FrameworkMigration,
  options: MigrateCommandOptions
): Promise<void> {
  const spinner = ora(`Analyzing ${migration} migration...`).start();

  const plan = await engine.analyzeFrameworkMigration(migration, {
    targetPath: options.file,
    dryRun: options.dryRun,
    autoFix: options.autoFix,
    backupOriginals: options.backup
  });

  spinner.succeed('Migration plan generated');

  // Display plan
  console.log(chalk.blue('\n=== Migration Plan ===\n'));
  console.log(chalk.white(plan.description));
  console.log(chalk.gray(`\nAffected files: ${plan.affectedFiles.length}`));
  console.log(chalk.gray(`Estimated effort: ${plan.estimatedEffort.hours} hours (${plan.estimatedEffort.complexity})`));

  console.log(chalk.blue('\n=== Phases ===\n'));
  for (const phase of plan.phases) {
    console.log(chalk.green(`${phase.name} (${phase.estimatedHours}h)`));
    console.log(`  ${phase.description}`);
    console.log('');
  }

  if (plan.risks.length > 0) {
    console.log(chalk.yellow('=== Risks ===\n'));
    for (const risk of plan.risks) {
      console.log(chalk.yellow(`  ⚠️ ${risk}`));
    }
    console.log('');
  }

  if (options.dryRun) {
    console.log(chalk.gray('\n(Dry run mode - no changes applied)'));
  } else if (options.autoFix) {
    console.log(chalk.green('\n✓ Auto-fix enabled - changes will be applied'));
  }
}

/**
 * Perform JavaScript to TypeScript migration
 */
async function performJsToTsMigration(
  engine: MigrationAssistantEngine,
  options: MigrateCommandOptions
): Promise<void> {
  if (options.file) {
    // Convert single file
    const spinner = ora(`Converting ${options.file} to TypeScript...`).start();

    const result = await engine.convertJsToTs(options.file, {
      dryRun: options.dryRun,
      autoFix: options.autoFix,
      backupOriginals: options.backup
    });

    if (result.success) {
      spinner.succeed('Conversion completed');

      console.log(chalk.blue('\n=== Changes ===\n'));
      for (const change of result.changes) {
        console.log(chalk.green(`✓ ${change.type}: ${change.description}`));
      }

      if (result.manualStepsRequired.length > 0) {
        console.log(chalk.yellow('\n=== Manual Steps Required ===\n'));
        for (const step of result.manualStepsRequired) {
          console.log(chalk.yellow(`  • ${step}`));
        }
      }

      if (!options.dryRun && options.autoFix) {
        console.log(chalk.green(`\n✓ File updated: ${result.file}`));
        if (options.backup) {
          console.log(chalk.gray(`  Backup saved: ${result.file}.backup`));
        }
      }
    } else {
      spinner.fail('Conversion failed');
      for (const issue of result.issues) {
        console.log(chalk.red(`  ✗ ${issue.description}`));
      }
    }
  } else {
    // Convert entire codebase
    console.log(chalk.yellow('\nConverting entire codebase to TypeScript...'));
    console.log(chalk.gray('Use --file <path> to convert a single file, or --report to generate a migration plan'));
  }
}

/**
 * Perform code modernization
 */
async function performModernization(
  engine: MigrationAssistantEngine,
  modernization: ModernizationType,
  options: MigrateCommandOptions
): Promise<void> {
  if (!options.file) {
    console.log(chalk.red('Error: --file is required for modernization'));
    return;
  }

  const spinner = ora(`Modernizing ${options.file}...`).start();

  const result = await engine.modernizeCode(options.file, [modernization], {
    dryRun: options.dryRun,
    autoFix: options.autoFix,
    backupOriginals: options.backup
  });

  if (result.success) {
    spinner.succeed('Modernization completed');

    console.log(chalk.blue('\n=== Changes ===\n'));
    for (const change of result.changes) {
      console.log(chalk.green(`✓ ${change.type}: ${change.description}`));
    }

    if (!options.dryRun && options.autoFix) {
      console.log(chalk.green(`\n✓ File updated: ${result.file}`));
    }
  } else {
    spinner.fail('Modernization failed');
  }
}

/**
 * Perform dependency upgrade analysis
 */
async function performDependencyAnalysis(
  engine: MigrationAssistantEngine,
  options: MigrateCommandOptions
): Promise<void> {
  const spinner = ora('Analyzing dependency upgrades...').start();

  const upgrades = await engine.analyzeDependencyUpgrades();
  spinner.succeed(`Analyzed ${upgrades.length} dependencies`);

  console.log(chalk.blue('\n=== Dependency Upgrades ===\n'));

  for (const upgrade of upgrades.slice(0, 20)) {
    console.log(chalk.white(`${upgrade.package}`));
    console.log(chalk.gray(`  ${upgrade.currentVersion} → ${upgrade.targetVersion}`));
    console.log(chalk.gray(`  Effort: ${upgrade.effort} | Risk: ${upgrade.risk}`));

    if (upgrade.breakingChanges.length > 0) {
      console.log(chalk.yellow(`  ⚠️ ${upgrade.breakingChanges.length} breaking changes`));
    }
    console.log('');
  }
}

/**
 * Show available migration options
 */
function showMigrationOptions(): void {
  console.log(chalk.blue('Available Migrations:\n'));

  console.log(chalk.white('Framework Migrations:'));
  console.log('  • react-class-to-hooks     - Convert React class components to hooks');
  console.log('  • vue2-to-vue3             - Migrate Vue 2 to Vue 3');
  console.log('  • angular-js-to-angular    - Migrate AngularJS to Angular');
  console.log('  • express-to-fastify       - Migrate Express to Fastify');
  console.log('  • jest-to-vitest           - Convert Jest to Vitest');

  console.log(chalk.white('\nLanguage Conversions:'));
  console.log('  • js-to-ts                 - Convert JavaScript to TypeScript');

  console.log(chalk.white('\nCode Modernization:'));
  console.log('  • es5-to-es6               - Modernize to ES6+ features');
  console.log('  • callbacks-to-promises    - Convert callbacks to Promises');
  console.log('  • promises-to-async-await  - Convert Promises to async/await');
  console.log('  • var-to-const-let         - Convert var to const/let');

  console.log(chalk.white('\nDependency Analysis:'));
  console.log('  • dependency               - Analyze dependency upgrades');

  console.log(chalk.gray('\nExamples:'));
  console.log('  guardscan migrate --type framework --target react-class-to-hooks --report');
  console.log('  guardscan migrate --type language --target typescript --file src/app.js');
  console.log('  guardscan migrate --type modernization --target es5-to-es6 --file src/util.js --auto-fix');
  console.log('  guardscan migrate --type dependency\n');
}
