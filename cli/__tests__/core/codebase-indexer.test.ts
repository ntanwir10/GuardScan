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

  it('rejects legacy Windows index keys without deleting the cache and rebuilds canonical paths', async () => {
    fs.mkdirSync(path.join(repository, 'nested'));
    fs.writeFileSync(path.join(repository, 'nested', 'helper.ts'), 'export function helper() { return 1; }\n');
    fs.writeFileSync(path.join(repository, 'nested', 'main.ts'), "import { helper } from './helper';\nexport function main() { return helper(); }\n");
    const original = await new CodebaseIndexer(repository, 'fixture-repo').buildIndex();
    const indexPath = path.join(cache, 'fixture-repo', 'index.json');
    const serialized = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const windowsPaths = (value: unknown): unknown => {
      if (typeof value === 'string') {return value.replace(/\//g, '\\');}
      if (Array.isArray(value)) {return value.map(windowsPaths);}
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, windowsPaths(item)]));
      }
      return value;
    };
    const legacy = {...windowsPaths(serialized) as object, version: '1.0.0'};
    fs.writeFileSync(indexPath, JSON.stringify(legacy));
    const legacyBytes = fs.readFileSync(indexPath);
    const fresh = new CodebaseIndexer(repository, 'fixture-repo');
    expect(await fresh.getFileIndex(path.join(repository, 'nested', 'main.ts'))).toBeNull();
    expect(await fresh.searchFunctions('main')).toEqual([]);
    expect(await fresh.getDependencies('nested/main.ts')).toEqual([]);
    expect(fs.readFileSync(indexPath)).toEqual(legacyBytes);

    const rebuilt = await fresh.updateIndex([]);
    expect(rebuilt.version).toBe('2.0.0');
    expect([...rebuilt.files.keys()]).toEqual([...original.files.keys()]);
    expect([...rebuilt.symbols.keys()]).toEqual([...original.symbols.keys()]);
    expect([...rebuilt.symbols.keys()].every(id => !id.includes('\\'))).toBe(true);
    expect([...rebuilt.symbols.keys()].some(id => id.startsWith('nested/main.ts:'))).toBe(true);
    const reloaded = new CodebaseIndexer(repository, 'fixture-repo');
    expect((await reloaded.getFileIndex(path.join(repository, 'nested', 'main.ts')))?.relativePath).toBe('nested/main.ts');
    expect(await reloaded.getDependencies('nested/main.ts')).toContain('nested/helper.ts');
    expect(await reloaded.searchFunctions('main')).toHaveLength(1);
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

  it('publishes AI cache JSON privately through atomic rename without modifying linked targets', async () => {
    const ai = new AICache('fixture-repo');
    const directory = path.join(cache, 'fixture-repo', 'ai-cache');
    fs.mkdirSync(directory, {recursive: true});
    const external = path.join(repository, 'external-cache.json');
    fs.writeFileSync(external, 'untouched');
    const target = path.join(directory, 'cache.json');
    if (process.platform === 'win32') {fs.linkSync(external, target);}
    else {fs.symlinkSync(external, target);}
    const nativeFs = require('fs') as typeof fs;
    const rename = jest.spyOn(nativeFs, 'renameSync');

    await ai.set('private prompt', 'fixture-model', 'private response');

    expect(fs.readFileSync(external, 'utf8')).toBe('untouched');
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).entries).toHaveLength(1);
    expect(rename).toHaveBeenCalledWith(expect.any(String), target);
    if (process.platform !== 'win32') {expect(fs.statSync(target).mode & 0o777).toBe(0o600);}
  });

  it('creates the private cache directory on the first atomic publication', async () => {
    const directory = path.join(cache, 'fixture-repo', 'ai-cache');
    expect(fs.existsSync(directory)).toBe(false);
    await new AICache('fixture-repo').set('prompt', 'fixture-model', 'response');
    expect(await new AICache('fixture-repo').get('prompt', 'fixture-model')).toBe('response');
    if (process.platform !== 'win32') {
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(directory, 'cache.json')).mode & 0o777).toBe(0o600);
    }
  });
});
