import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { configManager } from '../../src/core/config';
import { AISpan, MetricsCollector } from '../../src/core/metrics-collector';

describe('MetricsCollector local history erasure', () => {
  const roots: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('deletes migrated legacy metrics when history is cleared', async () => {
    const repoId = `metrics-clear-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-metrics-clear-'));
    jest.spyOn(configManager, 'getCacheDir').mockReturnValue(cacheDir);
    const root = path.join(cacheDir, repoId);
    roots.push(cacheDir);
    const metricsDir = path.join(root, 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    const legacyFile = path.join(metricsDir, 'spans.json');
    const span: AISpan = {
      traceId: 'trace',
      spanId: 'span',
      provider: 'fixture',
      model: 'fixture',
      operation: 'chat',
      startTime: 1,
      endTime: 2,
      latency: 1,
      success: true,
    };
    fs.writeFileSync(legacyFile, JSON.stringify([span]));
    const collector = new MetricsCollector(repoId);
    const migratedFile = `${legacyFile}.migrated`;
    expect(fs.existsSync(migratedFile)).toBe(true);

    await collector.clear();

    expect(fs.existsSync(migratedFile)).toBe(false);
    expect(collector.getSpans()).toEqual([]);
  });

  it('does not publish a span while history erasure holds the storage lease', async () => {
    const repoId = `metrics-clear-race-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-metrics-clear-race-'));
    jest.spyOn(configManager, 'getCacheDir').mockReturnValue(cacheDir);
    roots.push(cacheDir);
    const collector = new MetricsCollector(repoId);
    const first: AISpan = {
      traceId: 'trace-before-clear',
      spanId: 'span-before-clear',
      provider: 'fixture',
      model: 'fixture',
      operation: 'chat',
      startTime: 1,
      endTime: 2,
      latency: 1,
      success: true,
    };
    const racing: AISpan = {
      ...first,
      traceId: 'trace-during-clear',
      spanId: 'span-during-clear',
      startTime: 3,
      endTime: 4,
    };
    await collector.recordSpan(first);

    const unlink = fs.promises.unlink.bind(fs.promises);
    let releaseUnlink!: () => void;
    const unlinkReleased = new Promise<void>(resolve => {releaseUnlink = resolve;});
    let markUnlinkStarted!: () => void;
    const unlinkStarted = new Promise<void>(resolve => {markUnlinkStarted = resolve;});
    jest.spyOn(fs.promises, 'unlink').mockImplementationOnce(async file => {
      markUnlinkStarted();
      await unlinkReleased;
      return unlink(file);
    });

    const clearing = collector.clear();
    await unlinkStarted;
    await expect(collector.recordSpan(racing)).rejects.toThrow(/already in progress/i);
    releaseUnlink();
    await clearing;

    await collector.recordSpan(racing);
    expect(collector.getSpans()).toEqual([racing]);
  });
});
