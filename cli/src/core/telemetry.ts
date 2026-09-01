import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import {
  APIClient,
  TelemetryAction,
  TelemetryEvent,
  TelemetryExecutionMode,
} from "../utils/api-client";
import { Config, configManager } from "./config";
import { TELEMETRY_CONSTANTS } from "../constants/telemetry-constants";
import { createDebugLogger } from "../utils/debug-logger";
import { environmentRequestsOffline } from "../utils/execution-policy";
import {
  acquireFileLease,
  atomicReplaceJson,
  ensurePrivateDirectory,
  FileLease,
  forEachDirectoryEntry,
  publishJsonNoReplace,
  quarantineFile,
  readJsonFileBounded,
  removeStaleTemporaryFiles,
} from "../utils/private-state";

const logger = createDebugLogger("telemetry");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require("../../package.json") as { version: string };
const OUTBOX_VERSION = "guardscan.telemetry.outbox.v1" as const;
const SPOOL_VERSION = "guardscan.telemetry.spool.v1" as const;
const MAX_EVENTS = 1000;
const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVENT_FILE_BYTES = 64 * 1024;
const MAX_MIGRATION_FILE_BYTES = 8 * 1024 * 1024;
const MAX_MIGRATION_EVENTS = 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const SYNC_LEASE_MS = 5 * 60 * 1000;
const PRUNE_INTERVAL = 32;
const MIGRATION_JOURNAL_VERSION = "guardscan.telemetry.migration.v1" as const;
const MIGRATION_LEASE_MS = 5 * 60 * 1000;
const SAFE_EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TELEMETRY_EVENT_KEYS = [
  "eventId", "action", "loc", "durationMs", "executionMode", "occurredAt",
] as const;

export interface TelemetryRecordInput {
  action: TelemetryAction;
  loc: number;
  durationMs: number;
  executionMode?: TelemetryExecutionMode;
  /** Legacy input accepted internally and converted to an allowlisted mode. */
  model?: string;
}

interface TelemetryMetadata {
  schemaVersion: typeof SPOOL_VERSION;
  lastSyncAt?: string;
}

interface TelemetryMigrationJournal {
  schemaVersion: typeof MIGRATION_JOURNAL_VERSION;
  source: string;
  migrated: string;
  phase: "committing" | "committed";
  createdFiles: Array<{file: string; event: TelemetryEvent}>;
  metadataChanged: boolean;
  previousMetadata?: TelemetryMetadata;
}

export interface TelemetryStats {
  enabled: boolean;
  suppressed: boolean;
  endpointConfigured: boolean;
  pending: number;
  oldestEventAt?: string;
  lastSyncAt?: string;
}

export function isTelemetrySuppressed(config: Config): boolean {
  return Boolean(
    !config.telemetryEnabled ||
    config.offlineMode ||
    process.env.GUARDSCAN_NO_TELEMETRY === "true" ||
    environmentRequestsOffline()
  );
}

export class TelemetryManager {
  private readonly telemetryDir: string;
  private readonly eventsDir: string;
  private readonly metadataFile: string;
  private readonly outboxFile: string;
  private readonly quarantineDir: string;
  private readonly syncLeaseFile: string;
  private readonly migrationLeaseFile: string;
  private readonly migrationJournalFile: string;
  private readonly legacyFiles: string[];
  private recordsSincePrune = 0;

  constructor(
    private readonly config: Config,
    stateDir = configManager.getConfigDir(),
    legacyCacheDir = configManager.getCacheDir()
  ) {
    this.telemetryDir = path.join(stateDir, "telemetry");
    this.eventsDir = path.join(this.telemetryDir, "events");
    this.metadataFile = path.join(this.telemetryDir, "metadata.json");
    this.outboxFile = path.join(this.telemetryDir, "outbox.json");
    this.quarantineDir = path.join(this.telemetryDir, "quarantine");
    this.syncLeaseFile = path.join(this.telemetryDir, "sync.lock");
    this.migrationLeaseFile = path.join(this.telemetryDir, "migration.lock");
    this.migrationJournalFile = path.join(this.telemetryDir, "migration.journal.json");
    this.legacyFiles = [
      path.join(legacyCacheDir, "telemetry.json"),
      path.join(stateDir, "telemetry.json"),
    ];
    this.ensureSpool();
    this.runMigrations();
    this.pruneEvents();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async record(input: TelemetryRecordInput): Promise<void> {
    if (isTelemetrySuppressed(this.config)) {return;}

    const event: TelemetryEvent = {
      eventId: uuidv4(),
      action: input.action,
      loc: clampInteger(input.loc, 0, 1_000_000_000),
      durationMs: clampInteger(input.durationMs, 0, 86_400_000),
      executionMode:
        input.executionMode || executionModeFromLegacyModel(input.model),
      occurredAt: Date.now(),
    };

    try {
      this.persistEvent(event);
      this.recordsSincePrune += 1;
      if (this.recordsSincePrune >= PRUNE_INTERVAL) {
        this.pruneEvents();
        this.recordsSincePrune = 0;
      }
    } catch (error) {
      logger.error("Telemetry event could not be persisted", error);
    }
  }

  async sync(): Promise<{ sent: number; remaining: number }> {
    this.assertSyncAllowed();
    const endpoint =
      process.env.GUARDSCAN_TELEMETRY_URL || process.env.GUARDSCAN_API_URL;
    if (!endpoint) {
      throw new Error(
        "Telemetry endpoint is not configured. Set GUARDSCAN_TELEMETRY_URL."
      );
    }

    let lease: FileLease;
    try {lease = acquireFileLease(this.syncLeaseFile, SYNC_LEASE_MS);}
    catch {throw new Error("Telemetry sync is already in progress.");}
    let leaseLost: unknown;
    const renewalTimer = setInterval(() => {
      try {lease.renew();} catch (error) {leaseLost = error;}
    }, Math.max(1000, Math.floor(SYNC_LEASE_MS / 3)));
    renewalTimer.unref?.();
    try {
      this.pruneEventsWithoutLease();
      const events = this.loadEvents().slice(0, TELEMETRY_CONSTANTS.BATCH_SIZE);
      if (events.length === 0) {return { sent: 0, remaining: 0 };}

      const batchId = uuidv4();
      const response = await new APIClient(endpoint).sendTelemetry({
        schemaVersion: "guardscan.telemetry.v1",
        batchId,
        sentAt: Date.now(),
        cliVersion: packageJson.version,
        events,
      });
      if (leaseLost) {throw new Error("Telemetry sync lost its file lease.");}

      const accepted = new Set(
        response.status === "duplicate"
          ? events.map(event => event.eventId)
          : response.acceptedEventIds !== undefined
            ? response.acceptedEventIds
            : events.map(event => event.eventId)
      );
      for (const eventId of accepted) {this.deleteEvent(eventId);}
      this.saveMetadata({
        schemaVersion: SPOOL_VERSION,
        lastSyncAt: new Date().toISOString(),
      });
      return { sent: accepted.size, remaining: this.loadEvents().length };
    } finally {
      clearInterval(renewalTimer);
      lease.release();
    }
  }

  clear(): number {
    const lease = this.acquireMaintenanceLease();
    let cleared = 0;
    try {
      this.scanEventFiles((event, file) => {
        unlinkIfPresent(file);
        cleared += 1;
      });
      for (const source of new Set([this.outboxFile, ...this.legacyFiles])) {
        unlinkIfPresent(source);
        unlinkIfPresent(`${source}.migrated`);
      }
      unlinkIfPresent(this.migrationJournalFile);
      forEachDirectoryEntry(this.quarantineDir, entry => {
        if (entry.dirent.isFile() || entry.dirent.isSymbolicLink()) {unlinkIfPresent(entry.path);}
      });
      return cleared;
    } finally {
      lease.release();
    }
  }

  getStats(): TelemetryStats {
    this.pruneEvents();
    let pending = 0;
    let oldestEventAt: number | undefined;
    this.scanEventFiles(event => {
      pending += 1;
      if (oldestEventAt === undefined || event.occurredAt < oldestEventAt) {
        oldestEventAt = event.occurredAt;
      }
    });
    const metadata = this.loadMetadata();
    return {
      enabled: this.config.telemetryEnabled,
      suppressed: isTelemetrySuppressed(this.config),
      endpointConfigured: Boolean(
        process.env.GUARDSCAN_TELEMETRY_URL || process.env.GUARDSCAN_API_URL
      ),
      pending,
      oldestEventAt: oldestEventAt === undefined
        ? undefined
        : new Date(oldestEventAt).toISOString(),
      lastSyncAt: metadata.lastSyncAt,
    };
  }

  private assertSyncAllowed(): void {
    if (!this.config.telemetryEnabled) {
      throw new Error("Telemetry is disabled. Enable it before syncing.");
    }
    if (
      this.config.offlineMode ||
      environmentRequestsOffline()
    ) {
      throw new Error("Telemetry cannot sync while offline mode is enabled.");
    }
    if (process.env.GUARDSCAN_NO_TELEMETRY === "true") {
      throw new Error("Telemetry is disabled for this command.");
    }
  }

  private ensureSpool(): void {
    ensurePrivateDirectory(this.telemetryDir);
    ensurePrivateDirectory(this.eventsDir);
    ensurePrivateDirectory(this.quarantineDir);
    removeStaleTemporaryFiles(this.eventsDir);
  }

  private eventFile(eventId: string): string {
    if (!SAFE_EVENT_ID.test(eventId)) {throw new Error("invalid telemetry event ID");}
    const target = path.resolve(this.eventsDir, `${eventId}.json`);
    const root = `${path.resolve(this.eventsDir)}${path.sep}`;
    if (!target.startsWith(root)) {throw new Error("telemetry event path escaped spool");}
    return target;
  }

  private persistEvent(event: TelemetryEvent): void {
    if (!isTelemetryEvent(event)) {throw new Error("invalid telemetry event");}
    publishJsonNoReplace(this.eventFile(event.eventId), event);
  }

  private acquireMaintenanceLease(): FileLease {
    return acquireFileLease(this.syncLeaseFile, SYNC_LEASE_MS);
  }

  private scanEventFiles(callback: (event: TelemetryEvent, file: string) => void): void {
    this.ensureSpool();
    forEachDirectoryEntry(this.eventsDir, entry => {
      if (!entry.name.endsWith(".json")) {return;}
      try {
        const event = readJsonFileBounded(entry.path, MAX_EVENT_FILE_BYTES);
        if (!isTelemetryEvent(event) || entry.name !== `${event.eventId}.json`) {
          throw new Error("invalid telemetry event file");
        }
        callback(event, entry.path);
      } catch (error) {
        quarantineFile(entry.path, this.quarantineDir);
        logger.error("Malformed telemetry event was quarantined", error);
      }
    });
  }

  private loadEvents(): TelemetryEvent[] {
    this.ensureSpool();
    const events: TelemetryEvent[] = [];
    this.scanEventFiles(event => addNewest(events, event, MAX_EVENTS, compareTelemetryEvents));
    return events.sort(
      (left, right) =>
        left.occurredAt - right.occurredAt ||
        left.eventId.localeCompare(right.eventId)
    );
  }

  private deleteEvent(eventId: string): void {
    try {
      fs.unlinkSync(this.eventFile(eventId));
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") {throw error;}
    }
  }

  private pruneEvents(): void {
    let lease: FileLease;
    try {lease = this.acquireMaintenanceLease();} catch {return;}
    try {this.pruneEventsWithoutLease();} finally {lease.release();}
  }

  private pruneEventsWithoutLease(): void {
    const now = Date.now();
    const retained: TelemetryEvent[] = [];
    this.scanEventFiles((event, file) => {
      if (now - event.occurredAt > MAX_EVENT_AGE_MS) {
        unlinkIfPresent(file);
        return;
      }
      const evicted = addNewest(retained, event, MAX_EVENTS, compareTelemetryEvents);
      if (evicted) {this.deleteEvent(evicted.eventId);}
    });
  }

  private loadMetadata(): TelemetryMetadata {
    if (!fs.existsSync(this.metadataFile)) {
      return { schemaVersion: SPOOL_VERSION };
    }
    try {
      const parsed = readJsonFileBounded(this.metadataFile, MAX_EVENT_FILE_BYTES);
      if (!isRecord(parsed) || !hasExactKeys(parsed, ["schemaVersion"], ["lastSyncAt"]) ||
          parsed.schemaVersion !== SPOOL_VERSION) {
        throw new Error("unsupported telemetry metadata schema");
      }
      if (parsed.lastSyncAt !== undefined && !isIsoTimestamp(parsed.lastSyncAt)) {
        throw new Error("invalid telemetry metadata timestamp");
      }
      return {
        schemaVersion: SPOOL_VERSION,
        lastSyncAt:
          typeof parsed.lastSyncAt === "string"
            ? parsed.lastSyncAt
            : undefined,
      };
    } catch (error) {
      quarantineFile(this.metadataFile, this.quarantineDir);
      logger.error("Malformed telemetry metadata was quarantined", error);
      return { schemaVersion: SPOOL_VERSION };
    }
  }

  private saveMetadata(metadata: TelemetryMetadata): void {
    atomicReplaceJson(this.metadataFile, metadata);
  }

  private runMigrations(): void {
    let lease: FileLease;
    try {lease = acquireFileLease(this.migrationLeaseFile, MIGRATION_LEASE_MS);} catch {return;}
    try {
      this.recoverMigrationJournal();
      this.migrateExistingOutbox();
      this.migrateLegacyBatches();
    } finally {
      lease.release();
    }
  }

  private migrateExistingOutbox(): void {
    if (!fs.existsSync(this.outboxFile)) {return;}
    try {
      const parsed = readJsonFileBounded(this.outboxFile, MAX_MIGRATION_FILE_BYTES);
      if (!isRecord(parsed) || parsed.schemaVersion !== OUTBOX_VERSION || !Array.isArray(parsed.events)) {
        throw new Error("unsupported telemetry outbox schema");
      }
      if (parsed.events.length > MAX_MIGRATION_EVENTS) {throw new Error("telemetry outbox exceeds event limit");}
      const events = parsed.events.map(normalizePersistedEvent);
      if (events.some(event => event === undefined)) {throw new Error("invalid telemetry event in outbox");}
      const lastSyncAt = parsed.lastSyncAt;
      if (lastSyncAt !== undefined && !isIsoTimestamp(lastSyncAt)) {
        throw new Error("invalid outbox sync timestamp");
      }
      this.commitMigration(
        this.outboxFile,
        events as TelemetryEvent[],
        typeof lastSyncAt === "string" ? lastSyncAt : undefined
      );
    } catch (error) {
      quarantineFile(this.outboxFile, this.quarantineDir);
      logger.error("Telemetry outbox migration failed", error);
    }
  }

  private migrateLegacyBatches(): void {
    for (const legacyFile of this.legacyFiles) {
      if (!fs.existsSync(legacyFile)) {continue;}
      try {
        const parsed = readJsonFileBounded(legacyFile, MAX_MIGRATION_FILE_BYTES);
        const legacy = isRecord(parsed) ? parsed : {};
        const events = Array.isArray(legacy.events) ? legacy.events : [];
        if (events.length > MAX_MIGRATION_EVENTS) {throw new Error("legacy telemetry exceeds event limit");}
        const normalized = events
          .map(legacyEvent)
          .filter((event): event is TelemetryEvent => event !== undefined);
        const lastSyncAt = legacy.lastSyncAt;
        if (lastSyncAt !== undefined && !isIsoTimestamp(lastSyncAt)) {
          throw new Error("invalid legacy telemetry sync timestamp");
        }
        this.commitMigration(
          legacyFile,
          normalized,
          typeof lastSyncAt === "string" ? lastSyncAt : undefined
        );
      } catch (error) {
        quarantineFile(legacyFile, this.quarantineDir);
        logger.error("Legacy telemetry batch was quarantined", error);
      }
    }
  }

  private commitMigration(source: string, events: TelemetryEvent[], lastSyncAt?: string): void {
    const migrated = `${source}.migrated`;
    const previousMetadata = this.readMetadataForMigration();
    const createdFiles = events
      .map(event => ({file: this.eventFile(event.eventId), event}))
      .filter(({file, event}) => {
        if (!fs.existsSync(file)) {return true;}
        const existing = readJsonFileBounded(file, MAX_EVENT_FILE_BYTES);
        if (!isTelemetryEvent(existing) || JSON.stringify(existing) !== JSON.stringify(event)) {
          throw new Error(`telemetry migration identity conflict for ${event.eventId}`);
        }
        return false;
      });
    const journal: TelemetryMigrationJournal = {
      schemaVersion: MIGRATION_JOURNAL_VERSION,
      source,
      migrated,
      phase: "committing",
      createdFiles,
      metadataChanged: typeof lastSyncAt === "string",
      previousMetadata,
    };
    atomicReplaceJson(this.migrationJournalFile, journal);
    try {
      for (const {file, event} of createdFiles) {
        if (!publishJsonNoReplace(file, event)) {
          throw new Error(`telemetry migration identity conflict for ${event.eventId}`);
        }
      }
      if (typeof lastSyncAt === "string") {
        this.saveMetadata({schemaVersion: SPOOL_VERSION, lastSyncAt});
      }
      fs.renameSync(source, migrated);
      journal.phase = "committed";
      atomicReplaceJson(this.migrationJournalFile, journal);
      unlinkIfPresent(this.migrationJournalFile);
    } catch (error) {
      this.rollbackMigration(journal);
      throw error;
    }
  }

  private recoverMigrationJournal(): void {
    if (!fs.existsSync(this.migrationJournalFile)) {return;}
    try {
      const journal = this.validateMigrationJournal(
        readJsonFileBounded(this.migrationJournalFile, MAX_MIGRATION_FILE_BYTES)
      );
      if (journal.phase === "committed" || (!fs.existsSync(journal.source) && fs.existsSync(journal.migrated))) {
        unlinkIfPresent(this.migrationJournalFile);
      } else {
        this.rollbackMigration(journal);
      }
    } catch (error) {
      quarantineFile(this.migrationJournalFile, this.quarantineDir);
      logger.error("Telemetry migration journal was quarantined", error);
    }
  }

  private rollbackMigration(journal: TelemetryMigrationJournal): void {
    for (const {file, event} of journal.createdFiles) {
      try {
        const current = readJsonFileBounded(file, MAX_EVENT_FILE_BYTES);
        if (JSON.stringify(current) === JSON.stringify(event)) {unlinkIfPresent(file);}
      } catch { /* missing or concurrently changed */ }
    }
    if (journal.metadataChanged) {
      if (journal.previousMetadata) {
        atomicReplaceJson(this.metadataFile, journal.previousMetadata);
      } else {
        unlinkIfPresent(this.metadataFile);
      }
    }
    if (!fs.existsSync(journal.source) && fs.existsSync(journal.migrated)) {
      fs.renameSync(journal.migrated, journal.source);
    }
    unlinkIfPresent(this.migrationJournalFile);
  }

  private validateMigrationJournal(value: unknown): TelemetryMigrationJournal {
    if (!isRecord(value) || !hasExactKeys(
      value,
      ["schemaVersion", "source", "migrated", "phase", "createdFiles", "metadataChanged"],
      ["previousMetadata"]
    ) || value.schemaVersion !== MIGRATION_JOURNAL_VERSION ||
        typeof value.source !== "string" || typeof value.migrated !== "string" ||
        (value.phase !== "committing" && value.phase !== "committed") ||
        !Array.isArray(value.createdFiles) ||
        value.createdFiles.length > MAX_MIGRATION_EVENTS ||
        typeof value.metadataChanged !== "boolean") {
      throw new Error("invalid telemetry migration journal");
    }

    const allowedSources = [this.outboxFile, ...this.legacyFiles];
    if (!allowedSources.includes(value.source) || value.migrated !== `${value.source}.migrated`) {
      throw new Error("telemetry migration journal path is outside the spool");
    }

    const createdFiles = value.createdFiles.map(entry => {
      if (!isRecord(entry) || !hasExactKeys(entry, ["file", "event"]) ||
          typeof entry.file !== "string" || !isTelemetryEvent(entry.event) ||
          entry.file !== this.eventFile(entry.event.eventId)) {
        throw new Error("invalid telemetry migration journal event path");
      }
      return {file: entry.file, event: entry.event};
    });

    let previousMetadata: TelemetryMetadata | undefined;
    if (value.previousMetadata !== undefined) {
      if (!isRecord(value.previousMetadata) ||
          !hasExactKeys(value.previousMetadata, ["schemaVersion"], ["lastSyncAt"]) ||
          value.previousMetadata.schemaVersion !== SPOOL_VERSION ||
          (value.previousMetadata.lastSyncAt !== undefined &&
            !isIsoTimestamp(value.previousMetadata.lastSyncAt))) {
        throw new Error("invalid telemetry migration journal metadata");
      }
      previousMetadata = {
        schemaVersion: SPOOL_VERSION,
        lastSyncAt: typeof value.previousMetadata.lastSyncAt === "string"
          ? value.previousMetadata.lastSyncAt
          : undefined,
      };
    }

    return {
      schemaVersion: MIGRATION_JOURNAL_VERSION,
      source: value.source,
      migrated: value.migrated,
      phase: value.phase,
      createdFiles,
      metadataChanged: value.metadataChanged,
      previousMetadata,
    };
  }

  private readMetadataForMigration(): TelemetryMetadata | undefined {
    if (!fs.existsSync(this.metadataFile)) {return undefined;}
    const parsed = readJsonFileBounded(this.metadataFile, MAX_EVENT_FILE_BYTES);
    if (!isRecord(parsed) || !hasExactKeys(parsed, ["schemaVersion"], ["lastSyncAt"]) ||
        parsed.schemaVersion !== SPOOL_VERSION ||
        (parsed.lastSyncAt !== undefined && !isIsoTimestamp(parsed.lastSyncAt))) {
      throw new Error("invalid telemetry metadata");
    }
    return {
      schemaVersion: SPOOL_VERSION,
      lastSyncAt: typeof parsed.lastSyncAt === "string" ? parsed.lastSyncAt : undefined,
    };
  }

}

export function createTelemetryManager(
  config: Config,
  stateDir = configManager.getConfigDir(),
  legacyCacheDir = configManager.getCacheDir()
): TelemetryManager {
  return new TelemetryManager(config, stateDir, legacyCacheDir);
}

function legacyEvent(value: unknown, index: number): TelemetryEvent | undefined {
  if (!isRecord(value) || !isTelemetryAction(value.action)) {return undefined;}
  const occurredAt = Number(value.timestamp);
  if (
    !isValidOccurredAt(occurredAt) || Date.now() - occurredAt > MAX_EVENT_AGE_MS
  ) {return undefined;}
  const stableId =
    typeof value.eventId === "string" && SAFE_EVENT_ID.test(value.eventId)
      ? value.eventId
      : crypto.createHash("sha256").update(JSON.stringify({
          index,
          action: value.action,
          loc: value.loc,
          durationMs: value.durationMs,
          model: value.model,
          timestamp: value.timestamp,
        })).digest("hex");
  return {
    eventId: stableId,
    action: value.action,
    loc: clampInteger(value.loc, 0, 1_000_000_000),
    durationMs: clampInteger(value.durationMs, 0, 86_400_000),
    executionMode: executionModeFromLegacyModel(
      typeof value.model === "string" ? value.model : undefined
    ),
    occurredAt,
  };
}

function isTelemetryAction(value: unknown): value is TelemetryAction {
  return value === "review" || value === "security" || value === "scan" || value === "test";
}

function normalizePersistedEvent(value: unknown): TelemetryEvent | undefined {
  if (!isRecord(value) || !hasExactKeys(value, TELEMETRY_EVENT_KEYS)) {return undefined;}
  const eventId = typeof value.eventId === "string" && SAFE_EVENT_ID.test(value.eventId)
    ? value.eventId
    : crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const normalized: TelemetryEvent = {
    eventId,
    action: value.action as TelemetryAction,
    loc: value.loc as number,
    durationMs: value.durationMs as number,
    executionMode: value.executionMode as TelemetryExecutionMode,
    occurredAt: value.occurredAt as number,
  };
  return isTelemetryEvent(normalized) ? normalized : undefined;
}

function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (!isRecord(value) || !hasExactKeys(value, TELEMETRY_EVENT_KEYS)) {return false;}
  return Boolean(
    typeof value.eventId === "string" &&
    SAFE_EVENT_ID.test(value.eventId) &&
    isTelemetryAction(value.action) &&
    isBoundedInteger(value.loc, 0, 1_000_000_000) &&
    isBoundedInteger(value.durationMs, 0, 86_400_000) &&
    (value.executionMode === "static" ||
      value.executionMode === "local-ai" ||
      value.executionMode === "cloud-ai" ||
      value.executionMode === "unknown") &&
    isValidOccurredAt(value.occurredAt)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every(key => allowed.has(key));
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isValidOccurredAt(value: unknown): value is number {
  return isBoundedInteger(value, 0, 8_640_000_000_000_000) &&
    (value) <= Date.now() + MAX_FUTURE_SKEW_MS;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function executionModeFromLegacyModel(model?: string): TelemetryExecutionMode {
  if (!model || model === "unknown") {return "unknown";}
  if ([
    "sast",
    "static-analysis",
    "comprehensive-scan",
    "quality-tools",
    "local static scanners + quality analysis",
  ].includes(model)) {return "static";}
  if (model === "ollama" || model === "lmstudio") {return "local-ai";}
  return "cloud-ai";
}

function clampInteger(value: unknown, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {return minimum;}
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}

function compareTelemetryEvents(left: TelemetryEvent, right: TelemetryEvent): number {
  return left.occurredAt - right.occurredAt || left.eventId.localeCompare(right.eventId);
}

function addNewest<T>(
  values: T[],
  value: T,
  limit: number,
  compare: (left: T, right: T) => number
): T | undefined {
  values.push(value);
  values.sort(compare);
  if (values.length <= limit) {return undefined;}
  return values.shift();
}

function unlinkIfPresent(file: string): void {
  try {fs.unlinkSync(file);} catch (error: unknown) {
    if (!isNodeError(error) || error.code !== "ENOENT") {throw error;}
  }
}
