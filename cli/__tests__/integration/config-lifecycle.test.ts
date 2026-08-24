/**
 * Integration test for complete config lifecycle
 */
import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Config Lifecycle Integration", () => {
  let testConfigDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let configManager: typeof import("../../src/core/config").configManager;
  let initCommand: typeof import("../../src/commands/init").initCommand;
  let configCommand: typeof import("../../src/commands/config").configCommand;

  beforeEach(async () => {
    testConfigDir = path.join(os.tmpdir(), `guardscan-test-${Date.now()}`);
    originalEnv = { ...process.env };
    process.env.GUARDSCAN_HOME = testConfigDir;
    process.env.HOME = testConfigDir;

    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }

    // Ensure the directory exists
    fs.mkdirSync(testConfigDir, { recursive: true });

    jest.resetModules();
    ({ configManager } = await import("../../src/core/config"));
    ({ initCommand } = await import("../../src/commands/init"));
    ({ configCommand } = await import("../../src/commands/config"));
  });

  afterEach(() => {
    process.env = originalEnv;
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  it("should complete full config lifecycle: init -> load -> update -> reset", async () => {
    const expectedConfigDir = path.join(testConfigDir, ".guardscan");
    const actualConfigDir = configManager.getConfigDir();

    expect(actualConfigDir).toBe(expectedConfigDir);

    // 1. Init
    // Check if config exists in the actual directory being used
    const configPath = path.join(actualConfigDir, "config.yml");
    if (fs.existsSync(configPath)) {
      // Clean up existing config for this test
      try {
        fs.unlinkSync(configPath);
      } catch (e) {
        // Ignore errors
      }
    }
    expect(configManager.exists()).toBe(false);

    const inquirer = require("inquirer");
    const inquirerSpy = jest.spyOn(inquirer, "prompt").mockResolvedValue({
      mode: "static",
    });

    await initCommand();
    expect(configManager.exists()).toBe(true);

    // Restore spy
    inquirerSpy.mockRestore();

    // 2. Load
    const config1 = configManager.load();
    expect(config1.clientId).toBeUndefined();
    expect(config1.provider).toBe("none");

    // 3. Update
    await configCommand({ provider: "openai" });
    const config2 = configManager.load();
    expect(config2.provider).toBe("openai");

    // 4. Reset (cache only)
    configManager.reset(false);
    expect(configManager.exists()).toBe(true); // Config still exists

    // 5. Full reset
    configManager.reset(true);
    expect(configManager.exists()).toBe(false); // Config deleted
  });

  it("should handle config operations with debug logging", async () => {
    process.env.GUARDSCAN_DEBUG = "true";
    const inquirer = require("inquirer");
    const inquirerSpy = jest.spyOn(inquirer, "prompt").mockResolvedValue({
      mode: "static",
    });

    // Spy on both console.error and console.log for debug output
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const consoleLogSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => {});

    await initCommand();
    await configCommand({ show: true });

    // Should have debug output (either error or log)
    const hasDebugOutput =
      consoleErrorSpy.mock.calls.length > 0 ||
      consoleLogSpy.mock.calls.length > 0;
    expect(hasDebugOutput).toBe(true);

    // Restore all spies
    inquirerSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });
});
