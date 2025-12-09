import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { configManager } from '../core/config';
import { repositoryManager } from '../core/repository';
import { ProviderFactory } from '../providers/factory';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('test-gen');
const perfTracker = createPerformanceTracker('guardscan test-gen');
import { TestGenerator, TestFramework, TestGenerationOptions } from '../features/test-generator';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';

interface TestGenOptions {
  function?: string;
  class?: string;
  file?: string;
  framework?: string;
  output?: string;
  coverage?: boolean;
}

export async function testGenCommand(options: TestGenOptions): Promise<void> {
  logger.debug('Test-gen command started', { options });
  perfTracker.start('test-gen-total');
  
  try {
    // Load config
    perfTracker.start('load-config');
    const config = configManager.loadOrInit();
    perfTracker.end('load-config');
    logger.debug('Config loaded', { provider: config.provider });

    // Get repository info
    const repoInfo = repositoryManager.getRepoInfo();
    const repoRoot = repoInfo.path;

    console.log(chalk.blue('🧪 Generating tests with AI...'));

    // Check if AI provider is configured
    if (!config.provider || config.provider === 'none' || !config.apiKey) {
      console.log(chalk.yellow('\n⚠ AI provider not configured. Run `guardscan config` to set up.'));
      return;
    }

    // Validate target
    if (!options.function && !options.class && !options.file) {
      handleCommandError(new Error('Must specify one of: --function, --class, or --file'), 'Test generation');
    }

    // Create AI provider
    const provider = ProviderFactory.create(config.provider, config.apiKey, config.apiEndpoint, config.model);

    // Create AI cache
    const cache = new AICache(repoInfo.repoId, 100); // 100MB cache

    // Create indexer
    const indexer = new CodebaseIndexer(repoRoot, repoInfo.repoId);

    // Create test generator
    const testGen = new TestGenerator(provider, indexer, cache, repoRoot);

    // Generate tests based on target type
    let result;

    try {
      const genOptions: TestGenerationOptions = {
        framework: (options.framework as TestFramework) || 'auto',
        outputDir: options.output,
      };

      if (options.function) {
        console.log(chalk.blue(`\nGenerating tests for function: ${options.function}`));
        result = await testGen.generateTestsForFunction(options.function, genOptions);
      } else if (options.class) {
        console.log(chalk.blue(`\nGenerating tests for class: ${options.class}`));
        result = await testGen.generateTestsForClass(options.class, genOptions);
      } else if (options.file) {
        // Generate tests for all functions/classes in file
        console.log(chalk.blue(`\nGenerating tests for file: ${options.file}`));
        console.log(chalk.yellow('Note: Generating tests for entire files - this may take a while'));

        // For now, show error message - full file support can be added later
        console.error(chalk.yellow('\n⚠ File-level test generation not yet implemented. Use --function or --class instead.'));
        return;
      }
    } catch (error: any) {
      handleCommandError(error, 'Test generation');
    }

    if (!result) {
      console.error(chalk.red('\n✗ No tests generated'));
      process.exit(1);
    }

    // Display results
    console.log(chalk.green('\n✓ Test generation complete!\n'));
    console.log(chalk.white.bold('📝 Generated Test Details:\n'));
    console.log(chalk.cyan('─'.repeat(60)));
    console.log(chalk.gray(`Target: ${result.targetName} (${result.targetType})`));
    console.log(chalk.gray(`Framework: ${result.framework}`));
    console.log(chalk.gray(`Test Path: ${result.testPath}`));
    console.log(chalk.gray(`Test Scenarios: ${result.coverage.scenarios}`));
    console.log(chalk.gray(`Estimated Coverage: ${result.coverage.estimated}%`));

    if (!result.valid) {
      console.log(chalk.yellow(`\nValidation Warnings:`));
      if (result.errors && result.errors.length > 0) {
        result.errors.forEach(err => console.log(chalk.yellow(`  - ${err}`)));
      }
    } else {
      console.log(chalk.green(`\n✓ Tests validated successfully`));
    }

    console.log(chalk.cyan('─'.repeat(60)));

    // Show preview of test code
    console.log(chalk.white.bold('\n📄 Test Code Preview:\n'));
    const lines = result.testCode.split('\n').slice(0, 20);
    lines.forEach((line, i) => {
      console.log(chalk.gray(`${String(i + 1).padStart(3, ' ')} │ ${line}`));
    });

    if (result.testCode.split('\n').length > 20) {
      console.log(chalk.gray(`... (${result.testCode.split('\n').length - 20} more lines)`));
    }

    // Save to file
    const outputPath = result.testPath;
    const fullPath = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(repoRoot, outputPath);

    // Check if file exists
    if (fs.existsSync(fullPath)) {
      console.log(chalk.yellow(`\n⚠ Test file already exists: ${outputPath}`));
      console.log(chalk.yellow('   Use --output to specify a different path, or manually merge the tests.'));
    } else {
      // Create directory if needed
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write test file
      fs.writeFileSync(fullPath, result.testCode, 'utf-8');
      console.log(chalk.green(`\n✓ Tests saved to: ${outputPath}`));
    }

    // Show next steps
    console.log(chalk.white.bold('\n📋 Next Steps:\n'));
    console.log(chalk.gray('1. Review the generated tests'));
    console.log(chalk.gray('2. Adjust test cases as needed'));
    console.log(chalk.gray('3. Run tests: npm test'));
    console.log(chalk.gray('4. Iterate to improve coverage\n'));

  } catch (error) {
    handleCommandError(error, 'Test generation');
  }
}
