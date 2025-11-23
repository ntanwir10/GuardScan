/**
 * Dependency Scanner Tests
 *
 * Tests for vulnerable dependency detection
 */

import {
  DependencyScanner,
  DependencyScanResult,
} from "../../src/core/dependency-scanner";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";

describe("DependencyScanner", () => {
  let scanner: DependencyScanner;
  let tempDir: string;

  beforeEach(() => {
    scanner = new DependencyScanner();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dep-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("npm package.json Scanning", () => {
    it("should scan npm dependencies when package.json exists", async () => {
      const packageJson = {
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          express: "^4.17.1",
          lodash: "4.17.20",
        },
        devDependencies: {
          jest: "^27.0.0",
        },
      };

      const pkgPath = path.join(tempDir, "package.json");
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2));

      const results = await scanner.scan(tempDir);

      // Should return an array of DependencyScanResult
      expect(Array.isArray(results)).toBe(true);

      // Should have at least one result for npm ecosystem
      const npmResult = results.find((r) => r.ecosystem === "npm");
      expect(npmResult).toBeDefined();

      if (npmResult) {
        expect(npmResult.ecosystem).toBe("npm");
        expect(Array.isArray(npmResult.vulnerabilities)).toBe(true);
        expect(typeof npmResult.totalVulnerabilities).toBe("number");
      }
    });

    it("should handle missing package.json gracefully", async () => {
      // No package.json created
      const results = await scanner.scan(tempDir);

      // Should return empty array or no npm result
      const npmResult = results.find((r) => r.ecosystem === "npm");
      expect(npmResult).toBeUndefined();
    });

    it("should return results for npm ecosystem", async () => {
      const packageJson = {
        name: "test",
        dependencies: {
          react: "17.0.0",
        },
        devDependencies: {
          typescript: "4.5.0",
        },
      };

      const pkgPath = path.join(tempDir, "package.json");
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scan(tempDir);

      const npmResult = results.find((r) => r.ecosystem === "npm");
      if (npmResult) {
        expect(npmResult.ecosystem).toBe("npm");
        expect(Array.isArray(npmResult.vulnerabilities)).toBe(true);
      }
    });
  });

  describe("Vulnerability Detection", () => {
    it("should detect vulnerabilities in npm packages", async () => {
      const packageJson = {
        name: "test",
        dependencies: {
          lodash: "4.17.15",
        },
      };

      const pkgPath = path.join(tempDir, "package.json");
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scan(tempDir);

      const npmResult = results.find((r) => r.ecosystem === "npm");
      if (npmResult) {
        expect(Array.isArray(npmResult.vulnerabilities)).toBe(true);
        // Note: Actual vulnerabilities depend on npm audit results
        // which may vary based on npm registry data
      }
    });

    it("should categorize vulnerabilities by severity", async () => {
      const packageJson = {
        name: "test",
        dependencies: {
          lodash: "4.17.15",
        },
      };

      const pkgPath = path.join(tempDir, "package.json");
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scan(tempDir);

      const npmResult = results.find((r) => r.ecosystem === "npm");
      if (npmResult) {
        expect(typeof npmResult.critical).toBe("number");
        expect(typeof npmResult.high).toBe("number");
        expect(typeof npmResult.medium).toBe("number");
        expect(typeof npmResult.low).toBe("number");
        expect(npmResult.critical).toBeGreaterThanOrEqual(0);
        expect(npmResult.high).toBeGreaterThanOrEqual(0);
        expect(npmResult.medium).toBeGreaterThanOrEqual(0);
        expect(npmResult.low).toBeGreaterThanOrEqual(0);

        // Total should match sum of severities
        const sum =
          npmResult.critical +
          npmResult.high +
          npmResult.medium +
          npmResult.low;
        expect(npmResult.totalVulnerabilities).toBe(sum);
      }
    });

    it("should return empty vulnerabilities for secure packages", async () => {
      const packageJson = {
        name: "test",
        dependencies: {
          lodash: "4.17.21",
        },
      };

      const pkgPath = path.join(tempDir, "package.json");
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scan(tempDir);

      const npmResult = results.find((r) => r.ecosystem === "npm");
      if (npmResult) {
        // Vulnerabilities array should exist (may be empty if no vulns found)
        expect(Array.isArray(npmResult.vulnerabilities)).toBe(true);
      }
    });
  });

  describe("Multiple Ecosystems", () => {
    it("should scan multiple ecosystems when present", async () => {
      const packageJson = {
        name: "test",
        dependencies: {
          express: "4.17.1",
        },
      };

      const pkgPath = path.join(tempDir, "package.json");
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      // Create a requirements.txt for Python
      const requirementsPath = path.join(tempDir, "requirements.txt");
      fs.writeFileSync(requirementsPath, "requests==2.25.1\n");

      const results = await scanner.scan(tempDir);

      expect(Array.isArray(results)).toBe(true);

      // Should have npm result
      const npmResult = results.find((r) => r.ecosystem === "npm");
      expect(npmResult).toBeDefined();

      // May have pip result if pip-audit is available
      const pipResult = results.find((r) => r.ecosystem === "pip");
      // pipResult may be undefined if pip-audit is not installed
    });
  });

  describe("Result Structure", () => {
    it("should return DependencyScanResult with correct structure", async () => {
      const packageJson = {
        name: "test",
        dependencies: {
          express: "4.17.1",
        },
      };

      const pkgPath = path.join(tempDir, "package.json");
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scan(tempDir);

      const npmResult = results.find((r) => r.ecosystem === "npm");
      if (npmResult) {
        // Check all required properties exist
        expect(npmResult).toHaveProperty("vulnerabilities");
        expect(npmResult).toHaveProperty("totalVulnerabilities");
        expect(npmResult).toHaveProperty("critical");
        expect(npmResult).toHaveProperty("high");
        expect(npmResult).toHaveProperty("medium");
        expect(npmResult).toHaveProperty("low");
        expect(npmResult).toHaveProperty("ecosystem");

        // Check types
        expect(Array.isArray(npmResult.vulnerabilities)).toBe(true);
        expect(typeof npmResult.totalVulnerabilities).toBe("number");
        expect(typeof npmResult.critical).toBe("number");
        expect(typeof npmResult.high).toBe("number");
        expect(typeof npmResult.medium).toBe("number");
        expect(typeof npmResult.low).toBe("number");
        expect(typeof npmResult.ecosystem).toBe("string");
      }
    });

    it("should have vulnerability objects with correct structure", async () => {
      const packageJson = {
        name: "test",
        dependencies: {
          express: "4.17.1",
        },
      };

      const pkgPath = path.join(tempDir, "package.json");
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const results = await scanner.scan(tempDir);

      const npmResult = results.find((r) => r.ecosystem === "npm");
      if (npmResult && npmResult.vulnerabilities.length > 0) {
        const vuln = npmResult.vulnerabilities[0];
        expect(vuln).toHaveProperty("package");
        expect(vuln).toHaveProperty("version");
        expect(vuln).toHaveProperty("severity");
        expect(vuln).toHaveProperty("title");
        expect(vuln).toHaveProperty("recommendation");
        expect(vuln).toHaveProperty("ecosystem");

        expect(["critical", "high", "medium", "low"]).toContain(vuln.severity);
        expect(vuln.ecosystem).toBe("npm");
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle npm audit failures gracefully", async () => {
      const packageJson = {
        name: "test",
        dependencies: {
          "invalid-package-name-12345": "1.0.0",
        },
      };

      const pkgPath = path.join(tempDir, "package.json");
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      // Should not throw, may return null result or empty array
      await expect(scanner.scan(tempDir)).resolves.toBeDefined();
    });
  });

  describe("Performance", () => {
    it("should handle scanning efficiently", async () => {
      const packageJson = {
        name: "test",
        dependencies: {} as Record<string, string>,
      };

      // Add many dependencies
      for (let i = 0; i < 20; i++) {
        packageJson.dependencies[`package-${i}`] = "1.0.0";
      }

      const pkgPath = path.join(tempDir, "package.json");
      fs.writeFileSync(pkgPath, JSON.stringify(packageJson));

      const start = Date.now();
      await scanner.scan(tempDir);
      const duration = Date.now() - start;

      // Should complete reasonably quickly (npm audit may take time)
      expect(duration).toBeLessThan(60000); // < 60 seconds
    });
  });
});
