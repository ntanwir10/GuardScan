'use strict';

const crypto = require('crypto');
const {CHANNELS} = require('./lib');
const {compareUtf8} = require('./deterministic');
const {
  appendEvent,
  canonicalJson,
  materializeReleaseState,
  readEvents,
} = require('./events');

const CANARY_REPORT_SCHEMA = 'guardscan.canary-report.v1';
const MAX_CANARY_AGE_MILLISECONDS = 90 * 60 * 1000;
const REQUIRED_CANARY_FIELDS = Object.freeze([
  'channel', 'checkedAt', 'evidenceUrl', 'status', 'target', 'version',
]);
const CANARY_STATUSES = new Set(['passed', 'failed']);
const SUPPORTED_CHANNELS = new Set(CHANNELS.map(channel => channel.id));

// These are the immutable RC verification targets. Callers may add supported
// targets, but may not omit any of these channels when recording a train.
const DEFAULT_RC_CANARY_TARGETS = Object.freeze({
  npm: Object.freeze(['npm']),
  pnpm: Object.freeze(['pnpm']),
  yarn: Object.freeze(['yarn-classic', 'yarn-modern']),
  bun: Object.freeze(['bun']),
  github: Object.freeze([
    'linux-x64-glibc', 'linux-arm64-glibc', 'darwin-arm64', 'darwin-x64', 'windows-x64',
  ]),
  homebrew: Object.freeze(['Linux', 'macOS']),
  scoop: Object.freeze(['Windows']),
  pypi: Object.freeze([
    'linux-x64', 'linux-arm64', 'darwin-arm64', 'darwin-x64', 'windows-x64',
  ]),
});

function canonicalTimestamp(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return date;
}

function issueId(version, issue) {
  return `canary-${version}-${crypto.createHash('sha256').update(canonicalJson(issue)).digest('hex').slice(0, 32)}`;
}

function expectedTargetMap(value) {
  const input = value === undefined ? DEFAULT_RC_CANARY_TARGETS : value;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('expectedTargets must be an object mapping channels to target lists');
  }
  const result = {};
  for (const [channel, targets] of Object.entries(input)) {
    if (!SUPPORTED_CHANNELS.has(channel)) throw new Error(`unsupported canary channel: ${channel}`);
    if (!Array.isArray(targets) || targets.length < 1
        || targets.some(target => typeof target !== 'string' || target.length < 1)
        || new Set(targets).size !== targets.length) {
      throw new Error(`expected canary targets for ${channel} must be unique non-empty strings`);
    }
    result[channel] = [...targets].sort(compareUtf8);
  }
  if (Object.keys(result).length < 1) throw new Error('expectedTargets must select at least one channel');
  for (const [channel, targets] of Object.entries(DEFAULT_RC_CANARY_TARGETS)) {
    if (!result[channel] || targets.some(target => !result[channel].includes(target))) {
      throw new Error(`expectedTargets cannot weaken the immutable RC target floor for ${channel}`);
    }
  }
  return result;
}

function validateReport(report, expectedVersion, expectedTargets, evaluatedAt, maxAge) {
  const errors = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return ['report must be an object'];
  }
  const keys = Object.keys(report).sort(compareUtf8);
  if (keys.join('\n') !== REQUIRED_CANARY_FIELDS.slice().sort(compareUtf8).join('\n')) {
    errors.push('report fields must be exactly version, channel, target, status, checkedAt, and evidenceUrl');
  }
  if (report.version !== expectedVersion) errors.push('report version does not match the release train');
  if (!SUPPORTED_CHANNELS.has(report.channel)) errors.push('report channel is unsupported');
  if (!expectedTargets[report.channel]?.includes(report.target)) {
    errors.push('report target is not expected for its channel');
  }
  if (!CANARY_STATUSES.has(report.status)) errors.push('report status must be passed or failed');
  let checkedAt;
  try {
    checkedAt = canonicalTimestamp(report.checkedAt, 'canary report checkedAt');
  } catch (error) {
    errors.push(error.message);
  }
  if (typeof report.evidenceUrl !== 'string' || !/^https:\/\/[^\s]+$/.test(report.evidenceUrl)) {
    errors.push('report evidenceUrl must be an absolute HTTPS URL');
  }
  if (checkedAt) {
    const age = evaluatedAt.getTime() - checkedAt.getTime();
    if (age < 0) errors.push('report checkedAt is in the future');
    if (age > maxAge) errors.push('report is stale');
  }
  return errors;
}

function appendIncident(ledgerFile, state, evaluatedAt, issue, summary) {
  const baseIncidentId = issueId(state.version, issue);
  if (state.incidents?.[baseIncidentId]?.status === 'open') {
    const existing = readEvents(ledgerFile).find(event => (
      event.type === 'incident_opened'
      && event.payload.incidentId === baseIncidentId
    ));
    if (!existing) throw new Error(`open canary incident has no ledger event: ${baseIncidentId}`);
    return {changed: false, event: existing};
  }
  const incidentId = state.incidents?.[baseIncidentId]?.status === 'resolved'
    ? issueId(state.version, {issue, reopenedAt: evaluatedAt.toISOString()})
    : baseIncidentId;
  return appendEvent(ledgerFile, {
    version: state.version,
    tag: state.tag,
    commit: state.commit,
    timestamp: evaluatedAt.toISOString(),
    type: 'incident_opened',
    idempotencyKey: `canary-incident:${incidentId}`,
    payload: {incidentId, kind: 'availability', summary},
  });
}

function normalizeInput(input, reports, expectedTargets, evaluatedAt) {
  if (typeof input === 'string') {
    return {ledgerFile: input, reports, expectedTargets, evaluatedAt};
  }
  return input || {};
}

function recordCanary(input, reports, expectedTargets, evaluatedAt) {
  const options = normalizeInput(input, reports, expectedTargets, evaluatedAt);
  if (!options.ledgerFile) throw new Error('recordCanary requires ledgerFile');
  const events = readEvents(options.ledgerFile);
  if (events.length === 0) throw new Error('recordCanary requires a non-empty release ledger');
  const initialState = materializeReleaseState(events);
  const evaluated = canonicalTimestamp(options.evaluatedAt, 'canary evaluation timestamp');
  const maxAge = options.maxAgeMilliseconds === undefined
    ? MAX_CANARY_AGE_MILLISECONDS
    : options.maxAgeMilliseconds;
  if (!Number.isSafeInteger(maxAge) || maxAge < 0) throw new Error('maxAgeMilliseconds must be a non-negative integer');

  let expected;
  const failures = [];
  try {
    expected = expectedTargetMap(options.expectedTargets);
  } catch (error) {
    failures.push({index: -1, reason: error.message});
    const incident = appendIncident(options.ledgerFile, initialState, evaluated,
      {type: 'invalid-target-map', expectedTargets: options.expectedTargets}, error.message);
    return {changed: incident.changed, recorded: [], failures, incidents: [incident.event]};
  }
  const reportList = Array.isArray(options.reports) ? options.reports : [];
  for (const channel of Object.keys(expected)) {
    if (!initialState.channels[channel]) failures.push({channel, reason: 'channel is not selected in the release train'});
  }
  for (const [channel, targets] of Object.entries(expected)) {
    for (const target of targets) {
      const matches = reportList.filter(report => report?.channel === channel && report?.target === target);
      if (matches.length === 0) failures.push({channel, target, reason: 'missing expected report'});
    }
  }
  const seen = new Map();
  const validReports = [];
  const observedFailures = [];
  const existingKeys = new Set(events.map(event => event.idempotencyKey));
  for (let index = 0; index < reportList.length; index += 1) {
    const report = reportList[index];
    const reportErrors = validateReport(report, initialState.version, expected, evaluated, maxAge);
    const identity = report && typeof report === 'object'
      ? `${report.channel || 'unknown'}:${report.target || 'unknown'}`
      : `index:${index}`;
    if (seen.has(identity)) reportErrors.push('duplicate report for the same channel and target');
    seen.set(identity, true);
    if (reportErrors.length > 0) {
      failures.push({index, channel: report?.channel, target: report?.target, reason: reportErrors.join('; ')});
    } else {
      const key = `canary:${initialState.version}:${report.channel}:${report.target}:${report.checkedAt}`;
      if (!existingKeys.has(key)) validReports.push({report, key});
      if (report.status === 'failed') {
        observedFailures.push({index, channel: report.channel, target: report.target, reason: 'canary report status is failed'});
      }
    }
  }
  const expectedCount = Object.values(expected).reduce((count, targets) => count + targets.length, 0);
  if (reportList.length !== expectedCount) failures.push({reason: 'report set does not contain exactly one report per expected target'});

  const incidents = [];
  let changed = false;
  if (failures.length > 0) {
    const incident = appendIncident(options.ledgerFile, initialState, evaluated,
      {type: 'invalid-report-set', failures},
      `Canary report set rejected: ${failures.map(failure => failure.reason).join(' | ')}`.slice(0, 2000));
    changed ||= incident.changed;
    incidents.push(incident.event);
    return {changed, recorded: [], failures, incidents};
  }

  const recorded = [];
  for (const {report, key} of validReports) {
    const result = appendEvent(options.ledgerFile, {
      version: initialState.version,
      tag: initialState.tag,
      commit: initialState.commit,
      timestamp: report.checkedAt,
      type: 'canary_recorded',
      idempotencyKey: key,
      channel: report.channel,
      payload: {
        status: report.status,
        target: report.target,
        evidenceUrl: report.evidenceUrl,
      },
    });
    changed ||= result.changed;
    recorded.push(result.event);
    if (report.status === 'failed') {
      const failedState = materializeReleaseState(readEvents(options.ledgerFile));
      const current = failedState.channels[report.channel];
      if (current && !['failed', 'withdrawn', 'superseded'].includes(current.status)) {
        const failureEvent = appendEvent(options.ledgerFile, {
          version: failedState.version,
          tag: failedState.tag,
          commit: failedState.commit,
          timestamp: evaluated.toISOString(),
          type: 'channel_failed',
          idempotencyKey: `canary-failed:${failedState.version}:${report.channel}:${report.target}:${report.checkedAt}`,
          channel: report.channel,
          payload: {error: `canary failed for target ${report.target}`},
        });
        changed ||= failureEvent.changed;
      }
      const incident = appendIncident(options.ledgerFile, initialState, evaluated,
        {type: 'failed-report', channel: report.channel, target: report.target, checkedAt: report.checkedAt},
        `Canary failed for ${report.channel}/${report.target} at ${report.checkedAt}`);
      changed ||= incident.changed;
      incidents.push(incident.event);
    }
  }

  let currentEvents = readEvents(options.ledgerFile);
  for (const channel of Object.keys(expected)) {
    const channelReports = reportList.filter(report => report.channel === channel);
    if (channelReports.some(report => report.status !== 'passed')) continue;
    const state = materializeReleaseState(currentEvents);
    const current = state.channels[channel];
    if (!current || ['verified', 'withdrawn', 'superseded'].includes(current.status)) continue;
    const latestCheckedAt = channelReports.map(report => report.checkedAt).sort(compareUtf8).at(-1);
    const result = appendEvent(options.ledgerFile, {
      version: state.version,
      tag: state.tag,
      commit: state.commit,
      timestamp: evaluated.toISOString(),
      type: 'channel_verified',
      idempotencyKey: `canary-verified:${state.version}:${channel}:${latestCheckedAt}`,
      channel,
      payload: {},
    });
    changed ||= result.changed;
    currentEvents = readEvents(options.ledgerFile);
  }
  return {changed, recorded, failures: observedFailures, incidents};
}

module.exports = {
  CANARY_REPORT_SCHEMA,
  CANARY_STATUSES,
  DEFAULT_RC_CANARY_TARGETS,
  MAX_CANARY_AGE_MILLISECONDS,
  recordCanary,
  validateReport,
};
