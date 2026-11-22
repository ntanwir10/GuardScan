import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { isSea } from 'node:sea';
import { promisify } from 'node:util';

const readCommand = promisify(execFile);
const NODE_ENTRY = ['dist', 'index.js'];
const TRACKED_FILE_LIMIT = 128 * 1024;
const INSTALL_GUIDE = 'https://github.com/ntanwir10/GuardScan/blob/main/docs/INSTALL.md';

export type InstallManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'brew' | 'scoop' | 'pipx';

export interface Installation {
  manager: InstallManager | 'standalone' | 'source' | 'unknown';
  path: string;
  version?: string;
  active?: boolean;
  global?: boolean;
  blockedReason?: string;
}

type Action = 'update' | 'uninstall';
type Invocation = { command: string; args: string[] };
type InstallationCommand = Invocation & { blockedReason?: string; active?: boolean };

const commands: Record<InstallManager, Record<Action, string[]>> = {
  npm: { update: ['install', '-g', 'guardscan@latest'], uninstall: ['uninstall', '-g', 'guardscan'] },
  pnpm: { update: ['add', '-g', 'guardscan@latest'], uninstall: ['remove', '-g', 'guardscan'] },
  yarn: { update: ['global', 'add', 'guardscan@latest'], uninstall: ['global', 'remove', 'guardscan'] },
  bun: { update: ['add', '-g', 'guardscan@latest'], uninstall: ['remove', '-g', 'guardscan'] },
  brew: { update: ['upgrade', 'guardscan'], uninstall: ['uninstall', 'guardscan'] },
  scoop: { update: ['update', 'guardscan'], uninstall: ['uninstall', 'guardscan'] },
  pipx: { update: ['upgrade', 'guardscan-cli'], uninstall: ['uninstall', 'guardscan-cli'] },
};

function realFile(file: string): string | undefined {
  try {
    return fs.statSync(file).isFile() ? fs.realpathSync(file) : undefined;
  } catch {
    return undefined;
  }
}

function readSmallFile(file: string): Buffer | undefined {
  try {
    const stat = fs.statSync(file);
    if (stat.isFile() && stat.size <= TRACKED_FILE_LIMIT) {
      return fs.readFileSync(file);
    }
  } catch { /* absent or unreadable ownership metadata */ }
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseJson(value: string | undefined): unknown {
  try {
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
}

function readPackage(file: string): Record<string, unknown> | undefined {
  return record(parseJson(readSmallFile(file)?.toString('utf8')));
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function pathDirectories(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path;
  const pathValue = Object.entries(environment).find(([key]) =>
    windows ? key.toUpperCase() === 'PATH' : key === 'PATH',
  )?.[1] ?? '';
  return [...new Set(pathValue.split(windows ? ';' : ':')
    .map(directory => windows ? directory.replace(/^"|"$/g, '') : directory)
    .filter(directory => paths.isAbsolute(directory)))];
}

function managerDirectories(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  return pathDirectories(environment, platform)
    .filter(directory => !/(?:^|[/\\])(?:node_modules|_npx)(?:[/\\]|$)/i.test(directory));
}

function executable(file: string): boolean {
  if (!realFile(file)) {return false;}
  if (process.platform === 'win32') {return true;}
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve Windows package-manager shims to native executables or their Node/PowerShell entry scripts. */
export function resolveInstallationInvocation(
  plan: Invocation,
  environment = process.env,
  platform = process.platform,
): Invocation {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path;
  const search = managerDirectories(environment, platform);
  const { command, args } = plan;
  for (const directory of search) {
    const direct = paths.join(directory, `${command}${windows ? '.exe' : ''}`);
    if (executable(direct)) {return { command: direct, args };}
    if (!windows) {continue;}

    if (command === 'scoop') {
      const script = paths.join(directory, 'scoop.ps1');
      if (realFile(script)) {
        const powershell = environment.SystemRoot
          ? paths.join(environment.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
          : 'powershell.exe';
        return { command: powershell, args: ['-NoProfile', '-File', script, ...args] };
      }
    }
    if (!realFile(paths.join(directory, `${command}.cmd`))) {continue;}

    const modules = paths.join(directory, 'node_modules');
    const entryPoints = command === 'npm' ? [paths.join(modules, 'npm', 'bin', 'npm-cli.js')]
      : command === 'pnpm' ? ['pnpm.cjs', 'pnpm.js'].map(file => paths.join(modules, 'pnpm', 'bin', file))
      : command === 'yarn' ? [paths.join(modules, 'yarn', 'bin', 'yarn.js')]
      : [];
    if (command === 'pnpm' || command === 'yarn') {
      entryPoints.push(paths.join(modules, 'corepack', 'dist', `${command}.js`));
    }
    const entry = entryPoints.find(realFile);
    if (!entry) {break;}
    const node = [directory, ...search].map(dir => paths.join(dir, 'node.exe')).find(executable);
    if (node) {return { command: node, args: [entry, ...args] };}
    break;
  }
  throw new Error(`Could not find ${command} on PATH. Run ${command} ${args.join(' ')} in a shell where it is available.`);
}

function commandEnvironment(): NodeJS.ProcessEnv {
  // Package-manager scripts export the scanned project's .npmrc (registry, prefix) as npm_* variables; drop them so a repository cannot choose where GuardScan installs from.
  const inScript = process.env.npm_lifecycle_event !== undefined;
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !(inScript && /^npm_/i.test(key))));
  const environment = { ...inherited, COREPACK_ENABLE_PROJECT_SPEC: '0', COREPACK_ENABLE_NETWORK: '0' };
  const name = Object.keys(environment).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
  return { ...environment, [name]: managerDirectories(environment, process.platform).join(path.delimiter) };
}

async function query(command: InstallManager, args: string[]): Promise<string | undefined> {
  try {
    const { command: executable, args: arguments_ } = resolveInstallationInvocation({ command, args });
    const { stdout } = await readCommand(executable, arguments_, {
      cwd: homedir(),
      env: { ...commandEnvironment(), HOMEBREW_NO_AUTO_UPDATE: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
      timeout: 4000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function outputPath(output: string | undefined): string | undefined {
  return output?.split(/\r?\n/).map(line => line.trim()).filter(line => path.isAbsolute(line)).pop();
}

interface Ownership {
  manager: InstallManager;
  entry: string;
  scope: string;
  marker: string;
  launchers?: string[];
  version?: string;
  global?: boolean;
  blockedReason?: string;
}

const installationOwners = new WeakMap<Installation, Ownership>();
const plannedActions = new WeakMap<InstallationCommand, { owner: Ownership; action: Action }>();

function packageEntry(packageRoot: string): { entry: string; version?: string } | undefined {
  const pkg = readPackage(path.join(packageRoot, 'package.json'));
  if (pkg?.name !== 'guardscan' || (record(pkg.bin)?.guardscan ?? pkg.bin) !== NODE_ENTRY.join('/')) {return undefined;}
  const entry = realFile(path.join(packageRoot, ...NODE_ENTRY));
  if (entry) {return { entry, version: string(pkg.version) };}
  return undefined;
}

function pnpmGroups(scope: string): string[] {
  try {
    return fs.readdirSync(scope, { withFileTypes: true }).filter(item => item.isSymbolicLink())
      .map(item => path.join(scope, item.name))
      .filter(root => Boolean(record(readPackage(path.join(root, 'package.json'))?.dependencies)?.guardscan));
  } catch {
    return [];
  }
}

async function nodeOwnership(manager: 'npm' | 'pnpm' | 'yarn' | 'bun'): Promise<Ownership | null | undefined> {
  let root: string | undefined;
  let scope: string | undefined;
  let marker: string | undefined;
  let blockedReason: string | undefined;
  let launchers: string[] | undefined;
  if (manager === 'pnpm') {
    const output = await query(manager, ['list', '-g', 'guardscan', '--depth=0', '--json']);
    const json = output?.match(/^\s*\[(?:\s*\{|\s*\])/m);
    const rows = parseJson(json ? output?.slice(json.index) : undefined);
    if (!Array.isArray(rows) || rows.length !== 1) {return undefined;}
    const project = record(rows[0]);
    scope = string(project?.path);
    const pkg = record(record(project?.dependencies)?.guardscan);
    if (!pkg) {return null;}
    root = string(pkg?.path);
    if (root && scope && !samePath(path.resolve(root, '..', '..'), scope)) {
      const groups = pnpmGroups(scope);
      if (groups.length !== 1) {return undefined;}
      marker = path.join(groups[0], 'node_modules', 'guardscan', 'package.json');
      const actualMarker = realFile(path.join(root, 'package.json'));
      if (!actualMarker || actualMarker !== realFile(marker)) {return undefined;}
      const group = readPackage(path.join(groups[0], 'package.json'));
      const dependencies = record(group?.dependencies);
      if (!dependencies || Object.keys(dependencies).some(name => name !== 'guardscan')) {
        blockedReason = 'The pnpm install group includes other packages. Manage that group directly with pnpm.';
      }
    }
  } else if (manager === 'bun') {
    const output = await query(manager, ['pm', 'ls', '-g']);
    const globalDir = output?.match(/^(.+) node_modules \(\d+ installed\)$/m)?.[1];
    if (globalDir && path.isAbsolute(globalDir)) {
      scope = globalDir;
      root = path.join(globalDir, 'node_modules', 'guardscan');
    }
    if (root && process.platform === 'win32') {
      const bin = outputPath(await query(manager, ['pm', 'bin', '-g']));
      const shim = bin && readSmallFile(path.join(bin, 'guardscan.bunx'));
      const target = shim?.toString('utf16le').split('\0')
        .flatMap(chunk => chunk.match(/(?:\.\.\\)+[^"\r\n]+\\guardscan\\dist\\index\.js/i) ?? [])[0];
      const app = target && bin && realFile(path.resolve(bin, target));
      if (app && app === packageEntry(root)?.entry) {launchers = [path.join(bin, 'guardscan.exe')];}
    }
  } else {
    scope = outputPath(await query(manager, manager === 'npm' ? ['root', '-g'] : ['--silent', 'global', 'dir']));
    if (scope) {root = path.join(scope, ...(manager === 'yarn' ? ['node_modules'] : []), 'guardscan');}
  }
  if (!root || !path.isAbsolute(root) || !scope || !path.isAbsolute(scope)) {return undefined;}
  const pkg = packageEntry(root);
  return pkg ? { manager, ...pkg, scope, marker: marker ?? path.join(root, 'package.json'), launchers, blockedReason } : null;
}

async function brewOwnership(): Promise<Ownership | null | undefined> {
  const keg = outputPath(await query('brew', ['--prefix', 'guardscan']));
  if (!keg) {return undefined;}
  const marker = path.join(keg, 'INSTALL_RECEIPT.json');
  if (!readPackage(marker)) {return null;}
  const launcher = path.join(keg, 'bin', 'guardscan');
  const entry = realFile(launcher);
  if (!entry) {return undefined;}
  const version = entry && path.basename(path.dirname(path.dirname(entry)));
  const pkg = packageEntry(path.join(keg, 'libexec', 'lib', 'node_modules', 'guardscan'));
  return { manager: 'brew', entry, scope: keg, marker, version: pkg?.version ?? version,
    launchers: [launcher, ...(pkg ? [pkg.entry] : [])] };
}

async function scoopOwnership(): Promise<Ownership | null | undefined> {
  const [prefix, listing] = await Promise.all([query('scoop', ['prefix', 'guardscan']), query('scoop', ['export'])]);
  const root = outputPath(prefix);
  const entry = root && realFile(path.join(root, 'guardscan.exe'));
  const exported = record(parseJson(listing));
  const apps = Array.isArray(exported?.apps) ? exported.apps.map(record) : [];
  const matches = apps.filter(app => app?.Name === 'guardscan');
  if (exported && !matches.length) {return null;}
  if (!root || !entry || matches.length !== 1 || typeof matches[0]?.Info !== 'string') {return undefined;}
  if (matches[0].Info === 'Install failed') {return undefined;}
  const version = string(matches[0].Version);
  const global = matches[0].Info.split(', ').includes('Global install');
  const blockedReason = matches[0].Info.split(', ').includes('Held package')
    ? 'Scoop has held this GuardScan installation. Manage it directly with Scoop.' : undefined;
  return { manager: 'scoop', entry, scope: path.dirname(root), marker: entry, version, global, blockedReason };
}

async function pipxOwnership(global: boolean): Promise<Ownership | null | undefined> {
  const suffix = global ? ['--global'] : [];
  const paths = await Promise.all(['PIPX_LOCAL_VENVS', 'PIPX_BIN_DIR'].map(key =>
    query('pipx', ['environment', '--value', key, ...suffix]),
  ));
  const venvs = outputPath(paths[0]);
  if (!venvs) {return undefined;}
  const venv = path.join(venvs, 'guardscan-cli');
  const marker = path.join(venv, 'pipx_metadata.json');
  if (!realFile(marker)) {return null;}
  const pkg = record(readPackage(marker)?.main_package);
  if (pkg?.package !== 'guardscan-cli') {return undefined;}
  const windows = process.platform === 'win32';
  const app = windows ? 'guardscan.exe' : 'guardscan';
  const launcher = path.join(venv, windows ? 'Scripts' : 'bin', app);
  const launcherEntry = realFile(launcher);
  if (!launcherEntry) {return undefined;}
  const lib = path.join(venv, windows ? 'Lib' : 'lib');
  let pythonDirs: string[];
  try {
    pythonDirs = windows ? [lib] : fs.readdirSync(lib).filter(dir => /^python\d/.test(dir)).map(dir => path.join(lib, dir));
  } catch { return undefined; }
  const entries = pythonDirs.flatMap(dir => realFile(path.join(dir, 'site-packages', 'guardscan_cli', 'bin', app)) ?? []);
  if (entries.length !== 1) {return undefined;}
  const launchers = [launcherEntry];
  const binDir = outputPath(paths[1]);
  if (windows && binDir) {
    const exposed = path.join(binDir, app);
    const copy = readSmallFile(exposed);
    if (copy && readSmallFile(launcher)?.equals(copy)) {launchers.push(exposed);}
  }
  return { manager: 'pipx', entry: entries[0], scope: venv, marker, version: string(pkg.package_version), launchers, global };
}

function shimTarget(file: string): string | undefined {
  if (process.platform === 'win32' && file.toLowerCase().endsWith('.exe')) {
    const shim = readSmallFile(file.slice(0, -4) + '.shim')?.toString('utf8');
    const target = shim?.match(/^path\s*=\s*"([^"\r\n]+)"/im)?.[1];
    return target && path.isAbsolute(target) ? realFile(target) : undefined;
  }
  const shim = readSmallFile(file)?.toString('utf8');
  const target = shim?.match(/(?:\$\{?basedir(?:_win)?\}?[/\\]|%~dp0[/\\]*|%dp0%[/\\]*)([^"\r\n]+[/\\]guardscan[/\\]dist[/\\]index\.js)/i)?.[1];
  return target ? realFile(path.resolve(path.dirname(file), target)) : undefined;
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function launchersIn(directories: string[]): string[] {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.ps1'] : [''];
  return directories.flatMap(directory => extensions.map(ext => path.join(directory, `guardscan${ext}`))).filter(executable);
}

/** `guardscan` launchers on PATH with distinct entry points, in PATH order, skipping project-local and npx directories. */
export function pathLaunchers(): string[] {
  const targets = new Set<string>();
  return launchersIn(managerDirectories(process.env, process.platform)).filter(file => {
    const real = realFile(file);
    // Resolve npm/pnpm shims, so one install's guardscan, .cmd and .ps1 wrappers count once.
    const target = real && (shimTarget(real) ?? real);
    if (!target || targets.has(target)) {return false;}
    targets.add(target);
    return true;
  });
}

export async function detectInstallations(): Promise<Installation[]> {
  const sea = isSea();
  const current = sea ? process.execPath : process.argv[1];
  const launchers = launchersIn(pathDirectories(process.env, process.platform));
  const candidates = [...(current ? [path.resolve(current)] : []), ...launchers].flatMap((file, index) => {
    const real = realFile(file);
    if (!real) {return [];}
    const entry = shimTarget(real) ?? real;
    const project = path.dirname(path.dirname(entry));
    const pkg = packageEntry(project);
    const active = index === 0 && Boolean(current);
    return [{ file, real, entry, pkg: pkg?.entry === entry ? pkg : undefined,
      source: Boolean(pkg?.entry === entry && realFile(path.join(project, 'src', 'index.ts'))), active }];
  });
  if (!candidates.length) {return [];}

  const all = await Promise.all([
    candidates.some(candidate => candidate.pkg || /\.exe$/i.test(candidate.file))
      ? Promise.all((['npm', 'pnpm', 'yarn', 'bun'] as const).map(nodeOwnership)) : [],
    process.platform === 'win32' ? [] : brewOwnership(),
    process.platform === 'win32' ? scoopOwnership() : undefined,
    candidates.some(candidate => !candidate.pkg) ? pipxOwnership(false) : undefined,
    process.platform !== 'win32' && candidates.some(candidate => !candidate.pkg) ? pipxOwnership(true) : undefined,
  ]);
  const owners = all.flat().filter((owner): owner is Ownership => Boolean(owner));
  const installations = new Map<string, Installation>();
  for (const candidate of candidates) {
    const transient = /[/\\](?:_npx|dlx-[^/\\]+|bunx-[^/\\]+)[/\\]|[/\\]node_modules[/\\]\.bin[/\\]/i.test(candidate.file);
    const matches = transient ? [] : owners.filter(owner => samePath(owner.entry, candidate.entry)
      || owner.launchers?.some(launcher => samePath(launcher, candidate.file) || samePath(launcher, candidate.real)));
    const brew = matches.find(owner => owner.manager === 'brew');
    const owner = brew ?? (matches.length === 1 ? matches[0] : undefined);
    const key = transient ? candidate.file : owner?.entry ?? candidate.entry;
    const managedLocation = /[/\\](?:(?:Cellar|apps)[/\\]guardscan|site-packages[/\\]guardscan_cli)[/\\]/i.test(candidate.entry);
    const manager = candidate.source ? 'source'
      : owner?.manager ?? (candidate.active && sea && !managedLocation ? 'standalone' : 'unknown');
    if (installations.has(key)) {continue;}
    const installation: Installation = {
      manager,
      path: candidate.file,
      version: candidate.pkg?.version ?? owner?.version,
      active: candidate.active,
      global: owner?.global,
      blockedReason: owner?.blockedReason,
    };
    if (owner) {installationOwners.set(installation, owner);}
    installations.set(key, installation);
  }
  return [...installations.values()];
}

export function getInstallationCommand(installation: Installation, action: Action): InstallationCommand {
  const command = installation.manager;
  if (command === 'source' || command === 'standalone' || command === 'unknown') {
    const hint = command === 'source'
      ? 'Follow the instructions for your source checkout.'
      : command === 'standalone'
        ? (action === 'update' ? 'Download and verify a new binary from GitHub Releases.' : 'Remove the standalone binary from its installation directory.')
        : 'Use the original installer or package manager to manage this copy.';
    throw new Error(`Cannot ${action} the ${command} GuardScan installation at ${JSON.stringify(installation.path)}. ${hint} ${INSTALL_GUIDE}`);
  }
  const args = [...commands[command][action]];
  if (installation.global && (command === 'pipx' || command === 'scoop')) {args.push('--global');}
  const plan = { command, args, ...(installation.active ? { active: true } : {}),
    ...(installation.blockedReason ? { blockedReason: installation.blockedReason } : {}) };
  const owner = installationOwners.get(installation);
  if (owner) {plannedActions.set(plan, { owner, action });}
  return plan;
}

function lookupOwnership(owner: Ownership): Promise<Ownership | null | undefined> {
  switch (owner.manager) {
    case 'brew': return brewOwnership();
    case 'scoop': return scoopOwnership();
    case 'pipx': return pipxOwnership(owner.global ?? false);
    default: return nodeOwnership(owner.manager);
  }
}

export async function runInstallationCommand(plan: InstallationCommand): Promise<void> {
  if (plan.blockedReason) {throw new Error(plan.blockedReason);}
  if (process.platform === 'win32' && plan.active && (plan.command === 'scoop' || plan.command === 'pipx')) {
    throw new Error(`Windows keeps this GuardScan installation open while it runs. Run ${plan.command} ${plan.args.join(' ')} after GuardScan exits.`);
  }
  const proof = plannedActions.get(plan);
  const before = proof && await lookupOwnership(proof.owner);
  if (!proof || !before || !samePath(before.scope, proof.owner.scope) || !samePath(before.entry, proof.owner.entry)) {
    throw new Error(`The ${plan.command} installation could not be verified. Run ${plan.command} ${plan.args.join(' ')} from the installation's original environment.`);
  }
  if (before.blockedReason) {throw new Error(before.blockedReason);}
  const { command, args } = resolveInstallationInvocation(plan);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: homedir(), env: commandEnvironment(), stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {resolve();}
      else {reject(new Error(`${plan.command} ${plan.args.join(' ')} failed (${signal ?? `exit ${code}`}).`));}
    });
  });
  const after = await lookupOwnership(proof.owner);
  if (proof.action === 'uninstall') {
    if (!after && !realFile(proof.owner.marker)) {return;}
  } else if (after && samePath(after.scope, before.scope) && after.version) {
    return;
  }
  throw new Error(`${plan.command} exited successfully but GuardScan could not verify the ${proof.action} in the selected installation.`);
}
