/**
 * Code Explainer Tests
 *
 * Tests for AI-powered code explanation feature
 */

import { CodeExplainer } from '../../src/features/code-explainer';
import { AIProvider } from '../../src/providers/base';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock AI Provider
class MockAIProvider extends AIProvider {
  async chat(messages: any[]): Promise<any> {
    return {
      content: JSON.stringify({
        summary: 'This function adds two numbers',
        purpose: 'To perform addition',
        inputs: [
          { name: 'a', type: 'number', description: 'First number' },
          { name: 'b', type: 'number', description: 'Second number' }
        ],
        outputs: { type: 'number', description: 'Sum of a and b' },
        dataFlow: [
          { step: 1, description: 'Receive inputs a and b' },
          { step: 2, description: 'Add a + b' },
          { step: 3, description: 'Return result' }
        ],
        patterns: [],
        complexity: 'low'
      })
    };
  }

  isAvailable(): boolean {
    return true;
  }

  getName(): string {
    return 'mock';
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}

describe('CodeExplainer', () => {
  let explainer: CodeExplainer;
  let mockProvider: MockAIProvider;
  let tempDir: string;

  beforeEach(() => {
    mockProvider = new MockAIProvider();
    explainer = new CodeExplainer(mockProvider);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Function Explanation', () => {
    it('should explain a simple function', async () => {
      const code = `
        function add(a: number, b: number): number {
          return a + b;
        }
      `;

      const result = await explainer.explainCode(code);

      expect(result.summary).toBeDefined();
      expect(result.purpose).toBeDefined();
      expect(result.inputs).toHaveLength(2);
      expect(result.outputs).toBeDefined();
      expect(result.complexity).toBe('low');
    });

    it('should handle complex functions', async () => {
      const code = `
        async function processData(items: any[]): Promise<ProcessedData[]> {
          const results = await Promise.all(
            items.map(async item => {
              const validated = await validate(item);
              const transformed = transform(validated);
              return save(transformed);
            })
          );
          return results;
        }
      `;

      const result = await explainer.explainCode(code);

      expect(result).toBeDefined();
      expect(result.summary).toBeTruthy();
    });

    it('should identify async patterns', async () => {
      const code = `
        async function fetchUserData(userId: string) {
          const response = await fetch(\`/api/users/\${userId}\`);
          return await response.json();
        }
      `;

      const result = await explainer.explainCode(code);

      expect(result.dataFlow).toBeDefined();
      expect(result.dataFlow.length).toBeGreaterThan(0);
    });
  });

  describe('Class Explanation', () => {
    it('should explain class structure', async () => {
      const code = `
        class Calculator {
          private value: number = 0;

          add(n: number): void {
            this.value += n;
          }

          getValue(): number {
            return this.value;
          }
        }
      `;

      const result = await explainer.explainCode(code);

      expect(result.summary).toContain('Calculator');
      expect(result).toBeDefined();
    });

    it('should explain inheritance', async () => {
      const code = `
        class Animal {
          move() { console.log('Moving'); }
        }

        class Dog extends Animal {
          bark() { console.log('Woof'); }
        }
      `;

      const result = await explainer.explainCode(code);

      expect(result.patterns).toBeDefined();
    });
  });

  describe('Design Pattern Detection', () => {
    it('should detect Singleton pattern', async () => {
      const code = `
        class Singleton {
          private static instance: Singleton;

          private constructor() {}

          static getInstance(): Singleton {
            if (!Singleton.instance) {
              Singleton.instance = new Singleton();
            }
            return Singleton.instance;
          }
        }
      `;

      mockProvider.chat = async () => ({
        content: JSON.stringify({
          summary: 'Singleton pattern implementation',
          purpose: 'Ensure only one instance',
          inputs: [],
          outputs: { type: 'Singleton', description: 'Instance' },
          dataFlow: [],
          patterns: ['Singleton'],
          complexity: 'medium'
        })
      });

      const result = await explainer.explainCode(code);

      expect(result.patterns).toContain('Singleton');
    });

    it('should detect Factory pattern', async () => {
      const code = `
        class ShapeFactory {
          createShape(type: string): Shape {
            switch(type) {
              case 'circle': return new Circle();
              case 'square': return new Square();
              default: throw new Error('Unknown shape');
            }
          }
        }
      `;

      mockProvider.chat = async () => ({
        content: JSON.stringify({
          summary: 'Factory pattern',
          purpose: 'Create shapes',
          inputs: [],
          outputs: {},
          dataFlow: [],
          patterns: ['Factory'],
          complexity: 'medium'
        })
      });

      const result = await explainer.explainCode(code);

      expect(result.patterns).toContain('Factory');
    });
  });

  describe('Complexity Analysis', () => {
    it('should rate low complexity correctly', async () => {
      const code = `
        function getValue(key: string): string {
          return data[key];
        }
      `;

      const result = await explainer.explainCode(code);

      expect(result.complexity).toBe('low');
    });

    it('should detect high complexity', async () => {
      const code = `
        function complexLogic(a: number, b: number, c: number): number {
          if (a > 0) {
            if (b > 0) {
              for (let i = 0; i < 10; i++) {
                if (i % 2 === 0) {
                  if (c > 0) {
                    return a + b + c + i;
                  }
                }
              }
            }
          }
          return 0;
        }
      `;

      mockProvider.chat = async () => ({
        content: JSON.stringify({
          summary: 'Complex nested logic',
          purpose: 'Calculate value',
          inputs: [],
          outputs: {},
          dataFlow: [],
          patterns: [],
          complexity: 'high'
        })
      });

      const result = await explainer.explainCode(code);

      expect(result.complexity).toBe('high');
    });
  });

  describe('Data Flow Tracing', () => {
    it('should trace data through function', async () => {
      const code = `
        function processOrder(order: Order): ProcessedOrder {
          const validated = validateOrder(order);
          const priced = calculatePrice(validated);
          const taxed = addTax(priced);
          return saveOrder(taxed);
        }
      `;

      mockProvider.chat = async () => ({
        content: JSON.stringify({
          summary: 'Processes an order',
          purpose: 'Order processing pipeline',
          inputs: [],
          outputs: {},
          dataFlow: [
            { step: 1, description: 'Validate order' },
            { step: 2, description: 'Calculate price' },
            { step: 3, description: 'Add tax' },
            { step: 4, description: 'Save to database' }
          ],
          patterns: ['Pipeline'],
          complexity: 'medium'
        })
      });

      const result = await explainer.explainCode(code);

      expect(result.dataFlow).toHaveLength(4);
      expect(result.dataFlow[0].description).toContain('Validate');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid code gracefully', async () => {
      const code = `
        function broken(a: number {
          return a +
        }
      `;

      await expect(explainer.explainCode(code)).rejects.toThrow();
    });

    it('should handle AI provider failures', async () => {
      mockProvider.chat = async () => {
        throw new Error('AI service unavailable');
      };

      await expect(explainer.explainCode('function test() {}')).rejects.toThrow();
    });
  });

  describe('File-based Explanation', () => {
    it('should explain code from file', async () => {
      const code = `
        export function multiply(a: number, b: number): number {
          return a * b;
        }
      `;
      const filePath = path.join(tempDir, 'multiply.ts');
      fs.writeFileSync(filePath, code);

      const result = await explainer.explainFile(filePath);

      expect(result).toBeDefined();
      expect(result.summary).toBeTruthy();
    });

    it('should handle missing files', async () => {
      const nonExistentPath = path.join(tempDir, 'missing.ts');

      await expect(explainer.explainFile(nonExistentPath)).rejects.toThrow();
    });
  });

  describe('Performance', () => {
    it('should explain large files efficiently', async () => {
      let code = '';
      for (let i = 0; i < 50; i++) {
        code += `
          function func${i}(param: number): number {
            return param * ${i};
          }
        `;
      }

      const start = Date.now();
      await explainer.explainCode(code);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds
    });
  });
});
