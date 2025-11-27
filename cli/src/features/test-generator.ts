import * as fs from 'fs';
import * as path from 'path';
import { AIProvider } from '../providers/base';
import { ASTParser, ParsedFunction, ParsedClass } from '../core/ast-parser';
import { ContextBuilder } from '../core/context-builder';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';

/**
 * Test framework type
 */
export type TestFramework = 'jest' | 'mocha' | 'vitest' | 'pytest' | 'junit' | 'auto';

/**
 * Generated test result
 */
export interface GeneratedTest {
  targetName: string;
  targetType: 'function' | 'class';
  framework: TestFramework;
  testCode: string;
  testPath: string;
  imports: string[];
  coverage: {
    estimated: number;  // Estimated coverage percentage
    scenarios: number;  // Number of test scenarios
  };
  valid: boolean;
  errors?: string[];
}

/**
 * Test generation options
 */
export interface TestGenerationOptions {
  framework?: TestFramework;
  outputDir?: string;
  coverageTarget?: number;
  includeMocks?: boolean;
  includeEdgeCases?: boolean;
  includeErrorHandling?: boolean;
}

/**
 * Dependency information for mocking
 */
interface Dependency {
  name: string;
  type: string;
  source: string;
  needsMock: boolean;
}

/**
 * Test Generator
 *
 * Generates unit tests for functions and classes using AI.
 */
export class TestGenerator {
  private provider: AIProvider;
  private parser: ASTParser;
  private contextBuilder: ContextBuilder;
  private indexer: CodebaseIndexer;
  private cache: AICache;
  private repoRoot: string;

  constructor(
    provider: AIProvider,
    indexer: CodebaseIndexer,
    cache: AICache,
    repoRoot: string
  ) {
    // Validate TypeScript is available before creating ASTParser
    const { ensureTypeScript } = require("../utils/dependency-checker");
    ensureTypeScript();
    
    this.provider = provider;
    this.parser = new ASTParser();
    this.contextBuilder = new ContextBuilder(indexer, repoRoot, provider);
    this.indexer = indexer;
    this.cache = cache;
    this.repoRoot = repoRoot;
  }

  /**
   * Generate tests for a function
   */
  async generateTestsForFunction(
    functionName: string,
    options: TestGenerationOptions = {}
  ): Promise<GeneratedTest> {
    // Find function
    const functions = await this.indexer.searchFunctions(functionName);
    if (functions.length === 0) {
      throw new Error(`Function "${functionName}" not found`);
    }

    const func = functions[0];

    // Detect test framework
    const framework = options.framework === 'auto' || !options.framework
      ? await this.detectTestFramework()
      : options.framework;

    // Check cache
    const cacheKey = `test:${func.file}:${func.name}:${framework}`;
    const cached = await this.cache.get(cacheKey, this.provider.getName(), [func.file]);

    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache, continue
      }
    }

    // Analyze function
    const dependencies = await this.analyzeDependencies(func);

    // Build context
    const context = await this.contextBuilder.buildFunctionContext(func.name, {
      maxTokens: 4000,
      includeDependencies: true,
      includeTests: true, // Get example tests for style
      provider: this.provider,
    });

    // Get existing test examples for style consistency
    const exampleTests = await this.getExampleTests(framework, func.file);

    // Generate tests
    const testCode = await this.generateTestCode(
      func,
      dependencies,
      framework,
      exampleTests,
      options
    );

    // Determine test path
    const testPath = this.getTestPath(func.file, framework);

    // Validate generated tests
    const validation = await this.validateTestCode(testCode, framework);

    const result: GeneratedTest = {
      targetName: func.name,
      targetType: 'function',
      framework,
      testCode,
      testPath,
      imports: this.extractImports(testCode),
      coverage: {
        estimated: this.estimateCoverage(testCode, func),
        scenarios: this.countTestScenarios(testCode),
      },
      valid: validation.valid,
      errors: validation.errors,
    };

    // Cache result
    await this.cache.set(cacheKey, this.provider.getName(), JSON.stringify(result), [func.file]);

    return result;
  }

  /**
   * Generate tests for a class
   */
  async generateTestsForClass(
    className: string,
    options: TestGenerationOptions = {}
  ): Promise<GeneratedTest> {
    // Find class
    const classes = await this.indexer.searchClasses(className);
    if (classes.length === 0) {
      throw new Error(`Class "${className}" not found`);
    }

    const cls = classes[0];

    // Detect test framework
    const framework = options.framework === 'auto' || !options.framework
      ? await this.detectTestFramework()
      : options.framework;

    // Check cache
    const cacheKey = `test:${cls.file}:${cls.name}:${framework}`;
    const cached = await this.cache.get(cacheKey, this.provider.getName(), [cls.file]);

    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache, continue
      }
    }

    // Get existing test examples
    const exampleTests = await this.getExampleTests(framework, cls.file);

    // Generate tests
    const testCode = await this.generateClassTestCode(
      cls,
      framework,
      exampleTests,
      options
    );

    // Determine test path
    const testPath = this.getTestPath(cls.file, framework);

    // Validate generated tests
    const validation = await this.validateTestCode(testCode, framework);

    const result: GeneratedTest = {
      targetName: cls.name,
      targetType: 'class',
      framework,
      testCode,
      testPath,
      imports: this.extractImports(testCode),
      coverage: {
        estimated: this.estimateClassCoverage(testCode, cls),
        scenarios: this.countTestScenarios(testCode),
      },
      valid: validation.valid,
      errors: validation.errors,
    };

    // Cache result
    await this.cache.set(cacheKey, this.provider.getName(), JSON.stringify(result), [cls.file]);

    return result;
  }

  /**
   * Detect test framework from project
   */
  private async detectTestFramework(): Promise<TestFramework> {
    // Check package.json
    const packageJsonPath = path.join(this.repoRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

        if (deps.jest) return 'jest';
        if (deps.vitest) return 'vitest';
        if (deps.mocha) return 'mocha';
      } catch {
        // Continue
      }
    }

    // Check for Python
    const reqPath = path.join(this.repoRoot, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      const content = fs.readFileSync(reqPath, 'utf-8');
      if (content.includes('pytest')) return 'pytest';
    }

    // Check for existing test files
    const testFiles = this.findTestFiles();
    if (testFiles.length > 0) {
      const firstTest = fs.readFileSync(testFiles[0], 'utf-8');
      if (firstTest.includes('describe(') && firstTest.includes('it(')) {
        return firstTest.includes('vitest') ? 'vitest' : 'jest';
      }
      if (firstTest.includes('def test_')) return 'pytest';
    }

    // Default to jest for JS/TS projects
    return 'jest';
  }

  /**
   * Analyze function dependencies
   */
  private async analyzeDependencies(func: ParsedFunction): Promise<Dependency[]> {
    const dependencies: Dependency[] = [];

    for (const depName of func.dependencies) {
      // Check if it's an external module or internal function
      const isExternal = !depName.startsWith('./') && !depName.startsWith('../');

      dependencies.push({
        name: depName,
        type: 'unknown',
        source: isExternal ? 'external' : 'internal',
        needsMock: isExternal || this.hasSideEffects(depName),
      });
    }

    return dependencies;
  }

  /**
   * Check if dependency has side effects
   */
  private hasSideEffects(name: string): boolean {
    const sideEffectKeywords = ['fetch', 'axios', 'http', 'db', 'database', 'api', 'request'];
    return sideEffectKeywords.some(keyword => name.toLowerCase().includes(keyword));
  }

  /**
   * Generate test code for a function
   */
  private async generateTestCode(
    func: ParsedFunction,
    dependencies: Dependency[],
    framework: TestFramework,
    exampleTests: string,
    options: TestGenerationOptions
  ): Promise<string> {
    const prompt = this.buildTestPrompt(func, dependencies, framework, exampleTests, options);

    const messages = [
      {
        role: 'system' as const,
        content: `You are an expert test engineer. Generate comprehensive, high-quality unit tests.

Guidelines:
- Follow ${framework} best practices
- Write clear, descriptive test names
- Test happy path, edge cases, and error handling
- Mock external dependencies
- Use appropriate assertions
- Include setup and teardown when needed

Respond ONLY with the complete test code. No explanations or markdown.`,
      },
      {
        role: 'user' as const,
        content: prompt,
      },
    ];

    const response = await this.provider.chat(messages, {
      temperature: 0.4,
      maxTokens: 3000,
    });

    // Clean up response (remove markdown if present)
    let testCode = response.content.trim();
    const codeBlockMatch = testCode.match(/```(?:typescript|javascript|python)?\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      testCode = codeBlockMatch[1];
    }

    return testCode;
  }

  /**
   * Generate test code for a class
   */
  private async generateClassTestCode(
    cls: ParsedClass,
    framework: TestFramework,
    exampleTests: string,
    options: TestGenerationOptions
  ): Promise<string> {
    const prompt = this.buildClassTestPrompt(cls, framework, exampleTests, options);

    const messages = [
      {
        role: 'system' as const,
        content: `You are an expert test engineer. Generate comprehensive, high-quality unit tests for classes.

Guidelines:
- Test all public methods
- Test class instantiation
- Test state management
- Test inheritance if applicable
- Mock dependencies
- Follow ${framework} conventions

Respond ONLY with the complete test code. No explanations or markdown.`,
      },
      {
        role: 'user' as const,
        content: prompt,
      },
    ];

    const response = await this.provider.chat(messages, {
      temperature: 0.4,
      maxTokens: 4000,
    });

    // Clean up response
    let testCode = response.content.trim();
    const codeBlockMatch = testCode.match(/```(?:typescript|javascript|python)?\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      testCode = codeBlockMatch[1];
    }

    return testCode;
  }

  /**
   * Build test prompt for function
   */
  private buildTestPrompt(
    func: ParsedFunction,
    dependencies: Dependency[],
    framework: TestFramework,
    exampleTests: string,
    options: TestGenerationOptions
  ): string {
    let prompt = `# Generate Unit Tests\n\n`;
    prompt += `**Framework:** ${framework}\n`;
    prompt += `**Function:** ${func.name}\n`;
    prompt += `**File:** ${func.file}\n\n`;

    prompt += `## Function Signature\n\`\`\`typescript\n`;
    prompt += `${func.isAsync ? 'async ' : ''}function ${func.name}(`;
    prompt += func.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
    prompt += `): ${func.returnType}\n\`\`\`\n\n`;

    prompt += `## Function Implementation\n\`\`\`typescript\n${func.body}\n\`\`\`\n\n`;

    if (dependencies.length > 0) {
      prompt += `## Dependencies\n`;
      dependencies.forEach(dep => {
        prompt += `- ${dep.name} (${dep.source})${dep.needsMock ? ' - NEEDS MOCK' : ''}\n`;
      });
      prompt += '\n';
    }

    if (exampleTests) {
      prompt += `## Example Test Style\n\`\`\`\n${exampleTests.slice(0, 1000)}\n\`\`\`\n\n`;
    }

    prompt += `## Requirements\n`;
    prompt += `1. Test happy path\n`;
    if (options.includeEdgeCases !== false) {
      prompt += `2. Test edge cases (null, undefined, empty, large values)\n`;
    }
    if (options.includeErrorHandling !== false) {
      prompt += `3. Test error handling\n`;
    }
    if (options.includeMocks !== false && dependencies.some(d => d.needsMock)) {
      prompt += `4. Mock dependencies that need mocking\n`;
    }
    prompt += `5. Use descriptive test names\n`;
    if (options.coverageTarget) {
      prompt += `6. Aim for ${options.coverageTarget}% code coverage\n`;
    }

    prompt += `\nGenerate the complete test file.`;

    return prompt;
  }

  /**
   * Build test prompt for class
   */
  private buildClassTestPrompt(
    cls: ParsedClass,
    framework: TestFramework,
    exampleTests: string,
    options: TestGenerationOptions
  ): string {
    let prompt = `# Generate Unit Tests for Class\n\n`;
    prompt += `**Framework:** ${framework}\n`;
    prompt += `**Class:** ${cls.name}\n`;
    prompt += `**File:** ${cls.file}\n\n`;

    prompt += `## Class Structure\n`;
    if (cls.extends && cls.extends.length > 0) {
      prompt += `**Extends:** ${cls.extends.join(', ')}\n`;
    }
    if (cls.implements && cls.implements.length > 0) {
      prompt += `**Implements:** ${cls.implements.join(', ')}\n`;
    }

    prompt += `\n### Properties\n`;
    cls.properties.forEach(prop => {
      prompt += `- ${prop.name}: ${prop.type}\n`;
    });

    prompt += `\n### Methods (${cls.methods.length})\n`;
    cls.methods.forEach(method => {
      prompt += `- ${method.name}(`;
      prompt += method.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
      prompt += `): ${method.returnType}\n`;
    });

    if (exampleTests) {
      prompt += `\n## Example Test Style\n\`\`\`\n${exampleTests.slice(0, 1000)}\n\`\`\`\n\n`;
    }

    prompt += `\n## Requirements\n`;
    prompt += `1. Test class instantiation\n`;
    prompt += `2. Test all public methods\n`;
    prompt += `3. Test state management\n`;
    prompt += `4. Test edge cases and error handling\n`;
    prompt += `5. Mock dependencies\n`;
    if (options.coverageTarget) {
      prompt += `6. Aim for ${options.coverageTarget}% coverage\n`;
    }

    prompt += `\nGenerate the complete test file.`;

    return prompt;
  }

  /**
   * Get example tests for style consistency
   */
  private async getExampleTests(framework: TestFramework, targetFile: string): Promise<string> {
    // Find test files
    const testFiles = this.findTestFiles();

    if (testFiles.length === 0) {
      return this.getDefaultTestTemplate(framework);
    }

    // Find a test file close to the target file
    const targetDir = path.dirname(targetFile);
    const closeTest = testFiles.find(tf => path.dirname(tf) === targetDir);

    const exampleFile = closeTest || testFiles[0];

    try {
      const content = fs.readFileSync(exampleFile, 'utf-8');
      // Return first test block as example
      const match = content.match(/describe\([^{]+\{[\s\S]{0,800}\}\)/);
      return match ? match[0] : content.slice(0, 500);
    } catch {
      return this.getDefaultTestTemplate(framework);
    }
  }

  /**
   * Get default test template
   */
  private getDefaultTestTemplate(framework: TestFramework): string {
    if (framework === 'jest' || framework === 'vitest') {
      return `describe('ExampleFunction', () => {
  it('should handle valid input', () => {
    expect(exampleFunction(validInput)).toBe(expectedOutput);
  });

  it('should handle edge cases', () => {
    expect(exampleFunction(null)).toBe(null);
  });
});`;
    } else if (framework === 'pytest') {
      return `def test_example_function_valid_input():
    assert example_function(valid_input) == expected_output

def test_example_function_edge_cases():
    assert example_function(None) is None`;
    }

    return '';
  }

  /**
   * Find test files in repository
   */
  private findTestFiles(): string[] {
    const testFiles: string[] = [];
    const testPatterns = ['.test.', '.spec.', '_test.', 'test_'];

    const walk = (dir: string): void => {
      try {
        const files = fs.readdirSync(dir, { withFileTypes: true });

        for (const file of files) {
          const fullPath = path.join(dir, file.name);

          if (file.isDirectory()) {
            if (!['node_modules', '.git', 'dist', 'build'].includes(file.name)) {
              walk(fullPath);
            }
          } else if (file.isFile()) {
            if (testPatterns.some(pattern => file.name.includes(pattern))) {
              testFiles.push(fullPath);
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    walk(this.repoRoot);
    return testFiles.slice(0, 10); // Limit to first 10
  }

  /**
   * Get test path for a source file
   */
  private getTestPath(sourceFile: string, framework: TestFramework): string {
    const relativePath = path.relative(this.repoRoot, sourceFile);
    const dir = path.dirname(relativePath);
    const basename = path.basename(sourceFile, path.extname(sourceFile));

    const extension = framework === 'pytest' ? '.py' : path.extname(sourceFile);
    const testSuffix = framework === 'pytest' ? 'test_' : '.test';

    // Try __tests__ directory first
    const testsDir = path.join(this.repoRoot, dir, '__tests__');
    if (fs.existsSync(testsDir)) {
      return path.join(testsDir, `${basename}${testSuffix}${extension}`);
    }

    // Same directory
    if (framework === 'pytest') {
      return path.join(this.repoRoot, dir, `${testSuffix}${basename}${extension}`);
    } else {
      return path.join(this.repoRoot, dir, `${basename}${testSuffix}${extension}`);
    }
  }

  /**
   * Extract imports from test code
   */
  private extractImports(testCode: string): string[] {
    const imports: string[] = [];
    const lines = testCode.split('\n');

    for (const line of lines) {
      if (line.trim().startsWith('import ') || line.trim().startsWith('from ')) {
        imports.push(line.trim());
      }
    }

    return imports;
  }

  /**
   * Estimate coverage percentage
   */
  private estimateCoverage(testCode: string, func: ParsedFunction): number {
    const testScenarios = this.countTestScenarios(testCode);
    const complexity = func.complexity;

    // Rough estimate: more scenarios relative to complexity = higher coverage
    const ratio = testScenarios / Math.max(complexity, 1);

    if (ratio >= 2) return 90;
    if (ratio >= 1.5) return 80;
    if (ratio >= 1) return 70;
    if (ratio >= 0.5) return 60;
    return 50;
  }

  /**
   * Estimate coverage for class
   */
  private estimateClassCoverage(testCode: string, cls: ParsedClass): number {
    const testScenarios = this.countTestScenarios(testCode);
    const methodCount = cls.methods.length;

    const ratio = testScenarios / Math.max(methodCount, 1);

    if (ratio >= 3) return 85;
    if (ratio >= 2) return 75;
    if (ratio >= 1) return 65;
    return 50;
  }

  /**
   * Count test scenarios in test code
   */
  private countTestScenarios(testCode: string): number {
    // Count test cases
    const itMatches = testCode.match(/it\(|test\(/g);
    const defTestMatches = testCode.match(/def test_/g);

    return (itMatches?.length || 0) + (defTestMatches?.length || 0);
  }

  /**
   * Validate test code
   */
  private async validateTestCode(testCode: string, framework: TestFramework): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];

    // Basic syntax validation
    try {
      await this.parser.parseFile(testCode);
    } catch (error: any) {
      errors.push(`Syntax error: ${error.message}`);
      return { valid: false, errors };
    }

    // Framework-specific validation
    if (framework === 'jest' || framework === 'vitest') {
      if (!testCode.includes('describe(') && !testCode.includes('it(')) {
        errors.push('Missing test structure (describe/it blocks)');
      }
      if (!testCode.includes('expect(')) {
        errors.push('Missing assertions (expect statements)');
      }
    } else if (framework === 'pytest') {
      if (!testCode.includes('def test_')) {
        errors.push('Missing test functions (def test_*)');
      }
      if (!testCode.includes('assert ')) {
        errors.push('Missing assertions');
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }
}
