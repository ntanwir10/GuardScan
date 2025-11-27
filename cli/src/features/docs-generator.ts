import * as fs from 'fs';
import * as path from 'path';
import { AIProvider, AIMessage } from '../providers/base';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';
import { ASTParser, ParsedFile, ParsedFunction, ParsedClass } from '../core/ast-parser';

export type DocumentationType = 'readme' | 'api' | 'architecture' | 'contributing' | 'changelog';
export type DiagramType = 'architecture' | 'sequence' | 'class' | 'component' | 'flowchart';

export interface DocumentationOptions {
  type?: DocumentationType;
  includeExamples?: boolean;
  includeDiagrams?: boolean;
  diagramType?: DiagramType;
  targetAudience?: 'developer' | 'user' | 'contributor';
  format?: 'markdown' | 'html';
  outputPath?: string;
}

export interface GeneratedDocumentation {
  type: DocumentationType;
  content: string;
  diagrams?: GeneratedDiagram[];
  metadata: {
    generatedAt: Date;
    filesAnalyzed: number;
    sectionsIncluded: string[];
    targetAudience: string;
  };
  outputPath?: string;
}

export interface GeneratedDiagram {
  type: DiagramType;
  mermaidCode: string;
  description: string;
}

export interface APIDocEntry {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type';
  signature: string;
  description: string;
  parameters?: ParameterDoc[];
  returnType?: string;
  returnDescription?: string;
  examples?: string[];
  filePath: string;
  lineNumber: number;
}

export interface ParameterDoc {
  name: string;
  type: string;
  description: string;
  optional: boolean;
  defaultValue?: string;
}

/**
 * Documentation Generator - Phase 3 Feature
 *
 * Generates comprehensive documentation for codebases including:
 * - README files with project overview, setup, usage
 * - API documentation with function/class signatures
 * - Architecture diagrams (Mermaid)
 * - Contributing guidelines
 * - Changelog generation
 *
 * Uses AI to create high-quality, context-aware documentation.
 */
export class DocsGenerator {
  constructor(
    private provider: AIProvider,
    private indexer: CodebaseIndexer,
    private cache: AICache,
    private repoRoot: string
  ) {}

  /**
   * Generate README documentation
   */
  async generateReadme(options: DocumentationOptions = {}): Promise<GeneratedDocumentation> {
    const targetAudience = options.targetAudience || 'user';

    console.log('📚 Analyzing codebase structure...');

    // Get project overview
    const packageJsonPath = path.join(this.repoRoot, 'package.json');
    const projectInfo = this.extractProjectInfo(packageJsonPath);

    // Analyze codebase structure
    const structure = await this.analyzeCodebaseStructure();

    // Get key files
    const keyFiles = await this.identifyKeyFiles();

    // Build context for AI
    const context = this.buildReadmeContext(projectInfo, structure, keyFiles, targetAudience);

    // Generate README with AI
    console.log('🤖 Generating README with AI...');
    const content = await this.generateReadmeWithAI(context, options);

    // Generate diagrams if requested
    let diagrams: GeneratedDiagram[] | undefined;
    if (options.includeDiagrams) {
      diagrams = await this.generateDiagrams(['architecture'], structure);
    }

    const result: GeneratedDocumentation = {
      type: 'readme',
      content,
      diagrams,
      metadata: {
        generatedAt: new Date(),
        filesAnalyzed: keyFiles.length,
        sectionsIncluded: this.extractSections(content),
        targetAudience,
      },
    };

    return result;
  }

  /**
   * Generate API documentation
   */
  async generateAPIDocs(options: DocumentationOptions = {}): Promise<GeneratedDocumentation> {
    console.log('📚 Extracting API surface...');

    // Build index to get all source files
    const index = await this.indexer.buildIndex();

    // Parse and extract API entries
    const apiEntries: APIDocEntry[] = [];
    
    // Validate TypeScript is available before creating ASTParser
    const { ensureTypeScript } = require("../utils/dependency-checker");
    ensureTypeScript();
    
    const parser = new ASTParser();

    for (const [filePath, fileIndex] of index.files) {
      if (this.shouldDocumentFile(filePath)) {
        const parsed = await parser.parseFile(filePath);

        // Extract exported functions
        for (const func of parsed.functions.filter(f => f.isExported)) {
          apiEntries.push(this.createFunctionDoc(func, filePath));
        }

        // Extract exported classes
        for (const cls of parsed.classes.filter(c => c.isExported)) {
          apiEntries.push(this.createClassDoc(cls, filePath));
        }
      }
    }

    // Sort by type and name
    apiEntries.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.name.localeCompare(b.name);
    });

    console.log(`✓ Found ${apiEntries.length} API entries`);

    // Generate documentation content
    console.log('🤖 Generating API documentation...');
    const content = await this.generateAPIDocsContent(apiEntries, options);

    const result: GeneratedDocumentation = {
      type: 'api',
      content,
      metadata: {
        generatedAt: new Date(),
        filesAnalyzed: index.totalFiles,
        sectionsIncluded: [`${apiEntries.length} API entries`],
        targetAudience: options.targetAudience || 'developer',
      },
    };

    return result;
  }

  /**
   * Generate architecture documentation with diagrams
   */
  async generateArchitectureDocs(options: DocumentationOptions = {}): Promise<GeneratedDocumentation> {
    console.log('📚 Analyzing architecture...');

    // Analyze codebase structure
    const structure = await this.analyzeCodebaseStructure();

    // Identify architectural patterns
    const patterns = await this.identifyArchitecturalPatterns(structure);

    // Generate diagrams
    const diagramTypes: DiagramType[] = options.diagramType
      ? [options.diagramType]
      : ['architecture', 'component', 'class'];

    console.log('🤖 Generating architecture diagrams...');
    const diagrams = await this.generateDiagrams(diagramTypes, structure);

    // Generate architecture documentation
    console.log('🤖 Writing architecture documentation...');
    const content = await this.generateArchitectureContent(structure, patterns, diagrams, options);

    const result: GeneratedDocumentation = {
      type: 'architecture',
      content,
      diagrams,
      metadata: {
        generatedAt: new Date(),
        filesAnalyzed: structure.totalFiles,
        sectionsIncluded: ['Overview', 'Patterns', 'Components', 'Diagrams'],
        targetAudience: options.targetAudience || 'developer',
      },
    };

    return result;
  }

  /**
   * Generate CONTRIBUTING.md
   */
  async generateContributingGuide(options: DocumentationOptions = {}): Promise<GeneratedDocumentation> {
    console.log('📚 Generating contributing guide...');

    // Analyze project structure and conventions
    const conventions = await this.analyzeProjectConventions();
    const projectInfo = this.extractProjectInfo(path.join(this.repoRoot, 'package.json'));

    // Build context
    const context = {
      projectInfo,
      conventions,
      hasTests: conventions.testFramework !== null,
      hasLinter: conventions.linter !== null,
      hasCICD: this.hasCICDConfig(),
    };

    // Generate guide
    const content = await this.generateContributingContent(context, options);

    const result: GeneratedDocumentation = {
      type: 'contributing',
      content,
      metadata: {
        generatedAt: new Date(),
        filesAnalyzed: 0,
        sectionsIncluded: ['Setup', 'Development', 'Testing', 'Submission'],
        targetAudience: 'contributor',
      },
    };

    return result;
  }

  /**
   * Save documentation to file
   */
  async saveDocs(doc: GeneratedDocumentation, outputPath?: string): Promise<string> {
    const finalPath = outputPath || this.getDefaultOutputPath(doc.type);
    const fullPath = path.isAbsolute(finalPath) ? finalPath : path.join(this.repoRoot, finalPath);

    // Ensure directory exists
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write content
    fs.writeFileSync(fullPath, doc.content, 'utf-8');

    // Save diagrams separately if present
    if (doc.diagrams && doc.diagrams.length > 0) {
      const diagramsDir = path.join(dir, 'diagrams');
      if (!fs.existsSync(diagramsDir)) {
        fs.mkdirSync(diagramsDir, { recursive: true });
      }

      for (const diagram of doc.diagrams) {
        const diagramPath = path.join(diagramsDir, `${diagram.type}.mmd`);
        fs.writeFileSync(diagramPath, diagram.mermaidCode, 'utf-8');
      }
    }

    return fullPath;
  }

  // ========================================
  // Private Methods - Context Building
  // ========================================

  private buildReadmeContext(
    projectInfo: any,
    structure: any,
    keyFiles: string[],
    targetAudience: string
  ): string {
    let context = `Project: ${projectInfo.name}\n`;
    context += `Description: ${projectInfo.description || 'No description'}\n`;
    context += `Version: ${projectInfo.version || '1.0.0'}\n`;
    context += `Target Audience: ${targetAudience}\n\n`;

    context += `Technology Stack:\n`;
    if (projectInfo.dependencies) {
      const mainDeps = Object.keys(projectInfo.dependencies).slice(0, 10);
      context += mainDeps.map(dep => `- ${dep}`).join('\n');
    }

    context += `\n\nProject Structure:\n`;
    context += `- Total Files: ${structure.totalFiles}\n`;
    context += `- Directories: ${structure.directories.slice(0, 10).join(', ')}\n`;

    return context;
  }

  private extractProjectInfo(packageJsonPath: string): any {
    try {
      if (fs.existsSync(packageJsonPath)) {
        const content = fs.readFileSync(packageJsonPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      // Ignore parsing errors
    }

    return {
      name: path.basename(this.repoRoot),
      version: '1.0.0',
      description: '',
      dependencies: {},
    };
  }

  private async analyzeCodebaseStructure(): Promise<any> {
    const index = await this.indexer.buildIndex();

    const directories = new Set<string>();
    const filesByType: Record<string, number> = {};

    for (const [file, fileIndex] of index.files) {
      // Extract directory
      const dir = path.dirname(fileIndex.relativePath);
      if (dir && dir !== '.') {
        directories.add(dir.split(path.sep)[0]);
      }

      // Count by extension
      const ext = path.extname(file);
      filesByType[ext] = (filesByType[ext] || 0) + 1;
    }

    return {
      totalFiles: index.totalFiles,
      directories: Array.from(directories),
      filesByType,
    };
  }

  private async identifyKeyFiles(): Promise<string[]> {
    const keyPatterns = [
      'index.ts',
      'index.js',
      'main.ts',
      'main.js',
      'app.ts',
      'app.js',
      'server.ts',
      'server.js',
      'cli.ts',
    ];

    const keyFiles: string[] = [];
    const index = await this.indexer.buildIndex();

    for (const [filePath, fileIndex] of index.files) {
      const fileName = path.basename(filePath);
      if (keyPatterns.includes(fileName)) {
        keyFiles.push(filePath);
      }
    }

    return keyFiles;
  }

  private shouldDocumentFile(filePath: string): boolean {
    // Skip test files, config files, build output
    const skipPatterns = [
      /\.test\./,
      /\.spec\./,
      /\.config\./,
      /\/test\//,
      /\/tests\//,
      /\/dist\//,
      /\/build\//,
      /\/node_modules\//,
    ];

    return !skipPatterns.some(pattern => pattern.test(filePath));
  }

  private createFunctionDoc(func: ParsedFunction, filePath: string): APIDocEntry {
    return {
      name: func.name,
      type: 'function',
      signature: this.buildFunctionSignature(func),
      description: func.documentation || `Function: ${func.name}`,
      parameters: func.parameters.map(p => ({
        name: p.name,
        type: p.type || 'any',
        description: '',
        optional: p.optional || false,
        defaultValue: p.defaultValue,
      })),
      returnType: func.returnType,
      returnDescription: '',
      examples: [],
      filePath: path.relative(this.repoRoot, filePath),
      lineNumber: func.line,
    };
  }

  private createClassDoc(cls: ParsedClass, filePath: string): APIDocEntry {
    return {
      name: cls.name,
      type: 'class',
      signature: `class ${cls.name}`,
      description: cls.documentation || `Class: ${cls.name}`,
      parameters: [],
      examples: [],
      filePath: path.relative(this.repoRoot, filePath),
      lineNumber: cls.line,
    };
  }

  private buildFunctionSignature(func: ParsedFunction): string {
    const params = func.parameters
      .map(p => {
        let param = p.name;
        if (p.optional) param += '?';
        if (p.type) param += `: ${p.type}`;
        if (p.defaultValue) param += ` = ${p.defaultValue}`;
        return param;
      })
      .join(', ');

    const returnType = func.returnType ? `: ${func.returnType}` : '';
    return `${func.name}(${params})${returnType}`;
  }

  private async identifyArchitecturalPatterns(structure: any): Promise<string[]> {
    const patterns: string[] = [];

    // Check for common patterns based on directory structure
    const dirs = structure.directories.map((d: string) => d.toLowerCase());

    if (dirs.includes('components') || dirs.includes('views')) {
      patterns.push('Component-Based Architecture');
    }
    if (dirs.includes('services') || dirs.includes('api')) {
      patterns.push('Service Layer Pattern');
    }
    if (dirs.includes('models') || dirs.includes('entities')) {
      patterns.push('Domain Model Pattern');
    }
    if (dirs.includes('controllers') || dirs.includes('handlers')) {
      patterns.push('MVC / Handler Pattern');
    }
    if (dirs.includes('providers') || dirs.includes('factories')) {
      patterns.push('Factory / Provider Pattern');
    }
    if (dirs.includes('core') || dirs.includes('lib')) {
      patterns.push('Core Library Pattern');
    }

    return patterns;
  }

  private async analyzeProjectConventions(): Promise<any> {
    const packageJsonPath = path.join(this.repoRoot, 'package.json');
    let testFramework = null;
    let linter = null;
    let formatter = null;

    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      if (allDeps.jest) testFramework = 'jest';
      else if (allDeps.mocha) testFramework = 'mocha';
      else if (allDeps.vitest) testFramework = 'vitest';

      if (allDeps.eslint) linter = 'eslint';
      if (allDeps.prettier) formatter = 'prettier';
    }

    return {
      testFramework,
      linter,
      formatter,
      typescript: fs.existsSync(path.join(this.repoRoot, 'tsconfig.json')),
    };
  }

  private hasCICDConfig(): boolean {
    const cicdFiles = [
      '.github/workflows',
      '.gitlab-ci.yml',
      '.circleci/config.yml',
      'azure-pipelines.yml',
      '.travis.yml',
    ];

    return cicdFiles.some(file =>
      fs.existsSync(path.join(this.repoRoot, file))
    );
  }

  private extractSections(markdown: string): string[] {
    const sections: string[] = [];
    const lines = markdown.split('\n');

    for (const line of lines) {
      if (line.startsWith('# ') || line.startsWith('## ')) {
        sections.push(line.replace(/^#+\s*/, ''));
      }
    }

    return sections;
  }

  private getDefaultOutputPath(type: DocumentationType): string {
    switch (type) {
      case 'readme':
        return 'README.md';
      case 'api':
        return 'docs/API.md';
      case 'architecture':
        return 'docs/ARCHITECTURE.md';
      case 'contributing':
        return 'CONTRIBUTING.md';
      case 'changelog':
        return 'CHANGELOG.md';
      default:
        return 'docs/documentation.md';
    }
  }

  private hasCodeChanged(dependencies: string[]): boolean {
    // Simple check: if any dependency file has been modified recently
    // In a real implementation, this would check git status or file mtimes
    return false; // For now, always use cache if available
  }

  // ========================================
  // Private Methods - AI Generation
  // ========================================

  private async generateReadmeWithAI(
    context: string,
    options: DocumentationOptions
  ): Promise<string> {
    const messages: AIMessage[] = [
      {
        role: 'system',
        content: `You are a technical documentation expert. Generate a comprehensive, well-structured README.md file for the project based on the provided context.

Include the following sections:
1. Project Title and Description
2. Features (key capabilities)
3. Installation
4. Quick Start / Usage
5. Configuration (if applicable)
6. Examples (if includeExamples is true)
7. Contributing
8. License

Use proper Markdown formatting with badges, code blocks, and clear headings.
Make it engaging and easy to follow for ${options.targetAudience || 'users'}.`,
      },
      {
        role: 'user',
        content: context,
      },
    ];

    const response = await this.provider.chat(messages, {
      temperature: 0.7,
      maxTokens: 2000,
    });

    return response.content;
  }

  private async generateAPIDocsContent(
    apiEntries: APIDocEntry[],
    options: DocumentationOptions
  ): Promise<string> {
    let content = '# API Documentation\n\n';
    content += `> Auto-generated API documentation\n`;
    content += `> Generated: ${new Date().toISOString()}\n\n`;

    content += '## Table of Contents\n\n';

    // Group by type
    const byType: Record<string, APIDocEntry[]> = {};
    for (const entry of apiEntries) {
      if (!byType[entry.type]) byType[entry.type] = [];
      byType[entry.type].push(entry);
    }

    // Add TOC
    for (const [type, entries] of Object.entries(byType)) {
      content += `- [${type.charAt(0).toUpperCase() + type.slice(1)}s](#${type}s)\n`;
      for (const entry of entries) {
        content += `  - [${entry.name}](#${entry.name.toLowerCase()})\n`;
      }
    }
    content += '\n';

    // Add detailed documentation
    for (const [type, entries] of Object.entries(byType)) {
      content += `## ${type.charAt(0).toUpperCase() + type.slice(1)}s\n\n`;

      for (const entry of entries) {
        content += `### ${entry.name}\n\n`;
        content += `${entry.description}\n\n`;

        content += '**Signature:**\n```typescript\n';
        content += entry.signature + '\n';
        content += '```\n\n';

        if (entry.parameters && entry.parameters.length > 0) {
          content += '**Parameters:**\n\n';
          content += '| Name | Type | Optional | Description |\n';
          content += '|------|------|----------|-------------|\n';
          for (const param of entry.parameters) {
            content += `| ${param.name} | \`${param.type}\` | ${param.optional ? 'Yes' : 'No'} | ${param.description} |\n`;
          }
          content += '\n';
        }

        if (entry.returnType) {
          content += `**Returns:** \`${entry.returnType}\`\n\n`;
          if (entry.returnDescription) {
            content += `${entry.returnDescription}\n\n`;
          }
        }

        if (entry.examples && entry.examples.length > 0) {
          content += '**Example:**\n```typescript\n';
          content += entry.examples[0];
          content += '\n```\n\n';
        }

        content += `**Source:** \`${entry.filePath}:${entry.lineNumber}\`\n\n`;
        content += '---\n\n';
      }
    }

    return content;
  }

  private async generateArchitectureContent(
    structure: any,
    patterns: string[],
    diagrams: GeneratedDiagram[],
    options: DocumentationOptions
  ): Promise<string> {
    let content = '# Architecture Documentation\n\n';
    content += `> Auto-generated architecture documentation\n`;
    content += `> Generated: ${new Date().toISOString()}\n\n`;

    content += '## Overview\n\n';
    content += `This document describes the architecture of the ${path.basename(this.repoRoot)} project.\n\n`;

    content += `**Project Statistics:**\n`;
    content += `- Total Files: ${structure.totalFiles}\n`;
    content += `- Main Directories: ${structure.directories.join(', ')}\n\n`;

    if (patterns.length > 0) {
      content += '## Architectural Patterns\n\n';
      content += 'The following architectural patterns have been identified:\n\n';
      for (const pattern of patterns) {
        content += `- ${pattern}\n`;
      }
      content += '\n';
    }

    content += '## Project Structure\n\n';
    content += '```\n';
    content += this.generateTreeView(structure.directories);
    content += '```\n\n';

    if (diagrams.length > 0) {
      content += '## Diagrams\n\n';
      for (const diagram of diagrams) {
        content += `### ${diagram.type.charAt(0).toUpperCase() + diagram.type.slice(1)} Diagram\n\n`;
        content += `${diagram.description}\n\n`;
        content += '```mermaid\n';
        content += diagram.mermaidCode;
        content += '\n```\n\n';
      }
    }

    return content;
  }

  private async generateContributingContent(
    context: any,
    options: DocumentationOptions
  ): Promise<string> {
    let content = '# Contributing to ' + context.projectInfo.name + '\n\n';
    content += 'Thank you for your interest in contributing! This guide will help you get started.\n\n';

    content += '## Getting Started\n\n';
    content += '### Prerequisites\n\n';
    content += '- Node.js 18+ (if applicable)\n';
    content += '- Git\n\n';

    content += '### Setup\n\n';
    content += '```bash\n';
    content += '# Clone the repository\n';
    content += 'git clone ' + (context.projectInfo.repository?.url || '<repo-url>') + '\n';
    content += 'cd ' + context.projectInfo.name + '\n\n';
    content += '# Install dependencies\n';
    content += 'npm install\n';
    content += '```\n\n';

    content += '## Development Workflow\n\n';
    content += '1. Create a new branch: `git checkout -b feature/your-feature`\n';
    content += '2. Make your changes\n';
    content += '3. Test your changes\n';
    content += '4. Commit with a descriptive message\n';
    content += '5. Push to your fork\n';
    content += '6. Open a Pull Request\n\n';

    if (context.hasTests) {
      content += '## Running Tests\n\n';
      content += '```bash\n';
      content += 'npm test\n';
      content += '```\n\n';
    }

    if (context.hasLinter) {
      content += '## Code Style\n\n';
      content += 'We use ESLint to maintain code quality. Run the linter:\n\n';
      content += '```bash\n';
      content += 'npm run lint\n';
      content += '```\n\n';
    }

    content += '## Commit Message Guidelines\n\n';
    content += 'We follow the Conventional Commits specification:\n\n';
    content += '- `feat:` - New feature\n';
    content += '- `fix:` - Bug fix\n';
    content += '- `docs:` - Documentation changes\n';
    content += '- `refactor:` - Code refactoring\n';
    content += '- `test:` - Test updates\n';
    content += '- `chore:` - Maintenance tasks\n\n';

    content += '## Pull Request Process\n\n';
    content += '1. Ensure all tests pass\n';
    content += '2. Update documentation if needed\n';
    content += '3. Add a clear description of changes\n';
    content += '4. Request review from maintainers\n\n';

    content += '## Questions?\n\n';
    content += 'Feel free to open an issue for any questions or concerns.\n';

    return content;
  }

  private async generateDiagrams(
    types: DiagramType[],
    structure: any
  ): Promise<GeneratedDiagram[]> {
    const diagrams: GeneratedDiagram[] = [];

    for (const type of types) {
      const diagram = await this.generateSingleDiagram(type, structure);
      if (diagram) {
        diagrams.push(diagram);
      }
    }

    return diagrams;
  }

  private async generateSingleDiagram(
    type: DiagramType,
    structure: any
  ): Promise<GeneratedDiagram | null> {
    try {
      const messages: AIMessage[] = [
        {
          role: 'system',
          content: `You are an expert at creating Mermaid diagrams for software architecture.
Generate a ${type} diagram in Mermaid syntax based on the provided project structure.

Return ONLY the Mermaid code, no explanation or markdown formatting.`,
        },
        {
          role: 'user',
          content: `Project Structure:\n${JSON.stringify(structure, null, 2)}\n\nGenerate a ${type} diagram.`,
        },
      ];

      const response = await this.provider.chat(messages, {
        temperature: 0.5,
        maxTokens: 1000,
      });

      const mermaidCode = response.content.replace(/```mermaid\n?/g, '').replace(/```\n?/g, '').trim();

      return {
        type,
        mermaidCode,
        description: `${type.charAt(0).toUpperCase() + type.slice(1)} diagram showing project structure`,
      };
    } catch (error) {
      console.error(`Failed to generate ${type} diagram:`, error);
      return null;
    }
  }

  private generateTreeView(directories: string[]): string {
    let tree = '.\n';
    for (const dir of directories.slice(0, 20)) {
      tree += `├── ${dir}/\n`;
    }
    if (directories.length > 20) {
      tree += `└── ... (${directories.length - 20} more)\n`;
    }
    return tree;
  }
}
