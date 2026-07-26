import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runProcess } from '../../src/utils/process-runner';
import { TestRunner } from '../../src/core/test-runner';

jest.mock('../../src/utils/process-runner', () => ({
  runProcess: jest.fn(),
}));

const mockedRunProcess = runProcess as jest.MockedFunction<typeof runProcess>;

describe('TestRunner execution integrity', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-tests-'));
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      name: 'fixture',
      devDependencies: { jest: '29.7.0' },
    }));
    mockedRunProcess.mockReset();
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
  });

  it('preserves a valid failed-test report as policy data', async () => {
    mockedRunProcess.mockImplementation((_command, args) => {
      const outputIndex = args.indexOf('--outputFile');
      fs.writeFileSync(args[outputIndex + 1], JSON.stringify({
        startTime: 1,
        testResults: [{
          name: 'example.test.ts',
          assertionResults: [{
            status: 'failed',
            fullName: 'example fails',
            failureMessages: ['expected true'],
          }],
        }],
      }));
      return {
        command: 'npm', args, status: 1, stdout: '', stderr: '', signal: null, timedOut: false,
      };
    });

    const results = await new TestRunner().runTests(repository);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ framework: 'Jest', failed: 1, passed: 0 });
    expect(results[0].failures[0].testName).toBe('example fails');
  });

  it('throws when a detected test runner produces no machine-readable result', async () => {
    mockedRunProcess.mockReturnValue({
      command: 'npm', args: [], status: 2, stdout: '', stderr: 'runner crashed', signal: null, timedOut: false,
    });

    await expect(new TestRunner().runTests(repository)).rejects.toThrow(
      /Jest execution failed: Jest exited 2 without producing a JSON report/
    );
  });

  it('propagates requested network isolation to the project test process', async () => {
    mockedRunProcess.mockImplementation((_command, args) => {
      const outputIndex = args.indexOf('--outputFile');
      fs.writeFileSync(args[outputIndex + 1], JSON.stringify({testResults: []}));
      return {command: 'npm', args, status: 0, stdout: '', stderr: '', signal: null, timedOut: false};
    });

    await new TestRunner().runTests(repository, false, {
      offline: false,
      runProjectCode: true,
      isolateProjectNetwork: true,
      includeCve: false,
      allowPartial: false,
    });

    expect(mockedRunProcess.mock.calls[0][2]).toMatchObject({networkIsolation: true});
  });

  it('does not execute project tests when the effective policy disallows project code', async () => {
    const results = await new TestRunner().runTests(repository, false, {
      offline: true,
      runProjectCode: false,
      isolateProjectNetwork: false,
      includeCve: false,
      allowPartial: false,
    });

    expect(results).toEqual([]);
    expect(mockedRunProcess).not.toHaveBeenCalled();
  });
});
