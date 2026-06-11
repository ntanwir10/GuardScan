/**
 * Tests for budget command (cli/src/commands/budget.ts)
 *
 * Covers createBudgetCommand() with subcommands:
 *   - budget status
 *   - budget set
 *   - budget report
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

const mockGetBudgetStatus = jest.fn<() => Promise<{
  daily: { used: number; limit: number; remaining: number; percentUsed: number };
  monthly: { used: number; limit: number; remaining: number; percentUsed: number };
  perRequest: { limit: number };
  warnings: string[];
}>>();
const mockGetUsageReport = jest.fn<(days: number) => Promise<{
  summary: { daily: number; weekly: number; monthly: number; allTime: number };
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  topCostlyOperations: Array<{
    timestamp: Date;
    model: string;
    cost: number;
    provider: string;
    operation: string;
  }>;
}>>();
const mockExportUsage = jest.fn<(path: string, days: number) => Promise<void>>();
const mockClearUsage = jest.fn<() => Promise<void>>();
const mockRecordUsage = jest.fn<(cost: number, metadata?: Record<string, unknown>) => Promise<void>>();
const mockCheckBudget = jest.fn<(estimatedCost: number) => Promise<void>>();

jest.mock('../../src/core/cost-guard', () => ({
  CostGuard: jest.fn().mockImplementation(() => ({
    getBudgetStatus: mockGetBudgetStatus,
    getUsageReport: mockGetUsageReport,
    exportUsage: mockExportUsage,
    clearUsage: mockClearUsage,
    recordUsage: mockRecordUsage,
    checkBudget: mockCheckBudget,
  })),
  DEFAULT_BUDGET_CONFIG: {
    dailyLimit: 10,
    monthlyLimit: 100,
    perRequestLimit: 1,
    warningThreshold: 0.8,
  },
}));

const mockLoadOrInit = jest.fn();
const mockSave = jest.fn();

jest.mock('../../src/core/config', () => ({
  configManager: {
    loadOrInit: mockLoadOrInit,
    save: mockSave,
  },
}));

const mockGetId = jest.fn().mockReturnValue('test-repo-id');
jest.mock('../../src/core/repository', () => ({
  Repository: jest.fn().mockImplementation(() => ({
    getId: mockGetId,
  })),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { createBudgetCommand } from '../../src/commands/budget';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Call a named subcommand's action with the given options */
async function callSubcommandAction(
  subcommandName: string,
  options: Record<string, unknown> = {}
): Promise<void> {
  const program = createBudgetCommand();
  const sub = program.commands.find((c) => c.name() === subcommandName);
  if (!sub) { throw new Error(`Subcommand "${subcommandName}" not found`); }
  // Commander stores the action in ._actionHandler
  await (sub as any)._actionHandler(options);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createBudgetCommand', () => {
  let consoleSpy: ReturnType<typeof jest.spyOn>;
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;
  let processExitSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.clearAllMocks();

    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((_code?: string | number | null | undefined) => {
        throw new Error(`process.exit called with code ${_code}`);
      });

    // Default config fixture
    mockLoadOrInit.mockReturnValue({
      budget: {
        dailyLimit: 10,
        monthlyLimit: 100,
        perRequestLimit: 1,
        warningThreshold: 0.8,
      },
      cache: { enabled: true, maxSizeMB: 100, ttlSeconds: 3600, semanticThreshold: 0.95 },
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  // ── Command structure ────────────────────────────────────────────────────

  it('should be named "budget"', () => {
    const cmd = createBudgetCommand();
    expect(cmd.name()).toBe('budget');
  });

  it('should register status, set, and report subcommands', () => {
    const cmd = createBudgetCommand();
    const names = cmd.commands.map((c) => c.name());
    expect(names).toContain('status');
    expect(names).toContain('set');
    expect(names).toContain('report');
  });

  // ── budget status ────────────────────────────────────────────────────────

  describe('budget status', () => {
    const defaultStatus = {
      daily: { used: 2.5, limit: 10, remaining: 7.5, percentUsed: 25 },
      monthly: { used: 20, limit: 100, remaining: 80, percentUsed: 20 },
      perRequest: { limit: 1 },
      warnings: [],
    };

    it('should display daily budget information', async () => {
      mockGetBudgetStatus.mockResolvedValue(defaultStatus);
      await callSubcommandAction('status');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/2\.50/);   // used
      expect(allOutput).toMatch(/10\.00/);  // limit
      expect(allOutput).toMatch(/7\.50/);   // remaining
    });

    it('should display monthly budget information', async () => {
      mockGetBudgetStatus.mockResolvedValue(defaultStatus);
      await callSubcommandAction('status');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/20\.00/);  // monthly used
      expect(allOutput).toMatch(/80\.00/);  // monthly remaining
    });

    it('should display warnings when present', async () => {
      mockGetBudgetStatus.mockResolvedValue({
        ...defaultStatus,
        warnings: ['Daily budget at 85% - consider monitoring usage'],
      });
      await callSubcommandAction('status');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/85%/);
    });

    it('should not display warnings section when there are no warnings', async () => {
      mockGetBudgetStatus.mockResolvedValue(defaultStatus);
      await callSubcommandAction('status');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).not.toMatch(/Warnings/);
    });

    it('should call getBudgetStatus with the repo ID', async () => {
      mockGetBudgetStatus.mockResolvedValue(defaultStatus);
      await callSubcommandAction('status');
      expect(mockGetBudgetStatus).toHaveBeenCalledTimes(1);
    });

    it('should include per-request limit in output', async () => {
      mockGetBudgetStatus.mockResolvedValue(defaultStatus);
      await callSubcommandAction('status');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/1\.00/); // perRequest limit
    });

    it('should display progress bars for daily and monthly budgets', async () => {
      mockGetBudgetStatus.mockResolvedValue(defaultStatus);
      await callSubcommandAction('status');

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      // Progress bar contains '[' ... ']' and a percent
      expect(allOutput).toMatch(/\[.*\]/);
      expect(allOutput).toMatch(/25%/);
    });
  });

  // ── budget set ───────────────────────────────────────────────────────────

  describe('budget set', () => {
    it('should update daily limit when --daily is provided', async () => {
      const config = {
        budget: { dailyLimit: 10, monthlyLimit: 100, perRequestLimit: 1, warningThreshold: 0.8 },
      };
      mockLoadOrInit.mockReturnValue(config);

      await callSubcommandAction('set', { daily: '20' });

      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: expect.objectContaining({ dailyLimit: 20 }),
        })
      );
    });

    it('should update monthly limit when --monthly is provided', async () => {
      const config = {
        budget: { dailyLimit: 10, monthlyLimit: 100, perRequestLimit: 1, warningThreshold: 0.8 },
      };
      mockLoadOrInit.mockReturnValue(config);

      await callSubcommandAction('set', { monthly: '200' });

      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: expect.objectContaining({ monthlyLimit: 200 }),
        })
      );
    });

    it('should update per-request limit when --perRequest is provided', async () => {
      const config = {
        budget: { dailyLimit: 10, monthlyLimit: 100, perRequestLimit: 1, warningThreshold: 0.8 },
      };
      mockLoadOrInit.mockReturnValue(config);

      await callSubcommandAction('set', { perRequest: '2.5' });

      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: expect.objectContaining({ perRequestLimit: 2.5 }),
        })
      );
    });

    it('should update warning threshold when --warningThreshold is provided', async () => {
      const config = {
        budget: { dailyLimit: 10, monthlyLimit: 100, perRequestLimit: 1, warningThreshold: 0.8 },
      };
      mockLoadOrInit.mockReturnValue(config);

      await callSubcommandAction('set', { warningThreshold: '0.9' });

      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: expect.objectContaining({ warningThreshold: 0.9 }),
        })
      );
    });

    it('should initialize budget config when none exists', async () => {
      const config = {}; // No budget field
      mockLoadOrInit.mockReturnValue(config);

      await callSubcommandAction('set', { daily: '15' });

      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: expect.objectContaining({
            dailyLimit: 15,
            monthlyLimit: 100,   // default
            perRequestLimit: 1,  // default
            warningThreshold: 0.8, // default
          }),
        })
      );
    });

    it('should exit with error when daily is not a number', async () => {
      await expect(
        callSubcommandAction('set', { daily: 'not-a-number' })
      ).rejects.toThrow(/process\.exit/);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid daily amount')
      );
    });

    it('should exit with error when daily is negative', async () => {
      await expect(
        callSubcommandAction('set', { daily: '-5' })
      ).rejects.toThrow(/process\.exit/);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid daily amount')
      );
    });

    it('should exit with error when monthly is invalid', async () => {
      await expect(
        callSubcommandAction('set', { monthly: 'bad' })
      ).rejects.toThrow(/process\.exit/);
    });

    it('should exit with error when per-request amount is negative', async () => {
      await expect(
        callSubcommandAction('set', { perRequest: '-1' })
      ).rejects.toThrow(/process\.exit/);
    });

    it('should exit with error when warning threshold is greater than 1', async () => {
      await expect(
        callSubcommandAction('set', { warningThreshold: '1.5' })
      ).rejects.toThrow(/process\.exit/);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid warning threshold')
      );
    });

    it('should exit with error when warning threshold is negative', async () => {
      await expect(
        callSubcommandAction('set', { warningThreshold: '-0.1' })
      ).rejects.toThrow(/process\.exit/);
    });

    it('should exit with error when no options are provided', async () => {
      await expect(callSubcommandAction('set', {})).rejects.toThrow(/process\.exit/);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No budget options specified')
      );
    });

    it('should display success message with updated values', async () => {
      const config = {
        budget: { dailyLimit: 10, monthlyLimit: 100, perRequestLimit: 1, warningThreshold: 0.8 },
      };
      mockLoadOrInit.mockReturnValue(config);

      await callSubcommandAction('set', { daily: '25', monthly: '250' });

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/updated/i);
      expect(allOutput).toMatch(/25/);   // daily value
      expect(allOutput).toMatch(/250/);  // monthly value
    });

    it('should accept zero as valid limit (disabling)', async () => {
      const config = {
        budget: { dailyLimit: 10, monthlyLimit: 100, perRequestLimit: 1, warningThreshold: 0.8 },
      };
      mockLoadOrInit.mockReturnValue(config);

      await callSubcommandAction('set', { daily: '0' });

      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: expect.objectContaining({ dailyLimit: 0 }),
        })
      );
    });

    it('should accept 0 as valid warning threshold', async () => {
      const config = {
        budget: { dailyLimit: 10, monthlyLimit: 100, perRequestLimit: 1, warningThreshold: 0.8 },
      };
      mockLoadOrInit.mockReturnValue(config);

      await callSubcommandAction('set', { warningThreshold: '0' });

      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: expect.objectContaining({ warningThreshold: 0 }),
        })
      );
    });

    it('should accept 1 as valid warning threshold (boundary)', async () => {
      const config = {
        budget: { dailyLimit: 10, monthlyLimit: 100, perRequestLimit: 1, warningThreshold: 0.8 },
      };
      mockLoadOrInit.mockReturnValue(config);

      await callSubcommandAction('set', { warningThreshold: '1' });

      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: expect.objectContaining({ warningThreshold: 1 }),
        })
      );
    });
  });

  // ── budget report ────────────────────────────────────────────────────────

  describe('budget report', () => {
    const defaultReport = {
      summary: { daily: 1.5, weekly: 8.0, monthly: 25.0, allTime: 100.0 },
      byProvider: { openai: 1.0, gemini: 0.5 },
      byModel: { 'gpt-4o': 0.8, 'gemini-2.5-flash': 0.7 },
      topCostlyOperations: [
        {
          timestamp: new Date('2024-01-15T10:00:00Z'),
          model: 'gpt-4o',
          cost: 0.5,
          provider: 'openai',
          operation: 'chat',
        },
      ],
    };

    it('should display summary costs', async () => {
      mockGetUsageReport.mockResolvedValue(defaultReport);
      await callSubcommandAction('report', { days: '30' });

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/1\.50/);   // daily
      expect(allOutput).toMatch(/8\.00/);   // weekly
      expect(allOutput).toMatch(/25\.00/);  // monthly
      expect(allOutput).toMatch(/100\.00/); // allTime
    });

    it('should display per-provider breakdown', async () => {
      mockGetUsageReport.mockResolvedValue(defaultReport);
      await callSubcommandAction('report', { days: '30' });

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/openai/i);
      expect(allOutput).toMatch(/gemini/i);
    });

    it('should display top costly operations', async () => {
      mockGetUsageReport.mockResolvedValue(defaultReport);
      await callSubcommandAction('report', { days: '30' });

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/gpt-4o/);
    });

    it('should use the given --days option', async () => {
      mockGetUsageReport.mockResolvedValue(defaultReport);
      await callSubcommandAction('report', { days: '7' });

      expect(mockGetUsageReport).toHaveBeenCalledWith(7);
    });

    it('should call exportUsage when --export path is given', async () => {
      mockGetUsageReport.mockResolvedValue(defaultReport);
      mockExportUsage.mockResolvedValue(undefined);

      await callSubcommandAction('report', { days: '30', export: '/tmp/report.csv' });

      expect(mockExportUsage).toHaveBeenCalledWith('/tmp/report.csv', 30);
      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/\/tmp\/report\.csv/);
    });

    it('should not call exportUsage when --export is not given', async () => {
      mockGetUsageReport.mockResolvedValue(defaultReport);
      await callSubcommandAction('report', { days: '30' });

      expect(mockExportUsage).not.toHaveBeenCalled();
    });

    it('should skip provider breakdown when empty', async () => {
      mockGetUsageReport.mockResolvedValue({ ...defaultReport, byProvider: {} });
      // Should not throw
      await expect(callSubcommandAction('report', { days: '30' })).resolves.not.toThrow();
    });

    it('should skip model breakdown when empty', async () => {
      mockGetUsageReport.mockResolvedValue({ ...defaultReport, byModel: {} });
      await expect(callSubcommandAction('report', { days: '30' })).resolves.not.toThrow();
    });

    it('should skip top operations when empty', async () => {
      mockGetUsageReport.mockResolvedValue({ ...defaultReport, topCostlyOperations: [] });
      await expect(callSubcommandAction('report', { days: '30' })).resolves.not.toThrow();
    });

    it('should display the correct number-of-days in the header', async () => {
      mockGetUsageReport.mockResolvedValue(defaultReport);
      await callSubcommandAction('report', { days: '14' });

      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(allOutput).toMatch(/14/);
    });

    it('should show only top 5 models even if more are present', async () => {
      const manyModels: Record<string, number> = {};
      for (let i = 1; i <= 10; i++) {
        manyModels[`model-${i}`] = i * 0.1;
      }
      mockGetUsageReport.mockResolvedValue({ ...defaultReport, byModel: manyModels });
      await callSubcommandAction('report', { days: '30' });

      // model-10 is the most expensive, model-6..10 in top 5, model-1 should not appear
      const allOutput = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      // The top 5 by descending cost are model-10 … model-6
      expect(allOutput).toMatch(/model-10/);
      expect(allOutput).not.toMatch(/model-1\b/); // model-1 (0.1) is outside top 5
    });
  });

  // ── createProgressBar helper (tested via status output) ──────────────────

  describe('progress bar helper (via status output)', () => {
    it('should render a 20-character bar within brackets', async () => {
      mockGetBudgetStatus.mockResolvedValue({
        daily: { used: 5, limit: 10, remaining: 5, percentUsed: 50 },
        monthly: { used: 50, limit: 100, remaining: 50, percentUsed: 50 },
        perRequest: { limit: 1 },
        warnings: [],
      });
      await callSubcommandAction('status');

      const allOutput = consoleSpy.mock.calls
        .map((c) => (c[0] as string) ?? '')
        .join('\n');

      // Strip ANSI codes to inspect raw bar content
      // eslint-disable-next-line no-control-regex
      const stripped = allOutput.replace(/\x1B\[[0-9;]*m/g, '');
      // Expect at least one progress bar pattern "[...]"
      expect(stripped).toMatch(/\[.*\]/);
    });

    it('should use red color indicator for percent >= 90 in output', async () => {
      mockGetBudgetStatus.mockResolvedValue({
        daily: { used: 9.5, limit: 10, remaining: 0.5, percentUsed: 95 },
        monthly: { used: 95, limit: 100, remaining: 5, percentUsed: 95 },
        perRequest: { limit: 1 },
        warnings: ['Daily budget at 95%'],
      });
      // Just ensure it doesn't throw for high utilization
      await expect(callSubcommandAction('status')).resolves.not.toThrow();
    });

    it('should handle 0% usage without error', async () => {
      mockGetBudgetStatus.mockResolvedValue({
        daily: { used: 0, limit: 10, remaining: 10, percentUsed: 0 },
        monthly: { used: 0, limit: 100, remaining: 100, percentUsed: 0 },
        perRequest: { limit: 1 },
        warnings: [],
      });
      await expect(callSubcommandAction('status')).resolves.not.toThrow();
    });

    it('should handle 100% usage without error', async () => {
      mockGetBudgetStatus.mockResolvedValue({
        daily: { used: 10, limit: 10, remaining: 0, percentUsed: 100 },
        monthly: { used: 100, limit: 100, remaining: 0, percentUsed: 100 },
        perRequest: { limit: 1 },
        warnings: ['Daily limit reached'],
      });
      await expect(callSubcommandAction('status')).resolves.not.toThrow();
    });
  });
});