/* eslint-disable no-console -- Lifecycle commands report installation status and actions. */
import chalk from 'chalk';
import { Command, Option } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../core/config';
import { detectInstallations, getInstallationCommand, Installation, pathLaunchers, runInstallationCommand } from '../utils/installation';
import { atomicReplaceJson, readJsonFileBounded } from '../utils/private-state';
import { assertUpdatesOnline, getCurrentVersion, getLatestVersion, isNewerVersion, withInstallationLease } from '../utils/version';

interface LifecycleOptions {
  manager?: string;
  dryRun?: boolean;
  check?: boolean;
  auto?: string;
  yes?: boolean;
}

function printInstallations(installations: Installation[]): void {
  console.log(`Running GuardScan ${getCurrentVersion()}`);
  if (!installations.length) {console.log('No GuardScan installation found on PATH.');}
  for (const installation of installations) {
    console.log(`  ${installation.manager}: ${installation.path}${installation.version ? ` (${installation.version})` : ''}`);
  }
}

/** Warn once per new set of PATH launchers when GuardScan is installed more than once. Advisory only. */
export async function warnIfInstalledTwice(): Promise<void> {
  // Skip package scripts and npx (npm_lifecycle_event): detection there drops npm_* settings and could
  // mislabel global copies, then record the launcher set so a later shell run never warns correctly.
  if (!process.stderr.isTTY || process.env.CI || process.env.npm_lifecycle_event !== undefined) {return;}
  try {
    const launchers = pathLaunchers();
    if (launchers.length < 2) {return;}
    const stateFile = path.join(new ConfigManager().getCacheDir(), '.installation-check');
    const key = launchers.join('\n');
    let checked: string[] = [];
    try {
      const state = readJsonFileBounded(stateFile, 64 * 1024) as {checked?: unknown};
      if (Array.isArray(state.checked)) {checked = state.checked.filter((item): item is string => typeof item === 'string');}
    } catch { /* No earlier check. */ }
    if (checked.includes(key)) {return;}
    // Record first, so a slow or failing detection is not repeated on every command.
    atomicReplaceJson(stateFile, {checked: [...checked, key].slice(-20)});
    // A running unowned copy off PATH (npx, a project's node_modules/.bin, a checkout) is not a second
    // installation; one that is a PATH launcher, such as a second npm prefix, is.
    const realTarget = (file: string) => { try {return fs.realpathSync(file);} catch {return file;} };
    const onPath = new Set(launchers.map(realTarget));
    const copies = (await detectInstallations()).filter(copy =>
      !(copy.active && (copy.manager === 'unknown' || copy.manager === 'source') && !onPath.has(realTarget(copy.path))));
    if (copies.length < 2) {return;}
    console.error(chalk.yellow(`\nMore than one GuardScan installation found. "guardscan" on PATH runs ${launchers[0]}.`));
    for (const copy of copies) {
      let removal = '';
      if (!['unknown', 'source', 'standalone'].includes(copy.manager)) {
        // --manager only selects a copy when that manager owns exactly one; otherwise give the manager's own command.
        const plan = getInstallationCommand(copy, 'uninstall');
        removal = copies.filter(other => other.manager === copy.manager).length === 1
          ? `guardscan uninstall --manager ${copy.manager}` : [plan.command, ...plan.args].join(' ');
      }
      console.error(`  ${copy.manager}: ${copy.path}${copy.version ? ` (${copy.version})` : ''}${removal ? `  remove with: ${removal}` : ''}`);
    }
    console.error('Keep one copy. An "unknown" copy may be a different tool named guardscan; remove it with its own installer.\n');
  } catch { /* The check never affects the command. */ }
}

function selectInstallation(installations: Installation[], manager?: string): Installation {
  const matches = manager ? installations.filter(installation => installation.manager === manager) : installations;
  if (matches.length !== 1) {
    throw new Error(matches.length > 1
      ? 'Multiple installations found. Use --manager to select one; if that manager has several copies, fix PATH first.'
      : manager && installations.length
        ? `No ${manager} installation found. GuardScan is installed with ${[...new Set(installations.map(found => found.manager))].join(', ')}; select that with --manager, or omit --manager.`
        : `No ${manager || 'managed'} installation found. Install GuardScan with a supported package manager first.`);
  }
  return matches[0];
}

export async function updateCommand(options: LifecycleOptions): Promise<void> {
  if (options.check && options.dryRun) {throw new Error('Use --check separately from --dry-run; --check requires network access.');}
  if (options.auto !== undefined) {
    if (options.check || options.manager || options.dryRun) {throw new Error('Use --auto separately from --check, --manager, and --dry-run.');}
    const manager = new ConfigManager();
    if (options.auto !== 'status') {
      manager.init();
      manager.update({autoUpdate: options.auto === 'on'});
    }
    const config = manager.exists() ? manager.load() : undefined;
    console.log(`Automatic updates: ${config?.autoUpdate === true ? 'on' : 'off'}`);
    if (config?.autoUpdate && config.offlineMode) {console.log('Offline mode is enabled; automatic updates will wait until it is disabled.');}
    return;
  }

  const installations = await detectInstallations();
  printInstallations(installations);
  if (options.check) {
    const selected = options.manager ? selectInstallation(installations, options.manager) : undefined;
    const latest = await getLatestVersion(true);
    console.log(`Latest stable version: ${latest}`);
    const current = selected?.version ?? getCurrentVersion();
    console.log(isNewerVersion(latest, current) ? 'An update is available.' : `${selected ? 'The selected installation' : 'The running version'} is up to date.`);
    return;
  }

  const installation = selectInstallation(installations, options.manager);
  const plan = getInstallationCommand(installation, 'update');
  console.log(`Update command: ${[plan.command, ...plan.args].join(' ')}`);
  if (options.dryRun) {return;}
  assertUpdatesOnline();
  await withInstallationLease(() => runInstallationCommand(plan));
  console.log('Package-manager update completed. Run "guardscan --version" to check the installed version.');
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Detect installed copies and update through their owning package manager')
    .option('--check', 'List installations and check the latest stable version')
    .addOption(new Option('--auto <mode>', 'Configure automatic updates (off by default)').choices(['on', 'off', 'status']))
    .addOption(new Option('--manager <manager>', 'Select a package manager when multiple copies exist').choices(['npm', 'pnpm', 'yarn', 'bun', 'brew', 'scoop', 'pipx']))
    .option('--dry-run', 'Show the detected installation and command without changing anything')
    .action(updateCommand);
}

export function createUninstallCommand(): Command {
  return new Command('uninstall')
    .description('Uninstall GuardScan through the package manager that owns it; keep local data')
    .addOption(new Option('--manager <manager>', 'Select the package manager when multiple copies exist').choices(['npm', 'pnpm', 'yarn', 'bun', 'brew', 'scoop', 'pipx']))
    .option('--dry-run', 'Show the detected installation and uninstall command')
    .option('-y, --yes', 'Confirm removal of the selected installation')
    .action(async (options: LifecycleOptions) => {
      const installations = await detectInstallations();
      printInstallations(installations);
      const installation = selectInstallation(installations, options.manager);
      const plan = getInstallationCommand(installation, 'uninstall');
      console.log(`Uninstall command: ${[plan.command, ...plan.args].join(' ')}`);
      if (options.dryRun) {return;}
      if (!options.yes) {throw new Error('Run again with --yes to confirm uninstall, or --dry-run to preview.');}
      await withInstallationLease(() => runInstallationCommand(plan));
      console.log('Package-manager uninstall completed. Local configuration and reports were kept.');
    });
}
