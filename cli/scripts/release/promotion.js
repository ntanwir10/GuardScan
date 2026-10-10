'use strict';

const semver = require('semver');

const DECISION_SCHEMA = 'guardscan.promotion-decision.v1';
const SOAK_MILLISECONDS = 24 * 60 * 60 * 1000;
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
  const normalized = [...samples].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
  for (const sample of normalized) canonicalTimestamp(sample.checkedAt, 'canary checkedAt');
  const failures = normalized.filter(sample => sample.status !== 'passed');
  const latest = normalized.at(-1);
  return {
    sampleCount: normalized.length,
    passed: failures.length === 0 && normalized.length >= minimumSamples,
    firstCheckedAt: normalized[0]?.checkedAt,
    lastCheckedAt: latest?.checkedAt,
    failures: failures.length,
    coversPublication: normalized[0] ? normalized[0].checkedAt >= publishedAt : false,
    fresh: latest
      ? evaluatedAt.getTime() - new Date(latest.checkedAt).getTime() <= MAX_CANARY_AGE_MILLISECONDS
      : false,
  };
}

function createPromotionDecision(input) {
  const publishedAt = canonicalTimestamp(input.rc.publishedAt, 'RC publishedAt');
  const evaluatedAt = canonicalTimestamp(input.evaluatedAt, 'promotion evaluatedAt');
  const eligibleAt = new Date(publishedAt.getTime() + SOAK_MILLISECONDS);
  const requiredChannels = [...new Set(input.requiredChannels || [
    'npm',
    'pnpm',
    'yarn',
    'bun',
    'github',
    'homebrew',
    'scoop',
    'pypi',
  ])].sort();
  const minimumSamples = input.minimumSamples || DEFAULT_MINIMUM_SAMPLES;
  const reasons = [];
  if (evaluatedAt < eligibleAt) reasons.push('soak_window_incomplete');
  if (input.rc.sourcePrHead !== input.currentSourcePrHead) reasons.push('source_pr_head_changed');
  const activeIncidents = (input.incidents || []).filter(incident => incident.status === 'open');
  if (activeIncidents.length > 0) reasons.push('active_release_incident');

  const canaryEvidence = {};
  for (const channel of requiredChannels) {
    const summary = summarizeCanaries(
      (input.canaries || []).filter(sample => sample.channel === channel),
      input.rc.publishedAt,
      evaluatedAt,
      minimumSamples
    );
    canaryEvidence[channel] = summary;
    if (summary.sampleCount === 0) reasons.push(`canary_missing:${channel}`);
    else {
      if (summary.failures > 0) reasons.push(`canary_failed:${channel}`);
      if (summary.sampleCount < minimumSamples) reasons.push(`canary_samples_insufficient:${channel}`);
      if (!summary.coversPublication) reasons.push(`canary_predates_publication:${channel}`);
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
    },
    stable: {
      version,
      tag: `v${version}`,
      sourcePr: input.rc.sourcePr,
      sourcePrHead: input.currentSourcePrHead,
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
    })).sort((a, b) => a.incidentId.localeCompare(b.incidentId)),
    result: reasons.length === 0 ? 'permitted' : 'denied',
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
  };
}

module.exports = {
  DECISION_SCHEMA,
  DEFAULT_MINIMUM_SAMPLES,
  MAX_CANARY_AGE_MILLISECONDS,
  SOAK_MILLISECONDS,
  createPromotionDecision,
  stableVersion,
};
