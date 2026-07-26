'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {CHANNELS, readBounded} = require('./lib');

const EVENT_SCHEMA = 'guardscan.release-event.v1';
const MAX_EVENT_BYTES = 64 * 1024;
const CATALOG_IDENTITY_PATTERN = /^github:ntanwir10\/homebrew-tap@[a-f0-9]{40}#(?:Formula\/guardscan\.rb|bucket\/guardscan\.json)$/;
const EVENT_TYPES = Object.freeze([
  'train_started',
  'artifact_built',
  'artifact_signed',
  'manifest_created',
  'channel_published',
  'channel_submitted',
  'channel_accepted',
  'channel_verified',
  'channel_failed',
  'canary_recorded',
  'promotion_decided',
  'rollback_started',
  'withdrawn',
  'superseded',
  'incident_opened',
  'incident_resolved',
]);
const CHANNEL_EVENT_STATUS = Object.freeze({
  channel_published: 'published',
  channel_submitted: 'submitted',
  channel_accepted: 'accepted',
  channel_verified: 'verified',
  channel_failed: 'failed',
  withdrawn: 'withdrawn',
  superseded: 'superseded',
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function eventDigest(event) {
  const {eventHash: _ignored, ...unsigned} = event;
  return sha256(canonicalJson(unsigned));
}

function assertCanonicalTimestamp(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
}

function assertIdentity(document, expected, label) {
  for (const field of ['version', 'tag', 'commit']) {
    if (document[field] !== expected[field]) {
      throw new Error(`${label} ${field} does not match the release train`);
    }
  }
}

function validateCatalogEvidence(event) {
  const evidence = event.payload?.catalog;
  if (evidence === undefined) return;
  if (!['homebrew', 'scoop'].includes(event.channel)) {
    throw new Error('catalog evidence is valid only for homebrew or scoop events');
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('release event catalog evidence must be an object');
  }
  const keys = Object.keys(evidence).sort();
  const expectedKeys = [
    'commit',
    'fileDigest',
    'lockDigest',
    'manifestDigest',
    'path',
    'pullRequest',
    'repository',
  ].sort();
  if (keys.join('\n') !== expectedKeys.join('\n')) {
    throw new Error('release event catalog evidence has unexpected or missing fields');
  }
  if (evidence.repository !== 'ntanwir10/homebrew-tap') {
    throw new Error('release event catalog repository is invalid');
  }
  if (!/^[a-f0-9]{40}$/.test(evidence.commit || '')) {
    throw new Error('release event catalog commit is invalid');
  }
  if (!Number.isSafeInteger(evidence.pullRequest) || evidence.pullRequest < 1) {
    throw new Error('release event catalog pull request is invalid');
  }
  for (const field of ['lockDigest', 'manifestDigest', 'fileDigest']) {
    if (!/^[a-f0-9]{64}$/.test(evidence[field] || '')) {
      throw new Error(`release event catalog ${field} is invalid`);
    }
  }
  const expectedPath = event.channel === 'homebrew'
    ? 'Formula/guardscan.rb'
    : 'bucket/guardscan.json';
  if (evidence.path !== expectedPath) {
    throw new Error(`release event catalog path does not match ${event.channel}`);
  }
  if (!CATALOG_IDENTITY_PATTERN.test(event.payload.remoteIdentity || '')
      || event.payload.remoteIdentity
        !== `github:${evidence.repository}@${evidence.commit}#${evidence.path}`) {
    throw new Error('release event catalog remote identity is invalid');
  }
  if (event.payload.remoteDigest !== evidence.fileDigest) {
    throw new Error('release event catalog remote digest does not match file evidence');
  }
}

function validateEvent(event, previous) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('release event must be an object');
  }
  if (event.schemaVersion !== EVENT_SCHEMA) throw new Error('release event schema is unsupported');
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/.test(event.version || '')) {
    throw new Error('release event version is invalid');
  }
  if (event.tag !== `v${event.version}`) throw new Error('release event tag does not match version');
  if (!/^[a-f0-9]{40}$/.test(event.commit || '')) throw new Error('release event commit is invalid');
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
    throw new Error('release event sequence is invalid');
  }
  if (!EVENT_TYPES.includes(event.type)) throw new Error(`unsupported release event type: ${event.type}`);
  if (typeof event.idempotencyKey !== 'string' || event.idempotencyKey.length < 1
      || event.idempotencyKey.length > 200) {
    throw new Error('release event idempotencyKey is invalid');
  }
  if (event.channel !== undefined
      && !CHANNELS.some(candidate => candidate.id === event.channel)) {
    throw new Error(`release event channel is unsupported: ${event.channel}`);
  }
  if (event.payload === null || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error('release event payload must be an object');
  }
  validateCatalogEvidence(event);
  assertCanonicalTimestamp(event.timestamp, 'release event timestamp');
  if (!/^[a-f0-9]{64}$/.test(event.eventHash || '')
      || event.eventHash !== eventDigest(event)) {
    throw new Error('release event hash is invalid');
  }
  if (!previous) {
    if (event.sequence !== 1 || event.previousHash !== null || event.type !== 'train_started') {
      throw new Error('release ledger must begin with train_started sequence 1');
    }
  } else {
    assertIdentity(event, previous, 'release event');
    if (event.sequence !== previous.sequence + 1) throw new Error('release event sequence is not contiguous');
    if (event.previousHash !== previous.eventHash) throw new Error('release event hash chain is broken');
    if (event.timestamp < previous.timestamp) throw new Error('release event timestamp moved backward');
  }
  return event;
}

function parseLedgerText(text, label = 'release ledger') {
  if (text === '') return [];
  if (!text.endsWith('\n')) throw new Error(`${label} has a partial final record`);
  const lines = text.slice(0, -1).split('\n');
  const events = [];
  const idempotencyKeys = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) {
      throw new Error(`${label} event ${index + 1} exceeds ${MAX_EVENT_BYTES} bytes`);
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`${label} event ${index + 1} is invalid JSON`);
    }
    validateEvent(event, events.at(-1));
    if (idempotencyKeys.has(event.idempotencyKey)) {
      throw new Error(`${label} contains duplicate idempotency key: ${event.idempotencyKey}`);
    }
    idempotencyKeys.add(event.idempotencyKey);
    events.push(event);
  }
  return events;
}

function readEvents(ledgerFile) {
  const resolved = path.resolve(ledgerFile);
  if (!fs.existsSync(resolved)) return [];
  return parseLedgerText(readBounded(resolved, 'release ledger'));
}

function createEvent(input, previous) {
  const sequence = previous ? previous.sequence + 1 : 1;
  const event = {
    schemaVersion: EVENT_SCHEMA,
    version: input.version,
    tag: input.tag,
    commit: input.commit,
    sequence,
    previousHash: previous?.eventHash || null,
    timestamp: input.timestamp,
    type: input.type,
    idempotencyKey: input.idempotencyKey,
    ...(input.channel ? {channel: input.channel} : {}),
    payload: input.payload || {},
  };
  event.eventHash = eventDigest(event);
  return validateEvent(event, previous);
}

function comparableInput(event) {
  return canonicalJson({
    version: event.version,
    tag: event.tag,
    commit: event.commit,
    timestamp: event.timestamp,
    type: event.type,
    idempotencyKey: event.idempotencyKey,
    ...(event.channel ? {channel: event.channel} : {}),
    payload: event.payload || {},
  });
}

function appendEvent(ledgerFile, input) {
  const resolved = path.resolve(ledgerFile);
  const parent = path.dirname(resolved);
  fs.mkdirSync(parent, {recursive: true, mode: 0o700});
  const lockFile = `${resolved}.lock`;
  let lockDescriptor;
  try {
    try {
      lockDescriptor = fs.openSync(lockFile, 'wx', 0o600);
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error(`release ledger is locked: ${lockFile}`);
      throw error;
    }
    const events = readEvents(resolved);
    const existing = events.find(event => event.idempotencyKey === input.idempotencyKey);
    if (existing) {
      if (comparableInput(existing) !== comparableInput(input)) {
        throw new Error(`idempotency key conflicts with an existing release event: ${input.idempotencyKey}`);
      }
      return {changed: false, event: existing};
    }
    const event = createEvent(input, events.at(-1));
    const line = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) {
      throw new Error(`release event exceeds ${MAX_EVENT_BYTES} bytes`);
    }
    const descriptor = fs.openSync(resolved, 'a', 0o600);
    try {
      fs.writeFileSync(descriptor, line, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    return {changed: true, event};
  } finally {
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    fs.rmSync(lockFile, {force: true});
  }
}

function initialChannels(event) {
  const requested = event.payload.channels;
  const channelIds = Array.isArray(requested)
    ? requested
    : CHANNELS.map(channel => channel.id);
  return Object.fromEntries(channelIds.map(channel => [channel, {
    status: 'planned',
    artifactIds: [],
    updatedAt: event.timestamp,
  }]));
}

function materializeReleaseState(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('cannot materialize an empty release ledger');
  }
  events.forEach((event, index) => validateEvent(event, events[index - 1]));
  const first = events[0];
  const state = {
    schemaVersion: 'guardscan.release-state.v2',
    version: first.version,
    tag: first.tag,
    commit: first.commit,
    updatedAt: first.timestamp,
    lastSequence: 0,
    lastEventHash: null,
    manifestSha256: undefined,
    channels: initialChannels(first),
    canaries: {},
    incidents: {},
    promotion: undefined,
  };
  for (const event of events) {
    state.updatedAt = event.timestamp;
    state.lastSequence = event.sequence;
    state.lastEventHash = event.eventHash;
    if (event.type === 'manifest_created') state.manifestSha256 = event.payload.manifestSha256;
    const status = CHANNEL_EVENT_STATUS[event.type];
    if (status) {
      if (!event.channel || !state.channels[event.channel]) {
        throw new Error(`${event.type} requires a channel present in the release train`);
      }
      const previous = state.channels[event.channel];
      state.channels[event.channel] = {
        status,
        artifactIds: Array.isArray(event.payload.artifactIds)
          ? [...event.payload.artifactIds].sort()
          : previous.artifactIds,
        updatedAt: event.timestamp,
        ...(event.payload.remoteIdentity || previous.remoteIdentity
          ? {remoteIdentity: event.payload.remoteIdentity || previous.remoteIdentity}
          : {}),
        ...(event.payload.remoteDigest || previous.remoteDigest
          ? {remoteDigest: event.payload.remoteDigest || previous.remoteDigest}
          : {}),
        ...(event.payload.error ? {error: event.payload.error} : {}),
        ...(event.payload.catalog || previous.catalog
          ? {catalog: event.payload.catalog || previous.catalog}
          : {}),
      };
    }
    if (event.type === 'canary_recorded') {
      if (!event.channel) throw new Error('canary_recorded requires a channel');
      const samples = state.canaries[event.channel] || [];
      state.canaries[event.channel] = [...samples, {
        status: event.payload.status,
        checkedAt: event.timestamp,
        evidenceUrl: event.payload.evidenceUrl,
      }];
    }
    if (event.type === 'incident_opened') {
      state.incidents[event.payload.incidentId] = {
        kind: event.payload.kind,
        status: 'open',
        openedAt: event.timestamp,
        summary: event.payload.summary,
      };
    }
    if (event.type === 'incident_resolved') {
      const incident = state.incidents[event.payload.incidentId];
      if (!incident) throw new Error(`cannot resolve unknown incident: ${event.payload.incidentId}`);
      state.incidents[event.payload.incidentId] = {
        ...incident,
        status: 'resolved',
        resolvedAt: event.timestamp,
      };
    }
    if (event.type === 'promotion_decided') state.promotion = event.payload;
  }
  if (!state.manifestSha256) delete state.manifestSha256;
  if (!state.promotion) delete state.promotion;
  return state;
}

module.exports = {
  EVENT_SCHEMA,
  EVENT_TYPES,
  MAX_EVENT_BYTES,
  appendEvent,
  canonicalJson,
  createEvent,
  eventDigest,
  materializeReleaseState,
  parseLedgerText,
  readEvents,
  validateEvent,
};
