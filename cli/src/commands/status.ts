import chalk from 'chalk';
import { configManager } from '../core/config';
import { repositoryManager } from '../core/repository';
import { apiClient } from '../utils/api-client';
import { isOnline } from '../utils/network';
import { displaySimpleBanner } from '../utils/ascii-art';
import ora from 'ora';

export async function statusCommand(): Promise<void> {
  displaySimpleBanner('status');

  try {
    // Load config
    const config = configManager.loadOrInit();

    // Get repository info
    let repoInfo;
    try {
      repoInfo = repositoryManager.getRepoInfo();
    } catch {
      // Not in a repository
    }

    // Display configuration
    console.log(chalk.white.bold('Configuration:'));
    console.log(chalk.gray(`  Client ID: ${config.clientId}`));
    console.log(chalk.gray(`  Provider: ${config.provider}`));
    console.log(chalk.gray(`  Telemetry: ${config.telemetryEnabled ? 'Enabled' : 'Disabled'}`));
    console.log(chalk.gray(`  Offline Mode: ${config.offlineMode ? 'Yes' : 'No'}`));

    // Display repository info
    if (repoInfo) {
      console.log(chalk.white.bold('\nRepository:'));
      console.log(chalk.gray(`  Name: ${repoInfo.name}`));
      console.log(chalk.gray(`  Path: ${repoInfo.path}`));
      console.log(chalk.gray(`  Type: ${repoInfo.isGit ? 'Git' : 'Standard'}`));
      if (repoInfo.branch) {
        console.log(chalk.gray(`  Branch: ${repoInfo.branch}`));
      }
      console.log(chalk.gray(`  Repo ID: ${repoInfo.repoId}`));
    }

    // Check network connectivity
    console.log(chalk.white.bold('\nConnectivity:'));
    const online = await isOnline();
    console.log(chalk.gray(`  Internet: ${online ? chalk.green('Connected') : chalk.red('Offline')}`));

    // GuardScan is now 100% free and open source!
    console.log(chalk.white.bold('\nLicense:'));
    console.log(chalk.green('  ✓ GuardScan is 100% free and open source'));
    console.log(chalk.gray('  ✓ Unlimited static analysis (offline)'));
    console.log(chalk.gray('  ✓ AI review with your own API key (BYOK)'));
    console.log(chalk.gray('  ✓ No usage limits or subscriptions'))

    console.log();
  } catch (error) {
    console.error(chalk.red('\n✗ Status check failed:'), error);
    process.exit(1);
  }
}
