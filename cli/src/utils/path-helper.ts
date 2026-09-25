import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Get home directory with fallbacks for containerized environments
 * Handles Alpine Docker and other edge cases where os.homedir() may fail
 */
export function getSafeHomeDir(): string {
  const candidates = [
    process.env.GUARDSCAN_HOME,
    process.env.HOME,
    process.env.USERPROFILE,
    safeOsHomeDir(),
  ];

  for (const candidate of candidates) {
    if (!candidate) {continue;}
    const resolved = path.resolve(candidate);
    if (path.isAbsolute(candidate) && resolved !== path.parse(resolved).root) {
      return resolved;
    }
  }

  throw new Error(
    'Could not determine a secure GuardScan home directory. ' +
      'Set GUARDSCAN_HOME to an absolute, private directory.'
  );
}

function safeOsHomeDir(): string | undefined {
  try {
    return os.homedir();
  } catch {
    return undefined;
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
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }
    assertPrivateDirectoryOwner(dirPath);
    try { fs.chmodSync(dirPath, 0o700); } catch { /* unsupported on some platforms */ }
    return true;
  } catch (error) {
    if (process.env.GUARDSCAN_DEBUG === 'true') {
      console.error(`[GuardScan] Failed to create directory ${dirPath}:`, error);
    }
    return false;
  }
}

function assertPrivateDirectoryOwner(dirPath: string): void {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') {return;}
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new Error(`GuardScan state path is not a directory: ${dirPath}`);
  }
  if (stat.uid !== process.getuid()) {
    throw new Error(`GuardScan state directory is owned by another user: ${dirPath}`);
  }
}
