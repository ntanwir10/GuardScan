import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { StringDecoder } from 'string_decoder';
import fastGlob from 'fast-glob';
import { SECURITY_CONSTANTS } from '../constants/security-constants';

const MAX_SECRET_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SECRET_LINE_FRAGMENT_CHARS = 256 * 1024;
const SECRET_LINE_OVERLAP_CHARS = 1024;
const SECRET_DISCOVERY_IGNORES = [
  '**/.git/**', '**/.guardscan/**', '**/node_modules/**', '**/vendor/**', '**/dist/**',
  '**/build/**', '**/coverage/**', '**/.venv/**', '**/venv/**', '**/target/**',
];

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export interface SecretFinding {
  type: string;
  file: string;
  line: number;
  secret: string;
  entropy: number;
  severity: 'critical' | 'high' | 'medium';
  recommendation: string;
}

export class SecretsDetector {
  /** Discover bounded working-tree inputs independently from language/LOC discovery. */
  async discoverFiles(
    repoPath: string = process.cwd(),
    onSkippedInput: () => void = () => {}
  ): Promise<string[]> {
    let root: string;
    try {
      root = fs.realpathSync(repoPath);
      if (!fs.statSync(root).isDirectory()) {throw new Error('repository path is not a directory');}
    } catch {
      onSkippedInput();
      return [];
    }

    try {
      const candidates = await fastGlob('**/*', {
        cwd: root,
        absolute: true,
        dot: true,
        onlyFiles: true,
        followSymbolicLinks: false,
        ignore: SECRET_DISCOVERY_IGNORES,
      });
      const files: string[] = [];
      for (const candidate of candidates.sort()) {
        try {
          if (fs.lstatSync(candidate).isSymbolicLink()) {continue;}
          const real = fs.realpathSync(candidate);
          if (isWithinRoot(root, real) && fs.statSync(real).isFile()) {files.push(real);}
        } catch {
          onSkippedInput();
        }
      }
      return files;
    } catch {
      onSkippedInput();
      return [];
    }
  }

  /**
   * Detect secrets in files
   */
  async detectInFiles(files: string[], onSkippedInput: () => void = () => {}): Promise<SecretFinding[]> {
    const findings: SecretFinding[] = [];

    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile()) {continue;}
        if (stat.size > MAX_SECRET_FILE_BYTES) {
          findings.push(...await this.scanLargeFile(file));
          continue;
        }
        const raw = fs.readFileSync(file);
        if (raw.includes(0)) {continue;}
        const content = raw.toString('utf-8');
        const fileFindings = this.scanContent(file, content);
        findings.push(...fileFindings);
      } catch {
        onSkippedInput();
      }
    }

    return findings;
  }

  /**
   * Scan git history for secrets
   */
  async scanGitHistory(
    repoPath: string = process.cwd(),
    onSkippedInput: () => void = () => {}
  ): Promise<SecretFinding[]> {
    const findings: SecretFinding[] = [];

    try {
      const insideWorkTree = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: repoPath,
        encoding: 'utf-8',
      }).trim();
      if (insideWorkTree !== 'true') {return findings;}
    } catch (error: unknown) {
      const rawStderr = error && typeof error === 'object' && 'stderr' in error
        ? (error as {stderr?: unknown}).stderr
        : undefined;
      const stderr = typeof rawStderr === 'string'
        ? rawStderr
        : Buffer.isBuffer(rawStderr) ? rawStderr.toString('utf8') : '';
      if (!/not a git repository/i.test(stderr)) {onSkippedInput();}
      return findings;
    }

    try {
      // Git history is an optional bounded tier; scanning the configured window
      // is complete coverage for this tier and must not degrade the working-tree scan.
      const commits = execFileSync('git', [
        'log',
        '--all',
        '--format=%H',
        `--max-count=${SECURITY_CONSTANTS.GIT_HISTORY_COMMIT_LIMIT}`,
      ], {
        cwd: repoPath,
        encoding: 'utf-8',
      }).split('\n').filter(Boolean);

      for (const commit of commits) {
        try {
          // Get diff for commit
          const diff = execFileSync('git', ['show', '--end-of-options', commit], {
            cwd: repoPath,
            encoding: 'utf-8',
            maxBuffer: SECURITY_CONSTANTS.GIT_HISTORY_DIFF_MAX_BYTES,
          });

          const commitFindings = this.scanContent(`commit:${commit.substring(0, 8)}`, diff);
          findings.push(...commitFindings);
        } catch {
          onSkippedInput();
        }
      }
    } catch {
      onSkippedInput();
    }

    return findings;
  }

  /**
   * Scan content for secrets
   */
  private scanContent(file: string, content: string): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      findings.push(...this.scanLine(file, lines[i], i + 1));
    }

    return findings;
  }

  private scanLine(file: string, line: string, lineNum: number): SecretFinding[] {
    return [
      ...this.checkPatterns(file, line, lineNum),
      ...this.checkEntropy(file, line, lineNum),
    ];
  }

  /** Stream readable oversized text while bounding memory for minified single-line inputs. */
  private async scanLargeFile(file: string): Promise<SecretFinding[]> {
    const findings: SecretFinding[] = [];
    const seen = new Set<string>();
    const decoder = new StringDecoder('utf8');
    const stream = fs.createReadStream(file, {highWaterMark: 64 * 1024});
    let pending = '';
    let lineNumber = 1;
    const record = (fragment: string): void => {
      for (const finding of this.scanLine(file, fragment.replace(/\r$/, ''), lineNumber)) {
        const key = [finding.type, finding.line, finding.secret, finding.severity].join('\0');
        if (seen.has(key)) {continue;}
        seen.add(key);
        findings.push(finding);
      }
    };
    const drain = (): void => {
      for (;;) {
        const newline = pending.indexOf('\n');
        if (newline >= 0 && newline <= MAX_SECRET_LINE_FRAGMENT_CHARS) {
          record(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          lineNumber += 1;
          continue;
        }
        if (pending.length > MAX_SECRET_LINE_FRAGMENT_CHARS) {
          record(pending.slice(0, MAX_SECRET_LINE_FRAGMENT_CHARS));
          pending = pending.slice(MAX_SECRET_LINE_FRAGMENT_CHARS - SECRET_LINE_OVERLAP_CHARS);
          continue;
        }
        break;
      }
    };

    try {
      for await (const rawChunk of stream) {
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
        if (chunk.includes(0)) {return [];}
        pending += decoder.write(chunk);
        drain();
      }
      pending += decoder.end();
      drain();
      if (pending) {record(pending);}
      return findings;
    } finally {
      stream.destroy();
    }
  }

  /**
   * Check for specific secret patterns
   */
  private checkPatterns(file: string, line: string, lineNum: number): SecretFinding[] {
    const findings: SecretFinding[] = [];

    const patterns = [
      // AWS Access Key
      {
        pattern: /AKIA[0-9A-Z]{16}/g,
        type: 'AWS Access Key',
        severity: 'critical' as const,
        recommendation: 'Rotate AWS credentials immediately and use AWS Secrets Manager',
      },
      // AWS Secret Key
      {
        pattern: /aws[_-]?secret[_-]?access[_-]?key['":\s]*[=:]\s*['"]([A-Za-z0-9/+=]{40})['"]/gi,
        type: 'AWS Secret Access Key',
        severity: 'critical' as const,
        recommendation: 'Rotate AWS credentials immediately and use AWS Secrets Manager',
      },
      // GitHub Token
      {
        pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
        type: 'GitHub Token',
        severity: 'critical' as const,
        recommendation: 'Revoke GitHub token and regenerate with minimal permissions',
      },
      // GitHub Classic Token
      {
        pattern: /ghp_[A-Za-z0-9]{36}/g,
        type: 'GitHub Personal Access Token',
        severity: 'critical' as const,
        recommendation: 'Revoke GitHub PAT immediately',
      },
      // Google API Key
      {
        pattern: /AIza[0-9A-Za-z\\-_]{35}/g,
        type: 'Google API Key',
        severity: 'high' as const,
        recommendation: 'Rotate Google API key and restrict API key usage',
      },
      // Google Cloud Service Account
      {
        pattern: /"type":\s*"service_account"/g,
        type: 'GCP Service Account JSON',
        severity: 'critical' as const,
        recommendation: 'Remove service account JSON and use workload identity',
      },
      // Azure Connection String
      {
        pattern: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{88}/g,
        type: 'Azure Storage Connection String',
        severity: 'critical' as const,
        recommendation: 'Rotate Azure storage key immediately',
      },
      // Slack Token
      {
        pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,32}/g,
        type: 'Slack Token',
        severity: 'high' as const,
        recommendation: 'Revoke Slack token and regenerate',
      },
      // Stripe API Key
      {
        pattern: /sk_live_[0-9a-zA-Z]{24,}/g,
        type: 'Stripe Live API Key',
        severity: 'critical' as const,
        recommendation: 'Rotate Stripe API key immediately',
      },
      // Private Key (RSA, SSH)
      {
        pattern: /-----BEGIN (RSA |OPENSSH |DSA |EC )?PRIVATE KEY-----/g,
        type: 'Private Key',
        severity: 'critical' as const,
        recommendation: 'Remove private key and regenerate keypair',
      },
      // JWT Token
      {
        pattern: /eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g,
        type: 'JWT Token',
        severity: 'medium' as const,
        recommendation: 'Review if this is a valid token, invalidate if leaked',
      },
      // Generic API Key patterns
      {
        pattern: /(api[_-]?key|apikey|api[_-]?secret|secret[_-]?key)['":\s]*[=:]\s*['"]([A-Za-z0-9\-_]{20,})['"]/gi,
        type: 'Generic API Key',
        severity: 'high' as const,
        recommendation: 'Move to environment variables or secret management',
      },
      // Database Connection String
      {
        pattern: /(mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@[^/]+/gi,
        type: 'Database Connection String',
        severity: 'critical' as const,
        recommendation: 'Use environment variables for connection strings',
      },
      // Twilio API Key
      {
        pattern: /SK[a-z0-9]{32}/g,
        type: 'Twilio API Key',
        severity: 'high' as const,
        recommendation: 'Rotate Twilio credentials',
      },
      // SendGrid API Key
      {
        pattern: /SG\.[A-Za-z0-9\-_]{22}\.[A-Za-z0-9\-_]{43}/g,
        type: 'SendGrid API Key',
        severity: 'high' as const,
        recommendation: 'Rotate SendGrid API key',
      },
      // MailChimp API Key
      {
        pattern: /[a-f0-9]{32}-us[0-9]{1,2}/g,
        type: 'MailChimp API Key',
        severity: 'high' as const,
        recommendation: 'Rotate MailChimp API key',
      },
    ];

    for (const pattern of patterns) {
      const matches = line.matchAll(pattern.pattern);
      for (const match of matches) {
        findings.push({
          type: pattern.type,
          file,
          line: lineNum,
          secret: this.maskSecret(match[0]),
          entropy: this.calculateEntropy(match[0]),
          severity: pattern.severity,
          recommendation: pattern.recommendation,
        });
      }
    }

    return findings;
  }

  /**
   * Check for high-entropy strings that might be secrets
   */
  private checkEntropy(file: string, line: string, lineNum: number): SecretFinding[] {
    const findings: SecretFinding[] = [];

    // Look for quoted strings or strings after = or :
    const stringPatterns = [
      /['"]([A-Za-z0-9+/=_-]{20,})['"]/g,
      /[=:]\s*([A-Za-z0-9+/=_-]{20,})/g,
    ];

    for (const pattern of stringPatterns) {
      const matches = line.matchAll(pattern);
      for (const match of matches) {
        const string = match[1];
        const entropy = this.calculateEntropy(string);

        if (entropy > SECURITY_CONSTANTS.HIGH_ENTROPY_THRESHOLD) {
          // Skip if it looks like a hash or known safe pattern
          if (this.isSafePattern(string)) {continue;}

          findings.push({
            type: 'High Entropy String',
            file,
            line: lineNum,
            secret: this.maskSecret(string),
            entropy,
            severity: 'high',
            recommendation: 'Review if this is a secret - high entropy detected',
          });
        } else if (entropy > SECURITY_CONSTANTS.MEDIUM_ENTROPY_THRESHOLD && string.length > 32) {
          if (this.isSafePattern(string)) {continue;}

          findings.push({
            type: 'Medium Entropy String',
            file,
            line: lineNum,
            secret: this.maskSecret(string),
            entropy,
            severity: 'medium',
            recommendation: 'Review if this is sensitive data',
          });
        }
      }
    }

    return findings;
  }

  /**
   * Calculate Shannon entropy of a string
   */
  private calculateEntropy(str: string): number {
    const len = str.length;
    const frequencies: Record<string, number> = {};

    // Count character frequencies
    for (const char of str) {
      frequencies[char] = (frequencies[char] || 0) + 1;
    }

    // Calculate entropy
    let entropy = 0;
    for (const freq of Object.values(frequencies)) {
      const p = freq / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }

  /**
   * Check if string matches safe patterns (hashes, UUIDs, etc.)
   */
  private isSafePattern(str: string): boolean {
    // UUID
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(str)) {return true;}

    // SHA-256 hash
    if (/^[a-f0-9]{64}$/i.test(str)) {return true;}

    // SHA-1 hash
    if (/^[a-f0-9]{40}$/i.test(str)) {return true;}

    // MD5 hash
    if (/^[a-f0-9]{32}$/i.test(str)) {return true;}

    // Common safe strings
    const safeKeywords = ['localhost', 'example', 'test', 'demo', 'sample', 'placeholder'];
    if (safeKeywords.some(keyword => str.toLowerCase().includes(keyword))) {return true;}

    return false;
  }

  /**
   * Mask secret for display
   */
  private maskSecret(secret: string): string {
    if (secret.length <= 8) {return '***';}
    return secret.substring(0, SECURITY_CONSTANTS.SECRET_MASK_PREFIX_LENGTH) + '***' + secret.substring(secret.length - SECURITY_CONSTANTS.SECRET_MASK_SUFFIX_LENGTH);
  }
}

export const secretsDetector = new SecretsDetector();
