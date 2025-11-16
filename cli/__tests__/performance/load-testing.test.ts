/**
 * Load Testing Framework
 *
 * Tests GuardScan performance with large codebases (100k+ LOC)
 * Validates memory usage, execution time, and scalability
 *
 * P0: Critical Before Launch
 */

import { ASTParser } from '../../src/core/ast-parser';
import { LOCCounter, countLOC } from '../../src/core/loc-counter';
import { OWASPScanner } from '../../src/core/owasp-scanner';
import { DependencyScanner } from '../../src/core/dependency-scanner';
import { SecretsDetector } from '../../src/core/secrets-detector';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Performance Metrics
 */
interface PerformanceMetrics {
  executionTime: number;
  memoryUsed: number;
  peakMemory: number;
  filesProcessed: number;
  linesProcessed: number;
  throughput: number; // LOC per second
}

/**
 * Load Test Generator
 * Generates synthetic code files for load testing
 */
class LoadTestGenerator {
  /**
   * Generate TypeScript files with specified LOC
   */
  generateTypeScriptFiles(targetLOC: number, targetDir: string): number {
    let totalLOC = 0;
    let fileCount = 0;

    // Generate multiple files (max 5000 LOC per file)
    const locsPerFile = 5000;
    const fileCount = Math.ceil(targetLOC / locsPerFile);

    for (let i = 0; i < fileCount; i++) {
      const fileName = `generated-${i}.ts`;
      const filePath = path.join(targetDir, fileName);
      const fileLOC = Math.min(locsPerFile, targetLOC - totalLOC);

      const content = this.generateTypeScriptFile(fileLOC);
      fs.writeFileSync(filePath, content);

      totalLOC += fileLOC;
    }

    return totalLOC;
  }

  /**
   * Generate a single TypeScript file with specified LOC
   */
  private generateTypeScriptFile(targetLOC: number): string {
    let code = '';
    let currentLOC = 0;

    // Add imports
    code += `import * as fs from 'fs';\n`;
    code += `import * as path from 'path';\n`;
    code += `import { EventEmitter } from 'events';\n\n`;
    currentLOC += 4;

    // Generate classes
    const classCount = Math.floor(targetLOC / 100);
    for (let i = 0; i < classCount && currentLOC < targetLOC; i++) {
      code += this.generateClass(i, Math.min(100, targetLOC - currentLOC));
      currentLOC += 100;
    }

    // Generate remaining functions
    while (currentLOC < targetLOC) {
      code += this.generateFunction(currentLOC);
      currentLOC += 15;
    }

    return code;
  }

  /**
   * Generate a class with methods
   */
  private generateClass(index: number, targetLOC: number): string {
    let code = `\n/**\n * Generated class ${index}\n */\n`;
    code += `export class GeneratedClass${index} {\n`;
    code += `  private value: number = 0;\n`;
    code += `  private data: Map<string, any> = new Map();\n\n`;

    const methodCount = Math.floor(targetLOC / 15);
    for (let i = 0; i < methodCount; i++) {
      code += `  public method${i}(param: number): number {\n`;
      code += `    if (param > 0) {\n`;
      code += `      this.value += param;\n`;
      code += `      return this.value * 2;\n`;
      code += `    } else if (param < 0) {\n`;
      code += `      this.value -= param;\n`;
      code += `      return this.value / 2;\n`;
      code += `    }\n`;
      code += `    return this.value;\n`;
      code += `  }\n\n`;
    }

    code += `}\n\n`;
    return code;
  }

  /**
   * Generate a function
   */
  private generateFunction(index: number): string {
    return `
/**
 * Generated function ${index}
 */
export function generatedFunction${index}(a: number, b: number): number {
  if (a > b) {
    return a + b;
  } else if (a < b) {
    return a - b;
  }
  return a * b;
}
`;
  }

  /**
   * Generate package.json with dependencies
   */
  generatePackageJson(targetDir: string, dependencyCount: number = 50): void {
    const dependencies: Record<string, string> = {};

    // Common dependencies
    const commonDeps = [
      { name: 'express', version: '^4.18.0' },
      { name: 'react', version: '^18.2.0' },
      { name: 'lodash', version: '^4.17.21' },
      { name: 'axios', version: '^1.4.0' },
      { name: 'typescript', version: '^5.0.0' },
      { name: 'jest', version: '^29.0.0' },
      { name: 'eslint', version: '^8.0.0' },
      { name: 'webpack', version: '^5.0.0' },
      { name: 'babel', version: '^7.0.0' },
      { name: 'next', version: '^13.0.0' }
    ];

    for (let i = 0; i < Math.min(dependencyCount, commonDeps.length); i++) {
      dependencies[commonDeps[i].name] = commonDeps[i].version;
    }

    const packageJson = {
      name: 'load-test-project',
      version: '1.0.0',
      description: 'Load testing synthetic project',
      dependencies
    };

    fs.writeFileSync(
      path.join(targetDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
  }
}

/**
 * Performance Monitor
 */
class PerformanceMonitor {
  private startTime: number = 0;
  private startMemory: number = 0;
  private peakMemory: number = 0;

  start(): void {
    this.startTime = Date.now();
    this.startMemory = process.memoryUsage().heapUsed;
    this.peakMemory = this.startMemory;
  }

  updatePeakMemory(): void {
    const currentMemory = process.memoryUsage().heapUsed;
    if (currentMemory > this.peakMemory) {
      this.peakMemory = currentMemory;
    }
  }

  getMetrics(filesProcessed: number, linesProcessed: number): PerformanceMetrics {
    const endTime = Date.now();
    const endMemory = process.memoryUsage().heapUsed;
    const executionTime = endTime - this.startTime;

    return {
      executionTime,
      memoryUsed: endMemory - this.startMemory,
      peakMemory: this.peakMemory - this.startMemory,
      filesProcessed,
      linesProcessed,
      throughput: linesProcessed / (executionTime / 1000)
    };
  }

  formatMetrics(metrics: PerformanceMetrics): string {
    return `
Performance Metrics:
  - Execution Time: ${metrics.executionTime}ms
  - Memory Used: ${(metrics.memoryUsed / 1024 / 1024).toFixed(2)}MB
  - Peak Memory: ${(metrics.peakMemory / 1024 / 1024).toFixed(2)}MB
  - Files Processed: ${metrics.filesProcessed}
  - Lines Processed: ${metrics.linesProcessed}
  - Throughput: ${Math.round(metrics.throughput)} LOC/sec
    `.trim();
  }
}

describe('Load Testing Framework', () => {
  let tempDir: string;
  let generator: LoadTestGenerator;
  let monitor: PerformanceMonitor;

  beforeAll(() => {
    generator = new LoadTestGenerator();
    monitor = new PerformanceMonitor();
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Small Codebase (10k LOC)', () => {
    it('should handle 10k LOC within 5 seconds', async () => {
      const targetLOC = 10000;

      monitor.start();
      const actualLOC = generator.generateTypeScriptFiles(targetLOC, tempDir);

      const result = await countLOC(tempDir);
      monitor.updatePeakMemory();

      const fileCount = fs.readdirSync(tempDir).length;
      const metrics = monitor.getMetrics(fileCount, actualLOC);

      console.log(`\n[10k LOC Test]\n${monitor.formatMetrics(metrics)}`);

      expect(metrics.executionTime).toBeLessThan(5000);
      expect(result.total).toBeGreaterThan(8000); // Allow 20% margin
    });
  });

  describe('Medium Codebase (50k LOC)', () => {
    it('should handle 50k LOC within 15 seconds', async () => {
      const targetLOC = 50000;

      monitor.start();
      const actualLOC = generator.generateTypeScriptFiles(targetLOC, tempDir);

      const result = await countLOC(tempDir);
      monitor.updatePeakMemory();

      const fileCount = fs.readdirSync(tempDir).length;
      const metrics = monitor.getMetrics(fileCount, actualLOC);

      console.log(`\n[50k LOC Test]\n${monitor.formatMetrics(metrics)}`);

      expect(metrics.executionTime).toBeLessThan(15000);
      expect(metrics.peakMemory).toBeLessThan(200 * 1024 * 1024); // <200MB
    }, 30000);
  });

  describe('Large Codebase (100k LOC)', () => {
    it('should handle 100k LOC within 30 seconds', async () => {
      const targetLOC = 100000;

      monitor.start();
      const actualLOC = generator.generateTypeScriptFiles(targetLOC, tempDir);

      const result = await countLOC(tempDir);
      monitor.updatePeakMemory();

      const fileCount = fs.readdirSync(tempDir).length;
      const metrics = monitor.getMetrics(fileCount, actualLOC);

      console.log(`\n[100k LOC Test]\n${monitor.formatMetrics(metrics)}`);

      expect(metrics.executionTime).toBeLessThan(30000);
      expect(metrics.peakMemory).toBeLessThan(500 * 1024 * 1024); // <500MB
      expect(metrics.throughput).toBeGreaterThan(3000); // >3k LOC/sec
    }, 60000);
  });

  describe('AST Parser Performance', () => {
    it('should parse large files efficiently', async () => {
      const parser = new ASTParser();
      const targetLOC = 10000;

      generator.generateTypeScriptFiles(targetLOC, tempDir);
      const files = fs.readdirSync(tempDir).map(f => path.join(tempDir, f));

      monitor.start();

      for (const file of files) {
        await parser.parseFile(file);
        monitor.updatePeakMemory();
      }

      const metrics = monitor.getMetrics(files.length, targetLOC);

      console.log(`\n[AST Parser Test]\n${monitor.formatMetrics(metrics)}`);

      expect(metrics.executionTime).toBeLessThan(10000);
      expect(metrics.peakMemory).toBeLessThan(300 * 1024 * 1024);
    }, 30000);
  });

  describe('Security Scanner Performance', () => {
    it('should scan large codebases efficiently', async () => {
      const scanner = new OWASPScanner();
      const targetLOC = 20000;

      generator.generateTypeScriptFiles(targetLOC, tempDir);
      const files = fs.readdirSync(tempDir).map(f => path.join(tempDir, f));

      monitor.start();

      for (const file of files) {
        await scanner.scanFile(file);
        monitor.updatePeakMemory();
      }

      const metrics = monitor.getMetrics(files.length, targetLOC);

      console.log(`\n[OWASP Scanner Test]\n${monitor.formatMetrics(metrics)}`);

      expect(metrics.executionTime).toBeLessThan(20000);
    }, 40000);
  });

  describe('Dependency Scanner Performance', () => {
    it('should scan dependencies efficiently', async () => {
      const scanner = new DependencyScanner();

      generator.generatePackageJson(tempDir, 50);

      monitor.start();
      const results = await scanner.scanDirectory(tempDir);
      monitor.updatePeakMemory();

      const metrics = monitor.getMetrics(1, 50);

      console.log(`\n[Dependency Scanner Test]\n${monitor.formatMetrics(metrics)}`);

      expect(metrics.executionTime).toBeLessThan(5000);
      expect(results.totalDependencies).toBe(50);
    });
  });

  describe('Memory Leak Detection', () => {
    it('should not leak memory during repeated scans', async () => {
      const targetLOC = 5000;
      generator.generateTypeScriptFiles(targetLOC, tempDir);

      const initialMemory = process.memoryUsage().heapUsed;

      // Run 10 iterations
      for (let i = 0; i < 10; i++) {
        await countLOC(tempDir);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;

      console.log(`\nMemory Growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB`);

      // Memory growth should be minimal (<50MB for 10 iterations)
      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
    });
  });

  describe('Concurrent Processing', () => {
    it('should handle concurrent file processing', async () => {
      const targetLOC = 20000;
      generator.generateTypeScriptFiles(targetLOC, tempDir);

      const files = fs.readdirSync(tempDir).map(f => path.join(tempDir, f));

      monitor.start();

      // Process files concurrently (batches of 5)
      const batchSize = 5;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        await Promise.all(batch.map(f => countLOC(path.dirname(f))));
        monitor.updatePeakMemory();
      }

      const metrics = monitor.getMetrics(files.length, targetLOC);

      console.log(`\n[Concurrent Processing Test]\n${monitor.formatMetrics(metrics)}`);

      expect(metrics.executionTime).toBeLessThan(15000);
    }, 30000);
  });

  describe('Scalability Test', () => {
    it('should scale linearly with codebase size', async () => {
      const sizes = [1000, 5000, 10000];
      const results: { size: number; time: number }[] = [];

      for (const size of sizes) {
        const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-test-'));

        monitor.start();
        generator.generateTypeScriptFiles(size, testDir);
        await countLOC(testDir);

        const metrics = monitor.getMetrics(1, size);
        results.push({ size, time: metrics.executionTime });

        fs.rmSync(testDir, { recursive: true, force: true });
      }

      console.log('\n[Scalability Test]');
      results.forEach(r => {
        console.log(`  ${r.size} LOC: ${r.time}ms (${Math.round(r.size / (r.time / 1000))} LOC/sec)`);
      });

      // Check that execution time scales roughly linearly
      const ratio1 = results[1].time / results[0].time;
      const ratio2 = results[2].time / results[1].time;

      // Ratios should be similar (within 50%)
      expect(Math.abs(ratio1 - ratio2) / ratio1).toBeLessThan(0.5);
    }, 60000);
  });
});
