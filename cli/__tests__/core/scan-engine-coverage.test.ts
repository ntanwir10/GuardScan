import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createScanEnvelope,
  ScanEngine,
  ScanEngineOptions,
  ScanFile,
  ScannerTask,
  ScannerTaskOutput,
  serializeScanResult,
} from '../../src/core/scan-engine';
import {apiScanner} from '../../src/core/api-scanner';
import {complianceChecker} from '../../src/core/compliance-checker';
import {dockerfileScanner} from '../../src/core/dockerfile-scanner';
import {iacScanner} from '../../src/core/iac-scanner';
import {owaspScanner} from '../../src/core/owasp-scanner';
import {dependencyScanner} from '../../src/core/dependency-scanner';

type BuiltInTaskFactory = {
  createBuiltInTasks(
    options: ScanEngineOptions,
    repoPath: string,
    files: ScanFile[],
    offline: boolean
  ): ScannerTask[];
};

describe('ScanEngine built-in coverage adapters', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-coverage-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(repository, {recursive: true, force: true});
  });

  function tasks(files: ScanFile[] = [], skippedFiles: string[] = []): ScannerTask[] {
    return (new ScanEngine() as unknown as BuiltInTaskFactory).createBuiltInTasks(
      {includeVulnerabilities: false, includeGitHistory: false, skippedFiles},
      repository,
      files,
      true
    );
  }

  it('marks secret coverage incomplete when a selected file cannot be read', async () => {
    const output = await tasks([{path: path.join(repository, 'missing.ts')}])
      .find(task => task.scanner === 'secrets')!.run() as ScannerTaskOutput;

    expect(output).toMatchObject({
      findings: [],
      error: {code: 'SECRET_SCAN_PARTIAL', retryable: true},
    });
  });

  it('marks secret coverage incomplete when LOC discovery omitted an unreadable file', async () => {
    const output = await tasks([], ['unreadable.rs'])
      .find(task => task.scanner === 'secrets')!.run() as ScannerTaskOutput;

    expect(output).toMatchObject({
      findings: [],
      error: {code: 'SECRET_SCAN_PARTIAL', retryable: true},
    });
  });

  it('discovers ignored environment and configuration files independently of LOC inputs', async () => {
    fs.writeFileSync(path.join(repository, '.gitignore'), '.env\nconfig.yaml\n');
    fs.writeFileSync(path.join(repository, '.env'), 'AWS_ACCESS_KEY_ID=AKIA1234567890123456\n');
    fs.writeFileSync(
      path.join(repository, 'config.yaml'),
      'github_token: ghp_1234567890abcdefghijklmnopqrstuvwxyz\n'
    );

    const output = await tasks().find(task => task.scanner === 'secrets')!.run() as ScannerTaskOutput;
    const findings = Array.isArray(output) ? output : output.findings;

    expect(output).not.toHaveProperty('error');
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({file: fs.realpathSync(path.join(repository, '.env'))}),
      expect.objectContaining({file: fs.realpathSync(path.join(repository, 'config.yaml'))}),
    ]));
  });

  it('marks IaC coverage incomplete when selected YAML cannot be parsed', async () => {
    fs.writeFileSync(path.join(repository, 'deployment.yaml'), [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'spec: [unterminated',
    ].join('\n'));

    const output = await tasks().find(task => task.scanner === 'iac')!.run() as ScannerTaskOutput;

    expect(output).toMatchObject({
      findings: [],
      error: {code: 'IAC_SCAN_PARTIAL', retryable: true},
    });
  });

  it('preserves dependency enrichment metadata when no vulnerabilities are found', async () => {
    const enrichment = {status: 'disabled', source: 'cisa-kev'};
    const snapshotPersistenceError = {code: 'SNAPSHOT_PERSIST_FAILED', message: 'read-only cache'};
    const result = await new ScanEngine().runSecurityScan({
      repoPath: repository,
      files: [],
      scannerTasks: [{
        scanner: 'dependencies',
        run: async () => ({
          findings: [],
          metadata: {knownExploitedEnrichment: enrichment, snapshotPersistenceError},
        }),
      }],
    });

    expect(createScanEnvelope(result).security.knownExploitedEnrichment).toEqual(enrichment);
    expect(createScanEnvelope(result).security.snapshotPersistenceError).toEqual(snapshotPersistenceError);
    const sarif = JSON.parse(serializeScanResult(result, 'sarif', repository));
    expect(sarif.runs[0].invocations[0].properties.knownExploitedEnrichment).toEqual(enrichment);
    expect(sarif.runs[0].invocations[0].properties.snapshotPersistenceError).toEqual(snapshotPersistenceError);
  });

  it('returns KEV evidence from a clean built-in dependency scan', async () => {
    const enrichment = {status: 'fresh-cache' as const, source: 'cisa-kev' as const};
    const snapshotPersistenceError = {code: 'SNAPSHOT_PERSIST_FAILED', message: 'read-only cache'};
    jest.spyOn(dependencyScanner, 'scan').mockResolvedValue([{
      vulnerabilities: [], totalVulnerabilities: 0, critical: 0, high: 0, medium: 0, low: 0,
      ecosystem: 'npm', status: 'complete', source: 'osv', queriedPackages: 1,
      unresolvedPackages: 0, inventoryDigest: 'fixture', dataFreshness: 'fresh-cache',
      knownExploitedEnrichment: enrichment, snapshotPersistenceError, errors: [],
    }]);
    const dependencyTask = (new ScanEngine() as unknown as BuiltInTaskFactory).createBuiltInTasks(
      {includeVulnerabilities: true}, repository, [], false
    ).find(task => task.scanner === 'dependencies')!;

    await expect(dependencyTask.run()).resolves.toMatchObject({
      findings: [],
      metadata: {knownExploitedEnrichment: enrichment, snapshotPersistenceError},
    });
  });

  it.each([
    ['dockerfile', dockerfileScanner, 'scan', 'DOCKERFILE_SCAN_PARTIAL'],
    ['owasp', owaspScanner, 'scan', 'OWASP_SCAN_PARTIAL'],
    ['api', apiScanner, 'scan', 'API_SCAN_PARTIAL'],
    ['compliance', complianceChecker, 'check', 'COMPLIANCE_SCAN_PARTIAL'],
  ] as const)('propagates skipped input from the %s adapter', async (scannerName, scanner, method, code) => {
    jest.spyOn(scanner as any, method).mockImplementation(async (...args: unknown[]) => {
      const onSkippedInput = args[1] as () => void;
      onSkippedInput();
      return [];
    });

    const output = await tasks().find(task => task.scanner === scannerName)!.run() as ScannerTaskOutput;

    expect(output).toMatchObject({findings: [], error: {code, retryable: true}});
  });

  it.each([
    ['api', apiScanner, 'scan', 'route.ts', 'console.log("password", password);'],
    ['owasp', owaspScanner, 'scan', 'code.ts', 'eval(userInput);'],
    ['compliance', complianceChecker, 'check', 'config.ts', 'const password = "secret";'],
    ['dockerfile', dockerfileScanner, 'scan', 'Dockerfile', 'FROM ubuntu:latest'],
    ['iac', iacScanner, 'scan', 'main.tf', 'storage_encrypted = false'],
  ] as const)('scans eligible %s inputs beyond the former depth limit', async (
    _name, scanner, method, filename, content
  ) => {
    const deepDirectory = path.join(repository, 'one', 'two', 'three', 'four', 'five', 'six');
    fs.mkdirSync(deepDirectory, {recursive: true});
    fs.writeFileSync(path.join(deepDirectory, filename), content);
    const onSkippedInput = jest.fn();

    const output = await ((scanner as unknown as Record<string, (root: string, skipped: () => void) => Promise<unknown[]>>)[method])(
      repository,
      onSkippedInput
    );

    expect(output.length).toBeGreaterThan(0);
    expect(onSkippedInput).not.toHaveBeenCalled();
  });
});
