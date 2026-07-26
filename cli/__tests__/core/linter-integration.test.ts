import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runProcess } from '../../src/utils/process-runner';
import { LinterIntegration } from '../../src/core/linter-integration';

jest.mock('../../src/utils/process-runner', () => ({
  runProcess: jest.fn(),
}));

const mockedRunProcess = runProcess as jest.MockedFunction<typeof runProcess>;

describe('LinterIntegration execution integrity', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-lint-'));
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      name: 'fixture',
      devDependencies: { eslint: '8.0.0' },
    }));
    mockedRunProcess.mockReset();
  });

  afterEach(() => fs.rmSync(repository, { recursive: true, force: true }));

  it('parses lint findings even when the linter exits non-zero', async () => {
    mockedRunProcess.mockReturnValue({
      command: 'npx',
      args: [],
      status: 1,
      stdout: JSON.stringify([{
        filePath: path.join(repository, 'index.js'),
        messages: [{ line: 1, column: 2, severity: 2, ruleId: 'no-undef', message: 'x is not defined' }],
      }]),
      stderr: '',
      signal: null,
      timedOut: false,
    });

    const reports = await new LinterIntegration().runAll(repository);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ linter: 'ESLint', totalIssues: 1, errors: 1 });
  });

  it('throws when a configured linter fails without a parseable report', async () => {
    mockedRunProcess.mockReturnValue({
      command: 'npx', args: [], status: 2, stdout: '', stderr: 'configuration crashed', signal: null, timedOut: false,
    });

    await expect(new LinterIntegration().runAll(repository)).rejects.toThrow(
      /ESLint execution failed: ESLint exited 2 without a parseable report/
    );
  });

  it('propagates requested network isolation to the project linter process', async () => {
    mockedRunProcess.mockReturnValue({
      command: 'npx', args: [], status: 0, stdout: '[]', stderr: '', signal: null, timedOut: false,
    });

    await new LinterIntegration().runAll(repository, {
      offline: false,
      runProjectCode: true,
      isolateProjectNetwork: true,
      includeCve: false,
      allowPartial: false,
    });

    expect(mockedRunProcess.mock.calls[0][2]).toMatchObject({networkIsolation: true});
  });

  it('does not execute project linters when the effective policy disallows project code', async () => {
    const reports = await new LinterIntegration().runAll(repository, {
      offline: true,
      runProjectCode: false,
      isolateProjectNetwork: false,
      includeCve: false,
      allowPartial: false,
    });

    expect(reports).toEqual([]);
    expect(mockedRunProcess).not.toHaveBeenCalled();
  });
});
