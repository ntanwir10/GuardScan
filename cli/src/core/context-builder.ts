import * as fs from 'fs';
import * as path from 'path';
import { CodebaseIndexer, Symbol } from './codebase-indexer';
import { ASTParser, ParsedFunction, ParsedClass } from './ast-parser';
import { AIProvider } from '../providers/base';

/**
 * Context building options
 */
export interface ContextBuildingOptions {
  maxTokens: number;
  includeImports?: boolean;
  includeDependencies?: boolean;
  includeTests?: boolean;
  includeDocs?: boolean;
  provider?: AIProvider;  // For accurate token counting
}

/**
 * Context section with priority
 */
interface ContextSection {
  id: string;
  content: string;
  priority: number;      // 0-1, higher = more important
  idealTokens: number;   // Ideal token allocation
  minTokens: number;     // Minimum tokens needed
}

/**
 * Token budget tracking
 */
interface TokenBudget {
  total: number;
  used: number;
  remaining: number;
}

/**
 * Built context result
 */
export interface BuiltContext {
  content: string;
  tokens: number;
  sections: {
    primary: number;      // Tokens
    dependencies: number;
    types: number;
    tests: number;
    docs: number;
  };
  files: string[];  // Files included in context
}

/**
 * Context Builder
 *
 * Builds relevant context for AI prompts while staying within token limits.
 */
export class ContextBuilder {
  private indexer: CodebaseIndexer;
  private parser: ASTParser;
  private repoRoot: string;
  private provider?: AIProvider;

  constructor(
    indexer: CodebaseIndexer,
    repoRoot: string,
    provider?: AIProvider
  ) {
    this.indexer = indexer;
    this.parser = new ASTParser();
    this.repoRoot = repoRoot;
    this.provider = provider;
  }

  /**
   * Build context for a target file
   */
  async buildContext(
    targetFile: string,
    options: ContextBuildingOptions
  ): Promise<BuiltContext> {
    const sections: ContextSection[] = [];
    const filesIncluded: Set<string> = new Set();

    // 1. Primary: Target file (100% priority)
    const primaryContent = await this.readFile(targetFile);
    if (primaryContent) {
      sections.push({
        id: 'primary',
        content: this.formatFileSection(targetFile, primaryContent),
        priority: 1.0,
        idealTokens: this.estimateTokens(primaryContent),
        minTokens: Math.min(this.estimateTokens(primaryContent), options.maxTokens * 0.5),
      });
      filesIncluded.add(targetFile);
    }

    // 2. Secondary: Direct dependencies (80% priority)
    if (options.includeDependencies !== false) {
      const deps = await this.getFileDependencies(targetFile);
      for (const dep of deps.slice(0, 5)) {  // Limit to top 5
        const depContent = await this.readFile(dep);
        if (depContent) {
          sections.push({
            id: `dep:${dep}`,
            content: this.formatFileSection(dep, depContent),
            priority: 0.8,
            idealTokens: this.estimateTokens(depContent),
            minTokens: 0,
          });
          filesIncluded.add(dep);
        }
      }
    }

    // 3. Tertiary: Type definitions (60% priority)
    if (options.includeImports !== false) {
      const types = await this.getTypeDefinitions(targetFile);
      for (const type of types.slice(0, 3)) {
        sections.push({
          id: `type:${type.name}`,
          content: this.formatTypeSection(type),
          priority: 0.6,
          idealTokens: this.estimateTokens(type.content),
          minTokens: 0,
        });
      }
    }

    // 4. Quaternary: Related tests (40% priority)
    if (options.includeTests) {
      const testFiles = await this.findRelatedTests(targetFile);
      for (const testFile of testFiles.slice(0, 2)) {
        const testContent = await this.readFile(testFile);
        if (testContent) {
          sections.push({
            id: `test:${testFile}`,
            content: this.formatFileSection(testFile, testContent),
            priority: 0.4,
            idealTokens: this.estimateTokens(testContent),
            minTokens: 0,
          });
          filesIncluded.add(testFile);
        }
      }
    }

    // 5. Quinary: Documentation (20% priority)
    if (options.includeDocs) {
      const docs = await this.findRelatedDocs(targetFile);
      for (const doc of docs.slice(0, 2)) {
        const docContent = await this.readFile(doc);
        if (docContent) {
          sections.push({
            id: `doc:${doc}`,
            content: this.formatFileSection(doc, docContent),
            priority: 0.2,
            idealTokens: this.estimateTokens(docContent),
            minTokens: 0,
          });
          filesIncluded.add(doc);
        }
      }
    }

    // Allocate token budget and build final context
    return this.buildFromSections(sections, options.maxTokens, Array.from(filesIncluded));
  }

  /**
   * Build context for a specific function
   */
  async buildFunctionContext(
    functionName: string,
    options: ContextBuildingOptions
  ): Promise<BuiltContext> {
    const sections: ContextSection[] = [];
    const filesIncluded: Set<string> = new Set();

    // Find the function
    const functions = await this.indexer.searchFunctions(functionName);
    if (functions.length === 0) {
      throw new Error(`Function "${functionName}" not found`);
    }

    const func = functions[0];
    filesIncluded.add(func.file);

    // 1. Primary: Function itself (100% priority)
    const functionContent = this.formatFunctionSection(func);
    sections.push({
      id: 'primary:function',
      content: functionContent,
      priority: 1.0,
      idealTokens: this.estimateTokens(functionContent),
      minTokens: this.estimateTokens(functionContent),
    });

    // 2. Secondary: Called functions (80% priority)
    if (options.includeDependencies !== false) {
      for (const depName of func.dependencies.slice(0, 5)) {
        const depFuncs = await this.indexer.searchFunctions(depName);
        if (depFuncs.length > 0) {
          const depFunc = depFuncs[0];
          const depContent = this.formatFunctionSection(depFunc);
          sections.push({
            id: `dep:${depName}`,
            content: depContent,
            priority: 0.8,
            idealTokens: this.estimateTokens(depContent),
            minTokens: 0,
          });
          filesIncluded.add(depFunc.file);
        }
      }
    }

    // 3. Tertiary: Containing class (if any) (60% priority)
    const containingClass = await this.getContainingClass(func);
    if (containingClass) {
      const classContent = this.formatClassSection(containingClass);
      sections.push({
        id: 'class:parent',
        content: classContent,
        priority: 0.6,
        idealTokens: this.estimateTokens(classContent),
        minTokens: 0,
      });
    }

    // 4. Quaternary: Test files (40% priority)
    if (options.includeTests) {
      const testFiles = await this.findRelatedTests(func.file);
      for (const testFile of testFiles.slice(0, 1)) {
        const testContent = await this.readFile(testFile);
        if (testContent) {
          // Try to find tests for this specific function
          const relevantTests = this.extractRelevantTests(testContent, functionName);
          sections.push({
            id: `test:${testFile}`,
            content: this.formatFileSection(testFile, relevantTests),
            priority: 0.4,
            idealTokens: this.estimateTokens(relevantTests),
            minTokens: 0,
          });
          filesIncluded.add(testFile);
        }
      }
    }

    return this.buildFromSections(sections, options.maxTokens, Array.from(filesIncluded));
  }

  /**
   * Build context around a theme/topic
   */
  async buildThemeContext(
    theme: string,
    options: ContextBuildingOptions
  ): Promise<BuiltContext> {
    const sections: ContextSection[] = [];
    const filesIncluded: Set<string> = new Set();

    // Search for relevant functions and classes
    const functions = await this.indexer.searchFunctions(theme);
    const classes = await this.indexer.searchClasses(theme);

    // Add top matching functions (100% priority for first, decreasing)
    for (let i = 0; i < Math.min(functions.length, 5); i++) {
      const func = functions[i];
      const content = this.formatFunctionSection(func);
      const priority = 1.0 - (i * 0.1);  // 1.0, 0.9, 0.8, 0.7, 0.6

      sections.push({
        id: `func:${func.name}`,
        content,
        priority,
        idealTokens: this.estimateTokens(content),
        minTokens: i === 0 ? this.estimateTokens(content) : 0,
      });
      filesIncluded.add(func.file);
    }

    // Add top matching classes (80% priority for first, decreasing)
    for (let i = 0; i < Math.min(classes.length, 3); i++) {
      const cls = classes[i];
      const content = this.formatClassSection(cls);
      const priority = 0.8 - (i * 0.1);  // 0.8, 0.7, 0.6

      sections.push({
        id: `class:${cls.name}`,
        content,
        priority,
        idealTokens: this.estimateTokens(content),
        minTokens: 0,
      });
      filesIncluded.add(cls.file);
    }

    // Add documentation if requested
    if (options.includeDocs) {
      const docs = await this.searchDocsForTheme(theme);
      for (const doc of docs.slice(0, 2)) {
        const docContent = await this.readFile(doc);
        if (docContent) {
          sections.push({
            id: `doc:${doc}`,
            content: this.formatFileSection(doc, docContent),
            priority: 0.3,
            idealTokens: this.estimateTokens(docContent),
            minTokens: 0,
          });
          filesIncluded.add(doc);
        }
      }
    }

    return this.buildFromSections(sections, options.maxTokens, Array.from(filesIncluded));
  }

  /**
   * Build final context from sections with budget allocation
   */
  private buildFromSections(
    sections: ContextSection[],
    maxTokens: number,
    files: string[]
  ): BuiltContext {
    // Sort sections by priority (highest first)
    sections.sort((a, b) => b.priority - a.priority);

    const budget: TokenBudget = {
      total: maxTokens,
      used: 0,
      remaining: maxTokens,
    };

    const included: ContextSection[] = [];
    const sectionTokens = {
      primary: 0,
      dependencies: 0,
      types: 0,
      tests: 0,
      docs: 0,
    };

    // First pass: Include minimum tokens for high-priority sections
    for (const section of sections) {
      if (section.minTokens > 0 && budget.remaining >= section.minTokens) {
        const tokens = section.minTokens;
        included.push(section);
        budget.used += tokens;
        budget.remaining -= tokens;

        // Track by category
        this.trackSectionTokens(section.id, tokens, sectionTokens);
      }
    }

    // Second pass: Allocate remaining budget by priority
    for (const section of sections) {
      if (section.minTokens === 0 || section.idealTokens > section.minTokens) {
        const alreadyIncluded = included.find(s => s.id === section.id);
        const additionalTokens = alreadyIncluded
          ? section.idealTokens - section.minTokens
          : section.idealTokens;

        if (budget.remaining >= additionalTokens) {
          if (!alreadyIncluded) {
            included.push(section);
          }

          budget.used += additionalTokens;
          budget.remaining -= additionalTokens;

          this.trackSectionTokens(section.id, additionalTokens, sectionTokens);
        } else if (budget.remaining > 0) {
          // Use whatever remaining budget we have
          if (!alreadyIncluded) {
            included.push(section);
          }

          this.trackSectionTokens(section.id, budget.remaining, sectionTokens);
          budget.used += budget.remaining;
          budget.remaining = 0;
          break;
        }
      }
    }

    // Build final context string
    let context = '';
    for (const section of included) {
      const tokens = this.estimateTokens(section.content);
      const truncated = this.truncateToFit(section.content, tokens);
      context += truncated + '\n\n';
    }

    return {
      content: context.trim(),
      tokens: budget.used,
      sections: sectionTokens,
      files,
    };
  }

  /**
   * Track tokens by section category
   */
  private trackSectionTokens(
    sectionId: string,
    tokens: number,
    tracker: BuiltContext['sections']
  ): void {
    if (sectionId.startsWith('primary')) {
      tracker.primary += tokens;
    } else if (sectionId.startsWith('dep')) {
      tracker.dependencies += tokens;
    } else if (sectionId.startsWith('type')) {
      tracker.types += tokens;
    } else if (sectionId.startsWith('test')) {
      tracker.tests += tokens;
    } else if (sectionId.startsWith('doc')) {
      tracker.docs += tokens;
    }
  }

  /**
   * Estimate tokens in text
   */
  private estimateTokens(text: string): number {
    if (this.provider) {
      return this.provider.countTokens(text);
    }

    // Default estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Truncate text to fit token limit
   */
  private truncateToFit(text: string, maxTokens: number): string {
    const currentTokens = this.estimateTokens(text);
    if (currentTokens <= maxTokens) {
      return text;
    }

    // Truncate proportionally
    const ratio = maxTokens / currentTokens;
    const targetLength = Math.floor(text.length * ratio);

    return text.slice(0, targetLength) + '\n... (truncated)';
  }

  /**
   * Read file content
   */
  private async readFile(filePath: string): Promise<string | null> {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.repoRoot, filePath);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    return fs.readFileSync(fullPath, 'utf-8');
  }

  /**
   * Format file section with header
   */
  private formatFileSection(filePath: string, content: string): string {
    const relativePath = path.relative(this.repoRoot, filePath);
    return `## File: ${relativePath}\n\n\`\`\`\n${content}\n\`\`\``;
  }

  /**
   * Format function section
   */
  private formatFunctionSection(func: ParsedFunction): string {
    const relativePath = path.relative(this.repoRoot, func.file);
    let output = `## Function: ${func.name} (${relativePath}:${func.line})\n\n`;

    if (func.documentation) {
      output += `**Documentation:**\n${func.documentation}\n\n`;
    }

    output += `**Signature:**\n\`\`\`typescript\n`;
    output += `${func.isAsync ? 'async ' : ''}function ${func.name}(`;
    output += func.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
    output += `): ${func.returnType}\n\`\`\`\n\n`;

    output += `**Implementation:**\n\`\`\`typescript\n${func.body}\n\`\`\`\n\n`;
    output += `**Complexity:** ${func.complexity}\n`;

    return output;
  }

  /**
   * Format class section
   */
  private formatClassSection(cls: ParsedClass): string {
    const relativePath = path.relative(this.repoRoot, cls.file);
    let output = `## Class: ${cls.name} (${relativePath}:${cls.line})\n\n`;

    if (cls.documentation) {
      output += `**Documentation:**\n${cls.documentation}\n\n`;
    }

    if (cls.extends && cls.extends.length > 0) {
      output += `**Extends:** ${cls.extends.join(', ')}\n\n`;
    }

    if (cls.implements && cls.implements.length > 0) {
      output += `**Implements:** ${cls.implements.join(', ')}\n\n`;
    }

    output += `**Properties:**\n`;
    for (const prop of cls.properties) {
      output += `- ${prop.name}: ${prop.type}\n`;
    }

    output += `\n**Methods:**\n`;
    for (const method of cls.methods) {
      output += `- ${method.name}(`;
      output += method.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
      output += `): ${method.returnType}\n`;
    }

    return output;
  }

  /**
   * Format type definition section
   */
  private formatTypeSection(type: { name: string; content: string }): string {
    return `## Type: ${type.name}\n\n\`\`\`typescript\n${type.content}\n\`\`\``;
  }

  /**
   * Get file dependencies
   */
  private async getFileDependencies(filePath: string): Promise<string[]> {
    const fileIndex = await this.indexer.getFileIndex(filePath);
    if (!fileIndex) return [];

    const deps: string[] = [];
    for (const importPath of fileIndex.imports) {
      // Resolve to actual file paths
      const resolved = this.resolveImport(importPath, filePath);
      if (resolved) {
        deps.push(resolved);
      }
    }

    return deps;
  }

  /**
   * Get type definitions used in file
   */
  private async getTypeDefinitions(filePath: string): Promise<Array<{ name: string; content: string }>> {
    // This would extract interface/type definitions
    // For now, return empty array
    return [];
  }

  /**
   * Find related test files
   */
  private async findRelatedTests(filePath: string): Promise<string[]> {
    const relativePath = path.relative(this.repoRoot, filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    const dirName = path.dirname(filePath);

    const testPatterns = [
      `${baseName}.test.ts`,
      `${baseName}.test.js`,
      `${baseName}.spec.ts`,
      `${baseName}.spec.js`,
    ];

    const testFiles: string[] = [];

    // Check same directory
    for (const pattern of testPatterns) {
      const testPath = path.join(dirName, pattern);
      if (fs.existsSync(testPath)) {
        testFiles.push(testPath);
      }
    }

    // Check __tests__ directory
    const testsDir = path.join(dirName, '__tests__');
    if (fs.existsSync(testsDir)) {
      for (const pattern of testPatterns) {
        const testPath = path.join(testsDir, pattern);
        if (fs.existsSync(testPath)) {
          testFiles.push(testPath);
        }
      }
    }

    return testFiles;
  }

  /**
   * Find related documentation files
   */
  private async findRelatedDocs(filePath: string): Promise<string[]> {
    const docs: string[] = [];

    // Check for README in same directory
    const dirName = path.dirname(filePath);
    const readmePath = path.join(dirName, 'README.md');
    if (fs.existsSync(readmePath)) {
      docs.push(readmePath);
    }

    return docs;
  }

  /**
   * Search documentation for theme
   */
  private async searchDocsForTheme(theme: string): Promise<string[]> {
    const docs: string[] = [];
    const docsDir = path.join(this.repoRoot, 'docs');

    if (fs.existsSync(docsDir)) {
      const files = fs.readdirSync(docsDir);
      for (const file of files) {
        if (file.toLowerCase().includes(theme.toLowerCase()) && file.endsWith('.md')) {
          docs.push(path.join(docsDir, file));
        }
      }
    }

    return docs;
  }

  /**
   * Get containing class for a function
   */
  private async getContainingClass(func: ParsedFunction): Promise<ParsedClass | null> {
    const parsed = await this.indexer.getParsedFile(func.file);
    if (!parsed) return null;

    for (const cls of parsed.classes) {
      if (cls.methods.some(m => m.name === func.name)) {
        return cls;
      }
    }

    return null;
  }

  /**
   * Extract relevant test code for a function
   */
  private extractRelevantTests(testContent: string, functionName: string): string {
    // Simple heuristic: extract test blocks that mention the function
    const lines = testContent.split('\n');
    const relevantLines: string[] = [];
    let inRelevantBlock = false;
    let braceCount = 0;

    for (const line of lines) {
      if (line.includes(functionName)) {
        inRelevantBlock = true;
      }

      if (inRelevantBlock) {
        relevantLines.push(line);

        // Track braces to know when block ends
        braceCount += (line.match(/{/g) || []).length;
        braceCount -= (line.match(/}/g) || []).length;

        if (braceCount === 0 && relevantLines.length > 1) {
          inRelevantBlock = false;
          relevantLines.push(''); // Add blank line between blocks
        }
      }
    }

    return relevantLines.length > 0 ? relevantLines.join('\n') : testContent;
  }

  /**
   * Resolve import path to actual file
   */
  private resolveImport(importPath: string, fromFile: string): string | null {
    if (!importPath.startsWith('.')) {
      // External module, skip
      return null;
    }

    const dir = path.dirname(fromFile);
    const resolved = path.resolve(dir, importPath);

    // Try common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
    for (const ext of extensions) {
      const fullPath = resolved + ext;
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    return null;
  }
}
