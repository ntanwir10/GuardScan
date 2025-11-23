import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { configManager } from '../core/config';
import { repositoryManager } from '../core/repository';
import { ProviderFactory } from '../providers/factory';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('explain');
const perfTracker = createPerformanceTracker('guardscan explain');
import { CodeExplainer, ExplanationLevel, ExplanationTarget } from '../features/code-explainer';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';

interface ExplainOptions {
  level?: string;
  type?: string;
  output?: string;
}

export async function explainCommand(target: string, options: ExplainOptions): Promise<void> {
  logger.debug('Explain command started', { target, options });
  perfTracker.start('explain-total');
  
  try {
    // Load config
    perfTracker.start('load-config');
    const config = configManager.loadOrInit();
    perfTracker.end('load-config');
    logger.debug('Config loaded', { provider: config.provider });

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    const repoRoot = repoInfo.path;

    console.log(chalk.blue(`🤖 Explaining: ${target}...`));

    // Check if AI provider is configured
    if (!config.provider || config.provider === 'none' || !config.apiKey) {
      console.log(chalk.yellow('\n⚠ AI provider not configured. Run `guardscan config` to set up.'));
      return;
    }

    // Validate level
    const level = (options.level?.toLowerCase() || 'detailed') as ExplanationLevel;
    if (!['brief', 'detailed', 'comprehensive'].includes(level)) {
      handleCommandError(new Error('Invalid level. Must be: brief, detailed, or comprehensive'), 'Explain');
    }

    // Validate type
    const type = (options.type?.toLowerCase() || 'function') as ExplanationTarget;
    if (!['function', 'class', 'file', 'module'].includes(type)) {
      handleCommandError(new Error('Invalid type. Must be: function, class, file, or module'), 'Explain');
    }

    // Create AI provider
    const provider = ProviderFactory.create(config.provider, config.apiKey, config.apiEndpoint);

    // Create AI cache
    const cache = new AICache(repoInfo.repoId, 100); // 100MB cache

    // Create indexer
    const indexer = new CodebaseIndexer(repoRoot, repoInfo.repoId);

    // Create explainer
    const explainer = new CodeExplainer(provider, indexer, cache, repoRoot);

    // Generate explanation based on type
    let explanation;

    try {
      if (type === 'function') {
        explanation = await explainer.explainFunction(target, level);
      } else if (type === 'class') {
        explanation = await explainer.explainClass(target, level);
      } else if (type === 'file') {
        // Resolve file path
        const filePath = path.isAbsolute(target) ? target : path.join(repoRoot, target);
        explanation = await explainer.explainFile(filePath, level);
      } else {
        // module/theme
        explanation = await explainer.explainTheme(target, level);
      }
    } catch (error: any) {
      handleCommandError(error, `Explain ${type}`);
    }

    // Format and display explanation
    const formattedExplanation = explainer.formatExplanation(explanation);

    console.log(chalk.white.bold('\n📖 Code Explanation:\n'));
    console.log(chalk.cyan('─'.repeat(60)));
    console.log(formattedExplanation);
    console.log(chalk.cyan('─'.repeat(60)));

    // Save to file if requested
    if (options.output) {
      const outputPath = path.isAbsolute(options.output)
        ? options.output
        : path.join(repoRoot, options.output);

      fs.writeFileSync(outputPath, formattedExplanation, 'utf-8');
      console.log(chalk.green(`\n✓ Explanation saved to: ${outputPath}`));
    }

    // Display statistics
    console.log(chalk.gray(`\nLevel: ${explanation.level}`));
    console.log(chalk.gray(`Type: ${explanation.type}`));

    if (explanation.complexity) {
      console.log(chalk.gray(`Complexity: ${explanation.complexity}`));
    }

    if (explanation.patterns && explanation.patterns.length > 0) {
      console.log(chalk.gray(`Patterns found: ${explanation.patterns.length}`));
    }

    console.log();

  } catch (error) {
    handleCommandError(error, 'Explain');
  }
}
