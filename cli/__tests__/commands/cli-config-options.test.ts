import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

describe('CLI config and global option parsing', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-cli-config-options-'));
    fs.mkdirSync(path.join(home, '.guardscan'));
    fs.writeFileSync(path.join(home, '.guardscan', 'config.yml'), yaml.dump({
      provider: 'none', telemetryEnabled: false, offlineMode: true,
      createdAt: '2026-01-01T00:00:00.000Z', lastUsed: '2026-01-01T00:00:00.000Z',
    }), {mode: 0o600});
  });

  afterEach(() => fs.rmSync(home, {recursive: true, force: true}));

  function cli(args: string[], cwd?: string) {
    const env: NodeJS.ProcessEnv = {...process.env, HOME: home, USERPROFILE: home, GUARDSCAN_HOME: home,
      GUARDSCAN_NO_TELEMETRY: 'true'};
    delete env.GUARDSCAN_OFFLINE;
    delete env.GUARDSCAN_DEBUG;
    return spawnSync(process.execPath, [path.resolve(__dirname, '../../dist/index.js'), ...args], {
      env, cwd, encoding: 'utf8', timeout: 15_000,
    });
  }

  it.each([
    ['config', '--offline', 'false'],
    ['--no-cache', '--no-telemetry', 'config', '--offline', 'false'],
    ['config', '--offline', 'false', '--no-cache', '--no-telemetry', '--no-cloud'],
  ])('persists config offline=false with existing global options (%j)', (...args) => {
    const result = cli(args);

    expect({status: result.status, stderr: result.stderr}).toEqual({status: 0, stderr: ''});
    expect(yaml.load(fs.readFileSync(path.join(home, '.guardscan', 'config.yml'), 'utf8')))
      .toMatchObject({offlineMode: false});
  });

  it('keeps the existing version flag available after a subcommand', () => {
    const {version} = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {version: string};
    const result = cli(['config', '--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/).at(-1)).toBe(version);
  });

  it('keeps global privacy flags available on nested commands', () => {
    const result = cli(['vuln', 'db', 'status', '--offline', '--no-cache', '--no-telemetry']);
    expect({status: result.status, stderr: result.stderr}).toEqual({status: 0, stderr: ''});
    expect(result.stdout).toContain('guardscan.vulnerability-snapshot-status.v1');
  });

  it.each([[], ['--isolate-project-network']])('explains blocked offline project execution without running it (%j)', (...isolation) => {
    const repository = path.join(home, 'project');
    fs.mkdirSync(repository);
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      name: 'offline-fixture', version: '1.0.0',
      scripts: {test: 'node -e "require(\'fs\').writeFileSync(\'executed\', \'unsafe\')"'},
    }));
    fs.writeFileSync(path.join(repository, 'owned.js'), 'module.exports = 1;\n');
    const output = path.join(repository, 'report.json');

    const result = cli(['scan', '--run-project-code', ...isolation, '--no-cve', '--skip-ai',
      '--format', 'json', '--output', output], repository);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('--run-project-code is disabled in offline mode');
    expect(fs.existsSync(path.join(repository, 'executed'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(output, 'utf8')).run.executionMode).toBe('static-analysis');
  });
});
