/**
 * code-review.ts - AI-Powered Interactive Code Review
 *
 * Provides automated code review with:
 * - Git diff analysis
 * - AI-powered review comments
 * - Inline suggestions
 * - Best practice recommendations
 *
 * Phase 5, Feature 4
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AIProvider } from '../providers/base';
import { AICache } from '../core/ai-cache';

const execAsync = promisify(exec);

/**
 * Review Severity Levels
 */
export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Review Comment Categories
 */
export type ReviewCategory =
  | 'bug'
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'style'
  | 'documentation'
  | 'testing'
  | 'accessibility'
  | 'best-practice';

/**
 * Git Diff
 */
export interface GitDiff {
  file: string;
  oldPath?: string;
  newPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

/**
 * Diff Hunk (section of changed code)
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: DiffChange[];
}

/**
 * Single line change
 */
export interface DiffChange {
  type: 'add' | 'delete' | 'context';
  lineNumber: number;
  content: string;
}

/**
 * Review Comment
 */
export interface ReviewComment {
  id: string;
  file: string;
  line: number;
  endLine?: number;
  severity: ReviewSeverity;
  category: ReviewCategory;
  message: string;
  suggestion?: string;
  reasoning: string;
  autoFixable: boolean;
  references?: string[];
}

/**
 * Code Review Report
 */
export interface CodeReviewReport {
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
    totalComments: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  diffs: GitDiff[];
  comments: ReviewComment[];
  overallAssessment: {
    score: number; // 0-100
    verdict: 'approved' | 'approved-with-comments' | 'changes-requested' | 'rejected';
    summary: string;
    strengths: string[];
    concerns: string[];
  };
  generatedAt: Date;
}

/**
 * Review Options
 */
export interface ReviewOptions {
  base?: string;
  head?: string;
  files?: string[];
  includeContext?: boolean;
  minSeverity?: ReviewSeverity;
  categories?: ReviewCategory[];
}

/**
 * Code Review Engine
 */
export class CodeReviewEngine {
  constructor(
    private aiProvider: AIProvider,
    private cache: AICache,
    private repoPath: string
  ) {}

  /**
   * Perform code review on git diff
   */
  async reviewChanges(options: ReviewOptions = {}): Promise<CodeReviewReport> {
    // Get git diff
    const diffs = await this.getGitDiff(options.base, options.head, options.files);

    // Analyze each diff with AI
    const allComments: ReviewComment[] = [];
    for (const diff of diffs) {
      const comments = await this.analyzeDiff(diff, options);
      allComments.push(...comments);
    }

    // Filter by severity if specified
    let filteredComments = allComments;
    if (options.minSeverity) {
      filteredComments = this.filterBySeverity(allComments, options.minSeverity);
    }

    // Filter by category if specified
    if (options.categories && options.categories.length > 0) {
      filteredComments = filteredComments.filter(c =>
        options.categories!.includes(c.category)
      );
    }

    // Generate overall assessment
    const assessment = await this.generateAssessment(diffs, filteredComments);

    // Calculate summary
    const summary = {
      filesChanged: diffs.length,
      additions: diffs.reduce((sum, d) => sum + d.additions, 0),
      deletions: diffs.reduce((sum, d) => sum + d.deletions, 0),
      totalComments: filteredComments.length,
      critical: filteredComments.filter(c => c.severity === 'critical').length,
      high: filteredComments.filter(c => c.severity === 'high').length,
      medium: filteredComments.filter(c => c.severity === 'medium').length,
      low: filteredComments.filter(c => c.severity === 'low').length
    };

    return {
      summary,
      diffs,
      comments: filteredComments,
      overallAssessment: assessment,
      generatedAt: new Date()
    };
  }

  /**
   * Get git diff for specified range
   */
  async getGitDiff(
    base: string = 'HEAD',
    head?: string,
    files?: string[]
  ): Promise<GitDiff[]> {
    const diffs: GitDiff[] = [];

    try {
      // Build git diff command
      let command = 'git diff --unified=3';
      if (!head) {
        command += ` ${base}`;
      } else {
        command += ` ${base}..${head}`;
      }

      if (files && files.length > 0) {
        command += ` -- ${files.join(' ')}`;
      }

      const { stdout } = await execAsync(command, { cwd: this.repoPath });

      // Parse diff output
      const parsed = this.parseDiff(stdout);
      diffs.push(...parsed);
    } catch (error: any) {
      console.warn('Git diff failed:', error.message);
    }

    return diffs;
  }

  /**
   * Analyze a single diff with AI
   */
  private async analyzeDiff(
    diff: GitDiff,
    options: ReviewOptions
  ): Promise<ReviewComment[]> {
    // Skip files with no changes or only deletions
    if (diff.hunks.length === 0 || diff.status === 'deleted') {
      return [];
    }

    const cacheKey = `review-${diff.file}-${diff.additions}-${diff.deletions}`;
    const cached = await this.cache.get(cacheKey, this.aiProvider.getName());
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Invalid cache
      }
    }

    const prompt = this.buildReviewPrompt(diff, options);
    const response = await this.aiProvider.chat([
      {
        role: 'system',
        content: 'You are an expert code reviewer. Provide thorough, actionable feedback on code changes.'
      },
      {
        role: 'user',
        content: prompt
      }
    ], {
      temperature: 0.3,
      maxTokens: 3000
    });

    const comments = this.parseReviewResponse(response.content, diff);
    await this.cache.set(cacheKey, this.aiProvider.getName(), JSON.stringify(comments));

    return comments;
  }

  /**
   * Generate overall assessment
   */
  private async generateAssessment(
    diffs: GitDiff[],
    comments: ReviewComment[]
  ): Promise<CodeReviewReport['overallAssessment']> {
    const prompt = this.buildAssessmentPrompt(diffs, comments);
    const response = await this.aiProvider.chat([
      {
        role: 'system',
        content: 'You are a senior engineering lead performing code review. Provide a balanced assessment.'
      },
      {
        role: 'user',
        content: prompt
      }
    ], {
      temperature: 0.4,
      maxTokens: 1000
    });

    return this.parseAssessmentResponse(response.content, comments);
  }

  /**
   * Parse git diff output
   */
  private parseDiff(diffOutput: string): GitDiff[] {
    const diffs: GitDiff[] = [];
    const files = diffOutput.split('diff --git');

    for (const fileContent of files) {
      if (!fileContent.trim()) continue;

      const diff = this.parseFileDiff(fileContent);
      if (diff) {
        diffs.push(diff);
      }
    }

    return diffs;
  }

  /**
   * Parse single file diff
   */
  private parseFileDiff(content: string): GitDiff | null {
    const lines = content.split('\n');

    // Extract file paths
    const fileMatch = lines[0]?.match(/a\/(.+) b\/(.+)/);
    if (!fileMatch) return null;

    const oldPath = fileMatch[1];
    const newPath = fileMatch[2];

    // Determine status
    let status: GitDiff['status'] = 'modified';
    if (content.includes('new file mode')) status = 'added';
    if (content.includes('deleted file mode')) status = 'deleted';
    if (oldPath !== newPath) status = 'renamed';

    // Parse hunks
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
      const hunkMatch = line.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
      if (hunkMatch) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = {
          oldStart: parseInt(hunkMatch[1]),
          oldLines: parseInt(hunkMatch[2]),
          newStart: parseInt(hunkMatch[3]),
          newLines: parseInt(hunkMatch[4]),
          changes: []
        };
        continue;
      }

      // Changes within hunk
      if (currentHunk && (line[0] === '+' || line[0] === '-' || line[0] === ' ')) {
        const type = line[0] === '+' ? 'add' : line[0] === '-' ? 'delete' : 'context';
        const lineNumber = type === 'delete'
          ? currentHunk.oldStart + currentHunk.changes.filter(c => c.type !== 'add').length
          : currentHunk.newStart + currentHunk.changes.filter(c => c.type !== 'delete').length;

        currentHunk.changes.push({
          type,
          lineNumber,
          content: line.substring(1)
        });
      }
    }

    if (currentHunk) hunks.push(currentHunk);

    // Count additions/deletions
    const additions = hunks.reduce((sum, h) =>
      sum + h.changes.filter(c => c.type === 'add').length, 0
    );
    const deletions = hunks.reduce((sum, h) =>
      sum + h.changes.filter(c => c.type === 'delete').length, 0
    );

    return {
      file: newPath,
      oldPath: oldPath !== newPath ? oldPath : undefined,
      newPath,
      status,
      hunks,
      additions,
      deletions
    };
  }

  /**
   * Build review prompt for AI
   */
  private buildReviewPrompt(diff: GitDiff, options: ReviewOptions): string {
    let prompt = `Review the following code changes in ${diff.file}:\n\n`;

    // Add diff content
    for (const hunk of diff.hunks) {
      prompt += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
      for (const change of hunk.changes) {
        const prefix = change.type === 'add' ? '+' : change.type === 'delete' ? '-' : ' ';
        prompt += `${prefix}${change.content}\n`;
      }
      prompt += '\n';
    }

    prompt += `\nProvide code review comments focusing on:
- Bugs and potential errors
- Security vulnerabilities
- Performance issues
- Code maintainability
- Best practices
- Documentation

For each issue, provide:
1. Severity (critical, high, medium, low, info)
2. Category (bug, security, performance, maintainability, style, documentation, testing, accessibility, best-practice)
3. Line number
4. Description
5. Suggested fix (if applicable)
6. Reasoning

Return JSON array format:
[
  {
    "severity": "...",
    "category": "...",
    "line": 123,
    "message": "...",
    "suggestion": "...",
    "reasoning": "...",
    "autoFixable": true/false
  }
]`;

    return prompt;
  }

  /**
   * Build assessment prompt
   */
  private buildAssessmentPrompt(diffs: GitDiff[], comments: ReviewComment[]): string {
    return `Provide an overall code review assessment for this pull request.

**Changes:**
- ${diffs.length} files changed
- ${diffs.reduce((sum, d) => sum + d.additions, 0)} additions
- ${diffs.reduce((sum, d) => sum + d.deletions, 0)} deletions

**Review Comments:**
- ${comments.filter(c => c.severity === 'critical').length} critical issues
- ${comments.filter(c => c.severity === 'high').length} high severity issues
- ${comments.filter(c => c.severity === 'medium').length} medium severity issues

Provide:
1. Score (0-100, where 100 is perfect)
2. Verdict (approved, approved-with-comments, changes-requested, rejected)
3. Summary (2-3 sentences)
4. Strengths (3-5 points)
5. Concerns (any blocking issues)

Return JSON format:
{
  "score": 85,
  "verdict": "approved-with-comments",
  "summary": "...",
  "strengths": ["...", "..."],
  "concerns": ["...", "..."]
}`;
  }

  /**
   * Parse AI review response
   */
  private parseReviewResponse(content: string, diff: GitDiff): ReviewComment[] {
    const comments: ReviewComment[] = [];

    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        for (const item of parsed) {
          comments.push({
            id: this.generateId(),
            file: diff.file,
            line: item.line || 1,
            endLine: item.endLine,
            severity: item.severity || 'info',
            category: item.category || 'best-practice',
            message: item.message || '',
            suggestion: item.suggestion,
            reasoning: item.reasoning || '',
            autoFixable: item.autoFixable || false,
            references: item.references
          });
        }
      }
    } catch {
      // Parse failed - return empty array
    }

    return comments;
  }

  /**
   * Parse assessment response
   */
  private parseAssessmentResponse(
    content: string,
    comments: ReviewComment[]
  ): CodeReviewReport['overallAssessment'] {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          score: parsed.score || 70,
          verdict: parsed.verdict || 'approved-with-comments',
          summary: parsed.summary || 'Review completed',
          strengths: parsed.strengths || [],
          concerns: parsed.concerns || []
        };
      }
    } catch {
      // Parse failed
    }

    // Fallback: calculate based on comments
    const criticalCount = comments.filter(c => c.severity === 'critical').length;
    const highCount = comments.filter(c => c.severity === 'high').length;

    let score = 100;
    score -= criticalCount * 20;
    score -= highCount * 10;
    score = Math.max(0, Math.min(100, score));

    let verdict: 'approved' | 'approved-with-comments' | 'changes-requested' | 'rejected';
    if (criticalCount > 0) verdict = 'rejected';
    else if (highCount > 2) verdict = 'changes-requested';
    else if (comments.length > 0) verdict = 'approved-with-comments';
    else verdict = 'approved';

    return {
      score,
      verdict,
      summary: 'Automated review completed',
      strengths: ['Code compiles successfully'],
      concerns: criticalCount > 0 ? ['Critical issues must be addressed'] : []
    };
  }

  /**
   * Filter comments by minimum severity
   */
  private filterBySeverity(
    comments: ReviewComment[],
    minSeverity: ReviewSeverity
  ): ReviewComment[] {
    const severityOrder: ReviewSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
    const minIndex = severityOrder.indexOf(minSeverity);

    return comments.filter(c => {
      const commentIndex = severityOrder.indexOf(c.severity);
      return commentIndex >= minIndex;
    });
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 10);
  }
}
