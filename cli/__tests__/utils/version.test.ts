import axios from "axios";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TELEMETRY_CONSTANTS } from "../../src/constants/telemetry-constants";
import { ConfigManager } from "../../src/core/config";
import * as installation from "../../src/utils/installation";
import { checkForUpdates, getLatestVersion } from "../../src/utils/version";

jest.mock("axios");
jest.mock("../../src/utils/installation");

const mockedAxios = axios as jest.Mocked<typeof axios>;
const detect = jest.mocked(installation.detectInstallations);
const planCommand = jest.mocked(installation.getInstallationCommand);
const run = jest.mocked(installation.runInstallationCommand);
const installed: installation.Installation = {manager: 'npm', path: '/npm/bin/guardscan', active: true};
const plan = {command: 'npm', args: ['install', '-g', 'guardscan@latest']};

describe("version update checks", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let guardScanHome: string;
  let config: ConfigManager;
  let ttyDescriptors: Array<PropertyDescriptor | undefined>;

  function setTTY(stdin: boolean, stderr: boolean) {
    Object.defineProperty(process.stdin, 'isTTY', {configurable: true, value: stdin});
    Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: true});
    Object.defineProperty(process.stderr, 'isTTY', {configurable: true, value: stderr});
  }

  function writeCache(content: unknown) {
    fs.writeFileSync(path.join(config.getCacheDir(), TELEMETRY_CONSTANTS.VERSION_CACHE_FILE),
      JSON.stringify(content), {mode: 0o600});
  }

  beforeEach(() => {
    jest.resetAllMocks();
    originalEnv = process.env;
    guardScanHome = fs.mkdtempSync(path.join(os.tmpdir(), "guardscan-version-"));
    process.env = {...originalEnv, GUARDSCAN_HOME: guardScanHome};
    delete process.env.GUARDSCAN_NO_TELEMETRY;
    delete process.env.GUARDSCAN_OFFLINE;
    delete process.env.CI;
    ttyDescriptors = [process.stdin, process.stdout, process.stderr].map(stream => Object.getOwnPropertyDescriptor(stream, 'isTTY'));
    setTTY(true, true);
    config = new ConfigManager();
    config.save({
      provider: "none",
      telemetryEnabled: true,
      offlineMode: false,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    });
    mockedAxios.get.mockResolvedValue({data: {version: '99.0.0'}});
    detect.mockResolvedValue([installed]);
    planCommand.mockReturnValue(plan);
    run.mockResolvedValue(undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = originalEnv;
    [process.stdin, process.stdout, process.stderr].forEach((stream, index) => {
      const descriptor = ttyDescriptors[index];
      if (descriptor) {
        Object.defineProperty(stream, 'isTTY', descriptor);
      } else {
        Reflect.deleteProperty(stream, 'isTTY');
      }
    });
    fs.rmSync(guardScanHome, { recursive: true, force: true });
  });

  it("skips the remote version check when telemetry is disabled for the command", async () => {
    process.env.GUARDSCAN_NO_TELEMETRY = "true";

    await checkForUpdates();

    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("skips the remote version check for numeric offline mode", async () => {
    process.env.GUARDSCAN_OFFLINE = " 1 ";

    await checkForUpdates({allowAutoUpdate: true});
    await expect(getLatestVersion(true)).rejects.toThrow('offline mode');

    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("writes update notifications to stderr so machine-readable stdout stays valid", async () => {
    const stdout = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await checkForUpdates();

    expect(stdout).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Update Available"));
  });

  it('uses the fresh cache for automatic checks and bypasses it when forced', async () => {
    await expect(getLatestVersion()).resolves.toBe('99.0.0');
    mockedAxios.get.mockResolvedValue({data: {version: '100.0.0'}});

    await expect(getLatestVersion()).resolves.toBe('99.0.0');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    await expect(getLatestVersion(true)).resolves.toBe('100.0.0');
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it.each([
    {latest: 'unparseable', checkedAt: new Date().toISOString()},
    {latest: '200.0.0-rc.1', checkedAt: new Date().toISOString()},
    {latest: '200.0.0', checkedAt: '2099-01-01T00:00:00.000Z'},
    {latest: '200.0.0', checkedAt: 'not a date'},
    {latest: '200.0.0', checkedAt: '2000-01-01T00:00:00.000Z'},
  ])('checks the registry when the version cache is invalid or stale (%j)', async invalid => {
    writeCache(invalid);

    await expect(getLatestVersion()).resolves.toBe('99.0.0');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'garbage', '99.0.0-rc.1'])('rejects invalid stable registry versions (%s)', async version => {
    mockedAxios.get.mockResolvedValue({data: {version}});

    await expect(getLatestVersion()).rejects.toThrow('invalid stable version');
    expect(fs.existsSync(path.join(config.getCacheDir(), TELEMETRY_CONSTANTS.VERSION_CACHE_FILE))).toBe(false);
  });

  it('skips automatic checks and rejects forced checks when recorded configuration is offline', async () => {
    config.update({offlineMode: true, autoUpdate: true});

    await checkForUpdates({allowAutoUpdate: true});
    await expect(getLatestVersion(true)).rejects.toThrow('offline mode');

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    {autoUpdate: false, allowAutoUpdate: true, stdin: true, stderr: true, ci: false},
    {autoUpdate: true, allowAutoUpdate: false, stdin: true, stderr: true, ci: false},
    {autoUpdate: true, allowAutoUpdate: true, stdin: false, stderr: true, ci: false},
    {autoUpdate: true, allowAutoUpdate: true, stdin: true, stderr: false, ci: false},
    {autoUpdate: true, allowAutoUpdate: true, stdin: true, stderr: true, ci: true},
  ])('does not auto-update without interactive opt-in permissions (%j)', async gating => {
    config.update({autoUpdate: gating.autoUpdate, telemetryEnabled: false});
    setTTY(gating.stdin, gating.stderr);
    if (gating.ci) {process.env.CI = 'true';}

    await checkForUpdates(gating.allowAutoUpdate ? {allowAutoUpdate: true} : undefined);

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(detect).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('updates the proven installation after interactive opt-in even without telemetry', async () => {
    config.update({autoUpdate: true, telemetryEnabled: false});
    process.env.GUARDSCAN_NO_TELEMETRY = 'true';

    await checkForUpdates({allowAutoUpdate: true});

    expect(planCommand).toHaveBeenCalledWith(installed, 'update');
    expect(run).toHaveBeenCalledWith(plan);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('reports background update failure without failing the completed command', async () => {
    config.update({autoUpdate: true});
    run.mockRejectedValue(new Error('package manager failed'));

    await expect(checkForUpdates({allowAutoUpdate: true})).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith('[UPDATE] package manager failed');
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('update completed'));
  });

  it('attempts each automatic update target once per cache window, even after failure', async () => {
    config.update({autoUpdate: true, telemetryEnabled: false});
    run.mockRejectedValue(new Error('package manager failed'));

    await checkForUpdates({allowAutoUpdate: true});
    await checkForUpdates({allowAutoUpdate: true});
    expect(run).toHaveBeenCalledTimes(1);

    writeCache({latest: '100.0.0', checkedAt: new Date().toISOString()});
    await checkForUpdates({allowAutoUpdate: true});
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not choose between multiple installations during automatic updates', async () => {
    config.update({autoUpdate: true});
    detect.mockResolvedValue([installed, {...installed, manager: 'brew', path: '/brew/bin/guardscan'}]);

    await checkForUpdates({allowAutoUpdate: true});

    expect(run).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Multiple or missing installations'));
  });

  it('never auto-updates when stdout is redirected', async () => {
    config.update({autoUpdate: true, telemetryEnabled: false});
    Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: false});

    await checkForUpdates({allowAutoUpdate: true});

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps notification-only network failures silent', async () => {
    mockedAxios.get.mockRejectedValue(new Error('network unavailable'));

    await checkForUpdates({allowAutoUpdate: true});

    expect(console.error).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
