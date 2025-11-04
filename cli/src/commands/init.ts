import chalk from 'chalk';
import { configManager } from '../core/config';
import { repositoryManager } from '../core/repository';

export async function initCommand(): Promise<void> {
  console.log(chalk.cyan.bold('\n🚀 Initializing AI Code Review\n'));

  try {
    // Check if already initialized
    if (configManager.exists()) {
      const config = configManager.load();
      console.log(chalk.yellow('Already initialized!'));
      console.log(chalk.gray(`Client ID: ${config.clientId}`));
      console.log(chalk.gray(`Provider: ${config.provider}`));
      console.log(chalk.gray('\nRun "ai-review config" to modify settings\n'));
      return;
    }

    // Initialize config
    const config = configManager.init();

    console.log(chalk.green('✓ Configuration initialized'));
    console.log(chalk.gray(`  Config directory: ${configManager.getConfigDir()}`));
    console.log(chalk.gray(`  Client ID: ${config.clientId}`));

    // Detect repository
    try {
      const repoInfo = repositoryManager.getRepoInfo();
      console.log(chalk.green('\n✓ Repository detected'));
      console.log(chalk.gray(`  Name: ${repoInfo.name}`));
      console.log(chalk.gray(`  Type: ${repoInfo.isGit ? 'Git' : 'Standard'}`));
      if (repoInfo.branch) {
        console.log(chalk.gray(`  Branch: ${repoInfo.branch}`));
      }
      console.log(chalk.gray(`  Repo ID: ${repoInfo.repoId}`));
    } catch (error) {
      console.log(chalk.yellow('\n⚠ Could not detect repository'));
    }

    console.log(chalk.cyan('\n📝 Next Steps:'));
    console.log(chalk.white('  1. Configure AI provider: ') + chalk.cyan('ai-review config'));
    console.log(chalk.white('  2. Run code review: ') + chalk.cyan('ai-review run'));
    console.log(chalk.white('  3. Check status: ') + chalk.cyan('ai-review status'));

    console.log(chalk.gray('\nℹ Privacy Notice:'));
    console.log(chalk.gray('  - Your client_id is stored locally only'));
    console.log(chalk.gray('  - No source code is ever transmitted'));
    console.log(chalk.gray('  - Only anonymized metadata is collected'));
    console.log(chalk.gray('  - Telemetry can be disabled via config\n'));
  } catch (error) {
    console.error(chalk.red('\n✗ Initialization failed:'), error);
    process.exit(1);
  }
}
