import * as fs from 'fs';
import * as path from 'path';
import {
  createScanEnvelope,
  evaluateScanPolicy,
  ScanEngine,
  ScanEngineResult,
  ScanFinding,
  ScannerRunResult,
  serializeScanResult,
} from '../../src/core/scan-engine';

const Ajv = require('ajv');
const AjvDraft04 = require('ajv-draft-04');
const addFormats = require('ajv-formats');

function makeFinding(overrides: Partial<ScanFinding> = {}): ScanFinding {
  return {
    severity: 'critical',
    category: 'Hardcoded Secrets',
    file: 'src/index.ts',
    line: 10,
    description: 'Potential secret detected',
    suggestion: 'Use a secret manager',
    ruleId: 'guardscan.hardcoded-secrets',
    fingerprint: 'a'.repeat(64),
    scanners: ['patterns'],
    ...overrides,
  };
}

function makeScanner(overrides: Partial<ScannerRunResult> = {}): ScannerRunResult {
  return {
    scanner: 'patterns',
    required: true,
    status: 'succeeded',
    findings: [],
    rawCount: 0,
    findingCount: 0,
    deduplicatedCount: 0,
    durationMs: 5,
    ...overrides,
  };
}

function makeResult(overrides: Partial<ScanEngineResult> = {}): ScanEngineResult {
  const findings = overrides.findings || [makeFinding()];
  return {
    runId: '123e4567-e89b-42d3-a456-426614174000',
    startedAt: '2026-07-13T12:00:00.000Z',
    completedAt: '2026-07-13T12:00:00.042Z',
    status: 'complete',
    offline: true,
    durationMs: 42,
    repository: '.',
    findings,
    scannerResults: [makeScanner({ findings })],
    errors: [],
    ...overrides,
  };
}

describe('scan policy', () => {
  it('evaluates finding thresholds with explicit exit code semantics', () => {
    expect(evaluateScanPolicy(makeResult().findings, { failOn: 'high' })).toEqual({
      failed: true,
      operationalFailure: false,
      outcome: 'policy-failed',
      exitCode: 1,
      reasons: ['1 finding(s) at or above high severity'],
    });

    expect(evaluateScanPolicy(makeResult().findings, { maxFindings: 1 })).toEqual({
      failed: false,
      operationalFailure: false,
      outcome: 'passed',
      exitCode: 0,
      reasons: [],
    });
  });

  it('fails operationally for incomplete required scanners unless partial is allowed', () => {
    const failure = makeScanner({
      scanner: 'dependencies',
      status: 'failed',
      error: { code: 'ETIMEDOUT', message: 'dependencies scanner failed', retryable: true },
    });
    const result = makeResult({
      status: 'partial',
      scannerResults: [makeScanner(), failure],
      errors: [{ scanner: 'dependencies', ...failure.error! }],
    });

    expect(evaluateScanPolicy(result)).toMatchObject({
      failed: true,
      operationalFailure: true,
      outcome: 'operational-failed',
      exitCode: 2,
      reasons: ['Required scanner failure(s): dependencies'],
    });
    expect(evaluateScanPolicy(result, { allowPartial: true })).toMatchObject({
      failed: false,
      operationalFailure: false,
      outcome: 'passed',
      exitCode: 0,
    });
    expect(evaluateScanPolicy(result, { allowPartial: true, failOn: 'high' })).toMatchObject({
      failed: true,
      operationalFailure: false,
      outcome: 'policy-failed',
      exitCode: 1,
    });
  });
});

describe('scan engine execution contracts', () => {
  it('bounds concurrency and preserves registry order', async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 6 }, (_, index) => ({
      scanner: `scanner-${index}`,
      run: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 12 - index));
        active--;
        return [{
          severity: 'low' as const,
          category: `Rule ${5 - index}`,
          file: `src/file-${5 - index}.ts`,
          description: `Finding ${index}`,
        }];
      },
    }));

    const result = await new ScanEngine().runSecurityScan({
      repoPath: process.cwd(),
      files: [],
      concurrency: 2,
      scannerTasks: tasks,
    });

    expect(maxActive).toBe(2);
    expect(result.scannerResults.map(scanner => scanner.scanner)).toEqual(
      tasks.map(task => task.scanner)
    );
    expect(result.findings.map(finding => finding.file)).toEqual([
      'src/file-0.ts',
      'src/file-1.ts',
      'src/file-2.ts',
      'src/file-3.ts',
      'src/file-4.ts',
      'src/file-5.ts',
    ]);
  });

  it('reports scanner exceptions as partial rather than zero-finding success', async () => {
    const repoPath = process.cwd();
    const result = await new ScanEngine().runSecurityScan({
      repoPath,
      files: [],
      scannerTasks: [
        { scanner: 'patterns', run: async () => [] },
        {
          scanner: 'dependencies',
          run: async () => {
            const error = new Error(`token=do-not-leak while reading ${repoPath}/private/file.ts`);
            (error as NodeJS.ErrnoException).code = 'ETIMEDOUT';
            throw error;
          },
        },
      ],
    });

    expect(result.status).toBe('partial');
    expect(result.scannerResults[1]).toMatchObject({
      scanner: 'dependencies',
      required: true,
      status: 'failed',
      rawCount: 0,
      findingCount: 0,
    });
    expect(result.scannerResults[1].error).toMatchObject({
      code: 'ETIMEDOUT',
      retryable: true,
    });
    expect(result.scannerResults[1].error?.message).toContain('token=<redacted>');
    expect(result.scannerResults[1].error?.message).toContain('<repo>');
    expect(result.scannerResults[1].error?.message).not.toContain('do-not-leak');
    expect(result.errors).toHaveLength(1);
  });

  it('reports failed when every required scanner fails and treats expected skips as complete', async () => {
    const failed = await new ScanEngine().runSecurityScan({
      repoPath: process.cwd(),
      files: [],
      scannerTasks: [
        { scanner: 'one', run: async () => { throw new Error('broken'); } },
        { scanner: 'two', run: async () => { throw new Error('broken'); } },
      ],
    });
    const skipped = await new ScanEngine().runSecurityScan({
      repoPath: process.cwd(),
      files: [],
      scannerTasks: [
        { scanner: 'not-applicable', skipReason: 'not-applicable', run: async () => [] },
      ],
    });

    expect(failed.status).toBe('failed');
    expect(skipped.status).toBe('complete');
    expect(skipped.scannerResults[0]).toMatchObject({
      status: 'skipped',
      skipped: true,
      skipReason: 'not-applicable',
    });
  });

  it('deduplicates exact findings and produces stable fingerprints', async () => {
    const duplicate = {
      severity: 'high' as const,
      category: 'Unsafe Call',
      file: 'src/example.ts',
      line: 7,
      description: 'Unsafe call found',
    };
    const engine = new ScanEngine();
    const first = await engine.runSecurityScan({
      repoPath: process.cwd(),
      files: [],
      scannerTasks: [{ scanner: 'one', run: async () => [duplicate, duplicate] }],
    });
    const second = await engine.runSecurityScan({
      repoPath: process.cwd(),
      files: [],
      scannerTasks: [{ scanner: 'one', run: async () => [duplicate] }],
    });

    expect(first.scannerResults[0]).toMatchObject({
      rawCount: 2,
      findingCount: 1,
      deduplicatedCount: 1,
    });
    expect(first.findings[0].fingerprint).toBe(second.findings[0].fingerprint);
    expect(first.findings[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects invalid concurrency before scanner execution', async () => {
    await expect(new ScanEngine().runSecurityScan({
      repoPath: process.cwd(),
      files: [],
      concurrency: 0,
      scannerTasks: [],
    })).rejects.toThrow('Use an integer from 1 to 16');
  });
});

describe('structured scan output', () => {
  it('serializes the comprehensive guardscan.scan.v1 envelope', () => {
    const output = JSON.parse(serializeScanResult(makeResult(), 'json', '/repo', {
      command: 'scan',
      ci: true,
      quality: { status: 'succeeded', tests: { failed: 0 } },
      sbom: { status: 'succeeded', packages: [] },
      ai: { status: 'not-requested' },
      policy: { failOn: 'high' },
      executionMode: 'project-code-executed',
    }));

    expect(output.schemaVersion).toBe('guardscan.scan.v1');
    expect(output.command).toBe('scan');
    expect(output.run).toMatchObject({
      status: 'complete',
      offline: true,
      ci: true,
      executionMode: 'project-code-executed',
    });
    expect(output.summary).toMatchObject({ critical: 1, total: 1 });
    expect(output.security.findings).toHaveLength(1);
    expect(output.quality.status).toBe('succeeded');
    expect(output.sbom.status).toBe('succeeded');
    expect(output.ai.status).toBe('not-requested');
    expect(output.policy).toMatchObject({ status: 'policy-failed', exitCode: 1 });
  });

  it('conforms to the bundled JSON schema', () => {
    const schemaPath = path.resolve(
      __dirname,
      '../../schemas/guardscan.scan.v1.schema.json'
    );
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    const validate = new Ajv({ allErrors: true }).compile(schema);
    const envelope = JSON.parse(serializeScanResult(makeResult(), 'json'));

    expect(validate(envelope)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it('serializes schema-safe SARIF without pseudo-fixes', () => {
    const failedScanner = makeScanner({
      scanner: 'dependencies',
      status: 'failed',
      error: {
        code: 'SCANNER_FAILED',
        message: 'dependencies scanner failed: service unavailable',
        retryable: true,
      },
    });
    const result = makeResult({
      status: 'partial',
      findings: [makeFinding({ file: 'src/file name#1.ts' })],
      scannerResults: [makeScanner(), failedScanner],
      errors: [{ scanner: 'dependencies', ...failedScanner.error! }],
    });
    const output = JSON.parse(serializeScanResult(result, 'sarif', '/repo'));
    const sarifResult = output.runs[0].results[0];

    expect(output.$schema).toContain('docs.oasis-open.org');
    expect(output.version).toBe('2.1.0');
    expect(output.runs[0].invocations[0].executionSuccessful).toBe(false);
    expect(output.runs[0].invocations[0].toolExecutionNotifications[0]).toMatchObject({
      level: 'error',
    });
    expect(sarifResult.locations[0].physicalLocation.artifactLocation.uri)
      .toBe('src/file%20name%231.ts');
    expect(sarifResult.partialFingerprints['guardscanFinding/v1']).toMatch(/^[a-f0-9]{64}$/);
    expect(sarifResult).not.toHaveProperty('fixes');
    expect(sarifResult.properties.suggestion).toBe('Use a secret manager');
  });

  it('preserves dependency KEV state and enrichment metadata in JSON and SARIF', () => {
    const finding = makeFinding({
      category: 'Dependency Vulnerability (npm)',
      ruleId: 'CVE-2026-1234',
      metadata: {
        knownExploited: 'unknown',
        knownExploitedEnrichment: {
          status: 'unavailable',
          source: 'cisa-kev',
          error: { code: 'NETWORK_ERROR', message: 'KEV unavailable' },
        },
      },
    });
    const result = makeResult({ findings: [finding] });

    const json = JSON.parse(serializeScanResult(result, 'json', '/repo'));
    expect(json.security.findings[0].metadata).toEqual(finding.metadata);
    expect(json.security.knownExploitedEnrichment).toEqual(
      finding.metadata?.knownExploitedEnrichment
    );

    const sarif = JSON.parse(serializeScanResult(result, 'sarif', '/repo'));
    expect(sarif.runs[0].results[0].properties).toEqual(expect.objectContaining(finding.metadata));
    expect(sarif.runs[0].invocations[0].properties.knownExploitedEnrichment).toEqual(
      finding.metadata?.knownExploitedEnrichment
    );
  });

  it('preserves unavailable KEV coverage in invocation metadata with zero findings', () => {
    const result = makeResult({
      findings: [],
      status: 'partial',
      errors: [{
        scanner: 'dependencies',
        code: 'KEV_COVERAGE_UNAVAILABLE',
        message: 'KEV unavailable',
        retryable: true,
      }],
    });

    const json = JSON.parse(serializeScanResult(result, 'json', '/repo'));
    const sarif = JSON.parse(serializeScanResult(result, 'sarif', '/repo'));

    expect(json.security.knownExploitedEnrichment).toMatchObject({
      status: 'unavailable', source: 'cisa-kev',
    });
    expect(sarif.runs[0].invocations[0].properties.knownExploitedEnrichment)
      .toMatchObject({status: 'unavailable', source: 'cisa-kev'});
  });

  it('validates emitted SARIF against the official OASIS errata01 schema', () => {
    // Vendored verbatim from the authoritative URL carried in the schema id.
    const schemaPath = path.resolve(__dirname, '../../schemas/sarif-schema-2.1.0.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    const ajv = new AjvDraft04({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const output = JSON.parse(serializeScanResult(makeResult(), 'sarif', '/repo'));

    expect(validate(output)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it('marks SARIF execution unsuccessful for non-security operational failures', () => {
    const output = JSON.parse(serializeScanResult(makeResult(), 'sarif', '/repo', {
      executionStatus: 'partial',
      executionErrors: [{
        scanner: 'quality.tests',
        code: 'CHECK_FAILED',
        message: 'tests check failed',
        retryable: false,
      }],
    }));

    expect(output.runs[0].invocations[0].executionSuccessful).toBe(false);
    expect(output.runs[0].invocations[0].toolExecutionNotifications[0].message.text)
      .toBe('tests check failed');
  });

  it('keeps locationless git-history findings out of physical locations', () => {
    const result = makeResult({
      findings: [makeFinding({ file: 'commit:abc123' })],
    });
    const output = JSON.parse(serializeScanResult(result, 'sarif', '/repo'));

    expect(output.runs[0].results[0]).not.toHaveProperty('locations');
  });

  it('creates explicit skipped sections when optional inputs are unavailable', () => {
    const envelope = createScanEnvelope(makeResult());

    expect(envelope.quality).toEqual({ status: 'skipped', reason: 'not-provided' });
    expect(envelope.sbom).toEqual({ status: 'skipped', reason: 'not-provided' });
    expect(envelope.ai).toEqual({ status: 'skipped', reason: 'not-requested' });
    expect(envelope.run.executionMode).toBe('static-analysis');
  });
});
