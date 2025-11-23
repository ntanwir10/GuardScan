/**
 * Refactoring Suggestions Tests
 *
 * Tests for AI-powered refactoring suggestions (Phase 5)
 */

import {
  RefactoredCode,
  RefactoringSuggestionsEngine,
} from "../../src/features/refactoring-suggestions";
import { AIProvider, ProviderCapabilities } from "../../src/providers/base";
import { CodebaseIndexer } from "../../src/core/codebase-indexer";
import { AICache } from "../../src/core/ai-cache";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";

// Mock AI Provider
class MockAIProvider extends AIProvider {
  getCapabilities(): ProviderCapabilities {
    return {
      supportsChat: true,
      supportsEmbeddings: false,
      supportsStreaming: true,
      maxContextTokens: 4096,
      embeddingDimensions: 768,
    };
  }
  async chat(messages: any[]): Promise<any> {
    const prompt = messages[messages.length - 1].content;

    if (prompt.includes("code smell")) {
      return {
        content: JSON.stringify([
          {
            type: "long-method" as const,
            severity: "medium" as const,
            file: "test.ts",
            startLine: 1,
            endLine: 50,
            symbolName: "processData",
            description: "Method is too long",
            suggestedRefactoring: "Extract smaller methods",
          },
        ]),
      };
    }

    if (prompt.includes("design pattern")) {
      return {
        content: JSON.stringify([
          {
            pattern: "factory",
            confidence: 0.85,
            file: "test.ts",
            targetSymbol: "createObject",
            rationale: "Multiple object creation logic",
            benefits: ["Separation of concerns", "Easier testing"],
            implementation: "Use Factory pattern",
            estimatedEffort: "medium",
          },
        ]),
      };
    }

    return { content: "{}" };
  }

  isAvailable(): boolean {
    return true;
  }

  getName(): string {
    return "mock";
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}

describe("RefactoringSuggestionsEngine", () => {
  let engine: RefactoringSuggestionsEngine;
  let mockProvider: MockAIProvider;
  let tempDir: string;
  let repoId: string;

  beforeEach(() => {
    mockProvider = new MockAIProvider();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "refactor-test-"));
    repoId = "test-repo-id";

    // Create a basic project structure
    fs.mkdirSync(path.join(tempDir, "src"));
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        version: "1.0.0",
      })
    );

    const indexer = new CodebaseIndexer(tempDir, repoId);
    const cache = new AICache(repoId);
    engine = new RefactoringSuggestionsEngine(mockProvider, tempDir, repoId);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Code Smell Detection", () => {
    it("should detect long methods", async () => {
      const code = `
        function veryLongMethod() {
          ${Array(100).fill('console.log("line");').join("\n")}
        }
      `;
      const filePath = path.join(tempDir, "src", "long.ts");
      fs.writeFileSync(filePath, code);

      const smells = await engine.detectCodeSmells(filePath);

      expect(smells).toBeDefined();
      expect(Array.isArray(smells)).toBe(true);
      const longMethod = smells.find((s) => s.type === "long-method");
      expect(longMethod).toBeDefined();
    });

    it("should detect god classes", async () => {
      const code = `
        class GodClass {
          method1() {}
          method2() {}
          method3() {}
          ${Array(50).fill("method() {}").join("\n")}
        }
      `;
      const filePath = path.join(tempDir, "src", "god.ts");
      fs.writeFileSync(filePath, code);

      const smells = await engine.detectCodeSmells(filePath);

      expect(
        smells.some((s) => s.type === "large-class" || s.type === "god-class")
      ).toBe(true);
    });

    it("should detect high complexity", async () => {
      // Create a function with high cyclomatic complexity (>10)
      const code = `
        function complex(a: number, b: number, c: number, d: number): number {
          if (a > 0) {
            if (b > 0) {
              if (c > 0) {
                if (d > 0) {
                  for (let i = 0; i < 10; i++) {
                    if (i % 2 === 0) {
                      if (a > b) {
                        if (c > d) {
                          return a + b + c + d + i;
                        } else {
                          return a + b - c - d + i;
                        }
                      } else {
                        if (c > d) {
                          return a - b + c + d + i;
                        } else {
                          return a - b - c - d + i;
                        }
                      }
                    } else {
                      if (a > b) {
                        return a + b + i;
                      } else {
                        return a - b + i;
                      }
                    }
                  }
                }
              }
            }
          }
          return 0;
        }
      `;
      const filePath = path.join(tempDir, "src", "complex.ts");
      fs.writeFileSync(filePath, code);

      const smells = await engine.detectCodeSmells(filePath);

      // High complexity is detected as "switch-statements" (misnomer in code)
      const complexityIssue = smells.find((s) => s.type === "switch-statements");
      expect(complexityIssue).toBeDefined();
    });

    it("should categorize smells by severity", async () => {
      const code = `
        function moderateIssue() {
          // Some code
        }
      `;
      const filePath = path.join(tempDir, "src", "moderate.ts");
      fs.writeFileSync(filePath, code);

      const smells = await engine.detectCodeSmells(filePath);

      smells.forEach((smell) => {
        expect(["critical", "high", "medium", "low"]).toContain(smell.severity);
      });
    });
  });

  describe("Design Pattern Suggestions", () => {
    it("should suggest Factory pattern", async () => {
      const code = `
        function createObject(type: string) {
          if (type === 'a') return new A();
          if (type === 'b') return new B();
          return new C();
        }
      `;
      const filePath = path.join(tempDir, "src", "factory.ts");
      fs.writeFileSync(filePath, code);

      const patterns = await engine.suggestPatterns(filePath);

      expect(patterns).toBeDefined();
      const factoryPattern = patterns.find((p) => p.pattern === "factory");
      expect(factoryPattern).toBeDefined();
      expect(factoryPattern?.confidence).toBeGreaterThan(0);
    });

    it("should include rationale for suggestions", async () => {
      const code = `
        class Service {
          // Some service code
        }
      `;
      const filePath = path.join(tempDir, "src", "service.ts");
      fs.writeFileSync(filePath, code);

      const patterns = await engine.suggestPatterns(filePath);

      patterns.forEach((pattern) => {
        expect(pattern.rationale).toBeDefined();
        expect(pattern.benefits).toBeDefined();
        expect(Array.isArray(pattern.benefits)).toBe(true);
      });
    });

    it("should estimate implementation effort", async () => {
      const code = `
        function process() {
          // Processing logic
        }
      `;
      const filePath = path.join(tempDir, "src", "process.ts");
      fs.writeFileSync(filePath, code);

      const patterns = await engine.suggestPatterns(filePath);

      patterns.forEach((pattern) => {
        expect(["low", "medium", "high"]).toContain(pattern.estimatedEffort);
      });
    });
  });

  describe("Refactored Code Generation", () => {
    it("should generate refactored code", async () => {
      const code = `
        function longMethod() {
          const a = 1;
          const b = 2;
          return a + b;
        }
      `;
      const filePath = path.join(tempDir, "src", "refactor.ts");
      fs.writeFileSync(filePath, code);

      const smell = {
        type: "long-method" as const,
        severity: "medium" as const,
        file: filePath,
        startLine: 1,
        endLine: 6,
        symbolName: "longMethod",
        description: "Method too long",
        suggestedRefactoring: "Extract smaller methods",
      };

      mockProvider.chat = async () => ({
        content: JSON.stringify({
          refactored: {
            files: [
              {
                path: filePath,
                content: "function shortMethod() { return helper(); }",
                isNew: false
              }
            ],
            explanation: "Extracted helper method",
            changes: [
              "Extracted helper method",
            ]
          },
          improvements: {
            complexity: 20,
            maintainability: 15,
            readability: 25
          },
          confidence: 0.8
        }),
      });

      const result = await engine.generateRefactoredCode(filePath, smell);

      expect(result).toBeDefined();
      expect(result.refactored).toBeDefined();
      expect(result.refactored.files).toBeDefined();
      expect(result.refactored.files.length).toBeGreaterThan(0);
      expect(result.refactored.files[0].content).toBeTruthy();
      expect(result.refactored.changes).toBeDefined();
    });
  });

  describe("Impact Analysis", () => {
    it("should analyze refactoring impact", async () => {
      const refactoredCode = {
        file: "test.ts",
        originalContent: "function old() {}",
        migratedContent: "function new() {}",
        changes: [],
        issues: [],
        success: true,
        manualStepsRequired: [],
      };

      mockProvider.chat = async () => ({
        content: JSON.stringify({
          affectedFiles: ["test.ts", "test.spec.ts"],
          breakingChanges: [],
          estimatedEffort: { hours: 2, complexity: "low" },
          risks: [],
          recommendations: [],
        }),
      });

      const testFilePath = path.join(tempDir, "src", "test.ts");
      fs.writeFileSync(testFilePath, "function old() {}");

      const impact = await engine.analyzeImpact(testFilePath, {
        original: {
          file: "test.ts",
          startLine: 1,
          endLine: 1,
          code: "function old() {}",
        },
        refactored: {
          files: [
            {
              path: "test.ts",
              content: "function new() {}",
              isNew: false,
              changes: "Extracted helper",
            },
          ],
          explanation: "",
          changes: ["Extracted helper"],
        },
        improvements: {
          complexity: 0,
          maintainability: 0,
          readability: 0,
        },
        confidence: 1,
      } as RefactoredCode);

      expect(impact.affectedFiles).toBeDefined();
      expect(impact.estimatedEffort).toBeDefined();
    });
  });

  describe("Report Generation", () => {
    it("should generate comprehensive report", async () => {
      const code = `
        function test() {
          return 42;
        }
      `;
      const filePath = path.join(tempDir, "src", "report.ts");
      fs.writeFileSync(filePath, code);

      const report = await engine.generateReport(filePath);

      expect(report).toBeDefined();
      expect(report.smells).toBeDefined();
      expect(report.patterns).toBeDefined();
      expect(report.prioritizedSuggestions).toBeDefined();
    });
  });

  describe("Performance", () => {
    it("should handle large files efficiently", async () => {
      let code = "";
      for (let i = 0; i < 200; i++) {
        code += `function func${i}() { return ${i}; }\n`;
      }
      const filePath = path.join(tempDir, "src", "large.ts");
      fs.writeFileSync(filePath, code);

      const start = Date.now();
      await engine.detectCodeSmells(filePath);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(10000); // < 10 seconds
    });
  });
});
