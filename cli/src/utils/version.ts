import axios from "axios";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import * as semver from "semver";
import { ConfigManager } from "../core/config";
import { API_CONSTANTS } from "../constants/api-constants";
import { TELEMETRY_CONSTANTS } from "../constants/telemetry-constants";

const packageJson = require("../../package.json");
const CURRENT_VERSION = packageJson.version;

interface VersionInfo {
  latest: string;
  checkedAt: string;
}

/**
 * Check if a version is newer than the current version
 * Uses semver library for proper semantic version comparison
 */
function isNewerVersion(latest: string, current: string): boolean {
  // Validate versions first - if invalid, don't show update
  if (!semver.valid(latest) || !semver.valid(current)) {
    return false;
  }
  return semver.gt(latest, current);
}

/**
 * Check for updates (non-blocking)
 */
export async function checkForUpdates(): Promise<void> {
  const debug = process.env.GUARDSCAN_DEBUG === "true";

  try {
    if (debug) console.error("[VERSION] Checking for updates...");

    // Check cache first (only check once per day)
    const configManager = new ConfigManager();
    const cacheDir = configManager.getCacheDir();

    if (debug) console.error(`[VERSION] Cache dir: ${cacheDir}`);

    // Defensive: ensure cache directory exists before accessing files
    if (!fs.existsSync(cacheDir)) {
      if (debug)
        console.error("[VERSION] Cache dir does not exist, creating...");
      try {
        fs.mkdirSync(cacheDir, { recursive: true });
      } catch (dirError) {
        if (debug)
          console.error(
            "[VERSION] Failed to create cache dir, skipping version check"
          );
        return; // Can't create cache dir, skip version check silently
      }
    }

    const cacheFile = path.join(
      cacheDir,
      TELEMETRY_CONSTANTS.VERSION_CACHE_FILE
    );

    if (debug) console.error(`[VERSION] Cache file: ${cacheFile}`);
    if (fs.existsSync(cacheFile)) {
      const cache: VersionInfo = JSON.parse(
        fs.readFileSync(cacheFile, "utf-8")
      );
      const lastCheck = new Date(cache.checkedAt);
      const now = new Date();
      const hoursSinceCheck =
        (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60);

      if (hoursSinceCheck < API_CONSTANTS.VERSION_CACHE_HOURS) {
        // Use cached version
        if (isNewerVersion(cache.latest, CURRENT_VERSION)) {
          displayUpdateMessage(cache.latest);
        }
        return;
      }
    }

    // Fetch latest version from npm registry
    const response = await axios.get(API_CONSTANTS.VERSION_CHECK_URL, {
      timeout: API_CONSTANTS.VERSION_CHECK_TIMEOUT,
    });
    // npm registry returns { version: "1.0.2" } - no "v" prefix needed
    const latestVersion = response.data.version;

    // Cache the result (defensive write)
    const versionInfo: VersionInfo = {
      latest: latestVersion,
      checkedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(cacheFile, JSON.stringify(versionInfo, null, 2));
      if (debug) console.error("[VERSION] Cache file written successfully");
    } catch (writeError) {
      if (debug)
        console.error("[VERSION] Failed to write cache file:", writeError);
      // Continue anyway - version check still works, just won't cache
    }

    // Display message if update available (only if latest is actually newer)
    if (isNewerVersion(latestVersion, CURRENT_VERSION)) {
      displayUpdateMessage(latestVersion);
    }
  } catch (error) {
    if (debug) console.error("[VERSION] Check failed:", error);
    // Silent fail - don't disrupt user experience
  }
}

/**
 * Display update notification with dynamic padding
 */
function displayUpdateMessage(latestVersion: string): void {
  const width = 60;
  const border = "─".repeat(width);

  const title = "Update Available!";
  const currentText = `Current: ${CURRENT_VERSION}`;
  const latestText = `Latest: ${latestVersion}`;
  const versionLine = `${currentText}  →  ${latestText}`;
  const updateText = `Run: ${chalk.cyan("npm update -g guardscan")}`;

  // Calculate padding dynamically
  const titlePadding = " ".repeat(Math.max(0, width - title.length - 2));
  const versionPadding = " ".repeat(
    Math.max(0, width - versionLine.length - 2)
  );
  const updatePadding = " ".repeat(
    Math.max(0, width - updateText.length + 10 - 2)
  ); // +10 for chalk color codes
  const emptyLine = " ".repeat(width);

  console.log("");
  console.log(chalk.yellow(`┌${border}┐`));
  console.log(
    chalk.yellow("│") +
      "  " +
      chalk.bold(title) +
      titlePadding +
      chalk.yellow("│")
  );
  console.log(
    chalk.yellow("│") + "  " + versionLine + versionPadding + chalk.yellow("│")
  );
  console.log(chalk.yellow("│") + emptyLine + chalk.yellow("│"));
  console.log(
    chalk.yellow("│") + "  " + updateText + updatePadding + chalk.yellow("│")
  );
  console.log(chalk.yellow(`└${border}┘`));
  console.log("");
}

export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
