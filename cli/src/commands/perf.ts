import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { performanceTester, PerformanceConfig } from '../core/performance-tester';
import * as fs from 'fs';
import * as path from 'path';

interface PerfOptions {
  load?: boolean;
  stress?: boolean;
  web?: string;  // URL for Lighthouse
  baseline?: boolean;
  compare?: boolean;
  duration?: string;
  vus?: number;
  url?: string;
}

export async function perfCommand(options: PerfOptions): Promise<void> {
  console.log(chalk.cyan.bold('\n⚡ Performance Testing\n'));

  try {
    const repoPath = process.cwd();

    // Determine test type
    let testType: 'load' | 'stress' | 'web' = 'load';
    if (options.stress) testType = 'stress';
    if (options.web) testType = 'web';

    console.log(chalk.gray(`Test Type: ${testType}`));
    console.log();

    // Check for required external dependencies
    if (testType === 'web') {
      if (!checkLighthouseInstalled()) {
        console.log(chalk.yellow('⚠️  Lighthouse is not installed\n'));
        console.log(chalk.white('Lighthouse is required for web performance testing.\n'));
        console.log(chalk.cyan('Install Lighthouse:'));
        console.log(chalk.gray('  npm install -g lighthouse'));
        console.log();
        console.log(chalk.cyan('Or using Homebrew (macOS):'));
        console.log(chalk.gray('  brew install lighthouse'));
        console.log();
        console.log(chalk.gray('For more info: https://github.com/GoogleChrome/lighthouse\n'));
        process.exit(1);
      }
    } else {
      // load or stress tests require k6
      if (!checkK6Installed()) {
        console.log(chalk.yellow('⚠️  k6 is not installed\n'));
        console.log(chalk.white('k6 is required for load and stress testing.\n'));
        console.log(chalk.cyan('Install k6:'));
        console.log(chalk.gray('  # macOS (Homebrew)'));
        console.log(chalk.gray('  brew install k6'));
        console.log();
        console.log(chalk.gray('  # Windows (Chocolatey)'));
        console.log(chalk.gray('  choco install k6'));
        console.log();
        console.log(chalk.gray('  # Linux (Debian/Ubuntu)'));
        console.log(chalk.gray('  sudo gpg -k'));
        console.log(chalk.gray('  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69'));
        console.log(chalk.gray('  echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list'));
        console.log(chalk.gray('  sudo apt-get update'));
        console.log(chalk.gray('  sudo apt-get install k6'));
        console.log();
        console.log(chalk.gray('For more info: https://k6.io/docs/get-started/installation/\n'));
        process.exit(1);
      }
    }

    let result;

    if (testType === 'web') {
      // Run Lighthouse
      const url = options.web || 'http://localhost:3000';
      const spinner = ora(`Running Lighthouse audit on ${url}...`).start();

      try {
        result = await performanceTester.runLighthouse(url);
        spinner.succeed('Lighthouse audit complete');
      } catch (error) {
        spinner.fail('Lighthouse audit failed');
        throw error;
      }
    } else {
      // Run k6 load or stress test
      const config: PerformanceConfig = {
        duration: options.duration || '30s',
        vus: options.vus || 10,
        endpoints: options.url ? [{ url: options.url }] : undefined,
      };

      const spinner = ora(`Running ${testType} test...`).start();

      try {
        if (testType === 'load') {
          result = await performanceTester.runLoadTest(config);
        } else {
          result = await performanceTester.runStressTest(config);
        }
        spinner.succeed(`${testType} test complete`);
      } catch (error) {
        spinner.fail(`${testType} test failed`);
        throw error;
      }
    }

    // Display results
    displayResults(result);

    // Check for regressions
    if (options.compare) {
      console.log(chalk.white.bold('\n📊 Regression Analysis:\n'));
      const regressions = performanceTester.detectRegressions(result);

      if (regressions.length === 0) {
        console.log(chalk.green('  ✓ No baseline found for comparison'));
      } else {
        const hasRegressions = regressions.some(r => r.isRegression);

        if (!hasRegressions) {
          console.log(chalk.green('  ✓ No performance regressions detected\n'));
        } else {
          console.log(chalk.red('  ⚠️  Performance regressions detected:\n'));
        }

        regressions.forEach(reg => {
          const color = reg.isRegression ? chalk.red : chalk.green;
          const arrow = reg.change > 0 ? '↑' : '↓';
          const emoji = reg.isRegression ? '🔴' : '✓';

          console.log(color(`  ${emoji} ${reg.metric.toUpperCase()}: ${reg.baseline.toFixed(2)}ms → ${reg.current.toFixed(2)}ms (${arrow} ${Math.abs(reg.change).toFixed(1)}%)`));
        });

        console.log();
      }
    }

    // Save as baseline
    if (options.baseline) {
      performanceTester.saveBaseline(result);
      console.log(chalk.green('  ✓ Saved as baseline for future comparisons\n'));
    }

    // Save detailed results
    const resultsPath = path.join(repoPath, '.guardscan', 'performance-results.json');
    const dir = path.dirname(resultsPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resultsPath, JSON.stringify(result, null, 2));
    console.log(chalk.gray(`  Results saved: ${resultsPath}\n`));

    // Exit with error if test failed
    if (!result.passed) {
      console.log(chalk.red('  ✗ Performance test failed - thresholds not met\n'));
      process.exit(1);
    }

  } catch (error: any) {
    console.error(chalk.red('\n✗ Performance test failed:'), error.message);
    process.exit(1);
  }
}

/**
 * Display performance results
 */
function displayResults(result: any): void {
  console.log(chalk.white.bold('\n📊 Performance Metrics:\n'));

  if (result.framework === 'k6') {
    console.log(chalk.cyan('  Response Times:'));
    console.log(chalk.gray(`    P50 (median): ${result.metrics.p50.toFixed(2)}ms`));
    console.log(chalk.gray(`    P95: ${result.metrics.p95.toFixed(2)}ms`));
    console.log(chalk.gray(`    P99: ${result.metrics.p99.toFixed(2)}ms`));
    console.log(chalk.gray(`    Average: ${result.metrics.avg.toFixed(2)}ms`));
    console.log(chalk.gray(`    Min: ${result.metrics.min.toFixed(2)}ms`));
    console.log(chalk.gray(`    Max: ${result.metrics.max.toFixed(2)}ms`));

    console.log(chalk.cyan('\n  Throughput:'));
    console.log(chalk.gray(`    Requests/sec: ${result.metrics.rps.toFixed(2)}`));
    console.log(chalk.gray(`    Error rate: ${(result.metrics.errorRate * 100).toFixed(2)}%`));

    // Status
    console.log(chalk.cyan('\n  Status:'));
    if (result.passed) {
      console.log(chalk.green('    ✓ All thresholds passed'));
    } else {
      console.log(chalk.red('    ✗ Some thresholds failed:'));
      result.failures.forEach((failure: string) => {
        console.log(chalk.red(`      • ${failure}`));
      });
    }
  } else if (result.framework === 'lighthouse') {
    console.log(chalk.cyan('  Web Performance:'));
    console.log(chalk.gray(`    First Contentful Paint: ${result.metrics.p50.toFixed(0)}ms`));
    console.log(chalk.gray(`    Largest Contentful Paint: ${result.metrics.p95.toFixed(0)}ms`));
    console.log(chalk.gray(`    Speed Index: ${result.metrics.p99.toFixed(0)}ms`));
    console.log(chalk.gray(`    Total Blocking Time: ${result.metrics.avg.toFixed(0)}ms`));

    console.log(chalk.cyan('\n  Status:'));
    if (result.passed) {
      console.log(chalk.green('    ✓ Performance score >= 90%'));
    } else {
      console.log(chalk.red('    ✗ Performance score < 90%'));
      result.failures.forEach((failure: string) => {
        console.log(chalk.red(`      • ${failure}`));
      });
    }
  }

  console.log();
}

/**
 * Check if k6 is installed
 */
function checkK6Installed(): boolean {
  try {
    execSync('k6 version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Lighthouse is installed
 */
function checkLighthouseInstalled(): boolean {
  try {
    execSync('lighthouse --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
