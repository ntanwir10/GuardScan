'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+~-]*$/;
const INVENTORY_FILES = new Set(['SHA256SUMS', 'SHA256SUMS.sigstore.json']);

// This verifier runs from a sparse checkout without npm-installed dependencies.
function readChecksums(file) {
  const limit = 1024 * 1024;
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > limit) throw new Error('Signed checksums are not a bounded regular file');
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > stat.size) throw new Error('Signed checksums changed while being read');
    return bytes.subarray(0, offset).toString('utf8');
  } finally { fs.closeSync(descriptor); }
}

function parseChecksumInventory(directory) {
  const entries = fs.readdirSync(directory, {withFileTypes: true});
  if (entries.some(entry => !entry.isFile())) throw new Error('Release payload contains non-regular files');
  const lines = readChecksums(path.join(directory, 'SHA256SUMS')).trimEnd().split('\n');
  const checksums = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._+~-]*)$/.exec(line);
    if (!match) throw new Error('Signed checksum entry has an unsafe path or format');
    if (INVENTORY_FILES.has(match[2])) throw new Error('Signed checksum entry names inventory metadata');
    if (checksums.has(match[2])) throw new Error(`Signed checksum inventory has a duplicate entry: ${match[2]}`);
    checksums.set(match[2], match[1]);
  }
  return {entries, checksums};
}

function hashRegularFile(directory, name) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(path.join(directory, name), fs.constants.O_RDONLY | noFollow);
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error(`Release payload is not a regular file: ${name}`);
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(128 * 1024);
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
}

function verifyChecksumInventory(directory, selectedNames) {
  const {entries, checksums} = parseChecksumInventory(directory);
  const names = [...checksums.keys()];
  const present = entries.map(entry => entry.name)
    .filter(name => !INVENTORY_FILES.has(name)).sort();
  if (!checksums.has('release-manifest.json')) {
    throw new Error('Signed checksum file set is missing release-manifest.json');
  }
  if (selectedNames === undefined && names.sort().join('\n') !== present.join('\n')) {
    throw new Error('Signed checksum file set does not equal the complete release payload');
  }
  if (selectedNames !== undefined && present.some(name => !checksums.has(name))) {
    throw new Error('Signed checksum inventory does not cover every present release payload');
  }
  if (selectedNames === undefined) return;
  if (!Array.isArray(selectedNames) || selectedNames.length === 0
      || selectedNames.some(name => typeof name !== 'string' || !SAFE_NAME.test(name) || INVENTORY_FILES.has(name))) {
    throw new Error('Selected checksum names must be safe payload filenames');
  }
  if (new Set(selectedNames).size !== selectedNames.length) {
    throw new Error('Selected checksum names must be unique');
  }
  for (const name of selectedNames) {
    const expectedDigest = checksums.get(name);
    if (!expectedDigest) throw new Error(`Signed checksum inventory is missing required payload: ${name}`);
    const actualDigest = hashRegularFile(directory, name);
    if (actualDigest !== expectedDigest) throw new Error(`Signed checksum digest does not match payload: ${name}`);
  }
}

if (require.main === module) {
  const [directory, ...selectedNames] = process.argv.slice(2);
  verifyChecksumInventory(directory, selectedNames.length ? selectedNames : undefined);
}
module.exports = {verifyChecksumInventory};
