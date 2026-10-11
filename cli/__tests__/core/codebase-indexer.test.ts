import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodebaseIndexer } from '../../src/core/codebase-indexer';
import { configManager } from '../../src/core/config';

describe('CodebaseIndexer cache policy', () => {
  const originalNoCache = process.env.GUARDSCAN_NO_CACHE;
  let repository: string;
  let cache: string;

  beforeEach(() => {
    delete process.env.GUARDSCAN_NO_CACHE;
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-codebase-index-'));
    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-codebase-cache-'));
    fs.writeFileSync(path.join(repository, 'fixture.ts'), 'export const fixture = 1;\n');
    jest.spyOn(configManager, 'getCacheDir').mockReturnValue(cache);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalNoCache === undefined) {delete process.env.GUARDSCAN_NO_CACHE;}
    else {process.env.GUARDSCAN_NO_CACHE = originalNoCache;}
    fs.rmSync(repository, {recursive: true, force: true});
    fs.rmSync(cache, {recursive: true, force: true});
  });

  it('keeps the source-derived index memory-only when caching is disabled', async () => {
    process.env.GUARDSCAN_NO_CACHE = 'true';
    const indexer = new CodebaseIndexer(repository, 'fixture-repo');

    const index = await indexer.buildIndex();

    expect(index.totalFiles).toBe(1);
    expect(await indexer.getFileIndex(path.join(repository, 'fixture.ts'))).not.toBeNull();
    expect(fs.existsSync(path.join(cache, 'fixture-repo', 'index.json'))).toBe(false);
  });

  it('does not load a persisted source-derived index when caching is disabled', async () => {
    const persisted = new CodebaseIndexer(repository, 'fixture-repo');
    await persisted.buildIndex();
    expect(fs.existsSync(path.join(cache, 'fixture-repo', 'index.json'))).toBe(true);

    process.env.GUARDSCAN_NO_CACHE = 'true';
    const memoryOnly = new CodebaseIndexer(repository, 'fixture-repo');

    expect(await memoryOnly.getFileIndex(path.join(repository, 'fixture.ts'))).toBeNull();
  });
});
