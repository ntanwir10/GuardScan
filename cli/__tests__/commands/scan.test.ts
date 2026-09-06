import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  evaluateComprehensivePolicy,
  runQualityAnalysis,
} from '../../src/commands/scan';
import { codeMetricsAnalyzer } from '../../src/core/code-metrics';
import { codeSmellDetector } from '../../src/core/code-smells';
import { linterIntegration } from '../../src/core/linter-integration';
import { testRunner } from '../../src/core/test-runner';

describe('runQualityAnalysis partial tool execution', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-quality-partial-'));
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      devDependencies: { eslint: '^8.0.0', jest: '^29.0.0' },
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(repository, { recursive: true, force: true });
  });

  it('keeps successful reports while marking retained runner failures operational', async () => {
    jest.spyOn(testRunner, 'runTests').mockResolvedValue([
      {
        framework: 'Jest', totalTests: 0, passed: 0, failed: 0, skipped: 0,
        duration: 0, failures: [], executionError: 'Jest execution failed before reporting',
      },
      {
        framework: 'pytest', totalTests: 1, passed: 0, failed: 1, skipped: 0,
        duration: 1, failures: [{ testName: 'fixture', error: 'assertion failed' }],
      },
    ]);
    jest.spyOn(linterIntegration, 'runAll').mockResolvedValue([
      {
        linter: 'ESLint', results: [], totalIssues: 0, errors: 0, warnings: 0, info: 0,
        executionError: 'ESLint execution failed before reporting',
      },
      {
        linter: 'Flake8', results: [{
          file: 'fixture.py', line: 1, column: 1, severity: 'error',
          rule: 'E999', message: 'fixture lint error', linter: 'Flake8',
        }], totalIssues: 1, errors: 1, warnings: 0, info: 0,
      },
    ]);
    jest.spyOn(codeMetricsAnalyzer, 'analyze').mockResolvedValue([]);
    jest.spyOn(codeSmellDetector, 'detect').mockResolvedValue([]);

    const quality = await runQualityAnalysis(repository, {}, {
      offline: false,
      runProjectCode: true,
      isolateProjectNetwork: false,
      includeCve: false,
      allowPartial: true,
    });

    expect(quality.status).toBe('partial');
    expect(quality.checks.tests).toMatchObject({
      status: 'failed',
      error: { code: 'TOOL_EXECUTION_PARTIAL', message: expect.stringMatching(/Jest execution failed/) },
      data: expect.arrayContaining([expect.objectContaining({ framework: 'pytest', failed: 1 })]),
    });
    expect(quality.checks.lint).toMatchObject({
      status: 'failed',
      error: { code: 'TOOL_EXECUTION_PARTIAL', message: expect.stringMatching(/ESLint execution failed/) },
      data: expect.arrayContaining([expect.objectContaining({ linter: 'Flake8' })]),
    });

    const evaluation = evaluateComprehensivePolicy({
      runId: 'fixture',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      status: 'complete',
      findings: [],
      scannerResults: [],
      errors: [],
      durationMs: 1_000,
      offline: true,
      repository,
    }, quality, { status: 'succeeded', document: {} }, { allowPartial: true });

    expect(evaluation.result).toMatchObject({
      outcome: 'policy-failed',
      exitCode: 1,
      reasons: expect.arrayContaining(['1 test(s) failed', '1 lint error(s) found']),
    });
  });
});
