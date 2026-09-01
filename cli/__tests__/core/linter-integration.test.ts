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

  it('recognizes an unsupported unshare option as an isolation failure', () => {
    expect(isNetworkIsolationFailure({
      status: 1,
      stdout: '',
      stderr: "unshare: unrecognized option '--map-root-user'",
    })).toBe(true);
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

  it('does not suppress isolation setup failure in partial mode', async () => {
    mockedRunProcess.mockImplementation(() => {
      throw new NetworkIsolationError('Network isolation could not be established');
    });

    await expect(new LinterIntegration().runAll(repository, {
      offline: false,
      runProjectCode: true,
      isolateProjectNetwork: true,
      allowPartial: true,
      includeCve: true,
    })).rejects.toThrow(/network isolation could not be established/i);
  });

  it('skips a declared ESLint dependency when its executable is unavailable', async () => {
    fs.rmSync(path.join(repository, 'fixture.py'));
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      devDependencies: { eslint: '^9.0.0' },
    }));
    mockedRunProcess.mockReturnValue({
      command: 'npx',
      args: ['--no-install', 'eslint', '--version'],
      status: 1,
      stdout: '',
      stderr: 'npm error could not determine executable to run',
      signal: null,
      timedOut: false,
    });

    await expect(new LinterIntegration().runAll(repository, {
      offline: false,
      runProjectCode: true,
      isolateProjectNetwork: false,
      allowPartial: false,
      includeCve: true,
    })).resolves.toEqual([]);
    expect(mockedRunProcess).toHaveBeenCalledTimes(1);
    expect(mockedRunProcess).toHaveBeenCalledWith(
      'npx',
      ['--no-install', 'eslint', '--version'],
      expect.objectContaining({ cwd: repository })
    );
  });

  it('parses ESLint JSON only from stdout and bounds both processes', async () => {
    fs.rmSync(path.join(repository, 'fixture.py'));
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      devDependencies: { eslint: '^9.0.0' },
    }));
    mockedRunProcess
      .mockReturnValueOnce({
        command: 'npx', args: [], status: 0, stdout: 'v9.0.0', stderr: '', signal: null, timedOut: false,
      })
      .mockReturnValueOnce({
        command: 'npx', args: [], status: 1,
        stdout: JSON.stringify([{ filePath: 'fixture.ts', messages: [] }]),
        stderr: 'diagnostic with [brackets] that is not JSON', signal: null, timedOut: false,
      });

    await expect(new LinterIntegration().runAll(repository)).resolves.toEqual([
      expect.objectContaining({ linter: 'ESLint', totalIssues: 0 }),
    ]);
    expect(mockedRunProcess).toHaveBeenCalledTimes(2);
    for (const call of mockedRunProcess.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ timeoutMs: 5 * 60 * 1000 }));
    }
  });

  it('falls back to go vet when golangci-lint exits without a report', async () => {
    fs.rmSync(path.join(repository, 'fixture.py'));
    fs.writeFileSync(path.join(repository, 'go.mod'), 'module example.test/fixture\n');
    mockedRunProcess
      .mockReturnValueOnce({
        command: 'golangci-lint', args: [], status: 1, stdout: '', stderr: 'configuration failed',
        signal: null, timedOut: false,
      })
      .mockReturnValueOnce({
        command: 'go', args: [], status: 0, stdout: 'fixture.go:1:2: vet finding', stderr: '',
        signal: null, timedOut: false,
      });

    await expect(new LinterIntegration().runAll(repository)).resolves.toEqual([
      expect.objectContaining({ linter: 'Go Vet', totalIssues: 1 }),
    ]);
    expect(mockedRunProcess).toHaveBeenNthCalledWith(
      2,
      'go',
      ['vet', './...'],
      expect.objectContaining({ timeoutMs: 5 * 60 * 1000 })
    );
  });

  it('preserves later linter reports when partial execution is allowed', async () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      devDependencies: { eslint: '^9.0.0' },
    }));
    mockedRunProcess.mockImplementation((command, args) => {
      if (command === 'npx' && args.includes('--version')) {
        return { command, args, status: 0, stdout: 'v9', stderr: '', signal: null, timedOut: false };
      }
      if (command === 'npx') {
        return { command, args, status: 2, stdout: '', stderr: 'ESLint failed', signal: null, timedOut: false };
      }
      if (command === 'flake8' && args.includes('--version')) {
        return { command, args, status: 0, stdout: '7.0', stderr: '', signal: null, timedOut: false };
      }
      if (command === 'flake8') {
        return {
          command, args, status: 1, stdout: 'fixture.py:1:1: E101 fixture', stderr: '', signal: null, timedOut: false,
        };
      }
      return { command, args, status: 1, stdout: '', stderr: 'unavailable', signal: null, timedOut: false };
    });

    await expect(new LinterIntegration().runAll(repository, {
      offline: false,
      runProjectCode: true,
      isolateProjectNetwork: false,
      allowPartial: true,
      includeCve: false,
    })).resolves.toEqual([
      expect.objectContaining({ linter: 'Flake8', totalIssues: 1 }),
    ]);
  });
});
