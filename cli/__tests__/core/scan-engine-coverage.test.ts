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
  writeScanResult,
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

  it('includes executable source beneath dot-directories in required pattern coverage', async () => {
    const actionDirectory = path.join(repository, '.github', 'actions', 'fixture');
    fs.mkdirSync(actionDirectory, {recursive: true});
    fs.writeFileSync(path.join(actionDirectory, 'index.js'), 'const execute = new Function(userInput);\n');

    const result = await new ScanEngine().runSecurityScan({
      repoPath: repository,
      includeVulnerabilities: false,
      includeGitHistory: false,
    });

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({file: expect.stringContaining('.github/actions/fixture/index.js')}),
    ]));
  });

  it.each(['.venv', 'venv'])('excludes root %s dependency environments from required pattern coverage', async environment => {
    const dependencyDirectory = path.join(repository, environment, 'lib', 'python3.12', 'site-packages');
    fs.mkdirSync(dependencyDirectory, {recursive: true});
    fs.writeFileSync(path.join(dependencyDirectory, 'third_party.py'), 'execute = new Function(untrusted_input)\n');

    const result = await new ScanEngine().runSecurityScan({
      repoPath: repository,
      includeVulnerabilities: false,
      includeGitHistory: false,
    });

    const patternResult = result.scannerResults.find(scanner => scanner.scanner === 'patterns');
    expect(patternResult?.findings.some(finding => finding.file.includes(environment))).toBe(false);
  });

  it('includes first-party source in an ordinary nested venv directory', async () => {
    const sourceDirectory = path.join(repository, 'src', 'venv');
    fs.mkdirSync(sourceDirectory, {recursive: true});
    fs.writeFileSync(path.join(sourceDirectory, 'security.py'), 'execute = new Function(untrusted_input)\n');

    const result = await new ScanEngine().runSecurityScan({
      repoPath: repository,
      includeVulnerabilities: false,
      includeGitHistory: false,
    });

    const patternResult = result.scannerResults.find(scanner => scanner.scanner === 'patterns');
    expect(patternResult?.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({file: expect.stringContaining('src/venv/security.py')}),
    ]));
  });

  (process.platform === 'win32' ? it.skip : it)('replaces a report symlink without overwriting its target', async () => {
    const external = path.join(os.tmpdir(), `guardscan-report-target-${process.pid}-${Date.now()}.json`);
    const output = path.join(repository, 'guardscan-scan.json');
    fs.writeFileSync(external, 'preserve me');
    fs.symlinkSync(external, output);
    const result = await new ScanEngine().runSecurityScan({repoPath: repository, scannerTasks: []});

    try {
      writeScanResult(result, 'json', output, repository);
      expect(fs.lstatSync(output).isSymbolicLink()).toBe(false);
      expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({schemaVersion: 'guardscan.scan.v1'});
      expect(fs.readFileSync(external, 'utf8')).toBe('preserve me');
    } finally {
      fs.rmSync(external, {force: true});
    }
  });

  (process.platform === 'win32' ? it.skip : it)('rejects report paths through repository symlink directories', async () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-report-directory-'));
    const linkedDirectory = path.join(repository, 'reports');
    fs.symlinkSync(external, linkedDirectory);
    const result = await new ScanEngine().runSecurityScan({repoPath: repository, scannerTasks: []});

    try {
      expect(() => writeScanResult(
        result,
        'json',
        path.join(linkedDirectory, 'scan.json'),
        repository
      )).toThrow(/symlink/i);
      expect(fs.existsSync(path.join(external, 'scan.json'))).toBe(false);
    } finally {
      fs.rmSync(external, {recursive: true, force: true});
    }
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

  it('serializes policy failures and reasons into SARIF', async () => {
    const result = await new ScanEngine().runSecurityScan({repoPath: repository, scannerTasks: []});
    const sarif = JSON.parse(serializeScanResult(result, 'sarif', repository, {
      executionStatus: 'complete',
      policyResult: {
        failed: true,
        operationalFailure: false,
        outcome: 'policy-failed',
        exitCode: 1,
        reasons: ['1 test(s) failed', '2 lint error(s) found'],
      },
    }));
    const invocation = sarif.runs[0].invocations[0];

    expect(invocation.properties.policy).toEqual({
      status: 'policy-failed',
      exitCode: 1,
      reasons: ['1 test(s) failed', '2 lint error(s) found'],
    });
    expect(invocation.toolExecutionNotifications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'error',
        descriptor: {id: 'guardscan.policy'},
        message: {text: expect.stringMatching(/1 test.*2 lint error/i)},
      }),
    ]));
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
