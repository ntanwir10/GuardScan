import fs from 'fs';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { LOCResult } from '../../src/core/loc-counter';
import type { RepositoryInfo } from '../../src/core/repository';

const repositoryFixture: RepositoryInfo = {
  repoId: 'fixture-id',
  name: 'fixture',
  path: process.cwd(),
  isGit: false,
};
const locFixture: LOCResult = {
  totalLines: 0,
  codeLines: 0,
  commentLines: 0,
  blankLines: 0,
  fileCount: 0,
  fileBreakdown: [],
};

const loadOrInit = jest.fn<() => any>();
const getRepoInfo = jest.fn<() => any>();
const countLoc = jest.fn<() => Promise<any>>();
const saveReport = jest.fn<() => Promise<string>>();
const runSecurityScan = jest.fn<() => Promise<any>>();

jest.mock('../../src/core/config', () => ({
  ...(jest.requireActual('../../src/core/config') as object),
  configManager: { loadOrInit },
}));

jest.mock('../../src/core/repository', () => ({
  repositoryManager: { getRepoInfo },
}));

jest.mock('../../src/core/loc-counter', () => ({
  locCounter: { count: countLoc },
}));

jest.mock('../../src/utils/reporter', () => ({
  reporter: { saveReport },
}));

jest.mock('../../src/core/scan-engine', () => ({
  scanEngine: { runSecurityScan },
}));

jest.mock('../../src/core/code-metrics', () => ({
  codeMetricsAnalyzer: { analyze: jest.fn(async () => []) },
}));

jest.mock('../../src/core/code-smells', () => ({
  codeSmellDetector: { detect: jest.fn(async () => []) },
}));

jest.mock('../../src/core/telemetry', () => ({
  createTelemetryManager: jest.fn(),
}));

jest.mock('../../src/utils/ascii-art', () => ({
  displaySimpleBanner: jest.fn(),
}));

jest.mock('../../src/utils/debug-logger', () => ({
  createDebugLogger: () => ({
    debug: jest.fn(),
    performance: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('../../src/utils/performance-tracker', () => ({
  createPerformanceTracker: () => ({
    start: jest.fn(),
    end: jest.fn(() => 0),
    displaySummary: jest.fn(),
  }),
}));

jest.mock('../../src/utils/progress', () => ({
  createProgressBar: () => ({
    update: jest.fn(),
    stop: jest.fn(),
  }),
}));

jest.mock('../../src/utils/error-handler', () => ({
  handleCommandError: (error: unknown) => {
    throw error;
  },
}));

jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start() { return this; },
    succeed: jest.fn(),
    fail: jest.fn(),
  }),
}));

import { runCommand, runStaticAnalysis } from '../../src/commands/run';

describe('run command provider policy', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    loadOrInit.mockReset();
    getRepoInfo.mockReset();
    countLoc.mockReset();
    saveReport.mockReset();
    runSecurityScan.mockReset();
    process.exitCode = 0;
  });

  it('falls back to static analysis before reading source context when offline blocks cloud AI', async () => {
    loadOrInit.mockReturnValue({
      clientId: 'test-client',
      provider: 'openai',
      apiKey: 'test-key',
      telemetryEnabled: false,
      offlineMode: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsed: '2026-01-01T00:00:00.000Z',
    });
    getRepoInfo.mockReturnValue({
      name: 'test-repository',
      path: process.cwd(),
      repoId: 'test-repo',
      branch: 'main',
      isGit: true,
    });
    countLoc.mockResolvedValue({
      totalLines: 20,
      codeLines: 12,
      commentLines: 3,
      blankLines: 5,
      fileCount: 1,
      fileBreakdown: [{
        path: 'sensitive-source.ts',
        totalLines: 20,
        codeLines: 12,
        commentLines: 3,
        blankLines: 5,
        language: 'TypeScript',
      }],
    });
    runSecurityScan.mockResolvedValue({
      status: 'complete',
      findings: [],
      scannerResults: [],
      errors: [],
    });
    saveReport.mockResolvedValue('/tmp/guardscan-report.md');

    const sourceRead = jest.spyOn(fs, 'readFileSync');
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await runCommand({ withAi: true });

    expect(sourceRead).not.toHaveBeenCalled();
    expect(runSecurityScan).toHaveBeenCalledWith(
      expect.objectContaining({ offline: true, includeVulnerabilities: false })
    );
    expect(saveReport).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ provider: 'static-analysis' }),
      }),
      'markdown',
      undefined,
      'ai-review'
    );
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('Offline mode blocks the configured cloud AI provider')
    );
  });

  it('fails closed when a local scanner cannot complete', async () => {
    runSecurityScan.mockRejectedValue(new Error('scanner unavailable'));

    const review = await runStaticAnalysis(
      repositoryFixture,
      locFixture,
      undefined,
      { offline: true, runProjectCode: false, isolateProjectNetwork: false, includeCve: false, allowPartial: false }
    );

    expect(review.metadata).toMatchObject({
      operationalFailure: true,
      scannerCoverage: {
        status: 'failed',
        errors: [expect.objectContaining({message: 'scanner unavailable'})],
      },
    });
    expect(review.summary).toContain('Security coverage: failed');
  });

  it('fails closed when the local scan engine reports partial coverage', async () => {
    runSecurityScan.mockResolvedValue({
      status: 'partial',
      findings: [],
      scannerResults: [],
      errors: [],
    });

    const review = await runStaticAnalysis(
      repositoryFixture,
      locFixture,
      undefined,
      { offline: true, runProjectCode: false, isolateProjectNetwork: false, includeCve: false, allowPartial: false }
    );

    expect(review.metadata).toMatchObject({
      operationalFailure: true,
      scannerCoverage: {status: 'partial'},
    });
  });

  it('allows explicitly partial CVE coverage while preserving it in the report', async () => {
    runSecurityScan.mockResolvedValue({
      status: 'partial',
      findings: [{severity: 'high', category: 'dependency', file: 'package-lock.json'}],
      scannerResults: [{
        scanner: 'dependencies', status: 'failed', required: true,
        error: {message: 'KEV coverage unavailable'},
      }],
      errors: [{
        scanner: 'dependencies', code: 'KEV_COVERAGE_UNAVAILABLE',
        message: 'KEV coverage unavailable',
      }],
    });

    const review = await runStaticAnalysis(
      repositoryFixture,
      locFixture,
      undefined,
      {
        offline: false,
        runProjectCode: false,
        isolateProjectNetwork: false,
        includeCve: true,
        allowPartial: true,
      }
    );

    expect(review.metadata).toMatchObject({
      operationalFailure: false,
      scannerCoverage: {
        status: 'partial',
        errors: [expect.objectContaining({code: 'KEV_COVERAGE_UNAVAILABLE'})],
      },
    });
  });

  it('writes an explicit failed-coverage report and sets operational exit code 2', async () => {
    loadOrInit.mockReturnValue({
      provider: 'none', telemetryEnabled: false, offlineMode: true,
      createdAt: '2026-01-01T00:00:00.000Z', lastUsed: '2026-01-01T00:00:00.000Z',
    });
    getRepoInfo.mockReturnValue({name: 'fixture', path: process.cwd(), isGit: false});
    countLoc.mockResolvedValue({
      totalLines: 0, codeLines: 0, commentLines: 0, blankLines: 0,
      fileCount: 0, fileBreakdown: [],
    });
    runSecurityScan.mockRejectedValue(new Error('scanner unavailable'));
    saveReport.mockResolvedValue('/tmp/guardscan-report.md');
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await runCommand({withAi: false});

    expect(saveReport).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          operationalFailure: true,
          scannerCoverage: expect.objectContaining({status: 'failed'}),
        }),
      }),
      'markdown',
      undefined,
      'ai-review'
    );
    expect(process.exitCode).toBe(2);
  });
});
