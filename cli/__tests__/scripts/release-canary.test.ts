import fs from 'fs';
import os from 'os';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const {
  appendEvent,
  materializeReleaseState,
  readEvents,
} = require('../../scripts/release/events') as Record<string, any>;
const {
  recordCanary,
  DEFAULT_RC_CANARY_TARGETS,
} = require('../../scripts/release/canary') as Record<string, any>;
const {reconcileRelease} = require('../../scripts/release/reconcile') as Record<string, any>;
const {createPromotionDecision} = require('../../scripts/release/promotion') as Record<string, any>;
const {transitionState} = require('../../scripts/release/ledger') as Record<string, any>;
const {main} = require('../../scripts/release/index') as Record<string, any>;

const VERSION = '1.2.3-rc.1';
const TAG = `v${VERSION}`;
const COMMIT = 'a'.repeat(40);
const STARTED_AT = '2026-08-19T12:00:00.000Z';
const EVALUATED_AT = '2026-08-19T13:00:00.000Z';

function withLedger(callback: (ledger: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-canary-'));
  const ledger = path.join(root, 'events.ndjson');
  appendEvent(ledger, {
    type: 'train_started',
    version: VERSION,
    tag: TAG,
    commit: COMMIT,
    timestamp: STARTED_AT,
    idempotencyKey: 'train-started',
    payload: {channels: Object.keys(DEFAULT_RC_CANARY_TARGETS)},
  });
  try {
    callback(ledger);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

function reports(status = 'passed'): Array<Record<string, string>> {
  return Object.entries(DEFAULT_RC_CANARY_TARGETS).flatMap(([channel, targets]) =>
    (targets as string[]).map(target => ({
      version: VERSION,
      channel,
      target,
      status,
      checkedAt: EVALUATED_AT,
      evidenceUrl: `https://example.test/${channel}/${target}`,
    }))
  );
}

function promotionInput(overrides: Record<string, any> = {}): Record<string, any> {
  const channels = ['npm', 'pnpm', 'yarn', 'bun', 'github', 'homebrew', 'scoop', 'pypi'];
  const samples = channels.flatMap(channel => Array.from({length: 24}, (_, index) => ({
    channel,
    status: 'passed',
    checkedAt: new Date(Date.parse('2026-08-01T00:00:00.000Z')
      + (index + 1) * 60 * 60 * 1000).toISOString(),
  })));
  return {
    rc: {
      version: VERSION,
      tag: TAG,
      commit: COMMIT,
      manifestSha256: 'b'.repeat(64),
      publishedAt: '2026-08-01T00:00:00.000Z',
      sourcePr: 33,
      sourcePrHead: COMMIT,
      sourcePrBase: 'c'.repeat(40),
      sourcePrTree: 'd'.repeat(40),
    },
    currentSourcePrHead: COMMIT,
    currentSourcePrBase: 'c'.repeat(40),
    evaluatedAt: '2026-08-02T00:00:00.000Z',
    canaries: samples,
    ...overrides,
  };
}

describe('release canary public seams', () => {
  test('schemas require report identity and the immutable promotion floor', () => {
    const ajv = new Ajv({allErrors: true, strict: true});
    addFormats(ajv);
    const reportSchema = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../schemas/guardscan.canary-report.v1.schema.json'), 'utf8'
    ));
    const promotionSchema = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../schemas/guardscan.promotion-decision.v1.schema.json'), 'utf8'
    ));
    const validateReport = ajv.compile(reportSchema);
    const validatePromotion = ajv.compile(promotionSchema);
    expect(validateReport(reports()[0])).toBe(true);
    expect(validateReport({...reports()[0], target: undefined})).toBe(false);
    expect(validateReport({...reports()[0], evidenceUrl: 'http://example.test/evidence'})).toBe(false);
    const policy = {
      soakHours: 24,
      minimumSamplesPerChannel: 24,
      maximumCanaryAgeMinutes: 90,
      requiredChannels: ['npm', 'pnpm', 'yarn', 'bun', 'github', 'homebrew', 'scoop', 'pypi'],
    };
    const decision = createPromotionDecision(promotionInput());
    expect(validatePromotion(decision)).toBe(true);
    decision.policy = policy;
    decision.policy.requiredChannels = [];
    expect(validatePromotion(decision)).toBe(false);
  });

  test('records exactly one report per target and idempotently verifies every channel', () => {
    withLedger(ledger => {
      const first = recordCanary({
        ledgerFile: ledger,
        reports: reports(),
        expectedTargets: DEFAULT_RC_CANARY_TARGETS,
        evaluatedAt: EVALUATED_AT,
      });
      expect(first.failures).toEqual([]);
      const firstEvents = readEvents(ledger);
      expect(firstEvents.filter((event: any) => event.type === 'channel_verified')).toHaveLength(8);
      expect(Object.values(materializeReleaseState(firstEvents).channels)
        .every((channel: any) => channel.status === 'verified')).toBe(true);

      const second = recordCanary({
        ledgerFile: ledger,
        reports: reports(),
        expectedTargets: DEFAULT_RC_CANARY_TARGETS,
        evaluatedAt: EVALUATED_AT,
      });
      expect(second.changed).toBe(false);
      const secondEvents = readEvents(ledger);
      expect(secondEvents).toHaveLength(firstEvents.length);
      expect(secondEvents.filter((event: any) => event.type === 'channel_verified')).toHaveLength(8);
    });
  });

  test.each([
    {},
    {npm: ['npm']},
    {...DEFAULT_RC_CANARY_TARGETS, homebrew: ['Linux']},
  ])('rejects a canary target map that weakens the immutable target floor: %j', expectedTargets => {
    withLedger(ledger => {
      const result = recordCanary({
        ledgerFile: ledger,
        reports: [],
        expectedTargets,
        evaluatedAt: EVALUATED_AT,
      });
      expect(result.failures.map((failure: any) => failure.reason).join(' ')).toMatch(/select|immutable|floor|required/i);
      expect(result.incidents).toHaveLength(1);
    });
  });

  test('record-canary CLI uses the ledger identity and emits a machine-readable result', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-canary-cli-'));
    const ledger = path.join(root, 'events.ndjson');
    const reportsFile = path.join(root, 'reports.json');
    appendEvent(ledger, {
      type: 'train_started',
      version: VERSION,
      tag: TAG,
      commit: COMMIT,
      timestamp: STARTED_AT,
      idempotencyKey: 'train-started',
      payload: {channels: Object.keys(DEFAULT_RC_CANARY_TARGETS)},
    });
    fs.writeFileSync(reportsFile, `${JSON.stringify(reports())}\n`);
    const output: string[] = [];
    const write = jest.spyOn(process.stdout, 'write').mockImplementation((value: any) => {
      output.push(String(value));
      return true;
    });
    try {
      await main([
        'record-canary',
        '--ledger', ledger,
        '--reports', reportsFile,
        '--evaluated-at', EVALUATED_AT,
      ]);
      expect(JSON.parse(output.join('')).failures).toEqual([]);
      expect(readEvents(ledger).filter((event: any) => event.type === 'channel_verified')).toHaveLength(8);
    } finally {
      write.mockRestore();
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  test('accepted channels advance once to verified across repeated hourly batches', () => {
    withLedger(ledger => {
      appendEvent(ledger, {
        version: VERSION,
        tag: TAG,
        commit: COMMIT,
        timestamp: STARTED_AT,
        type: 'channel_accepted',
        channel: 'npm',
        idempotencyKey: 'npm-accepted',
        payload: {},
      });
      const input = {
        ledgerFile: ledger,
        reports: reports(),
        expectedTargets: DEFAULT_RC_CANARY_TARGETS,
        evaluatedAt: EVALUATED_AT,
      };
      recordCanary(input);
      recordCanary(input);
      const events = readEvents(ledger);
      expect(events.filter((event: any) => event.type === 'channel_verified' && event.channel === 'npm'))
        .toHaveLength(1);
      expect(materializeReleaseState(events).channels.npm.status).toBe('verified');
    });
  });

  test.each([
    ['missing', (all: Array<Record<string, string>>) => all.slice(1)],
    ['malformed', (all: Array<Record<string, string>>) => [{...all[0], status: 'unknown'}]],
    ['stale', (all: Array<Record<string, string>>) => [{...all[0], checkedAt: '2026-08-19T10:00:00.000Z'}]],
    ['insecure evidence', (all: Array<Record<string, string>>) => [{...all[0], evidenceUrl: 'http://example.test/evidence'}]],
  ])('%s reports fail and create incident evidence', (_kind, mutate) => {
    withLedger(ledger => {
      const result = recordCanary({
        ledgerFile: ledger,
        reports: mutate(reports()),
        expectedTargets: DEFAULT_RC_CANARY_TARGETS,
        evaluatedAt: EVALUATED_AT,
        maxAgeMilliseconds: 30 * 60 * 1000,
      });
      expect(result.failures.length).toBeGreaterThan(0);
      const events = readEvents(ledger);
      expect(events.some((event: any) => event.type === 'incident_opened')).toBe(true);
      expect(materializeReleaseState(events).incidents).not.toEqual({});
    });
  });

  test('the append-only event seam also rejects insecure canary evidence', () => {
    withLedger(ledger => {
      expect(() => appendEvent(ledger, {
        version: VERSION,
        tag: TAG,
        commit: COMMIT,
        timestamp: EVALUATED_AT,
        type: 'canary_recorded',
        channel: 'npm',
        idempotencyKey: 'insecure-canary-evidence',
        payload: {
          status: 'passed',
          target: 'npm',
          evidenceUrl: 'http://example.test/evidence',
        },
      })).toThrow(/canary_recorded payload is invalid/);
    });
  });

  test('reuses an open incident when the same missing report set recurs', () => {
    withLedger(ledger => {
      const first = recordCanary({
        ledgerFile: ledger,
        reports: [],
        expectedTargets: DEFAULT_RC_CANARY_TARGETS,
        evaluatedAt: EVALUATED_AT,
      });
      const second = recordCanary({
        ledgerFile: ledger,
        reports: [],
        expectedTargets: DEFAULT_RC_CANARY_TARGETS,
        evaluatedAt: '2026-08-19T14:00:00.000Z',
      });
      expect(first.incidents[0].payload.incidentId).toBe(second.incidents[0].payload.incidentId);
      expect(second.changed).toBe(false);
      expect(readEvents(ledger).filter((event: any) => event.type === 'incident_opened')).toHaveLength(1);
    });
  });

  test('a structurally valid failed report records both channel failure and incident evidence', () => {
    withLedger(ledger => {
      const result = recordCanary({
        ledgerFile: ledger,
        reports: reports('failed'),
        expectedTargets: DEFAULT_RC_CANARY_TARGETS,
        evaluatedAt: EVALUATED_AT,
      });
      expect(result.failures.length).toBe(reports().length);
      const events = readEvents(ledger);
      expect(events.filter((event: any) => event.type === 'channel_failed')).toHaveLength(8);
      expect(events.filter((event: any) => event.type === 'incident_opened')).toHaveLength(reports().length);
    });
  });

  test.each(['withdrawn', 'superseded'])('does not treat %s as reconciliation success', status => {
    const channels = Object.fromEntries(
      ['npm', 'pnpm', 'yarn', 'bun', 'github', 'homebrew', 'scoop', 'pypi']
        .map(channel => [channel, {status: channel === 'npm' ? status : 'verified'}])
    );
    const result = reconcileRelease({channels});
    expect(result.complete).toBe(false);
    expect(result.blocking).toContain(`npm ${status}`);
  });

  test('does not permit a promotion policy caller to weaken the immutable RC floor', () => {
    expect(createPromotionDecision(promotionInput()).eligible).toBe(true);
    expect(() => createPromotionDecision(promotionInput({requiredChannels: []}))).toThrow(/floor|eight|required/i);
    expect(() => createPromotionDecision(promotionInput({requiredChannels: ['npm']}))).toThrow(/floor|eight|required/i);
    expect(() => createPromotionDecision(promotionInput({minimumSamples: 23}))).toThrow(/24|minimum/i);
  });

  test('requires hourly evidence across the whole soak instead of duplicate or future samples', () => {
    const baseline = promotionInput();
    const duplicateCanaries = baseline.canaries.map((sample: any) => ({
      ...sample,
      checkedAt: '2026-08-01T23:00:00.000Z',
    }));
    const duplicateDecision = createPromotionDecision(promotionInput({canaries: duplicateCanaries}));
    expect(duplicateDecision.eligible).toBe(false);
    expect(duplicateDecision.reasons).toContain('canary_soak_coverage_incomplete:npm');

    const futureCanaries = baseline.canaries.map((sample: any) => ({
      ...sample,
      checkedAt: '2026-08-02T01:00:00.000Z',
    }));
    const futureDecision = createPromotionDecision(promotionInput({canaries: futureCanaries}));
    expect(futureDecision.eligible).toBe(false);
    expect(futureDecision.reasons).toContain('canary_stale:npm');
  });

  test('legacy state transitions reject v2 state instead of dropping append-only evidence', () => {
    expect(() => transitionState({
      schemaVersion: 'guardscan.release-state.v2',
      version: VERSION,
      channels: {npm: {status: 'planned'}},
      canaries: {npm: [{target: 'npm', status: 'passed'}]},
      incidents: {incident: {status: 'open'}},
    }, {
      channel: 'npm',
      expect: 'planned',
      to: 'published',
      timestamp: EVALUATED_AT,
    })).toThrow(/v2|append-only|legacy/i);
  });
});
