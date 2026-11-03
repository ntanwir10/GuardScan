'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const {materializeReleaseState, readEvents} = require('./events');
const {releaseTrainChannels} = require('./lib');
const {reconcileRelease} = require('./reconcile');

const CATALOG_PATHS = Object.freeze([
  'Formula/guardscan.rb',
  'bucket/guardscan.json',
  'channel-lock.json',
]);
const MAX_CONTROL_FILE_BYTES = 1024 * 1024;

function pathExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function readText(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (stat.size > MAX_CONTROL_FILE_BYTES) {
    throw new Error(`${label} exceeds ${MAX_CONTROL_FILE_BYTES} bytes`);
  }
  return fs.readFileSync(file, 'utf8');
}

function readJson(file, label) {
  let value;
  try {
    value = JSON.parse(readText(file, label));
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`);
  }
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertFirstReleaseWithdrawal(ledgerRoot, defectiveVersion, ledgerCommit) {
  if (!semver.valid(defectiveVersion) || semver.prerelease(defectiveVersion) !== null) {
    throw new Error('first-release withdrawal requires a stable defective version');
  }
  if (!/^[a-f0-9]{40}$/.test(ledgerCommit || '')) {
    throw new Error('first-release withdrawal requires the protected ledger commit');
  }
  const root = path.resolve(ledgerRoot);
  const eventsRoot = path.join(root, 'events');
  const defectiveLedger = path.join(eventsRoot, `v${defectiveVersion}.jsonl`);
  if (!pathExists(defectiveLedger)) {
    throw new Error('defective release has no protected ledger');
  }
  const defectiveState = materializeReleaseState(readEvents(defectiveLedger));
  const alreadyCompleted = defectiveState.recovery?.mode === 'first-release-withdrawal'
    && ['repository-completed', 'provider-actions-pending'].includes(
      defectiveState.recovery?.status
    );
  const active = readJson(path.join(root, 'active-versions.json'), 'active release trains');
  const activeTarget = active.trains?.some(train => (
    train?.version === defectiveVersion && train?.channel === 'stable'
  ));
  if (active.schemaVersion !== 'guardscan.active-trains.v1'
      || !Array.isArray(active.trains)
      || (!alreadyCompleted && !activeTarget)
      || (alreadyCompleted && activeTarget)) {
    throw new Error('defective stable release is not an active protected train');
  }
  const selectedChannels = Object.keys(defectiveState.channels).sort();
  const stableChannels = releaseTrainChannels('stable').sort();
  const stableWithCore = releaseTrainChannels('stable', {homebrewCoreEnabled: true}).sort();
  if (![stableChannels, stableWithCore].some(expected => (
    expected.length === selectedChannels.length
      && expected.every((channel, index) => channel === selectedChannels[index])
  ))) {
    throw new Error('defective release ledger is not an exact stable release train');
  }
  if (alreadyCompleted) {
    const evidence = defectiveState.recovery.evidence;
    const pending = evidence?.externalActionsPending;
    if (evidence?.mode !== 'first-release-withdrawal'
        || !evidence.catalog
        || !Array.isArray(pending)
        || new Set(pending).size !== pending.length
        || pending.some(channel => typeof channel !== 'string')
        || pending.join('\n') !== [...pending].sort().join('\n')) {
      throw new Error('completed first-release withdrawal evidence is incomplete');
    }
    const requested = new Set((defectiveState.actionRequired || []).map(item => item.channel));
    for (const [channel, channelState] of Object.entries(defectiveState.channels)) {
      if (pending.includes(channel)) {
        if (!requested.has(channel)) {
          throw new Error(`completed withdrawal has no external action request for ${channel}`);
        }
        continue;
      }
      if (!['withdrawn', 'superseded'].includes(channelState.status)) {
        throw new Error(`completed withdrawal left ${channel} non-terminal`);
      }
    }
  }
  const completed = [];
  for (const name of fs.readdirSync(eventsRoot).sort()) {
    const match = /^v(.+)\.jsonl$/.exec(name);
    if (!match || match[1] === defectiveVersion) continue;
    const version = match[1];
    if (!semver.valid(version)
        || semver.prerelease(version) !== null
        || !semver.lt(version, defectiveVersion)) continue;
    const events = readEvents(path.join(eventsRoot, name));
    if (events.some((_, index) => (
      reconcileRelease(materializeReleaseState(events.slice(0, index + 1))).complete
    ))) {
      completed.push(version);
    }
  }
  if (completed.length > 0) {
    throw new Error(
      `verified stable predecessors exist (${completed.join(', ')}); a known-good rollback is required`
    );
  }
  return {
    schemaVersion: 'guardscan.first-release-withdrawal-authority.v1',
    verified: true,
    defectiveVersion,
    defectiveTag: defectiveState.tag,
    defectiveCommit: defectiveState.commit,
    ledgerCommit,
    priorCompleteStableVersions: [],
    alreadyCompleted,
  };
}

function prepareFirstReleaseCatalogWithdrawal(catalogRoot, defectiveVersion, defectiveCommit) {
  if (!semver.valid(defectiveVersion) || semver.prerelease(defectiveVersion) !== null) {
    throw new Error('catalog withdrawal requires a stable defective version');
  }
  if (!/^[a-f0-9]{40}$/.test(defectiveCommit || '')) {
    throw new Error('catalog withdrawal requires the defective source commit');
  }
  const root = path.resolve(catalogRoot);
  const present = CATALOG_PATHS.filter(relative => pathExists(path.join(root, relative)));
  if (present.length === 0) {
    return {changed: false, state: 'already-absent', removed: []};
  }
  if (present.length !== CATALOG_PATHS.length) {
    throw new Error(`catalog is partial and cannot be withdrawn safely: ${present.join(', ')}`);
  }
  const lock = readJson(path.join(root, 'channel-lock.json'), 'channel catalog lock');
  const formula = readText(path.join(root, 'Formula/guardscan.rb'), 'Homebrew formula');
  const scoopText = readText(path.join(root, 'bucket/guardscan.json'), 'Scoop manifest');
  const scoop = JSON.parse(scoopText);
  const lockFiles = Object.keys(lock.files || {}).sort();
  if (lock.schemaVersion !== 'guardscan.channel-catalog.v1'
      || lock.source?.repository !== 'ntanwir10/GuardScan'
      || lock.source?.version !== defectiveVersion
      || lock.source?.tag !== `v${defectiveVersion}`
      || lock.source?.commit !== defectiveCommit
      || !/^https:\/\//.test(lock.source?.manifestUrl || '')
      || !/^[a-f0-9]{64}$/.test(lock.source?.manifestSha256 || '')
      || lock.generator?.repository !== 'ntanwir10/GuardScan'
      || lock.generator?.commit !== lock.source.commit
      || lockFiles.join('\n') !== CATALOG_PATHS.slice(0, 2).sort().join('\n')
      || lock.files['Formula/guardscan.rb']?.sha256 !== sha256(formula)
      || lock.files['bucket/guardscan.json']?.sha256 !== sha256(scoopText)
      || scoop.version !== defectiveVersion
      || !formula.includes(`  version "${defectiveVersion}"`)) {
    throw new Error('catalog does not exactly identify the defective first release');
  }
  for (const relative of CATALOG_PATHS) fs.unlinkSync(path.join(root, relative));
  return {changed: true, state: 'removed', removed: [...CATALOG_PATHS]};
}

module.exports = {
  CATALOG_PATHS,
  assertFirstReleaseWithdrawal,
  prepareFirstReleaseCatalogWithdrawal,
};
