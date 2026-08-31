import { Config } from '../../src/core/config';
import { vulnerabilitySettingsForRun } from '../../src/commands/run';

describe('guardscan run vulnerability settings', () => {
  const originalNoCache = process.env.GUARDSCAN_NO_CACHE;

  beforeEach(() => {
    delete process.env.GUARDSCAN_NO_CACHE;
  });

  afterAll(() => {
    if (originalNoCache === undefined) {
      delete process.env.GUARDSCAN_NO_CACHE;
    } else {
      process.env.GUARDSCAN_NO_CACHE = originalNoCache;
    }
  });

  it('maps configured source, freshness, scope, KEV, and cache policy', () => {
    const config: Config = {
      provider: 'none',
      telemetryEnabled: false,
      offlineMode: true,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      cache: {
        enabled: true,
        semanticThreshold: 0.8,
        maxSizeMB: 100,
        ttlSeconds: 3600,
      },
      vulnerabilities: {
        enabled: true,
        source: 'osv',
        endpoint: 'https://osv.example.test',
        scope: 'runtime',
        snapshotMaxAgeDays: 3,
        enrichKnownExploited: false,
      },
    };

    expect(vulnerabilitySettingsForRun(config)).toEqual({
      cache: true,
      vulnerabilityScope: 'runtime',
      vulnerabilityEndpoint: 'https://osv.example.test',
      vulnerabilitySnapshotMaxAgeDays: 3,
      vulnerabilityEnrichKnownExploited: false,
      vulnerabilityKevMaxCacheAgeDays: 3,
    });
  });

  it('honors the command-scoped cache opt-out', () => {
    process.env.GUARDSCAN_NO_CACHE = 'true';

    expect(vulnerabilitySettingsForRun({
      cache: {
        enabled: true,
        semanticThreshold: 0.8,
        maxSizeMB: 100,
        ttlSeconds: 3600,
      },
    }).cache).toBe(false);
  });
});
