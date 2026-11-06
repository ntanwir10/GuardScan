import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';

const {
  execArgs,
  installArgs,
  parseManager,
  parseTarball,
} = require('../../scripts/package-manager-smoke') as {
  execArgs: (manager: string, args: string[]) => string[];
  installArgs: (manager: string, tarball: string) => string[];
  parseManager: (args: string[]) => string;
  parseTarball: (args: string[]) => string | undefined;
};

describe('package-manager smoke command contracts', () => {
  it.each([
    ['npm', ['exec', '--', 'guardscan', '--version']],
    ['pnpm', ['exec', 'guardscan', '--version']],
    ['yarn', ['guardscan', '--version']],
    ['bun', ['run', 'guardscan', '--version']],
  ])('executes the installed GuardScan binary through %s', (manager, expected) => {
    expect(execArgs(manager, ['--version'])).toEqual(expected);
  });

  it.each(['npm', 'pnpm', 'bun'])('disables lifecycle scripts during %s installation', manager => {
    expect(installArgs(manager, '/tmp/guardscan.tgz')).toContain('--ignore-scripts');
  });

  it('uses Yarn configuration rather than an unsupported install flag', () => {
    expect(installArgs('yarn', '/tmp/guardscan.tgz')).toEqual(['add', '/tmp/guardscan.tgz']);
  });

  it('rejects omitted and unknown managers', () => {
    expect(() => parseManager([])).toThrow(/--manager must be one of/);
    expect(() => parseManager(['--manager', 'pip'])).toThrow(/--manager must be one of/);
  });

  it('accepts an exact local tarball handoff and rejects missing files', () => {
    const tarball = require.resolve('../../package.json').replace(/package\.json$/, 'fixture.tgz');
    expect(() => parseTarball(['--tarball', tarball])).toThrow();
    expect(parseTarball([])).toBeUndefined();
  });
});

it('reaches isolated installation without checkout dependencies when given a tarball', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-clean-checkout-'));
  try {
    fs.cpSync(path.resolve(__dirname, '../../scripts'), path.join(root, 'scripts'), {recursive: true});
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({version: '1.2.3'}));
    fs.writeFileSync(path.join(root, 'fixture.tgz'), 'fixture');
    const shim = path.join(root, 'fixture.cjs');
    fs.writeFileSync(shim, `require('child_process').spawnSync = (command, args, options) => {
      if (!args.includes('install') || !args.includes('--ignore-scripts')
          || options.cwd === ${JSON.stringify(root)}) throw new Error('unexpected invocation');
      return {status: 7, stdout: '', stderr: 'ISOLATED_INSTALL_REACHED'};
    };`);
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/package-manager-smoke.js'),
      '--manager', 'npm', '--tarball', path.join(root, 'fixture.tgz')], {
      encoding: 'utf8', env: {...process.env, NODE_PATH: '',
        NODE_OPTIONS: `--require "${shim.replace(/\\/g, '/')}"`},
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ISOLATED_INSTALL_REACHED');
    expect(result.stderr).not.toContain('Cannot find module');
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
