import { SecretsDetector } from '../../src/core/secrets-detector';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SecretsDetector', () => {
  let detector: SecretsDetector;
  let testDir: string;

  beforeEach(() => {
    detector = new SecretsDetector();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('detectInFiles', () => {
    it('should detect AWS access keys', async () => {
      const testFile = path.join(testDir, 'test.env');
      fs.writeFileSync(testFile, 'AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE');

      const findings = await detector.detectInFiles([testFile]);

      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some(f => f.type === 'AWS Access Key')).toBe(true);
      expect(findings[0].severity).toBe('critical');
    });

    it('should detect GitHub tokens', async () => {
      const testFile = path.join(testDir, 'test.env');
      fs.writeFileSync(testFile, 'GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz');

      const findings = await detector.detectInFiles([testFile]);

      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some(f => f.type.includes('GitHub'))).toBe(true);
    });

    it('should detect private keys', async () => {
      const testFile = path.join(testDir, 'key.pem');
      fs.writeFileSync(testFile, '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ...\n-----END RSA PRIVATE KEY-----');

      const findings = await detector.detectInFiles([testFile]);

      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some(f => f.type === 'Private Key')).toBe(true);
      expect(findings[0].severity).toBe('critical');
    });

    it('should detect database connection strings', async () => {
      const testFile = path.join(testDir, 'config.js');
      fs.writeFileSync(testFile, 'const dbUrl = "mongodb://user:pass@localhost:27017/db"');

      const findings = await detector.detectInFiles([testFile]);

      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some(f => f.type === 'Database Connection String')).toBe(true);
    });

    it('should mask detected secrets', async () => {
      const testFile = path.join(testDir, 'test.env');
      fs.writeFileSync(testFile, 'API_KEY=sk_test_1234567890abcdefghijklmnop');

      const findings = await detector.detectInFiles([testFile]);

      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].secret).not.toContain('1234567890');
      expect(findings[0].secret).toContain('***');
    });

    it('should not detect safe patterns', async () => {
      const testFile = path.join(testDir, 'test.js');
      const content = `
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const hash = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
        const example = 'example-api-key-12345';
      `;
      fs.writeFileSync(testFile, content);

      const findings = await detector.detectInFiles([testFile]);

      // Should not flag UUIDs, hashes, or example strings
      expect(findings.length).toBe(0);
    });

    it('should handle files with no secrets', async () => {
      const testFile = path.join(testDir, 'clean.js');
      fs.writeFileSync(testFile, 'const x = 1;\nfunction test() { return true; }');

      const findings = await detector.detectInFiles([testFile]);

      expect(findings).toEqual([]);
    });
  });

  describe('entropy detection', () => {
    it('should detect high entropy strings', async () => {
      const testFile = path.join(testDir, 'test.js');
      // High entropy random string
      fs.writeFileSync(testFile, 'const key = "aB3xK9mN2pQ7rT5wZ8yC1dF4gH6jL0v"');

      const findings = await detector.detectInFiles([testFile]);

      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].entropy).toBeGreaterThan(4.0);
    });

    it('should calculate entropy correctly', () => {
      const entropy = (detector as any).calculateEntropy('aaaaaaa');
      expect(entropy).toBeLessThan(1); // Low entropy

      const highEntropy = (detector as any).calculateEntropy('aB3xK9mN2pQ7rT');
      expect(highEntropy).toBeGreaterThan(3); // High entropy
    });

    it('should filter out safe patterns from entropy check', async () => {
      const testFile = path.join(testDir, 'test.js');
      fs.writeFileSync(testFile, 'const hash = "5d41402abc4b2a76b9719d911017c592"'); // MD5 hash

      const findings = await detector.detectInFiles([testFile]);

      expect(findings).toEqual([]);
    });
  });

  describe('checkPatterns', () => {
    it('should provide recommendations', async () => {
      const testFile = path.join(testDir, 'test.env');
      fs.writeFileSync(testFile, 'AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE');

      const findings = await detector.detectInFiles([testFile]);

      expect(findings[0].recommendation).toBeDefined();
      expect(findings[0].recommendation).toContain('AWS Secrets Manager');
    });

    it('should include line numbers', async () => {
      const testFile = path.join(testDir, 'test.env');
      const content = `
# Line 1
AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
# Line 3
      `.trim();
      fs.writeFileSync(testFile, content);

      const findings = await detector.detectInFiles([testFile]);

      expect(findings[0].line).toBe(2);
    });

    it('should detect multiple secrets in same file', async () => {
      const testFile = path.join(testDir, 'test.env');
      const content = `
AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz
STRIPE_KEY=sk_test_1234567890abcdefghijklmnop
      `.trim();
      fs.writeFileSync(testFile, content);

      const findings = await detector.detectInFiles([testFile]);

      expect(findings.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('isSafePattern', () => {
    it('should recognize UUIDs as safe', () => {
      const result = (detector as any).isSafePattern('550e8400-e29b-41d4-a716-446655440000');
      expect(result).toBe(true);
    });

    it('should recognize SHA-256 hashes as safe', () => {
      const result = (detector as any).isSafePattern('a94a8fe5ccb19ba61c4c0873d391e987982fbbd3a1e0c1b0bc1c2e0d1f0e1d0c');
      expect(result).toBe(true);
    });

    it('should recognize example/test strings as safe', () => {
      expect((detector as any).isSafePattern('example-key-12345')).toBe(true);
      expect((detector as any).isSafePattern('test-password-abc')).toBe(true);
      expect((detector as any).isSafePattern('demo-token-xyz')).toBe(true);
    });

    it('should not flag normal strings as safe', () => {
      const result = (detector as any).isSafePattern('sk_live_realkey123');
      expect(result).toBe(false);
    });
  });

  describe('maskSecret', () => {
    it('should mask long secrets correctly', () => {
      const masked = (detector as any).maskSecret('1234567890abcdefghij');
      expect(masked).toBe('1234***ghij');
    });

    it('should mask short secrets', () => {
      const masked = (detector as any).maskSecret('12345');
      expect(masked).toBe('***');
    });
  });
});
