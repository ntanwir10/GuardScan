import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const {resolveToolInvocation} = require('../../scripts/process-invocation');
const {parseEslintReport} = require('../../scripts/eslint-ratchet-lib');
const {installArgs} = require('../../scripts/package-manager-smoke');

describe('release script process safety', () => {
  it('disables lifecycle scripts with the supported Yarn Classic option', () => {
    expect(installArgs('yarn', 'package.tgz', '1.22.22')).toEqual([
      'add', '--ignore-scripts', 'package.tgz',
    ]);
    expect(installArgs('yarn', 'package.tgz', '4.13.0')).toEqual(['add', 'package.tgz']);
  });
  it.each([
    ['npm', ['node_modules', 'npm', 'bin', 'npm-cli.js']],
    ['npx', ['node_modules', 'npm', 'bin', 'npx-cli.js']],
    ['pnpm', ['node_modules', 'corepack', 'dist', 'pnpm.js']],
    ['yarn', ['node_modules', 'corepack', 'dist', 'yarn.js']],
  ])('runs the Windows %s shim through its JavaScript entry point', (tool, segments) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-script-tool-'));
    try {
      const entryPoint = path.join(directory, ...segments);
      fs.mkdirSync(path.dirname(entryPoint), {recursive: true});
      fs.writeFileSync(path.join(directory, `${tool}.cmd`), '@echo off\r\n');
      fs.writeFileSync(entryPoint, '');

      expect(resolveToolInvocation(tool, ['--version'], {Path: directory}, 'win32', 'C:\\node.exe')).toEqual({
        command: 'C:\\node.exe',
        args: [entryPoint, '--version'],
      });
    } finally {
      fs.rmSync(directory, {recursive: true, force: true});
    }
  });

  it('rejects fatal ESLint exit statuses before parsing output', () => {
    expect(() => parseEslintReport({status: 2, stdout: '[]', stderr: 'configuration failed'})).toThrow(
      /configuration failed/
    );
  });

  it('accepts ESLint finding status 1 and requires JSON stdout', () => {
    expect(parseEslintReport({status: 1, stdout: '[]', stderr: ''})).toEqual([]);
    expect(() => parseEslintReport({status: 1, stdout: '', stderr: ''})).toThrow(/parse ESLint JSON/i);
  });
});
