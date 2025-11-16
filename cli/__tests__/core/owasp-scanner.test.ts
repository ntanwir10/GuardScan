/**
 * OWASP Scanner Tests
 *
 * Tests for OWASP Top 10 vulnerability detection
 */

import { OWASPScanner } from '../../src/core/owasp-scanner';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('OWASPScanner', () => {
  let scanner: OWASPScanner;
  let tempDir: string;

  beforeEach(() => {
    scanner = new OWASPScanner();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owasp-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('SQL Injection Detection', () => {
    it('should detect SQL injection vulnerabilities', async () => {
      const code = `
        function getUserById(id: string) {
          const query = "SELECT * FROM users WHERE id = '" + id + "'";
          return db.execute(query);
        }
      `;
      const filePath = path.join(tempDir, 'sql-injection.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const sqlInjection = results.find(r => r.category === 'sql-injection');
      expect(sqlInjection).toBeDefined();
      expect(sqlInjection?.severity).toBe('high');
    });

    it('should not flag parameterized queries', async () => {
      const code = `
        function getUserById(id: string) {
          const query = "SELECT * FROM users WHERE id = ?";
          return db.execute(query, [id]);
        }
      `;
      const filePath = path.join(tempDir, 'safe-query.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const sqlInjection = results.find(r => r.category === 'sql-injection');
      expect(sqlInjection).toBeUndefined();
    });
  });

  describe('XSS Detection', () => {
    it('should detect XSS vulnerabilities with innerHTML', async () => {
      const code = `
        function displayMessage(msg: string) {
          document.getElementById('message').innerHTML = msg;
        }
      `;
      const filePath = path.join(tempDir, 'xss.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const xss = results.find(r => r.category === 'xss');
      expect(xss).toBeDefined();
      expect(xss?.severity).toBe('high');
    });

    it('should detect XSS in React dangerouslySetInnerHTML', async () => {
      const code = `
        function Component({ html }: { html: string }) {
          return <div dangerouslySetInnerHTML={{ __html: html }} />;
        }
      `;
      const filePath = path.join(tempDir, 'react-xss.tsx');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const xss = results.find(r => r.category === 'xss');
      expect(xss).toBeDefined();
    });

    it('should not flag safe text content', async () => {
      const code = `
        function displayMessage(msg: string) {
          document.getElementById('message').textContent = msg;
        }
      `;
      const filePath = path.join(tempDir, 'safe-text.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const xss = results.find(r => r.category === 'xss');
      expect(xss).toBeUndefined();
    });
  });

  describe('Command Injection Detection', () => {
    it('should detect command injection with exec', async () => {
      const code = `
        import { exec } from 'child_process';

        function runCommand(cmd: string) {
          exec('ls ' + cmd, (error, stdout) => {
            console.log(stdout);
          });
        }
      `;
      const filePath = path.join(tempDir, 'cmd-injection.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const cmdInjection = results.find(r => r.category === 'command-injection');
      expect(cmdInjection).toBeDefined();
      expect(cmdInjection?.severity).toBe('critical');
    });

    it('should detect command injection with spawn', async () => {
      const code = `
        import { spawn } from 'child_process';

        function gitClone(repo: string) {
          spawn('git', ['clone', repo]);
        }
      `;
      const filePath = path.join(tempDir, 'spawn.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      // spawn with array is safer but should still be flagged for review
      const cmdInjection = results.find(r => r.category === 'command-injection');
      expect(cmdInjection).toBeDefined();
      expect(cmdInjection?.severity).toBe('medium');
    });
  });

  describe('Path Traversal Detection', () => {
    it('should detect path traversal vulnerabilities', async () => {
      const code = `
        function readFile(filename: string) {
          return fs.readFileSync('./uploads/' + filename);
        }
      `;
      const filePath = path.join(tempDir, 'path-traversal.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const pathTraversal = results.find(r => r.category === 'path-traversal');
      expect(pathTraversal).toBeDefined();
    });

    it('should not flag sanitized paths', async () => {
      const code = `
        import path from 'path';

        function readFile(filename: string) {
          const safePath = path.basename(filename);
          return fs.readFileSync('./uploads/' + safePath);
        }
      `;
      const filePath = path.join(tempDir, 'safe-path.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const pathTraversal = results.find(r => r.category === 'path-traversal');
      expect(pathTraversal).toBeUndefined();
    });
  });

  describe('Insecure Deserialization Detection', () => {
    it('should detect unsafe JSON.parse usage', async () => {
      const code = `
        function processData(data: string) {
          const obj = JSON.parse(data);
          eval(obj.code); // Very dangerous!
        }
      `;
      const filePath = path.join(tempDir, 'unsafe-deserialize.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const evalUsage = results.find(r => r.category === 'dangerous-function');
      expect(evalUsage).toBeDefined();
    });

    it('should detect eval() usage', async () => {
      const code = `
        function calculate(expr: string) {
          return eval(expr);
        }
      `;
      const filePath = path.join(tempDir, 'eval.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const evalUsage = results.find(r => r.category === 'dangerous-function');
      expect(evalUsage).toBeDefined();
      expect(evalUsage?.severity).toBe('critical');
    });
  });

  describe('Weak Cryptography Detection', () => {
    it('should detect MD5 usage', async () => {
      const code = `
        import crypto from 'crypto';

        function hashPassword(password: string) {
          return crypto.createHash('md5').update(password).digest('hex');
        }
      `;
      const filePath = path.join(tempDir, 'weak-crypto.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const weakCrypto = results.find(r => r.category === 'weak-cryptography');
      expect(weakCrypto).toBeDefined();
      expect(weakCrypto?.severity).toBe('high');
    });

    it('should detect SHA1 usage', async () => {
      const code = `
        import crypto from 'crypto';

        function hashData(data: string) {
          return crypto.createHash('sha1').update(data).digest('hex');
        }
      `;
      const filePath = path.join(tempDir, 'sha1.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const weakCrypto = results.find(r => r.category === 'weak-cryptography');
      expect(weakCrypto).toBeDefined();
    });

    it('should not flag strong cryptography', async () => {
      const code = `
        import crypto from 'crypto';

        function hashPassword(password: string) {
          return crypto.createHash('sha256').update(password).digest('hex');
        }
      `;
      const filePath = path.join(tempDir, 'strong-crypto.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const weakCrypto = results.find(r => r.category === 'weak-cryptography');
      expect(weakCrypto).toBeUndefined();
    });
  });

  describe('Insecure Random Detection', () => {
    it('should detect Math.random() for security purposes', async () => {
      const code = `
        function generateToken() {
          return Math.random().toString(36);
        }
      `;
      const filePath = path.join(tempDir, 'weak-random.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const weakRandom = results.find(r => r.category === 'insecure-random');
      expect(weakRandom).toBeDefined();
    });

    it('should not flag crypto.randomBytes', async () => {
      const code = `
        import crypto from 'crypto';

        function generateToken() {
          return crypto.randomBytes(32).toString('hex');
        }
      `;
      const filePath = path.join(tempDir, 'secure-random.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const weakRandom = results.find(r => r.category === 'insecure-random');
      expect(weakRandom).toBeUndefined();
    });
  });

  describe('Authentication Issues Detection', () => {
    it('should detect missing authentication middleware', async () => {
      const code = `
        app.get('/admin/users', (req, res) => {
          res.json(getAllUsers());
        });
      `;
      const filePath = path.join(tempDir, 'no-auth.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const authIssue = results.find(r => r.category === 'missing-authentication');
      expect(authIssue).toBeDefined();
    });

    it('should not flag routes with authentication', async () => {
      const code = `
        app.get('/admin/users', authenticate, authorize(['admin']), (req, res) => {
          res.json(getAllUsers());
        });
      `;
      const filePath = path.join(tempDir, 'with-auth.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const authIssue = results.find(r => r.category === 'missing-authentication');
      expect(authIssue).toBeUndefined();
    });
  });

  describe('CORS Misconfiguration Detection', () => {
    it('should detect wildcard CORS origin', async () => {
      const code = `
        app.use(cors({
          origin: '*'
        }));
      `;
      const filePath = path.join(tempDir, 'cors.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const corsIssue = results.find(r => r.category === 'cors-misconfiguration');
      expect(corsIssue).toBeDefined();
    });

    it('should not flag specific CORS origins', async () => {
      const code = `
        app.use(cors({
          origin: 'https://example.com'
        }));
      `;
      const filePath = path.join(tempDir, 'safe-cors.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      const corsIssue = results.find(r => r.category === 'cors-misconfiguration');
      expect(corsIssue).toBeUndefined();
    });
  });

  describe('Comprehensive Scan', () => {
    it('should detect multiple vulnerability types in one file', async () => {
      const code = `
        import { exec } from 'child_process';
        import crypto from 'crypto';

        function vulnerableFunction(userInput: string) {
          // SQL Injection
          const query = "SELECT * FROM users WHERE name = '" + userInput + "'";

          // Command Injection
          exec('ls ' + userInput);

          // Weak Cryptography
          const hash = crypto.createHash('md5').update(userInput).digest('hex');

          // XSS
          document.getElementById('output').innerHTML = userInput;

          return { query, hash };
        }
      `;
      const filePath = path.join(tempDir, 'multiple-vulns.ts');
      fs.writeFileSync(filePath, code);

      const results = await scanner.scanFile(filePath);

      expect(results.length).toBeGreaterThanOrEqual(4);
      expect(results.some(r => r.category === 'sql-injection')).toBe(true);
      expect(results.some(r => r.category === 'command-injection')).toBe(true);
      expect(results.some(r => r.category === 'weak-cryptography')).toBe(true);
      expect(results.some(r => r.category === 'xss')).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should scan large files efficiently', async () => {
      let code = 'import fs from "fs";\n';
      for (let i = 0; i < 1000; i++) {
        code += `function func${i}() { return ${i}; }\n`;
      }
      const filePath = path.join(tempDir, 'large.ts');
      fs.writeFileSync(filePath, code);

      const start = Date.now();
      await scanner.scanFile(filePath);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(2000); // Should complete in < 2 seconds
    });
  });
});
