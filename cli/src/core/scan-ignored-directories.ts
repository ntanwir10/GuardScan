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

/** Check only real directories, after the walker's symlink handling. */
export function isPythonVirtualEnvironment(directory: string): boolean {
  try {
    return fs.lstatSync(path.join(directory, 'pyvenv.cfg')).isFile();
  } catch {
    // An absent or unreadable marker is not evidence to exclude source.
    return false;
  }
}
