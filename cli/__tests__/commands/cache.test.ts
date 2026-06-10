/**
 * Tests for cache command (cli/src/commands/cache.ts)
 *
 * Covers createCacheCommand() with subcommands:
 *   - cache stats
 *   - cache info
 *   - cache clear
 * and the internal createProgressBar() helper (tested via output).
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockGetStats = jest.fn();
const mockGetSizeMB = jest.fn();
const mockGetUtilization = jest.fn();
const mockClear = jest.fn();

jest.mock('../../src/core/ai-cache', () => ({
  AICache: jest.fn().mockImplementation(() => ({
    getStats: mockGetStats,
    getSizeMB: mockGetSizeMB,
    getUtilization: mockGetUtilization,
    clear: mockClear,
  })),
}));

const mockLoadOrInit = jest.fn();
jest.mock('../../src/core/config', () => ({
  configManager: {
    loadOrInit: mockLoadOrInit,
  },
}));

const mockGetId = jest.fn().mockReturnValue('test-repo-id');
jest.mock('../../src/core/repository', () => ({
  Repository: jest.fn().mockImplementation(() => ({
    getId: mockGetId,
  })),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { createCacheCommand } from '../../src/commands/cache';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Call a named subcommand's action with the given options */
async function callSubcommandAction(
  subcommandName: string,
  options: Record<string, unknown> = {}
): Promise<void> {
  const program = createCacheCommand();
  const sub = program.commands.find((c) => c.name() === subcommandName);
  if (!sub) { throw new Error(`Subcommand "${subcommandName}" not found`); }
  await (sub as any)._actionHandler(options);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createCacheCommand', () => {
  let consoleSpy: ReturnType<typeof jest.spyOn>;
  let consoleWarnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.clearAllMocks();

    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Default config fixture
    mockLoadOrInit.mockReturnValue({
      cache: {
        enabled: true,
        maxSizeMB: 100,
        ttlSeconds: 3600,
        semanticThreshold: 0.95,
      },
    });

    // Default AICache method return values
    mockGetStats.mockReturnValue({
      hits: 50,
      misses: 10,
      totalEntries: 25,
      totalSize: 5 * 1024 * 1024,
      hitRate: 83.3,
    });
    mockGetSizeMB.mockReturnValue(5.0);
    mockGetUtilization.mockReturnValue(5.0);
    mockClear.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  // ── Command structure ────────────────────────────────────────────────────

  it('should be named "cache"', () => {
    const cmd = createCacheCommand();
    expect(cmd.name()).toBe('cache');
  });

  it('should register stats, info, and clear subcommands', () => {
    const cmd = createCacheCommand();
    const names = cmd.commands.map((c) => c.name());
    expect(names).toContain('stats');
    expect(names).toContain('info');
    expect(names).toContain('clear');
  });

  // ── cache stats ──────────────────────────────────────────────────────────

  describe('cache stats', () => {
    it('should display total entries count', async () => {
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/25/); // totalEntries
    });

    it('should display cache size in MB', async () => {
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/5\.00/);  // getSizeMB() value
    });

    it('should display max size from config', async () => {
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/100/); // maxSizeMB
    });

    it('should display hits and misses', async () => {
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/50/);  // hits
      expect(allOutput).toMatch(/10/);  // misses
    });

    it('should display hit rate percentage', async () => {
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/83\./); // hitRate
    });

    it('should display estimated cost savings when hitRate > 0', async () => {
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/savings/i);
    });

    it('should not display savings when hitRate is 0', async () => {
      mockGetStats.mockReturnValue({
        hits: 0,
        misses: 10,
        totalEntries: 0,
        totalSize: 0,
        hitRate: 0,
      });
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).not.toMatch(/savings/i);
    });

    it('should display cache configuration section', async () => {
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/Configuration/i);
      expect(allOutput).toMatch(/Enabled/i);
    });

    it('should show semantic threshold from config', async () => {
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/0\.95/);
    });

    it('should use default max size (100 MB) when not configured', async () => {
      mockLoadOrInit.mockReturnValue({}); // no cache config
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/100/); // default maxSizeMB
    });

    it('should show progress bar for utilization', async () => {
      mockGetUtilization.mockReturnValue(50);
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls
        .map((c) => (c[0] as string) ?? '')
        .join('\n');
      // eslint-disable-next-line no-control-regex
      const stripped = allOutput.replace(/\x1B\[[0-9;]*m/g, '');
      expect(stripped).toMatch(/\[.*\]/);
    });

    it('should show TTL from config', async () => {
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/3600/);
    });

    it('should use default TTL (3600s) when cache config is absent', async () => {
      mockLoadOrInit.mockReturnValue({});
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/3600/);
    });
  });

  // ── cache info ───────────────────────────────────────────────────────────

  describe('cache info', () => {
    it('should display cache configuration details when cache is configured', async () => {
      await callSubcommandAction('info');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/Enabled/i);
      expect(allOutput).toMatch(/Max Size/i);
      expect(allOutput).toMatch(/TTL/i);
      expect(allOutput).toMatch(/Semantic Threshold/i);
    });

    it('should show correct maxSizeMB in info output', async () => {
      await callSubcommandAction('info');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/100/);
    });

    it('should show TTL in seconds and minutes', async () => {
      await callSubcommandAction('info');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/3600/);
      expect(allOutput).toMatch(/60/); // 3600s / 60 = 60 minutes
    });

    it('should show similarity percentage for semantic threshold', async () => {
      await callSubcommandAction('info');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/95%/); // 0.95 * 100 = 95%
    });

    it('should show warning when cache is not configured', async () => {
      mockLoadOrInit.mockReturnValue({}); // no cache field

      await callSubcommandAction('info');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/not configured/i);
    });

    it('should return early (no config block) when cache is absent', async () => {
      mockLoadOrInit.mockReturnValue({});

      await callSubcommandAction('info');

      // Should not attempt to display Enabled/MaxSize when config is absent
      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).not.toMatch(/Max Size/i);
    });

    it('should include modify hint in output when config exists', async () => {
      await callSubcommandAction('info');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/guardscan config set cache/i);
    });

    it('should show disabled indicator when cache.enabled is false', async () => {
      mockLoadOrInit.mockReturnValue({
        cache: {
          enabled: false,
          maxSizeMB: 50,
          ttlSeconds: 1800,
          semanticThreshold: 0.9,
        },
      });
      await callSubcommandAction('info');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/No/i);
    });
  });

  // ── cache clear ──────────────────────────────────────────────────────────

  describe('cache clear', () => {
    it('should show warning and return early when --force is not provided', async () => {
      await callSubcommandAction('clear', { force: false });

      // cache.clear() should NOT have been called
      expect(mockClear).not.toHaveBeenCalled();

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/--force/i);
    });

    it('should clear the cache when --force is provided', async () => {
      await callSubcommandAction('clear', { force: true });

      expect(mockClear).toHaveBeenCalledTimes(1);
    });

    it('should display success message after clearing', async () => {
      await callSubcommandAction('clear', { force: true });

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/cleared/i);
    });

    it('should not output success message when --force is absent', async () => {
      await callSubcommandAction('clear', { force: false });

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).not.toMatch(/cleared/i);
    });

    it('should use default max size (100 MB) for AICache when cache config absent', async () => {
      mockLoadOrInit.mockReturnValue({});
      const { AICache } = await import('../../src/core/ai-cache');

      await callSubcommandAction('clear', { force: true });

      expect(AICache).toHaveBeenCalledWith(
        expect.any(String),
        100 // default maxSizeMB
      );
    });

    it('should use configured max size when present', async () => {
      mockLoadOrInit.mockReturnValue({ cache: { enabled: true, maxSizeMB: 200 } });
      const { AICache } = await import('../../src/core/ai-cache');

      await callSubcommandAction('clear', { force: true });

      expect(AICache).toHaveBeenCalledWith(
        expect.any(String),
        200
      );
    });
  });

  // ── createProgressBar helper (tested via stats output) ───────────────────

  describe('progress bar helper (via stats output)', () => {
    it('should handle 0% utilization', async () => {
      mockGetUtilization.mockReturnValue(0);
      await expect(callSubcommandAction('stats')).resolves.not.toThrow();
    });

    it('should handle 100% utilization', async () => {
      mockGetUtilization.mockReturnValue(100);
      await expect(callSubcommandAction('stats')).resolves.not.toThrow();
    });

    it('should render a bar with bracket markers in output', async () => {
      mockGetUtilization.mockReturnValue(50);
      await callSubcommandAction('stats');

      const allOutput = consoleSpy.mock.calls
        .map((c) => (c[0] as string) ?? '')
        .join('\n');
      // eslint-disable-next-line no-control-regex
      const stripped = allOutput.replace(/\x1B\[[0-9;]*m/g, '');
      expect(stripped).toMatch(/\[/);
      expect(stripped).toMatch(/\]/);
    });

    it('should not throw for utilization > 100 (boundary safety)', async () => {
      mockGetUtilization.mockReturnValue(110);
      await expect(callSubcommandAction('stats')).resolves.not.toThrow();
    });
  });
});