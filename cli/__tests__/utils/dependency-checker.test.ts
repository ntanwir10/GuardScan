/**
 * Tests for dependency-checker utility
 */

import { describe, it } from "node:test";
import { expect } from "@jest/globals";
import {
  checkDependency,
  ensureDependency,
  checkDependencies,
  ensureDependencies,
  isTypeScriptAvailable,
  ensureTypeScript,
} from "../../src/utils/dependency-checker";

describe("Dependency Checker", () => {
  describe("checkDependency", () => {
    it("should return true for installed dependencies", () => {
      // Node.js built-in modules should always be available
      expect(checkDependency("fs")).toBe(true);
      expect(checkDependency("path")).toBe(true);
    });

    it("should return true for TypeScript if installed", () => {
      // TypeScript should be in dependencies now
      expect(checkDependency("typescript")).toBe(true);
    });

    it("should return false for non-existent packages", () => {
      expect(checkDependency("nonexistent-package-12345")).toBe(false);
    });
  });

  describe("ensureDependency", () => {
    it("should not throw for installed dependencies", () => {
      expect(() => ensureDependency("fs", "npm install fs")).not.toThrow();
    });

    it("should throw with helpful message for missing dependencies", () => {
      expect(() =>
        ensureDependency(
          "nonexistent-package-12345",
          "npm install nonexistent-package-12345"
        )
      ).toThrow("Required dependency");
      expect(() =>
        ensureDependency(
          "nonexistent-package-12345",
          "npm install nonexistent-package-12345"
        )
      ).toThrow("npm install nonexistent-package-12345");
    });
  });

  describe("checkDependencies", () => {
    it("should check multiple dependencies", () => {
      const result = checkDependencies([
        { name: "fs", installCommand: "npm install fs" },
        { name: "path", installCommand: "npm install path" },
      ]);

      expect(result.allAvailable).toBe(true);
      expect(result.available).toContain("fs");
      expect(result.available).toContain("path");
      expect(result.missing).toHaveLength(0);
    });

    it("should identify missing dependencies", () => {
      const result = checkDependencies([
        { name: "fs", installCommand: "npm install fs" },
        {
          name: "nonexistent-package-12345",
          installCommand: "npm install nonexistent-package-12345",
        },
      ]);

      expect(result.allAvailable).toBe(false);
      expect(result.available).toContain("fs");
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0].name).toBe("nonexistent-package-12345");
    });
  });

  describe("ensureDependencies", () => {
    it("should not throw when all dependencies are available", () => {
      expect(() =>
        ensureDependencies([
          { name: "fs", installCommand: "npm install fs" },
          { name: "path", installCommand: "npm install path" },
        ])
      ).not.toThrow();
    });

    it("should throw with helpful message for missing dependencies", () => {
      expect(() =>
        ensureDependencies([
          { name: "fs", installCommand: "npm install fs" },
          {
            name: "nonexistent-package-12345",
            installCommand: "npm install nonexistent-package-12345",
          },
        ])
      ).toThrow("Missing required dependencies");
    });
  });

  describe("isTypeScriptAvailable", () => {
    it("should return true if TypeScript is installed", () => {
      // TypeScript should be in dependencies
      expect(isTypeScriptAvailable()).toBe(true);
    });
  });

  describe("ensureTypeScript", () => {
    it("should not throw if TypeScript is installed", () => {
      // TypeScript should be in dependencies
      expect(() => ensureTypeScript()).not.toThrow();
    });
  });
});
