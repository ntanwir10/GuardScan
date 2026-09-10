import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ScanEngine,
  ScanEngineOptions,
  ScanFile,
  ScannerTask,
  ScannerTaskOutput,
} from '../../src/core/scan-engine';
import {apiScanner} from '../../src/core/api-scanner';
import {complianceChecker} from '../../src/core/compliance-checker';
import {dockerfileScanner} from '../../src/core/dockerfile-scanner';
import {owaspScanner} from '../../src/core/owasp-scanner';

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

  function tasks(files: ScanFile[] = []): ScannerTask[] {
    return (new ScanEngine() as unknown as BuiltInTaskFactory).createBuiltInTasks(
      {includeVulnerabilities: false, includeGitHistory: false},
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

  it('marks IaC coverage incomplete when selected YAML cannot be parsed', async () => {
    fs.writeFileSync(path.join(repository, 'deployment.yaml'), 'apiVersion: [unterminated\n');

    const output = await tasks().find(task => task.scanner === 'iac')!.run() as ScannerTaskOutput;

    expect(output).toMatchObject({
      findings: [],
      error: {code: 'IAC_SCAN_PARTIAL', retryable: true},
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
});
