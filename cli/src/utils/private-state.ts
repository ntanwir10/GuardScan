import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const READ_CHUNK_BYTES = 64 * 1024;
const MAX_BOUNDED_READ_BYTES = 16 * 1024 * 1024;
const DEFAULT_QUARANTINE_BYTES = 8 * 1024 * 1024;
const NO_FOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;

export interface BoundedDirectoryListing {
  names: string[];
  truncated: boolean;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  dirent: fs.Dirent;
}

export interface FileLease {
  renew(): void;
  release(): void;
}

interface LeaseRecord {
  pid: number;
  token: string;
  acquiredAt: number;
  renewedAt: number;
}

export function acquireFileLease(file: string, staleAfterMs: number): FileLease {
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1) {
    throw new Error('lease stale interval must be a positive safe integer');
  }
  ensurePrivateDirectory(path.dirname(file));
  const token = crypto.randomUUID();
  const acquiredAt = Date.now();
  const record: LeaseRecord = {pid: process.pid, token, acquiredAt, renewedAt: acquiredAt};

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeLeaseRecord(file, record, false);
      return createLease(file, record);
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== 'EEXIST') {throw error;}
      const existing = readExistingLease(file);
      const lastSeen = existing?.renewedAt ?? existing?.acquiredAt ?? fileMtime(file);
      const stale = Date.now() - lastSeen > staleAfterMs;
      if (!stale || (existing?.pid !== undefined && isProcessAlive(existing.pid))) {
        throw new Error('operation is already in progress');
      }
      if (existing?.token) {
        removeLeaseIfOwned(file, existing.token);
      } else {
        unlinkIfPresent(file);
      }
    }
  }
  throw new Error('operation is already in progress');
}

export function ensurePrivateDirectory(directory: string): void {
  assertDirectoryPathIsNotSymlink(directory);
  fs.mkdirSync(directory, {recursive: true, mode: DIRECTORY_MODE});
  assertDirectoryPathIsNotSymlink(directory);
  bestEffortChmod(directory, DIRECTORY_MODE);
}

/** Read a regular file through one descriptor, with a hard byte bound. */
export function readJsonFileBounded(file: string, maxBytes: number): unknown {
  const content = readTextFileBounded(file, maxBytes);
  return JSON.parse(content) as unknown;
}

export function atomicReplaceJson(
  file: string,
  value: unknown,
  options: {privateParent?: boolean} = {}
): void {
  atomicReplaceText(file, JSON.stringify(value, null, 2), options);
}

export function atomicReplaceText(
  file: string,
  content: string,
  options: {privateParent?: boolean} = {}
): void {
  ensureParentDirectory(path.dirname(file), options.privateParent !== false);
  const temporary = temporaryPath(file);
  fs.writeFileSync(temporary, content, {
    encoding: 'utf8', mode: FILE_MODE, flag: 'wx',
  });
  try {
    fs.renameSync(temporary, file);
    bestEffortChmod(file, FILE_MODE);
  } finally {
    unlinkIfPresent(temporary);
  }
}

/** Atomically publish a file without replacing an existing identity. */
export function publishJsonNoReplace(file: string, value: unknown): boolean {
  ensurePrivateDirectory(path.dirname(file));
  const temporary = temporaryPath(file);
  fs.writeFileSync(temporary, JSON.stringify(value), {
    encoding: 'utf8', mode: FILE_MODE, flag: 'wx',
  });
  try {
    try {
      fs.linkSync(temporary, file);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'EEXIST') {return false;}
      throw error;
    }
    bestEffortChmod(file, FILE_MODE);
    return true;
  } finally {
    unlinkIfPresent(temporary);
  }
}

/** Iterate every entry with O(1) directory-entry memory. */
export function forEachDirectoryEntry(
  directory: string,
  callback: (entry: DirectoryEntry) => void
): number {
  ensurePrivateDirectory(directory);
  const handle = fs.opendirSync(directory);
  let count = 0;
  try {
    let entry = handle.readSync();
    while (entry) {
      count += 1;
      callback({name: entry.name, path: path.join(directory, entry.name), dirent: entry});
      entry = handle.readSync();
    }
  } finally {
    handle.closeSync();
  }
  return count;
}

/** Compatibility helper for callers that intentionally need a bounded listing. */
export function listDirectoryBounded(directory: string, maxEntries: number): BoundedDirectoryListing {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error('directory entry limit must be a positive integer');
  }
  ensurePrivateDirectory(directory);
  const handle = fs.opendirSync(directory);
  const names: string[] = [];
  let truncated = false;
  try {
    let entry = handle.readSync();
    while (entry) {
      if (names.length === maxEntries) {
        truncated = true;
        break;
      }
      names.push(entry.name);
      entry = handle.readSync();
    }
  } finally {
    handle.closeSync();
  }
  names.sort((left, right) => left.localeCompare(right));
  return {names, truncated};
}

/** Move corrupt state away, with a bounded streaming copy fallback. */
export function quarantineFile(
  file: string,
  quarantineDirectory: string,
  maxEntries = 20,
  maxBytes = DEFAULT_QUARANTINE_BYTES
): void {
  try {fs.lstatSync(file);} catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {return;}
    throw error;
  }
  ensurePrivateDirectory(quarantineDirectory);
  const baseTarget = path.join(
    quarantineDirectory,
    `${path.basename(file)}.corrupt-${Date.now()}-${crypto.randomUUID()}`
  );
  try {
    fs.renameSync(file, baseTarget);
  } catch {
    try {
      const truncated = copyFileBounded(file, baseTarget, maxBytes);
      unlinkIfPresent(file);
      if (truncated) {
        const truncatedTarget = `${baseTarget}.truncated`;
        fs.renameSync(baseTarget, truncatedTarget);
      }
    } catch {
      unlinkIfPresent(baseTarget);
      return;
    }
  }
  bestEffortChmod(fs.existsSync(baseTarget) ? baseTarget : `${baseTarget}.truncated`, FILE_MODE);
  pruneQuarantine(quarantineDirectory, maxEntries);
}

export function pruneQuarantine(directory: string, maxEntries = 20): void {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error('quarantine entry limit must be a positive safe integer');
  }
  if (!fs.existsSync(directory)) {return;}
  const newest: Array<{file: string; mtimeMs: number; name: string}> = [];
  forEachDirectoryEntry(directory, entry => {
    let mtimeMs = Number.NEGATIVE_INFINITY;
    try {mtimeMs = fs.lstatSync(entry.path).mtimeMs;} catch { /* concurrent cleanup */ }
    newest.push({file: entry.path, mtimeMs, name: entry.name});
    newest.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
    while (newest.length > maxEntries) {
      const removed = newest.pop();
      if (removed) {unlinkIfPresent(removed.file);}
    }
  });
}

export function removeStaleTemporaryFiles(
  directory: string,
  olderThanMs = 24 * 60 * 60 * 1000
): void {
  const cutoff = Date.now() - olderThanMs;
  forEachDirectoryEntry(directory, entry => {
    if (!entry.name.includes('.tmp')) {return;}
    try {
      const stat = fs.lstatSync(entry.path);
      if ((stat.isFile() || stat.isSymbolicLink()) && stat.mtimeMs <= cutoff) {
        unlinkIfPresent(entry.path);
      }
    } catch { /* concurrent cleanup */ }
  });
}

export function bestEffortChmod(file: string, mode: number): void {
  try {fs.chmodSync(file, mode);} catch { /* unsupported on some platforms */ }
}

function createLease(file: string, record: LeaseRecord): FileLease {
  let released = false;
  return {
    renew: () => {
      if (released) {throw new Error('lease is already released');}
      const existing = readExistingLease(file);
      if (!existing || existing.token !== record.token) {
        throw new Error('lease ownership was lost');
      }
      record.renewedAt = Date.now();
      writeLeaseRecord(file, record, true);
    },
    release: () => {
      if (released) {return;}
      released = true;
      removeLeaseIfOwned(file, record.token);
    },
  };
}

function writeLeaseRecord(file: string, record: LeaseRecord, replace: boolean): void {
  ensurePrivateDirectory(path.dirname(file));
  if (!replace) {
    fs.writeFileSync(file, JSON.stringify(record), {encoding: 'utf8', mode: FILE_MODE, flag: 'wx'});
    bestEffortChmod(file, FILE_MODE);
    return;
  }
  const temporary = temporaryPath(file);
  fs.writeFileSync(temporary, JSON.stringify(record), {encoding: 'utf8', mode: FILE_MODE, flag: 'wx'});
  try {
    fs.renameSync(temporary, file);
    bestEffortChmod(file, FILE_MODE);
  } finally {
    unlinkIfPresent(temporary);
  }
}

function readExistingLease(file: string): LeaseRecord | undefined {
  try {
    const value = readJsonFileBounded(file, 4096);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {return undefined;}
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.pid !== 'number' || typeof candidate.token !== 'string' ||
        typeof candidate.acquiredAt !== 'number' || typeof candidate.renewedAt !== 'number') {
      return undefined;
    }
    return candidate as unknown as LeaseRecord;
  } catch {
    return undefined;
  }
}

function removeLeaseIfOwned(file: string, token: string): boolean {
  const existing = readExistingLease(file);
  if (!existing || existing.token !== token) {return false;}
  unlinkIfPresent(file);
  return true;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {return false;}
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return isNodeError(error) && error.code === 'EPERM';
  }
}

function fileMtime(file: string): number {
  try {return fs.statSync(file).mtimeMs;} catch {return 0;}
}

export function readTextFileBounded(file: string, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BOUNDED_READ_BYTES) {
    throw new Error('bounded read limit is invalid');
  }
  const flags = fs.constants.O_RDONLY | NO_FOLLOW;
  const descriptor = fs.openSync(file, flags);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {throw new Error(`${path.basename(file)} is not a regular file`);}
    if (stat.size > maxBytes) {throw new Error(`${path.basename(file)} exceeds size limit`);}
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (read === 0) {break;}
      offset += read;
      if (offset > maxBytes) {throw new Error(`${path.basename(file)} exceeds size limit`);}
    }
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function copyFileBounded(source: string, target: string, maxBytes: number): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {throw new Error('quarantine byte limit is invalid');}
  const input = fs.openSync(source, fs.constants.O_RDONLY | NO_FOLLOW);
  const output = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, FILE_MODE);
  let total = 0;
  let truncated = false;
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  try {
    for (;;) {
      const read = fs.readSync(input, buffer, 0, buffer.length, null);
      if (read === 0) {break;}
      const remaining = maxBytes - total;
      if (remaining <= 0) {truncated = true; break;}
      const writeLength = Math.min(read, remaining);
      fs.writeSync(output, buffer, 0, writeLength);
      total += writeLength;
      if (writeLength < read) {truncated = true; break;}
    }
  } finally {
    fs.closeSync(input);
    fs.closeSync(output);
  }
  return truncated;
}

function ensureParentDirectory(directory: string, privateParent: boolean): void {
  if (privateParent) {
    ensurePrivateDirectory(directory);
  } else {
    fs.mkdirSync(directory, {recursive: true});
  }
}

function assertDirectoryPathIsNotSymlink(directory: string): void {
  try {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink()) {throw new Error(`private directory is a symlink: ${directory}`);}
    if (!stat.isDirectory()) {throw new Error(`private state path is not a directory: ${directory}`);}
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {return;}
    throw error;
  }
}

function temporaryPath(file: string): string {
  return `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
}

function unlinkIfPresent(file: string): void {
  try {fs.unlinkSync(file);} catch (error: unknown) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {throw error;}
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error);
}
