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
import type { Config } from "../../src/core/config";

const telemetryConfig = (): Config => ({
  provider: "none",
  telemetryEnabled: false,
  offlineMode: true,
  createdAt: new Date().toISOString(),
  lastUsed: new Date().toISOString(),
});

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

  it("migrates valid legacy telemetry while dropping invalid events", async () => {
    const { TelemetryManager } = await import("../../src/core/telemetry");
    const stateDir = path.join(testConfigDir, "telemetry-state");
    const legacyCacheDir = path.join(testConfigDir, "legacy-cache");
    const legacyFile = path.join(legacyCacheDir, "telemetry.json");
    fs.mkdirSync(legacyCacheDir, { recursive: true });
    fs.writeFileSync(legacyFile, JSON.stringify({
      events: [
        {
          eventId: "valid-legacy-event",
          action: "scan",
          loc: 10,
          durationMs: 20,
          model: "static-analysis",
          timestamp: Date.now(),
        },
        {
          eventId: "invalid-legacy-event",
          action: "unknown-action",
          timestamp: Date.now(),
        },
      ],
    }));

    new TelemetryManager(telemetryConfig(), stateDir, legacyCacheDir);

    expect(fs.existsSync(path.join(
      stateDir,
      "telemetry",
      "events",
      "valid-legacy-event.json"
    ))).toBe(true);
    expect(fs.existsSync(`${legacyFile}.migrated`)).toBe(true);
  });

  it("does not delete files outside the spool from a forged migration journal", async () => {
    const { TelemetryManager } = await import("../../src/core/telemetry");
    const stateDir = path.join(testConfigDir, "telemetry-state");
    const legacyCacheDir = path.join(testConfigDir, "legacy-cache");
    const telemetryDir = path.join(stateDir, "telemetry");
    const journalFile = path.join(telemetryDir, "migration.journal.json");
    const sentinel = path.join(testConfigDir, "do-not-delete.json");
    const event = {
      eventId: "forged-event",
      action: "scan",
      loc: 1,
      durationMs: 1,
      executionMode: "static",
      occurredAt: Date.now(),
    };
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.writeFileSync(sentinel, JSON.stringify(event));
    const source = path.join(telemetryDir, "outbox.json");
    fs.writeFileSync(journalFile, JSON.stringify({
      schemaVersion: "guardscan.telemetry.migration.v1",
      source,
      migrated: `${source}.migrated`,
      phase: "committing",
      createdFiles: [{ file: sentinel, event }],
      metadataChanged: false,
    }));

    new TelemetryManager(telemetryConfig(), stateDir, legacyCacheDir);

    expect(fs.existsSync(sentinel)).toBe(true);
  });

  it("does not rename paths outside the spool from a forged migration journal", async () => {
    const { TelemetryManager } = await import("../../src/core/telemetry");
    const stateDir = path.join(testConfigDir, "telemetry-state");
    const legacyCacheDir = path.join(testConfigDir, "legacy-cache");
    const telemetryDir = path.join(stateDir, "telemetry");
    const journalFile = path.join(telemetryDir, "migration.journal.json");
    const source = path.join(testConfigDir, "forged-source.json");
    const migrated = `${source}.migrated`;
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.writeFileSync(migrated, "sentinel");
    fs.writeFileSync(journalFile, JSON.stringify({
      schemaVersion: "guardscan.telemetry.migration.v1",
      source,
      migrated,
      phase: "committing",
      createdFiles: [],
      metadataChanged: false,
    }));

    new TelemetryManager(telemetryConfig(), stateDir, legacyCacheDir);

    expect(fs.existsSync(source)).toBe(false);
    expect(fs.existsSync(migrated)).toBe(true);
  });
});
