/**
 * E2E Tests for CLI Commands
 *
 * Tests the main CLI commands end-to-end
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import yaml from "js-yaml";

import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { beforeAll, afterAll } from "@jest/globals";

describe("CLI Commands E2E", () => {
  let tempDir: string;
  const CLI_PATH = path.join(__dirname, "../../dist/index.js");

  const runCli = (cmd: string, expectSuccess: boolean = true): string => {
    const env = {
      ...process.env,
      GUARDSCAN_HOME: tempDir,
    };

    try {
      return execSync(`node ${CLI_PATH} ${cmd}`, {
        cwd: tempDir,
        encoding: "utf-8",
        timeout: 30000,
        env,
      });
    } catch (error: any) {
      if (!expectSuccess) {
        return [error.stdout, error.stderr, error.message]
          .filter(Boolean)
          .join("\n");
      }
      throw error;
    }
  };

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

    runCli("init --no-telemetry");
  });

  afterAll(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Security Scan", () => {
    it("should run security scan successfully", () => {
      const output = runCli("security --no-telemetry", false);
      expect(output).toBeDefined();

      const report = fs
        .readdirSync(tempDir)
        .filter((file) => file.startsWith("guardscan-security-"))
        .sort()
        .pop();
      expect(report).toBeDefined();
      const reportContent = fs.readFileSync(path.join(tempDir, report!), "utf-8");
      expect(reportContent.toLowerCase()).toContain("secret");
    }, 60000);

    it("should accept --debug flag without error", () => {
      const output = runCli("security --debug --no-telemetry", false);
      expect(output).toBeDefined();
      expect(output).not.toContain("unknown option");
    }, 60000);
  });

  describe("SBOM Generation", () => {
    it("should generate SBOM in SPDX format", () => {
      const sbomPath = path.join(tempDir, "sbom-report.json");

      const output = runCli(`sbom -f spdx -o ${sbomPath} --no-telemetry`);

      expect(output).toBeDefined();
      expect(fs.existsSync(sbomPath)).toBe(true);

      const sbom = JSON.parse(fs.readFileSync(sbomPath, "utf-8"));
      expect(sbom.format).toBe("spdx");
      expect(sbom.version).toBeDefined();
      expect(sbom.name).toBeDefined();

      fs.unlinkSync(sbomPath);
    }, 60000);
  });

  describe("Config Management", () => {
    it("should initialize config", () => {
      const configPath = path.join(tempDir, ".guardscan", "config.yml");

      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }

      runCli("init --no-telemetry");

      expect(fs.existsSync(configPath)).toBe(true);

      const config = yaml.load(fs.readFileSync(configPath, "utf-8")) as any;
      expect(config.clientId).toBeDefined();
      expect(config.telemetryEnabled).toBeDefined();
    }, 60000);

    it("should persist telemetry flag changes", () => {
      const configPath = path.join(tempDir, ".guardscan", "config.yml");

      runCli("config --telemetry=false --no-telemetry");
      let config = yaml.load(fs.readFileSync(configPath, "utf-8")) as any;
      expect(config.telemetryEnabled).toBe(false);
      expect(config.offlineMode).toBe(true);

      runCli("config --telemetry=true --no-telemetry");
      config = yaml.load(fs.readFileSync(configPath, "utf-8")) as any;
      expect(config.telemetryEnabled).toBe(true);
      expect(config.offlineMode).toBe(false);
    }, 60000);
  });

  describe("Status Command", () => {
    it("should show status information", () => {
      const output = runCli("status --no-telemetry", false);
      expect(output).toBeDefined();
      expect(output.toLowerCase()).toContain("guardscan");
    }, 60000);
  });

  describe("LOC Counter", () => {
    it("should count lines of code", () => {
      const output = runCli("run --no-telemetry", false);
      expect(output).toBeDefined();
      expect(output).toMatch(/\d+/);
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

        const output = runCli("commit --no-body --no-telemetry", false);

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
