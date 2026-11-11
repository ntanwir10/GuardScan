'use strict';

const {execFileSync} = require('child_process');
const {REQUIRED_RC_CHANNELS} = require('./lib');
const {MAX_LEDGER_BYTES, materializeReleaseState, parseLedgerText} = require('./events');
const {
  DEFAULT_MINIMUM_SAMPLES,
  MAX_CANARY_AGE_MILLISECONDS,
  SOAK_MILLISECONDS,
  summarizeCanaries,
} = require('./promotion');

// Keep sampling this long past eligibility so reconcile can promote on a fresh sample.
const SOAK_MARGIN_MILLISECONDS = 3 * 60 * 60 * 1000;
// Canary runs take about 2 minutes, so this gives ~47-minute gaps against the 90-minute limit.
const NEXT_CANARY_DELAY_MILLISECONDS = 45 * 60 * 1000;
const RC_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-rc\.(0|[1-9][0-9]*)$/;

function soakStatus({events, state}, now) {
  const published = events.find(event => event.type === 'channel_published' && event.channel === 'github');
  if (!published) return {stop: 'unpublished'};
  if (events.some(event => event.type === 'promotion_decided')) return {stop: 'promotion_decided'};
  const publishedAt = new Date(published.timestamp);
  const eligibleAt = new Date(publishedAt.getTime() + SOAK_MILLISECONDS);
  if (now < publishedAt || now.getTime() >= eligibleAt.getTime() + SOAK_MARGIN_MILLISECONDS) {
    return {stop: 'outside_soak_window'};
  }
  let oldestLatest = now.getTime();
  for (const channel of REQUIRED_RC_CHANNELS) {
    const summary = summarizeCanaries(state.canaries[channel] || [], published.timestamp,
      eligibleAt, now, DEFAULT_MINIMUM_SAMPLES);
    // A failure, late start, gap, or stale sample denies promotion for good, so stop sampling.
    const canPass = summary.failures === 0 && (summary.lastCheckedAt === undefined
      ? now.getTime() - publishedAt.getTime() <= MAX_CANARY_AGE_MILLISECONDS
      : summary.coversPublication && summary.startsNearPublication && summary.coversSoak && summary.fresh);
    if (!canPass) return {stop: `unrecoverable:${channel}`};
    oldestLatest = Math.min(oldestLatest, Date.parse(summary.lastCheckedAt ?? published.timestamp));
  }
  return {reconcile: now >= eligibleAt, oldestLatest};
}

// Decides from protected ledger state alone whether the soak chain dispatches another canary.
function planSoak(active, ledgers, now) {
  if (active?.schemaVersion !== 'guardscan.active-trains.v1' || !Array.isArray(active.trains)) {
    throw new Error('active train index is invalid');
  }
  const soaking = [];
  const stopped = [];
  for (const train of active.trains.filter(value => value?.channel === 'rc')) {
    if (!RC_VERSION.test(train.version || '') || !Number.isSafeInteger(train.releasePr)
        || train.releasePr < 1 || !/^[a-f0-9]{40}$/.test(train.sourcePrHead || '')) {
      throw new Error('active RC train metadata is invalid');
    }
    const ledger = ledgers[train.version];
    if (ledger?.state?.version !== train.version) {
      throw new Error(`active RC train ${train.version} has no matching release ledger`);
    }
    const status = soakStatus(ledger, now);
    if (status.stop) stopped.push({version: train.version, reason: status.stop});
    else soaking.push({train, ...status});
  }
  const nextCanaryAt = Math.min(...soaking.map(value => value.oldestLatest)) + NEXT_CANARY_DELAY_MILLISECONDS;
  return {
    continue: soaking.length > 0,
    sleepSeconds: soaking.length === 0 ? 0 : Math.ceil(Math.max(0, nextCanaryAt - now.getTime()) / 1000),
    reconcile: soaking.filter(value => value.reconcile).map(({train}) => ({
      version: train.version, releasePr: train.releasePr, sourcePrHead: train.sourcePrHead,
    })),
    stopped,
  };
}

if (require.main === module) {
  const ref = process.argv[2];
  if (!/^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(ref || '')) throw new Error('soak planning needs a ledger git ref');
  const show = file => execFileSync('git', ['show', `${ref}:${file}`], {encoding: 'utf8', maxBuffer: MAX_LEDGER_BYTES});
  const active = JSON.parse(show('active-versions.json'));
  const ledgers = {};
  for (const train of active.trains || []) {
    if (train?.channel !== 'rc' || !RC_VERSION.test(train.version || '')) continue;
    const events = parseLedgerText(show(`events/v${train.version}.jsonl`));
    ledgers[train.version] = {events, state: materializeReleaseState(events)};
  }
  const plan = planSoak(active, ledgers, new Date());
  for (const {version, reason} of plan.stopped) process.stderr.write(`${version}: soak chain stopped (${reason})\n`);
  process.stdout.write(`continue=${plan.continue}\nsleep_seconds=${plan.sleepSeconds}\n`
    + `reconcile=${JSON.stringify(plan.reconcile)}\n`);
}

module.exports = {
  NEXT_CANARY_DELAY_MILLISECONDS,
  SOAK_MARGIN_MILLISECONDS,
  planSoak,
};
