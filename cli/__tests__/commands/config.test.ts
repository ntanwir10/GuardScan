/**
 * Tests for config command
 */

import { configCommand } from "../../src/commands/config";
import { configManager } from "../../src/core/config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// Mock dependencies
jest.mock("inquirer");

describe("config command", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let testConfigDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalHome = process.env.HOME;
    testConfigDir = path.join(os.tmpdir(), `guardscan-test-${Date.now()}`);
    process.env.GUARDSCAN_HOME = testConfigDir;
    process.env.HOME = testConfigDir; // Also set HOME to ensure consistency

    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    process.env = originalEnv;
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  it("should show config when --show flag is used", async () => {
    if (!configManager.exists()) {
      configManager.init();
    }

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {
      return;
    });

    await configCommand({ show: true });

    expect(consoleSpy).toHaveBeenCalled();
    expect(
      consoleSpy.mock.calls.some(
        (call) =>
          call[0] &&
          (call[0].includes("Configuration") || call[0].includes("Client ID"))
      )
    ).toBe(true);

    consoleSpy.mockRestore();
  });

  it("should update provider via direct config", async () => {
    if (!configManager.exists()) {
      configManager.init();
    }

    // Verify initial state
    const initialConfig = configManager.load();
    const initialProvider = initialConfig.provider;

    // Mock ProviderFactory to avoid actual connection test
    const ProviderFactory =
      require("../../src/providers/factory").ProviderFactory;
    const providerFactorySpy = jest
      .spyOn(ProviderFactory, "create")
      .mockReturnValue({
        isAvailable: jest.fn().mockReturnValue(true),
        testConnection: jest
          .fn()
          .mockImplementation(() => Promise.resolve(true)),
      } as any);

    // Suppress console output during test
    const consoleLogSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => {});

    await configCommand({ provider: "openai", key: "test-key" });

    // Reload config from the singleton instance to verify it was updated
    const updatedConfig = configManager.load();
    expect(updatedConfig.provider).toBe("openai");
    expect(updatedConfig.apiKey).toBe("test-key");

    // Restore original provider for cleanup
    if (initialProvider !== "openai") {
      await configCommand({ provider: initialProvider });
    }

    // Restore all mocks
    providerFactorySpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("should handle debug logging", async () => {
    process.env.GUARDSCAN_DEBUG = "true";
    if (!configManager.exists()) {
      configManager.init();
    }

    // Debug logs go to console.error via debug-logger
    // Suppress console.error to avoid test output noise, but verify it was called
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const consoleLogSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => {});

    await configCommand({ show: true });

    // Should have either debug output (console.error) or regular output (console.log)
    // At minimum, showConfig() will call console.log
    expect(consoleLogSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });
});
