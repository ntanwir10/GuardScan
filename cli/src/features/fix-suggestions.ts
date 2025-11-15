import * as fs from 'fs';
import { AIProvider } from '../providers/base';
import { ASTParser, ParsedFunction } from '../core/ast-parser';
import { ContextBuilder } from '../core/context-builder';
import { CodebaseIndexer } from '../core/codebase-indexer';
import { AICache } from '../core/ai-cache';

/**
 * Security issue interface
 */
export interface SecurityIssue {
  severity: 'high' | 'medium' | 'low';
  category: string;
  file: string;
  line: number;
  endLine?: number;
  codeSnippet: string;
  description: string;
  rule?: string;
}

/**
 * Fix suggestion interface
 */
export interface FixSuggestion {
  explanation: string;
  fixedCode: string;
  alternatives?: string[];
  bestPractices?: string[];
  confidence: number; // 0-1
  testable: boolean;
}

/**
 * Issue context for AI
 */
interface IssueContext {
  issue: SecurityIssue;
  function: ParsedFunction | null;
  fullFileContent: string;
  imports: string[];
  relatedCode: string;
}

/**
 * AI Fix Suggestions Generator
 */
export class FixSuggestionsGenerator {
  private provider: AIProvider;
  private parser: ASTParser;
  private contextBuilder: ContextBuilder;
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
    this.cache = cache;
    this.repoRoot = repoRoot;
  }

  /**
   * Generate fix suggestions for a security issue
   */
  async generateFix(issue: SecurityIssue): Promise<FixSuggestion> {
    // Check cache first
    const cacheKey = this.createCacheKey(issue);
    const cached = await this.cache.get(cacheKey, this.provider.getName(), [issue.file]);

    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache, continue
      }
    }

    // Analyze issue and build context
    const context = await this.analyzeIssue(issue);

    // Generate fix using AI
    const fix = await this.generateFixWithAI(context);

    // Validate fix
    const validated = await this.validateFix(fix, context);

    // Cache result
    await this.cache.set(cacheKey, this.provider.getName(), JSON.stringify(validated), [issue.file]);

    return validated;
  }

  /**
   * Generate fixes for multiple issues (in parallel)
   */
  async generateFixes(issues: SecurityIssue[], maxConcurrent: number = 5): Promise<Map<string, FixSuggestion>> {
    const results = new Map<string, FixSuggestion>();

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < issues.length; i += maxConcurrent) {
      const batch = issues.slice(i, i + maxConcurrent);

      const fixes = await Promise.all(
        batch.map(async (issue) => {
          try {
            const fix = await this.generateFix(issue);
            return { issue, fix };
          } catch (error) {
            console.warn(`Failed to generate fix for ${issue.file}:${issue.line}:`, error);
            return null;
          }
        })
      );

      // Store results
      for (const result of fixes) {
        if (result) {
          const key = `${result.issue.file}:${result.issue.line}`;
          results.set(key, result.fix);
        }
      }
    }

    return results;
  }

  /**
   * Analyze issue and gather context
   */
  private async analyzeIssue(issue: SecurityIssue): Promise<IssueContext> {
    // Read full file
    const fullFileContent = fs.readFileSync(issue.file, 'utf-8');

    // Parse file
    const parsed = await this.parser.parseFile(issue.file);

    // Find containing function
    let containingFunction: ParsedFunction | null = null;
    for (const func of parsed.functions) {
      if (func.line <= issue.line && func.endLine >= issue.line) {
        containingFunction = func;
        break;
      }
    }

    // Extract imports
    const imports = parsed.imports.map(imp => imp.module);

    // Build related code context (limited to 1000 tokens)
    const relatedCode = await this.buildRelatedContext(issue, containingFunction);

    return {
      issue,
      function: containingFunction,
      fullFileContent,
      imports,
      relatedCode,
    };
  }

  /**
   * Build context for related code
   */
  private async buildRelatedContext(issue: SecurityIssue, func: ParsedFunction | null): Promise<string> {
    if (!func) {
      // No function context, just return file snippet around issue
      const lines = fs.readFileSync(issue.file, 'utf-8').split('\n');
      const start = Math.max(0, issue.line - 10);
      const end = Math.min(lines.length, issue.line + 10);

      return lines.slice(start, end).join('\n');
    }

    // Build context with dependencies
    try {
      const context = await this.contextBuilder.buildFunctionContext(func.name, {
        maxTokens: 1000,
        includeDependencies: true,
        includeImports: true,
        includeTests: false,
        includeDocs: false,
        provider: this.provider,
      });

      return context.content;
    } catch {
      // Fallback to function body
      return func.body;
    }
  }

  /**
   * Generate fix using AI
   */
  private async generateFixWithAI(context: IssueContext): Promise<FixSuggestion> {
    const prompt = this.buildFixPrompt(context);

    const messages = [
      {
        role: 'system' as const,
        content: `You are a senior security engineer and code reviewer. Your task is to:
1. Analyze security vulnerabilities and code quality issues
2. Generate working, secure fixes
3. Explain the vulnerability and how the fix addresses it
4. Suggest best practices

IMPORTANT: Respond ONLY with valid JSON. No markdown, no code blocks, just JSON.`,
      },
      {
        role: 'user' as const,
        content: prompt,
      },
    ];

    const response = await this.provider.chat(messages, {
      temperature: 0.3, // Lower temperature for more consistent, conservative fixes
      maxTokens: 2000,
    });

    // Parse response
    try {
      // Try to extract JSON from response (in case AI wraps it in markdown)
      let jsonContent = response.content.trim();

      // Remove markdown code blocks if present
      const jsonMatch = jsonContent.match(/```json\n([\s\S]*?)\n```/) || jsonContent.match(/```\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        jsonContent = jsonMatch[1];
      }

      const fix = JSON.parse(jsonContent);

      // Ensure all required fields exist
      return {
        explanation: fix.explanation || 'No explanation provided',
        fixedCode: fix.fixedCode || fix.fix || '',
        alternatives: fix.alternatives || [],
        bestPractices: fix.bestPractices || [],
        confidence: fix.confidence || 0.7,
        testable: fix.testable !== false,
      };
    } catch (error) {
      console.warn('Failed to parse AI response:', error);
      // Return a fallback fix
      return {
        explanation: 'Unable to generate detailed fix explanation',
        fixedCode: context.function?.body || context.issue.codeSnippet,
        confidence: 0.1,
        testable: false,
      };
    }
  }

  /**
   * Build fix prompt for AI
   */
  private buildFixPrompt(context: IssueContext): string {
    const { issue, function: func, imports, relatedCode } = context;

    let prompt = `# Security Issue Analysis

**File:** ${issue.file}
**Line:** ${issue.line}
**Severity:** ${issue.severity}
**Category:** ${issue.category}
**Description:** ${issue.description}

`;

    if (issue.rule) {
      prompt += `**Rule:** ${issue.rule}\n\n`;
    }

    prompt += `## Current Code

\`\`\`typescript
${issue.codeSnippet}
\`\`\`

`;

    if (func) {
      prompt += `## Containing Function

**Function:** ${func.name}
**Complexity:** ${func.complexity}

\`\`\`typescript
${func.body}
\`\`\`

`;
    }

    if (imports.length > 0) {
      prompt += `## Imports

\`\`\`typescript
${imports.join('\n')}
\`\`\`

`;
    }

    prompt += `## Task

Generate a secure fix for this vulnerability. Respond with ONLY a JSON object (no markdown, no code blocks) in this exact format:

{
  "explanation": "Clear explanation of why the current code is vulnerable",
  "fixedCode": "Complete fixed code (the entire function or code block)",
  "alternatives": ["Alternative approach 1", "Alternative approach 2"],
  "bestPractices": ["Best practice 1", "Best practice 2"],
  "confidence": 0.9,
  "testable": true
}

Requirements:
1. The fix must be syntactically correct and runnable
2. Address the root cause, not just symptoms
3. Maintain existing functionality
4. Follow ${issue.category} security best practices
5. Keep the same function signature and exports
6. Add comments explaining the security fix
`;

    return prompt;
  }

  /**
   * Validate fix
   */
  private async validateFix(fix: FixSuggestion, context: IssueContext): Promise<FixSuggestion> {
    // 1. Check if fix is not empty
    if (!fix.fixedCode || fix.fixedCode.trim().length === 0) {
      fix.confidence = 0.1;
      fix.testable = false;
      return fix;
    }

    // 2. Syntax validation
    try {
      await this.parser.parseFile(context.issue.file);
      // If we can parse the original, that's good enough for now
      // Full validation would require actually applying the fix and re-parsing
    } catch (error) {
      // Reduce confidence if syntax check fails
      fix.confidence = Math.max(0.1, fix.confidence - 0.3);
      fix.testable = false;
    }

    // 3. Check if fix is substantially different from original
    const similarity = this.calculateSimilarity(context.issue.codeSnippet, fix.fixedCode);
    if (similarity > 0.95) {
      // Fix is almost identical to original - probably not a real fix
      fix.confidence = Math.max(0.1, fix.confidence - 0.4);
    }

    return fix;
  }

  /**
   * Calculate similarity between two code strings (simple)
   */
  private calculateSimilarity(code1: string, code2: string): number {
    const normalize = (code: string) =>
      code
        .replace(/\s+/g, ' ')
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim()
        .toLowerCase();

    const norm1 = normalize(code1);
    const norm2 = normalize(code2);

    if (norm1 === norm2) return 1.0;

    // Simple character-based similarity
    const longer = norm1.length > norm2.length ? norm1 : norm2;
    const shorter = norm1.length > norm2.length ? norm2 : norm1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(shorter, longer);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Levenshtein distance (edit distance)
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Create cache key for issue
   */
  private createCacheKey(issue: SecurityIssue): string {
    return `fix:${issue.file}:${issue.line}:${issue.category}:${issue.description.slice(0, 100)}`;
  }
}
