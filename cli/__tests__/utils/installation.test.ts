import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  detectInstallations, getInstallationCommand, pathLaunchers, resolveInstallationInvocation, runInstallationCommand,
} from '../../src/utils/installation';

type Response = { stdout?: string; status?: number; remove?: string; replace?: { file: string; content: string } };

const posix = process.platform === 'win32' ? describe.skip : describe;

posix('installation ownership and execution', () => {
  let root: string;
  let bin: string;
  let log: string;

  function write(file: string, content: string, mode?: number): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { mode });
  }

  function makePackage(directory: string, version = '1.2.3'): string {
    write(path.join(directory, 'package.json'), JSON.stringify({
      name: 'guardscan', version, bin: { guardscan: 'dist/index.js' },
    }));
    const entry = path.join(directory, 'dist', 'index.js');
    write(entry, '#!/usr/bin/env node\n', 0o755);
    return entry;
  }

  function manager(name: string, responses: Record<string, Response>): void {
    const config = path.join(root, `${name}-responses.json`);
    write(config, JSON.stringify(responses));
    write(path.join(bin, name), `#!${process.execPath}\n` + `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (process.env.npm_config_registry) process.exit(96);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify([${JSON.stringify(name)}, ...args]) + '\\n');
const reply = JSON.parse(fs.readFileSync(${JSON.stringify(config)}, 'utf8'))[args.join(' ')];
if (!reply) process.exit(97);
if (reply.remove) fs.rmSync(reply.remove, {recursive: true});
if (reply.replace) fs.writeFileSync(reply.replace.file, reply.replace.content);
if (reply.stdout) process.stdout.write(reply.stdout);
process.exit(reply.status ?? 0);
`, 0o755);
  }

  function launch(directory: string, target: string): string {
    const filename = path.join(root, directory, 'guardscan');
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.symlinkSync(target, filename);
    return filename;
  }

  function cli(file: string, directories = [bin]): void {
    jest.replaceProperty(process, 'argv', [process.execPath, file]);
    jest.replaceProperty(process, 'env', {
      ...process.env, PATH: directories.join(path.delimiter), npm_config_user_agent: 'yarn/1.22.22 npm/?',
    });
  }

  function calls(): string[][] {
    return fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  }

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'guardscan installs & spaces-')));
    bin = path.join(root, 'bin');
    log = path.join(root, 'calls');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('ignores the invoking manager and deduplicates PATH aliases to the running npm install', async () => {
    const modules = path.join(root, 'lib', 'node_modules');
    const entry = makePackage(path.join(modules, 'guardscan'));
    const running = launch('bin', entry);
    const alias = launch('alias', running);
    manager('npm', { 'root -g': { stdout: modules } });
    cli(running, [bin, path.dirname(alias), bin]);

    const installations = await detectInstallations();
    expect(installations).toEqual([expect.objectContaining({ manager: 'npm', path: running, version: '1.2.3', active: true })]);
    expect(getInstallationCommand(installations[0], 'update')).toMatchObject({
      command: 'npm', args: ['install', '-g', 'guardscan@latest'],
    });
  });

  test('distinguishes a transient launcher from a second installation and leaves ambiguous ownership unmanaged', async () => {
    const copied = makePackage(path.join(root, '_npx', '123', 'node_modules', 'guardscan'));
    const other = launch('bin', makePackage(path.join(root, 'global', 'node_modules', 'guardscan')));
    manager('npm', { 'root -g': { stdout: path.join(root, 'global', 'node_modules') } });
    manager('yarn', { '--silent global dir': { stdout: path.join(root, 'global') } });
    cli(copied);

    const installations = await detectInstallations();
    expect(installations).toEqual([
      expect.objectContaining({ path: copied, manager: 'unknown', active: true }),
      expect.objectContaining({ path: other, manager: 'unknown', active: false }),
    ]);
    expect(() => getInstallationCommand(installations[0], 'uninstall')).toThrow(/original installer/);
  });

  test('lists PATH launchers with distinct targets, skipping aliases and project-local bins', () => {
    const first = launch('bin', makePackage(path.join(root, 'a', 'node_modules', 'guardscan')));
    const alias = launch('alias', first);
    const local = launch(path.join('project', 'node_modules', '.bin'), makePackage(path.join(root, 'project', 'pkg')));
    const second = launch('other', makePackage(path.join(root, 'b', 'node_modules', 'guardscan')));
    cli(first, [path.dirname(first), path.dirname(alias), path.dirname(local), path.dirname(second)]);

    expect(pathLaunchers()).toEqual([first, second]);
  });

  test('treats a linked source checkout and a project-local copy as unmanaged', async () => {
    const source = path.join(root, 'checkout', 'cli');
    const entry = makePackage(source);
    write(path.join(source, 'src', 'index.ts'), '');
    const modules = path.join(root, 'lib', 'node_modules');
    fs.mkdirSync(modules, { recursive: true });
    fs.symlinkSync(source, path.join(modules, 'guardscan'));
    const local = launch('project/node_modules/.bin', makePackage(path.join(root, 'project', 'node_modules', 'guardscan')));
    manager('npm', { 'root -g': { stdout: modules } });
    cli(entry, [bin, path.dirname(local)]);

    expect(await detectInstallations()).toEqual([
      expect.objectContaining({ path: entry, manager: 'source', active: true }),
      expect.objectContaining({ path: local, manager: 'unknown', active: false }),
    ]);
  });

  test('matches a pnpm v11 shim to the isolated group and refuses to erase companion packages', async () => {
    const scope = path.join(root, 'pnpm', 'global', 'v11');
    const group = path.join(scope, 'group-target');
    const dir = path.join(group, 'node_modules', 'guardscan');
    const entry = makePackage(dir);
    write(path.join(group, 'package.json'), JSON.stringify({ dependencies: { guardscan: 'latest', prettier: 'latest' } }));
    fs.symlinkSync(group, path.join(scope, 'group-link'));
    const shim = path.join(bin, 'guardscan');
    write(shim, '#!/bin/sh\nexec node "$basedir/../pnpm/global/v11/group-link/node_modules/guardscan/dist/index.js" "$@"\n', 0o755);
    manager('pnpm', {
      'list -g guardscan --depth=0 --json': { stdout: JSON.stringify([{ path: scope, dependencies: { guardscan: { path: dir } } }]) },
    });
    cli(entry);

    const installations = await detectInstallations();
    expect(installations).toEqual([expect.objectContaining({ manager: 'pnpm', path: entry, active: true })]);
    await expect(runInstallationCommand(getInstallationCommand(installations[0], 'uninstall'))).rejects.toThrow(/other packages/);
    expect(calls()).toEqual([['pnpm', 'list', '-g', 'guardscan', '--depth=0', '--json']]);
  });

  test('matches Bun custom globals and groups a pipx launcher with its embedded binary', async () => {
    const global = path.join(root, 'other Bun globals');
    const bunEntry = makePackage(path.join(global, 'node_modules', 'guardscan'));
    const bunLauncher = launch('bun-bin', bunEntry);
    manager('bun', { 'pm ls -g': { stdout: `${global} node_modules (1 installed)\n└── guardscan@1.2.3` } });
    const venvs = path.join(root, 'custom pipx home', 'venvs');
    const venv = path.join(venvs, 'guardscan-cli');
    write(path.join(venv, 'pipx_metadata.json'), JSON.stringify({
      main_package: { package: 'guardscan-cli', package_version: '1.2.4' },
    }));
    const pythonLauncher = path.join(venv, 'bin', 'guardscan');
    write(pythonLauncher, '#!/usr/bin/python3\n', 0o755);
    write(path.join(venv, 'lib', 'python3.13', 'site-packages', 'guardscan_cli', 'bin', 'guardscan'), 'binary', 0o755);
    const pipxLauncher = launch('pipx-bin', pythonLauncher);
    manager('pipx', { 'environment --value PIPX_LOCAL_VENVS': { stdout: venvs } });
    cli(bunEntry, [bin, path.dirname(bunLauncher), path.dirname(pipxLauncher)]);

    expect(await detectInstallations()).toEqual([
      expect.objectContaining({ manager: 'bun', path: bunEntry, version: '1.2.3', active: true }),
      expect.objectContaining({ manager: 'pipx', path: pipxLauncher, version: '1.2.4', active: false }),
    ]);
  });

  test('verifies a Homebrew receipt and uses the current formula scope', async () => {
    const keg = path.join(root, 'Cellar', 'guardscan', '1.2.8');
    write(path.join(keg, 'INSTALL_RECEIPT.json'), '{}');
    const entry = path.join(keg, 'bin', 'guardscan');
    write(entry, 'binary', 0o755);
    const launcher = launch('bin', entry);
    manager('brew', { '--prefix guardscan': { stdout: keg } });
    cli(launcher);

    const [brew] = await detectInstallations();
    expect(brew).toMatchObject({ manager: 'brew', path: launcher, version: '1.2.8' });
    expect(getInstallationCommand(brew, 'uninstall').args).toEqual(['uninstall', 'guardscan']);
  });

  test('executes only the selected manager and reports its failure without fallback', async () => {
    const modules = path.join(root, 'lib', 'node_modules');
    const entry = makePackage(path.join(modules, 'guardscan'));
    manager('npm', {
      'root -g': { stdout: modules },
      'install -g guardscan@latest': { status: 13 },
    });
    manager('yarn', {});
    cli(entry);
    const [installation] = await detectInstallations();

    await expect(runInstallationCommand(getInstallationCommand(installation, 'update'))).rejects.toThrow(/exit 13/);
    expect(calls().filter(args => !args.includes('root') && !args.includes('dir')))
      .toEqual([['npm', 'install', '-g', 'guardscan@latest']]);
  });

  test('keeps a scanned project from choosing the registry through package-script npm_* variables', async () => {
    const modules = path.join(root, 'lib', 'node_modules');
    const entry = makePackage(path.join(modules, 'guardscan'));
    manager('npm', { 'root -g': { stdout: modules }, 'install -g guardscan@latest': {} });
    cli(entry);
    process.env.npm_lifecycle_event = 'scan';
    process.env.npm_config_registry = 'http://127.0.0.1:9/untrusted/';
    const [installation] = await detectInstallations();

    await runInstallationCommand(getInstallationCommand(installation, 'update'));
    expect(calls()).toContainEqual(['npm', 'install', '-g', 'guardscan@latest']);
  });

  test('rechecks the configured scope and verifies an uninstall that exits zero', async () => {
    const modules = path.join(root, 'lib', 'node_modules');
    const pkg = path.join(modules, 'guardscan');
    const entry = makePackage(pkg);
    const other = path.join(root, 'other', 'node_modules');
    makePackage(path.join(other, 'guardscan'));
    manager('npm', { 'root -g': { stdout: modules } });
    cli(entry);
    const [installation] = await detectInstallations();
    const plan = getInstallationCommand(installation, 'uninstall');

    manager('npm', { 'root -g': { stdout: other }, 'uninstall -g guardscan': {} });
    await expect(runInstallationCommand(plan)).rejects.toThrow(/could not be verified/);
    expect(calls()).not.toContainEqual(['npm', 'uninstall', '-g', 'guardscan']);

    manager('npm', { 'root -g': { stdout: modules }, 'uninstall -g guardscan': {} });
    await expect(runInstallationCommand(plan)).rejects.toThrow(/could not verify the uninstall/);

    manager('npm', { 'root -g': { stdout: modules }, 'uninstall -g guardscan': { remove: pkg } });
    await expect(runInstallationCommand(plan)).resolves.toBeUndefined();
    expect(fs.existsSync(pkg)).toBe(false);
    expect(fs.existsSync(path.join(other, 'guardscan'))).toBe(true);
  });
});

describe('installation command planning', () => {
  test.each([
    ['npm', ['install', '-g', 'guardscan@latest'], ['uninstall', '-g', 'guardscan']],
    ['pnpm', ['add', '-g', 'guardscan@latest'], ['remove', '-g', 'guardscan']],
    ['yarn', ['global', 'add', 'guardscan@latest'], ['global', 'remove', 'guardscan']],
    ['bun', ['add', '-g', 'guardscan@latest'], ['remove', '-g', 'guardscan']],
    ['brew', ['upgrade', 'guardscan'], ['uninstall', 'guardscan']],
    ['scoop', ['update', 'guardscan', '--global'], ['uninstall', 'guardscan', '--global']],
    ['pipx', ['upgrade', 'guardscan-cli', '--global'], ['uninstall', 'guardscan-cli', '--global']],
  ] as const)('plans %s package commands', (manager, update, uninstall) => {
    const install = { manager, path: '/literal; guardscan && echo wrong', global: true };
    expect(getInstallationCommand(install, 'update')).toEqual({ command: manager, args: update });
    expect(getInstallationCommand(install, 'uninstall')).toEqual({ command: manager, args: uninstall });
  });

  test('passes Windows shim paths and metacharacters as literal Node arguments', () => {
    const realFs = jest.requireActual<typeof fs>('node:fs');
    const directory = 'C:\\Program Files & Tools\\Node';
    const scope = new Set(['npm.cmd', 'node.exe', 'node_modules\\npm\\bin\\npm-cli.js']
      .map(file => path.win32.join(directory, file)));
    jest.spyOn(realFs, 'statSync').mockImplementation(file => {
      if (scope.has(String(file))) {return { isFile: () => true } as fs.Stats;}
      throw new Error('not present');
    });
    jest.spyOn(realFs, 'realpathSync').mockImplementation(file => String(file));
    jest.spyOn(realFs, 'accessSync').mockImplementation(() => undefined);
    try {
      const args = ['-g', 'guardscan@latest & echo literal'];
      expect(resolveInstallationInvocation({ command: 'npm', args }, { Path: `"${directory}"` }, 'win32'))
        .toEqual({ command: path.win32.join(directory, 'node.exe'), args: [path.win32.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args] });
    } finally {
      jest.restoreAllMocks();
    }
  });
});
