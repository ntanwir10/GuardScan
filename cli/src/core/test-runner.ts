import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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

export class TestRunner {
  /**
   * Auto-detect and run tests for the project
   */
  async runTests(repoPath: string = process.cwd(), withCoverage: boolean = false): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Detect and run Jest (JavaScript/TypeScript)
    if (this.hasJest(repoPath)) {
      const jestResult = await this.runJest(repoPath, withCoverage);
      if (jestResult) results.push(jestResult);
    }

    // Detect and run pytest (Python)
    if (this.hasPytest(repoPath)) {
      const pytestResult = await this.runPytest(repoPath, withCoverage);
      if (pytestResult) results.push(pytestResult);
    }

    // Detect and run go test (Go)
    if (this.hasGoTest(repoPath)) {
      const goResult = await this.runGoTest(repoPath, withCoverage);
      if (goResult) results.push(goResult);
    }

    // Detect and run cargo test (Rust)
    if (this.hasCargoTest(repoPath)) {
      const cargoResult = await this.runCargoTest(repoPath);
      if (cargoResult) results.push(cargoResult);
    }

    return results;
  }

  /**
   * Check if Jest is configured
   */
  private hasJest(repoPath: string): boolean {
    // Check package.json for jest dependency
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.devDependencies?.jest || packageJson.dependencies?.jest) {
          return true;
        }
      } catch {
        // Continue to file-based detection
      }
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
  private async runJest(repoPath: string, withCoverage: boolean): Promise<TestResult | null> {
    try {
      const coverageFlag = withCoverage ? '--coverage' : '';
      const output = execSync(`npm test -- --json ${coverageFlag} 2>&1 || true`, {
        cwd: repoPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      // Parse Jest JSON output
      const jsonMatch = output.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]);

      const failures: TestFailure[] = [];
      let totalTests = 0;
      let passed = 0;
      let failed = 0;
      let skipped = 0;

      for (const testFile of result.testResults || []) {
        for (const testCase of testFile.assertionResults || []) {
          totalTests++;
          if (testCase.status === 'passed') passed++;
          else if (testCase.status === 'failed') {
            failed++;
            failures.push({
              testName: testCase.fullName || testCase.title,
              error: testCase.failureMessages?.join('\n') || 'Unknown error',
              file: testFile.name,
            });
          } else if (testCase.status === 'skipped') skipped++;
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
      return null;
    }
  }

  /**
   * Parse Jest coverage from coverage-summary.json
   */
  private parseJestCoverage(repoPath: string): CoverageResult | undefined {
    const coveragePath = path.join(repoPath, 'coverage', 'coverage-summary.json');
    if (!fs.existsSync(coveragePath)) return undefined;

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
  private async runPytest(repoPath: string, withCoverage: boolean): Promise<TestResult | null> {
    try {
      const coverageFlag = withCoverage ? '--cov --cov-report=json' : '';
      const output = execSync(`pytest --json-report ${coverageFlag} 2>&1 || true`, {
        cwd: repoPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      // Parse pytest JSON report
      const reportPath = path.join(repoPath, '.report.json');
      if (!fs.existsSync(reportPath)) {
        // Fallback: parse text output
        return this.parsePytestTextOutput(output);
      }

      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

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
      return null;
    }
  }

  /**
   * Parse pytest text output (fallback)
   */
  private parsePytestTextOutput(output: string): TestResult | null {
    const passedMatch = output.match(/(\d+) passed/);
    const failedMatch = output.match(/(\d+) failed/);
    const skippedMatch = output.match(/(\d+) skipped/);

    if (!passedMatch && !failedMatch) return null;

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
    if (!fs.existsSync(coveragePath)) return undefined;

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
  private async runGoTest(repoPath: string, withCoverage: boolean): Promise<TestResult | null> {
    try {
      const coverageFlag = withCoverage ? '-coverprofile=coverage.out' : '';
      const output = execSync(`go test -json ${coverageFlag} ./... 2>&1 || true`, {
        cwd: repoPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      let totalTests = 0;
      let passed = 0;
      let failed = 0;
      let skipped = 0;
      const failures: TestFailure[] = [];

      // Parse line-delimited JSON
      const lines = output.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.Test && event.Action) {
            if (event.Action === 'pass') {
              totalTests++;
              passed++;
            } else if (event.Action === 'fail') {
              totalTests++;
              failed++;
              failures.push({
                testName: event.Test,
                error: event.Output || 'Test failed',
              });
            } else if (event.Action === 'skip') {
              totalTests++;
              skipped++;
            }
          }
        } catch {
          // Skip invalid JSON lines
        }
      }

      return {
        framework: 'go test',
        totalTests,
        passed,
        failed,
        skipped,
        duration: 0,
        coverage: this.parseGoCoverage(repoPath),
        failures,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse go test coverage
   */
  private parseGoCoverage(repoPath: string): CoverageResult | undefined {
    const coveragePath = path.join(repoPath, 'coverage.out');
    if (!fs.existsSync(coveragePath)) return undefined;

    try {
      const output = execSync('go tool cover -func=coverage.out', {
        cwd: repoPath,
        encoding: 'utf-8',
      });

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
  private async runCargoTest(repoPath: string): Promise<TestResult | null> {
    try {
      const output = execSync('cargo test -- --format=json 2>&1 || true', {
        cwd: repoPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      // Parse cargo test output (basic parsing)
      const passedMatch = output.match(/test result:.*?(\d+) passed/);
      const failedMatch = output.match(/(\d+) failed/);

      if (!passedMatch) return null;

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
      return null;
    }
  }

  /**
   * Find files matching pattern
   */
  private findFiles(dir: string, pattern: RegExp, maxDepth: number = 5): string[] {
    const files: string[] = [];

    const search = (currentDir: string, depth: number) => {
      if (depth > maxDepth) return;

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
