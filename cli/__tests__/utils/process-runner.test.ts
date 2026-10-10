import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {resolveGradleWrapperInvocation, resolveMavenInvocation, resolveProcessInvocation} from '../../src/utils/process-runner';
import {resolveExecutable, resolveNetworkIsolatedInvocation, runProcess} from '../../src/utils/process-runner';

describe('resolveProcessInvocation on Windows', () => {
  it('runs npx through its Node entry point instead of a .cmd shim', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-npx-'));
    const entryPoint = path.join(directory, 'node_modules', 'npm', 'bin', 'npx-cli.js');
    fs.mkdirSync(path.dirname(entryPoint), {recursive: true});
    fs.writeFileSync(path.join(directory, 'npx.cmd'), '@echo off\n');
    fs.writeFileSync(entryPoint, '');

    try {
      expect(resolveProcessInvocation('npx', ['stryker', 'run'], {PATH: directory}, 'win32')).toEqual({
        command: 'node',
        args: [entryPoint, 'stryker', 'run'],
      });
    } finally {
      fs.rmSync(directory, {recursive: true, force: true});
    }
  });

  it('uses a fixed Maven cmd shim invocation for arbitrary Maven arguments', () => {
    expect(resolveMavenInvocation(['test-compile', 'org.pitest:pitest-maven:mutationCoverage'], {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    }, 'win32')).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'mvn.cmd', 'test-compile', 'org.pitest:pitest-maven:mutationCoverage'],
    });
  });

  it('uses a fixed Gradle wrapper basename with arguments kept separate', () => {
    expect(resolveGradleWrapperInvocation('C:\\workspace\\repo', ['pitest'], {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    }, 'win32')).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'gradlew.bat', 'pitest'],
    });
  });

  it('resolves npm command shims on Windows', () => {
    expect(resolveExecutable('npx', 'win32')).toBe('npx.cmd');
    expect(resolveExecutable('npm', 'win32')).toBe('npm.cmd');
    expect(resolveExecutable('git', 'win32')).toBe('git');
  });

  it('preserves argv containing spaces without a shell', () => {
    const result = runProcess(process.execPath, ['-e', 'console.log(process.argv[1])', 'a b']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('a b');
  });

  it('builds explicit OS-backed network isolation invocations', () => {
    expect(resolveNetworkIsolatedInvocation('npm', ['test'], 'linux')).toEqual({
      command: 'unshare',
      args: ['--user', '--map-root-user', '--net', '--', 'npm', 'test'],
    });
    expect(resolveNetworkIsolatedInvocation('npm', ['test'], 'darwin')).toEqual({
      command: 'sandbox-exec',
      args: ['-p', '(version 1) (allow default) (deny network*)', 'npm', 'test'],
    });
    expect(() => resolveNetworkIsolatedInvocation('npm', ['test'], 'win32'))
      .toThrow('Network isolation is not supported');
  });

  it('captures nonzero stdout and stderr', () => {
    const result = runProcess(process.execPath, [
      '-e', 'console.log("out"); console.error("err"); process.exit(7)',
    ]);
    expect(result.status).toBe(7);
    expect(result.stdout).toContain('out');
    expect(result.stderr).toContain('err');
  });

  it('removes sensitive runtime variables and isolates the child home', () => {
    const result = runProcess(process.execPath, [
      '-e',
      'console.log(JSON.stringify({home: process.env.HOME, token: process.env.GUARDSCAN_TEST_TOKEN, nodeOptions: process.env.NODE_OPTIONS}))',
    ], {
      env: {
        ...process.env,
        GUARDSCAN_TEST_TOKEN: 'secret',
        NODE_OPTIONS: '--require=untrusted-hook',
      },
    });
    const child = JSON.parse(result.stdout);
    expect(result.status).toBe(0);
    expect(child.token).toBeUndefined();
    expect(child.nodeOptions).toBeUndefined();
    expect(child.home).toMatch(/guardscan-child-home-/);
  });
});
