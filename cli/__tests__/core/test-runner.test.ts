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
      expect.objectContaining({ framework: 'pytest', totalTests: 1, passed: 1 }),
    ]);
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
