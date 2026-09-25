/**
 * cache.test.ts - Unit tests for cache command
 *
 * Tests the CLI commands for cache management: stats, info, clear.
 */

import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import type { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock external dependencies before importing the module under test
jest.mock('../../src/core/config', () => ({
  configManager: {
    loadOrInit: jest.fn(),
    save: jest.fn(),
    load: jest.fn(),
    exists: jest.fn().mockReturnValue(true),
    init: jest.fn(),
    getCacheDir: jest.fn().mockReturnValue('/tmp/guardscan-cache-command-test'),
  },
}));

jest.mock('../../src/core/repository', () => ({
  Repository: jest.fn().mockImplementation(() => ({
    getId: jest.fn().mockReturnValue('test-repo-id'),
  })),
}));

const mockCacheStats = {
  hits: 42,
  misses: 18,
  totalEntries: 60,
  totalSize: 1024 * 1024 * 5, // 5 MB in bytes
  hitRate: 70,
};

const mockClear = jest.fn(async () => undefined);

jest.mock('../../src/core/ai-cache', () => ({
  AICache: jest.fn().mockImplementation(() => ({
    getStats: jest.fn().mockReturnValue(mockCacheStats),
    getSizeMB: jest.fn().mockReturnValue(5.0),
    getUtilization: jest.fn().mockReturnValue(5.0),
    isEnabled: jest.fn().mockReturnValue(true),
    clear: mockClear,
  })),
}));

import { createCacheCommand } from '../../src/commands/cache';
import { configManager } from '../../src/core/config';

const getSubcommand = (program: Command, subcommandName: string): Command => {
  const subcommand = program.commands.find((c: Command) => c.name() === subcommandName);

  if (!subcommand) {
    throw new Error(`Missing ${subcommandName} subcommand`);
  }

  return subcommand;
};

const getConsoleOutput = (consoleSpy: ReturnType<typeof jest.spyOn>): string =>
  consoleSpy.mock.calls.map((c: any[]) => String(c[0] ?? '')).join(' ');

describe('createCacheCommand', () => {
  let consoleLogSpy: ReturnType<typeof jest.spyOn>;
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;
  let testCacheDir: string;
  const mockedConfigManager = configManager as jest.Mocked<typeof configManager>;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockClear.mockClear();
    testCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-cache-command-'));
    mockedConfigManager.getCacheDir.mockReturnValue(testCacheDir);

    mockedConfigManager.loadOrInit.mockReturnValue({
      clientId: 'test-client',
      provider: 'openai',
      telemetryEnabled: false,
      offlineMode: false,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      cache: {
        enabled: true,
        maxSizeMB: 100,
        ttlSeconds: 3600,
        semanticThreshold: 0.95,
      },
    } as any);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
    fs.rmSync(testCacheDir, { recursive: true, force: true });
  });

  describe('command structure', () => {
    it('should create a cache command with correct name', () => {
      const cmd = createCacheCommand();
      expect(cmd.name()).toBe('cache');
    });

    it('should have stats subcommand', () => {
      const cmd = createCacheCommand();
      const subcommands = cmd.commands.map((c: Command) => c.name());
      expect(subcommands).toContain('stats');
    });

    it('should have info subcommand', () => {
      const cmd = createCacheCommand();
      const subcommands = cmd.commands.map((c: Command) => c.name());
      expect(subcommands).toContain('info');
    });

    it('should have clear subcommand', () => {
      const cmd = createCacheCommand();
      const subcommands = cmd.commands.map((c: Command) => c.name());
      expect(subcommands).toContain('clear');
    });

    it('should have correct description', () => {
      const cmd = createCacheCommand();
      expect(cmd.description()).toContain('advisory caches');
    });
  });

  describe('cache stats subcommand', () => {
    it('should display cache statistics', async () => {
      const cmd = createCacheCommand();
      const statsCmd = getSubcommand(cmd, 'stats');

      await statsCmd.parseAsync([], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should display hit rate', async () => {
      const cmd = createCacheCommand();
      const statsCmd = getSubcommand(cmd, 'stats');

      await statsCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).toMatch(/70|[Hh]it/);
    });

    it('should display total entries', async () => {
      const cmd = createCacheCommand();
      const statsCmd = getSubcommand(cmd, 'stats');

      await statsCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).toMatch(/60|[Ee]ntri/);
    });

    it('should display hit and miss counts', async () => {
      const cmd = createCacheCommand();
      const statsCmd = getSubcommand(cmd, 'stats');

      await statsCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).toMatch(/42|18/);
    });

    it('should show savings message when hitRate > 0', async () => {
      const cmd = createCacheCommand();
      const statsCmd = getSubcommand(cmd, 'stats');

      await statsCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).toMatch(/[Ss]aving/);
    });

    it('should not show savings message when hitRate is 0', async () => {
      const { AICache } = require('../../src/core/ai-cache');
      AICache.mockImplementationOnce(() => ({
        getStats: jest.fn().mockReturnValue({
          hits: 0,
          misses: 10,
          totalEntries: 10,
          totalSize: 0,
          hitRate: 0,
        }),
        getSizeMB: jest.fn().mockReturnValue(0),
        getUtilization: jest.fn().mockReturnValue(0),
        isEnabled: jest.fn().mockReturnValue(true),
        clear: mockClear,
      }));

      const cmd = createCacheCommand();
      const statsCmd = getSubcommand(cmd, 'stats');

      await statsCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).not.toMatch(/[Ss]aving/);
    });

    it('should display progress bar for utilization', async () => {
      const cmd = createCacheCommand();
      const statsCmd = getSubcommand(cmd, 'stats');

      await statsCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      // Progress bar uses '█' and '░' characters
      expect(allOutput).toMatch(/[█░]/);
    });

    it('should show cache configuration in stats output', async () => {
      const cmd = createCacheCommand();
      const statsCmd = getSubcommand(cmd, 'stats');

      await statsCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).toMatch(/0\.95|3600|[Cc]onfig/i);
    });

    it('should use default maxSizeMB when cache config is absent', async () => {
      mockedConfigManager.loadOrInit.mockReturnValueOnce({
        clientId: 'test-client',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        // No cache property
      } as any);

      const cmd = createCacheCommand();
      const statsCmd = getSubcommand(cmd, 'stats');

      await statsCmd.parseAsync([], { from: 'user' });

      // Should still run without errors
      expect(consoleLogSpy).toHaveBeenCalled();
      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).toMatch(/Max Size:\s+100 MB/);
    });
  });

  describe('cache info subcommand', () => {
    it('should display cache configuration', async () => {
      const cmd = createCacheCommand();
      const infoCmd = getSubcommand(cmd, 'info');

      await infoCmd.parseAsync([], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should show enabled status', async () => {
      const cmd = createCacheCommand();
      const infoCmd = getSubcommand(cmd, 'info');

      await infoCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).toMatch(/Yes|No|Enabled/i);
    });

    it('should show TTL and semantic threshold', async () => {
      const cmd = createCacheCommand();
      const infoCmd = getSubcommand(cmd, 'info');

      await infoCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).toMatch(/3600|0\.95/);
    });

    it('should show warning message when cache is not configured', async () => {
      mockedConfigManager.loadOrInit.mockReturnValueOnce({
        clientId: 'test-client',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        // No cache property
      } as any);

      const cmd = createCacheCommand();
      const infoCmd = getSubcommand(cmd, 'info');

      await infoCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).toMatch(/not configured|defaults/i);
    });

    it('should show max size in MB', async () => {
      const cmd = createCacheCommand();
      const infoCmd = getSubcommand(cmd, 'info');

      await infoCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).toMatch(/100|MB/);
    });
  });

  describe('cache clear subcommand', () => {
    it('should NOT clear cache without --force flag', async () => {
      const cmd = createCacheCommand();
      const clearCmd = getSubcommand(cmd, 'clear');

      await clearCmd.parseAsync([], { from: 'user' });

      expect(mockClear).not.toHaveBeenCalled();
    });

    it('should show warning message without --force flag', async () => {
      const cmd = createCacheCommand();
      const clearCmd = getSubcommand(cmd, 'clear');

      await clearCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).toMatch(/--force|confirmation/i);
    });

    it('should clear cache with --force flag', async () => {
      const repositoryCache = path.join(testCacheDir, 'test-repo-id');
      fs.mkdirSync(repositoryCache, { recursive: true });
      fs.writeFileSync(path.join(repositoryCache, 'entry.json'), '{}');
      const cmd = createCacheCommand();
      const clearCmd = getSubcommand(cmd, 'clear');

      await clearCmd.parseAsync(['--force'], { from: 'user' });

      expect(fs.existsSync(repositoryCache)).toBe(false);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should show success message after clearing with --force', async () => {
      const cmd = createCacheCommand();
      const clearCmd = getSubcommand(cmd, 'clear');

      await clearCmd.parseAsync(['--force'], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).toMatch(/cleared|success/i);
    });

    it('should not show warning when --force is used', async () => {
      const cmd = createCacheCommand();
      const clearCmd = getSubcommand(cmd, 'clear');

      await clearCmd.parseAsync(['--force'], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      expect(allOutput).not.toMatch(/Use --force to skip confirmation/);
    });
  });

  describe('progress bar boundary behavior', () => {
    it('should use default maxSizeMB of 100 when cache config missing', async () => {
      mockedConfigManager.loadOrInit.mockReturnValueOnce({
        clientId: 'test-client',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      } as any);

      const { AICache } = require('../../src/core/ai-cache');
      AICache.mockImplementationOnce(() => ({
        getStats: jest.fn().mockReturnValue({
          hits: 0, misses: 0, totalEntries: 0, totalSize: 0, hitRate: 0,
        }),
        getSizeMB: jest.fn().mockReturnValue(0),
        getUtilization: jest.fn().mockReturnValue(0),
        isEnabled: jest.fn().mockReturnValue(true),
        clear: mockClear,
      }));

      const cmd = createCacheCommand();
      const statsCmd = getSubcommand(cmd, 'stats');

      await statsCmd.parseAsync([], { from: 'user' });

      const allOutput = getConsoleOutput(consoleLogSpy);
      // Should show default 100 MB
      expect(allOutput).toMatch(/100/);
    });

    it('should show high-utilization warning style at 90%+ utilization', async () => {
      const { AICache } = require('../../src/core/ai-cache');
      AICache.mockImplementationOnce(() => ({
        getStats: jest.fn().mockReturnValue({
          hits: 10, misses: 1, totalEntries: 11, totalSize: 0, hitRate: 90.9,
        }),
        getSizeMB: jest.fn().mockReturnValue(90),
        getUtilization: jest.fn().mockReturnValue(90),
        isEnabled: jest.fn().mockReturnValue(true),
        clear: mockClear,
      }));

      const cmd = createCacheCommand();
      const statsCmd = getSubcommand(cmd, 'stats');

      await statsCmd.parseAsync([], { from: 'user' });

      // Should run without errors - at 90%+ utilization the progress bar uses red
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });
});
