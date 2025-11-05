import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface Rule {
  id: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  languages?: string[];  // e.g., ['typescript', 'javascript']
  patterns?: RulePattern[];
  semgrep?: SemgrepPattern;
  autofix?: AutofixConfig;
  metadata?: {
    cwe?: string[];
    owasp?: string[];
    references?: string[];
  };
}

export interface RulePattern {
  type: 'regex' | 'ast';
  pattern: string;
  message?: string;
  exclude?: string[];  // Patterns to exclude
}

export interface SemgrepPattern {
  pattern?: string;
  patterns?: string[];  // Multiple patterns (AND logic)
  patternEither?: string[];  // Multiple patterns (OR logic)
  patternNot?: string[];  // Exclusion patterns
}

export interface AutofixConfig {
  type: 'replace' | 'insert-before' | 'insert-after' | 'remove';
  pattern?: string;  // What to replace
  replacement?: string;  // What to replace with
  message?: string;  // Description of the fix
}

export interface RuleViolation {
  ruleId: string;
  ruleName: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  file: string;
  line: number;
  column?: number;
  message: string;
  suggestion?: string;
  autofix?: {
    available: boolean;
    description: string;
    patch?: string;
  };
}

export interface RuleResult {
  totalViolations: number;
  violations: RuleViolation[];
  rulesSummary: {
    [ruleId: string]: {
      count: number;
      severity: string;
    };
  };
  severitySummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  timestamp: string;
}

export class RuleEngine {
  private rules: Map<string, Rule> = new Map();
  private readonly RULES_DIR = '.ai-review/rules';
  private readonly BUILTIN_RULES_DIR = path.join(__dirname, '../../rules');

  constructor() {
    this.loadBuiltinRules();
  }

  /**
   * Load built-in rules
   */
  private loadBuiltinRules(): void {
    const builtinRules = this.getBuiltinRules();
    for (const rule of builtinRules) {
      this.rules.set(rule.id, rule);
    }
  }

  /**
   * Load custom rules from directory
   */
  loadCustomRules(rulesDir?: string): void {
    const dir = rulesDir || this.RULES_DIR;

    if (!fs.existsSync(dir)) {
      return;
    }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8');
        const ruleData = yaml.load(content) as any;

        // Support multiple rules per file
        const rules = Array.isArray(ruleData) ? ruleData : [ruleData];

        for (const rule of rules) {
          if (this.validateRule(rule)) {
            this.rules.set(rule.id, rule as Rule);
          }
        }
      } catch (error) {
        console.error(`Failed to load rule from ${file}:`, error);
      }
    }
  }

  /**
   * Validate rule structure
   */
  private validateRule(rule: any): boolean {
    if (!rule.id || !rule.name || !rule.severity || !rule.category) {
      return false;
    }

    if (!rule.patterns && !rule.semgrep) {
      return false;
    }

    const validSeverities = ['critical', 'high', 'medium', 'low', 'info'];
    if (!validSeverities.includes(rule.severity)) {
      return false;
    }

    return true;
  }

  /**
   * Run all enabled rules
   */
  async runRules(files: string[], ruleIds?: string[]): Promise<RuleResult> {
    const violations: RuleViolation[] = [];
    const rulesToRun = ruleIds
      ? Array.from(this.rules.values()).filter(r => ruleIds.includes(r.id))
      : Array.from(this.rules.values());

    // Run regex-based rules
    for (const rule of rulesToRun) {
      if (rule.patterns) {
        const ruleViolations = await this.runRegexRule(rule, files);
        violations.push(...ruleViolations);
      }
    }

    // Run semgrep-based rules if available
    const semgrepRules = rulesToRun.filter(r => r.semgrep);
    if (semgrepRules.length > 0 && this.isSemgrepAvailable()) {
      const semgrepViolations = await this.runSemgrepRules(semgrepRules, files);
      violations.push(...semgrepViolations);
    }

    // Build summary
    const result: RuleResult = {
      totalViolations: violations.length,
      violations,
      rulesSummary: this.buildRulesSummary(violations),
      severitySummary: this.buildSeveritySummary(violations),
      timestamp: new Date().toISOString(),
    };

    return result;
  }

  /**
   * Run regex-based rule
   */
  private async runRegexRule(rule: Rule, files: string[]): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = [];

    for (const file of files) {
      // Check language match
      if (rule.languages && rule.languages.length > 0) {
        const ext = path.extname(file).slice(1);
        const languageMap: { [key: string]: string[] } = {
          'typescript': ['ts', 'tsx'],
          'javascript': ['js', 'jsx'],
          'python': ['py'],
          'java': ['java'],
          'go': ['go'],
          'rust': ['rs'],
          'ruby': ['rb'],
        };

        let matches = false;
        for (const lang of rule.languages) {
          const exts = languageMap[lang] || [lang];
          if (exts.includes(ext)) {
            matches = true;
            break;
          }
        }

        if (!matches) {
          continue;
        }
      }

      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        for (const pattern of rule.patterns || []) {
          if (pattern.type !== 'regex') continue;

          const regex = new RegExp(pattern.pattern, 'gm');
          let match;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check exclusion patterns
            if (pattern.exclude) {
              let excluded = false;
              for (const excludePattern of pattern.exclude) {
                if (new RegExp(excludePattern).test(line)) {
                  excluded = true;
                  break;
                }
              }
              if (excluded) continue;
            }

            regex.lastIndex = 0;  // Reset regex
            match = regex.exec(line);

            if (match) {
              violations.push({
                ruleId: rule.id,
                ruleName: rule.name,
                severity: rule.severity,
                category: rule.category,
                file,
                line: i + 1,
                column: match.index,
                message: pattern.message || rule.description,
                suggestion: this.generateSuggestion(rule),
                autofix: rule.autofix ? {
                  available: true,
                  description: rule.autofix.message || 'Auto-fix available',
                  patch: this.generatePatch(rule.autofix, line, match),
                } : undefined,
              });
            }
          }
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    return violations;
  }

  /**
   * Run semgrep-based rules
   */
  private async runSemgrepRules(rules: Rule[], files: string[]): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = [];

    // Generate temporary semgrep config
    const configPath = '/tmp/semgrep-rules.yml';
    const config = {
      rules: rules.map(rule => this.convertToSemgrepConfig(rule)),
    };

    fs.writeFileSync(configPath, yaml.dump(config));

    try {
      // Run semgrep
      const output = execSync(`semgrep --config ${configPath} --json ${files.join(' ')}`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,  // 10MB
      });

      const results = JSON.parse(output);

      // Parse semgrep results
      for (const result of results.results || []) {
        const rule = this.rules.get(result.check_id);
        if (!rule) continue;

        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          category: rule.category,
          file: result.path,
          line: result.start.line,
          column: result.start.col,
          message: result.extra.message || rule.description,
          suggestion: this.generateSuggestion(rule),
          autofix: rule.autofix && result.extra.fix ? {
            available: true,
            description: rule.autofix.message || 'Auto-fix available',
            patch: result.extra.fix,
          } : undefined,
        });
      }

      // Clean up
      fs.unlinkSync(configPath);
    } catch (error: any) {
      // Semgrep might fail, but we still have regex rules
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    }

    return violations;
  }

  /**
   * Convert rule to semgrep config format
   */
  private convertToSemgrepConfig(rule: Rule): any {
    const semgrepRule: any = {
      id: rule.id,
      message: rule.description,
      severity: rule.severity.toUpperCase(),
      languages: rule.languages || ['javascript', 'typescript'],
    };

    if (rule.semgrep) {
      if (rule.semgrep.pattern) {
        semgrepRule.pattern = rule.semgrep.pattern;
      }
      if (rule.semgrep.patterns) {
        semgrepRule.patterns = rule.semgrep.patterns.map(p => ({ pattern: p }));
      }
      if (rule.semgrep.patternEither) {
        semgrepRule['pattern-either'] = rule.semgrep.patternEither.map(p => ({ pattern: p }));
      }
      if (rule.semgrep.patternNot) {
        semgrepRule['pattern-not'] = rule.semgrep.patternNot.map(p => ({ pattern: p }));
      }
    }

    if (rule.autofix) {
      semgrepRule.fix = rule.autofix.replacement;
    }

    if (rule.metadata) {
      semgrepRule.metadata = rule.metadata;
    }

    return semgrepRule;
  }

  /**
   * Generate suggestion from rule
   */
  private generateSuggestion(rule: Rule): string {
    if (rule.autofix) {
      return rule.autofix.message || 'Apply auto-fix to resolve this issue';
    }

    // Generate generic suggestion based on category
    const suggestions: { [key: string]: string } = {
      'security': 'Review and fix this security vulnerability',
      'performance': 'Optimize this code for better performance',
      'maintainability': 'Refactor this code for better maintainability',
      'style': 'Update code style to match conventions',
      'best-practices': 'Follow best practices for this pattern',
    };

    return suggestions[rule.category.toLowerCase()] || 'Review and fix this issue';
  }

  /**
   * Generate patch for autofix
   */
  private generatePatch(autofix: AutofixConfig, line: string, match: RegExpExecArray): string {
    switch (autofix.type) {
      case 'replace':
        if (autofix.pattern && autofix.replacement) {
          return line.replace(new RegExp(autofix.pattern), autofix.replacement);
        }
        break;
      case 'insert-before':
        if (autofix.replacement) {
          return `${autofix.replacement}\n${line}`;
        }
        break;
      case 'insert-after':
        if (autofix.replacement) {
          return `${line}\n${autofix.replacement}`;
        }
        break;
      case 'remove':
        return '';
    }

    return line;
  }

  /**
   * Apply autofix to violations
   */
  async applyAutofixes(violations: RuleViolation[]): Promise<number> {
    let fixedCount = 0;
    const filePatches = new Map<string, Map<number, string>>();

    // Group violations by file and line
    for (const violation of violations) {
      if (!violation.autofix?.available || !violation.autofix.patch) {
        continue;
      }

      if (!filePatches.has(violation.file)) {
        filePatches.set(violation.file, new Map());
      }

      filePatches.get(violation.file)!.set(violation.line, violation.autofix.patch);
    }

    // Apply patches to files
    for (const [file, patches] of filePatches.entries()) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        // Apply patches in reverse order to maintain line numbers
        const sortedLines = Array.from(patches.keys()).sort((a, b) => b - a);

        for (const lineNum of sortedLines) {
          const patch = patches.get(lineNum)!;
          lines[lineNum - 1] = patch;
          fixedCount++;
        }

        fs.writeFileSync(file, lines.join('\n'));
      } catch (error) {
        console.error(`Failed to apply autofix to ${file}:`, error);
      }
    }

    return fixedCount;
  }

  /**
   * Build rules summary
   */
  private buildRulesSummary(violations: RuleViolation[]): { [ruleId: string]: { count: number; severity: string } } {
    const summary: { [ruleId: string]: { count: number; severity: string } } = {};

    for (const violation of violations) {
      if (!summary[violation.ruleId]) {
        summary[violation.ruleId] = {
          count: 0,
          severity: violation.severity,
        };
      }
      summary[violation.ruleId].count++;
    }

    return summary;
  }

  /**
   * Build severity summary
   */
  private buildSeveritySummary(violations: RuleViolation[]): {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  } {
    const summary = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };

    for (const violation of violations) {
      summary[violation.severity]++;
    }

    return summary;
  }

  /**
   * Check if semgrep is available
   */
  private isSemgrepAvailable(): boolean {
    try {
      execSync('semgrep --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Export rule to file
   */
  exportRule(rule: Rule, filePath: string): void {
    const yaml_content = yaml.dump(rule);
    fs.writeFileSync(filePath, yaml_content);
  }

  /**
   * Get all loaded rules
   */
  getRules(): Rule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get rule by ID
   */
  getRule(id: string): Rule | undefined {
    return this.rules.get(id);
  }

  /**
   * Get built-in rules library
   */
  private getBuiltinRules(): Rule[] {
    return [
      // Security Rules
      {
        id: 'no-hardcoded-secrets',
        name: 'No Hardcoded Secrets',
        description: 'Detects hardcoded passwords, API keys, and tokens',
        severity: 'critical',
        category: 'security',
        languages: ['typescript', 'javascript', 'python', 'java'],
        patterns: [{
          type: 'regex',
          pattern: '(password|passwd|pwd|secret|api[_-]?key|apikey|token|auth[_-]?token)\\s*[=:]\\s*[\'"][^\'"]{8,}[\'"]',
          message: 'Hardcoded secret detected',
        }],
        autofix: {
          type: 'replace',
          pattern: '[\'"][^\'"]+[\'"]',
          replacement: 'process.env.API_KEY',
          message: 'Replace with environment variable',
        },
        metadata: {
          cwe: ['CWE-798'],
          owasp: ['A02:2021'],
          references: ['https://owasp.org/Top10/A02_2021-Cryptographic_Failures/'],
        },
      },
      {
        id: 'sql-injection',
        name: 'SQL Injection Vulnerability',
        description: 'Detects potential SQL injection vulnerabilities',
        severity: 'critical',
        category: 'security',
        languages: ['typescript', 'javascript', 'python', 'java'],
        patterns: [{
          type: 'regex',
          pattern: '(query|execute)\\s*\\([^)]*\\+[^)]*\\)',
          message: 'Potential SQL injection - use parameterized queries',
        }],
        metadata: {
          cwe: ['CWE-89'],
          owasp: ['A03:2021'],
        },
      },
      {
        id: 'xss-vulnerability',
        name: 'XSS Vulnerability',
        description: 'Detects potential cross-site scripting vulnerabilities',
        severity: 'high',
        category: 'security',
        languages: ['typescript', 'javascript'],
        patterns: [{
          type: 'regex',
          pattern: 'innerHTML\\s*=|dangerouslySetInnerHTML',
          message: 'Potential XSS vulnerability - sanitize HTML content',
        }],
        metadata: {
          cwe: ['CWE-79'],
          owasp: ['A03:2021'],
        },
      },
      {
        id: 'eval-usage',
        name: 'Dangerous eval() Usage',
        description: 'Detects usage of eval() which can lead to code injection',
        severity: 'high',
        category: 'security',
        languages: ['typescript', 'javascript', 'python'],
        patterns: [{
          type: 'regex',
          pattern: '\\beval\\s*\\(',
          message: 'Avoid eval() - use safer alternatives',
        }],
        metadata: {
          cwe: ['CWE-95'],
        },
      },

      // Performance Rules
      {
        id: 'no-sync-fs',
        name: 'No Synchronous File Operations',
        description: 'Avoid synchronous file system operations in async contexts',
        severity: 'medium',
        category: 'performance',
        languages: ['typescript', 'javascript'],
        patterns: [{
          type: 'regex',
          pattern: 'fs\\.(readFileSync|writeFileSync|existsSync|readdirSync)',
          message: 'Use async file operations for better performance',
        }],
        autofix: {
          type: 'replace',
          pattern: 'Sync',
          replacement: '',
          message: 'Convert to async operation',
        },
      },
      {
        id: 'no-console-log',
        name: 'No Console Logs in Production',
        description: 'Remove console.log statements before production',
        severity: 'low',
        category: 'best-practices',
        languages: ['typescript', 'javascript'],
        patterns: [{
          type: 'regex',
          pattern: 'console\\.(log|debug|info)\\(',
          message: 'Remove console statements or use proper logging',
          exclude: ['\\.test\\.', '\\.spec\\.'],
        }],
        autofix: {
          type: 'remove',
          message: 'Remove console statement',
        },
      },

      // Code Quality Rules
      {
        id: 'no-var',
        name: 'Use const/let instead of var',
        description: 'var has function scope issues - use const or let',
        severity: 'medium',
        category: 'best-practices',
        languages: ['typescript', 'javascript'],
        patterns: [{
          type: 'regex',
          pattern: '\\bvar\\s+',
          message: 'Use const or let instead of var',
        }],
        autofix: {
          type: 'replace',
          pattern: '\\bvar\\s+',
          replacement: 'const ',
          message: 'Replace var with const',
        },
      },
      {
        id: 'no-any',
        name: 'Avoid TypeScript any type',
        description: 'Using any defeats the purpose of TypeScript',
        severity: 'medium',
        category: 'best-practices',
        languages: ['typescript'],
        patterns: [{
          type: 'regex',
          pattern: ':\\s*any\\b',
          message: 'Use specific type instead of any',
        }],
      },
      {
        id: 'no-todo-comments',
        name: 'No TODO Comments',
        description: 'TODO comments should be tracked as issues',
        severity: 'info',
        category: 'maintainability',
        patterns: [{
          type: 'regex',
          pattern: '//\\s*TODO:',
          message: 'Create an issue instead of TODO comment',
        }],
      },

      // Error Handling Rules
      {
        id: 'no-empty-catch',
        name: 'No Empty Catch Blocks',
        description: 'Catch blocks should handle or log errors',
        severity: 'medium',
        category: 'best-practices',
        languages: ['typescript', 'javascript', 'python', 'java'],
        patterns: [{
          type: 'regex',
          pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}',
          message: 'Empty catch block - handle or log the error',
        }],
      },
      {
        id: 'no-promise-without-catch',
        name: 'Promises should have catch handlers',
        description: 'Unhandled promise rejections can crash the application',
        severity: 'high',
        category: 'best-practices',
        languages: ['typescript', 'javascript'],
        patterns: [{
          type: 'regex',
          pattern: '\\.then\\([^)]+\\)(?!.*\\.catch)',
          message: 'Add .catch() handler to promise chain',
        }],
      },

      // Cryptography Rules
      {
        id: 'weak-crypto',
        name: 'Weak Cryptographic Algorithm',
        description: 'MD5 and SHA1 are cryptographically broken',
        severity: 'high',
        category: 'security',
        patterns: [{
          type: 'regex',
          pattern: '\\b(md5|sha1)\\b',
          message: 'Use SHA-256 or stronger cryptographic hash',
        }],
        metadata: {
          cwe: ['CWE-327'],
        },
      },
      {
        id: 'weak-random',
        name: 'Weak Random Number Generation',
        description: 'Math.random() is not cryptographically secure',
        severity: 'medium',
        category: 'security',
        languages: ['typescript', 'javascript'],
        patterns: [{
          type: 'regex',
          pattern: 'Math\\.random\\(\\)',
          message: 'Use crypto.randomBytes() for security-sensitive operations',
        }],
        autofix: {
          type: 'replace',
          pattern: 'Math\\.random\\(\\)',
          replacement: 'crypto.randomBytes(4).readUInt32LE() / 0xffffffff',
          message: 'Replace with crypto.randomBytes()',
        },
      },

      // Additional Rules
      {
        id: 'no-deprecated-apis',
        name: 'No Deprecated APIs',
        description: 'Avoid using deprecated APIs',
        severity: 'medium',
        category: 'maintainability',
        patterns: [{
          type: 'regex',
          pattern: '@deprecated',
          message: 'This API is deprecated - check documentation for alternative',
        }],
      },
      {
        id: 'no-magic-numbers',
        name: 'No Magic Numbers',
        description: 'Use named constants instead of magic numbers',
        severity: 'low',
        category: 'maintainability',
        patterns: [{
          type: 'regex',
          pattern: '\\b([0-9]{4,}|[0-9]+\\.[0-9]{2,})\\b',
          message: 'Extract magic number to named constant',
          exclude: ['0', '1', '100', '1000'],
        }],
      },
    ];
  }
}

export const ruleEngine = new RuleEngine();
