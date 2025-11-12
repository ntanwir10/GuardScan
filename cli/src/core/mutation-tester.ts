import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface MutationResult {
  mutationScore: number;  // 0-100
  totalMutants: number;
  killedMutants: number;
  survivedMutants: number;
  noCoverageMutants: number;
  timeoutMutants: number;
  framework: 'stryker' | 'mutmut' | 'pitest';
  duration: number;  // milliseconds
  passed: boolean;
  mutants: Mutant[];
  timestamp: string;
}

export interface Mutant {
  id: string;
  status: 'killed' | 'survived' | 'no-coverage' | 'timeout' | 'error';
  mutatorName: string;
  file: string;
  line: number;
  description: string;
  replacement?: string;
  killedBy?: string[];  // Test names that killed the mutant
}

export interface MutationConfig {
  framework?: 'stryker' | 'mutmut' | 'pitest' | 'auto';
  files?: string[];
  testCommand?: string;
  threshold?: number;  // Minimum mutation score (0-100)
  mutators?: string[];  // Specific mutators to use
  excludeFiles?: string[];
  timeout?: number;  // Timeout per test in ms
}

export class MutationTester {
  private readonly DEFAULT_CONFIG: MutationConfig = {
    framework: 'auto',
    threshold: 80,  // 80% mutation score
    timeout: 5000,  // 5 seconds per test
  };

  /**
   * Run mutation testing
   */
  async runMutationTest(config?: MutationConfig): Promise<MutationResult> {
    const mergedConfig = { ...this.DEFAULT_CONFIG, ...config };
    const repoPath = process.cwd();

    // Auto-detect framework if needed
    let framework: 'stryker' | 'mutmut' | 'pitest';
    if (mergedConfig.framework === 'auto') {
      const detected = this.detectFramework(repoPath);
      if (!detected) {
        throw new Error('Could not detect mutation testing framework. Please specify framework explicitly.');
      }
      framework = detected;
    } else if (mergedConfig.framework) {
      framework = mergedConfig.framework as 'stryker' | 'mutmut' | 'pitest';
    } else {
      throw new Error('No mutation testing framework specified.');
    }

    // Check if framework is available
    if (!this.isFrameworkAvailable(framework)) {
      throw new Error(`${framework} is not installed. Please install it first.`);
    }

    // Run mutation testing based on framework
    switch (framework) {
      case 'stryker':
        return this.runStryker(repoPath, mergedConfig);
      case 'mutmut':
        return this.runMutmut(repoPath, mergedConfig);
      case 'pitest':
        return this.runPitest(repoPath, mergedConfig);
      default:
        throw new Error(`Unsupported framework: ${framework}`);
    }
  }

  /**
   * Run Stryker mutation testing (JavaScript/TypeScript)
   */
  private async runStryker(repoPath: string, config: MutationConfig): Promise<MutationResult> {
    const startTime = Date.now();

    try {
      // Generate Stryker config if not exists
      const configPath = path.join(repoPath, 'stryker.conf.json');
      if (!fs.existsSync(configPath)) {
        this.generateStrykerConfig(repoPath, config);
      }

      // Run Stryker
      const output = execSync('npx stryker run', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 600000,  // 10 minutes
      });

      // Parse Stryker results
      const result = this.parseStrykerOutput(repoPath, output);
      result.duration = Date.now() - startTime;
      result.passed = result.mutationScore >= (config.threshold || 80);
      result.timestamp = new Date().toISOString();

      return result;
    } catch (error: any) {
      // Stryker might exit with non-zero even on success if mutation score is low
      // Try to parse the output anyway
      if (error.stdout) {
        const result = this.parseStrykerOutput(repoPath, error.stdout);
        result.duration = Date.now() - startTime;
        result.passed = result.mutationScore >= (config.threshold || 80);
        result.timestamp = new Date().toISOString();
        return result;
      }
      throw new Error(`Stryker mutation testing failed: ${error.message}`);
    }
  }

  /**
   * Run mutmut mutation testing (Python)
   */
  private async runMutmut(repoPath: string, config: MutationConfig): Promise<MutationResult> {
    const startTime = Date.now();

    try {
      // Clean previous mutmut cache
      const cachePath = path.join(repoPath, '.mutmut-cache');
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }

      // Build mutmut command
      let command = 'mutmut run';

      if (config.files && config.files.length > 0) {
        command += ` --paths-to-mutate="${config.files.join(',')}"`;
      }

      if (config.testCommand) {
        command += ` --runner="${config.testCommand}"`;
      }

      // Run mutmut
      try {
        execSync(command, {
          cwd: repoPath,
          encoding: 'utf-8',
          timeout: 600000,  // 10 minutes
        });
      } catch (error: any) {
        // mutmut exits with non-zero if there are survived mutants
        // This is expected behavior
      }

      // Get mutmut results
      const resultsOutput = execSync('mutmut results', {
        cwd: repoPath,
        encoding: 'utf-8',
      });

      const jsonOutput = execSync('mutmut junitxml > /tmp/mutmut-results.xml', {
        cwd: repoPath,
        encoding: 'utf-8',
      });

      // Parse mutmut results
      const result = this.parseMutmutOutput(repoPath, resultsOutput);
      result.duration = Date.now() - startTime;
      result.passed = result.mutationScore >= (config.threshold || 80);
      result.timestamp = new Date().toISOString();

      return result;
    } catch (error: any) {
      throw new Error(`mutmut mutation testing failed: ${error.message}`);
    }
  }

  /**
   * Run PITest mutation testing (Java)
   */
  private async runPitest(repoPath: string, config: MutationConfig): Promise<MutationResult> {
    const startTime = Date.now();

    try {
      // Detect build tool (Maven or Gradle)
      const hasMaven = fs.existsSync(path.join(repoPath, 'pom.xml'));
      const hasGradle = fs.existsSync(path.join(repoPath, 'build.gradle')) ||
                        fs.existsSync(path.join(repoPath, 'build.gradle.kts'));

      let command: string;
      if (hasMaven) {
        command = 'mvn test-compile org.pitest:pitest-maven:mutationCoverage';
      } else if (hasGradle) {
        command = './gradlew pitest';
      } else {
        throw new Error('Could not detect Maven or Gradle build tool');
      }

      // Run PITest
      execSync(command, {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 600000,  // 10 minutes
      });

      // Parse PITest results
      const result = this.parsePitestOutput(repoPath);
      result.duration = Date.now() - startTime;
      result.passed = result.mutationScore >= (config.threshold || 80);
      result.timestamp = new Date().toISOString();

      return result;
    } catch (error: any) {
      throw new Error(`PITest mutation testing failed: ${error.message}`);
    }
  }

  /**
   * Generate Stryker configuration
   */
  private generateStrykerConfig(repoPath: string, config: MutationConfig): void {
    const strykerConfig = {
      "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
      "packageManager": "npm",
      "reporters": ["html", "clear-text", "progress", "json"],
      "testRunner": "jest",
      "coverageAnalysis": "perTest",
      "mutate": config.files || [
        "src/**/*.ts",
        "src/**/*.js",
        "!src/**/*.spec.ts",
        "!src/**/*.test.ts"
      ],
      "thresholds": {
        "high": config.threshold || 80,
        "low": 60,
        "break": null
      },
      "timeoutMS": config.timeout || 5000,
      "mutator": {
        "plugins": config.mutators || ["typescript"]
      }
    };

    const configPath = path.join(repoPath, 'stryker.conf.json');
    fs.writeFileSync(configPath, JSON.stringify(strykerConfig, null, 2));
  }

  /**
   * Parse Stryker output
   */
  private parseStrykerOutput(repoPath: string, output: string): MutationResult {
    // Try to read JSON report
    const reportPath = path.join(repoPath, 'reports', 'mutation', 'mutation.json');

    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

      const mutants: Mutant[] = [];
      for (const file of Object.values(report.files) as any[]) {
        for (const mutant of file.mutants) {
          mutants.push({
            id: mutant.id,
            status: mutant.status,
            mutatorName: mutant.mutatorName,
            file: file.source,
            line: mutant.location.start.line,
            description: mutant.description || `${mutant.mutatorName} mutator`,
            replacement: mutant.replacement,
            killedBy: mutant.killedBy,
          });
        }
      }

      return {
        mutationScore: report.mutationScore || 0,
        totalMutants: mutants.length,
        killedMutants: mutants.filter(m => m.status === 'killed').length,
        survivedMutants: mutants.filter(m => m.status === 'survived').length,
        noCoverageMutants: mutants.filter(m => m.status === 'no-coverage').length,
        timeoutMutants: mutants.filter(m => m.status === 'timeout').length,
        framework: 'stryker',
        duration: 0,
        passed: false,
        mutants,
        timestamp: new Date().toISOString(),
      };
    }

    // Fallback: parse text output
    const lines = output.split('\n');
    let mutationScore = 0;
    let killed = 0;
    let survived = 0;
    let noCoverage = 0;
    let timeout = 0;

    for (const line of lines) {
      if (line.includes('Mutation score')) {
        const match = line.match(/([0-9.]+)%/);
        if (match) {
          mutationScore = parseFloat(match[1]);
        }
      }
      if (line.includes('Killed:')) {
        const match = line.match(/Killed:\s*(\d+)/);
        if (match) killed = parseInt(match[1]);
      }
      if (line.includes('Survived:')) {
        const match = line.match(/Survived:\s*(\d+)/);
        if (match) survived = parseInt(match[1]);
      }
      if (line.includes('No coverage:')) {
        const match = line.match(/No coverage:\s*(\d+)/);
        if (match) noCoverage = parseInt(match[1]);
      }
      if (line.includes('Timeout:')) {
        const match = line.match(/Timeout:\s*(\d+)/);
        if (match) timeout = parseInt(match[1]);
      }
    }

    const total = killed + survived + noCoverage + timeout;

    return {
      mutationScore,
      totalMutants: total,
      killedMutants: killed,
      survivedMutants: survived,
      noCoverageMutants: noCoverage,
      timeoutMutants: timeout,
      framework: 'stryker',
      duration: 0,
      passed: false,
      mutants: [],
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Parse mutmut output
   */
  private parseMutmutOutput(repoPath: string, output: string): MutationResult {
    const lines = output.split('\n');

    let killed = 0;
    let survived = 0;
    let suspicious = 0;
    let timeout = 0;

    for (const line of lines) {
      if (line.includes('Killed mutants:')) {
        const match = line.match(/(\d+)/);
        if (match) killed = parseInt(match[1]);
      }
      if (line.includes('Survived mutants:')) {
        const match = line.match(/(\d+)/);
        if (match) survived = parseInt(match[1]);
      }
      if (line.includes('Suspicious mutants:')) {
        const match = line.match(/(\d+)/);
        if (match) suspicious = parseInt(match[1]);
      }
      if (line.includes('Timeout mutants:')) {
        const match = line.match(/(\d+)/);
        if (match) timeout = parseInt(match[1]);
      }
    }

    const total = killed + survived + suspicious + timeout;
    const mutationScore = total > 0 ? (killed / total) * 100 : 0;

    // Get detailed mutant information
    const mutants: Mutant[] = [];
    try {
      const showOutput = execSync('mutmut show', {
        cwd: repoPath,
        encoding: 'utf-8',
      });

      // Parse individual mutants (simplified)
      // mutmut show output is complex, this is a basic parser
      const mutantBlocks = showOutput.split('\n\n');
      for (const block of mutantBlocks) {
        if (block.includes('Mutant')) {
          const lines = block.split('\n');
          const idMatch = lines[0]?.match(/Mutant (\d+)/);
          const fileMatch = block.match(/File: (.+)/);
          const lineMatch = block.match(/Line: (\d+)/);

          if (idMatch) {
            mutants.push({
              id: idMatch[1],
              status: 'survived',  // Would need more parsing to determine
              mutatorName: 'mutmut',
              file: fileMatch?.[1] || 'unknown',
              line: lineMatch ? parseInt(lineMatch[1]) : 0,
              description: 'Mutation detected',
            });
          }
        }
      }
    } catch {
      // Failed to get detailed mutants
    }

    return {
      mutationScore,
      totalMutants: total,
      killedMutants: killed,
      survivedMutants: survived,
      noCoverageMutants: suspicious,
      timeoutMutants: timeout,
      framework: 'mutmut',
      duration: 0,
      passed: false,
      mutants,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Parse PITest output
   */
  private parsePitestOutput(repoPath: string): MutationResult {
    // PITest generates reports in target/pit-reports/
    const reportDir = path.join(repoPath, 'target', 'pit-reports');

    if (!fs.existsSync(reportDir)) {
      throw new Error('PITest report directory not found');
    }

    // Find latest report directory
    const reportDirs = fs.readdirSync(reportDir).filter(d => {
      return fs.statSync(path.join(reportDir, d)).isDirectory();
    }).sort().reverse();

    if (reportDirs.length === 0) {
      throw new Error('No PITest reports found');
    }

    const latestReport = reportDirs[0];
    const mutationsFile = path.join(reportDir, latestReport, 'mutations.xml');

    if (!fs.existsSync(mutationsFile)) {
      throw new Error('PITest mutations.xml not found');
    }

    // Parse XML (simplified - would need xml2js in production)
    const xml = fs.readFileSync(mutationsFile, 'utf-8');

    // Extract metrics from XML
    const killedMatch = xml.match(/<mutation detected='true'[^>]*>/g);
    const survivedMatch = xml.match(/<mutation detected='false'[^>]*>/g);
    const noCoverageMatch = xml.match(/<mutation status='NO_COVERAGE'[^>]*>/g);
    const timeoutMatch = xml.match(/<mutation status='TIMED_OUT'[^>]*>/g);

    const killed = killedMatch?.length || 0;
    const survived = survivedMatch?.length || 0;
    const noCoverage = noCoverageMatch?.length || 0;
    const timeout = timeoutMatch?.length || 0;

    const total = killed + survived + noCoverage + timeout;
    const mutationScore = total > 0 ? (killed / total) * 100 : 0;

    return {
      mutationScore,
      totalMutants: total,
      killedMutants: killed,
      survivedMutants: survived,
      noCoverageMutants: noCoverage,
      timeoutMutants: timeout,
      framework: 'pitest',
      duration: 0,
      passed: false,
      mutants: [],
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Detect mutation testing framework
   */
  private detectFramework(repoPath: string): 'stryker' | 'mutmut' | 'pitest' | null {
    // Check for Stryker (JS/TS)
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (packageJson.devDependencies?.['@stryker-mutator/core']) {
        return 'stryker';
      }
    }

    // Check for mutmut (Python)
    const requirementsPath = path.join(repoPath, 'requirements.txt');
    if (fs.existsSync(requirementsPath)) {
      const requirements = fs.readFileSync(requirementsPath, 'utf-8');
      if (requirements.includes('mutmut')) {
        return 'mutmut';
      }
    }

    // Check for PITest (Java)
    const pomPath = path.join(repoPath, 'pom.xml');
    if (fs.existsSync(pomPath)) {
      const pom = fs.readFileSync(pomPath, 'utf-8');
      if (pom.includes('pitest-maven')) {
        return 'pitest';
      }
    }

    const gradlePath = path.join(repoPath, 'build.gradle');
    if (fs.existsSync(gradlePath)) {
      const gradle = fs.readFileSync(gradlePath, 'utf-8');
      if (gradle.includes('pitest')) {
        return 'pitest';
      }
    }

    // Default to stryker if package.json exists (can be installed)
    if (fs.existsSync(packageJsonPath)) {
      return 'stryker';
    }

    return null;
  }

  /**
   * Check if framework is available
   */
  private isFrameworkAvailable(framework: 'stryker' | 'mutmut' | 'pitest'): boolean {
    try {
      switch (framework) {
        case 'stryker':
          execSync('npx stryker --version', { stdio: 'ignore' });
          return true;
        case 'mutmut':
          execSync('mutmut --version', { stdio: 'ignore' });
          return true;
        case 'pitest':
          // PITest is a Maven/Gradle plugin, check if build tool exists
          try {
            execSync('mvn --version', { stdio: 'ignore' });
            return true;
          } catch {
            execSync('./gradlew --version', { stdio: 'ignore' });
            return true;
          }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Get recommended threshold based on project maturity
   */
  getRecommendedThreshold(hasExistingTests: boolean, coveragePercent: number): number {
    if (!hasExistingTests || coveragePercent < 50) {
      return 60;  // Low threshold for new projects
    } else if (coveragePercent >= 80) {
      return 80;  // High threshold for mature projects
    } else {
      return 70;  // Medium threshold
    }
  }

  /**
   * Generate mutation testing recommendations
   */
  generateRecommendations(result: MutationResult): string[] {
    const recommendations: string[] = [];

    if (result.mutationScore < 60) {
      recommendations.push('Critical: Mutation score is very low. Add more comprehensive tests.');
      recommendations.push('Focus on testing edge cases and boundary conditions.');
    } else if (result.mutationScore < 80) {
      recommendations.push('Improve test quality to reach 80% mutation score.');
      recommendations.push('Review survived mutants and add tests to kill them.');
    } else {
      recommendations.push('Good mutation score! Maintain this quality in future changes.');
    }

    if (result.noCoverageMutants > 0) {
      recommendations.push(`${result.noCoverageMutants} mutants have no test coverage. Increase code coverage first.`);
    }

    if (result.timeoutMutants > 0) {
      recommendations.push(`${result.timeoutMutants} mutants caused timeouts. Optimize slow tests.`);
    }

    if (result.survivedMutants > 5) {
      recommendations.push(`${result.survivedMutants} mutants survived. Review and add assertions to kill them.`);
    }

    return recommendations;
  }
}

export const mutationTester = new MutationTester();
