import * as fs from 'fs';
import * as path from 'path';
import { AIProvider } from '../providers/base';
import { ASTParser, ParsedFunction, ParsedClass, ParsedFile } from '../core/ast-parser';
import { ContextBuilder } from '../core/context-builder';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';

/**
 * Explanation level
 */
export type ExplanationLevel = 'brief' | 'detailed' | 'comprehensive';

/**
 * Explanation target type
 */
export type ExplanationTarget = 'function' | 'class' | 'file' | 'module';

/**
 * Code explanation result
 */
export interface CodeExplanation {
  target: string;
  type: ExplanationTarget;
  level: ExplanationLevel;
  summary: string;
  purpose: string;
  inputs?: InputDescription[];
  outputs?: OutputDescription[];
  dataFlow?: DataFlowStep[];
  patterns?: string[];
  complexity?: string;
  dependencies?: string[];
  examples?: string[];
  bestPractices?: string[];
  potentialIssues?: string[];
}

/**
 * Input description
 */
export interface InputDescription {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

/**
 * Output description
 */
export interface OutputDescription {
  type: string;
  description: string;
  conditions?: string;
}

/**
 * Data flow step
 */
export interface DataFlowStep {
  step: number;
  action: string;
  data: string;
}

/**
 * Code Explainer
 */
export class CodeExplainer {
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
    this.provider = provider;
    this.parser = new ASTParser();
    this.contextBuilder = new ContextBuilder(indexer, repoRoot, provider);
    this.indexer = indexer;
    this.cache = cache;
    this.repoRoot = repoRoot;
  }

  /**
   * Explain a function
   */
  async explainFunction(
    functionName: string,
    level: ExplanationLevel = 'detailed'
  ): Promise<CodeExplanation> {
    // Find function
    const functions = await this.indexer.searchFunctions(functionName);
    if (functions.length === 0) {
      throw new Error(`Function "${functionName}" not found`);
    }

    const func = functions[0];

    // Check cache
    const cacheKey = `explain:function:${func.file}:${func.name}:${level}`;
    const cached = await this.cache.get(cacheKey, this.provider.getName(), [func.file]);

    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache, continue
      }
    }

    // Build context
    const context = await this.contextBuilder.buildFunctionContext(func.name, {
      maxTokens: this.getMaxTokensForLevel(level),
      includeDependencies: level !== 'brief',
      includeTests: level === 'comprehensive',
      includeDocs: level === 'comprehensive',
      provider: this.provider,
    });

    // Generate explanation
    const explanation = await this.generateExplanation(
      func.name,
      'function',
      level,
      context.content,
      {
        complexity: func.complexity,
        parameters: func.parameters,
        returnType: func.returnType,
        isAsync: func.isAsync,
      }
    );

    // Cache result
    await this.cache.set(cacheKey, this.provider.getName(), JSON.stringify(explanation), [func.file]);

    return explanation;
  }

  /**
   * Explain a class
   */
  async explainClass(
    className: string,
    level: ExplanationLevel = 'detailed'
  ): Promise<CodeExplanation> {
    // Find class
    const classes = await this.indexer.searchClasses(className);
    if (classes.length === 0) {
      throw new Error(`Class "${className}" not found`);
    }

    const cls = classes[0];

    // Check cache
    const cacheKey = `explain:class:${cls.file}:${cls.name}:${level}`;
    const cached = await this.cache.get(cacheKey, this.provider.getName(), [cls.file]);

    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache, continue
      }
    }

    // Build context
    const context = await this.buildClassContext(cls, level);

    // Generate explanation
    const explanation = await this.generateExplanation(
      cls.name,
      'class',
      level,
      context,
      {
        extends: cls.extends,
        implements: cls.implements,
        properties: cls.properties,
        methods: cls.methods.length,
      }
    );

    // Cache result
    await this.cache.set(cacheKey, this.provider.getName(), JSON.stringify(explanation), [cls.file]);

    return explanation;
  }

  /**
   * Explain a file
   */
  async explainFile(
    filePath: string,
    level: ExplanationLevel = 'detailed'
  ): Promise<CodeExplanation> {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Check cache
    const cacheKey = `explain:file:${filePath}:${level}`;
    const cached = await this.cache.get(cacheKey, this.provider.getName(), [filePath]);

    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache, continue
      }
    }

    // Parse file
    const parsed = await this.parser.parseFile(filePath);

    // Build context
    const context = await this.buildFileContext(filePath, parsed, level);

    // Generate explanation
    const explanation = await this.generateExplanation(
      path.basename(filePath),
      'file',
      level,
      context,
      {
        functions: parsed.functions.length,
        classes: parsed.classes.length,
        imports: parsed.imports.length,
        exports: parsed.exports.length,
      }
    );

    // Cache result
    await this.cache.set(cacheKey, this.provider.getName(), JSON.stringify(explanation), [filePath]);

    return explanation;
  }

  /**
   * Explain code by theme/topic
   */
  async explainTheme(
    theme: string,
    level: ExplanationLevel = 'detailed'
  ): Promise<CodeExplanation> {
    // Check cache
    const cacheKey = `explain:theme:${theme}:${level}`;
    const cached = await this.cache.get(cacheKey, this.provider.getName());

    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache, continue
      }
    }

    // Build context
    const context = await this.contextBuilder.buildThemeContext(theme, {
      maxTokens: this.getMaxTokensForLevel(level),
      includeDependencies: level !== 'brief',
      includeTests: level === 'comprehensive',
      includeDocs: level === 'comprehensive',
      provider: this.provider,
    });

    // Generate explanation
    const explanation = await this.generateExplanation(
      theme,
      'module',
      level,
      context.content,
      {}
    );

    // Cache result
    await this.cache.set(cacheKey, this.provider.getName(), JSON.stringify(explanation));

    return explanation;
  }

  /**
   * Generate explanation using AI
   */
  private async generateExplanation(
    target: string,
    type: ExplanationTarget,
    level: ExplanationLevel,
    context: string,
    metadata: any
  ): Promise<CodeExplanation> {
    const prompt = this.buildExplanationPrompt(target, type, level, context, metadata);

    const messages = [
      {
        role: 'system' as const,
        content: this.getSystemPromptForLevel(level),
      },
      {
        role: 'user' as const,
        content: prompt,
      },
    ];

    const response = await this.provider.chat(messages, {
      temperature: 0.5,
      maxTokens: this.getMaxTokensForLevel(level) * 0.8, // Reserve some for response
    });

    // Parse response
    try {
      let jsonContent = response.content.trim();

      // Remove markdown code blocks if present
      const jsonMatch = jsonContent.match(/```json\n([\s\S]*?)\n```/) || jsonContent.match(/```\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        jsonContent = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonContent);

      return {
        target,
        type,
        level,
        summary: parsed.summary || 'No summary available',
        purpose: parsed.purpose || '',
        inputs: parsed.inputs,
        outputs: parsed.outputs,
        dataFlow: parsed.dataFlow,
        patterns: parsed.patterns,
        complexity: parsed.complexity || metadata.complexity?.toString(),
        dependencies: parsed.dependencies,
        examples: parsed.examples,
        bestPractices: parsed.bestPractices,
        potentialIssues: parsed.potentialIssues,
      };
    } catch (error) {
      console.warn('Failed to parse AI explanation:', error);
      // Fallback to plain text explanation
      return {
        target,
        type,
        level,
        summary: response.content.split('\n')[0] || 'No explanation available',
        purpose: response.content,
      };
    }
  }

  /**
   * Build explanation prompt
   */
  private buildExplanationPrompt(
    target: string,
    type: ExplanationTarget,
    level: ExplanationLevel,
    context: string,
    metadata: any
  ): string {
    let prompt = `# Code Explanation Request\n\n`;
    prompt += `**Target:** ${target}\n`;
    prompt += `**Type:** ${type}\n`;
    prompt += `**Level:** ${level}\n\n`;

    if (metadata && Object.keys(metadata).length > 0) {
      prompt += `## Metadata\n`;
      for (const [key, value] of Object.entries(metadata)) {
        if (value !== undefined && value !== null) {
          prompt += `- ${key}: ${JSON.stringify(value)}\n`;
        }
      }
      prompt += '\n';
    }

    prompt += `## Code\n\n${context}\n\n`;

    prompt += `## Task\n\n`;
    prompt += `Explain the code above in ${level} detail. `;

    if (level === 'brief') {
      prompt += `Focus on what it does and why.\n`;
    } else if (level === 'detailed') {
      prompt += `Explain how it works, inputs/outputs, and data flow.\n`;
    } else {
      prompt += `Provide comprehensive explanation including patterns, best practices, and potential issues.\n`;
    }

    prompt += `\nRespond with ONLY a JSON object (no markdown) in this format:\n\n`;
    prompt += this.getResponseFormatForLevel(level);

    return prompt;
  }

  /**
   * Get system prompt for level
   */
  private getSystemPromptForLevel(level: ExplanationLevel): string {
    const base = `You are a senior software engineer explaining code to developers.`;

    if (level === 'brief') {
      return `${base} Provide concise, high-level explanations. Focus on WHAT and WHY, not HOW.`;
    } else if (level === 'detailed') {
      return `${base} Provide detailed explanations. Explain HOW the code works, data flow, and logic.`;
    } else {
      return `${base} Provide comprehensive explanations. Cover everything: patterns, best practices, edge cases, potential issues, and optimization opportunities.`;
    }
  }

  /**
   * Get response format for level
   */
  private getResponseFormatForLevel(level: ExplanationLevel): string {
    if (level === 'brief') {
      return `{
  "summary": "One-sentence summary",
  "purpose": "What this code does and why it exists"
}`;
    } else if (level === 'detailed') {
      return `{
  "summary": "Concise summary",
  "purpose": "Detailed purpose",
  "inputs": [{"name": "param", "type": "string", "description": "...", "required": true}],
  "outputs": [{"type": "ReturnType", "description": "...", "conditions": "when..."}],
  "dataFlow": [{"step": 1, "action": "...", "data": "..."}],
  "patterns": ["Pattern 1", "Pattern 2"],
  "complexity": "low|medium|high"
}`;
    } else {
      return `{
  "summary": "Executive summary",
  "purpose": "Detailed purpose and context",
  "inputs": [{"name": "param", "type": "string", "description": "...", "required": true}],
  "outputs": [{"type": "ReturnType", "description": "...", "conditions": "..."}],
  "dataFlow": [{"step": 1, "action": "...", "data": "..."}],
  "patterns": ["Design pattern 1", "Design pattern 2"],
  "complexity": "assessment with reasons",
  "dependencies": ["dependency 1", "dependency 2"],
  "examples": ["Example usage 1", "Example usage 2"],
  "bestPractices": ["Best practice 1", "Best practice 2"],
  "potentialIssues": ["Potential issue 1", "Potential issue 2"]
}`;
    }
  }

  /**
   * Get max tokens for explanation level
   */
  private getMaxTokensForLevel(level: ExplanationLevel): number {
    if (level === 'brief') return 1000;
    if (level === 'detailed') return 3000;
    return 6000; // comprehensive
  }

  /**
   * Build class context
   */
  private async buildClassContext(cls: ParsedClass, level: ExplanationLevel): Promise<string> {
    let context = `# Class: ${cls.name}\n\n`;

    if (cls.documentation) {
      context += `## Documentation\n${cls.documentation}\n\n`;
    }

    if (cls.extends && cls.extends.length > 0) {
      context += `## Extends\n${cls.extends.join(', ')}\n\n`;
    }

    if (cls.implements && cls.implements.length > 0) {
      context += `## Implements\n${cls.implements.join(', ')}\n\n`;
    }

    context += `## Properties (${cls.properties.length})\n`;
    for (const prop of cls.properties) {
      context += `- ${prop.name}: ${prop.type}${prop.isPrivate ? ' (private)' : ''}\n`;
    }

    context += `\n## Methods (${cls.methods.length})\n`;
    for (const method of cls.methods) {
      context += `- ${method.name}(`;
      context += method.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
      context += `): ${method.returnType}`;
      if (method.isAsync) context += ' (async)';
      context += `\n`;

      // For detailed/comprehensive, include method bodies
      if (level !== 'brief') {
        context += `  \`\`\`typescript\n  ${method.body.split('\n').slice(0, 10).join('\n  ')}\n  \`\`\`\n`;
      }
    }

    return context;
  }

  /**
   * Build file context
   */
  private async buildFileContext(filePath: string, parsed: ParsedFile, level: ExplanationLevel): Promise<string> {
    let context = `# File: ${path.relative(this.repoRoot, filePath)}\n\n`;
    context += `**Language:** ${parsed.language}\n\n`;

    if (parsed.imports.length > 0) {
      context += `## Imports (${parsed.imports.length})\n`;
      for (const imp of parsed.imports.slice(0, 20)) {
        context += `- ${imp}\n`;
      }
      context += '\n';
    }

    if (parsed.exports.length > 0) {
      context += `## Exports (${parsed.exports.length})\n`;
      for (const exp of parsed.exports.slice(0, 20)) {
        context += `- ${exp}\n`;
      }
      context += '\n';
    }

    if (parsed.functions.length > 0) {
      context += `## Functions (${parsed.functions.length})\n`;
      for (const func of parsed.functions) {
        context += `- ${func.name}(`;
        context += func.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
        context += `): ${func.returnType}`;
        if (func.isAsync) context += ' (async)';
        context += ` [complexity: ${func.complexity}]\n`;

        if (level !== 'brief' && func.documentation) {
          context += `  ${func.documentation}\n`;
        }
      }
      context += '\n';
    }

    if (parsed.classes.length > 0) {
      context += `## Classes (${parsed.classes.length})\n`;
      for (const cls of parsed.classes) {
        context += `- ${cls.name}`;
        if (cls.extends) context += ` extends ${cls.extends.join(', ')}`;
        if (cls.implements) context += ` implements ${cls.implements.join(', ')}`;
        context += `\n`;

        if (level !== 'brief' && cls.documentation) {
          context += `  ${cls.documentation}\n`;
        }
      }
      context += '\n';
    }

    // For detailed/comprehensive, include some actual code
    if (level !== 'brief') {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const preview = lines.slice(0, Math.min(50, lines.length)).join('\n');

      context += `## Code Preview\n\`\`\`${parsed.language}\n${preview}\n\`\`\`\n`;
    }

    return context;
  }

  /**
   * Format explanation as text
   */
  formatExplanation(explanation: CodeExplanation): string {
    let output = `# ${explanation.target} (${explanation.type})\n\n`;

    output += `## Summary\n${explanation.summary}\n\n`;
    output += `## Purpose\n${explanation.purpose}\n\n`;

    if (explanation.inputs && explanation.inputs.length > 0) {
      output += `## Inputs\n`;
      for (const input of explanation.inputs) {
        output += `- **${input.name}** (${input.type})${input.required ? ' *required*' : ''}: ${input.description}\n`;
      }
      output += '\n';
    }

    if (explanation.outputs && explanation.outputs.length > 0) {
      output += `## Outputs\n`;
      for (const output of explanation.outputs) {
        output += `- **${output.type}**: ${output.description}`;
        if (output.conditions) output += ` (${output.conditions})`;
        output += '\n';
      }
      output += '\n';
    }

    if (explanation.dataFlow && explanation.dataFlow.length > 0) {
      output += `## Data Flow\n`;
      for (const step of explanation.dataFlow) {
        output += `${step.step}. ${step.action} - ${step.data}\n`;
      }
      output += '\n';
    }

    if (explanation.patterns && explanation.patterns.length > 0) {
      output += `## Patterns\n`;
      for (const pattern of explanation.patterns) {
        output += `- ${pattern}\n`;
      }
      output += '\n';
    }

    if (explanation.complexity) {
      output += `## Complexity\n${explanation.complexity}\n\n`;
    }

    if (explanation.dependencies && explanation.dependencies.length > 0) {
      output += `## Dependencies\n`;
      for (const dep of explanation.dependencies) {
        output += `- ${dep}\n`;
      }
      output += '\n';
    }

    if (explanation.examples && explanation.examples.length > 0) {
      output += `## Examples\n`;
      for (const example of explanation.examples) {
        output += `\`\`\`typescript\n${example}\n\`\`\`\n\n`;
      }
    }

    if (explanation.bestPractices && explanation.bestPractices.length > 0) {
      output += `## Best Practices\n`;
      for (const practice of explanation.bestPractices) {
        output += `- ${practice}\n`;
      }
      output += '\n';
    }

    if (explanation.potentialIssues && explanation.potentialIssues.length > 0) {
      output += `## Potential Issues\n`;
      for (const issue of explanation.potentialIssues) {
        output += `- ${issue}\n`;
      }
      output += '\n';
    }

    return output;
  }
}
