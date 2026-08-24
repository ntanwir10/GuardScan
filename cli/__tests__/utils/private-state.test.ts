import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  acquireFileLease,
  atomicReplaceJson,
  ensurePrivateDirectory,
  forEachDirectoryEntry,
  listDirectoryBounded,
  publishJsonNoReplace,
  quarantineFile,
  readJsonFileBounded,
  readTextFileBounded,
} from '../../src/utils/private-state';

describe('private state persistence', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-private-state-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates private directories and atomically replaces private JSON files', () => {
    const directory = path.join(root, 'state');
    const file = path.join(directory, 'value.json');
    ensurePrivateDirectory(directory);
    atomicReplaceJson(file, { value: 1 });
    atomicReplaceJson(file, { value: 2 });

    expect(readJsonFileBounded(file, 1024)).toEqual({ value: 2 });
    expect(fs.readdirSync(directory).filter(name => name.includes('.tmp'))).toEqual([]);
    if (process.platform !== 'win32') {
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('publishes without replacing an existing identity', () => {
    const file = path.join(root, 'event.json');
    expect(publishJsonNoReplace(file, { winner: 1 })).toBe(true);
    expect(publishJsonNoReplace(file, { winner: 2 })).toBe(false);
    expect(readJsonFileBounded(file, 1024)).toEqual({ winner: 1 });
  });

  it('rejects oversized JSON before parsing', () => {
    const file = path.join(root, 'large.json');
    fs.writeFileSync(file, JSON.stringify({ data: 'x'.repeat(100) }));
    expect(() => readJsonFileBounded(file, 32)).toThrow('exceeds size limit');
  });

  it('exports the descriptor-safe bounded text reader', () => {
    const file = path.join(root, 'value.txt');
    fs.writeFileSync(file, 'bounded text');

    expect(readTextFileBounded(file, 1024)).toBe('bounded text');
  });

  it('opens bounded JSON through a descriptor without following symlinks', () => {
    if (process.platform === 'win32') {return;}
    const target = path.join(root, 'target.json');
    const link = path.join(root, 'link.json');
    fs.writeFileSync(target, JSON.stringify({secret: true}));
    fs.symlinkSync(target, link);

    expect(() => readJsonFileBounded(link, 1024)).toThrow();
  });

  it('bounds directory iteration without loading every entry into the result', () => {
    for (let index = 0; index < 5; index++) {
      fs.writeFileSync(path.join(root, `${index}.json`), '{}');
    }
    const listing = listDirectoryBounded(root, 3);
    expect(listing.truncated).toBe(true);
    expect(listing.names).toHaveLength(3);
    expect(listing.names).toEqual([...listing.names].sort((left, right) => left.localeCompare(right)));
    expect(new Set(listing.names).size).toBe(3);
    expect(listing.names.every(name => /^[0-4]\.json$/.test(name))).toBe(true);
  });

  it('can process every directory entry with bounded callback memory', () => {
    for (let index = 0; index < 5; index++) {
      fs.writeFileSync(path.join(root, `${index}.json`), '{}');
    }
    const seen: string[] = [];
    forEachDirectoryEntry(root, entry => { seen.push(entry.name); });
    expect(seen.sort()).toEqual(['0.json', '1.json', '2.json', '3.json', '4.json']);
  });

  it('keeps only the newest bounded quarantine entries', () => {
    const quarantine = path.join(root, 'quarantine');
    for (let index = 0; index < 4; index++) {
      const file = path.join(root, `${index}.json`);
      fs.writeFileSync(file, '{}');
      fs.utimesSync(file, index + 1, index + 1);
      quarantineFile(file, quarantine, 2);
    }
    expect(fs.readdirSync(quarantine)).toHaveLength(2);
  });

  it('serializes leases and recovers an abandoned stale lease', () => {
    const lease = path.join(root, 'sync.lock');
    const owner = acquireFileLease(lease, 1000);
    expect(() => acquireFileLease(lease, 1000)).toThrow('already in progress');
    owner.release();

    fs.writeFileSync(lease, JSON.stringify({pid: 0, token: 'abandoned', acquiredAt: 0, renewedAt: 0}));
    fs.utimesSync(lease, 0, 0);
    const releaseRecovered = acquireFileLease(lease, 1000);
    expect(fs.existsSync(lease)).toBe(true);
    releaseRecovered.release();
    expect(fs.existsSync(lease)).toBe(false);
  });

  it('does not release a replacement lease owned by another token', () => {
    const lease = path.join(root, 'sync.lock');
    const first = acquireFileLease(lease, 1000);
    fs.writeFileSync(lease, JSON.stringify({pid: process.pid, token: 'replacement', acquiredAt: Date.now(), renewedAt: Date.now()}));

    first.release();

    expect(fs.existsSync(lease)).toBe(true);
  });

  it('renews an owned lease and updates its liveness timestamp', async () => {
    const lease = path.join(root, 'sync.lock');
    const owner = acquireFileLease(lease, 1000);
    const before = fs.statSync(lease).mtimeMs;
    await new Promise(resolve => setTimeout(resolve, 10));

    owner.renew();

    expect(fs.statSync(lease).mtimeMs).toBeGreaterThan(before);
    owner.release();
  });
});
