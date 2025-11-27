/**
 * Tests for AST Parser lazy loading functionality
 */

import { ASTParser } from "../../src/core/ast-parser";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { beforeAll, afterAll } from "@jest/globals";

describe("AST Parser Lazy Loading", () => {
  let tempDir: string;
  let testFile: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardscan-ast-test-"));
    testFile = path.join(tempDir, "test.ts");

    // Create a simple TypeScript file for testing
    fs.writeFileSync(
      testFile,
      `
export function hello(name: string): string {
  return \`Hello \${name}\`;
}

export class Greeter {
  greet(name: string): string {
    return hello(name);
  }
}
    `.trim()
    );
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("parseFile", () => {
    it("should parse TypeScript file successfully when TypeScript is available", async () => {
      const parser = new ASTParser();
      const result = await parser.parseFile(testFile);

      expect(result).toBeDefined();
      expect(result.path).toBe(testFile);
      expect(result.language).toBe("typescript");
      expect(result.functions).toHaveLength(2); // hello function + greet method
      expect(result.classes).toHaveLength(1); // Greeter class
      expect(result.functions[0].name).toBe("hello");
      expect(result.classes[0].name).toBe("Greeter");
    });

    it("should extract functions correctly", async () => {
      const parser = new ASTParser();
      const result = await parser.parseFile(testFile);

      const helloFunction = result.functions.find((f) => f.name === "hello");
      expect(helloFunction).toBeDefined();
      expect(helloFunction?.parameters).toHaveLength(1);
      expect(helloFunction?.parameters[0].name).toBe("name");
      expect(helloFunction?.returnType).toBe("string");
    });

    it("should extract classes correctly", async () => {
      const parser = new ASTParser();
      const result = await parser.parseFile(testFile);

      const greeterClass = result.classes.find((c) => c.name === "Greeter");
      expect(greeterClass).toBeDefined();
      expect(greeterClass?.methods).toHaveLength(1);
      expect(greeterClass?.methods[0].name).toBe("greet");
    });

    it("should calculate complexity correctly", async () => {
      const parser = new ASTParser();
      const result = await parser.parseFile(testFile);

      expect(result.complexity).toBeGreaterThan(0);
      expect(result.functions[0].complexity).toBeGreaterThan(0);
    });

    it("should extract imports and exports", async () => {
      const parser = new ASTParser();
      const result = await parser.parseFile(testFile);

      expect(result.exports).toBeDefined();
      expect(result.exports.length).toBeGreaterThan(0);
      expect(result.exports.some((e) => e.name === "hello")).toBe(true);
      expect(result.exports.some((e) => e.name === "Greeter")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should provide helpful error message for non-existent file", async () => {
      const parser = new ASTParser();
      const nonExistentFile = path.join(tempDir, "nonexistent.ts");

      await expect(parser.parseFile(nonExistentFile)).rejects.toThrow();
    });

    it("should handle invalid TypeScript syntax gracefully", async () => {
      const invalidFile = path.join(tempDir, "invalid.ts");
      fs.writeFileSync(invalidFile, "export function { invalid syntax }");

      const parser = new ASTParser();
      // Should still parse (TypeScript parser is lenient)
      const result = await parser.parseFile(invalidFile);
      expect(result).toBeDefined();
    });
  });

  describe("language detection", () => {
    it("should detect TypeScript files", async () => {
      const parser = new ASTParser();
      const result = await parser.parseFile(testFile);
      expect(result.language).toBe("typescript");
    });

    it("should detect JavaScript files", async () => {
      const jsFile = path.join(tempDir, "test.js");
      fs.writeFileSync(
        jsFile,
        "export function hello(name) { return `Hello ${name}`; }"
      );

      const parser = new ASTParser();
      const result = await parser.parseFile(jsFile);
      expect(result.language).toBe("javascript");
    });
  });
});
