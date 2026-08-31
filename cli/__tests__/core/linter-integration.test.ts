import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LinterIntegration } from '../../src/core/linter-integration';
import {
  isNetworkIsolationFailure,
  NetworkIsolationError,
  ProcessResult,
  resolveNetworkIsolatedInvocation,
  runProcess,
} from '../../src/utils/process-runner';

jest.mock('../../src/utils/process-runner', () => {
  const actual = jest.requireActual('../../src/utils/process-runner');
  return { ...actual, runProcess: jest.fn() };
});

const mockedRunProcess = jest.mocked(runProcess);

describe('LinterIntegration isolation failures', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-linter-'));
    fs.writeFileSync(path.join(repository, 'fixture.py'), 'print("fixture")\n');
    mockedRunProcess.mockReset();
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
  });

  it('recognizes a failed Linux network-isolation wrapper', () => {
    const result: ProcessResult = {
      command: 'unshare',
      args: [],
      status: 1,
      stdout: '',
      stderr: 'unshare: unshare failed: Operation not permitted',
      signal: null,
      timedOut: false,
    };

    expect(isNetworkIsolationFailure(result)).toBe(true);
  });

  it('does not confuse a missing wrapped executable with isolation setup failure', () => {
    expect(isNetworkIsolationFailure({
      status: 1,
      stdout: '',
      stderr: 'unshare: failed to execute flake8: No such file or directory',
    })).toBe(false);
  });

  it('reports unsupported isolation platforms as isolation failures', () => {
    expect(() => resolveNetworkIsolatedInvocation('flake8', ['--version'], 'win32')).toThrow(
      NetworkIsolationError
    );
  });

  it('propagates isolation setup failure from availability probes', async () => {
    mockedRunProcess.mockImplementation(() => {
      throw new NetworkIsolationError('Network isolation could not be established');
    });

    await expect(new LinterIntegration().runAll(repository, {
      offline: false,
      runProjectCode: true,
      isolateProjectNetwork: true,
      allowPartial: false,
      includeCve: true,
    })).rejects.toThrow(/network isolation could not be established/i);
  });
});
