'use strict';

const crypto = require('crypto');
const path = require('path');
const {readBounded, readJson} = require('./lib');
const MARKER = '<!-- guardscan-canonical-payload:v1 ';

function validatePointer(pointer, tag) {
  if (!/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.(0|[1-9][0-9]*))?$/.test(tag)
      || !pointer || pointer.schemaVersion !== 'guardscan.canonical-payload.v1' || pointer.tag !== tag
      || !/^[1-9][0-9]{0,19}$/.test(pointer.runId || '') || typeof pointer.runId !== 'string'
      || !Number.isSafeInteger(pointer.runAttempt) || pointer.runAttempt < 1 || pointer.runAttempt > 1000
      || pointer.artifact !== `release-canonical-${tag}-${pointer.runId}-${pointer.runAttempt}`
      || !/^[a-f0-9]{64}$/.test(pointer.manifestSha256 || '')
      || Object.keys(pointer).sort().join(',') !== 'artifact,manifestSha256,runAttempt,runId,schemaVersion,tag') {
    throw new Error('Invalid immutable canonical payload pointer');
  }
  return pointer;
}

function createPointer(directory, tag) {
  const raw = readBounded(path.join(directory, 'release-manifest.json'), 'canonical manifest');
  const manifest = JSON.parse(raw);
  if (manifest.tag !== tag || manifest.producer?.sourceRef !== `refs/tags/${tag}`) {
    throw new Error('Canonical manifest tag/sourceRef mismatch');
  }
  const {runId, runAttempt} = manifest.producer;
  return validatePointer({schemaVersion: 'guardscan.canonical-payload.v1', tag, runId, runAttempt,
    artifact: `release-canonical-${tag}-${runId}-${runAttempt}`,
    manifestSha256: crypto.createHash('sha256').update(raw).digest('hex')}, tag);
}

function formatPointer(pointer) {
  return `${MARKER}${JSON.stringify(pointer)} -->`;
}

function parsePointer(body, tag) {
  const text = typeof body === 'string' ? body : '';
  const matches = [...text.matchAll(/<!-- guardscan-canonical-payload:v1 ([^\r\n]*?) -->/g)];
  if (!matches.length && !text.includes(MARKER)) return undefined; // Legacy completed release.
  if (matches.length !== 1) throw new Error('Missing or ambiguous canonical draft pointer');
  return validatePointer(JSON.parse(matches[0][1]), tag);
}

function verifyCanonical(directory, pointer) {
  validatePointer(pointer, pointer.tag);
  const actual = createPointer(directory, pointer.tag);
  if (Object.keys(actual).some(key => actual[key] !== pointer[key])) {
    throw new Error('Recovered payload does not match the original canonical producer/manifest');
  }
}

if (require.main === module) {
  const [command, input, tag] = process.argv.slice(2);
  if (command === 'notes') process.stdout.write(formatPointer(createPointer(input, tag)) + '\n');
  else if (command === 'pointer') process.stdout.write(JSON.stringify(parsePointer(readJson(input).body, tag) || null) + '\n');
  else if (command === 'verify') verifyCanonical(input, readJson(tag));
  else throw new Error('Expected canonical payload notes, pointer, or verify command');
}

module.exports = {createPointer, formatPointer, parsePointer, verifyCanonical};
