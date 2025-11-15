import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { AIProvider } from '../providers/base';
import { AICache } from '../core/ai-cache';

const execAsync = promisify(exec);

/**
 * Git change information
 */
export interface GitChange {
  file: string;
  additions: number;
  deletions: number;
  diff: string;
  type: 'added' | 'modified' | 'deleted' | 'renamed';
  status: string;
}

/**
 * Change categorization
 */
export interface ChangeCategories {
  features: GitChange[];
  fixes: GitChange[];
  refactors: GitChange[];
  docs: GitChange[];
  tests: GitChange[];
  chores: GitChange[];
  breaking: GitChange[];
}

/**
 * Commit message structure
 */
export interface CommitMessage {
  type: string;
  scope?: string;
  subject: string;
  body: string;
  footer?: string;
  breaking: boolean;
}

/**
 * Commit Message Generator
 */
export class CommitMessageGenerator {
  private provider: AIProvider;
  private cache: AICache;
  private repoRoot: string;

  constructor(provider: AIProvider, cache: AICache, repoRoot: string) {
    this.provider = provider;
    this.cache = cache;
    this.repoRoot = repoRoot;
  }

  /**
   * Generate commit message for staged changes
   */
  async generateCommitMessage(options?: {
    scope?: string;
    type?: string;
    includeBody?: boolean;
  }): Promise<CommitMessage> {
    // Get staged changes
    const changes = await this.getStagedChanges();

    if (changes.length === 0) {
      throw new Error('No staged changes found. Use `git add` to stage changes first.');
    }

    // Categorize changes
    const categories = this.categorizeChanges(changes);

    // Check cache
    const cacheKey = this.createCacheKey(changes);
    const cached = await this.cache.get(cacheKey, this.provider.getName());

    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache, continue
      }
    }

    // Get recent commit messages for style reference
    const recentCommits = await this.getRecentCommits(5);

    // Generate message using AI
    const message = await this.generateWithAI(changes, categories, recentCommits, options);

    // Cache result
    await this.cache.set(cacheKey, this.provider.getName(), JSON.stringify(message));

    return message;
  }

  /**
   * Generate PR description
   */
  async generatePRDescription(baseBranch: string = 'main'): Promise<string> {
    // Get all changes between base branch and current branch
    const changes = await this.getBranchChanges(baseBranch);

    if (changes.length === 0) {
      throw new Error(`No changes found between current branch and ${baseBranch}.`);
    }

    // Get all commits in this branch
    const commits = await this.getBranchCommits(baseBranch);

    // Categorize changes
    const categories = this.categorizeChanges(changes);

    // Generate PR description using AI
    return await this.generatePRWithAI(changes, commits, categories);
  }

  /**
   * Get staged changes from git
   */
  private async getStagedChanges(): Promise<GitChange[]> {
    try {
      // Get diff stat for staged changes
      const { stdout: statOutput } = await execAsync('git diff --cached --numstat', {
        cwd: this.repoRoot,
      });

      // Get actual diff
      const { stdout: diffOutput } = await execAsync('git diff --cached', {
        cwd: this.repoRoot,
      });

      // Get status
      const { stdout: statusOutput } = await execAsync('git diff --cached --name-status', {
        cwd: this.repoRoot,
      });

      return this.parseGitChanges(statOutput, diffOutput, statusOutput);
    } catch (error) {
      console.error('Failed to get staged changes:', error);
      return [];
    }
  }

  /**
   * Get changes between base branch and current branch
   */
  private async getBranchChanges(baseBranch: string): Promise<GitChange[]> {
    try {
      const { stdout: statOutput } = await execAsync(`git diff ${baseBranch}...HEAD --numstat`, {
        cwd: this.repoRoot,
      });

      const { stdout: diffOutput } = await execAsync(`git diff ${baseBranch}...HEAD`, {
        cwd: this.repoRoot,
      });

      const { stdout: statusOutput } = await execAsync(`git diff ${baseBranch}...HEAD --name-status`, {
        cwd: this.repoRoot,
      });

      return this.parseGitChanges(statOutput, diffOutput, statusOutput);
    } catch (error) {
      console.error(`Failed to get changes from ${baseBranch}:`, error);
      return [];
    }
  }

  /**
   * Get commits in current branch (not in base branch)
   */
  private async getBranchCommits(baseBranch: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync(`git log ${baseBranch}..HEAD --oneline`, {
        cwd: this.repoRoot,
      });

      return stdout.trim().split('\n').filter(line => line.length > 0);
    } catch (error) {
      console.error('Failed to get branch commits:', error);
      return [];
    }
  }

  /**
   * Get recent commit messages
   */
  private async getRecentCommits(count: number): Promise<string[]> {
    try {
      const { stdout } = await execAsync(`git log -${count} --pretty=format:"%s"`, {
        cwd: this.repoRoot,
      });

      return stdout.trim().split('\n').filter(line => line.length > 0);
    } catch (error) {
      console.error('Failed to get recent commits:', error);
      return [];
    }
  }

  /**
   * Parse git changes from diff output
   */
  private parseGitChanges(statOutput: string, diffOutput: string, statusOutput: string): GitChange[] {
    const changes: GitChange[] = [];

    const statLines = statOutput.trim().split('\n');
    const statusLines = statusOutput.trim().split('\n');

    const statusMap = new Map<string, string>();
    for (const line of statusLines) {
      const [status, file] = line.split('\t');
      if (file) {
        statusMap.set(file, status);
      }
    }

    for (const line of statLines) {
      if (!line.trim()) continue;

      const parts = line.split('\t');
      if (parts.length < 3) continue;

      const additions = parseInt(parts[0]) || 0;
      const deletions = parseInt(parts[1]) || 0;
      const file = parts[2];

      const status = statusMap.get(file) || 'M';

      let type: GitChange['type'];
      if (status.startsWith('A')) type = 'added';
      else if (status.startsWith('D')) type = 'deleted';
      else if (status.startsWith('R')) type = 'renamed';
      else type = 'modified';

      // Extract diff for this file
      const fileRegex = new RegExp(`diff --git a/${file}[\\s\\S]*?(?=diff --git|$)`, 'g');
      const match = diffOutput.match(fileRegex);
      const fileDiff = match ? match[0] : '';

      changes.push({
        file,
        additions,
        deletions,
        diff: fileDiff.slice(0, 2000), // Limit diff size
        type,
        status,
      });
    }

    return changes;
  }

  /**
   * Categorize changes
   */
  private categorizeChanges(changes: GitChange[]): ChangeCategories {
    const categories: ChangeCategories = {
      features: [],
      fixes: [],
      refactors: [],
      docs: [],
      tests: [],
      chores: [],
      breaking: [],
    };

    for (const change of changes) {
      // Categorize by file type and content
      if (change.file.match(/\.(test|spec)\.(ts|js|tsx|jsx|py)$/)) {
        categories.tests.push(change);
      } else if (change.file.match(/\.(md|txt|rst)$/i)) {
        categories.docs.push(change);
      } else if (change.file.match(/package\.json|requirements\.txt|Gemfile|go\.mod/)) {
        categories.chores.push(change);
      } else if (this.isFeature(change)) {
        categories.features.push(change);
      } else if (this.isFix(change)) {
        categories.fixes.push(change);
      } else if (this.isRefactor(change)) {
        categories.refactors.push(change);
      } else {
        // Default to chore
        categories.chores.push(change);
      }

      // Check for breaking changes
      if (this.isBreakingChange(change)) {
        categories.breaking.push(change);
      }
    }

    return categories;
  }

  /**
   * Check if change is a feature
   */
  private isFeature(change: GitChange): boolean {
    const keywords = ['add', 'implement', 'create', 'new', 'feature'];
    const diff = change.diff.toLowerCase();

    return keywords.some(keyword => diff.includes(keyword)) || change.type === 'added';
  }

  /**
   * Check if change is a fix
   */
  private isFix(change: GitChange): boolean {
    const keywords = ['fix', 'bug', 'issue', 'error', 'resolve', 'correct'];
    const diff = change.diff.toLowerCase();

    return keywords.some(keyword => diff.includes(keyword));
  }

  /**
   * Check if change is a refactor
   */
  private isRefactor(change: GitChange): boolean {
    const keywords = ['refactor', 'cleanup', 'reorganize', 'restructure', 'simplify'];
    const diff = change.diff.toLowerCase();

    return keywords.some(keyword => diff.includes(keyword));
  }

  /**
   * Check if change is breaking
   */
  private isBreakingChange(change: GitChange): boolean {
    const keywords = ['breaking', 'breaking change', 'deprecated', 'removed'];
    const diff = change.diff.toLowerCase();

    return keywords.some(keyword => diff.includes(keyword));
  }

  /**
   * Generate commit message using AI
   */
  private async generateWithAI(
    changes: GitChange[],
    categories: ChangeCategories,
    recentCommits: string[],
    options?: {
      scope?: string;
      type?: string;
      includeBody?: boolean;
    }
  ): Promise<CommitMessage> {
    const prompt = this.buildCommitPrompt(changes, categories, recentCommits, options);

    const messages = [
      {
        role: 'system' as const,
        content: `You are a git expert. Generate clear, conventional commit messages following the Conventional Commits specification.

Format:
<type>(<scope>): <subject>

<body>

<footer>

Types: feat, fix, docs, style, refactor, test, chore, perf, ci, build
Rules:
1. Subject: imperative mood, lowercase, no period, max 50 chars
2. Body: explain what and why, not how (optional)
3. Footer: breaking changes, issue refs (optional)

Respond ONLY with valid JSON.`,
      },
      {
        role: 'user' as const,
        content: prompt,
      },
    ];

    const response = await this.provider.chat(messages, {
      temperature: 0.4,
      maxTokens: 800,
    });

    // Parse response
    try {
      let jsonContent = response.content.trim();

      // Remove markdown code blocks if present
      const jsonMatch = jsonContent.match(/```json\n([\s\S]*?)\n```/) || jsonContent.match(/```\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        jsonContent = jsonMatch[1];
      }

      const message = JSON.parse(jsonContent);

      return {
        type: message.type || 'chore',
        scope: message.scope,
        subject: message.subject || 'update code',
        body: message.body || '',
        footer: message.footer,
        breaking: message.breaking || categories.breaking.length > 0,
      };
    } catch (error) {
      console.warn('Failed to parse AI response:', error);
      // Fallback to simple message
      return {
        type: options?.type || 'chore',
        scope: options?.scope,
        subject: 'update code',
        body: `Updated ${changes.length} files`,
        breaking: categories.breaking.length > 0,
      };
    }
  }

  /**
   * Build commit prompt
   */
  private buildCommitPrompt(
    changes: GitChange[],
    categories: ChangeCategories,
    recentCommits: string[],
    options?: {
      scope?: string;
      type?: string;
      includeBody?: boolean;
    }
  ): string {
    let prompt = `# Git Changes Analysis\n\n`;

    prompt += `## Files Changed (${changes.length})\n`;
    for (const change of changes.slice(0, 20)) {
      prompt += `- ${change.file} (+${change.additions}, -${change.deletions}) [${change.type}]\n`;
    }

    prompt += `\n## Categories\n`;
    prompt += `- Features: ${categories.features.length}\n`;
    prompt += `- Fixes: ${categories.fixes.length}\n`;
    prompt += `- Refactors: ${categories.refactors.length}\n`;
    prompt += `- Documentation: ${categories.docs.length}\n`;
    prompt += `- Tests: ${categories.tests.length}\n`;
    prompt += `- Chores: ${categories.chores.length}\n`;
    prompt += `- Breaking changes: ${categories.breaking.length}\n\n`;

    if (changes.length <= 5) {
      prompt += `## Diff Summary\n`;
      for (const change of changes) {
        prompt += `### ${change.file}\n\`\`\`diff\n${change.diff.slice(0, 500)}\n\`\`\`\n\n`;
      }
    }

    if (recentCommits.length > 0) {
      prompt += `## Recent Commit Style (for reference)\n`;
      for (const commit of recentCommits) {
        prompt += `- ${commit}\n`;
      }
      prompt += '\n';
    }

    prompt += `## Task\n\nGenerate a conventional commit message for these changes. `;

    if (options?.type) {
      prompt += `Use type: ${options.type}. `;
    }

    if (options?.scope) {
      prompt += `Use scope: ${options.scope}. `;
    }

    prompt += `\n\nRespond with ONLY a JSON object (no markdown) in this format:\n\n`;
    prompt += `{
  "type": "feat|fix|docs|style|refactor|test|chore",
  "scope": "optional scope",
  "subject": "imperative mood, lowercase, max 50 chars",
  "body": "detailed explanation (optional)",
  "footer": "breaking changes, issue refs (optional)",
  "breaking": false
}\n`;

    return prompt;
  }

  /**
   * Generate PR description using AI
   */
  private async generatePRWithAI(
    changes: GitChange[],
    commits: string[],
    categories: ChangeCategories
  ): Promise<string> {
    const prompt = this.buildPRPrompt(changes, commits, categories);

    const messages = [
      {
        role: 'system' as const,
        content: `You are a technical writer creating PR descriptions. Generate clear, comprehensive pull request descriptions.

Include:
1. Summary (what and why)
2. Changes (bullet list)
3. Testing checklist
4. Breaking changes (if any)

Use markdown format.`,
      },
      {
        role: 'user' as const,
        content: prompt,
      },
    ];

    const response = await this.provider.chat(messages, {
      temperature: 0.5,
      maxTokens: 1500,
    });

    return response.content;
  }

  /**
   * Build PR prompt
   */
  private buildPRPrompt(changes: GitChange[], commits: string[], categories: ChangeCategories): string {
    let prompt = `# Pull Request Context\n\n`;

    prompt += `## Commits (${commits.length})\n`;
    for (const commit of commits) {
      prompt += `- ${commit}\n`;
    }

    prompt += `\n## Files Changed (${changes.length})\n`;
    for (const change of changes.slice(0, 30)) {
      prompt += `- ${change.file} (+${change.additions}, -${change.deletions})\n`;
    }

    prompt += `\n## Summary\n`;
    prompt += `- ${categories.features.length} features\n`;
    prompt += `- ${categories.fixes.length} fixes\n`;
    prompt += `- ${categories.refactors.length} refactors\n`;
    prompt += `- ${categories.breaking.length} breaking changes\n\n`;

    prompt += `Generate a comprehensive PR description in markdown format.`;

    return prompt;
  }

  /**
   * Format commit message
   */
  formatMessage(message: CommitMessage): string {
    let formatted = message.type;

    if (message.scope) {
      formatted += `(${message.scope})`;
    }

    formatted += `: ${message.subject}\n`;

    if (message.body) {
      formatted += `\n${message.body}\n`;
    }

    if (message.footer || message.breaking) {
      formatted += '\n';

      if (message.breaking) {
        formatted += 'BREAKING CHANGE: ';
        if (message.footer) {
          formatted += message.footer;
        } else {
          formatted += 'See changes above';
        }
      } else if (message.footer) {
        formatted += message.footer;
      }
    }

    return formatted;
  }

  /**
   * Create cache key
   */
  private createCacheKey(changes: GitChange[]): string {
    const summary = changes
      .map(c => `${c.file}:${c.additions}:${c.deletions}`)
      .sort()
      .join('|');

    const crypto = require('crypto');
    return `commit:${crypto.createHash('sha256').update(summary).digest('hex').slice(0, 16)}`;
  }
}
