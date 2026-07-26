import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { AISpan, MetricsCollector } from '../../src/core/metrics-collector';
import { configManager } from '../../src/core/config';

function span(overrides: Partial<AISpan> = {}): AISpan {
  return {
    traceId: 'trace-1',
    spanId: 'span-1',
    provider: 'test-provider',
    model: 'test-model',
    operation: 'chat',
    startTime: 1,
    endTime: 2,
    latency: 1,
    success: false,
    error: 'secret-bearing raw error',
    errorType: 'network_error',
    ...overrides,
  };
}

describe('MetricsCollector private persistence', () => {
  const repositories: string[] = [];

  afterEach(() => {
    for (const repoId of repositories.splice(0)) {
      fs.rmSync(path.join(configManager.getCacheDir(), repoId), { recursive: true, force: true });
    }
  });

  it('persists private per-span events without raw errors', async () => {
    const repoId = `metrics-private-${Date.now()}`;
    repositories.push(repoId);
    const collector = new MetricsCollector(repoId);
    await collector.recordSpan(span());

    const eventsDir = path.join(configManager.getCacheDir(), repoId, 'metrics', 'events');
    const files = fs.readdirSync(eventsDir).filter(name => name.endsWith('.json'));
    expect(files).toHaveLength(1);
    const persisted = JSON.parse(fs.readFileSync(path.join(eventsDir, files[0]), 'utf-8'));
    expect(persisted.error).toBeUndefined();
    expect(persisted.errorType).toBe('network_error');
    if (process.platform !== 'win32') {
      expect(fs.statSync(eventsDir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(eventsDir, files[0])).mode & 0o777).toBe(0o600);
    }
  });

  it('does not lose spans written by separate collector instances', async () => {
    const repoId = `metrics-concurrent-${Date.now()}`;
    repositories.push(repoId);
    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      new MetricsCollector(repoId).recordSpan(span({ traceId: `trace-${index}`, spanId: `span-${index}` }))
    ));
    expect(new MetricsCollector(repoId).getSpans()).toHaveLength(20);
  });

  it('does not lose spans written by concurrent Node processes', async () => {
    const repoId = `metrics-process-${Date.now()}`;
    repositories.push(repoId);
    const metricsModule = path.resolve(__dirname, '../../dist/core/metrics-collector.js');
    const script = [
      "const { MetricsCollector } = require(process.argv[1]);",
      "const repoId = process.argv[2]; const index = Number(process.argv[3]);",
      "new MetricsCollector(repoId).recordSpan({ traceId: `trace-${index}`, spanId: `span-${index}`,",
      "provider: 'test', model: 'test', operation: 'chat', startTime: index, endTime: index,",
      "latency: 0, success: true }).then(() => process.exit(0))",
      ".catch(error => { console.error(error); process.exit(1); });",
    ].join('');
    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      runMetricsChild(script, [metricsModule, repoId, String(index)])));
    expect(new MetricsCollector(repoId).getSpans()).toHaveLength(12);
  });

  it('migrates legacy spans idempotently and omits raw errors', () => {
    const repoId = `metrics-legacy-${Date.now()}`;
    repositories.push(repoId);
    const metricsDir = path.join(configManager.getCacheDir(), repoId, 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.writeFileSync(path.join(metricsDir, 'spans.json'), JSON.stringify([span()]));

    expect(new MetricsCollector(repoId).getSpans()).toHaveLength(1);
    expect(new MetricsCollector(repoId).getSpans()).toHaveLength(1);
    expect(fs.existsSync(path.join(metricsDir, 'spans.json.migrated'))).toBe(true);
    const event = fs.readdirSync(path.join(metricsDir, 'events')).find(name => name.endsWith('.json'))!;
    expect(JSON.parse(fs.readFileSync(path.join(metricsDir, 'events', event), 'utf-8')).error)
      .toBeUndefined();
  });

  it('does not publish any new spans on a legacy identity conflict', () => {
    const repoId = `metrics-legacy-conflict-${Date.now()}`;
    repositories.push(repoId);
    const metricsDir = path.join(configManager.getCacheDir(), repoId, 'metrics');
    const eventsDir = path.join(metricsDir, 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    writePersistedSpan(eventsDir, span({ traceId: 'conflict', spanId: 'conflict', provider: 'existing' }));
    fs.writeFileSync(path.join(metricsDir, 'spans.json'), JSON.stringify([
      span({ traceId: 'new', spanId: 'new', provider: 'new' }),
      span({ traceId: 'conflict', spanId: 'conflict', provider: 'different' }),
    ]));

    new MetricsCollector(repoId);

    expect(fs.readdirSync(eventsDir).filter(name => name.endsWith('.json'))).toHaveLength(1);
    expect(fs.existsSync(path.join(metricsDir, 'spans.json.migrated'))).toBe(false);
    expect(fs.readdirSync(metricsQuarantineDir(repoId)).some(name => name.startsWith('spans.json.corrupt-')))
      .toBe(true);
  });

  it('rolls back a journaled partial migration before quarantining a failed source', () => {
    const repoId = `metrics-journal-${Date.now()}`;
    repositories.push(repoId);
    const metricsDir = path.join(configManager.getCacheDir(), repoId, 'metrics');
    const eventsDir = path.join(metricsDir, 'events');
    const source = path.join(metricsDir, 'spans.json');
    const value = {...span({traceId: 'journal', spanId: 'journal'}), error: undefined};
    const file = path.join(eventsDir, `${crypto.createHash('sha256').update('journal:journal').digest('hex')}.json`);
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(source, JSON.stringify({spans: 'invalid'}));
    fs.writeFileSync(file, JSON.stringify(value));
    fs.writeFileSync(path.join(metricsDir, 'migration.journal.json'), JSON.stringify({
      schemaVersion: 'guardscan.metrics.migration.v1',
      source,
      migrated: `${source}.migrated`,
      phase: 'committing',
      createdFiles: [{file, span: value}],
    }));

    new MetricsCollector(repoId);

    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(metricsDir, 'migration.journal.json'))).toBe(false);
    expect(fs.readdirSync(metricsQuarantineDir(repoId)).some(name => name.startsWith('spans.json.corrupt-')))
      .toBe(true);
  });

  it('retains only the newest spans when the event directory exceeds the bounded scan window', async () => {
    const repoId = `metrics-exhaustive-retention-${Date.now()}`;
    repositories.push(repoId);
    const collector = new MetricsCollector(repoId);
    const eventsDir = metricsEventsDir(repoId);
    for (let index = 0; index < 2105; index++) {
      await collector.recordSpan(span({ traceId: `large-${index}`, spanId: `large-${index}`, startTime: index, endTime: index }));
    }

    const reloaded = new MetricsCollector(repoId).getSpans();

    expect(reloaded).toHaveLength(1000);
    expect(reloaded[0].endTime).toBe(1105);
    expect(fs.readdirSync(eventsDir).filter(name => name.endsWith('.json'))).toHaveLength(1000);
  });

  it('quarantines malformed event files', () => {
    const repoId = `metrics-malformed-${Date.now()}`;
    repositories.push(repoId);
    const eventsDir = path.join(configManager.getCacheDir(), repoId, 'metrics', 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    const name = `${'a'.repeat(64)}.json`;
    fs.writeFileSync(path.join(eventsDir, name), '{not-json');

    expect(new MetricsCollector(repoId).getSpans()).toHaveLength(0);
    expect(fs.readdirSync(metricsQuarantineDir(repoId)).some(file => file.startsWith(`${name}.corrupt-`)))
      .toBe(true);
  });

  it('quarantines malformed optional fields and keeps aggregates numeric', () => {
    const repoId = `metrics-invalid-optional-${Date.now()}`;
    repositories.push(repoId);
    const eventsDir = metricsEventsDir(repoId);
    fs.mkdirSync(eventsDir, { recursive: true });
    writePersistedSpan(eventsDir, span({ traceId: 'valid', spanId: 'valid', cost: 1 }));
    writePersistedSpan(eventsDir, {
      ...span({ traceId: 'bad-tokens', spanId: 'bad-tokens' }),
      tokens: { prompt: 1, completion: 2, total: 'secret' },
    });
    writePersistedSpan(eventsDir, {
      ...span({ traceId: 'bad-cost', spanId: 'bad-cost' }),
      cost: '7',
    });

    const collector = new MetricsCollector(repoId);
    const metrics = collector.getMetrics();
    expect(collector.getSpans()).toHaveLength(1);
    expect(metrics.totalTokens).toBe(0);
    expect(metrics.totalCost).toBe(1);
    expect(typeof metrics.totalTokens).toBe('number');
    expect(typeof metrics.totalCost).toBe('number');
    expect(fs.readdirSync(metricsQuarantineDir(repoId)).filter(name => name.includes('.corrupt-')))
      .toHaveLength(2);
  });

  it('excludes unknown persisted fields and raw errors from loaded and exported spans', () => {
    const repoId = `metrics-allowlist-${Date.now()}`;
    repositories.push(repoId);
    const eventsDir = metricsEventsDir(repoId);
    fs.mkdirSync(eventsDir, { recursive: true });
    writePersistedSpan(eventsDir, {
      ...span(),
      error: 'raw provider secret',
      unexpectedSecret: 'must not survive normalization',
    });

    const collector = new MetricsCollector(repoId);
    expect(collector.getSpans()).toHaveLength(1);
    expect(collector.getSpans()[0]).not.toHaveProperty('error');
    expect(collector.getSpans()[0]).not.toHaveProperty('unexpectedSecret');

    const output = path.join(configManager.getCacheDir(), repoId, 'allowlist-export.json');
    collector.exportToJSON(output);
    const exported = JSON.parse(fs.readFileSync(output, 'utf-8'));
    expect(exported.spans[0]).not.toHaveProperty('error');
    expect(exported.spans[0]).not.toHaveProperty('unexpectedSecret');
  });

  it.each(['beginning', 'middle', 'end'] as const)(
    'writes zero live events when a legacy array is invalid at the %s',
    (position) => {
      const repoId = `metrics-invalid-legacy-${position}-${Date.now()}`;
      repositories.push(repoId);
      const metricsDir = path.join(configManager.getCacheDir(), repoId, 'metrics');
      fs.mkdirSync(metricsDir, { recursive: true });
      const valid = [
        span({ traceId: 'legacy-1', spanId: 'legacy-1' }),
        span({ traceId: 'legacy-2', spanId: 'legacy-2' }),
      ];
      const invalid = { traceId: 'invalid-without-required-fields' };
      const legacy = position === 'beginning'
        ? [invalid, ...valid]
        : position === 'middle'
          ? [valid[0], invalid, valid[1]]
          : [...valid, invalid];
      fs.writeFileSync(path.join(metricsDir, 'spans.json'), JSON.stringify(legacy));

      expect(new MetricsCollector(repoId).getSpans()).toHaveLength(0);
      const eventsDir = path.join(metricsDir, 'events');
      expect(fs.readdirSync(eventsDir).filter(name => /^[a-f0-9]{64}\.json$/.test(name)))
        .toHaveLength(0);
      expect(fs.readdirSync(metricsQuarantineDir(repoId)).some(name => name.startsWith('spans.json.corrupt-')))
        .toBe(true);
    }
  );

  it('rejects conflicting content for the same trace and span identity', async () => {
    const repoId = `metrics-conflict-${Date.now()}`;
    repositories.push(repoId);
    const collector = new MetricsCollector(repoId);
    await collector.recordSpan(span({ provider: 'first-provider' }));

    await expect(collector.recordSpan(span({ provider: 'conflicting-provider' })))
      .rejects.toThrow(/conflict/i);
    const reloaded = new MetricsCollector(repoId).getSpans();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].provider).toBe('first-provider');
  });

  it('quarantines unexpected JSON filenames', () => {
    const repoId = `metrics-unexpected-name-${Date.now()}`;
    repositories.push(repoId);
    const eventsDir = metricsEventsDir(repoId);
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(path.join(eventsDir, 'unexpected.json'), JSON.stringify(span()));

    expect(new MetricsCollector(repoId).getSpans()).toHaveLength(0);
    expect(fs.existsSync(path.join(eventsDir, 'unexpected.json'))).toBe(false);
    expect(fs.readdirSync(metricsQuarantineDir(repoId)).some(name => name.startsWith('unexpected.json.corrupt-')))
      .toBe(true);
  });

  it('retains only the latest 1000 spans', async () => {
    const repoId = `metrics-retention-${Date.now()}`;
    repositories.push(repoId);
    const collector = new MetricsCollector(repoId);
    for (let index = 0; index < 1002; index++) {
      await collector.recordSpan(span({
        traceId: `trace-${index}`, spanId: `span-${index}`,
        startTime: index, endTime: index,
      }));
    }
    const retained = new MetricsCollector(repoId).getSpans();
    expect(retained).toHaveLength(1000);
    expect(retained[0].endTime).toBe(2);
  });

  it('exports sanitized metrics with private permissions', async () => {
    const repoId = `metrics-export-${Date.now()}`;
    repositories.push(repoId);
    const collector = new MetricsCollector(repoId);
    await collector.recordSpan(span());
    const output = path.join(configManager.getCacheDir(), repoId, 'metrics-export.json');
    collector.exportToJSON(output);

    const exported = JSON.parse(fs.readFileSync(output, 'utf-8'));
    expect(exported.spans[0].error).toBeUndefined();
    if (process.platform !== 'win32') {
      expect(fs.statSync(output).mode & 0o777).toBe(0o600);
    }
  });

  it('clears the observed event snapshot', async () => {
    const repoId = `metrics-clear-${Date.now()}`;
    repositories.push(repoId);
    const collector = new MetricsCollector(repoId);
    await collector.recordSpan(span());
    await collector.clear();
    expect(new MetricsCollector(repoId).getSpans()).toHaveLength(0);
  });

  it('preserves a span recorded after clear captures its snapshot', async () => {
    const repoId = `metrics-clear-race-${Date.now()}`;
    repositories.push(repoId);
    const collector = new MetricsCollector(repoId);
    await collector.recordSpan(span({ traceId: 'before-clear', spanId: 'before-clear' }));
    const eventsDir = metricsEventsDir(repoId);
    const observedFile = path.join(eventsDir, fs.readdirSync(eventsDir)[0]);
    const originalUnlink = fs.promises.unlink.bind(fs.promises);
    let releaseUnlink!: () => void;
    let markObserved!: () => void;
    const unlinkReleased = new Promise<void>(resolve => { releaseUnlink = resolve; });
    const snapshotObserved = new Promise<void>(resolve => { markObserved = resolve; });
    const unlink = jest.spyOn(fs.promises, 'unlink').mockImplementation(async file => {
      if (String(file) === observedFile) {
        markObserved();
        await unlinkReleased;
      }
      return originalUnlink(file);
    });

    try {
      const clearing = collector.clear();
      await snapshotObserved;
      await collector.recordSpan(span({ traceId: 'after-clear', spanId: 'after-clear' }));
      releaseUnlink();
      await clearing;
    } finally {
      releaseUnlink();
      unlink.mockRestore();
    }

    const retained = new MetricsCollector(repoId).getSpans();
    expect(retained).toHaveLength(1);
    expect(retained[0].traceId).toBe('after-clear');
  });
});

function metricsEventsDir(repoId: string): string {
  return path.join(configManager.getCacheDir(), repoId, 'metrics', 'events');
}

function metricsQuarantineDir(repoId: string): string {
  return path.join(configManager.getCacheDir(), repoId, 'metrics', 'quarantine');
}

function writePersistedSpan(eventsDir: string, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('persisted span fixture must be an object');
  }
  const fixture = value as Record<string, unknown>;
  const traceId = String(fixture.traceId);
  const spanId = String(fixture.spanId);
  const storageId = crypto.createHash('sha256').update(`${traceId}:${spanId}`).digest('hex');
  fs.writeFileSync(path.join(eventsDir, `${storageId}.json`), JSON.stringify(value));
}

function runMetricsChild(script: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, ...args], {
      env: { ...process.env, GUARDSCAN_HOME: process.env.GUARDSCAN_HOME },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr || `child exited ${code}`)));
  });
}
