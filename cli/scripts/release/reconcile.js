'use strict';

const semver = require('semver');
const {CHANNELS} = require('./lib');

function channelOperation(channel) {
  const definition = CHANNELS.find(candidate => candidate.id === channel);
  if (!definition) throw new Error(`unsupported release channel: ${channel}`);
  return definition.operation;
}

function reconcileRelease(state) {
  const actions = [];
  const blocking = [];
  const openIncidents = Object.entries(state.incidents || {})
    .filter(([, incident]) => incident.status === 'open')
    .map(([incidentId]) => incidentId);
  if (openIncidents.length > 0) blocking.push(`open incidents: ${openIncidents.join(', ')}`);
  for (const [channel, channelState] of Object.entries(state.channels || {})) {
    const operation = channelOperation(channel);
    if (['verified', 'withdrawn', 'superseded'].includes(channelState.status)) continue;
    if (channelState.status === 'failed') {
      blocking.push(`${channel} failed`);
      continue;
    }
    const action = {
      channel,
      currentStatus: channelState.status,
      action: 'verify',
    };
    if (channelState.status === 'planned') {
      action.action = operation === 'verify' ? 'verify' : operation;
    } else if (channelState.status === 'submitted') {
      action.action = 'poll-acceptance';
    } else if (channelState.status === 'accepted') {
      action.action = 'verify-public-install';
    } else if (channelState.status === 'published') {
      action.action = 'verify-remote';
    }
    actions.push(action);
  }
  return {
    complete: actions.length === 0 && blocking.length === 0,
    blocked: blocking.length > 0,
    blocking,
    actions: actions.sort((a, b) => a.channel.localeCompare(b.channel)),
  };
}

function nextPatchVersion(version) {
  const parsed = semver.parse(version);
  if (!parsed) throw new Error('rollback requires a valid semantic version');
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function planRollback(state, knownGoodVersion) {
  if (knownGoodVersion && !semver.valid(knownGoodVersion)) {
    throw new Error('known-good version is invalid');
  }
  const actions = [];
  for (const [channel, channelState] of Object.entries(state.channels || {})) {
    if (!['published', 'submitted', 'accepted', 'verified'].includes(channelState.status)) continue;
    const action = {
      channel,
      currentStatus: channelState.status,
      action: {
        github: 'retain-immutable-and-mark-superseded',
        npm: 'deprecate-and-forward-fix',
        pnpm: 'verify-npm-forward-fix',
        yarn: 'verify-npm-forward-fix',
        bun: 'verify-npm-forward-fix',
        pypi: 'yank-and-forward-fix',
        homebrew: knownGoodVersion ? 'redirect-to-known-good' : 'remove-new-listing',
        scoop: knownGoodVersion ? 'redirect-to-known-good' : 'remove-new-listing',
        winget: 'submit-corrective-manifest',
        chocolatey: 'unlist-or-supersede',
      }[channel],
    };
    actions.push(action);
  }
  return {
    version: state.version,
    knownGoodVersion: knownGoodVersion || null,
    forwardFixVersion: nextPatchVersion(state.version),
    actions: actions.sort((a, b) => a.channel.localeCompare(b.channel)),
  };
}

module.exports = {planRollback, reconcileRelease};
