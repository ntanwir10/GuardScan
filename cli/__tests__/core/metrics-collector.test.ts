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
});
