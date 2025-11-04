import axios from 'axios';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

const CURRENT_VERSION = '0.1.0';
const VERSION_CHECK_URL = 'https://api.github.com/repos/yourusername/ai-code-review/releases/latest';
const VERSION_CACHE_FILE = '.version-cache';

interface VersionInfo {
  latest: string;
  checkedAt: string;
}

/**
 * Check for updates (non-blocking)
 */
export async function checkForUpdates(): Promise<void> {
  try {
    // Check cache first (only check once per day)
    const cacheFile = path.join(process.cwd(), VERSION_CACHE_FILE);
    if (fs.existsSync(cacheFile)) {
      const cache: VersionInfo = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      const lastCheck = new Date(cache.checkedAt);
      const now = new Date();
      const hoursSinceCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60);

      if (hoursSinceCheck < 24) {
        // Use cached version
        if (cache.latest !== CURRENT_VERSION) {
          displayUpdateMessage(cache.latest);
        }
        return;
      }
    }

    // Fetch latest version
    const response = await axios.get(VERSION_CHECK_URL, { timeout: 3000 });
    const latestVersion = response.data.tag_name.replace('v', '');

    // Cache the result
    const versionInfo: VersionInfo = {
      latest: latestVersion,
      checkedAt: new Date().toISOString(),
    };
    fs.writeFileSync(cacheFile, JSON.stringify(versionInfo, null, 2));

    // Display message if update available
    if (latestVersion !== CURRENT_VERSION) {
      displayUpdateMessage(latestVersion);
    }
  } catch {
    // Silent fail - don't disrupt user experience
  }
}

/**
 * Display update notification
 */
function displayUpdateMessage(latestVersion: string): void {
  console.log('');
  console.log(chalk.yellow('┌────────────────────────────────────────────────────────────┐'));
  console.log(chalk.yellow('│') + '  ' + chalk.bold('Update Available!') + '                                      ' + chalk.yellow('│'));
  console.log(chalk.yellow('│') + `  Current: ${CURRENT_VERSION}  →  Latest: ${latestVersion}                    ` + chalk.yellow('│'));
  console.log(chalk.yellow('│') + '                                                            ' + chalk.yellow('│'));
  console.log(chalk.yellow('│') + '  Run: ' + chalk.cyan('npm update -g ai-code-review') + '                  ' + chalk.yellow('│'));
  console.log(chalk.yellow('└────────────────────────────────────────────────────────────┘'));
  console.log('');
}

export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}
