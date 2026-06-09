/**
 * cache.ts - CLI Commands for Cache Management
 * 
 * Commands to view cache statistics and manage cache.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { AICache } from '../core/ai-cache';
import { Repository } from '../core/repository';
import { configManager } from '../core/config';

export function createCacheCommand(): Command {
  const command = new Command('cache');
  command.description('Manage AI response cache');

  // Cache stats
  command
    .command('stats')
    .description('Show cache statistics')
    .action(async () => {
      const repo = new Repository(process.cwd());
      const repoId = repo.getId();
      const config = configManager.loadOrInit();

      const cache = new AICache(repoId, config.cache?.maxSizeMB || 100);
      const stats = cache.getStats();

      console.log(chalk.bold('\n💾 Cache Statistics\n'));
      console.log('─'.repeat(60));

      console.log(chalk.bold('Usage:'));
      console.log(`  Total Entries:  ${stats.totalEntries}`);
      console.log(`  Cache Size:     ${cache.getSizeMB().toFixed(2)} MB`);
      console.log(`  Max Size:       ${config.cache?.maxSizeMB || 100} MB`);
      console.log(`  Utilization:    ${cache.getUtilization().toFixed(1)}%`);

      const utilizationBar = createProgressBar(cache.getUtilization());
      console.log(`  Progress:       ${utilizationBar}`);

      console.log(chalk.bold('\nPerformance:'));
      console.log(`  Cache Hits:     ${stats.hits}`);
      console.log(`  Cache Misses:   ${stats.misses}`);
      console.log(`  Hit Rate:       ${stats.hitRate.toFixed(1)}%`);

      if (stats.hitRate > 0) {
        const savingsPercent = stats.hitRate;
        console.log(chalk.green(`  💰 Estimated savings: ~${savingsPercent.toFixed(0)}% of API costs`));
      }

      console.log(chalk.bold('\nConfiguration:'));
      console.log(`  Enabled:            ${config.cache?.enabled !== false ? '✅' : '❌'}`);
      console.log(`  Semantic Threshold: ${config.cache?.semanticThreshold || 0.95}`);
      console.log(`  TTL:                ${config.cache?.ttlSeconds || 3600}s`);

      console.log('\n');
    });

  // Cache info
  command
    .command('info')
    .description('Show cache configuration')
    .action(async () => {
      const config = configManager.loadOrInit();

      console.log(chalk.bold('\n⚙️  Cache Configuration\n'));
      console.log('─'.repeat(60));

      if (!config.cache) {
        console.log(chalk.yellow('⚠️  Cache not configured (using defaults)'));
        console.log('\n');
        return;
      }

      console.log(`${chalk.bold('Enabled:')}            ${config.cache.enabled ? '✅ Yes' : '❌ No'}`);
      console.log(`${chalk.bold('Max Size:')}           ${config.cache.maxSizeMB} MB`);
      console.log(`${chalk.bold('TTL:')}                ${config.cache.ttlSeconds}s (${Math.floor(config.cache.ttlSeconds / 60)} minutes)`);
      console.log(`${chalk.bold('Semantic Threshold:')} ${config.cache.semanticThreshold} (${(config.cache.semanticThreshold * 100).toFixed(0)}% similarity)`);

      console.log('\n' + chalk.dim('Modify with: guardscan config set cache.<property> <value>'));
      console.log('\n');
    });

  // Clear cache
  command
    .command('clear')
    .description('Clear all cached responses')
    .option('--force', 'Skip confirmation')
    .action(async (options) => {
      if (!options.force) {
        console.log(chalk.yellow('⚠️  This will delete all cached AI responses'));
        console.log(chalk.dim('Use --force to skip confirmation\n'));
        return;
      }

      const repo = new Repository(process.cwd());
      const repoId = repo.getId();
      const config = configManager.loadOrInit();

      const cache = new AICache(repoId, config.cache?.maxSizeMB || 100);
      await cache.clear();

      console.log(chalk.green('✅ Cache cleared\n'));
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
