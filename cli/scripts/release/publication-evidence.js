'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA = 'guardscan.provider-publication.v1';
const CHANNELS = new Set(['github', 'npm', 'pypi']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+~-]*$/;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function aggregateFiles(files) {
  const names = Object.keys(files).sort();
  if (names.length < 1 || names.length > 100) {
    throw new Error('provider publication evidence requires 1-100 files');
  }
  for (const name of names) {
    if (name.length > 200 || !FILENAME_PATTERN.test(name) || !SHA256_PATTERN.test(files[name] || '')) {
      throw new Error(`provider publication file identity is invalid: ${name}`);
    }
  }
  return names.length === 1
    ? files[names[0]]
    : sha256(names.map(name => `${name}\0${files[name]}\n`).join(''));
}

function createPublicationEvidence(input) {
  if (!CHANNELS.has(input.channel)) throw new Error('provider publication channel is invalid');
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/.test(input.version || '')) {
    throw new Error('provider publication version is invalid');
  }
  if (input.tag !== `v${input.version}`) throw new Error('provider publication tag is invalid');
  if (typeof input.remoteIdentity !== 'string'
      || input.remoteIdentity.length < 1
      || input.remoteIdentity.length > 500) {
    throw new Error('provider publication remote identity is invalid');
  }
  const files = Object.fromEntries(Object.entries(input.files || {}).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
  return {
    schemaVersion: SCHEMA,
    channel: input.channel,
    version: input.version,
    tag: input.tag,
    remoteIdentity: input.remoteIdentity,
    aggregateSha256: aggregateFiles(files),
    files,
  };
}

function writePublicationEvidence(file, input) {
  const evidence = createPublicationEvidence(input);
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), {recursive: true, mode: 0o700});
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  if (fs.existsSync(resolved)) {
    if (fs.readFileSync(resolved, 'utf8') !== text) {
      throw new Error(`provider publication evidence conflicts with existing file: ${resolved}`);
    }
    return {created: false, evidence};
  }
  fs.writeFileSync(resolved, text, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  return {created: true, evidence};
}

module.exports = {
  SCHEMA,
  aggregateFiles,
  createPublicationEvidence,
  writePublicationEvidence,
};
