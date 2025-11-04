import * as fs from 'fs';
import * as path from 'path';
import { configManager } from './config';
import { apiClient, TelemetryEvent } from '../utils/api-client';

interface TelemetryBatch {
  events: TelemetryEvent[];
  lastSyncAt?: string;
}

export class TelemetryManager {
  private batchFile: string;
  private maxBatchSize = 50;

  constructor() {
    const cacheDir = configManager.getCacheDir();
    this.batchFile = path.join(cacheDir, 'telemetry.json');
  }

  /**
   * Record a telemetry event
   */
  async record(event: Omit<TelemetryEvent, 'timestamp'>): Promise<void> {
    const config = configManager.load();

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
    if (batch.events.length >= this.maxBatchSize && !config.offlineMode) {
      await this.sync();
    }
  }

  /**
   * Sync telemetry batch to server
   */
  async sync(): Promise<void> {
    const config = configManager.load();

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
      let repoId = 'unknown';
      try {
        const { repositoryManager } = await import('./repository');
        const repoInfo = repositoryManager.getRepoInfo();
        repoId = repoInfo.repoId;
      } catch {
        // Skip if not in a repo
      }

      await apiClient.sendTelemetry({
        clientId: config.clientId,
        repoId,
        events: batch.events,
      });

      // Clear batch after successful sync
      batch.events = [];
      batch.lastSyncAt = new Date().toISOString();
      this.saveBatch(batch);
    } catch (error) {
      // Silent fail - don't disrupt user experience
      console.error('Telemetry sync failed:', error);
    }
  }

  /**
   * Load telemetry batch from disk
   */
  private loadBatch(): TelemetryBatch {
    if (!fs.existsSync(this.batchFile)) {
      return { events: [] };
    }

    try {
      const content = fs.readFileSync(this.batchFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { events: [] };
    }
  }

  /**
   * Save telemetry batch to disk
   */
  private saveBatch(batch: TelemetryBatch): void {
    fs.writeFileSync(this.batchFile, JSON.stringify(batch, null, 2), 'utf-8');
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

export const telemetryManager = new TelemetryManager();
