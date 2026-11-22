import axios from 'axios';
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createUninstallCommand, createUpdateCommand, warnIfInstalledTwice } from '../../src/commands/update';
import { ConfigManager } from '../../src/core/config';
import * as installation from '../../src/utils/installation';

jest.mock('axios');
jest.mock('../../src/utils/installation');

const registry = jest.mocked(axios.get);
const detect = jest.mocked(installation.detectInstallations);
const planCommand = jest.mocked(installation.getInstallationCommand);
const run = jest.mocked(installation.runInstallationCommand);

const npm: installation.Installation = {manager: 'npm', path: '/npm/bin/guardscan', version: '1.0.0', active: true};
const brew: installation.Installation = {manager: 'brew', path: '/brew/bin/guardscan', version: '1.1.0'};

function invoke(command: Command, ...args: string[]) {
  return command.exitOverride().configureOutput({writeErr: () => undefined}).parseAsync(args, {from: 'user'});
}

describe('installation lifecycle commands', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let home: string;
  let config: ConfigManager;

  beforeEach(() => {
    jest.resetAllMocks();
    originalEnv = process.env;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-lifecycle-'));
    process.env = {...originalEnv, GUARDSCAN_HOME: home};
    delete process.env.GUARDSCAN_OFFLINE;
    config = new ConfigManager();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    detect.mockResolvedValue([npm]);
    planCommand.mockImplementation((owner, action) => ({command: owner.manager, args: [action, 'guardscan']}));
    run.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = originalEnv;
    fs.rmSync(home, {recursive: true, force: true});
  });

  it('requires explicit confirmation before uninstalling the detected copy', async () => {
    await expect(invoke(createUninstallCommand())).rejects.toThrow('--yes');
    expect(run).not.toHaveBeenCalled();
    expect(registry).not.toHaveBeenCalled();

    await invoke(createUninstallCommand(), '--yes');
    expect(planCommand).toHaveBeenLastCalledWith(npm, 'uninstall');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['update', createUpdateCommand],
    ['uninstall', createUninstallCommand],
  ] as const)('previews %s without contacting the registry or mutating the installation', async (action, create) => {
    process.env.GUARDSCAN_OFFLINE = '1';

    await invoke(create(), '--dry-run');

    expect(planCommand).toHaveBeenCalledWith(npm, action);
    expect(run).not.toHaveBeenCalled();
    expect(registry).not.toHaveBeenCalled();
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it('requires a unique selection and uses the owner of the selected installation', async () => {
    process.env.npm_config_user_agent = 'npm/11.0.0';
    detect.mockResolvedValue([npm, brew]);

    await expect(invoke(createUpdateCommand())).rejects.toThrow('Multiple installations');
    await expect(invoke(createUpdateCommand(), '--manager', 'pipx')).rejects.toThrow('No pipx');
    expect(run).not.toHaveBeenCalled();

    await invoke(createUpdateCommand(), '--manager', 'brew');
    expect(planCommand).toHaveBeenCalledWith(brew, 'update');
    expect(run).toHaveBeenCalledWith({command: 'brew', args: ['update', 'guardscan']});
  });

  it('names the owning manager when --manager points at a different one', async () => {
    detect.mockResolvedValue([brew]);

    await expect(invoke(createUninstallCommand(), '--manager', 'npm', '--yes'))
      .rejects.toThrow('No npm installation found. GuardScan is installed with brew');
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous manager when two copies have the same owner', async () => {
    detect.mockResolvedValue([npm, {...npm, path: '/other-node/bin/guardscan', active: false}]);

    await expect(invoke(createUninstallCommand(), '--manager', 'npm', '--yes')).rejects.toThrow('Multiple installations');

    expect(run).not.toHaveBeenCalled();
  });

  it('lists multiple copies and checks the stable version without invoking a package mutation', async () => {
    detect.mockResolvedValue([npm, brew]);
    registry.mockResolvedValue({data: {version: '99.0.0'}});

    await invoke(createUpdateCommand(), '--check');

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(npm.path));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(brew.path));
    expect(console.log).toHaveBeenCalledWith('Latest stable version: 99.0.0');
    expect(registry).toHaveBeenCalledTimes(1);
    expect(planCommand).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('turns automatic updates on and off and reports the persisted preference', async () => {
    await invoke(createUpdateCommand(), '--auto', 'status');
    expect(console.log).toHaveBeenLastCalledWith('Automatic updates: off');
    expect(config.exists()).toBe(false);

    await invoke(createUpdateCommand(), '--auto', 'on');
    expect(config.load().autoUpdate).toBe(true);
    jest.mocked(console.log).mockClear();
    await invoke(createUpdateCommand(), '--auto', 'status');
    expect(console.log).toHaveBeenCalledWith('Automatic updates: on');

    await invoke(createUpdateCommand(), '--auto', 'off');
    expect(config.load().autoUpdate).not.toBe(true);
    expect(console.log).toHaveBeenLastCalledWith('Automatic updates: off');
    expect(detect).not.toHaveBeenCalled();
    expect(registry).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    [['--auto'], /argument missing/],
    [['--auto', 'sometimes'], /invalid/],
    [['--auto', 'on', '--check'], /Use --auto separately/],
    [['--auto', 'on', '--manager', 'npm'], /Use --auto separately/],
    [['--auto', 'on', '--dry-run'], /Use --auto separately/],
    [['--check', '--dry-run'], /Use --check separately/],
    [['--manager', 'unsupported'], /invalid/],
  ] as const)('rejects invalid or conflicting arguments %j', async (args, error) => {
    await expect(invoke(createUpdateCommand(), ...args)).rejects.toThrow(error);

    expect(config.exists()).toBe(false);
    expect(registry).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('blocks an explicit update in offline mode', async () => {
    config.init();
    config.update({offlineMode: true});

    await expect(invoke(createUpdateCommand())).rejects.toThrow('offline mode');

    expect(run).not.toHaveBeenCalled();
    expect(registry).not.toHaveBeenCalled();
  });

  it('reports package manager failure without claiming success', async () => {
    run.mockRejectedValue(new Error('package manager failed'));

    await expect(invoke(createUpdateCommand())).rejects.toThrow('package manager failed');

    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('update completed'));
  });

  describe('duplicate installation warning', () => {
    const launchers = jest.mocked(installation.pathLaunchers);
    let stderrTTY: PropertyDescriptor | undefined;
    const output = () => jest.mocked(console.error).mock.calls.map(call => String(call[0])).join('\n');

    beforeEach(() => {
      stderrTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
      Object.defineProperty(process.stderr, 'isTTY', {configurable: true, value: true});
      delete process.env.CI;
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      launchers.mockReturnValue(['/npm/bin/guardscan', '/brew/bin/guardscan']);
      detect.mockResolvedValue([npm, brew]);
    });

    afterEach(() => {
      if (stderrTTY) {Object.defineProperty(process.stderr, 'isTTY', stderrTTY);} else {Reflect.deleteProperty(process.stderr, 'isTTY');}
    });

    it('names each copy and its uninstall command once per set of launchers', async () => {
      await warnIfInstalledTwice();
      expect(output()).toContain('More than one GuardScan installation found. "guardscan" on PATH runs /npm/bin/guardscan.');
      expect(output()).toContain('brew: /brew/bin/guardscan (1.1.0)  remove with: guardscan uninstall --manager brew');

      jest.mocked(console.error).mockClear();
      await warnIfInstalledTwice();
      expect(detect).toHaveBeenCalledTimes(1);
      expect(console.error).not.toHaveBeenCalled();

      launchers.mockReturnValue(['/npm/bin/guardscan', '/brew/bin/guardscan', '/pipx/bin/guardscan']);
      await warnIfInstalledTwice();
      expect(detect).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['one launcher on PATH', () => launchers.mockReturnValue(['/npm/bin/guardscan'])],
      ['redirected stderr', () => Object.defineProperty(process.stderr, 'isTTY', {configurable: true, value: false})],
      ['CI', () => { process.env.CI = 'true'; }],
    ])('stays silent without running package managers for %s', async (_case, arrange) => {
      arrange();
      await warnIfInstalledTwice();
      expect(detect).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('does not count a copy run through npx or a source checkout as a second installation', async () => {
      detect.mockResolvedValue([
        {manager: 'unknown', path: '/cache/_npx/1/node_modules/.bin/guardscan', active: true},
        {...npm, active: false},
      ]);
      await warnIfInstalledTwice();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('never fails the command when detection fails', async () => {
      detect.mockRejectedValue(new Error('package manager hung'));
      await expect(warnIfInstalledTwice()).resolves.toBeUndefined();
      expect(console.error).not.toHaveBeenCalled();
    });
  });
});
