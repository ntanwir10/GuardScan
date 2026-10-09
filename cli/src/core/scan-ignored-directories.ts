export const SCAN_IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'vendor',
  '.venv',
  'venv',
  'dist',
  'build',
  'target',
  'coverage',
  '__pycache__',
]);
