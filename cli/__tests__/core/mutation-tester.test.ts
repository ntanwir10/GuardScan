import {resolvePitestInvocation, resolveStrykerInvocation} from '../../src/core/mutation-tester';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import {MutationTester} from '../../src/core/mutation-tester';

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFileSync: jest.fn(),
}));

describe('mutation tester process invocations', () => {
  const windowsEnvironment = {ComSpec: 'C:\\Windows\\System32\\cmd.exe'};

  it('resolves Stryker run and availability probes through the Node npx entry point', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-mutation-npx-'));
    const entryPoint = path.join(directory, 'node_modules', 'npm', 'bin', 'npx-cli.js');
    fs.mkdirSync(path.dirname(entryPoint), {recursive: true});
    fs.writeFileSync(path.join(directory, 'npx.cmd'), '');
    fs.writeFileSync(entryPoint, '');
    try {
      const environment = {PATH: directory};
      expect(resolveStrykerInvocation(['stryker', 'run'], environment, 'win32')).toEqual({
        command: 'node',
        args: [entryPoint, 'stryker', 'run'],
      });
      expect(resolveStrykerInvocation(['stryker', '--version'], environment, 'win32').args).toEqual([
        entryPoint, 'stryker', '--version',
      ]);
    } finally {
      fs.rmSync(directory, {recursive: true, force: true});
    }
  });

  it('keeps PITest Maven arguments separate from the fixed Windows command shim', () => {
    expect(resolvePitestInvocation(
      'maven',
      'C:\\repo',
      ['test-compile', 'org.pitest:pitest-maven:mutationCoverage'],
      windowsEnvironment,
      'win32'
    )).toEqual({
      command: windowsEnvironment.ComSpec,
      args: ['/d', '/s', '/c', 'mvn.cmd', 'test-compile', 'org.pitest:pitest-maven:mutationCoverage'],
    });
  });

  it('runs the Windows Gradle wrapper by its fixed basename for run and probe arguments', () => {
    expect(resolvePitestInvocation('gradle', 'C:\\repo', ['pitest'], windowsEnvironment, 'win32')).toEqual({
      command: windowsEnvironment.ComSpec,
      args: ['/d', '/s', '/c', 'gradlew.bat', 'pitest'],
    });
    expect(resolvePitestInvocation('gradle', 'C:\\repo', ['--version'], windowsEnvironment, 'win32').args)
      .toEqual(['/d', '/s', '/c', 'gradlew.bat', '--version']);
  });

  it('retains the repository Gradle wrapper path on non-Windows systems', () => {
    expect(resolvePitestInvocation('gradle', '/repo', ['pitest'], {}, 'linux')).toEqual({
      command: '/repo/gradlew',
      args: ['pitest'],
    });
  });

  it('uses the Windows safe invocation for both Stryker probe and run', async () => {
    const repository = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-mutation-run-')));
    const originalCwd = process.cwd();
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const originalPath = process.env.PATH;
    const originalComSpec = process.env.ComSpec;
    const nodeDirectory = path.join(repository, 'node');
    const entryPoint = path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npx-cli.js');
    fs.mkdirSync(path.dirname(entryPoint), {recursive: true});
    fs.writeFileSync(path.join(nodeDirectory, 'npx.cmd'), '');
    fs.writeFileSync(entryPoint, '');
    fs.writeFileSync(path.join(repository, 'package.json'), '{}');
    process.chdir(repository);
    Object.defineProperty(process, 'platform', {...originalPlatform, value: 'win32'});
    process.env.PATH = nodeDirectory;
    process.env.ComSpec = windowsEnvironment.ComSpec;
    const execute = childProcess.execFileSync as jest.Mock;
    execute.mockReset().mockReturnValue('Mutation score: 100%\n');

    try {
      await new MutationTester().runMutationTest({framework: 'stryker'});

      expect(execute).toHaveBeenNthCalledWith(1, 'node', [entryPoint, 'stryker', '--version'], expect.objectContaining({cwd: repository}));
      expect(execute).toHaveBeenNthCalledWith(2, 'node', [entryPoint, 'stryker', 'run'], expect.objectContaining({cwd: repository}));
    } finally {
      execute.mockReset();
      process.chdir(originalCwd);
      Object.defineProperty(process, 'platform', originalPlatform!);
      if (originalPath === undefined) {delete process.env.PATH;} else {process.env.PATH = originalPath;}
      if (originalComSpec === undefined) {delete process.env.ComSpec;} else {process.env.ComSpec = originalComSpec;}
      fs.rmSync(repository, {recursive: true, force: true});
    }
  });

  it('uses fixed Windows Maven and Gradle shim arguments for PITest probe and run', async () => {
    const repository = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-pitest-run-')));
    const originalCwd = process.cwd();
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const originalComSpec = process.env.ComSpec;
    fs.writeFileSync(path.join(repository, 'build.gradle'), 'plugins { id "info.solidsoft.pitest" }');
    fs.writeFileSync(path.join(repository, 'gradlew.bat'), '');
    process.chdir(repository);
    Object.defineProperty(process, 'platform', {...originalPlatform, value: 'win32'});
    process.env.ComSpec = windowsEnvironment.ComSpec;
    const execute = childProcess.execFileSync as jest.Mock;
    execute.mockReset().mockImplementation((command: string, args: string[]) => {
      if (args.includes('mvn.cmd')) {throw new Error('Maven unavailable');}
      return '';
    });

    try {
      await expect(new MutationTester().runMutationTest({framework: 'pitest'})).rejects.toThrow('PITest mutation testing failed');

      expect(execute).toHaveBeenNthCalledWith(1, windowsEnvironment.ComSpec, ['/d', '/s', '/c', 'mvn.cmd', '--version'], expect.objectContaining({cwd: repository}));
      expect(execute).toHaveBeenNthCalledWith(2, windowsEnvironment.ComSpec, ['/d', '/s', '/c', 'gradlew.bat', '--version'], expect.objectContaining({cwd: repository}));
      expect(execute).toHaveBeenNthCalledWith(3, windowsEnvironment.ComSpec, ['/d', '/s', '/c', 'gradlew.bat', 'pitest'], expect.objectContaining({cwd: repository}));
    } finally {
      execute.mockReset();
      process.chdir(originalCwd);
      Object.defineProperty(process, 'platform', originalPlatform!);
      if (originalComSpec === undefined) {delete process.env.ComSpec;} else {process.env.ComSpec = originalComSpec;}
      fs.rmSync(repository, {recursive: true, force: true});
    }
  });
});
