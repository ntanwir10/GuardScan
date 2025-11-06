import chalk from 'chalk';
import inquirer from 'inquirer';
import { configManager } from '../core/config';

interface ResetOptions {
  all?: boolean;
}

export async function resetCommand(options: ResetOptions): Promise<void> {
  console.log(chalk.cyan.bold('\n🔄 Reset GuardScan\n'));

  try {
    if (options.all) {
      // Confirm full reset
      const answer = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: chalk.yellow('This will delete ALL configuration including your client_id. Continue?'),
          default: false,
        },
      ]);

      if (!answer.confirm) {
        console.log(chalk.gray('Reset cancelled\n'));
        return;
      }

      configManager.reset(true);
      console.log(chalk.green('✓ Full reset completed'));
      console.log(chalk.gray('  All configuration and cache deleted'));
      console.log(chalk.gray('  Run "guardscan init" to start fresh\n'));
    } else {
      // Partial reset (cache only)
      configManager.reset(false);
      console.log(chalk.green('✓ Cache cleared'));
      console.log(chalk.gray('  Configuration preserved\n'));
    }
  } catch (error) {
    console.error(chalk.red('\n✗ Reset failed:'), error);
    process.exit(1);
  }
}
