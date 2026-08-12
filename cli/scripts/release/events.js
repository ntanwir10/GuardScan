'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {CHANNELS, readBounded} = require('./lib');
const {createPublicationEvidence} = require('./publication-evidence');

const EVENT_SCHEMA = 'guardscan.release-event.v1';
const MAX_EVENT_BYTES = 64 * 1024;
const CATALOG_IDENTITY_PATTERN = /^github:ntanwir10\/homebrew-tap@[a-f0-9]{40}#(?:Formula\/guardscan\.rb|bucket\/guardscan\.json)$/;
const PRIMARY_PUBLICATION_CHANNELS = new Set(['github', 'npm', 'pypi']);
const MODERATED_CHANNELS = new Set(['winget', 'chocolatey']);
const EXTERNAL_WITHDRAWAL_CHANNELS = new Set([
  'npm', 'pypi', 'homebrew-core', 'winget', 'chocolatey',
]);
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
  'channel_rejected',
  'channel_corrected',
  'channel_resubmitted',
  'canary_recorded',
  'promotion_decided',
  'rollback_started',
  'rollback_repository_completed',
  'action_required',
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
  channel_rejected: 'rejected',
  channel_corrected: 'corrected',
  channel_resubmitted: 'resubmitted',
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
  if (event.type === 'rollback_repository_completed') return;
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

function validateActionRequired(event) {
  if (event.type !== 'action_required') return;
  if (!event.channel) throw new Error('action_required requires a release channel');
  const payload = event.payload;
  const keys = Object.keys(payload).sort();
  const expectedKeys = ['action', 'authority', 'reason'];
  if (keys.join('\n') !== expectedKeys.join('\n')
      || expectedKeys.some(key => typeof payload[key] !== 'string' || payload[key].length < 1)) {
    throw new Error('action_required payload must contain only action, authority, and reason');
  }
  if (payload.action.length > 200 || payload.authority.length > 100 || payload.reason.length > 2000) {
    throw new Error('action_required payload exceeds its bounded field length');
  }
}

function validatePublicationEvidence(event) {
  const evidence = event.payload?.publication;
  const required = event.type === 'channel_published'
    && PRIMARY_PUBLICATION_CHANNELS.has(event.channel);
  if (evidence === undefined) {
    if (required) {
      throw new Error('primary channel publication requires provider-bound file evidence');
    }
    return;
  }
  if (!required) {
    throw new Error('provider publication evidence is valid only for primary published channels');
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('provider publication evidence must be an object');
  }
  const normalized = createPublicationEvidence(evidence);
  if (canonicalJson(normalized) !== canonicalJson(evidence)) {
    throw new Error('provider publication evidence is not canonical');
  }
  if (evidence.channel !== event.channel
      || evidence.version !== event.version
      || evidence.tag !== event.tag
      || evidence.remoteIdentity !== event.payload.remoteIdentity
      || evidence.aggregateSha256 !== event.payload.remoteDigest) {
    throw new Error('provider publication evidence does not match its release event');
  }
}

function validateTrainStarted(event) {
  if (event.type !== 'train_started') return;
  const channels = event.payload.channels;
  const supported = new Set(CHANNELS.map(channel => channel.id));
  if (!Array.isArray(channels) || channels.length < 1
      || new Set(channels).size !== channels.length
      || channels.some(channel => typeof channel !== 'string' || !supported.has(channel))) {
    throw new Error('release train channels must be a non-empty unique supported channel list');
  }
  const sourceFields = ['profile', 'releasePr', 'sourcePrHead', 'sourcePrBase', 'sourcePrTree'];
  if (sourceFields.some(field => event.payload[field] !== undefined)) {
    const keys = Object.keys(event.payload).sort();
    const expected = ['channels', ...sourceFields].sort();
    if (keys.join('\n') !== expected.join('\n')
        || event.payload.profile !== 'full'
        || !Number.isSafeInteger(event.payload.releasePr)
        || event.payload.releasePr < 1
        || ['sourcePrHead', 'sourcePrBase', 'sourcePrTree'].some(field => (
          !/^[a-f0-9]{40}$/.test(event.payload[field] || '')
        ))) {
      throw new Error('release train source provenance is incomplete or invalid');
    }
  }
}

function validateModerationEvent(event) {
  const moderationTypes = new Set([
    'channel_submitted', 'channel_accepted', 'channel_rejected',
    'channel_corrected', 'channel_resubmitted',
  ]);
  if (['channel_rejected', 'channel_corrected', 'channel_resubmitted'].includes(event.type)
      && !MODERATED_CHANNELS.has(event.channel)) {
    throw new Error(`${event.type} is valid only for moderated release channels`);
  }
  if (!moderationTypes.has(event.type) || !MODERATED_CHANNELS.has(event.channel)) return;
  const evidence = event.payload.submission;
  const requiresReason = event.type === 'channel_rejected';
  const payloadKeys = Object.keys(event.payload).sort();
  const expectedPayloadKeys = [
    'artifactIds', 'remoteDigest', 'remoteIdentity', 'submission',
    ...(requiresReason ? ['reason'] : []),
  ].sort();
  if (payloadKeys.join('\n') !== expectedPayloadKeys.join('\n')
      || !Array.isArray(event.payload.artifactIds)
      || event.payload.artifactIds.length < 1
      || new Set(event.payload.artifactIds).size !== event.payload.artifactIds.length
      || event.payload.artifactIds.some(id => (
        typeof id !== 'string' || id.length < 1 || id.length > 200
      ))
      || typeof event.payload.remoteIdentity !== 'string'
      || event.payload.remoteIdentity.length < 1
      || !/^[a-f0-9]{64}$/.test(event.payload.remoteDigest || '')
      || !evidence
      || typeof evidence !== 'object'
      || Array.isArray(evidence)) {
    throw new Error(`${event.type} requires canonical moderated provider evidence`);
  }
  const expectedState = {
    channel_submitted: new Set(['submitted', 'pending', 'pending-ledger']),
    channel_accepted: new Set(['accepted', 'public-exact']),
    channel_rejected: new Set(['rejected']),
    channel_corrected: new Set(['corrected']),
    channel_resubmitted: new Set(['resubmitted']),
  }[event.type];
  const commonKeys = [
    'channel', 'packageIdentity', 'provider', 'remoteDigest', 'remoteIdentity',
    'schemaVersion', 'state', 'tag', 'version',
  ];
  const expectedEvidenceKeys = [
    ...commonKeys,
    ...(event.channel === 'winget' ? ['files'] : ['packageFilename']),
    ...(requiresReason ? ['reason'] : []),
  ].sort();
  if (Object.keys(evidence).sort().join('\n') !== expectedEvidenceKeys.join('\n')
      || evidence.schemaVersion !== 'guardscan.moderated-submission.v1'
      || evidence.channel !== event.channel
      || evidence.version !== event.version
      || evidence.tag !== event.tag
      || !expectedState.has(evidence.state)
      || evidence.remoteIdentity !== event.payload.remoteIdentity
      || evidence.remoteDigest !== event.payload.remoteDigest
      || typeof evidence.packageIdentity !== 'string'
      || evidence.packageIdentity.length < 1
      || !evidence.provider
      || typeof evidence.provider !== 'object'
      || Array.isArray(evidence.provider)
      || typeof evidence.provider.pendingStateQuery !== 'string'
      || evidence.provider.pendingStateQuery.length < 1
      || evidence.provider.pendingStateQuery.length > 1000
      || (requiresReason && (
        typeof evidence.reason !== 'string'
        || evidence.reason.length < 1
        || evidence.reason.length > 2000
        || event.payload.reason !== evidence.reason
      ))) {
    throw new Error(`${event.type} moderated provider evidence is not release-bound`);
  }
  if (event.channel === 'winget') {
    const filenames = [
      'NaumanTanwir.GuardScan.installer.yaml',
      'NaumanTanwir.GuardScan.locale.en-US.yaml',
      'NaumanTanwir.GuardScan.yaml',
    ];
    const providerKeys = [
      'commit', 'path', 'pendingStateQuery', 'publicBytesVerified',
      'pullRequest', 'repository',
    ].sort();
    const fileNames = Object.keys(evidence.files || {}).sort();
    const digestInput = fileNames.map(name => `${name}\0${evidence.files[name]}\n`).join('');
    const publicExact = evidence.state === 'public-exact';
    const expectedIdentity = publicExact
      ? `github:microsoft/winget-pkgs@${evidence.provider.commit}#${evidence.provider.path}`
      : `github:microsoft/winget-pkgs/pull/${evidence.provider.pullRequest}@${evidence.provider.commit}#${evidence.provider.path}`;
    if (Object.keys(evidence.provider).sort().join('\n') !== providerKeys.join('\n')
        || fileNames.join('\n') !== filenames.join('\n')
        || fileNames.some(name => !/^[a-f0-9]{64}$/.test(evidence.files[name] || ''))
        || sha256(digestInput) !== evidence.remoteDigest
        || evidence.packageIdentity !== `NaumanTanwir.GuardScan@${event.version}`
        || evidence.provider.repository !== 'microsoft/winget-pkgs'
        || evidence.provider.path !== `manifests/n/NaumanTanwir/GuardScan/${event.version}`
        || !/^[a-f0-9]{40}$/.test(evidence.provider.commit || '')
        || evidence.provider.publicBytesVerified !== publicExact
        || (publicExact
          ? evidence.provider.pullRequest !== null
          : (!Number.isSafeInteger(evidence.provider.pullRequest)
            || evidence.provider.pullRequest < 1))
        || evidence.remoteIdentity !== expectedIdentity) {
      throw new Error(`${event.type} WinGet evidence is not artifact-bound`);
    }
    return;
  }
  const providerKeys = ['pendingStateQuery', 'publicBytesVerified', 'url'].sort();
  const publicExact = evidence.state === 'public-exact';
  const expectedUrl = `https://community.chocolatey.org/api/v2/package/guardscan/${event.version}`;
  const expectedIdentity = publicExact ? expectedUrl : `chocolatey:guardscan@${event.version}`;
  if (Object.keys(evidence.provider).sort().join('\n') !== providerKeys.join('\n')
      || evidence.packageIdentity !== `guardscan@${event.version}`
      || evidence.packageFilename !== `guardscan.${event.version}.nupkg`
      || evidence.provider.url !== expectedUrl
      || evidence.provider.publicBytesVerified !== publicExact
      || evidence.remoteIdentity !== expectedIdentity) {
    throw new Error(`${event.type} Chocolatey evidence is not artifact-bound`);
  }
}

function validateIncidentEvent(event) {
  if (event.type === 'incident_opened') {
    const keys = Object.keys(event.payload).sort();
    const expected = ['incidentId', 'kind', 'summary'];
    if (keys.join('\n') !== expected.join('\n')
        || typeof event.payload.incidentId !== 'string'
        || event.payload.incidentId.length < 1
        || event.payload.incidentId.length > 200
        || !['integrity', 'security', 'availability', 'recovery'].includes(event.payload.kind)
        || typeof event.payload.summary !== 'string'
        || event.payload.summary.length < 1
        || event.payload.summary.length > 2000) {
      throw new Error('incident_opened payload is invalid');
    }
  }
  if (event.type === 'incident_resolved') {
    const keys = Object.keys(event.payload);
    if (keys.length !== 1 || keys[0] !== 'incidentId'
        || typeof event.payload.incidentId !== 'string'
        || event.payload.incidentId.length < 1
        || event.payload.incidentId.length > 200) {
      throw new Error('incident_resolved payload is invalid');
    }
  }
}

function validateRollbackStarted(event) {
  if (event.type !== 'rollback_started') return;
  const stable = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
  const keys = Object.keys(event.payload).sort();
  if (event.payload.mode === 'known-good' || event.payload.mode === undefined) {
    const expected = [
      'forwardFixBranch',
      'forwardFixVersion',
      'knownGoodCommit',
      'knownGoodVersion',
      ...(event.payload.mode === undefined ? [] : ['mode']),
    ].sort();
    if (keys.join('\n') !== expected.join('\n')
        || !stable.test(event.payload.knownGoodVersion || '')
        || !stable.test(event.payload.forwardFixVersion || '')
        || !/^[a-f0-9]{40}$/.test(event.payload.knownGoodCommit || '')
        || typeof event.payload.forwardFixBranch !== 'string'
        || event.payload.forwardFixBranch.length > 200) {
      throw new Error('known-good rollback_started payload is invalid');
    }
    return;
  }
  if (event.payload.mode === 'first-release-withdrawal') {
    const expected = ['mode', 'requiredNextVersion'];
    if (keys.join('\n') !== expected.join('\n')
        || !stable.test(event.payload.requiredNextVersion || '')) {
      throw new Error('first-release rollback_started payload is invalid');
    }
    return;
  }
  throw new Error('rollback_started requires an explicit supported recovery mode');
}

function validateRollbackCompletion(event) {
  if (event.type !== 'rollback_repository_completed') return;
  const stable = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
  const evidence = event.payload;
  if (evidence.schemaVersion !== 'guardscan.rollback-repository-evidence.v1'
      || !stable.test(evidence.defectiveVersion || '')
      || evidence.defectiveVersion !== event.version) {
    throw new Error('rollback repository evidence has invalid release identity');
  }
  assertCanonicalTimestamp(evidence.completedAt, 'rollback repository completion');
  if (evidence.mode === 'known-good') {
    const keys = Object.keys(evidence).sort();
    const expected = [
      'catalog',
      'completedAt',
      'defectiveVersion',
      'forwardFix',
      'knownGoodVersion',
      'mode',
      'schemaVersion',
    ].sort();
    if (keys.join('\n') !== expected.join('\n')
        || !stable.test(evidence.knownGoodVersion || '')
        || !evidence.forwardFix
        || !evidence.catalog) {
      throw new Error('known-good rollback repository evidence is invalid');
    }
    return;
  }
  if (evidence.mode === 'first-release-withdrawal') {
    const keys = Object.keys(evidence).sort();
    const expected = [
      'catalog',
      'completedAt',
      'defectiveVersion',
      'externalActionsPending',
      'mode',
      'requiredNextVersion',
      'schemaVersion',
    ].sort();
    const catalog = evidence.catalog;
    const catalogKeys = Object.keys(catalog || {}).sort();
    const pending = evidence.externalActionsPending;
    if (keys.join('\n') !== expected.join('\n')
        || !stable.test(evidence.requiredNextVersion || '')
        || !Array.isArray(pending)
        || new Set(pending).size !== pending.length
        || pending.join('\n') !== [...pending].sort().join('\n')
        || pending.some(channel => !EXTERNAL_WITHDRAWAL_CHANNELS.has(channel))
        || !catalog
        || catalogKeys.join('\n') !== ['branch', 'commit', 'pullRequest', 'state'].sort().join('\n')
        || !['already-absent', 'removed'].includes(catalog.state)
        || typeof catalog.branch !== 'string'
        || !Number.isSafeInteger(catalog.pullRequest)
        || (catalog.state === 'already-absent' && catalog.pullRequest !== 0)
        || (catalog.state === 'removed' && catalog.pullRequest < 1)
        || !/^[a-f0-9]{40}$/.test(catalog.commit || '')) {
      throw new Error('first-release rollback repository evidence is invalid');
    }
    return;
  }
  throw new Error('rollback repository evidence has an unsupported mode');
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
  validateActionRequired(event);
  validatePublicationEvidence(event);
  validateModerationEvent(event);
  validateIncidentEvent(event);
  validateRollbackStarted(event);
  validateRollbackCompletion(event);
  validateTrainStarted(event);
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
    actionRequired: [],
    promotion: undefined,
    recovery: undefined,
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
      const allowedTransitions = {
        // Publication can be reconciled after a provider has already advanced.
        // Permit the first provider-bound observation, but never reopen terminal states.
        planned: [
          'published', 'submitted', 'accepted', 'verified', 'failed',
          'rejected', 'corrected', 'resubmitted', 'withdrawn',
        ],
        published: ['verified', 'failed', 'withdrawn', 'superseded'],
        submitted: ['published', 'accepted', 'rejected', 'failed', 'withdrawn', 'superseded'],
        accepted: ['verified', 'failed', 'withdrawn', 'superseded'],
        verified: ['failed', 'withdrawn', 'superseded'],
        failed: ['accepted', 'verified', 'withdrawn', 'superseded'],
        rejected: ['corrected', 'withdrawn', 'superseded'],
        corrected: ['resubmitted', 'withdrawn', 'superseded'],
        resubmitted: ['accepted', 'rejected', 'failed', 'withdrawn', 'superseded'],
        withdrawn: [],
        superseded: [],
      };
      if (!allowedTransitions[previous.status]?.includes(status)) {
        throw new Error(`${event.type} cannot move ${event.channel} from ${previous.status} to ${status}`);
      }
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
        ...(event.payload.publication || previous.publication
          ? {publication: event.payload.publication || previous.publication}
          : {}),
        ...(event.payload.submission || previous.submission
          ? {submission: event.payload.submission || previous.submission}
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
    if (event.type === 'rollback_started') {
      if (state.recovery) throw new Error('release recovery cannot be started more than once');
      state.recovery = {
        status: 'started',
        startedAt: event.timestamp,
        ...(event.payload.mode ? event.payload : {mode: 'known-good', ...event.payload}),
      };
    }
    if (event.type === 'rollback_repository_completed') {
      if (!state.recovery) throw new Error('rollback repository completion has no started recovery');
      const providerActionsPending = event.payload.mode === 'first-release-withdrawal'
        && event.payload.externalActionsPending.length > 0;
      state.recovery = {
        ...state.recovery,
        status: providerActionsPending ? 'provider-actions-pending' : 'repository-completed',
        repositoryCompletedAt: event.timestamp,
        evidence: event.payload,
      };
    }
    if (event.type === 'action_required') {
      state.actionRequired.push({
        channel: event.channel,
        action: event.payload.action,
        authority: event.payload.authority,
        reason: event.payload.reason,
        requestedAt: event.timestamp,
      });
    }
  }
  if (state.recovery?.mode === 'first-release-withdrawal'
      && Array.isArray(state.recovery.evidence?.externalActionsPending)) {
    const externalActionsPending = state.recovery.evidence.externalActionsPending.filter(channel => (
      !['withdrawn', 'superseded'].includes(state.channels[channel]?.status)
    ));
    state.recovery.externalActionsPending = externalActionsPending;
    state.recovery.status = externalActionsPending.length > 0
      ? 'provider-actions-pending'
      : 'repository-completed';
  }
  if (!state.manifestSha256) delete state.manifestSha256;
  if (!state.promotion) delete state.promotion;
  if (!state.recovery) delete state.recovery;
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
