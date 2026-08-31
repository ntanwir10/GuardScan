import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runProcess } from '../utils/process-runner';
import { EffectiveExecutionPolicy } from '../utils/execution-policy';

export interface TestResult {
  framework: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  coverage?: CoverageResult;
  failures: TestFailure[];
}

export interface TestFailure {
  testName: string;
  error: string;
  file?: string;
  line?: number;
}

export interface CoverageResult {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

interface JestAssertionReport {
  status: string;
  fullName?: string;
  title: string;
  failureMessages?: string[];
}

interface JestSuiteReport {
  name: string;
  status: string;
  message?: string;
  assertionResults?: JestAssertionReport[];
}

interface JestJsonReport {
  startTime?: number;
  endTime?: number;
  testResults?: JestSuiteReport[];
}

interface PytestJsonReport {
  duration?: number;
  summary?: {
    total?: number;
    passed?: number;
    failed?: number;
    skipped?: number;
  };
  collectors?: Array<{outcome?: string; longrepr?: string}>;
  tests?: Array<{
    outcome?: string;
    nodeid: string;
    call?: {longrepr?: string};
  }>;
}

interface GoTestEvent {
  Action?: string;
  Package?: string;
  Test?: string;
  Output?: string;
}

export class TestRunner {
  /**
   * Auto-detect and run tests for the project
   */
  async runTests(
    repoPath: string = process.cwd(),
    withCoverage: boolean = false,
    policy?: EffectiveExecutionPolicy
  ): Promise<TestResult[]> {
    if (policy && (policy.offline || !policy.runProjectCode)) {
      return [];
    }
    const results: TestResult[] = [];

    // Detect and run Jest (JavaScript/TypeScript)
    if (this.hasJest(repoPath)) {
      const jestResult = await this.runJest(repoPath, withCoverage, policy);
      if (jestResult) {results.push(jestResult);}
    }

    // Detect and run pytest (Python)
    if (this.hasPytest(repoPath)) {
      const pytestResult = await this.runPytest(repoPath, withCoverage, policy);
      if (pytestResult) {results.push(pytestResult);}
    }

    // Detect and run go test (Go)
    if (this.hasGoTest(repoPath)) {
      const goResult = await this.runGoTest(repoPath, withCoverage, policy);
      if (goResult) {results.push(goResult);}
    }

    // Detect and run cargo test (Rust)
    if (this.hasCargoTest(repoPath)) {
      const cargoResult = await this.runCargoTest(repoPath, policy);
      if (cargoResult) {results.push(cargoResult);}
    }

    return results;
  }

  /**
   * Check if Jest is configured
   */
  private hasJest(repoPath: string): boolean {
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {return false;}

    let packageJson: {
      scripts?: { test?: unknown };
      devDependencies?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
    };
    try {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as typeof packageJson;
    } catch {
      return false;
    }

    const rawTestScript = packageJson.scripts?.test;
    const testScript = typeof rawTestScript === 'string'
      ? rawTestScript.trim()
      : '';
    if (!testScript || /no test specified/i.test(testScript)) {return false;}
    if (packageJson.devDependencies?.jest || packageJson.dependencies?.jest) {
      return true;
    }

    // Check for Jest test file patterns
    const testPatterns = [
      /\.test\.(js|jsx|ts|tsx)$/,
      /\.spec\.(js|jsx|ts|tsx)$/,
    ];

    const hasTestFiles = testPatterns.some(pattern =>
      this.findFiles(repoPath, pattern).length > 0
    );

    if (hasTestFiles) {
      return true;
    }

    // Check for __tests__ directory
    const testDirs = ['__tests__', 'tests', 'test'];
    return testDirs.some(dir => fs.existsSync(path.join(repoPath, dir)));
  }

  /**
   * Run Jest tests
   */
  private async runJest(
    repoPath: string,
    withCoverage: boolean,
    policy?: EffectiveExecutionPolicy
  ): Promise<TestResult | null> {
    const reportDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-jest-report-'));
    const reportPath = path.join(reportDirectory, 'results.json');
    try {
      const args = ['test', '--', '--json', '--outputFile', reportPath];
      if (withCoverage) {args.push('--coverage');}
      const processResult = runProcess('npm', args, {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        timeoutMs: 10 * 60 * 1000,
        networkIsolation: policy?.isolateProjectNetwork === true,
      });
      if (processResult.timedOut) {throw new Error('Jest timed out');}
      if (!fs.existsSync(reportPath)) {
        throw new Error(`Jest exited ${processResult.status} without producing a JSON report`);
      }
      const result = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as JestJsonReport;

      const failures: TestFailure[] = [];
      let totalTests = 0;
      let passed = 0;
      let failed = 0;
      let skipped = 0;

      for (const testFile of result.testResults || []) {
        const assertionResults = testFile.assertionResults || [];
        for (const testCase of assertionResults) {
          totalTests++;
          if (testCase.status === 'passed') {passed++;}
          else if (testCase.status === 'failed') {
            failed++;
            failures.push({
              testName: testCase.fullName || testCase.title,
              error: testCase.failureMessages?.join('\n') || 'Unknown error',
              file: testFile.name,
            });
          } else if (testCase.status === 'skipped') {skipped++;}
        }
        if (testFile.status === 'failed' && assertionResults.length === 0) {
          totalTests++;
          failed++;
          failures.push({
            testName: testFile.name || 'Jest test suite',
            error: testFile.message || 'Test suite failed to run',
            file: testFile.name,
          });
        }
      }

      return {
        framework: 'Jest',
        totalTests,
        passed,
        failed,
        skipped,
        duration: result.startTime && result.endTime ? result.endTime - result.startTime : 0,
        coverage: this.parseJestCoverage(repoPath),
        failures,
      };
    } catch (error) {
      throw new Error(`Jest execution failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      fs.rmSync(reportDirectory, { recursive: true, force: true });
    }
  }

  /**
   * Parse Jest coverage from coverage-summary.json
   */
  private parseJestCoverage(repoPath: string): CoverageResult | undefined {
    const coveragePath = path.join(repoPath, 'coverage', 'coverage-summary.json');
    if (!fs.existsSync(coveragePath)) {return undefined;}

    try {
      const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
      const total = coverage.total;

      return {
        lines: total.lines?.pct || 0,
        branches: total.branches?.pct || 0,
        functions: total.functions?.pct || 0,
        statements: total.statements?.pct || 0,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Check if pytest is available
   */
  private hasPytest(repoPath: string): boolean {
    // Check for pytest config files
    if (fs.existsSync(path.join(repoPath, 'pytest.ini')) ||
        fs.existsSync(path.join(repoPath, 'setup.cfg')) ||
        fs.existsSync(path.join(repoPath, 'pyproject.toml'))) {
      return true;
    }

    // Check for Python test file patterns
    const pythonTestPatterns = [
      /test_.*\.py$/,
      /.*_test\.py$/,
    ];

    return pythonTestPatterns.some(pattern =>
      this.findFiles(repoPath, pattern).length > 0
    );
  }

  /**
   * Run pytest tests
   */
  private async runPytest(
    repoPath: string,
    withCoverage: boolean,
    policy?: EffectiveExecutionPolicy
  ): Promise<TestResult | null> {
    const reportDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-pytest-report-'));
    const reportPath = path.join(reportDirectory, 'results.json');
    try {
      const args = ['--json-report', `--json-report-file=${reportPath}`];
      if (withCoverage) {args.push('--cov', '--cov-report=json');}
      const processResult = runProcess('pytest', args, {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        timeoutMs: 10 * 60 * 1000,
        networkIsolation: policy?.isolateProjectNetwork === true,
      });
      if (processResult.timedOut) {throw new Error('pytest timed out');}
      if (processResult.status === 5) {return null;}
      const output = `${processResult.stdout}\n${processResult.stderr}`;

      // Parse pytest JSON report
      if (!fs.existsSync(reportPath)) {
        // Fallback: parse text output
        const parsed = this.parsePytestTextOutput(output);
        if (!parsed) {
          throw new Error(`pytest exited ${processResult.status} without a parseable report`);
        }
        if (processResult.status !== 0 && parsed.failed === 0) {
          throw new Error(
            `pytest exited ${processResult.status} before completing tests: ${output.trim()}`
          );
        }
        return parsed;
      }

      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as PytestJsonReport;
      const reportedFailures = report.summary?.failed || 0;
      if (processResult.status !== 0 && reportedFailures === 0) {
        const collectionFailure = (report.collectors || []).find(
          (collector: {outcome?: string}) => collector.outcome === 'failed'
        );
        const detail = collectionFailure?.longrepr || output.trim() ||
          'no failed test assertions were reported';
        throw new Error(
          `pytest exited ${processResult.status} before completing tests: ${detail}`
        );
      }

      const failures: TestFailure[] = [];
      for (const test of report.tests || []) {
        if (test.outcome === 'failed') {
          failures.push({
            testName: test.nodeid,
            error: test.call?.longrepr || 'Unknown error',
          });
        }
      }

      return {
        framework: 'pytest',
        totalTests: report.summary?.total || 0,
        passed: report.summary?.passed || 0,
        failed: report.summary?.failed || 0,
        skipped: report.summary?.skipped || 0,
        duration: report.duration || 0,
        coverage: this.parsePytestCoverage(repoPath),
        failures,
      };
    } catch (error) {
      throw new Error(`pytest execution failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      fs.rmSync(reportDirectory, { recursive: true, force: true });
    }
  }

  /**
   * Parse pytest text output (fallback)
   */
  private parsePytestTextOutput(output: string): TestResult | null {
    const passedMatch = output.match(/(\d+) passed/);
    const failedMatch = output.match(/(\d+) failed/);
    const skippedMatch = output.match(/(\d+) skipped/);

    if (!passedMatch && !failedMatch) {return null;}

    const passed = passedMatch ? parseInt(passedMatch[1]) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
    const skipped = skippedMatch ? parseInt(skippedMatch[1]) : 0;

    return {
      framework: 'pytest',
      totalTests: passed + failed + skipped,
      passed,
      failed,
      skipped,
      duration: 0,
      failures: [],
    };
  }

  /**
   * Parse pytest coverage from coverage.json
   */
  private parsePytestCoverage(repoPath: string): CoverageResult | undefined {
    const coveragePath = path.join(repoPath, 'coverage.json');
    if (!fs.existsSync(coveragePath)) {return undefined;}

    try {
      const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
      const totals = coverage.totals;

      return {
        lines: totals.percent_covered || 0,
        branches: 0, // pytest-cov doesn't separate branches
        functions: 0,
        statements: totals.percent_covered || 0,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Check if go test is available
   */
  private hasGoTest(repoPath: string): boolean {
    return fs.existsSync(path.join(repoPath, 'go.mod'));
  }

  /**
   * Run go test
   */
  private async runGoTest(
    repoPath: string,
    withCoverage: boolean,
    policy?: EffectiveExecutionPolicy
  ): Promise<TestResult | null> {
    try {
      const args = ['test', '-json'];
      if (withCoverage) {args.push('-coverprofile=coverage.out');}
      args.push('./...');
      const processResult = runProcess('go', args, {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        timeoutMs: 10 * 60 * 1000,
        networkIsolation: policy?.isolateProjectNetwork === true,
      });
      if (processResult.timedOut) {throw new Error('go test timed out');}
      const output = `${processResult.stdout}\n${processResult.stderr}`;

      let totalTests = 0;
      let passed = 0;
      let failed = 0;
      let skipped = 0;
      const failures: TestFailure[] = [];
      const packageOutput = new Map<string, string[]>();
      const packagesWithFailedTests = new Set<string>();

      // Parse line-delimited JSON
      const lines = output.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as GoTestEvent;
          if (event.Package && event.Output) {
            const messages = packageOutput.get(event.Package) || [];
            messages.push(event.Output);
            packageOutput.set(event.Package, messages);
          }
          if (event.Test && event.Action) {
            if (event.Action === 'pass') {
              totalTests++;
              passed++;
            } else if (event.Action === 'fail') {
              totalTests++;
              failed++;
              if (event.Package) {packagesWithFailedTests.add(event.Package);}
              failures.push({
                testName: event.Test,
                error: event.Output || 'Test failed',
              });
            } else if (event.Action === 'skip') {
              totalTests++;
              skipped++;
            }
          } else if (event.Action === 'fail' && event.Package &&
                     !packagesWithFailedTests.has(event.Package)) {
            totalTests++;
            failed++;
            failures.push({
              testName: event.Package,
              error: packageOutput.get(event.Package)?.join('').trim() || 'Go package failed',
            });
          }
        } catch {
          // Skip invalid JSON lines
        }
      }

      if (processResult.status !== 0 && failed === 0) {
        const diagnostic = [...packageOutput.values()].flat().join('').trim() ||
          processResult.stderr.trim() || processResult.stdout.trim() || 'no diagnostics were reported';
        throw new Error(
          `go test exited ${processResult.status} without reporting a test or package failure: ${diagnostic}`
        );
      }

      return {
        framework: 'go test',
        totalTests,
        passed,
        failed,
        skipped,
        duration: 0,
        coverage: this.parseGoCoverage(repoPath, policy),
        failures,
      };
    } catch (error) {
      throw new Error(`go test execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Parse go test coverage
   */
  private parseGoCoverage(
    repoPath: string,
    policy?: EffectiveExecutionPolicy
  ): CoverageResult | undefined {
    const coveragePath = path.join(repoPath, 'coverage.out');
    if (!fs.existsSync(coveragePath)) {return undefined;}

    try {
      const processResult = runProcess('go', ['tool', 'cover', '-func=coverage.out'], {
        cwd: repoPath,
        networkIsolation: policy?.isolateProjectNetwork === true,
      });
      if (processResult.status !== 0) {return undefined;}
      const output = processResult.stdout;

      const totalMatch = output.match(/total:.*\s(\d+\.\d+)%/);
      const coverage = totalMatch ? parseFloat(totalMatch[1]) : 0;

      return {
        lines: coverage,
        branches: 0,
        functions: 0,
        statements: coverage,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Check if cargo test is available
   */
  private hasCargoTest(repoPath: string): boolean {
    return fs.existsSync(path.join(repoPath, 'Cargo.toml'));
  }

  /**
   * Run cargo test
   */
  private async runCargoTest(
    repoPath: string,
    policy?: EffectiveExecutionPolicy
  ): Promise<TestResult | null> {
    try {
      const processResult = runProcess('cargo', ['test', '--', '--format=json'], {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        timeoutMs: 10 * 60 * 1000,
        networkIsolation: policy?.isolateProjectNetwork === true,
      });
      if (processResult.timedOut) {throw new Error('cargo test timed out');}
      const output = `${processResult.stdout}\n${processResult.stderr}`;

      // Parse cargo test output (basic parsing)
      const passedMatch = output.match(/test result:.*?(\d+) passed/);
      const failedMatch = output.match(/(\d+) failed/);

      if (!passedMatch) {
        throw new Error(`cargo test exited ${processResult.status} without a parseable report`);
      }

      const passed = parseInt(passedMatch[1]);
      const failed = failedMatch ? parseInt(failedMatch[1]) : 0;

      return {
        framework: 'cargo test',
        totalTests: passed + failed,
        passed,
        failed,
        skipped: 0,
        duration: 0,
        failures: [],
      };
    } catch (error) {
      throw new Error(`cargo test execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Find files matching pattern
   */
  private findFiles(dir: string, pattern: RegExp, maxDepth: number = 5): string[] {
    const files: string[] = [];

    const search = (currentDir: string, depth: number) => {
      if (depth > maxDepth) {return;}

      try {
        const items = fs.readdirSync(currentDir);
        for (const item of items) {
          // Skip common directories that don't contain tests
          if (item === 'node_modules' || item === '.git' || item === 'dist' ||
              item === 'build' || item === '.next' || item === 'coverage') {
            continue;
          }

          const fullPath = path.join(currentDir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            search(fullPath, depth + 1);
          } else if (pattern.test(item)) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    search(dir, 0);
    return files;
  }
}

export const testRunner = new TestRunner();
