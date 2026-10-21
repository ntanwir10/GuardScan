import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('AICache privacy controls', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let testHome: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    testHome = path.join(os.tmpdir(), `guardscan-ai-cache-${Date.now()}`);
    process.env.GUARDSCAN_HOME = testHome;
    process.env.HOME = testHome;
    jest.resetModules();
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = originalEnv;
    if (fs.existsSync(testHome)) {
      fs.rmSync(testHome, { recursive: true, force: true });
    }
  });

  it('should disable cache reads and writes when GUARDSCAN_NO_CACHE is true', async () => {
    process.env.GUARDSCAN_NO_CACHE = 'true';
    const { AICache } = await import('../../src/core/ai-cache');

    const cache = new AICache('repo-id', { enabled: true, maxSizeMB: 1 });
    await cache.set('prompt', 'model', 'response');

    expect(cache.isEnabled()).toBe(false);
    expect(await cache.get('prompt', 'model')).toBeNull();
    expect(cache.getEntryCount()).toBe(0);
  });

  it('should expire entries after ttlSeconds', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { AICache } = await import('../../src/core/ai-cache');

    const cache = new AICache('repo-id', {
      enabled: true,
      maxSizeMB: 1,
      ttlSeconds: 1,
    });

    await cache.set('prompt', 'model', 'response');
    expect(await cache.get('prompt', 'model')).toBe('response');

    jest.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    expect(await cache.get('prompt', 'model')).toBeNull();
  });
});
