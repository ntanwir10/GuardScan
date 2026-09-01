import { testCommand } from '../../src/commands/test';
import { testRunner } from '../../src/core/test-runner';
import { linterIntegration } from '../../src/core/linter-integration';
import { handleCommandError } from '../../src/utils/error-handler';
import { NetworkIsolationError } from '../../src/utils/process-runner';

jest.mock('../../src/core/test-runner', () => ({
  testRunner: { runTests: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../src/core/linter-integration', () => ({
  linterIntegration: { runAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../src/core/code-metrics', () => ({
  codeMetricsAnalyzer: { analyze: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../src/core/code-smells', () => ({
  codeSmellDetector: { detect: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../src/utils/reporter', () => ({
  reporter: { saveReport: jest.fn().mockResolvedValue('/tmp/quality.md') },
}));
jest.mock('../../src/core/config', () => ({
  configManager: { exists: jest.fn().mockReturnValue(false) },
}));
jest.mock('../../src/core/telemetry', () => ({
  createTelemetryManager: jest.fn(),
}));
jest.mock('../../src/core/repository', () => ({
  repositoryManager: { getRepoInfo: jest.fn().mockReturnValue({ name: 'fixture' }) },
}));
jest.mock('../../src/utils/progress', () => ({
  createProgressBar: jest.fn().mockReturnValue({ update: jest.fn(), stop: jest.fn() }),
}));
jest.mock('../../src/utils/debug-logger', () => ({
  createDebugLogger: jest.fn().mockReturnValue({ debug: jest.fn() }),
}));
jest.mock('../../src/utils/performance-tracker', () => ({
  createPerformanceTracker: jest.fn().mockReturnValue({ start: jest.fn(), end: jest.fn() }),
}));
jest.mock('../../src/utils/error-handler', () => ({
  handleCommandError: jest.fn(),
}));

describe('testCommand execution policy', () => {
  const originalOffline = process.env.GUARDSCAN_OFFLINE;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.GUARDSCAN_OFFLINE = 'true';
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.mocked(testRunner.runTests).mockClear();
    jest.mocked(linterIntegration.runAll).mockClear();
    jest.mocked(handleCommandError).mockClear();
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalOffline === undefined) {delete process.env.GUARDSCAN_OFFLINE;}
    else {process.env.GUARDSCAN_OFFLINE = originalOffline;}
  });

  it('passes the offline project-execution policy to tests and linters', async () => {
    await testCommand({ all: true });

    const expectedPolicy = expect.objectContaining({
      offline: true,
      runProjectCode: false,
    });
    expect(testRunner.runTests).toHaveBeenCalledWith(process.cwd(), false, expectedPolicy);
    expect(linterIntegration.runAll).toHaveBeenCalledWith(process.cwd(), expectedPolicy);
  });

  it.each([
    ['test runner', () => jest.mocked(testRunner.runTests).mockRejectedValueOnce(
      new NetworkIsolationError('test isolation unavailable')
    ), {}],
    ['linter', () => jest.mocked(linterIntegration.runAll).mockRejectedValueOnce(
      new NetworkIsolationError('linter isolation unavailable')
    ), { lint: true }],
  ] as const)('routes a %s isolation failure to command error handling', async (_name, fail, options) => {
    fail();

    await testCommand(options);

    expect(handleCommandError).toHaveBeenCalledWith(
      expect.any(NetworkIsolationError),
      'Test command'
    );
  });
});
