import {execFileSync, spawnSync} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {HOOK_BLOCK, hookBlock, hookStatus, installHook, uninstallHook} from '../../src/commands/hook';

// Runtime overrides (GIT_CONFIG_COUNT, GIT_CONFIG_PARAMETERS) beat config files, so they must be cleared too.
const CLEARED_ENV = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS'];
const GIT_ENV = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES', ...CLEARED_ENV];
const savedEnv = Object.fromEntries(GIT_ENV.map(name => [name, process.env[name]]));
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-hook-')));
const posixIt = process.platform === 'win32' ? it.skip : it;

beforeAll(() => {
  // A global core.hooksPath must never send these installs into the developer's real hooks.
  fs.writeFileSync(path.join(tempRoot, 'gitconfig'), '');
  process.env.GIT_CONFIG_GLOBAL = path.join(tempRoot, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CEILING_DIRECTORIES = tempRoot;
  for (const name of CLEARED_ENV) {delete process.env[name];}
});

afterAll(() => {
  fs.rmSync(tempRoot, {recursive: true, force: true});
  for (const name of GIT_ENV) {
    if (savedEnv[name] === undefined) {delete process.env[name];} else {process.env[name] = savedEnv[name];}
  }
});

describe('guardscan hook', () => {
  let repo: string;
  let hookPath: string;
  let log: jest.SpyInstance;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(tempRoot, 'repo-'));
    execFileSync('git', ['init', '-q'], {cwd: repo});
    hookPath = path.join(repo, '.git', 'hooks', 'pre-commit');
    fs.mkdirSync(path.dirname(hookPath), {recursive: true});
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(repo, {recursive: true, force: true});
    jest.restoreAllMocks();
  });

  const blockCount = (content: string): number => content.split('# >>> guardscan >>>').length - 1;

  it('creates an executable hook with the managed block', () => {
    installHook(repo);

    expect(fs.readFileSync(hookPath, 'utf8')).toBe(`#!/bin/sh\n${HOOK_BLOCK}`);
    if (process.platform !== 'win32') {expect(fs.statSync(hookPath).mode & 0o777).toBe(0o755);}
  });

  it('refuses a binary hook without changing it', () => {
    const binary = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00]);
    fs.writeFileSync(hookPath, binary, {mode: 0o755});

    expect(() => installHook(repo)).toThrow(/binary executable/);
    expect(fs.readFileSync(hookPath).equals(binary)).toBe(true);
  });

  it('manages the given checkout even when GIT_DIR points at another repository', () => {
    const other = fs.mkdtempSync(path.join(tempRoot, 'other-'));
    execFileSync('git', ['init', '-q'], {cwd: other});
    process.env.GIT_DIR = path.join(other, '.git');
    try {
      installHook(repo);
    } finally {
      delete process.env.GIT_DIR;
    }

    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.existsSync(path.join(other, '.git', 'hooks', 'pre-commit'))).toBe(false);
    fs.rmSync(other, {recursive: true, force: true});
  });

  it('reinstalls idempotently', () => {
    installHook(repo);
    const first = fs.readFileSync(hookPath, 'utf8');
    installHook(repo);

    expect(fs.readFileSync(hookPath, 'utf8')).toBe(first);
    expect(blockCount(first)).toBe(1);
  });

  it('chains an existing shell hook and keeps every other byte', () => {
    const original = Buffer.from('#!/usr/bin/env bash\n# lint first\nnpm run lint\n\xff caf\xe9\n', 'latin1');
    fs.writeFileSync(hookPath, original, {mode: 0o755});

    installHook(repo);
    const installed = fs.readFileSync(hookPath);
    expect(installed.equals(Buffer.concat([
      Buffer.from(`#!/usr/bin/env bash\n${HOOK_BLOCK}`), original.subarray('#!/usr/bin/env bash\n'.length),
    ]))).toBe(true);

    uninstallHook(repo);
    expect(fs.readFileSync(hookPath).equals(original)).toBe(true);
  });

  it('puts the block first in a hook without a shebang', () => {
    fs.writeFileSync(hookPath, 'npm test\n', {mode: 0o755});

    installHook(repo);

    expect(fs.readFileSync(hookPath, 'utf8')).toBe(`${HOOK_BLOCK}npm test\n`);
  });

  it('refuses a non-shell hook and prints the block', () => {
    const original = '#!/usr/bin/env node\nconsole.log("lint")\n';
    fs.writeFileSync(hookPath, original, {mode: 0o755});

    expect(() => installHook(repo)).toThrow(/not a shell script[\s\S]*guardscan security --staged --ci --output "\$\(git rev-parse --git-dir\)/);
    expect(fs.readFileSync(hookPath, 'utf8')).toBe(original);
  });

  posixIt('refuses a symlinked hook without touching its target', () => {
    const target = path.join(repo, 'shared-hook');
    fs.writeFileSync(target, '#!/bin/sh\necho shared\n', {mode: 0o755});
    fs.symlinkSync(target, hookPath);

    expect(() => installHook(repo)).toThrow(/symlink[\s\S]*guardscan security --staged --ci/);
    expect(fs.readFileSync(target, 'utf8')).toBe('#!/bin/sh\necho shared\n');
    expect(fs.lstatSync(hookPath).isSymbolicLink()).toBe(true);
    expect(() => uninstallHook(repo)).toThrow(/symlink.*link target by hand/);
  });

  it('refuses a Husky hooks path', () => {
    execFileSync('git', ['config', 'core.hooksPath', '.husky/_'], {cwd: repo});

    expect(() => installHook(repo)).toThrow(/Husky[\s\S]*\.husky\/pre-commit[\s\S]*guardscan security --staged --ci/);
    expect(fs.existsSync(path.join(repo, '.husky'))).toBe(false);
  });

  it('honors core.hooksPath, even from a subdirectory', () => {
    execFileSync('git', ['config', 'core.hooksPath', 'tools/hooks'], {cwd: repo});
    fs.mkdirSync(path.join(repo, 'src'));

    installHook(path.join(repo, 'src'));

    expect(fs.readFileSync(path.join(repo, 'tools', 'hooks', 'pre-commit'), 'utf8')).toBe(`#!/bin/sh\n${HOOK_BLOCK}`);
    expect(fs.existsSync(hookPath)).toBe(false);
  });

  it('deletes a hook that held only the managed block on uninstall', () => {
    installHook(repo);

    uninstallHook(repo);

    expect(fs.existsSync(hookPath)).toBe(false);
  });

  it('reports the hook path and install state', () => {
    hookStatus(repo);
    installHook(repo);
    hookStatus(repo);

    const lines = log.mock.calls.map(call => String(call[0]));
    const reported = lines.filter(line => line.startsWith('Hook: ')).map(line => line.slice('Hook: '.length));
    expect(reported).toHaveLength(2);
    // Git reports long-name paths while Windows temp dirs can use 8.3 short names, so compare real paths.
    expect(fs.realpathSync.native(reported[1])).toBe(fs.realpathSync.native(hookPath));
    expect(lines).toContain('GuardScan: not installed');
    expect(lines).toContain('GuardScan: installed');
  });

  it('writes a chosen threshold into the block, and a reinstall without one restores the default', () => {
    installHook(repo, {failOn: 'medium'});
    expect(fs.readFileSync(hookPath, 'utf8')).toBe(`#!/bin/sh\n${hookBlock('medium')}`);
    expect(hookBlock('medium')).toContain(
      'guardscan security --staged --ci --fail-on medium --output "$(git rev-parse --git-dir)/guardscan-pre-commit.json"'
    );
    hookStatus(repo);

    installHook(repo);
    hookStatus(repo);

    expect(fs.readFileSync(hookPath, 'utf8')).toBe(`#!/bin/sh\n${HOOK_BLOCK}`);
    const lines = log.mock.calls.map(call => String(call[0]));
    expect(lines.filter(line => line.startsWith('Fail on: '))).toEqual(['Fail on: medium', 'Fail on: high (default)']);
  });

  it('rejects an unknown threshold without touching the hook', () => {
    fs.writeFileSync(hookPath, '#!/bin/sh\necho kept\n', {mode: 0o755});

    expect(() => installHook(repo, {failOn: 'medium; rm -rf ~'})).toThrow('--fail-on must be one of critical, high, medium, low, info.');
    expect(fs.readFileSync(hookPath, 'utf8')).toBe('#!/bin/sh\necho kept\n');
  });

  posixIt('passes the chosen threshold to guardscan', () => {
    installHook(repo, {failOn: 'low'});
    const stubDirectory = fs.mkdtempSync(path.join(tempRoot, 'stub-'));
    const argsFile = path.join(stubDirectory, 'args');
    fs.writeFileSync(path.join(stubDirectory, 'guardscan'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$ARGS_FILE"\n', {mode: 0o755});

    const result = spawnSync('sh', [hookPath], {
      cwd: repo,
      encoding: 'utf8',
      env: {...process.env, PATH: `${stubDirectory}${path.delimiter}${process.env.PATH}`, ARGS_FILE: argsFile},
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(argsFile, 'utf8').split('\n').slice(0, 5)).toEqual(['security', '--staged', '--ci', '--fail-on', 'low']);
  });

  it('fails clearly outside a Git work tree', () => {
    const outside = fs.mkdtempSync(path.join(tempRoot, 'plain-'));

    expect(() => installHook(outside)).toThrow('Not inside a Git work tree');
  });

  posixIt.each([[0, 0], [1, 1], [2, 2], [3, 2], [127, 2]])(
    'maps a guardscan exit of %i to a hook exit of %i',
    (scannerStatus, hookStatusCode) => {
      fs.writeFileSync(hookPath, '#!/bin/sh\necho rest-of-hook\n', {mode: 0o755});
      installHook(repo);
      const stubDirectory = fs.mkdtempSync(path.join(tempRoot, 'stub-'));
      fs.writeFileSync(path.join(stubDirectory, 'guardscan'), '#!/bin/sh\nexit "$STUB_STATUS"\n', {mode: 0o755});

      const result = spawnSync('sh', [hookPath], {
        cwd: repo,
        encoding: 'utf8',
        env: {...process.env, PATH: `${stubDirectory}${path.delimiter}${process.env.PATH}`, STUB_STATUS: String(scannerStatus)},
      });

      expect(result.status).toBe(hookStatusCode);
      expect(result.stdout.includes('rest-of-hook')).toBe(scannerStatus === 0);
    }
  );
});
