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
import type { ScanEngineResult } from '../../src/core/scan-engine';

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

  it('does not advertise unsupported Vitest execution as a configured test adapter', async () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      scripts: {test: 'vitest'},
      devDependencies: {vitest: '^3.0.0'},
    }));
    jest.spyOn(testRunner, 'runTests').mockResolvedValue([]);
    jest.spyOn(linterIntegration, 'runAll').mockResolvedValue([]);
    jest.spyOn(codeMetricsAnalyzer, 'analyze').mockResolvedValue([]);
    jest.spyOn(codeSmellDetector, 'detect').mockResolvedValue([]);

    const quality = await runQualityAnalysis(repository, {}, {
      offline: false,
      runProjectCode: true,
      isolateProjectNetwork: false,
      includeCve: false,
      allowPartial: false,
    });

    expect(quality.checks.tests).toMatchObject({status: 'succeeded', data: []});
  });

  it.each([
    ['Flake8', '.flake8', '[flake8]\nmax-line-length = 100\n'],
    ['Pylint', '.pylintrc', '[MAIN]\n'],
    ['Go', 'go.mod', 'module example.test/fixture\ngo 1.22\n'],
    ['golangci-lint', '.golangci.yml', 'linters:\n  enable:\n    - govet\n'],
    ['Rubocop', '.rubocop.yml', 'AllCops:\n  NewCops: enable\n'],
    ['PHP_CodeSniffer', 'phpcs.xml', '<ruleset name="fixture" />\n'],
  ])('fails closed when configured %s produces no report', async (_tool, configFile, contents) => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({name: 'fixture'}));
    fs.writeFileSync(path.join(repository, configFile), contents);
    jest.spyOn(testRunner, 'runTests').mockResolvedValue([]);
    jest.spyOn(linterIntegration, 'runAll').mockResolvedValue([]);
    jest.spyOn(codeMetricsAnalyzer, 'analyze').mockResolvedValue([]);
    jest.spyOn(codeSmellDetector, 'detect').mockResolvedValue([]);

    const quality = await runQualityAnalysis(repository, {}, {
      offline: false,
      runProjectCode: true,
      isolateProjectNetwork: false,
      includeCve: false,
      allowPartial: false,
    });

    expect(quality.checks.lint).toMatchObject({
      status: 'failed',
      error: {code: 'TOOL_OUTPUT_UNAVAILABLE'},
    });
  });

  it('honors partial mode for retained local scanner failures', () => {
    const security: ScanEngineResult = {
      runId: 'fixture',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      status: 'partial',
      findings: [],
      scannerResults: [{
        scanner: 'secrets', required: true, status: 'failed', findings: [],
        rawCount: 0, findingCount: 0, deduplicatedCount: 0, durationMs: 1,
        error: {code: 'SECRET_SCAN_PARTIAL', message: 'one unreadable source file', retryable: true},
      }],
      errors: [{scanner: 'secrets', code: 'SECRET_SCAN_PARTIAL', message: 'one unreadable source file', retryable: true}],
      durationMs: 1_000,
      offline: true,
      repository,
    };
    const succeeded = {status: 'succeeded' as const, durationMs: 1, data: []};
    const evaluation = evaluateComprehensivePolicy(security, {
      status: 'complete',
      checks: {
        tests: succeeded,
        metrics: succeeded,
        smells: succeeded,
        lint: succeeded,
        performance: succeeded,
        mutation: succeeded,
      },
    }, {status: 'succeeded', document: {}}, {allowPartial: true});

    expect(evaluation.result).toMatchObject({
      failed: false,
      operationalFailure: false,
      outcome: 'passed',
      exitCode: 0,
    });
    expect(evaluation.executionStatus).toBe('partial');
    expect(evaluation.errors).toEqual([
      expect.objectContaining({scanner: 'secrets', code: 'SECRET_SCAN_PARTIAL'}),
    ]);
  });

  it('keeps a complete security-section failure operational in partial mode', () => {
    const security: ScanEngineResult = {
      runId: 'fixture',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      status: 'failed',
      findings: [],
      scannerResults: [{
        scanner: 'secrets', required: true, status: 'failed', findings: [],
        rawCount: 0, findingCount: 0, deduplicatedCount: 0, durationMs: 1,
        error: {code: 'SCANNER_FAILED', message: 'scanner unavailable', retryable: true},
      }],
      errors: [{scanner: 'secrets', code: 'SCANNER_FAILED', message: 'scanner unavailable', retryable: true}],
      durationMs: 1_000,
      offline: true,
      repository,
    };
    const succeeded = {status: 'succeeded' as const, durationMs: 1, data: []};

    expect(evaluateComprehensivePolicy(security, {
      status: 'complete',
      checks: {
        tests: succeeded,
        metrics: succeeded,
        smells: succeeded,
        lint: succeeded,
        performance: succeeded,
        mutation: succeeded,
      },
    }, {status: 'succeeded', document: {}}, {allowPartial: true}).result).toMatchObject({
      operationalFailure: true,
      outcome: 'operational-failed',
      exitCode: 2,
    });
  });
});
