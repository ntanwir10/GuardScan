import * as fs from 'fs';
import * as path from 'path';
import {
  isNetworkIsolationError,
  ProcessResult,
  runProcess,
} from '../utils/process-runner';
import { EffectiveExecutionPolicy } from '../utils/execution-policy';

export interface LintResult {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
  linter: string;
}

export interface LinterReport {
  linter: string;
  results: LintResult[];
  totalIssues: number;
  errors: number;
  warnings: number;
  info: number;
}

export class LinterIntegration {
  /**
   * Run all available linters
   */
  async runAll(
    repoPath: string = process.cwd(),
    policy?: EffectiveExecutionPolicy
  ): Promise<LinterReport[]> {
    if (policy && (policy.offline || !policy.runProjectCode)) {
      return [];
    }
    const reports: LinterReport[] = [];

    // Detect and run JavaScript/TypeScript linters
    if (this.hasESLint(repoPath)) {
      const eslintReport = await this.runESLint(repoPath, policy);
      if (eslintReport) {reports.push(eslintReport);}
    }

    // Detect and run Python linters
    if (this.hasFlake8(repoPath)) {
      const flake8Report = await this.runFlake8(repoPath, policy);
      if (flake8Report) {reports.push(flake8Report);}
    }

    if (this.hasPylint(repoPath)) {
      const pylintReport = await this.runPylint(repoPath, policy);
      if (pylintReport) {reports.push(pylintReport);}
    }

    // Detect and run Go linters
    if (this.hasGoLint(repoPath)) {
      const golintReport = await this.runGoLint(repoPath, policy);
      if (golintReport) {reports.push(golintReport);}
    }

    // Detect and run Ruby linters
    if (this.hasRubocop(repoPath)) {
      const rubocopReport = await this.runRubocop(repoPath, policy);
      if (rubocopReport) {reports.push(rubocopReport);}
    }

    // Detect and run PHP linters
    if (this.hasPhpCS(repoPath)) {
      const phpcsReport = await this.runPhpCS(repoPath, policy);
      if (phpcsReport) {reports.push(phpcsReport);}
    }

    return reports;
  }

  /**
   * Check if ESLint is available
   */
  private hasESLint(repoPath: string): boolean {
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {return false;}

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      return !!(packageJson.devDependencies?.eslint || packageJson.dependencies?.eslint);
    } catch {
      return false;
    }
  }

  /**
   * Run ESLint
   */
  private async runESLint(
    repoPath: string,
    policy?: EffectiveExecutionPolicy
  ): Promise<LinterReport | null> {
    try {
      const execution = runProcess('npx', ['--no-install', 'eslint', '.', '--format', 'json'], {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        timeoutMs: 5 * 60 * 1000,
        networkIsolation: policy?.isolateProjectNetwork === true,
      });
      const output = combinedOutput(execution);

      // Parse ESLint JSON output
      const jsonMatch = output.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {throw reportError('ESLint', execution);}

      const eslintResults = JSON.parse(jsonMatch[0]);
      const results: LintResult[] = [];

      for (const fileResult of eslintResults) {
        for (const message of fileResult.messages || []) {
          results.push({
            file: fileResult.filePath,
            line: message.line || 0,
            column: message.column || 0,
            severity: message.severity === 2 ? 'error' : message.severity === 1 ? 'warning' : 'info',
            rule: message.ruleId || 'unknown',
            message: message.message,
            linter: 'ESLint',
          });
        }
      }

      return {
        linter: 'ESLint',
        results,
        totalIssues: results.length,
        errors: results.filter(r => r.severity === 'error').length,
        warnings: results.filter(r => r.severity === 'warning').length,
        info: results.filter(r => r.severity === 'info').length,
      };
    } catch (error) {
      throw new Error(`ESLint execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if Flake8 is available
   */
  private hasFlake8(repoPath: string): boolean {
    return fs.existsSync(path.join(repoPath, 'setup.cfg')) ||
           fs.existsSync(path.join(repoPath, '.flake8')) ||
           fs.existsSync(path.join(repoPath, 'tox.ini')) ||
           this.findFiles(repoPath, /\.py$/).length > 0;
  }

  /**
   * Run Flake8
   */
  private async runFlake8(
    repoPath: string,
    policy?: EffectiveExecutionPolicy
  ): Promise<LinterReport | null> {
    try {
      // Check if flake8 is installed
      try {
        if (runProcess('flake8', ['--version'], {
          cwd: repoPath,
          networkIsolation: policy?.isolateProjectNetwork === true,
        }).status !== 0) {return null;}
      } catch (error) {
        if (isNetworkIsolationError(error)) {throw error;}
        return null; // Flake8 not installed
      }

      const execution = runProcess('flake8', [
        '--format=%(path)s:%(row)d:%(col)d: %(code)s %(text)s',
        '.',
      ], {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        networkIsolation: policy?.isolateProjectNetwork === true,
      });
      const output = combinedOutput(execution);

      // Flake8 JSON format (if using flake8-json plugin)
      // Otherwise, parse line format: filename:line:column: code message
      const results: LintResult[] = [];

      const lines = output.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const match = line.match(/^(.+?):(\d+):(\d+):\s*([A-Z]\d+)\s+(.+)$/);
        if (match) {
          const [, file, lineNum, column, code, message] = match;
          results.push({
            file: path.join(repoPath, file),
            line: parseInt(lineNum),
            column: parseInt(column),
            severity: code.startsWith('E') ? 'error' : 'warning',
            rule: code,
            message: message.trim(),
            linter: 'Flake8',
          });
        }
      }
      if (results.length === 0 && execution.status > 1) {throw reportError('Flake8', execution);}

      return {
        linter: 'Flake8',
        results,
        totalIssues: results.length,
        errors: results.filter(r => r.severity === 'error').length,
        warnings: results.filter(r => r.severity === 'warning').length,
        info: 0,
      };
    } catch (error) {
      throw new Error(`Flake8 execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if Pylint is available
   */
  private hasPylint(repoPath: string): boolean {
    return this.findFiles(repoPath, /\.py$/).length > 0;
  }

  /**
   * Run Pylint
   */
  private async runPylint(
    repoPath: string,
    policy?: EffectiveExecutionPolicy
  ): Promise<LinterReport | null> {
    try {
      // Check if pylint is installed
      try {
        if (runProcess('pylint', ['--version'], {
          cwd: repoPath,
          networkIsolation: policy?.isolateProjectNetwork === true,
        }).status !== 0) {return null;}
      } catch (error) {
        if (isNetworkIsolationError(error)) {throw error;}
        return null; // Pylint not installed
      }

      const execution = runProcess('pylint', ['.', '--output-format=json'], {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        networkIsolation: policy?.isolateProjectNetwork === true,
      });
      const output = combinedOutput(execution);

      // Parse Pylint JSON output
      const jsonMatch = output.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {throw reportError('Pylint', execution);}

      const pylintResults = JSON.parse(jsonMatch[0]);
      const results: LintResult[] = [];

      for (const result of pylintResults) {
        const severity = result.type === 'error' ? 'error' :
                        result.type === 'warning' ? 'warning' : 'info';

        results.push({
          file: result.path,
          line: result.line || 0,
          column: result.column || 0,
          severity,
          rule: result['message-id'] || result.symbol || 'unknown',
          message: result.message,
          linter: 'Pylint',
        });
      }

      return {
        linter: 'Pylint',
        results,
        totalIssues: results.length,
        errors: results.filter(r => r.severity === 'error').length,
        warnings: results.filter(r => r.severity === 'warning').length,
        info: results.filter(r => r.severity === 'info').length,
      };
    } catch (error) {
      throw new Error(`Pylint execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if Go linting is available
   */
  private hasGoLint(repoPath: string): boolean {
    return fs.existsSync(path.join(repoPath, 'go.mod'));
  }

  /**
   * Run golangci-lint or go vet
   */
  private async runGoLint(
    repoPath: string,
    policy?: EffectiveExecutionPolicy
  ): Promise<LinterReport | null> {
    try {
      let output = '';
      let linter = 'Go Vet';
      let execution: ProcessResult;

      // Try golangci-lint first
      try {
        execution = runProcess('golangci-lint', ['run', '--out-format=line-number'], {
          cwd: repoPath,
          maxBuffer: 10 * 1024 * 1024,
          networkIsolation: policy?.isolateProjectNetwork === true,
        });
        output = combinedOutput(execution);
        linter = 'golangci-lint';
      } catch (error) {
        if (isNetworkIsolationError(error)) {throw error;}
        // Fall back to go vet
        execution = runProcess('go', ['vet', './...'], {
          cwd: repoPath,
          maxBuffer: 10 * 1024 * 1024,
          networkIsolation: policy?.isolateProjectNetwork === true,
        });
        output = combinedOutput(execution);
      }

      const results: LintResult[] = [];

      // Parse go vet output: file.go:line:column: message
      const lines = output.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const match = line.match(/^(.+?\.go):(\d+):(\d+):\s*(.+)$/);
        if (match) {
          const [, file, lineNum, column, message] = match;
          results.push({
            file: path.join(repoPath, file),
            line: parseInt(lineNum),
            column: parseInt(column),
            severity: 'warning',
            rule: 'go-vet',
            message: message.trim(),
            linter,
          });
        }
      }
      if (results.length === 0 && execution.status > 1) {throw reportError(linter, execution);}

      return {
        linter,
        results,
        totalIssues: results.length,
        errors: 0,
        warnings: results.length,
        info: 0,
      };
    } catch (error) {
      throw new Error(`Go lint execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if Rubocop is available
   */
  private hasRubocop(repoPath: string): boolean {
    return fs.existsSync(path.join(repoPath, 'Gemfile')) ||
           this.findFiles(repoPath, /\.rb$/).length > 0;
  }

  /**
   * Run Rubocop
   */
  private async runRubocop(
    repoPath: string,
    policy?: EffectiveExecutionPolicy
  ): Promise<LinterReport | null> {
    try {
      // Check if rubocop is installed
      try {
        if (runProcess('rubocop', ['--version'], {
          cwd: repoPath,
          networkIsolation: policy?.isolateProjectNetwork === true,
        }).status !== 0) {return null;}
      } catch (error) {
        if (isNetworkIsolationError(error)) {throw error;}
        return null; // Rubocop not installed
      }

      const execution = runProcess('rubocop', ['--format', 'json'], {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        networkIsolation: policy?.isolateProjectNetwork === true,
      });
      const output = combinedOutput(execution);

      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {throw reportError('Rubocop', execution);}

      const rubocopResult = JSON.parse(jsonMatch[0]);
      const results: LintResult[] = [];

      for (const fileResult of rubocopResult.files || []) {
        for (const offense of fileResult.offenses || []) {
          results.push({
            file: fileResult.path,
            line: offense.location?.line || 0,
            column: offense.location?.column || 0,
            severity: offense.severity === 'error' || offense.severity === 'fatal' ? 'error' : 'warning',
            rule: offense.cop_name || 'unknown',
            message: offense.message,
            linter: 'Rubocop',
          });
        }
      }

      return {
        linter: 'Rubocop',
        results,
        totalIssues: results.length,
        errors: results.filter(r => r.severity === 'error').length,
        warnings: results.filter(r => r.severity === 'warning').length,
        info: 0,
      };
    } catch (error) {
      throw new Error(`Rubocop execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if PHP CodeSniffer is available
   */
  private hasPhpCS(repoPath: string): boolean {
    return this.findFiles(repoPath, /\.php$/).length > 0;
  }

  /**
   * Run PHP CodeSniffer
   */
  private async runPhpCS(
    repoPath: string,
    policy?: EffectiveExecutionPolicy
  ): Promise<LinterReport | null> {
    try {
      // Check if phpcs is installed
      try {
        if (runProcess('phpcs', ['--version'], {
          cwd: repoPath,
          networkIsolation: policy?.isolateProjectNetwork === true,
        }).status !== 0) {return null;}
      } catch (error) {
        if (isNetworkIsolationError(error)) {throw error;}
        return null; // PHP_CodeSniffer not installed
      }

      const execution = runProcess('phpcs', ['--report=json', '.'], {
        cwd: repoPath,
        maxBuffer: 10 * 1024 * 1024,
        networkIsolation: policy?.isolateProjectNetwork === true,
      });
      const output = combinedOutput(execution);

      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {throw reportError('PHP_CodeSniffer', execution);}

      const phpcsResult = JSON.parse(jsonMatch[0]);
      const results: LintResult[] = [];

      for (const [filePath, fileData] of Object.entries(phpcsResult.files || {})) {
        const messages = (fileData as any).messages || [];
        for (const message of messages) {
          results.push({
            file: filePath,
            line: message.line || 0,
            column: message.column || 0,
            severity: message.type === 'ERROR' ? 'error' : 'warning',
            rule: message.source || 'unknown',
            message: message.message,
            linter: 'PHP_CodeSniffer',
          });
        }
      }

      return {
        linter: 'PHP_CodeSniffer',
        results,
        totalIssues: results.length,
        errors: results.filter(r => r.severity === 'error').length,
        warnings: results.filter(r => r.severity === 'warning').length,
        info: 0,
      };
    } catch (error) {
      throw new Error(`PHP_CodeSniffer execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Find files matching pattern
   */
  private findFiles(dir: string, pattern: RegExp): string[] {
    const files: string[] = [];

    const search = (currentDir: string, depth: number) => {
      if (depth > 3) {return;}

      try {
        const items = fs.readdirSync(currentDir);
        for (const item of items) {
          if (item === 'node_modules' || item === '.git' || item === 'vendor') {continue;}

          const fullPath = path.join(currentDir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            search(fullPath, depth + 1);
          } else if (pattern.test(item)) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip
      }
    };

    search(dir, 0);
    return files;
  }
}

export const linterIntegration = new LinterIntegration();

function combinedOutput(result: ProcessResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function reportError(tool: string, result: ProcessResult): Error {
  const detail = combinedOutput(result).replace(/\s+/g, ' ').slice(0, 300);
  return new Error(
    `${tool} exited ${result.status} without a parseable report${detail ? `: ${detail}` : ''}`
  );
}
