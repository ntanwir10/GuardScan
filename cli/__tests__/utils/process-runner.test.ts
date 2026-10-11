import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {resolveGradleWrapperInvocation, resolveMavenInvocation, resolveProcessInvocation} from '../../src/utils/process-runner';

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
});
