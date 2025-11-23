import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Get home directory with fallbacks for containerized environments
 * Handles Alpine Docker and other edge cases where os.homedir() may fail
 */
export function getSafeHomeDir(): string {
  try {
    // Priority 1: Custom GuardScan home (useful for Docker/containers)
    if (process.env.GUARDSCAN_HOME) {
      return process.env.GUARDSCAN_HOME;
    }

    // Priority 2: Standard HOME environment variable
    if (process.env.HOME) {
      return process.env.HOME;
    }

    // Priority 3: Windows USERPROFILE
    if (process.env.USERPROFILE) {
      return process.env.USERPROFILE;
    }

    // Priority 4: Try os.homedir()
    const homeDir = os.homedir();
    
    // Validate the path is reasonable (not root or empty)
    if (homeDir && homeDir !== '/' && homeDir !== '') {
      return homeDir;
    }

    // Last resort: use /tmp for containerized environments
    if (process.env.GUARDSCAN_DEBUG === 'true') {
      console.error('[GuardScan] WARNING: Could not determine home directory, using /tmp');
    }
    return '/tmp';
  } catch (error) {
    if (process.env.GUARDSCAN_DEBUG === 'true') {
      console.error('[GuardScan] ERROR: Failed to get home directory:', error);
    }
    // Absolute last resort
    return '/tmp';
  }
}

/**
 * Get GuardScan config directory
 */
export function getGuardScanDir(): string {
  const homeDir = getSafeHomeDir();
  return path.join(homeDir, '.guardscan');
}

/**
 * Get GuardScan cache directory
 */
export function getGuardScanCacheDir(): string {
  return path.join(getGuardScanDir(), 'cache');
}

/**
 * Ensure a directory exists, creating it if necessary
 * Returns true if directory exists or was created successfully
 */
export function ensureDirectoryExists(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return true;
  } catch (error) {
    if (process.env.GUARDSCAN_DEBUG === 'true') {
      console.error(`[GuardScan] Failed to create directory ${dirPath}:`, error);
    }
    return false;
  }
}

