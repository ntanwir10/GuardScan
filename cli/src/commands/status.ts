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

    // Fetch credits if online and not in offline mode
    if (online && !config.offlineMode) {
      const spinner = ora('Fetching credit balance...').start();
      try {
        const credits = await apiClient.getCredits(config.clientId);
        spinner.succeed('Credit balance fetched');
        console.log(chalk.white.bold('\nCredits:'));
        console.log(chalk.gray(`  Remaining LOC: ${chalk.green(credits.remainingLoc.toLocaleString())}`));
        console.log(chalk.gray(`  Plan: ${credits.plan}`));
      } catch (error) {
        spinner.fail('Could not fetch credits');
        console.log(chalk.gray('  API may be unreachable or you may not have an account'));
      }
    } else if (config.offlineMode) {
      console.log(chalk.gray('  Credits: Offline mode enabled'));
    }

    console.log();
  } catch (error) {
    console.error(chalk.red('\n✗ Status check failed:'), error);
    process.exit(1);
  }
}
