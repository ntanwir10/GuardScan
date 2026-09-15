import {securityReview} from '../../src/commands/security';
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
