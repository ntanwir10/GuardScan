import {
  evaluateComprehensivePolicy,
  QualitySection,
  runQualityAnalysis,
  SbomSection,
} from '../../src/commands/scan';
import { ScanEngineResult } from '../../src/core/scan-engine';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function securityResult(): ScanEngineResult {
  return {
    runId: '123e4567-e89b-42d3-a456-426614174000',
    startedAt: '2026-07-13T00:00:00.000Z',
    completedAt: '2026-07-13T00:00:00.001Z',
    status: 'complete',
    findings: [],
    scannerResults: [],
    errors: [],
    durationMs: 1,
    offline: true,
    repository: '.',
  };
}

function quality(overrides: Partial<QualitySection['checks']> = {}): QualitySection {
  const succeeded = { status: 'succeeded' as const, durationMs: 1, data: [] };
  return {
    status: 'complete',
    checks: {
      tests: succeeded,
      metrics: succeeded,
      smells: succeeded,
      lint: succeeded,
      performance: { status: 'skipped', durationMs: 0, reason: 'not-run' },
      mutation: { status: 'skipped', durationMs: 0, reason: 'not-run' },
      ...overrides,
    },
  };
}

const sbom: SbomSection = { status: 'succeeded', document: { packages: [] } };

describe('comprehensive scan quality policy', () => {
  it('returns policy exit 1 for failing tests and lint findings', () => {
    const evaluation = evaluateComprehensivePolicy(
      securityResult(),
      quality({
        tests: { status: 'succeeded', durationMs: 1, data: [{ failed: 2 }] },
        lint: { status: 'succeeded', durationMs: 1, data: [{ errors: 3 }] },
      }),
      sbom,
      {}
    );

    expect(evaluation.result).toMatchObject({
      outcome: 'policy-failed',
      exitCode: 1,
      reasons: ['2 test(s) failed', '3 lint error(s) found'],
    });
  });

  it('returns operational exit 2 for a failed quality tool', () => {
    const failedQuality = quality({
      tests: {
        status: 'failed',
        durationMs: 1,
        error: { code: 'CHECK_FAILED', message: 'tests check failed', retryable: false },
      },
    });
    failedQuality.status = 'partial';

    const evaluation = evaluateComprehensivePolicy(securityResult(), failedQuality, sbom, {});

    expect(evaluation.result).toMatchObject({
      operationalFailure: true,
      outcome: 'operational-failed',
      exitCode: 2,
      reasons: ['Quality check failed to execute: tests'],
    });
    expect(evaluation.errors[0]).toMatchObject({ scanner: 'quality.tests' });
  });

  it('treats an incomplete SBOM inventory as operationally partial', () => {
    const incompleteSbom: SbomSection = {
      status: 'partial',
      document: { packages: [] },
      error: {
        code: 'INVENTORY_INCOMPLETE',
        message: 'SBOM inventory is incomplete',
        retryable: false,
      },
    };

    const evaluation = evaluateComprehensivePolicy(
      securityResult(),
      quality(),
      incompleteSbom,
      {}
    );

    expect(evaluation.result).toMatchObject({
      outcome: 'operational-failed',
      exitCode: 2,
      reasons: ['SBOM inventory is incomplete'],
    });
    expect(evaluation.executionStatus).toBe('partial');
  });

  it('allows explicitly partial coverage without hiding policy failures', () => {
    const partialQuality = quality({
      tests: {
        status: 'failed',
        durationMs: 1,
        error: { code: 'CHECK_FAILED', message: 'tests check failed', retryable: false },
      },
      lint: { status: 'succeeded', durationMs: 1, data: [{ errors: 1 }] },
    });
    partialQuality.status = 'partial';
    const security = securityResult();
    security.findings = [{
      severity: 'high',
      category: 'Unsafe dependency',
      file: 'package-lock.json',
      description: 'Known vulnerable package',
      ruleId: 'CVE-2026-0001',
      fingerprint: 'a'.repeat(64),
      scanners: ['dependencies'],
    }];

    const evaluation = evaluateComprehensivePolicy(
      security,
      partialQuality,
      sbom,
      { allowPartial: true, failOn: 'high' }
    );

    expect(evaluation.result).toMatchObject({
      operationalFailure: true,
      outcome: 'operational-failed',
      exitCode: 2,
      reasons: [
        'Quality check failed to execute: tests',
        '1 finding(s) at or above high severity',
        '1 lint error(s) found',
      ],
    });
  });

  it('does not let allow-partial hide local scanner failures', () => {
    const failedQuality = quality({
      metrics: {
        status: 'failed',
        durationMs: 1,
        error: { code: 'CHECK_FAILED', message: 'metrics check failed', retryable: false },
      },
    });
    failedQuality.status = 'partial';

    const evaluation = evaluateComprehensivePolicy(
      securityResult(),
      failedQuality,
      sbom,
      { allowPartial: true }
    );

    expect(evaluation.result).toMatchObject({
      operationalFailure: true,
      outcome: 'operational-failed',
      exitCode: 2,
      reasons: ['Quality check failed to execute: metrics'],
    });
  });

  it('does not execute a malicious repository test script in the default scan mode', async () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-untrusted-'));
    const marker = path.join(repository, 'project-code-ran');
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      name: 'untrusted-fixture',
      scripts: {test: `node -e "require('fs').writeFileSync('${marker}', 'ran')"`},
      devDependencies: {jest: '29.7.0', eslint: '8.0.0'},
    }));
    try {
      const result = await runQualityAnalysis(repository, {}, {
        offline: false,
        runProjectCode: false,
        isolateProjectNetwork: false,
        includeCve: false,
        allowPartial: false,
      });

      expect(fs.existsSync(marker)).toBe(false);
      expect(result.checks.tests).toMatchObject({
        status: 'skipped', reason: 'project-code-execution-not-enabled',
      });
      expect(result.checks.lint).toMatchObject({
        status: 'skipped', reason: 'project-code-execution-not-enabled',
      });
    } finally {
      fs.rmSync(repository, {recursive: true, force: true});
    }
  });
});
