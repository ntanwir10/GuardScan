import * as fs from 'fs';
import * as path from 'path';
import { Finding } from '../utils/reporter';

/**
 * OWASP Top 10 2021 Scanner
 * Covers all 10 categories with pattern-based detection
 */
export class OwaspScanner {
  /**
   * Scan repository for OWASP Top 10 vulnerabilities
   */
  async scan(repoPath: string = process.cwd()): Promise<Finding[]> {
    const findings: Finding[] = [];
    const files = this.findCodeFiles(repoPath);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const language = this.detectLanguage(file);
        findings.push(...this.scanFile(file, content, language));
      } catch {
        // Skip files that can't be read
      }
    }

    return findings;
  }

  /**
   * Find code files to scan
   */
  private findCodeFiles(dir: string): string[] {
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
          } else if (this.isCodeFile(item)) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip
      }
    };

    search(dir, 0);
    return files;
  }

  /**
   * Check if file is a code file
   */
  private isCodeFile(filename: string): boolean {
    const extensions = ['.js', '.ts', '.py', '.go', '.java', '.rb', '.php'];
    return extensions.some(ext => filename.endsWith(ext));
  }

  /**
   * Detect programming language
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
   * Scan file content for OWASP Top 10 vulnerabilities
   */
  scanFile(filePath: string, content: string, language: string): Finding[] {
    const findings: Finding[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // A01: Broken Access Control
      findings.push(...this.checkAccessControl(line, filePath, lineNum, language));

      // A02: Cryptographic Failures
      findings.push(...this.checkCryptography(line, filePath, lineNum, language));

      // A03: Injection
      findings.push(...this.checkInjection(line, filePath, lineNum, language));

      // A04: Insecure Design
      findings.push(...this.checkInsecureDesign(line, filePath, lineNum, language));

      // A05: Security Misconfiguration
      findings.push(...this.checkMisconfiguration(line, filePath, lineNum, language));

      // A06: Vulnerable and Outdated Components (handled by dependency scanner)

      // A07: Identification and Authentication Failures
      findings.push(...this.checkAuthentication(line, filePath, lineNum, language));

      // A08: Software and Data Integrity Failures
      findings.push(...this.checkIntegrity(line, filePath, lineNum, language));

      // A09: Security Logging and Monitoring Failures
      findings.push(...this.checkLogging(line, filePath, lineNum, language));

      // A10: Server-Side Request Forgery (SSRF)
      findings.push(...this.checkSSRF(line, filePath, lineNum, language));
    }

    return findings;
  }

  /**
   * A01: Broken Access Control
   */
  private checkAccessControl(line: string, file: string, lineNum: number, language: string): Finding[] {
    const findings: Finding[] = [];

    // Path traversal
    if (/\.\.\/|\.\.\\/.test(line) && /file|path|dir|read|write/i.test(line)) {
      findings.push({
        severity: 'high',
        category: 'OWASP A01 - Broken Access Control',
        file,
        line: lineNum,
        description: 'Potential path traversal vulnerability',
        suggestion: 'Validate and sanitize file paths, use allowlist',
      });
    }

    // Insecure direct object references
    if (/\?id=|\&id=|\/id\/|\[id\]/.test(line) && !/parseInt|Number|validate/.test(line)) {
      findings.push({
        severity: 'medium',
        category: 'OWASP A01 - Broken Access Control',
        file,
        line: lineNum,
        description: 'Potential insecure direct object reference',
        suggestion: 'Implement proper authorization checks',
      });
    }

    // Missing authorization checks
    if (language.match(/JavaScript|TypeScript/) && /req\.params|req\.query/.test(line)) {
      if (!/auth|permission|role|can/.test(line.toLowerCase())) {
        findings.push({
          severity: 'medium',
          category: 'OWASP A01 - Broken Access Control',
          file,
          line: lineNum,
          description: 'Request parameter access without authorization check',
          suggestion: 'Add authorization middleware or checks',
        });
      }
    }

    return findings;
  }

  /**
   * A02: Cryptographic Failures
   */
  private checkCryptography(line: string, file: string, lineNum: number, language: string): Finding[] {
    const findings: Finding[] = [];

    // Weak hashing algorithms
    if (/\bmd5\b|\bsha1\b/i.test(line)) {
      findings.push({
        severity: 'high',
        category: 'OWASP A02 - Cryptographic Failures',
        file,
        line: lineNum,
        description: 'Weak cryptographic algorithm (MD5/SHA1)',
        suggestion: 'Use SHA-256, SHA-3, or bcrypt for hashing',
      });
    }

    // Hardcoded encryption keys
    if (/(encrypt|cipher|aes).*key.*=.*['"][^'"]{16,}['"]/i.test(line)) {
      findings.push({
        severity: 'critical',
        category: 'OWASP A02 - Cryptographic Failures',
        file,
        line: lineNum,
        description: 'Hardcoded encryption key detected',
        suggestion: 'Use secure key management system',
      });
    }

    // Insecure random for security
    if (/Math\.random\(\)/.test(line) && /(token|session|password|key)/i.test(line)) {
      findings.push({
        severity: 'high',
        category: 'OWASP A02 - Cryptographic Failures',
        file,
        line: lineNum,
        description: 'Insecure random used for security-sensitive operation',
        suggestion: 'Use crypto.randomBytes() or equivalent',
      });
    }

    return findings;
  }

  /**
   * A03: Injection
   */
  private checkInjection(line: string, file: string, lineNum: number, language: string): Finding[] {
    const findings: Finding[] = [];

    // SQL Injection
    if (/(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE).*\+/.test(line) || /\$\{.*\}.*FROM/.test(line)) {
      findings.push({
        severity: 'critical',
        category: 'OWASP A03 - Injection',
        file,
        line: lineNum,
        description: 'Potential SQL injection via string concatenation',
        suggestion: 'Use parameterized queries or ORM',
      });
    }

    // NoSQL Injection
    if (/(find|findOne|update|remove)\s*\(.*\$/.test(line)) {
      findings.push({
        severity: 'high',
        category: 'OWASP A03 - Injection',
        file,
        line: lineNum,
        description: 'Potential NoSQL injection',
        suggestion: 'Validate and sanitize input, use ORM methods',
      });
    }

    // Command Injection
    if (/(exec|spawn|system|popen)\s*\(.*\+|`.*\$\{/.test(line)) {
      findings.push({
        severity: 'critical',
        category: 'OWASP A03 - Injection',
        file,
        line: lineNum,
        description: 'Potential command injection',
        suggestion: 'Avoid shell execution, use safe APIs',
      });
    }

    // LDAP Injection
    if (/ldap.*filter.*\+/.test(line.toLowerCase())) {
      findings.push({
        severity: 'high',
        category: 'OWASP A03 - Injection',
        file,
        line: lineNum,
        description: 'Potential LDAP injection',
        suggestion: 'Use parameterized LDAP queries',
      });
    }

    // XPath Injection
    if (/xpath|xquery/i.test(line) && /\+|\$\{/.test(line)) {
      findings.push({
        severity: 'high',
        category: 'OWASP A03 - Injection',
        file,
        line: lineNum,
        description: 'Potential XPath injection',
        suggestion: 'Use parameterized XPath queries',
      });
    }

    // XML External Entity (XXE)
    if (/XMLHttpRequest|DOMParser|parseXML/i.test(line) && !/disableExternalEntities|noent/i.test(line)) {
      findings.push({
        severity: 'high',
        category: 'OWASP A03 - Injection',
        file,
        line: lineNum,
        description: 'XML parsing without XXE protection',
        suggestion: 'Disable external entity processing',
      });
    }

    return findings;
  }

  /**
   * A04: Insecure Design
   */
  private checkInsecureDesign(line: string, file: string, lineNum: number, language: string): Finding[] {
    const findings: Finding[] = [];

    // No rate limiting
    if (/app\.(post|get|put|delete)\(/i.test(line) && !/rateLimit|throttle/i.test(line)) {
      findings.push({
        severity: 'medium',
        category: 'OWASP A04 - Insecure Design',
        file,
        line: lineNum,
        description: 'API endpoint without rate limiting',
        suggestion: 'Implement rate limiting to prevent abuse',
      });
    }

    // Insufficient password requirements
    if (/password.*length.*<.*6|password.*\{1,5\}/i.test(line)) {
      findings.push({
        severity: 'medium',
        category: 'OWASP A04 - Insecure Design',
        file,
        line: lineNum,
        description: 'Weak password requirements',
        suggestion: 'Require minimum 8 characters with complexity',
      });
    }

    return findings;
  }

  /**
   * A05: Security Misconfiguration
   */
  private checkMisconfiguration(line: string, file: string, lineNum: number, language: string): Finding[] {
    const findings: Finding[] = [];

    // Debug mode enabled
    if (/DEBUG\s*=\s*[Tt]rue|app\.debug\s*=\s*true/i.test(line)) {
      findings.push({
        severity: 'high',
        category: 'OWASP A05 - Security Misconfiguration',
        file,
        line: lineNum,
        description: 'Debug mode enabled',
        suggestion: 'Disable debug mode in production',
      });
    }

    // CORS misconfiguration
    if (/Access-Control-Allow-Origin.*\*/.test(line)) {
      findings.push({
        severity: 'medium',
        category: 'OWASP A05 - Security Misconfiguration',
        file,
        line: lineNum,
        description: 'CORS allows all origins (*)',
        suggestion: 'Restrict CORS to specific trusted origins',
      });
    }

    // Missing security headers
    if (/express\(\)|app\s*=/.test(line) && !/helmet|securityHeaders/.test(line)) {
      findings.push({
        severity: 'medium',
        category: 'OWASP A05 - Security Misconfiguration',
        file,
        line: lineNum,
        description: 'Missing security headers middleware',
        suggestion: 'Use helmet.js or equivalent for security headers',
      });
    }

    return findings;
  }

  /**
   * A07: Identification and Authentication Failures
   */
  private checkAuthentication(line: string, file: string, lineNum: number, language: string): Finding[] {
    const findings: Finding[] = [];

    // Weak session management
    if (/session.*cookie.*secure.*false|httpOnly.*false/i.test(line)) {
      findings.push({
        severity: 'high',
        category: 'OWASP A07 - Authentication Failures',
        file,
        line: lineNum,
        description: 'Insecure session cookie configuration',
        suggestion: 'Enable secure and httpOnly flags for cookies',
      });
    }

    // No password hashing
    if (/password\s*===?\s*req\.|password\s*===?\s*input/.test(line)) {
      findings.push({
        severity: 'critical',
        category: 'OWASP A07 - Authentication Failures',
        file,
        line: lineNum,
        description: 'Plain text password comparison',
        suggestion: 'Use bcrypt or similar for password hashing',
      });
    }

    // Predictable session IDs
    if (/sessionId.*=.*Math\.random|token.*=.*Date\.now/.test(line)) {
      findings.push({
        severity: 'high',
        category: 'OWASP A07 - Authentication Failures',
        file,
        line: lineNum,
        description: 'Predictable session ID generation',
        suggestion: 'Use cryptographically secure random generation',
      });
    }

    return findings;
  }

  /**
   * A08: Software and Data Integrity Failures
   */
  private checkIntegrity(line: string, file: string, lineNum: number, language: string): Finding[] {
    const findings: Finding[] = [];

    // Insecure deserialization
    if (/pickle\.loads|yaml\.load|unserialize|json_decode.*assoc/i.test(line)) {
      findings.push({
        severity: 'high',
        category: 'OWASP A08 - Integrity Failures',
        file,
        line: lineNum,
        description: 'Insecure deserialization',
        suggestion: 'Validate data before deserialization, use safe loaders',
      });
    }

    // Missing integrity checks
    if (/<script.*src=["']https?:\/\//.test(line) && !/integrity=/.test(line)) {
      findings.push({
        severity: 'medium',
        category: 'OWASP A08 - Integrity Failures',
        file,
        line: lineNum,
        description: 'External script without SRI integrity check',
        suggestion: 'Add integrity attribute with hash',
      });
    }

    return findings;
  }

  /**
   * A09: Security Logging and Monitoring Failures
   */
  private checkLogging(line: string, file: string, lineNum: number, language: string): Finding[] {
    const findings: Finding[] = [];

    // Sensitive data in logs
    if (/console\.log|logger|log\.info/.test(line) && /(password|token|secret|credit.*card|ssn)/i.test(line)) {
      findings.push({
        severity: 'high',
        category: 'OWASP A09 - Logging Failures',
        file,
        line: lineNum,
        description: 'Sensitive data may be logged',
        suggestion: 'Sanitize logs, never log passwords or secrets',
      });
    }

    // Missing error logging
    if (/catch\s*\(/.test(line) && !/log|logger/.test(line)) {
      findings.push({
        severity: 'low',
        category: 'OWASP A09 - Logging Failures',
        file,
        line: lineNum,
        description: 'Error caught but not logged',
        suggestion: 'Log errors for monitoring and debugging',
      });
    }

    return findings;
  }

  /**
   * A10: Server-Side Request Forgery (SSRF)
   */
  private checkSSRF(line: string, file: string, lineNum: number, language: string): Finding[] {
    const findings: Finding[] = [];

    // User-controlled URLs
    if (/(fetch|axios|request|http\.get)\s*\(.*req\.|\.get\(.*params\./i.test(line)) {
      findings.push({
        severity: 'high',
        category: 'OWASP A10 - SSRF',
        file,
        line: lineNum,
        description: 'Potential SSRF with user-controlled URL',
        suggestion: 'Validate and whitelist allowed domains',
      });
    }

    // URL parsing without validation
    if (/new URL\(.*req\.|URL\.parse\(.*params/i.test(line)) {
      findings.push({
        severity: 'medium',
        category: 'OWASP A10 - SSRF',
        file,
        line: lineNum,
        description: 'URL parsing with user input',
        suggestion: 'Validate URLs against whitelist',
      });
    }

    return findings;
  }
}

export const owaspScanner = new OwaspScanner();
