/** Public command-surface smoke tests against the compiled CLI. */

import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type CliResult = SpawnSyncReturns<string> & { status: number };

describe('CLI command surface', () => {
  const cliPath = path.join(__dirname, '../../dist/index.js');
  const commands = [
    'init',
    'run',
    'scan',
    'security',
    'test',
    'sbom',
    'perf',
    'mutation',
    'rules',
    'config',
    'status',
    'reset',
    'commit',
    'explain',
    'test-gen',
    'docs',
    'chat',
    'refactor',
    'threat-model',
    'migrate',
    'review',
    'models',
    'routing',
    'budget',
    'metrics',
    'cache',
    'telemetry',
    'vuln',
  ] as const;
  let root: string;
  let project: string;
  let home: string;

  const runCli = (args: string[]): CliResult => {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: project,
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
      env: {
        ...process.env,
        GUARDSCAN_HOME: home,
        HOME: home,
        USERPROFILE: home,
        GUARDSCAN_NO_TELEMETRY: 'true',
        GUARDSCAN_OFFLINE: 'true',
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
      windowsHide: true,
    });
    if (result.error) {
      throw result.error;
    }
    return result as CliResult;
  };

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-command-help-'));
    project = path.join(root, 'project');
    home = path.join(root, 'home');
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
      name: 'command-surface-fixture',
      version: '1.0.0',
      private: true,
    }));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('prints a semantic version without touching the real home directory', () => {
    const result = runCli(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\b1\.1\.0\b/);
  });

  it('lists every supported top-level command and privacy flag', () => {
    const result = runCli(['--help']);
    expect(result.status).toBe(0);
    for (const command of commands) {
      const displayed = command === 'vuln' ? 'vuln\\|cve' : command;
      expect(result.stdout).toMatch(new RegExp(`^\\s{2}${displayed}(?:\\s|$)`, 'm'));
    }
    expect(result.stdout).toContain('--no-telemetry');
    expect(result.stdout).toContain('--no-cache');
    expect(result.stdout).toContain('--offline');
  });

  it.each(commands)('%s --help exits successfully and names the command', command => {
    const result = runCli([command, '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Usage: guardscan ${command}`);
    expect(result.stderr).toBe('');
  });

  it('exposes cve and audit as aliases for the vulnerability command', () => {
    for (const alias of ['cve', 'audit']) {
      const result = runCli([alias, '--help']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage: guardscan vuln|cve');
      expect(result.stdout).toContain('Scan exact dependency versions');
    }
  });
});
