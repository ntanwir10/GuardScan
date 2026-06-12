/**
 * metrics.ts - CLI Commands for AI Metrics
 * 
 * Commands to view, analyze, and export AI operation metrics.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { MetricsCollector } from '../core/metrics-collector';
import { Repository } from '../core/repository';
import { configManager } from '../core/config';

export function createMetricsCommand(): Command {
  const command = new Command('metrics');
  command.description('View AI operation metrics');

  // Show metrics
  command
    .command('show')
    .description('Show aggregated metrics')
    .option('--provider <provider>', 'Filter by provider')
    .option('--days <days>', 'Time range in days', '7')
    .action(async (options) => {
      const config = configManager.loadOrInit();
      const repo = new Repository(process.cwd());
      const repoId = repo.getId();

      const collector = new MetricsCollector(repoId, config.telemetryEnabled || false);
      const days = parseInt(options.days);
      const timeRangeMs = days * 24 * 60 * 60 * 1000;

      const metrics = collector.getMetrics(timeRangeMs);

      console.log(chalk.bold(`\n📈 AI Metrics (Last ${days} days)\n`));
      console.log('─'.repeat(60));

      // Overall stats
      console.log(chalk.bold('Overview:'));
      console.log(`  Total Calls:     ${metrics.totalCalls}`);
      console.log(`  Success Rate:    ${metrics.successRate.toFixed(1)}%`);
      console.log(`  Total Cost:      $${metrics.totalCost.toFixed(2)}`);
      console.log(`  Total Tokens:    ${metrics.totalTokens.toLocaleString()}`);
      console.log(`  Cache Hit Rate:  ${metrics.cacheHitRate.toFixed(1)}%`);

      // Latency
      console.log(chalk.bold('\n⏱️  Latency:'));
      console.log(`  Average:  ${metrics.averageLatency.toFixed(0)}ms`);
      console.log(`  P50:      ${metrics.p50Latency.toFixed(0)}ms`);
      console.log(`  P95:      ${metrics.p95Latency.toFixed(0)}ms`);
      console.log(`  P99:      ${metrics.p99Latency.toFixed(0)}ms`);

      // By provider
      if (Object.keys(metrics.callsByProvider).length > 0) {
        console.log(chalk.bold('\n🏢 By Provider:'));
        for (const [provider, count] of Object.entries(metrics.callsByProvider)) {
          if (!options.provider || provider === options.provider) {
            console.log(`  ${provider.padEnd(15)} ${count} calls`);
          }
        }
      }

      // By model
      if (Object.keys(metrics.callsByModel).length > 0) {
        console.log(chalk.bold('\n🤖 Top Models:'));
        const sorted = Object.entries(metrics.callsByModel).sort((a, b) => b[1] - a[1]);
        sorted.slice(0, 5).forEach(([model, count]) => {
          console.log(`  ${model.padEnd(30)} ${count} calls`);
        });
      }

      // By operation
      if (Object.keys(metrics.callsByOperation).length > 0) {
        console.log(chalk.bold('\n⚙️  By Operation:'));
        for (const [operation, count] of Object.entries(metrics.callsByOperation)) {
          console.log(`  ${operation.padEnd(15)} ${count} calls`);
        }
      }

      // Errors
      if (Object.keys(metrics.errorsByType).length > 0) {
        console.log(chalk.yellow.bold('\n❌ Errors:'));
        for (const [errorType, count] of Object.entries(metrics.errorsByType)) {
          console.log(chalk.yellow(`  ${errorType.padEnd(20)} ${count} errors`));
        }
      }

      console.log('\n');
    });

  // Export metrics
  command
    .command('export')
    .description('Export metrics to file')
    .option('--format <format>', 'Export format: json, csv', 'json')
    .option('--output <path>', 'Output file path', 'metrics.json')
    .option('--days <days>', 'Time range in days', '30')
    .action(async (options) => {
      const config = configManager.loadOrInit();
      const repo = new Repository(process.cwd());
      const repoId = repo.getId();

      const collector = new MetricsCollector(repoId, config.telemetryEnabled || false);
      const days = parseInt(options.days);
      const timeRangeMs = days * 24 * 60 * 60 * 1000;

      if (options.format === 'json') {
        collector.exportToJSON(options.output, timeRangeMs);
        console.log(chalk.green(`✅ Metrics exported to: ${options.output}\n`));
      } else {
        console.error(chalk.red('❌ Only JSON format is currently supported'));
        process.exit(1);
      }
    });

  // Clear metrics
  command
    .command('clear')
    .description('Clear all collected metrics')
    .option('--force', 'Skip confirmation')
    .action(async (options) => {
      if (!options.force) {
        console.log(chalk.yellow('⚠️  This will delete all collected metrics'));
        console.log(chalk.dim('Use --force to skip confirmation\n'));
        return;
      }

      const config = configManager.loadOrInit();
      const repo = new Repository(process.cwd());
      const repoId = repo.getId();

      const collector = new MetricsCollector(repoId, config.telemetryEnabled || false);
      collector.clear();

      console.log(chalk.green('✅ All metrics cleared\n'));
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
