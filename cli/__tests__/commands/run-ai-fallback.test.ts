import { jest } from '@jest/globals';

const saveReport = jest.fn<() => Promise<string>>().mockResolvedValue('/tmp/guardscan-static.md');
const chat = jest.fn<() => Promise<never>>().mockRejectedValue(new Error('local daemon is unavailable'));

jest.mock('../../src/core/config', () => ({
  configManager: { loadOrInit: jest.fn() },
}));
jest.mock('../../src/core/repository', () => ({
  repositoryManager: { getRepoInfo: jest.fn() },
}));
jest.mock('../../src/core/loc-counter', () => ({
  locCounter: { count: jest.fn() },
}));
jest.mock('../../src/providers/factory', () => ({
  ProviderFactory: { createForCli: jest.fn() },
  ProviderConfigurationError: class ProviderConfigurationError extends Error {},
}));
jest.mock('../../src/utils/reporter', () => ({
  reporter: { saveReport },
}));
jest.mock('../../src/utils/progress', () => ({
  createProgressBar: jest.fn(() => ({ update: jest.fn(), stop: jest.fn() })),
}));
jest.mock('../../src/utils/ascii-art', () => ({ displaySimpleBanner: jest.fn() }));
jest.mock('../../src/utils/performance-tracker', () => ({
  createPerformanceTracker: jest.fn(() => ({
    start: jest.fn(), end: jest.fn().mockReturnValue(1), displaySummary: jest.fn(),
  })),
}));
jest.mock('../../src/utils/error-handler', () => ({
  handleCommandError: jest.fn((error: unknown, _context: string, exitCode?: number) => {
    process.exitCode = exitCode;
    throw error;
  }),
}));
jest.mock('../../src/core/scan-engine', () => ({
  scanEngine: { runSecurityScan: jest.fn<() => Promise<any>>().mockResolvedValue({
    findings: [], status: 'complete', scannerResults: [], errors: [],
  }) },
}));
jest.mock('../../src/core/code-metrics', () => ({ codeMetricsAnalyzer: { analyze: jest.fn<() => Promise<any[]>>().mockResolvedValue([]) } }));
jest.mock('../../src/core/code-smells', () => ({ codeSmellDetector: { detect: jest.fn<() => Promise<any[]>>().mockResolvedValue([]) } }));

import { runCommand } from '../../src/commands/run';
import { configManager } from '../../src/core/config';
import { repositoryManager } from '../../src/core/repository';
import { locCounter } from '../../src/core/loc-counter';
import { ProviderFactory } from '../../src/providers/factory';

describe('run command optional AI fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;
    jest.mocked(configManager.loadOrInit).mockReturnValue({
      provider: 'ollama', telemetryEnabled: false, offlineMode: false,
      createdAt: '2026-01-01T00:00:00.000Z', lastUsed: '2026-01-01T00:00:00.000Z',
      apiEndpoint: 'http://127.0.0.1:11434',
    } as any);
    jest.mocked(repositoryManager.getRepoInfo).mockReturnValue({
      name: 'fixture', path: '/tmp/fixture', repoId: 'fixture', branch: 'main',
    } as any);
    jest.mocked(locCounter.count).mockResolvedValue({
      totalLines: 1, codeLines: 1, commentLines: 0, blankLines: 0, fileCount: 1, fileBreakdown: [],
    } as any);
    jest.mocked(ProviderFactory.createForCli).mockReturnValue({
      getName: () => 'Ollama', chat,
    } as any);
  });

  it('saves truthful static results when optional AI enhancement fails', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await runCommand({ withAi: true });

    expect(saveReport).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          executionMode: 'static-analysis',
          operationalFailure: false,
          scannerCoverage: expect.objectContaining({
            status: 'partial',
            errors: expect.arrayContaining([expect.objectContaining({
              scanner: 'ai-enhancement',
              code: 'AI_ENHANCEMENT_FAILED',
            })]),
          }),
        }),
        findings: [],
      }),
      'markdown', undefined, 'ai-review'
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/AI enhancement failed/i));
    expect(process.exitCode).toBeUndefined();
    expect(chat).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
