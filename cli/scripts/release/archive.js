'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_ARCHIVE_BYTES = 768 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 32;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeArchivePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 255
      || value.includes('\\') || value.includes('\0') || value.startsWith('/')) {
    throw new Error(`archive entry path is unsafe: ${String(value)}`);
  }
  const segments = value.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`archive entry path is unsafe: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || path.posix.isAbsolute(normalized)) {
    throw new Error(`archive entry path is not normalized: ${value}`);
  }
  return normalized;
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`archive must contain 1-${MAX_ARCHIVE_ENTRIES} entries`);
  }
  const names = new Set();
  let expandedSize = 0;
  return entries.map(entry => {
    const name = normalizeArchivePath(entry.name);
    const caseFolded = name.toLocaleLowerCase('en-US');
    if (names.has(caseFolded)) throw new Error(`archive contains duplicate entry: ${name}`);
    names.add(caseFolded);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    expandedSize += data.length;
    if (expandedSize > MAX_EXPANDED_BYTES) throw new Error('archive expanded size exceeds the supported limit');
    const mode = entry.mode === undefined ? 0o644 : entry.mode;
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) {
      throw new Error(`archive entry mode is invalid: ${name}`);
    }
    return {name, data, mode};
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function dosTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
    throw new Error('archive timestamp must be a canonical ISO timestamp');
  }
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5)
    | Math.floor(date.getUTCSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return {date: day, time};
}

function buildZip(entries, timestamp) {
  const normalized = normalizeEntries(entries);
  const dos = dosTimestamp(timestamp);
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of normalized) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dos.time, 10);
    local.writeUInt16LE(dos.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dos.time, 12);
    central.writeUInt16LE(dos.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((entry.mode & 0xffff) << 16, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(normalized.length, 8);
  end.writeUInt16LE(normalized.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function writeOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, '0');
  if (encoded.length > length - 1) throw new Error('tar header value exceeds its field');
  header.write(encoded, offset, length - 1, 'ascii');
  header[offset + length - 1] = 0;
}

function buildTar(entries, timestamp) {
  const normalized = normalizeEntries(entries);
  const seconds = Math.floor(new Date(timestamp).getTime() / 1000);
  if (!Number.isSafeInteger(seconds)) throw new Error('archive timestamp is invalid');
  const parts = [];
  for (const entry of normalized) {
    const name = Buffer.from(entry.name, 'utf8');
    if (name.length > 100) throw new Error(`tar entry path exceeds 100 bytes: ${entry.name}`);
    const header = Buffer.alloc(512);
    name.copy(header, 0);
    writeOctal(header, 100, 8, entry.mode);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, entry.data.length);
    writeOctal(header, 136, 12, seconds);
    header.fill(0x20, 148, 156);
    header[156] = 0x30;
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    header.write('root', 265, 4, 'ascii');
    header.write('root', 297, 4, 'ascii');
    writeOctal(header, 329, 8, 0);
    writeOctal(header, 337, 8, 0);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    const encoded = checksum.toString(8).padStart(6, '0');
    header.write(encoded, 148, 6, 'ascii');
    header[154] = 0;
    header[155] = 0x20;
    const padding = Buffer.alloc((512 - (entry.data.length % 512)) % 512);
    parts.push(header, entry.data, padding);
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function buildArchive(format, entries, timestamp) {
  if (format === 'zip') return buildZip(entries, timestamp);
  if (format === 'tar.gz') {
    return zlib.gzipSync(buildTar(entries, timestamp), {level: 9, mtime: 0});
  }
  throw new Error(`unsupported archive format: ${format}`);
}

function metadataForEntries(entries) {
  return normalizeEntries(entries).map(entry => ({
    path: entry.name,
    size: entry.data.length,
    mode: entry.mode.toString(8).padStart(4, '0'),
    sha256: sha256(entry.data),
  }));
}

function writeArchive(file, format, entries, timestamp) {
  const resolved = path.resolve(file);
  const archive = buildArchive(format, entries, timestamp);
  if (archive.length <= 0 || archive.length > MAX_ARCHIVE_BYTES) {
    throw new Error('archive size is outside the supported range');
  }
  fs.mkdirSync(path.dirname(resolved), {recursive: true, mode: 0o700});
  fs.writeFileSync(resolved, archive, {mode: 0o600, flag: 'wx'});
  return {
    filename: path.basename(resolved),
    format,
    size: archive.length,
    sha256: sha256(archive),
    entries: metadataForEntries(entries),
  };
}

function parseTarOctal(buffer, offset, length, label) {
  const raw = buffer.subarray(offset, offset + length).toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]+$/.test(raw)) throw new Error(`tar ${label} is invalid`);
  return Number.parseInt(raw, 8);
}

function inspectTarGz(buffer) {
  let tar;
  try {
    tar = zlib.gunzipSync(buffer, {maxOutputLength: MAX_EXPANDED_BYTES});
  } catch (error) {
    throw new Error(`tar.gz payload is invalid or unbounded: ${error.message}`);
  }
  const entries = [];
  const names = new Set();
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every(byte => byte === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) break;
      continue;
    }
    if (zeroBlocks > 0) throw new Error('tar contains data after a zero block');
    const expectedChecksum = parseTarOctal(header, 148, 8, 'checksum');
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    if (expectedChecksum !== actualChecksum) throw new Error('tar header checksum mismatch');
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    normalizeArchivePath(name);
    const folded = name.toLocaleLowerCase('en-US');
    if (names.has(folded)) throw new Error(`archive contains duplicate entry: ${name}`);
    names.add(folded);
    const type = header[156];
    if (![0, 0x30].includes(type)) throw new Error(`tar contains a link or unsupported entry: ${name}`);
    const size = parseTarOctal(header, 124, 12, 'size');
    const mode = parseTarOctal(header, 100, 8, 'mode');
    if (size < 0 || offset + size > tar.length) throw new Error(`tar entry is truncated: ${name}`);
    const data = tar.subarray(offset, offset + size);
    entries.push({path: name, size, mode: mode.toString(8).padStart(4, '0'), sha256: sha256(data)});
    if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('archive contains too many entries');
    offset += Math.ceil(size / 512) * 512;
  }
  if (zeroBlocks !== 2) throw new Error('tar archive is missing its end marker');
  if (tar.subarray(offset).some(byte => byte !== 0)) throw new Error('tar contains trailing data');
  return entries;
}

function inspectZip(buffer) {
  const entries = [];
  const names = new Set();
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > buffer.length) throw new Error('zip local header is truncated');
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const expectedCrc = buffer.readUInt32LE(offset + 14);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const size = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    if ((flags & ~0x0800) !== 0 || method !== 0 || compressedSize !== size || extraLength !== 0) {
      throw new Error('zip entry uses unsupported flags, compression, or extra data');
    }
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) throw new Error('zip entry is truncated');
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    normalizeArchivePath(name);
    const folded = name.toLocaleLowerCase('en-US');
    if (names.has(folded)) throw new Error(`archive contains duplicate entry: ${name}`);
    names.add(folded);
    const data = buffer.subarray(dataStart, dataEnd);
    if (crc32(data) !== expectedCrc) throw new Error(`zip CRC mismatch: ${name}`);
    entries.push({path: name, size, mode: undefined, sha256: sha256(data)});
    if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('archive contains too many entries');
    offset = dataEnd;
  }
  const centralOffset = offset;
  for (let index = 0; index < entries.length; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('zip central directory is missing or truncated');
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name !== entries[index].path || extraLength !== 0 || commentLength !== 0) {
      throw new Error('zip central directory conflicts with local entries');
    }
    entries[index].mode = ((externalAttributes >>> 16) & 0xffff).toString(8).padStart(4, '0');
    offset += 46 + nameLength;
  }
  if (offset + 22 !== buffer.length || buffer.readUInt32LE(offset) !== 0x06054b50) {
    throw new Error('zip end record is missing or trailing data exists');
  }
  if (buffer.readUInt16LE(offset + 8) !== entries.length
      || buffer.readUInt16LE(offset + 10) !== entries.length
      || buffer.readUInt32LE(offset + 12) !== offset - centralOffset
      || buffer.readUInt32LE(offset + 16) !== centralOffset
      || buffer.readUInt16LE(offset + 20) !== 0) {
    throw new Error('zip end record conflicts with the archive');
  }
  return entries;
}

function inspectArchive(file, format, expectedEntries) {
  const resolved = path.resolve(file);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ARCHIVE_BYTES) {
    throw new Error('archive size is outside the supported range');
  }
  const buffer = fs.readFileSync(resolved);
  const entries = format === 'zip'
    ? inspectZip(buffer)
    : format === 'tar.gz'
      ? inspectTarGz(buffer)
      : (() => { throw new Error(`unsupported archive format: ${format}`); })();
  if (expectedEntries) {
    const expected = [...expectedEntries].sort();
    const actual = entries.map(entry => entry.path).sort();
    if (actual.join('\n') !== expected.join('\n')) {
      throw new Error(`archive entries differ from the allowlist: ${actual.join(', ')}`);
    }
  }
  return {size: stat.size, sha256: sha256(buffer), entries};
}

module.exports = {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_EXPANDED_BYTES,
  buildArchive,
  crc32,
  inspectArchive,
  metadataForEntries,
  normalizeArchivePath,
  writeArchive,
};
