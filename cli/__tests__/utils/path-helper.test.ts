import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ensureDirectoryExists,
  getSafeHomeDir,
  repositoryRelativePath,
} from '../../src/utils/path-helper';

describe('path-helper private state handling', () => {
  it('normalizes repository paths to portable POSIX separators', () => {
    const repoRoot = path.join(os.tmpdir(), 'workspace', 'project');
    const authPath = path.join(repoRoot, 'src', 'auth.ts');

    expect(repositoryRelativePath(repoRoot, authPath))
      .toBe('src/auth.ts');
    expect(repositoryRelativePath(repoRoot, 'src/auth.ts'))
      .toBe('src/auth.ts');
    expect(repositoryRelativePath(repoRoot, 'src\\auth.ts'))
      .toBe('src/auth.ts');
  });

  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('ignores unsafe relative and root candidates', () => {
    const safeHome = path.join(os.tmpdir(), 'guardscan-safe-home');
    process.env.GUARDSCAN_HOME = 'relative-state';
    process.env.HOME = '/';
    process.env.USERPROFILE = safeHome;

    expect(getSafeHomeDir()).toBe(safeHome);
  });

  it('creates private state directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-path-'));
    const directory = path.join(root, 'private-state');
    try {
      expect(ensureDirectoryExists(directory)).toBe(true);
      if (process.platform !== 'win32') {
        expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
