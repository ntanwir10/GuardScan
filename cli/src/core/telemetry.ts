import { apiClient, TelemetryEvent } from "../utils/api-client";
import { AIProvider, Config, configManager } from "./config";
import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs";
import { repositoryManager } from "./repository";
import { TELEMETRY_CONSTANTS } from "../constants/telemetry-constants";

const TELEMETRY_FILE = path.join(configManager.getCacheDir(), "telemetry.json");

// Import package.json to get version
const packageJson = require("../../package.json");

export class TelemetryManager {
  private config: Config;
  private batch: TelemetryEvent[] = [];

  constructor(config: Config) {
    this.config = config;
    this.loadBatch();
  }

  /**
   * Record a telemetry event
   */
  async record(event: Omit<TelemetryEvent, "timestamp">): Promise<void> {
    const config = this.config;

    // Skip if telemetry disabled or --no-telemetry flag is set
    if (!config.telemetryEnabled || process.env.GUARDSCAN_NO_TELEMETRY === 'true') {
      return;
    }

    const fullEvent: TelemetryEvent = {
      ...event,
      timestamp: Date.now(),
    };

    // Load existing batch
    const batch = this.loadBatch();
    batch.events.push(fullEvent);

    // Save batch
    this.saveBatch(batch);

    // Auto-sync if batch is large enough or offline mode is disabled
    if (
      batch.events.length >= TELEMETRY_CONSTANTS.BATCH_SIZE &&
      !config.offlineMode
    ) {
      await this.sync();
    }
  }

  /**
   * Sync telemetry batch to server
   */
  async sync(): Promise<void> {
    const config = this.config;

    // Skip if telemetry disabled, offline mode, or --no-telemetry flag is set
    if (!config.telemetryEnabled || config.offlineMode || process.env.GUARDSCAN_NO_TELEMETRY === 'true') {
      return;
    }

    const batch = this.loadBatch();

    if (batch.events.length === 0) {
      return;
    }

    try {
      // Get repo ID (may not be available)
      let repoId = "unknown";
      try {
        const { repositoryManager } = await import("./repository");
        const repoInfo = repositoryManager.getRepoInfo();
        repoId = repoInfo.repoId;
      } catch {
        // Skip if not in a repo
      }

      await apiClient.sendTelemetry({
        clientId: config.clientId,
        repoId,
        events: batch.events,
        cliVersion: packageJson.version,
      });

      // Clear batch after successful sync
      batch.events = [];
      batch.lastSyncAt = new Date().toISOString();
      this.saveBatch(batch);
    } catch (error) {
      // Telemetry sync failed - logged for debugging but non-blocking
      // Batch will be retried next time
      console.error("Telemetry sync failed:", error);
    }
  }

  /**
   * Load telemetry batch from disk
   */
  private loadBatch(): { events: TelemetryEvent[]; lastSyncAt?: string } {
    if (!fs.existsSync(TELEMETRY_FILE)) {
      return { events: [] };
    }

    try {
      const content = fs.readFileSync(TELEMETRY_FILE, "utf-8");
      return JSON.parse(content);
    } catch {
      return { events: [] };
    }
  }

  /**
   * Save telemetry batch to disk
   */
  private saveBatch(batch: {
    events: TelemetryEvent[];
    lastSyncAt?: string;
  }): void {
    fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(batch, null, 2), "utf-8");
  }

  /**
   * Get batch stats
   */
  getStats(): { pending: number; lastSyncAt?: string } {
    const batch = this.loadBatch();
    return {
      pending: batch.events.length,
      lastSyncAt: batch.lastSyncAt,
    };
  }
}

// Safe initialization of telemetry manager
// Uses loadOrInit() to handle first-time users gracefully
function initializeTelemetryManager(): TelemetryManager {
  const debug = process.env.GUARDSCAN_DEBUG === "true";

  try {
    if (debug) console.error("[TELEMETRY] Initializing telemetryManager...");

    if (configManager.exists()) {
      if (debug) console.error("[TELEMETRY] Config exists, loading...");
      try {
        const config = configManager.load();
        if (debug) console.error("[TELEMETRY] Config loaded successfully");
        return new TelemetryManager(config);
      } catch (error) {
        if (debug)
          console.error(
            "[TELEMETRY] Config load failed, using defaults:",
            error
          );
        // Fall through to default config
      }
    } else {
      if (debug)
        console.error("[TELEMETRY] Config does not exist, using defaults");
    }

    // Use default config if no config exists or load failed
    return new TelemetryManager({
      clientId: "uninitialized",
      provider: "none" as AIProvider,
      telemetryEnabled: false,
      offlineMode: true,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    });
  } catch (error) {
    if (debug)
      console.error(
        "[TELEMETRY] Initialization failed, using fallback:",
        error
      );

    // Absolute fallback
    return new TelemetryManager({
      clientId: "uninitialized",
      provider: "none" as AIProvider,
      telemetryEnabled: false,
      offlineMode: true,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    });
  }
}

export const telemetryManager = initializeTelemetryManager();
