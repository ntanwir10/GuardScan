import chalk from 'chalk';
import { configManager } from '../core/config';
import { repositoryManager } from '../core/repository';
import { ProviderFactory } from '../providers/factory';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('commit');
const perfTracker = createPerformanceTracker('guardscan commit');
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
  body?: boolean; // Commander.js converts --no-body to body: false
  includeBody?: boolean; // Keep for backward compatibility
}

export async function commitCommand(options: CommitOptions): Promise<void> {
  logger.debug('Commit command started', { options });
  perfTracker.start('commit-total');
  
  try {
    // Load config
    perfTracker.start('load-config');
    const config = configManager.loadOrInit();
    perfTracker.end('load-config');
    logger.debug('Config loaded', { provider: config.provider });

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    const repoRoot = repoInfo.path;

    console.log(chalk.blue('🤖 Generating commit message...'));

    // Check if AI provider is configured
    if (!config.provider || config.provider === 'none' || !config.apiKey) {
      console.log(chalk.yellow('\n⚠ AI provider not configured. Run `guardscan config` to set up.'));
      console.log(chalk.gray('  Falling back to standard git commit.'));
      return;
    }

    // Create AI provider
    const provider = ProviderFactory.create(config.provider, config.apiKey, config.apiEndpoint, config.model);

    // Create AI cache
    const cache = new AICache(repoInfo.repoId, 100); // 100MB cache

    // Create commit generator
    const commitGenerator = new CommitMessageGenerator(provider, cache, repoRoot);

    // Generate commit message
    // Handle --no-body flag: Commander.js converts it to body: false
    // Check both body (from --no-body) and includeBody (for backward compatibility)
    const includeBody = options.body !== false && options.includeBody !== false;
    
    logger.debug('Commit options', { 
      body: options.body, 
      includeBody: options.includeBody, 
      resolvedIncludeBody: includeBody 
    });
    
    const message = await commitGenerator.generateCommitMessage({
      scope: options.scope,
      type: options.type,
      includeBody,
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
        handleCommandError(error, 'Commit creation');
      }
    } else {
      // Interactive mode - set to confirm
      console.log(chalk.yellow('\n💡 To commit with this message, run:'));
      console.log(chalk.gray(`   git commit -m "${formattedMessage.replace(/\n/g, '\\n')}"`));

      console.log(chalk.yellow('\n   Or use --auto flag to commit automatically:'));
      console.log(chalk.gray('   guardscan commit --ai --auto'));
    }

  } catch (error) {
    handleCommandError(error, 'Commit message generation');
  }
}
