import * as fs from 'fs';
import * as path from 'path';

export interface ComplianceViolation {
  standard: 'GDPR' | 'HIPAA' | 'PCI-DSS' | 'SOC2' | 'General';
  type: string;
  file: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
  regulation?: string; // Specific regulation reference
}

export interface ComplianceReport {
  standard: string;
  violations: ComplianceViolation[];
  totalViolations: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export class ComplianceChecker {
  /**
   * Run compliance checks
   */
  async check(repoPath: string = process.cwd()): Promise<ComplianceReport[]> {
    const reports: ComplianceReport[] = [];

    const files = this.findCodeFiles(repoPath);
    const violations: ComplianceViolation[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const language = this.detectLanguage(file);

        violations.push(...this.checkGDPR(file, content, language));
        violations.push(...this.checkHIPAA(file, content, language));
        violations.push(...this.checkPCIDSS(file, content, language));
        violations.push(...this.checkSOC2(file, content, language));
      } catch {
        // Skip files that can't be read
      }
    }

    // Group by standard
    const byStandard = new Map<string, ComplianceViolation[]>();
    for (const violation of violations) {
      const key = violation.standard;
      if (!byStandard.has(key)) {
        byStandard.set(key, []);
      }
      byStandard.get(key)!.push(violation);
    }

    // Create reports
    for (const [standard, stdViolations] of byStandard) {
      reports.push({
        standard,
        violations: stdViolations,
        totalViolations: stdViolations.length,
        critical: stdViolations.filter(v => v.severity === 'critical').length,
        high: stdViolations.filter(v => v.severity === 'high').length,
        medium: stdViolations.filter(v => v.severity === 'medium').length,
        low: stdViolations.filter(v => v.severity === 'low').length,
      });
    }

    return reports;
  }

  /**
   * Find code files
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
    const extensions = ['.js', '.ts', '.py', '.go', '.java', '.rb', '.php', '.sql', '.yaml', '.json'];
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
      '.sql': 'sql',
      '.yaml': 'yaml',
      '.json': 'json',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Check GDPR compliance
   * General Data Protection Regulation (EU)
   */
  private checkGDPR(file: string, content: string, language: string): ComplianceViolation[] {
    const violations: ComplianceViolation[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // PII detection (Personal Identifiable Information)
      const piiPatterns = [
        { pattern: /(email|e-mail).*[:=]\s*[^\s]+@[^\s]+/i, type: 'Email Address' },
        { pattern: /(ssn|social.?security).*[:=]\s*\d{3}-\d{2}-\d{4}/i, type: 'Social Security Number' },
        { pattern: /(phone|tel|mobile).*[:=]\s*\d{10,}/i, type: 'Phone Number' },
        { pattern: /(address|street|zip|postal).*[:=]/i, type: 'Physical Address' },
        { pattern: /(dob|birth.?date|birthday).*[:=]/i, type: 'Date of Birth' },
        { pattern: /(passport|license|id.?number).*[:=]/i, type: 'Identification Number' },
      ];

      for (const { pattern, type } of piiPatterns) {
        if (pattern.test(line)) {
          violations.push({
            standard: 'GDPR',
            type: 'Unprotected PII',
            file,
            line: lineNum,
            severity: 'high',
            description: `Potential ${type} storage without encryption/anonymization`,
            recommendation: 'Implement data encryption, anonymization, or pseudonymization for PII',
            regulation: 'GDPR Art. 32 (Security of processing)',
          });
        }
      }

      // Missing consent mechanism
      if (/(collect|store|process).*user.*data/i.test(line) && !/consent/i.test(content)) {
        violations.push({
          standard: 'GDPR',
          type: 'Missing Consent Mechanism',
          file,
          line: lineNum,
          severity: 'high',
          description: 'User data collection without explicit consent mechanism',
          recommendation: 'Implement user consent collection and storage for data processing',
          regulation: 'GDPR Art. 6 (Lawfulness of processing)',
        });
      }

      // Data retention without expiry
      if (/(create|insert|save).*user/i.test(line) && !/retention|expire|delete|ttl/i.test(content)) {
        violations.push({
          standard: 'GDPR',
          type: 'Missing Data Retention Policy',
          file,
          line: lineNum,
          severity: 'medium',
          description: 'User data storage without retention/expiry policy',
          recommendation: 'Implement data retention policy and automatic data deletion',
          regulation: 'GDPR Art. 5 (Storage limitation)',
        });
      }

      // Missing right to erasure (right to be forgotten)
      if (/(user|profile|account).*delete/i.test(line) && !/cascade|purge|permanent/i.test(content)) {
        violations.push({
          standard: 'GDPR',
          type: 'Incomplete Data Deletion',
          file,
          line: lineNum,
          severity: 'medium',
          description: 'User deletion may not cascade to all related data',
          recommendation: 'Ensure complete data deletion across all systems (right to erasure)',
          regulation: 'GDPR Art. 17 (Right to erasure)',
        });
      }

      // Missing data portability
      if (/(export|download).*user.*data/i.test(line) && !/structured|json|csv|xml/i.test(content)) {
        violations.push({
          standard: 'GDPR',
          type: 'Missing Data Portability',
          file,
          line: lineNum,
          severity: 'low',
          description: 'User data export may not be in structured, machine-readable format',
          recommendation: 'Provide data export in structured format (JSON, CSV, etc.)',
          regulation: 'GDPR Art. 20 (Right to data portability)',
        });
      }

      // Cross-border data transfer
      if (/(transfer|send|export).*data.*to/i.test(line) && /(country|region|international)/i.test(line)) {
        violations.push({
          standard: 'GDPR',
          type: 'Unverified Cross-Border Transfer',
          file,
          line: lineNum,
          severity: 'critical',
          description: 'Cross-border data transfer without adequacy decision or safeguards',
          recommendation: 'Ensure data transfers comply with GDPR (Standard Contractual Clauses, etc.)',
          regulation: 'GDPR Art. 44-50 (Transfers of personal data)',
        });
      }

      // Missing audit logging
      if (/(update|modify|delete|access).*user/i.test(line) && !/log|audit|track/i.test(content)) {
        violations.push({
          standard: 'GDPR',
          type: 'Missing Audit Trail',
          file,
          line: lineNum,
          severity: 'high',
          description: 'User data operations without audit logging',
          recommendation: 'Implement comprehensive audit logging for all data access and modifications',
          regulation: 'GDPR Art. 30 (Records of processing activities)',
        });
      }
    }

    return violations;
  }

  /**
   * Check HIPAA compliance
   * Health Insurance Portability and Accountability Act (US Healthcare)
   */
  private checkHIPAA(file: string, content: string, language: string): ComplianceViolation[] {
    const violations: ComplianceViolation[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // PHI (Protected Health Information) detection
      const phiPatterns = [
        { pattern: /(medical|health|diagnosis|treatment|prescription|patient)/i, type: 'Health Information' },
        { pattern: /(mrn|medical.?record|patient.?id)/i, type: 'Medical Record Number' },
        { pattern: /(insurance|policy|claim).*number/i, type: 'Insurance Information' },
      ];

      for (const { pattern, type } of phiPatterns) {
        if (pattern.test(line)) {
          // Check for encryption
          if (!/encrypt|aes|rsa|cipher/i.test(content)) {
            violations.push({
              standard: 'HIPAA',
              type: 'Unencrypted PHI',
              file,
              line: lineNum,
              severity: 'critical',
              description: `${type} without encryption (PHI must be encrypted at rest and in transit)`,
              recommendation: 'Implement encryption for all PHI data (AES-256 or equivalent)',
              regulation: 'HIPAA Security Rule §164.312(a)(2)(iv)',
            });
          }
        }
      }

      // Missing access controls
      if (/(patient|medical|health).*data/i.test(line) && !/authenticate|authorize|rbac|acl/i.test(content)) {
        violations.push({
          standard: 'HIPAA',
          type: 'Missing Access Controls',
          file,
          line: lineNum,
          severity: 'critical',
          description: 'PHI access without role-based access control',
          recommendation: 'Implement role-based access control (RBAC) for all PHI',
          regulation: 'HIPAA Security Rule §164.308(a)(4)',
        });
      }

      // Missing audit controls
      if (/(access|view|update|delete).*patient/i.test(line) && !/audit|log/i.test(content)) {
        violations.push({
          standard: 'HIPAA',
          type: 'Missing Audit Controls',
          file,
          line: lineNum,
          severity: 'high',
          description: 'PHI access without audit logging',
          recommendation: 'Implement comprehensive audit logging for all PHI access',
          regulation: 'HIPAA Security Rule §164.312(b)',
        });
      }

      // Transmission security
      if (/(send|transmit|transfer).*patient/i.test(line) && !/https|tls|ssl|encrypt/i.test(line)) {
        violations.push({
          standard: 'HIPAA',
          type: 'Insecure PHI Transmission',
          file,
          line: lineNum,
          severity: 'critical',
          description: 'PHI transmission without encryption',
          recommendation: 'Use TLS/SSL for all PHI transmissions',
          regulation: 'HIPAA Security Rule §164.312(e)(1)',
        });
      }

      // Minimum necessary standard
      if (/select \* from.*patient|findAll.*patient/i.test(line)) {
        violations.push({
          standard: 'HIPAA',
          type: 'Excessive PHI Access',
          file,
          line: lineNum,
          severity: 'medium',
          description: 'Query retrieves all patient data (violates minimum necessary rule)',
          recommendation: 'Only retrieve necessary PHI fields for the specific purpose',
          regulation: 'HIPAA Privacy Rule §164.502(b)',
        });
      }

      // Missing integrity controls
      if (/(update|modify).*patient/i.test(line) && !/hash|checksum|verify/i.test(content)) {
        violations.push({
          standard: 'HIPAA',
          type: 'Missing Integrity Controls',
          file,
          line: lineNum,
          severity: 'high',
          description: 'PHI modification without integrity verification',
          recommendation: 'Implement data integrity controls (checksums, digital signatures)',
          regulation: 'HIPAA Security Rule §164.312(c)(1)',
        });
      }

      // Breach notification missing
      if (/(leak|breach|unauthorized|exposed).*patient/i.test(line) && !/notify|alert|incident/i.test(content)) {
        violations.push({
          standard: 'HIPAA',
          type: 'Missing Breach Notification',
          file,
          line: lineNum,
          severity: 'critical',
          description: 'No breach notification mechanism for PHI exposure',
          recommendation: 'Implement automated breach detection and notification system',
          regulation: 'HIPAA Breach Notification Rule §164.400',
        });
      }
    }

    return violations;
  }

  /**
   * Check PCI-DSS compliance
   * Payment Card Industry Data Security Standard
   */
  private checkPCIDSS(file: string, content: string, language: string): ComplianceViolation[] {
    const violations: ComplianceViolation[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Credit card data patterns
      const cardPatterns = [
        { pattern: /(card|credit|debit).*number/i, type: 'Card Number' },
        { pattern: /cvv|cvc|security.?code/i, type: 'CVV/CVC' },
        { pattern: /(expir|exp).*date|expiry/i, type: 'Expiration Date' },
        { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, type: 'Card Number Pattern' },
      ];

      for (const { pattern, type } of cardPatterns) {
        if (pattern.test(line)) {
          // CVV/CVC storage is NEVER allowed
          if (/cvv|cvc|security.?code/i.test(line) && /(store|save|persist|database)/i.test(line)) {
            violations.push({
              standard: 'PCI-DSS',
              type: 'CVV/CVC Storage',
              file,
              line: lineNum,
              severity: 'critical',
              description: 'CVV/CVC storage is prohibited under PCI-DSS',
              recommendation: 'NEVER store CVV/CVC codes - this is a critical PCI-DSS violation',
              regulation: 'PCI-DSS Requirement 3.2',
            });
          }

          // Card data must be encrypted
          if (!/encrypt|tokenize|vault/i.test(content)) {
            violations.push({
              standard: 'PCI-DSS',
              type: 'Unencrypted Cardholder Data',
              file,
              line: lineNum,
              severity: 'critical',
              description: `${type} without encryption or tokenization`,
              recommendation: 'Use encryption or tokenization for all cardholder data',
              regulation: 'PCI-DSS Requirement 3.4',
            });
          }
        }
      }

      // Logging card data
      if (/(log|console|print).*card|credit.*number/i.test(line)) {
        violations.push({
          standard: 'PCI-DSS',
          type: 'Card Data in Logs',
          file,
          line: lineNum,
          severity: 'critical',
          description: 'Cardholder data in log files',
          recommendation: 'Never log full card numbers - mask all but last 4 digits',
          regulation: 'PCI-DSS Requirement 3.3',
        });
      }

      // Weak encryption
      if (/(card|payment).*encrypt/i.test(line) && /(md5|sha1|des)\b/i.test(line)) {
        violations.push({
          standard: 'PCI-DSS',
          type: 'Weak Encryption Algorithm',
          file,
          line: lineNum,
          severity: 'critical',
          description: 'Using weak encryption for cardholder data',
          recommendation: 'Use strong cryptography (AES-256, RSA 2048+)',
          regulation: 'PCI-DSS Requirement 4.1',
        });
      }

      // Transmission security
      if (/(send|transmit|transfer).*card/i.test(line) && !/(https|tls|ssl)/i.test(line)) {
        violations.push({
          standard: 'PCI-DSS',
          type: 'Insecure Card Data Transmission',
          file,
          line: lineNum,
          severity: 'critical',
          description: 'Card data transmission without TLS/SSL',
          recommendation: 'Use TLS 1.2+ for all cardholder data transmissions',
          regulation: 'PCI-DSS Requirement 4.1',
        });
      }

      // Access controls
      if (/(payment|card|transaction)/i.test(line) && !/authenticate|authorize/i.test(content)) {
        violations.push({
          standard: 'PCI-DSS',
          type: 'Missing Access Controls',
          file,
          line: lineNum,
          severity: 'high',
          description: 'Payment data access without authentication/authorization',
          recommendation: 'Implement strong access control measures',
          regulation: 'PCI-DSS Requirement 7',
        });
      }

      // File integrity monitoring
      if (/(payment|card).*config/i.test(line) && !/integrity|hash|verify/i.test(content)) {
        violations.push({
          standard: 'PCI-DSS',
          type: 'Missing File Integrity Monitoring',
          file,
          line: lineNum,
          severity: 'medium',
          description: 'Payment configuration without integrity monitoring',
          recommendation: 'Implement file integrity monitoring for payment-related files',
          regulation: 'PCI-DSS Requirement 11.5',
        });
      }
    }

    return violations;
  }

  /**
   * Check SOC 2 compliance
   * Service Organization Control 2
   */
  private checkSOC2(file: string, content: string, language: string): ComplianceViolation[] {
    const violations: ComplianceViolation[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Security controls
      if (/(password|secret|key).*=\s*['"]/i.test(line)) {
        violations.push({
          standard: 'SOC2',
          type: 'Hardcoded Credentials',
          file,
          line: lineNum,
          severity: 'critical',
          description: 'Hardcoded credentials violate SOC 2 security controls',
          recommendation: 'Use environment variables or secrets management',
          regulation: 'SOC 2 CC6.1 (Logical Access)',
        });
      }

      // Change management
      if (!content.includes('version') && !content.includes('changelog') && /(deploy|release)/i.test(line)) {
        violations.push({
          standard: 'SOC2',
          type: 'Missing Change Documentation',
          file,
          line: lineNum,
          severity: 'medium',
          description: 'Deployment without version tracking or change documentation',
          recommendation: 'Implement version control and change documentation',
          regulation: 'SOC 2 CC8.1 (Change Management)',
        });
      }

      // Monitoring and logging
      if (/(error|exception|failure)/i.test(line) && !/(log|monitor|alert)/i.test(content)) {
        violations.push({
          standard: 'SOC2',
          type: 'Missing Error Monitoring',
          file,
          line: lineNum,
          severity: 'medium',
          description: 'Error handling without monitoring/alerting',
          recommendation: 'Implement comprehensive monitoring and alerting',
          regulation: 'SOC 2 CC7.2 (System Monitoring)',
        });
      }

      // Data backup
      if (/(database|data|storage)/i.test(line) && !/(backup|snapshot|replication)/i.test(content)) {
        violations.push({
          standard: 'SOC2',
          type: 'Missing Backup Strategy',
          file,
          line: lineNum,
          severity: 'high',
          description: 'Data storage without backup/recovery mechanism',
          recommendation: 'Implement automated backup and disaster recovery',
          regulation: 'SOC 2 A1.2 (Availability)',
        });
      }
    }

    return violations;
  }
}

export const complianceChecker = new ComplianceChecker();
