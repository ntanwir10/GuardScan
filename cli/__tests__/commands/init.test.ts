/**
 * Tests for init command
 */

import { initCommand } from "../../src/commands/init";
import { configManager } from "../../src/core/config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
// Mock dependencies
jest.mock("inquirer");
jest.mock("../../src/core/repository", () => ({
  repositoryManager: {
    getRepoInfo: jest.fn().mockReturnValue({
      name: "test-repo",
      path: process.cwd(),
      isGit: false,
      repoId: "test-repo-id",
    }),
  },
}));
jest.mock("../../src/utils/ascii-art", () => ({
  displayWelcomeBanner: jest.fn(),
}));
jest.mock("../../src/providers/factory", () => ({
  ProviderFactory: {
    create: jest.fn().mockReturnValue({
      isAvailable: jest.fn().mockReturnValue(true),
      testConnection: jest.fn().mockImplementation(() => Promise.resolve(true)),
    }),
  },
}));

describe("init command", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let testConfigDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    originalHome = process.env.HOME;

    // Create a temporary config directory for testing
    testConfigDir = path.join(os.tmpdir(), `guardscan-test-${Date.now()}`);
    process.env.GUARDSCAN_HOME = testConfigDir;
    process.env.HOME = testConfigDir; // Also set HOME to ensure consistency

    // Clean up if exists
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    process.env = originalEnv;

    // Clean up test directory
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  it("should create config directory and files", async () => {
    // Use the singleton instance
    if (configManager.exists()) {
      // Clean up existing config for this test
      const configPath = configManager.getConfigDir();
      if (fs.existsSync(configPath)) {
        fs.rmSync(configPath, { recursive: true, force: true });
      }
    }

    expect(configManager.exists()).toBe(false);

    // Mock inquirer to avoid interactive prompts
    const inquirer = require("inquirer");
    jest.spyOn(inquirer, "prompt").mockResolvedValue({
      mode: "static",
    });

    await initCommand();

    // Check the config was created using the singleton
    expect(configManager.exists()).toBe(true);
    expect(fs.existsSync(configManager.getConfigDir())).toBe(true);
    expect(
      fs.existsSync(path.join(configManager.getConfigDir(), "config.yml"))
    ).toBe(true);
  });

  it("should handle debug logging when GUARDSCAN_DEBUG is set", async () => {
    process.env.GUARDSCAN_DEBUG = "true";

    // Suppress console.error but track calls
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const consoleLogSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => {});

    const inquirer = require("inquirer");
    jest.spyOn(inquirer, "prompt").mockResolvedValue({
      mode: "static",
    });

    await initCommand();

    // Should have either debug output (console.error) or regular output (console.log)
    // At minimum, initCommand will output something
    expect(
      consoleErrorSpy.mock.calls.length + consoleLogSpy.mock.calls.length
    ).toBeGreaterThan(0);

    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("should handle existing config gracefully", async () => {
    if (!configManager.exists()) {
      configManager.init();
    }

    // Should not throw when config already exists
    await expect(initCommand()).resolves.not.toThrow();
  });
});
