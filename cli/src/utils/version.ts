import axios from "axios";
import chalk from "chalk";
import * as path from "path";
import * as semver from "semver";
import { ConfigManager } from "../core/config";
import { API_CONSTANTS } from "../constants/api-constants";
import { TELEMETRY_CONSTANTS } from "../constants/telemetry-constants";
import { environmentRequestsOffline } from "./execution-policy";
import { acquireFileLease, atomicReplaceJson, readJsonFileBounded } from "./private-state";
import { detectInstallations, getInstallationCommand, runInstallationCommand } from "./installation";

const CURRENT_VERSION: string = require("../../package.json").version;

export function isNewerVersion(latest: string, current: string): boolean {
  return !!semver.valid(latest) && !!semver.valid(current) && semver.gt(latest, current);
}

export function assertUpdatesOnline(): void {
  const manager = new ConfigManager();
  if (environmentRequestsOffline() || (manager.exists() && manager.load().offlineMode)) {
    throw new Error('Updates are disabled in offline mode. Run "guardscan config --offline false" and omit --offline to update.');
  }
}

/** Explicit checks bypass the daily cache; malformed cache entries are ignored. */
export async function getLatestVersion(force = false): Promise<string> {
  assertUpdatesOnline();
  const cacheFile = path.join(new ConfigManager().getCacheDir(), TELEMETRY_CONSTANTS.VERSION_CACHE_FILE);
  if (!force) {
    try {
      const cache = readJsonFileBounded(cacheFile, 4096) as {latest?: unknown; checkedAt?: unknown};
      const age = typeof cache.checkedAt === 'string' ? Date.now() - Date.parse(cache.checkedAt) : NaN;
      if (typeof cache.latest === 'string' && semver.valid(cache.latest) &&
          !semver.prerelease(cache.latest) && age >= 0 && age < API_CONSTANTS.VERSION_CACHE_HOURS * 3600000) {
        return cache.latest;
      }
    } catch { /* A missing or invalid cache must not prevent an update check. */ }
  }

  const response = await axios.get(API_CONSTANTS.VERSION_CHECK_URL, {
    timeout: API_CONSTANTS.VERSION_CHECK_TIMEOUT,
    maxContentLength: 1024 * 1024,
    maxRedirects: 0,
  });
  const latest: unknown = response.data?.version;
  if (typeof latest !== 'string' || !semver.valid(latest) || semver.prerelease(latest)) {
    throw new Error('The update registry returned an invalid stable version.');
  }
  try {
    atomicReplaceJson(cacheFile, {latest, checkedAt: new Date().toISOString()});
  } catch { /* Update checks still work when the cache is read-only. */ }
  return latest;
}

export async function withInstallationLease(operation: () => Promise<void>): Promise<void> {
  const lease = acquireFileLease(path.join(new ConfigManager().getCacheDir(), 'installation.lock'), 15 * 60_000);
  try {await operation();} finally {lease.release();}
}

/** Automatic updates run after successful interactive commands, never in CI. */
export async function checkForUpdates(options: {allowAutoUpdate?: boolean} = {}): Promise<void> {
  let automatic = false;
  try {
    if (environmentRequestsOffline()) {return;}
    const manager = new ConfigManager();
    if (!manager.exists()) {return;}
    const config = manager.load({touchLastUsed: false});
    if (config.offlineMode) {return;}
    automatic = config.autoUpdate === true && options.allowAutoUpdate === true &&
      !!process.stdin.isTTY && !!process.stdout.isTTY && !!process.stderr.isTTY && !process.env.CI;
    const notifications = config.telemetryEnabled && process.env.GUARDSCAN_NO_TELEMETRY !== 'true';
    if (!automatic && !notifications) {return;}

    const latest = await getLatestVersion();
    if (!isNewerVersion(latest, CURRENT_VERSION)) {return;}
    // Native channels can lag npm and failures can persist, so try each target version at most once per cache window.
    const attemptFile = path.join(manager.getCacheDir(), '.auto-update-attempt');
    if (automatic) {
      try {
        const attempt = readJsonFileBounded(attemptFile, 4096) as {latest?: unknown; attemptedAt?: unknown};
        const age = typeof attempt.attemptedAt === 'string' ? Date.now() - Date.parse(attempt.attemptedAt) : NaN;
        automatic = !(attempt.latest === latest && age >= 0 && age < API_CONSTANTS.VERSION_CACHE_HOURS * 3600000);
      } catch { /* No previous attempt. */ }
    }
    if (automatic) {
      atomicReplaceJson(attemptFile, {latest, attemptedAt: new Date().toISOString()});
      await withInstallationLease(async () => {
        const installations = await detectInstallations();
        if (installations.length !== 1 || !installations[0].active) {
          throw new Error('Multiple or missing installations; run "guardscan update --check" and select --manager.');
        }
        const plan = getInstallationCommand(installations[0], 'update');
        console.error(`Updating GuardScan using ${installations[0].manager}...`);
        await runInstallationCommand(plan);
        console.error('Package-manager update completed. Run "guardscan --version" to check the installed version.');
      });
    } else if (notifications) {
      console.error(chalk.yellow(`\nUpdate Available! ${CURRENT_VERSION} → ${latest}\nRun: guardscan update\n`));
    }
  } catch (error) {
    if (automatic || process.env.GUARDSCAN_DEBUG === 'true') {
      console.error(`[UPDATE] ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
