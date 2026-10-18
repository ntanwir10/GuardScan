import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodebaseIndexer } from '../../src/core/codebase-indexer';
import { configManager } from '../../src/core/config';
import { AICache } from '../../src/core/ai-cache';

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

  it.each(['true', '1', 'TRUE', 'TrUe'])('keeps the source-derived index memory-only for cache opt-out %s', async value => {
    process.env.GUARDSCAN_NO_CACHE = value;
    const indexer = new CodebaseIndexer(repository, 'fixture-repo');

    const index = await indexer.buildIndex();

    expect(index.totalFiles).toBe(1);
    expect(await indexer.getFileIndex(path.join(repository, 'fixture.ts'))).not.toBeNull();
    expect(fs.existsSync(path.join(cache, 'fixture-repo', 'index.json'))).toBe(false);
  });

  it.each(['true', '1', 'TRUE', 'TrUe'])('does not load a persisted source-derived index for cache opt-out %s', async value => {
    const persisted = new CodebaseIndexer(repository, 'fixture-repo');
    await persisted.buildIndex();
    expect(fs.existsSync(path.join(cache, 'fixture-repo', 'index.json'))).toBe(true);

    process.env.GUARDSCAN_NO_CACHE = value;
    const memoryOnly = new CodebaseIndexer(repository, 'fixture-repo');

    expect(await memoryOnly.getFileIndex(path.join(repository, 'fixture.ts'))).toBeNull();
  });

  it.each(['true', '1', 'TRUE', 'TrUe'])('does not persist AI prompts or responses for cache opt-out %s', async value => {
    process.env.GUARDSCAN_NO_CACHE = value;
    const ai = new AICache('fixture-repo');
    await ai.set('private source prompt', 'fixture-model', 'private response');

    expect(ai.isEnabled()).toBe(false);
    expect(await ai.get('private source prompt', 'fixture-model')).toBeNull();
    expect(fs.readdirSync(cache)).toEqual([]);
  });
});
