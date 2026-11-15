import * as fs from 'fs';
import * as path from 'path';

export const SCAN_IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'vendor',
  'dist',
  'build',
  'target',
  'coverage',
  '__pycache__',
]);

// Default names from `writeScanResult` (security/scan JSON and SARIF) and
// `reporter.saveReport` (`<prefix>-<toISOString with : and . as ->.md|html`).
const GUARDSCAN_REPORT_FILE_NAME =
  /^guardscan-(?:(?:security|scan)\.(?:json|sarif)|[a-z-]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.(?:md|html))$/;

/**
 * A report GuardScan wrote on an earlier run. Scanning it would report on
 * GuardScan's own output. `reportOutputPath` is this run's canonical `--output`.
 */
export function isGuardScanReport(file: string, reportOutputPath?: string): boolean {
  return file === reportOutputPath || GUARDSCAN_REPORT_FILE_NAME.test(path.basename(file));
}

/** Check only real directories, after the walker's symlink handling. */
export function isPythonVirtualEnvironment(directory: string): boolean {
  try {
    return fs.lstatSync(path.join(directory, 'pyvenv.cfg')).isFile();
  } catch {
    // An absent or unreadable marker is not evidence to exclude source.
    return false;
  }
}
