'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {readBounded} = require('./lib');
const {compareUtf8} = require('./deterministic');

const STATUS_ORDER = Object.freeze({
  planned: 0,
  built: 1,
  tested: 2,
  signed: 3,
  uploaded: 4,
  published: 5,
  verified: 6,
});
const TERMINAL_STATUSES = new Set(['verified', 'skipped']);
const PROMOTION_STATUS = 'published';

function sha256Text(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function manifestDigest(manifestFile) {
  return sha256Text(readBounded(path.resolve(manifestFile), 'manifest'));
}

function normalizeTimestamp(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid ISO timestamp`);
  if (date.toISOString() !== value) throw new Error(`${label} must be a canonical ISO timestamp`);
  return value;
}

function assertApproval(approval, context) {
  if (!approval) throw new Error(`transition to ${PROMOTION_STATUS} requires stable-promotion approval`);
  for (const field of ['version', 'tag', 'commit']) {
    if (approval[field] !== context.state[field]) {
      throw new Error(`approval ${field} does not match release state`);
    }
  }
  if (approval.manifestSha256 !== context.manifestSha256) {
    throw new Error('approval manifestSha256 does not match the exact release manifest');
  }
  if (!approval.channels.includes(context.channel)) {
    throw new Error(`approval does not authorize channel ${context.channel}`);
  }
  const approvedAt = normalizeTimestamp(approval.approvedAt, 'approval approvedAt');
  if (approvedAt > context.timestamp) throw new Error('approval cannot postdate the state transition');
  if (approval.expiresAt) {
    const expiresAt = normalizeTimestamp(approval.expiresAt, 'approval expiresAt');
    if (expiresAt <= approvedAt) throw new Error('approval expiresAt must be after approvedAt');
    if (expiresAt < context.timestamp) throw new Error('stable-promotion approval has expired');
  }
}

function assertTransition(current, target) {
  if (current === target) return;
  if (TERMINAL_STATUSES.has(current)) {
    throw new Error(`cannot transition terminal release status ${current}`);
  }
  if (target === 'failed' || target === 'skipped') return;
  if (!(target in STATUS_ORDER)) throw new Error(`unsupported release status: ${target}`);
  if (current !== 'failed' && STATUS_ORDER[target] <= STATUS_ORDER[current]) {
    throw new Error(`release status cannot move backward from ${current} to ${target}`);
  }
}

function normalizeArtifactIds(value, fallback) {
  const artifactIds = value === undefined ? [...fallback] : [...value];
  if (artifactIds.some(id => typeof id !== 'string' || id.length === 0)) {
    throw new Error('artifactIds must contain non-empty strings');
  }
  if (new Set(artifactIds).size !== artifactIds.length) throw new Error('artifactIds must be unique');
  return artifactIds.sort(compareUtf8);
}

function channelStateMatches(current, next) {
  return current.status === next.status
    && current.updatedAt === next.updatedAt
    && current.remoteIdentity === next.remoteIdentity
    && current.error === next.error
    && [...current.artifactIds].sort(compareUtf8).join('\n') === next.artifactIds.join('\n');
}

function transitionState(state, options) {
  if (state?.schemaVersion === 'guardscan.release-state.v2') {
    throw new Error('legacy mutable-state advance rejects release-state.v2; use append-only release ledger events');
  }
  const channel = options.channel;
  const current = state.channels[channel];
  if (!current) throw new Error(`release state does not contain channel ${channel}`);
  if (!options.expectedStatus) throw new Error('an expected current status is required');
  const timestamp = normalizeTimestamp(options.timestamp, 'transition timestamp');
  const manifestSha256 = options.manifestSha256;
  if (!/^[a-f0-9]{64}$/.test(manifestSha256 || '')) throw new Error('manifestSha256 is invalid');
  if (state.manifestSha256 && state.manifestSha256 !== manifestSha256) {
    throw new Error('release state is bound to a different manifest');
  }

  const artifactIds = normalizeArtifactIds(options.artifactIds, current.artifactIds);
  const target = options.targetStatus;
  const nextChannel = {status: target, artifactIds, updatedAt: timestamp};
  if (target === 'failed') {
    if (!options.error) throw new Error('failed release status requires an error');
    nextChannel.error = options.error;
  } else if (options.error) {
    throw new Error('error is valid only for failed release status');
  }
  if (['uploaded', 'published', 'verified'].includes(target)) {
    if (!options.remoteIdentity) throw new Error(`${target} release status requires a remote identity`);
    if (artifactIds.length === 0) throw new Error(`${target} release status requires at least one artifact`);
    nextChannel.remoteIdentity = options.remoteIdentity;
  } else if (options.remoteIdentity) {
    throw new Error(`remote identity is not valid for ${target} release status`);
  }

  if (target === PROMOTION_STATUS) {
    assertApproval(options.approval, {channel, manifestSha256, state, timestamp});
  }
  const unchanged = current.status === target
    && channelStateMatches(current, nextChannel)
    && state.manifestSha256 === manifestSha256;
  if (unchanged) return {changed: false, state};
  if (current.status !== options.expectedStatus) {
    throw new Error(`channel ${channel} is ${current.status}, expected ${options.expectedStatus}`);
  }
  assertTransition(current.status, target);
  if (timestamp < state.updatedAt || timestamp < current.updatedAt) {
    throw new Error('transition timestamp cannot precede existing release state');
  }
  return {
    changed: true,
    state: {
      ...state,
      manifestSha256,
      updatedAt: timestamp,
      channels: {...state.channels, [channel]: nextChannel},
    },
  };
}

function writeStateTransition(stateFile, originalState, nextState) {
  const resolved = path.resolve(stateFile);
  const originalText = readBounded(resolved, 'release state');
  if (sha256Text(originalText) !== sha256Text(`${JSON.stringify(originalState, null, 2)}\n`)
      && JSON.stringify(JSON.parse(originalText)) !== JSON.stringify(originalState)) {
    throw new Error('release state changed after validation');
  }
  const lockFile = `${resolved}.lock`;
  const token = crypto.randomUUID();
  let lockDescriptor;
  let stage;
  try {
    try {
      lockDescriptor = fs.openSync(lockFile, 'wx', 0o600);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`release state is locked by another transition: ${lockFile}`);
      }
      throw error;
    }
    fs.writeFileSync(lockDescriptor, `${token}\n`, 'utf8');
    const currentText = readBounded(resolved, 'release state');
    if (sha256Text(currentText) !== sha256Text(originalText)) {
      throw new Error('release state changed concurrently');
    }
    stage = `${resolved}.tmp-${process.pid}-${token}`;
    fs.writeFileSync(stage, `${JSON.stringify(nextState, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(stage, resolved);
  } finally {
    if (lockDescriptor !== undefined) fs.closeSync(lockDescriptor);
    if (stage) fs.rmSync(stage, {force: true});
    try {
      if (fs.readFileSync(lockFile, 'utf8') === `${token}\n`) fs.unlinkSync(lockFile);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

module.exports = {
  PROMOTION_STATUS,
  STATUS_ORDER,
  manifestDigest,
  transitionState,
  writeStateTransition,
};
