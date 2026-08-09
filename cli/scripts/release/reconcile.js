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
  const optionalBlocking = [];
  const openIncidents = Object.entries(state.incidents || {})
    .filter(([, incident]) => incident.status === 'open')
    .map(([incidentId]) => incidentId);
  if (openIncidents.length > 0) blocking.push(`open incidents: ${openIncidents.join(', ')}`);
  for (const [channel, channelState] of Object.entries(state.channels || {})) {
    const definition = CHANNELS.find(candidate => candidate.id === channel);
    const operation = channelOperation(channel);
    const required = definition.required !== false;
    if (['verified', 'withdrawn', 'superseded'].includes(channelState.status)) continue;
    if (channelState.status === 'failed') {
      (required ? blocking : optionalBlocking).push(`${channel} failed`);
      continue;
    }
    const action = {
      channel,
      required,
      currentStatus: channelState.status,
      action: 'verify',
    };
    if (channelState.status === 'planned') {
      action.action = operation === 'verify' ? 'verify' : operation;
    } else if (channelState.status === 'submitted') {
      action.action = 'poll-acceptance';
    } else if (channelState.status === 'rejected') {
      action.action = 'prepare-correction';
    } else if (channelState.status === 'corrected') {
      action.action = 'resubmit-correction';
    } else if (channelState.status === 'resubmitted') {
      action.action = 'poll-resubmission';
    } else if (channelState.status === 'accepted') {
      action.action = 'verify-public-install';
    } else if (channelState.status === 'published') {
      action.action = 'verify-remote';
    }
    actions.push(action);
  }
  return {
    complete: actions.every(action => action.required === false) && blocking.length === 0,
    blocked: blocking.length > 0,
    blocking,
    optionalBlocking,
    actions: actions.sort((a, b) => a.channel.localeCompare(b.channel)),
  };
}

function nextPatchVersion(version) {
  const parsed = semver.parse(version);
  if (!parsed) throw new Error('rollback requires a valid semantic version');
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function planRollback(state, knownGoodVersion, knownGoodCommit) {
  if (!knownGoodVersion) throw new Error('a verified known-good version is required');
  if (!semver.valid(knownGoodVersion) || semver.prerelease(knownGoodVersion) !== null) {
    throw new Error('known-good version is invalid');
  }
  if (!knownGoodCommit) throw new Error('known-good commit is required');
  if (!/^[a-f0-9]{40}$/.test(knownGoodCommit)) throw new Error('known-good commit is invalid');
  if (!semver.lt(knownGoodVersion, state.version)) {
    throw new Error('known-good version must precede the defective release');
  }
  const forwardFixVersion = nextPatchVersion(state.version);
  const forwardFixBranch = `release/forward-fix-v${forwardFixVersion}-from-v${knownGoodVersion}`;
  const externalAuthority = {
    npm: 'npm-maintainer',
    pypi: 'pypi-maintainer',
    'homebrew-core': 'homebrew-core-maintainer',
    winget: 'winget-maintainer',
    chocolatey: 'chocolatey-maintainer',
  };
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
        homebrew: 'redirect-to-known-good',
        'homebrew-core': 'submit-corrective-formula-or-revision',
        scoop: 'redirect-to-known-good',
        winget: 'submit-corrective-manifest',
        chocolatey: 'unlist-or-supersede',
      }[channel],
      automation: externalAuthority[channel]
        ? 'external-action-required'
        : 'repository-automated',
      ...(externalAuthority[channel] ? {authority: externalAuthority[channel]} : {}),
    };
    actions.push(action);
  }
  return {
    schemaVersion: 'guardscan.rollback-plan.v1',
    mode: 'known-good',
    version: state.version,
    tag: state.tag,
    commit: state.commit,
    status: 'planned',
    knownGood: {
      version: knownGoodVersion,
      tag: `v${knownGoodVersion}`,
      commit: knownGoodCommit,
    },
    knownGoodVersion,
    knownGoodCommit,
    forwardFixVersion,
    forwardFixBranch,
    repositoryActions: [
      {id: 'deactivate-train', action: 'remove-from-active-versions', status: 'planned'},
      {id: 'forward-fix-pr', action: 'open-or-update-pull-request', status: 'planned'},
      {id: 'shared-catalog-rollback', action: 'open-or-update-catalog-pull-request', status: 'planned'},
    ],
    actions: actions.sort((a, b) => a.channel.localeCompare(b.channel)),
  };
}

function planFirstReleaseWithdrawal(state, authority) {
  if (!semver.valid(state.version) || semver.prerelease(state.version) !== null) {
    throw new Error('first-release withdrawal requires a stable defective release');
  }
  if (authority?.schemaVersion !== 'guardscan.first-release-withdrawal-authority.v1'
      || authority.verified !== true
      || authority.defectiveVersion !== state.version
      || authority.defectiveTag !== state.tag
      || authority.defectiveCommit !== state.commit
      || !/^[a-f0-9]{40}$/.test(authority.ledgerCommit || '')
      || !Array.isArray(authority.priorCompleteStableVersions)
      || authority.priorCompleteStableVersions.length !== 0) {
    throw new Error('first-release withdrawal requires exact protected-ledger authority');
  }
  const externalAuthority = {
    npm: 'npm-maintainer',
    pypi: 'pypi-maintainer',
    'homebrew-core': 'homebrew-core-maintainer',
    winget: 'winget-maintainer',
    chocolatey: 'chocolatey-maintainer',
  };
  const actionByChannel = {
    github: 'retain-immutable-and-mark-superseded',
    npm: 'deprecate-defective-release',
    pnpm: 'mark-defective-npm-consumer-superseded',
    yarn: 'mark-defective-npm-consumer-superseded',
    bun: 'mark-defective-npm-consumer-superseded',
    pypi: 'yank-defective-release',
    homebrew: 'remove-first-release-listing',
    'homebrew-core': 'submit-removal-or-revision',
    scoop: 'remove-first-release-listing',
    winget: 'submit-removal-or-corrective-manifest',
    chocolatey: 'unlist-defective-release',
  };
  const actions = [];
  for (const [channel, channelState] of Object.entries(state.channels || {})) {
    if (channelState.status === 'planned') {
      actions.push({
        channel,
        currentStatus: channelState.status,
        action: 'confirm-unpublished-and-cancel',
        automation: 'repository-automated',
      });
      continue;
    }
    if (['withdrawn', 'superseded'].includes(channelState.status)) continue;
    actions.push({
      channel,
      currentStatus: channelState.status,
      action: actionByChannel[channel],
      automation: externalAuthority[channel]
        ? 'external-action-required'
        : 'repository-automated',
      ...(externalAuthority[channel] ? {authority: externalAuthority[channel]} : {}),
    });
  }
  return {
    schemaVersion: 'guardscan.rollback-plan.v1',
    mode: 'first-release-withdrawal',
    version: state.version,
    tag: state.tag,
    commit: state.commit,
    status: 'planned',
    requiredNextVersion: nextPatchVersion(state.version),
    authority: {
      ledgerCommit: authority.ledgerCommit,
      priorCompleteStableVersions: [],
    },
    repositoryActions: [
      {id: 'open-recovery-incident', action: 'retain-open-incident', status: 'planned'},
      {id: 'shared-catalog-withdrawal', action: 'remove-first-release-listing', status: 'planned'},
      {id: 'deactivate-train', action: 'remove-from-active-versions', status: 'planned'},
    ],
    actions: actions.sort((a, b) => a.channel.localeCompare(b.channel)),
  };
}

module.exports = {planFirstReleaseWithdrawal, planRollback, reconcileRelease};
