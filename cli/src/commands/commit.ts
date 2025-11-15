import chalk from 'chalk';
import { configManager } from '../core/config';
import { repositoryManager } from '../core/repository';
import { createProvider } from '../providers/factory';
import { CommitMessageGenerator } from '../features/commit-generator';
import { AICache } from '../core/ai-cache';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface CommitOptions {
  ai?: boolean;
  auto?: boolean;
  scope?: string;
  type?: string;
  includeBody?: boolean;
}

export async function commitCommand(options: CommitOptions): Promise<void> {
  try {
    // Load config
    const config = configManager.loadOrInit();

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    const repoRoot = repoInfo.rootPath;

    console.log(chalk.blue('🤖 Generating commit message...'));

    // Check if AI provider is configured
    if (!config.provider || !config.apiKey) {
      console.log(chalk.yellow('\n⚠ AI provider not configured. Run `guardscan config` to set up.'));
      console.log(chalk.gray('  Falling back to standard git commit.'));
      return;
    }

    // Create AI provider
    const provider = createProvider(config.provider, config.apiKey);

    // Create AI cache
    const cache = new AICache(repoInfo.id, 100); // 100MB cache

    // Create commit generator
    const commitGenerator = new CommitMessageGenerator(provider, cache, repoRoot);

    // Generate commit message
    const message = await commitGenerator.generateCommitMessage({
      scope: options.scope,
      type: options.type,
      includeBody: options.includeBody !== false,
    });

    // Format message
    const formattedMessage = commitGenerator.formatMessage(message);

    // Display generated message
    console.log(chalk.white.bold('\n📝 Generated Commit Message:\n'));
    console.log(chalk.cyan('─'.repeat(60)));
    console.log(chalk.white(formattedMessage));
    console.log(chalk.cyan('─'.repeat(60)));

    // If auto mode, commit directly
    if (options.auto) {
      console.log(chalk.blue('\n🔄 Creating commit...'));

      try {
        await execAsync(`git commit -m "${formattedMessage.replace(/"/g, '\\"')}"`, {
          cwd: repoRoot,
        });

        console.log(chalk.green('\n✓ Commit created successfully'));
      } catch (error) {
        console.error(chalk.red('\n✗ Failed to create commit:'), error);
        process.exit(1);
      }
    } else {
      // Interactive mode - ask user to confirm
      console.log(chalk.yellow('\n💡 To commit with this message, run:'));
      console.log(chalk.gray(`   git commit -m "${formattedMessage.replace(/\n/g, '\\n')}"`));

      console.log(chalk.yellow('\n   Or use --auto flag to commit automatically:'));
      console.log(chalk.gray('   guardscan commit --ai --auto'));
    }

  } catch (error) {
    console.error(chalk.red('\n✗ Failed to generate commit message:'), error);
    process.exit(1);
  }
}
