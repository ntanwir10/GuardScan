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
import { VulnerabilitySnapshotStore } from '../core/vulnerability-cache';
import * as fs from 'fs';
import * as path from 'path';

export function createCacheCommand(): Command {
  const command = new Command('cache');
  command.description('Manage repository-local AI, semantic, embedding, and advisory caches');

  // Cache stats
  command
    .command('stats')
    .description('Show cache statistics')
    .action(async () => {
      try {
        const repo = new Repository(process.cwd());
        const repoId = repo.getId();
        const config = configManager.loadOrInit();

        const cache = new AICache(repoId, {
          enabled: config.cache?.enabled,
          maxSizeMB: config.cache?.maxSizeMB,
          ttlSeconds: config.cache?.ttlSeconds,
        });
        const stats = cache.getStats();
        const sizeMB = cache.getSizeMB();
        const utilization = cache.getUtilization();

        console.log(chalk.bold('\n💾 Cache Statistics\n'));
        console.log('─'.repeat(60));

        console.log(chalk.bold('Usage:'));
        console.log(`  Total Entries:  ${stats.totalEntries}`);
        console.log(`  Cache Size:     ${sizeMB.toFixed(2)} MB`);
        console.log(`  Max Size:       ${config.cache?.maxSizeMB || 100} MB`);
        console.log(`  Utilization:    ${utilization.toFixed(1)}%`);

        const utilizationBar = createProgressBar(utilization);
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
        console.log(`  Enabled:            ${cache.isEnabled() ? '✅' : '❌'}`);
        console.log(`  Semantic Threshold: ${config.cache?.semanticThreshold || 0.95}`);
        console.log(`  TTL:                ${config.cache?.ttlSeconds || 3600}s`);

        console.log('\n');
      } catch (error) {
        console.error(chalk.red(`Failed to read cache stats: ${getErrorMessage(error)}`));
        process.exitCode = 1;
      }
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

      console.log('\n' + chalk.dim('Modify cache settings in ~/.guardscan/config.yml'));
      console.log('\n');
    });

  // Clear cache
  command
    .command('clear')
    .description('Clear cached source-derived data for this repository or all repositories')
    .option('--repo', 'Clear the current repository cache (default)')
    .option('--all', 'Clear every repository cache')
    .option('--force', 'Skip confirmation')
    .action(async (options) => {
      if (options.repo && options.all) {
        console.error(chalk.red('Choose either --repo or --all, not both.'));
        process.exitCode = 1;
        return;
      }
      if (!options.force) {
        console.log(chalk.yellow(
          options.all
            ? '⚠️  This will delete cached data for every repository'
            : '⚠️  This will delete cached data for the current repository'
        ));
        console.log(chalk.dim('Use --force to skip confirmation\n'));
        return;
      }

      try {
        const cacheRoot = path.resolve(configManager.getCacheDir());
        fs.mkdirSync(cacheRoot, { recursive: true });

        if (options.all) {
          for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) {
              continue;
            }
            removeCachePath(cacheRoot, path.join(cacheRoot, entry.name));
          }
          console.log(chalk.green('✅ All repository caches cleared\n'));
        } else {
          if (!options.repo) {
            console.warn(chalk.yellow('⚠️  Bare cache clear is deprecated; use --repo.'));
          }
          const repoId = new Repository(process.cwd()).getId();
          removeCachePath(cacheRoot, path.join(cacheRoot, repoId));
          new VulnerabilitySnapshotStore().clearRepository(process.cwd());
          console.log(chalk.green('✅ Current repository cache cleared\n'));
        }
      } catch (error) {
        console.error(chalk.red(`Failed to clear cache: ${getErrorMessage(error)}`));
        process.exitCode = 1;
      }
    });

  return command;
}

function removeCachePath(cacheRoot: string, target: string): void {
  const resolvedRoot = path.resolve(cacheRoot) + path.sep;
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error('Refusing to delete a path outside the GuardScan cache directory');
  }
  try {
    const stat = fs.lstatSync(resolvedTarget);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(resolvedTarget);
    } else {
      fs.rmSync(resolvedTarget, { recursive: true, force: true });
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
