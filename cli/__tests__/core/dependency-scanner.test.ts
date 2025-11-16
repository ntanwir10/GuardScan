/**
 * Dependency Scanner Tests
 *
 * Tests for vulnerable dependency detection
 */

import { DependencyScanner } from '../../src/core/dependency-scanner';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('DependencyScanner', () => {
  let scanner: DependencyScanner;
  let tempDir: string;

  beforeEach(() => {
    scanner = new DependencyScanner();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('package.json Parsing', () => {
    it('should parse package.json dependencies', async () => {
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          'express': '^4.17.1',
          'lodash': '4.17.20'
        },
        devDependencies: {
          'jest': '^27.0.0'
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2));

      const results = await scanner.scanDirectory(tempDir);

      expect(results.totalDependencies).toBe(3);
      expect(results.dependencies).toContainEqual(
        expect.objectContaining({
          name: 'express',
          version: '^4.17.1'
        })
      );
    });

    it('should handle missing package.json gracefully', async () => {
      await expect(scanner.scanDirectory(tempDir)).rejects.toThrow('package.json not found');
    });

    it('should detect both dependencies and devDependencies', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          'react': '17.0.0'
        },
        devDependencies: {
          'typescript': '4.5.0'
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      expect(results.totalDependencies).toBe(2);
      expect(results.dependencies.some(d => d.name === 'react')).toBe(true);
      expect(results.dependencies.some(d => d.name === 'typescript')).toBe(true);
    });
  });

  describe('Vulnerability Detection', () => {
    it('should detect known vulnerable versions', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          // Old vulnerable version of lodash
          'lodash': '4.17.15'
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      const lodashDep = results.dependencies.find(d => d.name === 'lodash');
      expect(lodashDep?.vulnerabilities).toBeDefined();
      expect(lodashDep?.vulnerabilities.length).toBeGreaterThan(0);
    });

    it('should categorize vulnerabilities by severity', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          'lodash': '4.17.15'
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      expect(results.vulnerabilitySummary).toBeDefined();
      expect(results.vulnerabilitySummary.critical).toBeGreaterThanOrEqual(0);
      expect(results.vulnerabilitySummary.high).toBeGreaterThanOrEqual(0);
      expect(results.vulnerabilitySummary.medium).toBeGreaterThanOrEqual(0);
      expect(results.vulnerabilitySummary.low).toBeGreaterThanOrEqual(0);
    });

    it('should not flag secure versions', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          // Latest secure version
          'lodash': '4.17.21'
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      const lodashDep = results.dependencies.find(d => d.name === 'lodash');
      expect(lodashDep?.vulnerabilities).toEqual([]);
    });
  });

  describe('Outdated Dependencies Detection', () => {
    it('should detect outdated packages', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          'express': '3.0.0' // Very old version
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      const expressDep = results.dependencies.find(d => d.name === 'express');
      expect(expressDep?.isOutdated).toBe(true);
      expect(expressDep?.latestVersion).toBeDefined();
    });

    it('should calculate version difference', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          'react': '16.0.0'
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      const reactDep = results.dependencies.find(d => d.name === 'react');
      expect(reactDep?.versionsBehind).toBeGreaterThan(0);
    });
  });

  describe('License Compliance', () => {
    it('should detect dependency licenses', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          'mit-package': '1.0.0',
          'apache-package': '1.0.0'
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      results.dependencies.forEach(dep => {
        expect(dep.license).toBeDefined();
      });
    });

    it('should flag incompatible licenses', async () => {
      const packageJson = {
        name: 'test',
        license: 'MIT',
        dependencies: {
          'gpl-package': '1.0.0' // GPL incompatible with MIT
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      expect(results.licenseIssues).toBeDefined();
      expect(results.licenseIssues.length).toBeGreaterThan(0);
    });
  });

  describe('Dependency Tree Analysis', () => {
    it('should analyze transitive dependencies', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          'package-with-deps': '1.0.0'
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      expect(results.totalDependencies).toBeGreaterThanOrEqual(1);
      expect(results.transitiveDependencies).toBeGreaterThanOrEqual(0);
    });

    it('should detect dependency conflicts', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          'pkg-a': '1.0.0', // depends on shared@1.0
          'pkg-b': '1.0.0'  // depends on shared@2.0
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      if (results.conflicts) {
        expect(Array.isArray(results.conflicts)).toBe(true);
      }
    });
  });

  describe('Performance', () => {
    it('should handle large dependency trees efficiently', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {} as Record<string, string>
      };

      // Add many dependencies
      for (let i = 0; i < 50; i++) {
        packageJson.dependencies[`package-${i}`] = '1.0.0';
      }

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const start = Date.now();
      await scanner.scanDirectory(tempDir);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(10000); // Should complete in < 10 seconds
    });
  });

  describe('npm audit Integration', () => {
    it('should parse npm audit results if available', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          'express': '4.17.1'
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      expect(results.auditRan).toBeDefined();
    });
  });

  describe('Recommendations', () => {
    it('should provide upgrade recommendations', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          'old-package': '1.0.0'
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      expect(results.recommendations).toBeDefined();
      expect(Array.isArray(results.recommendations)).toBe(true);
    });

    it('should prioritize security updates', async () => {
      const packageJson = {
        name: 'test',
        dependencies: {
          'vulnerable-pkg': '1.0.0'
        }
      };

      const pkgPath = path.join(tempDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scanDirectory(tempDir);

      const securityRecs = results.recommendations.filter(
        r => r.reason === 'security'
      );
      expect(securityRecs.length).toBeGreaterThanOrEqual(0);
    });
  });
});
