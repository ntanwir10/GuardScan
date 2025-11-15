import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { configManager } from '../core/config';
import { repositoryManager } from '../core/repository';
import { createProvider } from '../providers/factory';
import { CodeExplainer, ExplanationLevel, ExplanationTarget } from '../features/code-explainer';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';

interface ExplainOptions {
  level?: string;
  type?: string;
  output?: string;
}

export async function explainCommand(target: string, options: ExplainOptions): Promise<void> {
  try {
    // Load config
    const config = configManager.loadOrInit();

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    const repoRoot = repoInfo.rootPath;

    console.log(chalk.blue(`🤖 Explaining: ${target}...`));

    // Check if AI provider is configured
    if (!config.provider || !config.apiKey) {
      console.log(chalk.yellow('\n⚠ AI provider not configured. Run `guardscan config` to set up.'));
      return;
    }

    // Validate level
    const level = (options.level?.toLowerCase() || 'detailed') as ExplanationLevel;
    if (!['brief', 'detailed', 'comprehensive'].includes(level)) {
      console.error(chalk.red('\n✗ Invalid level. Must be: brief, detailed, or comprehensive'));
      process.exit(1);
    }

    // Validate type
    const type = (options.type?.toLowerCase() || 'function') as ExplanationTarget;
    if (!['function', 'class', 'file', 'module'].includes(type)) {
      console.error(chalk.red('\n✗ Invalid type. Must be: function, class, file, or module'));
      process.exit(1);
    }

    // Create AI provider
    const provider = createProvider(config.provider, config.apiKey);

    // Create AI cache
    const cache = new AICache(repoInfo.id, 100); // 100MB cache

    // Create indexer
    const indexer = new CodebaseIndexer(repoRoot, repoInfo.id);

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
      console.error(chalk.red(`\n✗ Failed to explain ${type}:`, error.message));
      process.exit(1);
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
    console.error(chalk.red('\n✗ Failed to generate explanation:'), error);
    process.exit(1);
  }
}
