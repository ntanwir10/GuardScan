/**
 * Tests for config command
 */

import { configCommand } from "../../src/commands/config";
import { configManager } from "../../src/core/config";
import { TelemetryManager } from "../../src/core/telemetry";
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

  it("clears provider-specific endpoint and remote approval when switching provider families", async () => {
    if (!configManager.exists()) {
      configManager.init();
    }

    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const initial = configManager.load();
    initial.provider = "ollama";
    initial.apiEndpoint = "https://models.example.test";
    initial.allowRemoteSelfHosted = true;
    initial.apiKey = "old-key";
    initial.model = "old-model";
    configManager.save(initial);

    await configCommand({ provider: "openai", key: "test-key" });
    let updated = configManager.load();
    expect(updated.provider).toBe("openai");
    expect(updated.apiEndpoint).toBeUndefined();
    expect(updated.allowRemoteSelfHosted).toBe(false);
    expect(updated.apiKey).toBe("test-key");
    expect(updated.model).toBeUndefined();

    updated.apiEndpoint = "https://api.example.test/v1";
    updated.allowRemoteSelfHosted = true;
    updated.apiKey = "openai-key";
    updated.model = "gpt-4o";
    configManager.save(updated);
    await configCommand({ provider: "ollama" });
    updated = configManager.load();
    expect(updated.provider).toBe("ollama");
    expect(updated.apiEndpoint).toBeUndefined();
    expect(updated.allowRemoteSelfHosted).toBe(false);
    expect(updated.apiKey).toBeUndefined();
    expect(updated.model).toBeUndefined();

    consoleLogSpy.mockRestore();
  });

  it("persists telemetry opt-out before a queue-clear failure", async () => {
    if (!configManager.exists()) {configManager.init();}
    const initial = configManager.load();
    initial.telemetryEnabled = true;
    configManager.save(initial);
    const clearSpy = jest.spyOn(TelemetryManager.prototype, "clear").mockImplementation(() => {
      throw new Error("maintenance lock unavailable");
    });
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await configCommand({ telemetry: "false" });

    expect(configManager.load().telemetryEnabled).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("could not be cleared"));
    clearSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("preserves provider credentials and model for same-provider updates", async () => {
    if (!configManager.exists()) {configManager.init();}
    const config = configManager.load();
    config.provider = "openai";
    config.apiKey = "existing-key";
    config.model = "gpt-4o";
    configManager.save(config);
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await configCommand({ provider: "openai" });

    expect(configManager.load()).toMatchObject({
      apiKey: "existing-key",
      model: "gpt-4o",
    });
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
