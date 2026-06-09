/**
 * budget.ts - CLI Commands for Budget Management
 * 
 * Commands to view, set, and manage AI spending budgets.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { CostGuard } from '../core/cost-guard';
import { configManager } from '../core/config';
import { Repository } from '../core/repository';

export function createBudgetCommand(): Command {
  const command = new Command('budget');
  command.description('Manage AI spending budgets');

  // Budget status
  command
    .command('status')
    .description('Show current budget status')
    .action(async () => {
      const config = configManager.loadOrInit();
      const repo = new Repository(process.cwd());
      const repoId = repo.getId();
      
      const costGuard = new CostGuard(
        repoId,
        config.budget
      );

      const status = await costGuard.getBudgetStatus();

      console.log(chalk.bold('\n💰 Budget Status\n'));
      console.log('─'.repeat(60));

      // Daily budget
      console.log(chalk.bold('\n📅 Daily Budget:'));
      console.log(`  Used:      $${status.daily.used.toFixed(2)}`);
      console.log(`  Limit:     $${status.daily.limit.toFixed(2)}`);
      console.log(`  Remaining: $${status.daily.remaining.toFixed(2)}`);
      
      const dailyBar = createProgressBar(status.daily.percentUsed);
      console.log(`  Progress:  ${dailyBar} ${status.daily.percentUsed.toFixed(0)}%`);

      // Monthly budget
      console.log(chalk.bold('\n📆 Monthly Budget:'));
      console.log(`  Used:      $${status.monthly.used.toFixed(2)}`);
      console.log(`  Limit:     $${status.monthly.limit.toFixed(2)}`);
      console.log(`  Remaining: $${status.monthly.remaining.toFixed(2)}`);
      
      const monthlyBar = createProgressBar(status.monthly.percentUsed);
      console.log(`  Progress:  ${monthlyBar} ${status.monthly.percentUsed.toFixed(0)}%`);

      // Per-request limit
      console.log(chalk.bold('\n💳 Per-Request Limit:'));
      console.log(`  Limit:     $${status.perRequest.limit.toFixed(2)}`);

      // Warnings
      if (status.warnings.length > 0) {
        console.log(chalk.yellow.bold('\n⚠️  Warnings:'));
        status.warnings.forEach((warning) => {
          console.log(chalk.yellow(`  • ${warning}`));
        });
      }

      console.log('\n');
    });

  // Set budget limits
  command
    .command('set')
    .description('Set budget limits')
    .option('--daily <amount>', 'Daily budget limit in USD')
    .option('--monthly <amount>', 'Monthly budget limit in USD')
    .option('--per-request <amount>', 'Per-request budget limit in USD')
    .option('--warning-threshold <threshold>', 'Warning threshold (0-1)')
    .action(async (options) => {
      const config = configManager.loadOrInit();

      if (!config.budget) {
        config.budget = {
          dailyLimit: 10,
          monthlyLimit: 100,
          perRequestLimit: 1,
          warningThreshold: 0.8,
        };
      }

      let updated = false;

      if (options.daily) {
        const daily = parseFloat(options.daily);
        if (isNaN(daily) || daily < 0) {
          console.error(chalk.red('❌ Invalid daily amount'));
          process.exit(1);
        }
        config.budget.dailyLimit = daily;
        updated = true;
      }

      if (options.monthly) {
        const monthly = parseFloat(options.monthly);
        if (isNaN(monthly) || monthly < 0) {
          console.error(chalk.red('❌ Invalid monthly amount'));
          process.exit(1);
        }
        config.budget.monthlyLimit = monthly;
        updated = true;
      }

      if (options.perRequest) {
        const perRequest = parseFloat(options.perRequest);
        if (isNaN(perRequest) || perRequest < 0) {
          console.error(chalk.red('❌ Invalid per-request amount'));
          process.exit(1);
        }
        config.budget.perRequestLimit = perRequest;
        updated = true;
      }

      if (options.warningThreshold) {
        const threshold = parseFloat(options.warningThreshold);
        if (isNaN(threshold) || threshold < 0 || threshold > 1) {
          console.error(chalk.red('❌ Invalid warning threshold (must be 0-1)'));
          process.exit(1);
        }
        config.budget.warningThreshold = threshold;
        updated = true;
      }

      if (!updated) {
        console.error(chalk.red('❌ No budget options specified'));
        process.exit(1);
      }

      configManager.save(config);

      console.log(chalk.green('\n✅ Budget configuration updated'));
      if (options.daily) {
        console.log(chalk.dim(`   Daily limit: $${options.daily}`));
      }
      if (options.monthly) {
        console.log(chalk.dim(`   Monthly limit: $${options.monthly}`));
      }
      if (options.perRequest) {
        console.log(chalk.dim(`   Per-request limit: $${options.perRequest}`));
      }
      if (options.warningThreshold) {
        console.log(chalk.dim(`   Warning threshold: ${(parseFloat(options.warningThreshold) * 100).toFixed(0)}%`));
      }
      console.log('\n');
    });

  // Budget report
  command
    .command('report')
    .description('Generate budget usage report')
    .option('--days <days>', 'Number of days to report', '30')
    .option('--export <path>', 'Export to CSV file')
    .action(async (options) => {
      const config = configManager.loadOrInit();
      const repo = new Repository(process.cwd());
      const repoId = repo.getId();
      
      const costGuard = new CostGuard(repoId, config.budget);
      const days = parseInt(options.days);

      const report = await costGuard.getUsageReport(days);

      console.log(chalk.bold(`\n📊 Usage Report (Last ${days} days)\n`));
      console.log('─'.repeat(60));

      // Summary
      console.log(chalk.bold('Summary:'));
      console.log(`  Daily:   $${report.summary.daily.toFixed(2)}`);
      console.log(`  Weekly:  $${report.summary.weekly.toFixed(2)}`);
      console.log(`  Monthly: $${report.summary.monthly.toFixed(2)}`);
      console.log(`  All Time: $${report.summary.allTime.toFixed(2)}`);

      // By provider
      if (Object.keys(report.byProvider).length > 0) {
        console.log(chalk.bold('\nBy Provider:'));
        for (const [provider, cost] of Object.entries(report.byProvider)) {
          console.log(`  ${provider.padEnd(15)} $${cost.toFixed(2)}`);
        }
      }

      // By model
      if (Object.keys(report.byModel).length > 0) {
        console.log(chalk.bold('\nBy Model:'));
        const sorted = Object.entries(report.byModel).sort((a, b) => b[1] - a[1]);
        sorted.slice(0, 5).forEach(([model, cost]) => {
          console.log(`  ${model.padEnd(25)} $${cost.toFixed(2)}`);
        });
      }

      // Top costly operations
      if (report.topCostlyOperations.length > 0) {
        console.log(chalk.bold('\nTop 5 Costly Operations:'));
        report.topCostlyOperations.slice(0, 5).forEach((op, i) => {
          console.log(
            `  ${i + 1}. ${op.timestamp.toLocaleString()} - ` +
            `${op.model} - $${op.cost.toFixed(4)}`
          );
        });
      }

      // Export option
      if (options.export) {
        await costGuard.exportUsage(options.export, days);
        console.log(chalk.green(`\n✅ Report exported to: ${options.export}`));
      }

      console.log('\n');
    });

  return command;
}

// Helper to create progress bar
function createProgressBar(percent: number): string {
  const width = 20;
  const filled = Math.floor((percent / 100) * width);
  const empty = width - filled;

  let color = chalk.green;
  if (percent >= 90) {
    color = chalk.red;
  } else if (percent >= 80) {
    color = chalk.yellow;
  }

  return '[' + color('█'.repeat(filled)) + '░'.repeat(empty) + ']';
}
