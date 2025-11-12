import * as fs from 'fs';
import * as path from 'path';

export interface APIFinding {
  type: string;
  file: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
  category: 'REST' | 'GraphQL' | 'General';
}

export class APIScanner {
  /**
   * Scan for API security vulnerabilities
   */
  async scan(repoPath: string = process.cwd()): Promise<APIFinding[]> {
    const findings: APIFinding[] = [];
    const files = this.findAPIFiles(repoPath);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const language = this.detectLanguage(file);

        findings.push(...this.scanRESTAPI(file, content, language));
        findings.push(...this.scanGraphQL(file, content, language));
        findings.push(...this.scanGeneralAPI(file, content, language));
      } catch {
        // Skip files that can't be read
      }
    }

    return findings;
  }

  /**
   * Find API-related files
   */
  private findAPIFiles(dir: string): string[] {
    const files: string[] = [];

    const search = (currentDir: string, depth: number) => {
      if (depth > 5) return;

      try {
        const items = fs.readdirSync(currentDir);
        for (const item of items) {
          if (item === 'node_modules' || item === '.git' || item === 'vendor') continue;

          const fullPath = path.join(currentDir, item);
          const stat = fs.statSync(fullPath);

          if (stat.isDirectory()) {
            search(fullPath, depth + 1);
          } else if (this.isAPIFile(item)) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    search(dir, 0);
    return files;
  }

  /**
   * Check if file is likely to contain API code
   */
  private isAPIFile(filename: string): boolean {
    const apiPatterns = [
      /route/i, /controller/i, /handler/i, /endpoint/i,
      /api/i, /service/i, /resolver/i, /graphql/i
    ];

    const extensions = ['.js', '.ts', '.py', '.go', '.java', '.rb', '.php'];

    return extensions.some(ext => filename.endsWith(ext)) &&
           (apiPatterns.some(pattern => pattern.test(filename)) || true);
  }

  /**
   * Detect programming language from file extension
   */
  private detectLanguage(file: string): string {
    const ext = path.extname(file);
    const langMap: Record<string, string> = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.py': 'python',
      '.go': 'go',
      '.java': 'java',
      '.rb': 'ruby',
      '.php': 'php',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Scan for REST API vulnerabilities
   */
  private scanRESTAPI(file: string, content: string, language: string): APIFinding[] {
    const findings: APIFinding[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Missing authentication/authorization
      if (this.isMissingAuth(line, lines, i)) {
        findings.push({
          type: 'Missing Authentication',
          file,
          line: lineNum,
          severity: 'critical',
          description: 'API endpoint appears to lack authentication checks',
          recommendation: 'Add authentication middleware or decorator before handling requests',
          category: 'REST',
        });
      }

      // Missing rate limiting
      if (this.isMissingRateLimit(line, lines, i)) {
        findings.push({
          type: 'Missing Rate Limiting',
          file,
          line: lineNum,
          severity: 'high',
          description: 'API endpoint lacks rate limiting protection',
          recommendation: 'Implement rate limiting to prevent abuse (e.g., express-rate-limit, flask-limiter)',
          category: 'REST',
        });
      }

      // Insecure HTTP methods
      if (/\.(delete|put|patch)\s*\(/i.test(line) && !this.hasAuthCheck(lines, i)) {
        findings.push({
          type: 'Unprotected Destructive Operation',
          file,
          line: lineNum,
          severity: 'critical',
          description: 'Destructive HTTP method (DELETE/PUT/PATCH) without authentication',
          recommendation: 'Require authentication and authorization for destructive operations',
          category: 'REST',
        });
      }

      // Missing input validation
      if (this.isMissingInputValidation(line, language)) {
        findings.push({
          type: 'Missing Input Validation',
          file,
          line: lineNum,
          severity: 'high',
          description: 'API endpoint may lack input validation',
          recommendation: 'Use validation libraries (joi, yup, pydantic, etc.) to validate all inputs',
          category: 'REST',
        });
      }

      // Excessive data exposure
      if (/\.findAll\(\)|\.find\(\{\}\)|SELECT \* FROM/i.test(line)) {
        findings.push({
          type: 'Potential Excessive Data Exposure',
          file,
          line: lineNum,
          severity: 'medium',
          description: 'Endpoint may return excessive data without filtering',
          recommendation: 'Only return necessary fields, implement field selection/projection',
          category: 'REST',
        });
      }

      // Missing CORS configuration
      if (/cors\(\)/i.test(line) && !/origin:/i.test(line)) {
        findings.push({
          type: 'Permissive CORS Configuration',
          file,
          line: lineNum,
          severity: 'medium',
          description: 'CORS enabled without origin restrictions',
          recommendation: 'Specify allowed origins explicitly instead of allowing all',
          category: 'REST',
        });
      }

      // API versioning issues
      if (/(\/api\/|router\.|app\.)/.test(line) && !/\/v[0-9]/.test(line)) {
        findings.push({
          type: 'Missing API Versioning',
          file,
          line: lineNum,
          severity: 'low',
          description: 'API endpoint lacks version identifier',
          recommendation: 'Include version in URL path (e.g., /api/v1/...) for better maintainability',
          category: 'REST',
        });
      }
    }

    return findings;
  }

  /**
   * Scan for GraphQL security issues
   */
  private scanGraphQL(file: string, content: string, language: string): APIFinding[] {
    const findings: APIFinding[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Missing query depth limiting
      if (/graphql|apollo|GraphQLSchema/i.test(line)) {
        const hasDepthLimit = content.includes('depthLimit') ||
                             content.includes('queryDepth') ||
                             content.includes('maxDepth');

        if (!hasDepthLimit) {
          findings.push({
            type: 'Missing Query Depth Limiting',
            file,
            line: lineNum,
            severity: 'high',
            description: 'GraphQL server lacks query depth limiting (vulnerable to DoS)',
            recommendation: 'Implement query depth limiting (e.g., graphql-depth-limit)',
            category: 'GraphQL',
          });
        }
      }

      // Missing query complexity analysis
      if (/graphql|apollo/i.test(line)) {
        const hasComplexity = content.includes('queryComplexity') ||
                             content.includes('complexityLimit') ||
                             content.includes('maxComplexity');

        if (!hasComplexity) {
          findings.push({
            type: 'Missing Query Complexity Analysis',
            file,
            line: lineNum,
            severity: 'high',
            description: 'GraphQL server lacks query complexity analysis',
            recommendation: 'Implement query complexity limits (e.g., graphql-query-complexity)',
            category: 'GraphQL',
          });
        }
      }

      // Introspection enabled in production
      if (/introspection:\s*true/i.test(line)) {
        findings.push({
          type: 'GraphQL Introspection Enabled',
          file,
          line: lineNum,
          severity: 'medium',
          description: 'GraphQL introspection is enabled (exposes schema)',
          recommendation: 'Disable introspection in production environments',
          category: 'GraphQL',
        });
      }

      // Missing field-level authorization
      if (/@resolver|type\s+\w+\s*{/i.test(line)) {
        const hasFieldAuth = content.includes('@auth') ||
                            content.includes('@authenticated') ||
                            content.includes('checkAuth');

        if (!hasFieldAuth) {
          findings.push({
            type: 'Missing Field-Level Authorization',
            file,
            line: lineNum,
            severity: 'high',
            description: 'GraphQL resolver may lack field-level authorization',
            recommendation: 'Implement field-level authorization directives or middleware',
            category: 'GraphQL',
          });
        }
      }

      // N+1 query problem
      if (/@resolver/i.test(line) && !content.includes('dataloader')) {
        findings.push({
          type: 'Potential N+1 Query Problem',
          file,
          line: lineNum,
          severity: 'medium',
          description: 'GraphQL resolver may have N+1 query performance issues',
          recommendation: 'Use DataLoader to batch and cache database requests',
          category: 'GraphQL',
        });
      }
    }

    return findings;
  }

  /**
   * Scan for general API security issues
   */
  private scanGeneralAPI(file: string, content: string, language: string): APIFinding[] {
    const findings: APIFinding[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Hardcoded API keys in headers
      if (/(Authorization|X-API-Key|Bearer)\s*[:=]\s*['"][^'"]{20,}['"]/i.test(line)) {
        findings.push({
          type: 'Hardcoded API Key',
          file,
          line: lineNum,
          severity: 'critical',
          description: 'API key or token appears to be hardcoded',
          recommendation: 'Use environment variables or secrets manager for API keys',
          category: 'General',
        });
      }

      // Missing error handling
      if (/(res\.send|response\.json|return\s+json)/i.test(line) && !this.hasErrorHandling(lines, i)) {
        findings.push({
          type: 'Missing Error Handling',
          file,
          line: lineNum,
          severity: 'medium',
          description: 'API endpoint may lack proper error handling',
          recommendation: 'Wrap endpoint logic in try-catch and return appropriate error responses',
          category: 'General',
        });
      }

      // Sensitive data in logs
      if (/(console\.log|logger\.|print\(|fmt\.Print)/.test(line) &&
          /(password|token|secret|key|auth)/i.test(line)) {
        findings.push({
          type: 'Sensitive Data in Logs',
          file,
          line: lineNum,
          severity: 'high',
          description: 'Potentially logging sensitive data',
          recommendation: 'Never log passwords, tokens, or other sensitive information',
          category: 'General',
        });
      }

      // Missing HTTPS enforcement
      if (/http:\/\//i.test(line) && !/(localhost|127\.0\.0\.1)/i.test(line)) {
        findings.push({
          type: 'Insecure HTTP Usage',
          file,
          line: lineNum,
          severity: 'high',
          description: 'Using HTTP instead of HTTPS for API communication',
          recommendation: 'Always use HTTPS for API endpoints',
          category: 'General',
        });
      }

      // Missing request timeout
      if (/(axios|fetch|requests\.get|http\.get)/.test(line) && !/(timeout|deadline)/i.test(line)) {
        findings.push({
          type: 'Missing Request Timeout',
          file,
          line: lineNum,
          severity: 'low',
          description: 'HTTP request lacks timeout configuration',
          recommendation: 'Set appropriate timeout values to prevent hanging requests',
          category: 'General',
        });
      }
    }

    return findings;
  }

  /**
   * Check if endpoint is missing authentication
   */
  private isMissingAuth(line: string, lines: string[], index: number): boolean {
    // Look for route definitions
    const routePattern = /(app\.|router\.|@(Get|Post|Put|Delete|Patch))/i;
    if (!routePattern.test(line)) return false;

    // Check surrounding lines for auth middleware/decorators
    const contextLines = lines.slice(Math.max(0, index - 3), index + 1).join('\n');
    const hasAuth = /(authenticate|authorize|@auth|requireAuth|isAuthenticated|protected|middleware.*auth)/i.test(contextLines);

    return !hasAuth;
  }

  /**
   * Check if endpoint is missing rate limiting
   */
  private isMissingRateLimit(line: string, lines: string[], index: number): boolean {
    const routePattern = /(app\.|router\.|@(Get|Post|Put|Delete|Patch))/i;
    if (!routePattern.test(line)) return false;

    const contextLines = lines.slice(Math.max(0, index - 3), index + 1).join('\n');
    const hasRateLimit = /(rateLimit|limiter|throttle|@RateLimit)/i.test(contextLines);

    return !hasRateLimit;
  }

  /**
   * Check if there's an auth check in surrounding context
   */
  private hasAuthCheck(lines: string[], index: number): boolean {
    const contextLines = lines.slice(Math.max(0, index - 5), Math.min(lines.length, index + 5)).join('\n');
    return /(authenticate|authorize|checkAuth|requireAuth|isAuthenticated|@auth)/i.test(contextLines);
  }

  /**
   * Check if input validation is missing
   */
  private isMissingInputValidation(line: string, language: string): boolean {
    // Route handler that accepts parameters
    const hasParams = /(req\.body|req\.params|req\.query|request\.json|@Body|@Param|@Query)/i.test(line);
    if (!hasParams) return false;

    // Check for validation libraries
    const hasValidation = /(joi|yup|validator|pydantic|validate|schema|@Valid|@Validated)/i.test(line);
    return !hasValidation;
  }

  /**
   * Check if error handling exists
   */
  private hasErrorHandling(lines: string[], index: number): boolean {
    const contextLines = lines.slice(Math.max(0, index - 10), Math.min(lines.length, index + 3)).join('\n');
    return /(try\s*{|catch\s*\(|except|recover|\.catch\(|error|Error)/i.test(contextLines);
  }
}

export const apiScanner = new APIScanner();
