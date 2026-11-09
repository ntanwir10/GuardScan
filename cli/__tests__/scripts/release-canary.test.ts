import fs from 'fs';
import os from 'os';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';

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

function withLedger(
  callback: (ledger: string) => void,
  channels: string[] = Object.keys(DEFAULT_RC_CANARY_TARGETS),
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-canary-'));
  const ledger = path.join(root, 'events.ndjson');
  appendEvent(ledger, {
    type: 'train_started',
    version: VERSION,
    tag: TAG,
    commit: COMMIT,
    timestamp: STARTED_AT,
    idempotencyKey: 'train-started',
    payload: {channels},
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
  test('native workflow maps Linux PyPI reports to PyPI targets without changing GitHub targets', () => {
    const workflow = fs.readFileSync(
      path.resolve(__dirname, '../../../.github/workflows/release-canary.yml'),
      'utf8',
    );
    const packageManagersStart = workflow.indexOf('  package-managers:');
    const nativeStart = workflow.indexOf('  native-and-pypi:');
    const adaptersStart = workflow.indexOf('  adapters:');
    const packageManagers = workflow.slice(packageManagersStart, nativeStart);
    const nativeAndPypi = workflow.slice(nativeStart, adaptersStart);
    expect(packageManagers).toContain('target: process.env.TARGET');
    expect(packageManagers).not.toContain('channel === "pypi"');
    expect(nativeAndPypi).toContain(
      'target: channel === "pypi" ? process.env.TARGET.replace(/-glibc$/, "") : process.env.TARGET',
    );
  });

  test('native canary verifies Sigstore and provenance everywhere and vendor signatures only when the manifest policy requires them', () => {
    const workflow = yaml.load(fs.readFileSync(
      path.resolve(__dirname, '../../../.github/workflows/release-canary.yml'),
      'utf8',
    )) as any;
    const job = workflow.jobs['native-and-pypi'];
    const steps = job.steps as any[];
    const step = (name: string) => {
      const index = steps.findIndex(candidate => candidate.name === name);
      if (index < 0) throw new Error(`missing canary step: ${name}`);
      return {index, ...steps[index]};
    };
    expect(job.strategy.matrix.target.map((target: any) => target.id)).toEqual([
      'linux-x64-glibc', 'linux-arm64-glibc', 'darwin-arm64', 'darwin-x64', 'windows-x64',
    ]);

    const download = step('Download immutable GitHub archive and evidence');
    expect(download.run).toContain('--pattern "$TARGET.guardscan.sigstore.json"');
    expect(download.run).toContain('--pattern "$TARGET.archive.provenance.sigstore.json"');
    expect(download.run).toContain('test -f "release/$TARGET.archive.provenance.sigstore.json"');
    const manifest = step('Verify signed checksums and bind the manifest to the immutable tag');
    expect(manifest.run).toContain('(.signingPolicy | type == "string") and');

    const signing = step('Resolve required signatures from the verified manifest policy');
    expect(signing.id).toBe('signing');
    expect(signing.if).toBeUndefined();
    expect(signing.run).toContain(`jq -er '.signingPolicy | select(type == "string")' release/release-manifest.json`);
    expect(signing.run).toContain('node cli/scripts/release/signing-policy.js "$POLICY" "${TARGET%%-*}" >> "$GITHUB_OUTPUT"');
    expect(steps[0].with['sparse-checkout']).toBe('cli/scripts/release');
    expect(signing.index).toBeGreaterThan(manifest.index);

    const provenance = step('Verify archive build provenance');
    expect(provenance.if).toBeUndefined();
    expect(provenance.run).toContain('gh attestation verify "release/$ARCHIVE_NAME"');
    expect(provenance.run).toContain('--bundle "release/$TARGET.archive.provenance.sigstore.json"');
    expect(provenance.run).toContain('--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/release-build.yml"');
    expect(provenance.run).toContain('--signer-digest "$BUILD_WORKFLOW_SHA"');
    expect(provenance.env.BUILD_WORKFLOW_SHA).toBe('${{ steps.release-build-identity.outputs.workflow_sha }}');

    const sigstore = step('Verify native Sigstore identity');
    expect(sigstore.if).toBeUndefined();
    expect(sigstore.env.EXECUTABLE).toBe('${{ matrix.target.executable }}');
    expect(sigstore.run).toContain('--bundle "release/$TARGET.guardscan.sigstore.json"');
    expect(sigstore.run).toContain('--certificate-github-workflow-sha "$BUILD_WORKFLOW_SHA"');
    expect(sigstore.run).toContain('"executable/$EXECUTABLE"');
    expect(sigstore.run).not.toContain('gh release download');

    const adHoc = step('Verify macOS code signature');
    expect(adHoc.if).toBe("startsWith(matrix.target.id, 'darwin-')");
    expect(adHoc.run).toBe('codesign --verify --strict --verbose=2 executable/guardscan');
    expect(step('Verify macOS signing and Gatekeeper').if).toBe(
      "startsWith(matrix.target.id, 'darwin-') && contains(steps.signing.outputs.required, ',apple-notarization,')",
    );
    expect(step('Verify Windows Authenticode').if).toBe(
      "startsWith(matrix.target.id, 'windows-') && contains(steps.signing.outputs.required, ',authenticode,')",
    );
    const extract = step('Extract verified GitHub archive');
    for (const verify of [sigstore, adHoc]) expect(verify.index).toBeGreaterThan(extract.index);
  });

  test('malformed workflow report persists an incident before the job reports failure', () => {
    const yaml = require('js-yaml');
    const vm = require('vm');
    const workflow = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/release-canary.yml'), 'utf8'));
    const step = workflow.jobs.record.steps.find((item: any) => item.name === 'Append hash-chained canary and verification events');
    const script = step.run.match(/node - <<'NODE'\n([\s\S]*?)\nNODE/)[1];
    withLedger(seed => {
      const root = path.dirname(seed);
      const reportDirectory = path.join(root, 'reports', `canary-${VERSION}-native-linux-x64-glibc`);
      fs.mkdirSync(reportDirectory, {recursive: true});
      fs.writeFileSync(path.join(reportDirectory, 'report.json'), '{bad');
      const initial = fs.readFileSync(seed, 'utf8');
      const localFs = {...fs,
        readdirSync: (file: string, options: any) => fs.readdirSync(path.resolve(root, file), options),
        readFileSync: (file: string, options: any) => fs.readFileSync(path.resolve(root, file), options),
        mkdirSync: (file: string, options: any) => fs.mkdirSync(path.resolve(root, file), options),
        writeFileSync: (file: string, bytes: any) => fs.writeFileSync(path.resolve(root, file), bytes),
      };
      // The real recorder writes relative to cwd; bind just its ledger to this fixture.
      const recorder = require('../../scripts/release/canary');
      const exit = new Error('persisted');
      const mockRequire = (name: string): any => {
        if (name === 'fs') return localFs;
        if (name === 'child_process') return {execFileSync: (_command: string, args: string[]) => args[0] === 'show' ? initial : COMMIT};
        if (name === './cli/scripts/release/events') return {...require('../../scripts/release/events'), readEvents: (file: string) => readEvents(path.resolve(root, file))};
        if (name === './cli/scripts/release/canary') return {...recorder, recordCanary: (input: any) => recorder.recordCanary({...input, ledgerFile: path.resolve(root, input.ledgerFile)})};
        if (name.startsWith('./cli/')) return require(path.resolve(__dirname, '../../..', name));
        return require(name);
      };
      expect(() => vm.runInNewContext(script, {require: mockRequire, process: {
        env: {TRAIN_VERSION: VERSION, GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'ntanwir10/GuardScan', GITHUB_RUN_ID: '42'},
        exit: () => {throw exit;},
      }})).toThrow(exit);
      const result = path.join(root, 'ledgers', `${TAG}.jsonl`);
      expect(readEvents(result).some((event: any) => event.type === 'incident_opened')).toBe(true);
      expect(fs.readFileSync(path.join(root, '.canary-record-status'), 'utf8')).toBe('1\n');
    });
  });

  test('schemas require report identity and the immutable promotion floor', () => {
    const ajv = new Ajv({allErrors: true, strict: true});
    addFormats(ajv);
    const reportSchema = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../schemas/guardscan.canary-report.v1.schema.json'), 'utf8'
    ));
    const promotionSchema = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../schemas/guardscan.promotion-decision.v1.schema.json'), 'utf8'
    ));
    const eventSchema = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../schemas/guardscan.release-event.v1.schema.json'), 'utf8'
    ));
    const stateSchema = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, '../../schemas/guardscan.release-state.v2.schema.json'), 'utf8'
    ));
    const validateReport = ajv.compile(reportSchema);
    const validatePromotion = ajv.compile(promotionSchema);
    expect(validateReport(reports()[0])).toBe(true);
    expect(validateReport({...reports()[0], status: 'pending'})).toBe(true);
    expect(validateReport({...reports()[0], reason: 'not_public'})).toBe(false);
    expect(validateReport({...reports()[0], target: undefined})).toBe(false);
    expect(validateReport({...reports()[0], evidenceUrl: 'http://example.test/evidence'})).toBe(false);
    expect(eventSchema.definitions.canaryRecorded.properties.status.enum).toContain('pending');
    expect(stateSchema.definitions.canary.properties.status.enum).toContain('pending');
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

  test('clamps ledger event time while preserving the original canary check time', () => {
    withLedger(ledger => {
      const ledgerTail = '2026-08-19T12:45:00.000Z';
      const checkedAt = '2026-08-19T12:30:00.000Z';
      appendEvent(ledger, {
        version: VERSION,
        tag: TAG,
        commit: COMMIT,
        timestamp: ledgerTail,
        type: 'manifest_created',
        idempotencyKey: 'manifest-after-canary-check',
        payload: {manifestSha256: 'b'.repeat(64)},
      });
      const result = recordCanary({
        ledgerFile: ledger,
        reports: reports().map(report => ({...report, checkedAt})),
        expectedTargets: DEFAULT_RC_CANARY_TARGETS,
        evaluatedAt: EVALUATED_AT,
      });
      expect(result.failures).toEqual([]);
      const events = readEvents(ledger);
      const canaries = events.filter((event: any) => event.type === 'canary_recorded');
      expect(canaries.every((event: any) => event.timestamp >= ledgerTail)).toBe(true);
      expect(canaries.every((event: any) => event.payload.checkedAt === checkedAt)).toBe(true);
      expect(Object.values(materializeReleaseState(events).canaries).flat()
        .every((sample: any) => sample.checkedAt === checkedAt)).toBe(true);
    });
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

  test('rejects conflicting prior canary evidence at the exact same checkedAt and preserves identical retries', () => {
    withLedger(ledger => {
      const input = {ledgerFile: ledger, reports: reports(), evaluatedAt: EVALUATED_AT};
      expect(recordCanary(input).failures).toEqual([]);
      const recorded = fs.readFileSync(ledger, 'utf8');
      expect(recordCanary(input).changed).toBe(false);
      expect(fs.readFileSync(ledger, 'utf8')).toBe(recorded);
      const conflict = reports().map(report => report.channel === 'npm' ? {...report, status: 'failed'} : report);
      const result = recordCanary({...input, reports: conflict});
      expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({
        channel: 'npm', reason: expect.stringContaining('conflicts with recorded evidence'),
      })]));
      const added = readEvents(ledger).slice(recorded.trim().split('\n').length);
      expect(added.map((event: any) => event.type)).toEqual(['incident_opened']);
      expect(result.recorded).toEqual([]);
      expect(result.incidents).toHaveLength(1);
      const afterConflict = fs.readFileSync(ledger, 'utf8');
      expect(recordCanary({...input, reports: conflict}).changed).toBe(false);
      expect(fs.readFileSync(ledger, 'utf8')).toBe(afterConflict);
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
    ['unexpected fields', (all: Array<Record<string, string>>) => all.map((report, index) =>
      index === 0 ? {...report, reason: 'not_public'} : report)],
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

  test('records both workflow not-public reports as pending, then accepts later passing reports without incidents', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/release-canary.yml'), 'utf8'));
    const polling = workflow.jobs.moderated.steps.find((item: any) => item.name === 'Poll, install, invoke, and uninstall public moderated channels').run;
    const template = polling.match(/\$report = @\{([\s\S]*?)\n\s+\}/)[1];
    const branches = [...polling.matchAll(/if \(\$notPublic\) \{([\s\S]*?)\n\s+\}/g)];
    expect(branches).toHaveLength(2);
    const moderatedReports = ['winget', 'chocolatey'].map((channel, index) => {
      const values: Record<string, string> = {
        "'${{ matrix.train.version }}'": VERSION,
        '$channel': channel,
        "(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')": EVALUATED_AT,
        '"${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"': 'https://github.com/ntanwir10/GuardScan/actions/runs/42',
      };
      const report = Object.fromEntries([...template.matchAll(/^\s+(\w+) = (.+)$/gm)].map(([, key, expression]: any) => {
        const value = values[expression] ?? expression.match(/^'([^']*)'$/)?.[1];
        if (value === undefined) throw new Error(`unsupported report expression: ${expression}`);
        return [key, value];
      }));
      for (const [, key, value] of branches[index][1].matchAll(/\$report\.(\w+) = '([^']+)'/g)) {
        report[key] = value;
      }
      return report;
    });
    const channels = [...Object.keys(DEFAULT_RC_CANARY_TARGETS), 'winget', 'chocolatey'];
    const expectedTargets = {
      ...DEFAULT_RC_CANARY_TARGETS,
      winget: ['windows-x64'],
      chocolatey: ['windows-x64'],
    };
    withLedger(ledger => {
      const result = recordCanary({
        ledgerFile: ledger,
        reports: [
          ...reports(),
          ...moderatedReports,
        ],
        expectedTargets,
        evaluatedAt: EVALUATED_AT,
      });
      expect(result.failures).toEqual([]);
      expect(result.incidents).toEqual([]);
      const events = readEvents(ledger);
      expect(events.filter((event: any) => event.type === 'canary_recorded'
        && ['winget', 'chocolatey'].includes(event.channel)))
        .toHaveLength(2);
      expect(events.filter((event: any) => event.type === 'canary_recorded'
        && ['winget', 'chocolatey'].includes(event.channel))
        .every((event: any) => event.payload.status === 'pending')).toBe(true);
      expect(events.some((event: any) => event.type === 'channel_failed'
        && ['winget', 'chocolatey'].includes(event.channel))).toBe(false);
      expect(events.some((event: any) => event.type === 'incident_opened')).toBe(false);
      const later = '2026-08-19T13:30:00.000Z';
      const passed = recordCanary({
        ledgerFile: ledger,
        reports: [...reports().map(report => ({...report, checkedAt: later})),
          ...moderatedReports.map(report => ({...report, status: 'passed', checkedAt: later}))],
        expectedTargets,
        evaluatedAt: later,
      });
      expect(passed.failures).toEqual([]);
      expect(passed.incidents).toEqual([]);
      expect(readEvents(ledger).filter((event: any) => event.type === 'canary_recorded'
        && ['winget', 'chocolatey'].includes(event.channel)).map((event: any) => event.payload.status))
        .toEqual(['pending', 'pending', 'passed', 'passed']);
      expect(readEvents(ledger).some((event: any) => event.type === 'incident_opened')).toBe(false);
    }, channels);
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
