import { apiClient, TelemetryEvent } from "../utils/api-client";
import { Config, configManager } from "./config";
import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs";
import { repositoryManager } from "./repository";

const CACHE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".guardscan",
  "cache"
);
const TELEMETRY_FILE = path.join(CACHE_DIR, "telemetry.json");
const BATCH_SIZE = 50;

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

    // Skip if telemetry disabled
    if (!config.telemetryEnabled) {
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
    if (batch.events.length >= BATCH_SIZE && !config.offlineMode) {
      await this.sync();
    }
  }

  /**
   * Sync telemetry batch to server
   */
  async sync(): Promise<void> {
    const config = this.config;

    // Skip if telemetry disabled or offline mode
    if (!config.telemetryEnabled || config.offlineMode) {
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
      // Silent fail - don't disrupt user experience
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

export const telemetryManager = new TelemetryManager(configManager.load());
