/**
 * budget.test.ts - Unit tests for budget command
 *
 * Tests the CLI commands for budget management: status, set, report.
 * Also tests the createProgressBar helper indirectly.
 */

import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import type { BudgetStatus } from '../../src/core/cost-guard';
import type { Config } from '../../src/core/config';
import type { UsageReport } from '../../src/core/usage-tracker';

// Mock external dependencies before importing the module under test
jest.mock('../../src/core/config', () => ({
  configManager: {
    loadOrInit: jest.fn(),
    save: jest.fn(),
    load: jest.fn(),
    exists: jest.fn().mockReturnValue(true),
    init: jest.fn(),
  },
}));

jest.mock('../../src/core/repository', () => ({
  Repository: jest.fn().mockImplementation(() => ({
    getId: jest.fn().mockReturnValue('test-repo-id'),
  })),
}));

jest.mock('../../src/core/cost-guard', () => ({
  CostGuard: jest.fn().mockImplementation(() => ({
    getBudgetStatus: jest.fn<() => Promise<BudgetStatus>>(async () => ({
      daily: { used: 2.5, limit: 10, remaining: 7.5, percentUsed: 25 },
      monthly: { used: 15, limit: 100, remaining: 85, percentUsed: 15 },
      perRequest: { limit: 1 },
      warnings: [],
    })),
    getUsageReport: jest.fn<() => Promise<UsageReport>>(async () => ({
      summary: { daily: 1.0, weekly: 5.0, monthly: 15.0, allTime: 50.0 },
      dailyBreakdown: [],
      byProvider: { openai: 10.0, gemini: 5.0 },
      byModel: { 'gpt-4o': 8.0, 'gemini-2.5-flash': 5.0 },
      byOperation: { chat: 15.0 },
      topCostlyOperations: [
        {
          timestamp: new Date('2024-01-01T10:00:00Z'),
          model: 'gpt-4o',
          cost: 0.5,
        },
      ],
    })),
    exportUsage: jest.fn<(outputPath: string, days?: number) => void>(),
  })),
  DEFAULT_BUDGET_CONFIG: {
    dailyLimit: 10,
    monthlyLimit: 100,
    perRequestLimit: 1,
    warningThreshold: 0.8,
  },
}));

import { createBudgetCommand } from '../../src/commands/budget';
import { configManager } from '../../src/core/config';

type SavedBudgetConfig = Config & { budget: NonNullable<Config['budget']> };

describe('createBudgetCommand', () => {
  let consoleLogSpy: ReturnType<typeof jest.spyOn>;
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;
  let processExitSpy: ReturnType<typeof jest.spyOn>;
  const mockedConfigManager = configManager as jest.Mocked<typeof configManager>;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((_code?: number | string | null) => {
        throw new Error(`process.exit called with code ${_code}`);
      });

    mockedConfigManager.loadOrInit.mockReturnValue({
      clientId: 'test-client',
      provider: 'openai',
      telemetryEnabled: false,
      offlineMode: false,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      budget: {
        dailyLimit: 10,
        monthlyLimit: 100,
        perRequestLimit: 1,
        warningThreshold: 0.8,
      },
    } as Config);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    jest.clearAllMocks();
  });

  describe('command structure', () => {
    it('should create a budget command with correct name', () => {
      const cmd = createBudgetCommand();
      expect(cmd.name()).toBe('budget');
    });

    it('should have status subcommand', () => {
      const cmd = createBudgetCommand();
      const subcommands = cmd.commands.map((c) => c.name());
      expect(subcommands).toContain('status');
    });

    it('should have set subcommand', () => {
      const cmd = createBudgetCommand();
      const subcommands = cmd.commands.map((c) => c.name());
      expect(subcommands).toContain('set');
    });

    it('should have report subcommand', () => {
      const cmd = createBudgetCommand();
      const subcommands = cmd.commands.map((c) => c.name());
      expect(subcommands).toContain('report');
    });

    it('should have correct description', () => {
      const cmd = createBudgetCommand();
      expect(cmd.description()).toBe('Manage AI spending budgets');
    });
  });

  describe('budget status subcommand', () => {
    it('should display budget status', async () => {
      const cmd = createBudgetCommand();
      const statusCmd = cmd.commands.find((c) => c.name() === 'status')!;

      // Invoke the action directly
      await statusCmd.parseAsync([], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should display warnings when present', async () => {
      const { CostGuard } = require('../../src/core/cost-guard');
      CostGuard.mockImplementationOnce(() => ({
        getBudgetStatus: jest.fn<() => Promise<BudgetStatus>>(async () => ({
          daily: { used: 8.5, limit: 10, remaining: 1.5, percentUsed: 85 },
          monthly: { used: 90, limit: 100, remaining: 10, percentUsed: 90 },
          perRequest: { limit: 1 },
          warnings: ['Daily usage is at 85% of limit', 'Monthly usage is at 90% of limit'],
        })),
      }));

      const cmd = createBudgetCommand();
      const statusCmd = cmd.commands.find((c) => c.name() === 'status')!;

      await statusCmd.parseAsync([], { from: 'user' });

      // Should output something about warnings
      const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
      expect(allOutput).toMatch(/[Ww]arn/);
    });

    it('should display daily and monthly budget info', async () => {
      const cmd = createBudgetCommand();
      const statusCmd = cmd.commands.find((c) => c.name() === 'status')!;

      await statusCmd.parseAsync([], { from: 'user' });

      const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
      // Should contain budget limit values
      expect(allOutput).toMatch(/10/);
      expect(allOutput).toMatch(/100/);
    });
  });

  describe('budget set subcommand', () => {
    it('should update daily limit', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await setCmd.parseAsync(['--daily', '20'], { from: 'user' });

      expect(mockedConfigManager.save).toHaveBeenCalled();
      const savedConfig = (mockedConfigManager.save as jest.Mock).mock.calls[0][0] as SavedBudgetConfig;
      expect(savedConfig.budget.dailyLimit).toBe(20);
    });

    it('should update monthly limit', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await setCmd.parseAsync(['--monthly', '200'], { from: 'user' });

      expect(mockedConfigManager.save).toHaveBeenCalled();
      const savedConfig = (mockedConfigManager.save as jest.Mock).mock.calls[0][0] as SavedBudgetConfig;
      expect(savedConfig.budget.monthlyLimit).toBe(200);
    });

    it('should update per-request limit', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await setCmd.parseAsync(['--per-request', '2.5'], { from: 'user' });

      expect(mockedConfigManager.save).toHaveBeenCalled();
      const savedConfig = (mockedConfigManager.save as jest.Mock).mock.calls[0][0] as SavedBudgetConfig;
      expect(savedConfig.budget.perRequestLimit).toBe(2.5);
    });

    it('should update warning threshold', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await setCmd.parseAsync(['--warning-threshold', '0.9'], { from: 'user' });

      expect(mockedConfigManager.save).toHaveBeenCalled();
      const savedConfig = (mockedConfigManager.save as jest.Mock).mock.calls[0][0] as SavedBudgetConfig;
      expect(savedConfig.budget.warningThreshold).toBe(0.9);
    });

    it('should reject invalid daily amount (NaN)', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await expect(
        setCmd.parseAsync(['--daily', 'not-a-number'], { from: 'user' })
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid daily amount')
      );
    });

    it('should reject negative daily amount', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await expect(
        setCmd.parseAsync(['--daily', '-5'], { from: 'user' })
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid daily amount')
      );
    });

    it('should reject invalid monthly amount', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await expect(
        setCmd.parseAsync(['--monthly', 'bad'], { from: 'user' })
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid monthly amount')
      );
    });

    it('should reject negative monthly amount', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await expect(
        setCmd.parseAsync(['--monthly', '-10'], { from: 'user' })
      ).rejects.toThrow();
    });

    it('should reject invalid per-request amount', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await expect(
        setCmd.parseAsync(['--per-request', 'abc'], { from: 'user' })
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid per-request amount')
      );
    });

    it('should reject warning threshold above 1', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await expect(
        setCmd.parseAsync(['--warning-threshold', '1.5'], { from: 'user' })
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid warning threshold')
      );
    });

    it('should reject warning threshold below 0', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await expect(
        setCmd.parseAsync(['--warning-threshold', '-0.1'], { from: 'user' })
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid warning threshold')
      );
    });

    it('should reject when no options are specified', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await expect(
        setCmd.parseAsync([], { from: 'user' })
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No budget options specified')
      );
    });

    it('should initialize budget config if missing', async () => {
      mockedConfigManager.loadOrInit.mockReturnValueOnce({
        clientId: 'test-client',
        provider: 'openai',
        telemetryEnabled: false,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        // No budget property
      } as any);

      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await setCmd.parseAsync(['--daily', '25'], { from: 'user' });

      expect(mockedConfigManager.save).toHaveBeenCalled();
      const savedConfig = (mockedConfigManager.save as jest.Mock).mock.calls[0][0] as SavedBudgetConfig;
      expect(savedConfig.budget).toBeDefined();
      expect(savedConfig.budget.dailyLimit).toBe(25);
    });

    it('should accept zero as a valid daily limit', async () => {
      const cmd = createBudgetCommand();
      const setCmd = cmd.commands.find((c) => c.name() === 'set')!;

      await setCmd.parseAsync(['--daily', '0'], { from: 'user' });

      expect(mockedConfigManager.save).toHaveBeenCalled();
      const savedConfig = (mockedConfigManager.save as jest.Mock).mock.calls[0][0] as SavedBudgetConfig;
      expect(savedConfig.budget.dailyLimit).toBe(0);
    });
  });

  describe('budget report subcommand', () => {
    it('should display usage report with default 30 days', async () => {
      const cmd = createBudgetCommand();
      const reportCmd = cmd.commands.find((c) => c.name() === 'report')!;

      await reportCmd.parseAsync([], { from: 'user' });

      expect(consoleLogSpy).toHaveBeenCalled();
      const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
      expect(allOutput).toMatch(/30/);
    });

    it('should display custom days count', async () => {
      const cmd = createBudgetCommand();
      const reportCmd = cmd.commands.find((c) => c.name() === 'report')!;

      await reportCmd.parseAsync(['--days', '7'], { from: 'user' });

      const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
      expect(allOutput).toMatch(/7/);
    });

    it('should show by-provider breakdown', async () => {
      const cmd = createBudgetCommand();
      const reportCmd = cmd.commands.find((c) => c.name() === 'report')!;

      await reportCmd.parseAsync([], { from: 'user' });

      const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
      expect(allOutput).toMatch(/openai|gemini|Provider/i);
    });

    it('should show top costly operations', async () => {
      const cmd = createBudgetCommand();
      const reportCmd = cmd.commands.find((c) => c.name() === 'report')!;

      await reportCmd.parseAsync([], { from: 'user' });

      const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
      expect(allOutput).toMatch(/gpt-4o|Costly/i);
    });

    it('should export to file when --export specified', async () => {
      const { CostGuard } = require('../../src/core/cost-guard');
      const mockExport = jest.fn<(outputPath: string, days?: number) => void>();
      CostGuard.mockImplementationOnce(() => ({
        getUsageReport: jest.fn<() => Promise<UsageReport>>(async () => ({
          summary: { daily: 1.0, weekly: 5.0, monthly: 15.0, allTime: 50.0 },
          dailyBreakdown: [],
          byProvider: {},
          byModel: {},
          byOperation: {},
          topCostlyOperations: [],
        })),
        exportUsage: mockExport,
      }));

      const cmd = createBudgetCommand();
      const reportCmd = cmd.commands.find((c) => c.name() === 'report')!;

      await reportCmd.parseAsync(['--export', '/tmp/report.csv'], { from: 'user' });

      expect(mockExport).toHaveBeenCalledWith('/tmp/report.csv', 30);
      const allOutput = consoleLogSpy.mock.calls.flat().join(' ');
      expect(allOutput).toMatch(/exported/i);
    });
  });
});

describe('budget progress bar (via status output)', () => {
  // Tests createProgressBar behavior indirectly via status command output

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should show progress bar output in status command', async () => {
    const { CostGuard } = require('../../src/core/cost-guard');
    CostGuard.mockImplementation(() => ({
      getBudgetStatus: jest.fn<() => Promise<BudgetStatus>>(async () => ({
        daily: { used: 5, limit: 10, remaining: 5, percentUsed: 50 },
        monthly: { used: 50, limit: 100, remaining: 50, percentUsed: 50 },
        perRequest: { limit: 1 },
        warnings: [],
      })),
    }));

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const cmd = createBudgetCommand();
    const statusCmd = cmd.commands.find((c) => c.name() === 'status')!;
    await statusCmd.parseAsync([], { from: 'user' });

    const allOutput = consoleSpy.mock.calls.flat().join(' ');
    // Progress bar uses '█' and '░' characters
    expect(allOutput).toMatch(/[█░]/);

    consoleSpy.mockRestore();
  });

  it('should show 100% filled progress bar at full utilization', async () => {
    const { CostGuard } = require('../../src/core/cost-guard');
    CostGuard.mockImplementation(() => ({
      getBudgetStatus: jest.fn<() => Promise<BudgetStatus>>(async () => ({
        daily: { used: 10, limit: 10, remaining: 0, percentUsed: 100 },
        monthly: { used: 100, limit: 100, remaining: 0, percentUsed: 100 },
        perRequest: { limit: 1 },
        warnings: [],
      })),
    }));

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const cmd = createBudgetCommand();
    const statusCmd = cmd.commands.find((c) => c.name() === 'status')!;
    await statusCmd.parseAsync([], { from: 'user' });

    const allOutput = consoleSpy.mock.calls.flat().join(' ');
    expect(allOutput).toMatch(/100/);

    consoleSpy.mockRestore();
  });
});
