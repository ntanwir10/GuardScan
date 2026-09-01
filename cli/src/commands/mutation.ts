import chalk from 'chalk';
import ora from 'ora';
import { mutationTester, MutationConfig } from '../core/mutation-tester';
import { repositoryManager } from '../core/repository';
import { createProgressBar } from '../utils/progress';
import * as fs from 'fs';
import * as path from 'path';
import { createDebugLogger } from '../utils/debug-logger';
import { createPerformanceTracker } from '../utils/performance-tracker';
import { handleCommandError } from '../utils/error-handler';

const logger = createDebugLogger('mutation');
const perfTracker = createPerformanceTracker('guardscan mutation');

interface MutationOptions {
  framework?: 'stryker' | 'mutmut' | 'pitest' | 'auto';
  threshold?: number;
  files?: string;
  testCommand?: string;
  allowUnsafeTestCommand?: boolean;
  timeout?: number;
}

export async function mutationCommand(options: MutationOptions): Promise<void> {
  logger.debug('Mutation command started', { options });
  perfTracker.start('mutation-total');
  
  console.log(chalk.cyan.bold('\n🧬 Mutation Testing\n'));

  try {
    perfTracker.start('detect-repository');
    const repoPath = process.cwd();
    const repoInfo = repositoryManager.getRepoInfo();
    perfTracker.end('detect-repository');
    logger.debug('Repository detected', { name: repoInfo.name });

    console.log(chalk.gray(`Repository: ${repoInfo.name}`));
    console.log(chalk.gray(`Framework: ${options.framework || 'auto-detect'}`));
    console.log(chalk.gray(`Threshold: ${options.threshold || 80}%\n`));

    // Build config
    const config: MutationConfig = {
      framework: options.framework,
      threshold: options.threshold,
      testCommand: options.testCommand,
      allowUnsafeTestCommand: options.allowUnsafeTestCommand,
      timeout: options.timeout,
    };

    if (options.testCommand && options.allowUnsafeTestCommand) {
      // eslint-disable-next-line no-console
      console.log(
        chalk.yellow(
          'Warning: custom test command execution is enabled. Only use --allow-unsafe-test-command with trusted input.'
        )
      );
      // eslint-disable-next-line no-console
      console.log();
    }

    if (options.files) {
      config.files = options.files.split(',').map(f => f.trim());
    }

    // Initialize progress tracking (3 steps)
    const totalSteps = 3; // Run test, Display results, Save results
    const progressBar = createProgressBar(totalSteps, 'Mutation Testing');

    // Step 1: Run mutation testing
    progressBar.update(0, { status: 'Running mutation testing...' });

    let result;
    try {
      result = await mutationTester.runMutationTest(config);
      progressBar.update(1, { status: 'Mutation testing complete' });
    } catch (error: any) {
      progressBar.update(1, { status: 'Mutation testing failed' });
      progressBar.stop();
      throw error;
    }

    // Step 2: Display results
    progressBar.update(1, { status: 'Analyzing results...' });

    // Display results
    displayResults(result);

    // Display recommendations
    console.log(chalk.white.bold('\n💡 Recommendations:\n'));
    const recommendations = mutationTester.generateRecommendations(result);
    recommendations.forEach(rec => {
      console.log(chalk.gray(`  • ${rec}`));
    });
    console.log();

    // Display top survived mutants
    if (result.mutants.length > 0) {
      const survivedMutants = result.mutants.filter(m => m.status === 'survived');

      if (survivedMutants.length > 0) {
        console.log(chalk.white.bold('🔴 Top Survived Mutants:\n'));

        survivedMutants.slice(0, 10).forEach(mutant => {
          console.log(chalk.red(`  ${mutant.file}:${mutant.line}`));
          console.log(chalk.gray(`    ${mutant.mutatorName}: ${mutant.description}`));
          if (mutant.replacement) {
            console.log(chalk.gray(`    Replacement: ${mutant.replacement}`));
          }
          console.log();
        });

        if (survivedMutants.length > 10) {
          console.log(chalk.gray(`  ... and ${survivedMutants.length - 10} more survived mutants\n`));
        }
      }
    }

    progressBar.update(2, { status: 'Analysis complete' });

    // Step 3: Save detailed results
    progressBar.update(2, { status: 'Saving results...' });

    const resultsPath = path.join(repoPath, '.guardscan', 'mutation-results.json');
    const dir = path.dirname(resultsPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resultsPath, JSON.stringify(result, null, 2));
    progressBar.update(3, { status: 'Complete' });
    progressBar.stop();

    console.log(chalk.gray(`  Results saved: ${resultsPath}\n`));

    // Exit with error if threshold not met
    if (!result.passed) {
      console.log(chalk.red(`  ✗ Mutation score ${result.mutationScore.toFixed(1)}% is below threshold ${options.threshold || 80}%\n`));
      handleCommandError(new Error(`Mutation score ${result.mutationScore.toFixed(1)}% is below threshold ${options.threshold || 80}%`), 'Mutation testing');
    } else {
      console.log(chalk.green(`  ✓ Mutation score ${result.mutationScore.toFixed(1)}% meets threshold ${options.threshold || 80}%\n`));
    }

  } catch (error: any) {
    console.error(chalk.red('\n✗ Mutation testing failed:'), error.message);
    console.log();

    // Provide helpful installation instructions
    if (error.message.includes('not installed')) {
      console.log(chalk.yellow('Installation instructions:\n'));

      if (error.message.includes('stryker')) {
        console.log(chalk.gray('  Stryker (JavaScript/TypeScript):'));
        console.log(chalk.white('    npm install --save-dev @stryker-mutator/core'));
        console.log(chalk.white('    npm install --save-dev @stryker-mutator/typescript-checker'));
        console.log(chalk.white('    npx stryker init'));
      }

      if (error.message.includes('mutmut')) {
        console.log(chalk.gray('  mutmut (Python):'));
        console.log(chalk.white('    pip install mutmut'));
      }

      if (error.message.includes('pitest') || error.message.includes('PITest')) {
        console.log(chalk.gray('  PITest (Java/Maven):'));
        console.log(chalk.white('    Add to pom.xml:'));
        console.log(chalk.white('      <plugin>'));
        console.log(chalk.white('        <groupId>org.pitest</groupId>'));
        console.log(chalk.white('        <artifactId>pitest-maven</artifactId>'));
        console.log(chalk.white('        <version>1.15.0</version>'));
        console.log(chalk.white('      </plugin>'));
      }

      console.log();
    }

    handleCommandError(error, 'Mutation testing');
  }
}

/**
 * Display mutation testing results
 */
function displayResults(result: any): void {
  console.log(chalk.white.bold('\n🧬 Mutation Testing Results:\n'));

  console.log(chalk.cyan('  Framework:'));
  console.log(chalk.gray(`    ${result.framework.toUpperCase()}`));

  console.log(chalk.cyan('\n  Mutation Score:'));
  const scoreColor = result.mutationScore >= 80 ? chalk.green :
                     result.mutationScore >= 60 ? chalk.yellow :
                     chalk.red;
  console.log(scoreColor(`    ${result.mutationScore.toFixed(1)}%`));

  console.log(chalk.cyan('\n  Mutants:'));
  console.log(chalk.gray(`    Total: ${result.totalMutants}`));
  console.log(chalk.green(`    ✓ Killed: ${result.killedMutants} (${((result.killedMutants / result.totalMutants) * 100).toFixed(1)}%)`));
  console.log(chalk.red(`    ✗ Survived: ${result.survivedMutants} (${((result.survivedMutants / result.totalMutants) * 100).toFixed(1)}%)`));

  if (result.noCoverageMutants > 0) {
    console.log(chalk.yellow(`    ⚠ No Coverage: ${result.noCoverageMutants} (${((result.noCoverageMutants / result.totalMutants) * 100).toFixed(1)}%)`));
  }

  if (result.timeoutMutants > 0) {
    console.log(chalk.yellow(`    ⏱ Timeout: ${result.timeoutMutants} (${((result.timeoutMutants / result.totalMutants) * 100).toFixed(1)}%)`));
  }

  console.log(chalk.cyan('\n  Duration:'));
  console.log(chalk.gray(`    ${(result.duration / 1000).toFixed(1)}s`));

  console.log(chalk.cyan('\n  Status:'));
  if (result.passed) {
    console.log(chalk.green('    ✓ Threshold met'));
  } else {
    console.log(chalk.red('    ✗ Threshold not met'));
  }

  console.log();
}
