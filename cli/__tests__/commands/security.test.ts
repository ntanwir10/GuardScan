import {securityReview} from '../../src/commands/security';
import {securityCommand} from '../../src/commands/security';
import {configManager} from '../../src/core/config';
import {locCounter} from '../../src/core/loc-counter';
import {scanEngine} from '../../src/core/scan-engine';
import {repositoryManager} from '../../src/core/repository';
import type {ScanEngineResult, ScanPolicyResult} from '../../src/core/scan-engine';
import {Reporter} from '../../src/utils/reporter';

describe('security Markdown coverage', () => {
  it('records retained scanner failures even when partial-mode policy passes', () => {
    const scanResult: ScanEngineResult = {
      runId: 'fixture',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      status: 'partial',
      findings: [],
      scannerResults: [{
        scanner: 'secrets', required: true, status: 'failed', findings: [], rawCount: 0,
        findingCount: 0, deduplicatedCount: 0, durationMs: 1,
        error: {code: 'SECRET_SCAN_PARTIAL', message: 'one input was unreadable', retryable: true},
      }],
      errors: [{
        scanner: 'secrets', code: 'SECRET_SCAN_PARTIAL', message: 'one input was unreadable', retryable: true,
      }],
      durationMs: 1_000,
      offline: true,
      repository: '/fixture',
    };
    const policy: ScanPolicyResult = {
      failed: false,
      operationalFailure: false,
      outcome: 'passed',
      exitCode: 0,
      reasons: [],
    };
    const review = securityReview(
      scanResult,
      policy,
      {repoId: 'fixture', name: 'fixture', path: '/fixture', isGit: false},
      {
        totalLines: 0, codeLines: 0, commentLines: 0, blankLines: 0,
        fileCount: 0, fileBreakdown: [], skippedFiles: [],
      },
      1_000
    );

    const markdown = new Reporter().generateMarkdown(review);

    expect(markdown).toContain('**Scanner coverage:** partial');
    expect(markdown).toContain('**secrets:** failed (required) - one input was unreadable');
    expect(markdown).toContain('**secrets error (SECRET_SCAN_PARTIAL):** one input was unreadable');
    expect(markdown).toContain('Policy: passed');
  });
});

describe('security command file selection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('marks user-provided files as an explicit secret-scan scope', async () => {
    const config = jest.spyOn(configManager, 'loadOrInit').mockReturnValue({
      provider: 'none', telemetryEnabled: false, offlineMode: true,
      createdAt: '2026-01-01T00:00:00.000Z', lastUsed: '2026-01-01T00:00:00.000Z',
    } as any);
    jest.spyOn(repositoryManager, 'getRepoInfo').mockReturnValue({
      repoId: 'fixture', name: 'fixture', path: '/fixture', isGit: false,
    } as any);
    jest.spyOn(locCounter, 'count').mockResolvedValue({
      totalLines: 1, codeLines: 1, commentLines: 0, blankLines: 0,
      fileCount: 1, fileBreakdown: [{path: '/fixture/src/selected.ts'}], skippedFiles: [],
    } as any);
    jest.spyOn(scanEngine, 'runSecurityScan').mockResolvedValue({
      runId: 'fixture', startedAt: '', completedAt: '', status: 'complete', findings: [],
      scannerResults: [], errors: [], durationMs: 0, offline: true, repository: '/fixture',
    });
    const saveReport = jest.spyOn(Reporter.prototype, 'saveReport').mockResolvedValue('/tmp/security.md');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await securityCommand({files: ['src/selected.ts']});

    expect(scanEngine.runSecurityScan).toHaveBeenCalledWith(expect.objectContaining({
      files: [{path: '/fixture/src/selected.ts'}],
      fileSelection: 'explicit',
    }));
    expect(saveReport).toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    expect(config).toHaveBeenCalled();
  });
});
