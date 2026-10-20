'use strict';

const fs = require('fs');
const path = require('path');
const {readBounded} = require('./lib');

function verifyChecksumInventory(directory) {
  const entries = fs.readdirSync(directory, {withFileTypes: true});
  if (entries.some(entry => !entry.isFile())) throw new Error('Release payload contains non-regular files');
  const lines = readBounded(path.join(directory, 'SHA256SUMS'), 'signed checksums').trimEnd().split('\n');
  const names = lines.map(line => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._+~-]*)$/.exec(line);
    if (!match) throw new Error('Signed checksum entry has an unsafe path or format');
    return match[2];
  });
  const expected = entries.map(entry => entry.name)
    .filter(name => !['SHA256SUMS', 'SHA256SUMS.sigstore.json'].includes(name)).sort();
  if (!names.includes('release-manifest.json') || new Set(names).size !== names.length
      || names.sort().join('\n') !== expected.join('\n')) {
    throw new Error('Signed checksum file set does not equal the complete release payload');
  }
}

if (require.main === module) verifyChecksumInventory(process.argv[2]);
module.exports = {verifyChecksumInventory};
