import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TestRunner } from '../../src/core/test-runner';
import {
  NetworkIsolationError,
  ProcessResult,
  runProcess,
} from '../../src/utils/process-runner';

jest.mock('../../src/utils/process-runner', () => {
  const actual = jest.requireActual('../../src/utils/process-runner');
  return { ...actual, runProcess: jest.fn() };
});

const mockedRunProcess = jest.mocked(runProcess);

function processResult(status: number, stdout = '', stderr = ''): ProcessResult {
  return {
    command: 'fixture',
    args: [],
    status,
    stdout,
    stderr,
    signal: null,
    timedOut: false,
  };
}

describe('TestRunner discovery and empty-suite behavior', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-test-runner-'));
    mockedRunProcess.mockReset();
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
  });

  it('does not invoke npm test when package.json has no test script', async () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      devDependencies: { jest: '^29.0.0' },
    }));
    fs.writeFileSync(path.join(repository, 'fixture.test.js'), 'test("fixture", () => {});');

    await expect(new TestRunner().runTests(repository)).resolves.toEqual([]);
    expect(mockedRunProcess).not.toHaveBeenCalled();
  });

  it('does not invoke the default npm placeholder test script', async () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      scripts: { test: 'echo "Error: no test specified" && exit 1' },
      devDependencies: { jest: '^29.0.0' },
    }));

    await expect(new TestRunner().runTests(repository)).resolves.toEqual([]);
    expect(mockedRunProcess).not.toHaveBeenCalled();
  });

  it.each([false, true])('treats pytest exit 5 as an empty suite (json report: %s)', async withReport => {
    fs.writeFileSync(path.join(repository, 'pytest.ini'), '[pytest]\n');
    mockedRunProcess.mockImplementation((_command, args) => {
      if (withReport) {
        const reportArgument = args.find(argument => argument.startsWith('--json-report-file='));
        fs.writeFileSync(reportArgument!.slice('--json-report-file='.length), JSON.stringify({
          summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
          tests: [],
        }));
      }
      return processResult(5, 'collected 0 items');
    });

    await expect(new TestRunner().runTests(repository)).resolves.toEqual([]);
  });

  it('runs ordinary pytest projects without requiring pytest-json-report', async () => {
    fs.writeFileSync(path.join(repository, 'pytest.ini'), '[pytest]\n');
    mockedRunProcess
      .mockReturnValueOnce(processResult(4, '', 'ERROR: unrecognized arguments: --json-report'))
      .mockReturnValueOnce(processResult(0, '2 passed in 0.01s'));

    await expect(new TestRunner().runTests(repository)).resolves.toEqual([
      expect.objectContaining({ framework: 'pytest', totalTests: 2, passed: 2, failed: 0 }),
    ]);
    expect(mockedRunProcess).toHaveBeenCalledTimes(2);
    expect(mockedRunProcess.mock.calls[1][1]).not.toContain('--json-report');
  });

  it('preserves failures from a configured npm test script', async () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      scripts: { test: 'jest' },
      devDependencies: { jest: '^29.0.0' },
    }));
    mockedRunProcess.mockReturnValue(processResult(1, '', 'runner failed'));

    await expect(new TestRunner().runTests(repository)).rejects.toThrow(
      /without producing a JSON report/i
    );
  });

  it('preserves a nonzero Jest exit when its JSON contains only passing assertions', async () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      scripts: { test: 'jest' },
      devDependencies: { jest: '^29.0.0' },
    }));
    mockedRunProcess.mockImplementation((_command, args) => {
      const reportIndex = args.indexOf('--outputFile');
      fs.writeFileSync(args[reportIndex + 1], JSON.stringify({
        success: false,
        testResults: [{
          name: 'fixture.test.js',
          status: 'passed',
          assertionResults: [{status: 'passed', title: 'fixture'}],
        }],
      }));
      return processResult(1, '', 'Jest: coverage threshold not met');
    });

    await expect(new TestRunner().runTests(repository)).rejects.toThrow(
      /exited 1|coverage threshold|unsuccessful/i
    );
  });

  it('preserves later framework reports when partial execution is allowed', async () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      scripts: { test: 'jest' },
      devDependencies: { jest: '^29.0.0' },
    }));
    fs.writeFileSync(path.join(repository, 'pytest.ini'), '[pytest]\n');
    mockedRunProcess.mockImplementation((command, args) => {
      if (command === 'npm') {return processResult(1, '', 'Jest failed before reporting');}
      const reportArgument = args.find(argument => argument.startsWith('--json-report-file='));
      fs.writeFileSync(reportArgument!.slice('--json-report-file='.length), JSON.stringify({
        summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
        tests: [{ outcome: 'passed', nodeid: 'test_fixture.py::test_fixture' }],
      }));
      return processResult(0);
    });

    await expect(new TestRunner().runTests(repository, false, {
      offline: false,
      runProjectCode: true,
      isolateProjectNetwork: false,
      allowPartial: true,
      includeCve: false,
    })).resolves.toEqual([
      expect.objectContaining({
        framework: 'Jest',
        totalTests: 0,
        failed: 0,
        executionError: expect.stringMatching(/without producing a JSON report/i),
      }),
      expect.objectContaining({ framework: 'pytest', totalTests: 1, passed: 1 }),
    ]);
  });

  it('runs Cargo tests with the stable human-readable harness format', async () => {
    fs.writeFileSync(path.join(repository, 'Cargo.toml'), '[package]\nname = "fixture"\nversion = "0.1.0"\n');
    mockedRunProcess.mockReturnValue(processResult(
      101,
      [
        'running 1 test',
        'test tests::fixture ... ok',
        '',
        'test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s',
        '',
        'running 1 test',
        'test tests::second ... FAILED',
        '',
        'test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s',
      ].join('\n')
    ));

    await expect(new TestRunner().runTests(repository)).resolves.toEqual([
      expect.objectContaining({
        framework: 'cargo test',
        totalTests: 3,
        passed: 1,
        failed: 1,
        skipped: 1,
      }),
    ]);
    expect(mockedRunProcess).toHaveBeenCalledWith(
      'cargo',
      ['test'],
      expect.objectContaining({ cwd: repository })
    );
  });

  it('does not suppress isolation setup failure in partial mode', async () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      scripts: { test: 'jest' },
      devDependencies: { jest: '^29.0.0' },
    }));
    mockedRunProcess.mockImplementation(() => {
      throw new NetworkIsolationError('Network isolation could not be established');
    });

    await expect(new TestRunner().runTests(repository, false, {
      offline: false,
      runProjectCode: true,
      isolateProjectNetwork: true,
      allowPartial: true,
      includeCve: false,
    })).rejects.toThrow(/network isolation could not be established/i);
  });
});
