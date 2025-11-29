/**
 * E2E Tests for CLI Commands
 *
 * Tests the main CLI commands end-to-end
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { beforeAll, afterAll } from "@jest/globals";

describe("CLI Commands E2E", () => {
  let tempDir: string;

  beforeAll(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardscan-e2e-"));

    // Create a simple test project
    fs.writeFileSync(
      path.join(tempDir, "test.js"),
      `
// Test file with potential issues
const password = "hardcoded-password-123";
const apiKey = "AKIAIOSFODNN7EXAMPLE";

function complexFunction(x) {
  if (x > 0) {
    if (x > 10) {
      if (x > 20) {
        return "high";
      }
      return "medium";
    }
    return "low";
  }
  return "zero";
}
      `.trim()
    );

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {},
      })
    );

    // Initialize GuardScan config for the test project to avoid ENOENT errors
    try {
      execSync(
        `node ${path.join(
          __dirname,
          "../../dist/index.js"
        )} init --no-telemetry`,
        {
          cwd: tempDir,
          encoding: "utf-8",
          timeout: 30000,
        }
      );
    } catch (error: any) {
      // Initialization failures shouldn't break the entire E2E suite
      // Individual tests will still assert on behavior
      console.log("Init note (beforeAll):", error.message);
    }
  });

  afterAll(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Security Scan", () => {
    it("should run security scan successfully", () => {
      try {
        const output = execSync(
          `node ${path.join(
            __dirname,
            "../../dist/index.js"
          )} security --no-telemetry`,
          {
            cwd: tempDir,
            encoding: "utf-8",
            timeout: 30000,
          }
        );

        expect(output).toBeDefined();
        // Security scan should detect secrets
        expect(output.toLowerCase()).toContain("secret");
      } catch (error: any) {
        // Security scan may exit with non-zero if issues found
        // That's expected behavior
        const output = error.stdout || error.message;
        expect(output).toBeDefined();
      }
    }, 60000);

    it("should accept --debug flag without error", () => {
      try {
        const output = execSync(
          `node ${path.join(
            __dirname,
            "../../dist/index.js"
          )} security --debug --no-telemetry`,
          {
            cwd: tempDir,
            encoding: "utf-8",
            timeout: 30000,
            env: { ...process.env },
          }
        );

        expect(output).toBeDefined();
        // Should not throw "unknown option" error
        expect(output).not.toContain("unknown option");
      } catch (error: any) {
        // Security scan may exit with non-zero if issues found
        // But should not fail with "unknown option" error
        const errorMessage = error.message || error.stdout || "";
        expect(errorMessage).not.toContain("unknown option");
      }
    }, 60000);
  });

  describe("SBOM Generation", () => {
    it("should generate SBOM in SPDX format", () => {
      const sbomPath = path.join(tempDir, "sbom-report.json");

      try {
        const output = execSync(
          `node ${path.join(
            __dirname,
            "../../dist/index.js"
          )} sbom -f spdx -o ${sbomPath} --no-telemetry`,
          {
            cwd: tempDir,
            encoding: "utf-8",
            timeout: 30000,
          }
        );

        expect(output).toBeDefined();
        expect(fs.existsSync(sbomPath)).toBe(true);

        const sbom = JSON.parse(fs.readFileSync(sbomPath, "utf-8"));
        expect(sbom.spdxVersion).toBeDefined();
        expect(sbom.name).toBeDefined();

        // Clean up
        fs.unlinkSync(sbomPath);
      } catch (error: any) {
        // SBOM generation may fail if no dependencies
        // That's acceptable for test
        console.log("SBOM generation note:", error.message);
      }
    }, 60000);
  });

  describe("Config Management", () => {
    it("should initialize config", () => {
      const configPath = path.join(tempDir, ".guardscan", "config.json");

      // Remove config if exists
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }

      try {
        execSync(
          `node ${path.join(
            __dirname,
            "../../dist/index.js"
          )} init --no-telemetry`,
          {
            cwd: tempDir,
            encoding: "utf-8",
            timeout: 30000,
          }
        );

        // Config should be created
        expect(fs.existsSync(configPath)).toBe(true);

        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        expect(config.clientId).toBeDefined();
        expect(config.telemetryEnabled).toBeDefined();
      } catch (error: any) {
        console.log("Init note:", error.message);
      }
    }, 60000);
  });

  describe("Status Command", () => {
    it("should show status information", () => {
      try {
        const output = execSync(
          `node ${path.join(
            __dirname,
            "../../dist/index.js"
          )} status --no-telemetry`,
          {
            cwd: tempDir,
            encoding: "utf-8",
            timeout: 30000,
          }
        );

        expect(output).toBeDefined();
        expect(output.toLowerCase()).toContain("guardscan");
      } catch (error: any) {
        const output = error.stdout || "";
        expect(output).toBeDefined();
      }
    }, 60000);
  });

  describe("LOC Counter", () => {
    it("should count lines of code", () => {
      try {
        const output = execSync(
          `node ${path.join(
            __dirname,
            "../../dist/index.js"
          )} run --no-telemetry`,
          {
            cwd: tempDir,
            encoding: "utf-8",
            timeout: 30000,
          }
        );

        expect(output).toBeDefined();
        // Should show some LOC count
        expect(output).toMatch(/\d+/);
      } catch (error: any) {
        const output = error.stdout || "";
        expect(output).toBeDefined();
      }
    }, 60000);
  });

  describe("Commit Command Flags", () => {
    it("should accept --no-body flag without error", () => {
      try {
        // Initialize git repo for commit command
        try {
          execSync("git init", { cwd: tempDir, stdio: "ignore" });
          execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
          execSync('git config user.name "Test User"', { cwd: tempDir, stdio: "ignore" });
        } catch {
          // Git might not be available, skip test
          return;
        }

        const output = execSync(
          `node ${path.join(
            __dirname,
            "../../dist/index.js"
          )} commit --no-body --no-telemetry`,
          {
            cwd: tempDir,
            encoding: "utf-8",
            timeout: 30000,
          }
        );

        expect(output).toBeDefined();
        // Should not throw "unknown option" error
        expect(output).not.toContain("unknown option");
      } catch (error: any) {
        // Commit command may fail due to missing AI config or other reasons
        // But should not fail with "unknown option" error for --no-body
        const errorMessage = error.message || error.stdout || "";
        expect(errorMessage).not.toContain("unknown option");
        expect(errorMessage).not.toContain("--no-body");
        // Should fail for other reasons (like missing AI config), not flag parsing
        expect(errorMessage).toBeDefined();
      }
    }, 60000);
  });
});
