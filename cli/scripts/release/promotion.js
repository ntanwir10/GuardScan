'use strict';

const semver = require('semver');
const {CHANNELS, REQUIRED_RC_CHANNELS} = require('./lib');
const {compareUtf8} = require('./deterministic');

const DECISION_SCHEMA = 'guardscan.promotion-decision.v1';
const SOAK_MILLISECONDS = 24 * 60 * 60 * 1000;
const CANARY_INTERVAL_MILLISECONDS = 60 * 60 * 1000;
const DEFAULT_MINIMUM_SAMPLES = 24;
const MAX_CANARY_AGE_MILLISECONDS = 90 * 60 * 1000;

function canonicalTimestamp(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return date;
}

function stableVersion(rcVersion) {
  const parsed = semver.parse(rcVersion);
  if (!parsed || parsed.prerelease[0] !== 'rc' || !Number.isInteger(parsed.prerelease[1])) {
    throw new Error('promotion requires an rc.N semantic version');
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function summarizeCanaries(samples, publishedAt, evaluatedAt, minimumSamples) {
  const normalized = [...samples].sort((a, b) => compareUtf8(a.checkedAt, b.checkedAt));
  const checked = normalized.map(sample => ({
    sample,
    date: canonicalTimestamp(sample.checkedAt, 'canary checkedAt'),
  }));
  const failures = normalized.filter(sample => sample.status !== 'passed');
  const first = checked[0];
  const latest = checked.at(-1);
  const soakBuckets = new Set(checked.flatMap(({date}) => {
    const offset = date.getTime() - publishedAt.getTime();
    if (offset < 0 || offset > SOAK_MILLISECONDS) return [];
    return [Math.max(0, Math.ceil(offset / CANARY_INTERVAL_MILLISECONDS) - 1)];
  }));
  const latestAge = latest ? evaluatedAt.getTime() - latest.date.getTime() : undefined;
  return {
    sampleCount: normalized.length,
    passed: failures.length === 0 && normalized.length >= minimumSamples,
    firstCheckedAt: first?.sample.checkedAt,
    lastCheckedAt: latest?.sample.checkedAt,
    failures: failures.length,
    coversPublication: first ? first.date >= publishedAt : false,
    coversSoak: soakBuckets.size === SOAK_MILLISECONDS / CANARY_INTERVAL_MILLISECONDS,
    fresh: latestAge !== undefined
      && latestAge >= 0
      && latestAge <= MAX_CANARY_AGE_MILLISECONDS,
  };
}

function createPromotionDecision(input) {
  const publishedAt = canonicalTimestamp(input.rc.publishedAt, 'RC publishedAt');
  const evaluatedAt = canonicalTimestamp(input.evaluatedAt, 'promotion evaluatedAt');
  const eligibleAt = new Date(publishedAt.getTime() + SOAK_MILLISECONDS);
  const requestedChannels = input.requiredChannels === undefined
    ? [...REQUIRED_RC_CHANNELS]
    : input.requiredChannels;
  if (!Array.isArray(requestedChannels) || requestedChannels.length === 0) {
    throw new Error('promotion requiredChannels cannot weaken the immutable eight-channel RC floor');
  }
  if (requestedChannels.some(channel => typeof channel !== 'string'
      || !CHANNELS.some(candidate => candidate.id === channel))) {
    throw new Error('promotion requiredChannels contains an unsupported channel');
  }
  const requiredChannels = [...new Set(requestedChannels)].sort(compareUtf8);
  if (requiredChannels.length !== requestedChannels.length
      || REQUIRED_RC_CHANNELS.some(channel => !requiredChannels.includes(channel))) {
    throw new Error('promotion requiredChannels cannot weaken the immutable eight-channel RC floor');
  }
  const minimumSamples = input.minimumSamples === undefined
    ? DEFAULT_MINIMUM_SAMPLES
    : input.minimumSamples;
  if (!Number.isSafeInteger(minimumSamples) || minimumSamples < DEFAULT_MINIMUM_SAMPLES) {
    throw new Error(`promotion minimumSamples cannot be less than ${DEFAULT_MINIMUM_SAMPLES}`);
  }
  const reasons = [];
  if (evaluatedAt < eligibleAt) reasons.push('soak_window_incomplete');
  if (input.rc.sourcePrHead !== input.currentSourcePrHead) reasons.push('source_pr_head_changed');
  if (input.rc.sourcePrBase !== input.currentSourcePrBase) reasons.push('source_pr_base_changed');
  const activeIncidents = (input.incidents || []).filter(incident => incident.status === 'open');
  if (activeIncidents.length > 0) reasons.push('active_release_incident');

  const canaryEvidence = {};
  for (const channel of requiredChannels) {
    const summary = summarizeCanaries(
      (input.canaries || []).filter(sample => sample.channel === channel),
      publishedAt,
      evaluatedAt,
      minimumSamples
    );
    canaryEvidence[channel] = summary;
    if (summary.sampleCount === 0) reasons.push(`canary_missing:${channel}`);
    else {
      if (summary.failures > 0) reasons.push(`canary_failed:${channel}`);
      if (summary.sampleCount < minimumSamples) reasons.push(`canary_samples_insufficient:${channel}`);
      if (!summary.coversPublication) reasons.push(`canary_predates_publication:${channel}`);
      if (!summary.coversSoak) reasons.push(`canary_soak_coverage_incomplete:${channel}`);
      if (!summary.fresh) reasons.push(`canary_stale:${channel}`);
    }
  }

  const version = stableVersion(input.rc.version);
  return {
    schemaVersion: DECISION_SCHEMA,
    rc: {
      version: input.rc.version,
      tag: input.rc.tag,
      commit: input.rc.commit,
      manifestSha256: input.rc.manifestSha256,
      publishedAt: input.rc.publishedAt,
      eligibleAt: eligibleAt.toISOString(),
      sourcePr: input.rc.sourcePr,
      sourcePrHead: input.rc.sourcePrHead,
      sourcePrBase: input.rc.sourcePrBase,
      sourcePrTree: input.rc.sourcePrTree,
    },
    stable: {
      version,
      tag: `v${version}`,
      sourcePr: input.rc.sourcePr,
      sourcePrHead: input.currentSourcePrHead,
      sourcePrBase: input.currentSourcePrBase,
      sourcePrTree: input.rc.sourcePrTree,
    },
    evaluatedAt: input.evaluatedAt,
    policy: {
      soakHours: 24,
      minimumSamplesPerChannel: minimumSamples,
      maximumCanaryAgeMinutes: MAX_CANARY_AGE_MILLISECONDS / 60000,
      requiredChannels,
    },
    canaries: canaryEvidence,
    activeIncidents: activeIncidents.map(incident => ({
      incidentId: incident.incidentId,
      kind: incident.kind,
    })).sort((a, b) => compareUtf8(a.incidentId, b.incidentId)),
    result: reasons.length === 0 ? 'permitted' : 'denied',
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(compareUtf8),
  };
}

module.exports = {
  DECISION_SCHEMA,
  CANARY_INTERVAL_MILLISECONDS,
  DEFAULT_MINIMUM_SAMPLES,
  MAX_CANARY_AGE_MILLISECONDS,
  SOAK_MILLISECONDS,
  createPromotionDecision,
  stableVersion,
};
