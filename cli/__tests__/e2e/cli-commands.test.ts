/**
 * Installed-CLI behavior contracts.
 *
 * These tests intentionally execute dist/index.js in a child process. They use
 * argv arrays (never a shell command string) and keep both project data and
 * GuardScan state inside a disposable directory.
 */

import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';

type CliResult = SpawnSyncReturns<string> & { status: number };

describe('CLI end-to-end contracts', () => {
  const cliPath = path.join(__dirname, '../../dist/index.js');
  let root: string;
  let project: string;
  let home: string;

  const runCli = (args: string[], timeout = 60_000): CliResult => {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: project,
      encoding: 'utf8',
      shell: false,
      timeout,
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
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-cli-e2e-'));
    project = path.join(root, 'project');
    home = path.join(root, 'home');
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(home, { recursive: true });

    fs.writeFileSync(
      path.join(project, 'index.js'),
      [
        'export function add(left, right) {',
        '  return left + right;',
        '}',
        '// Deterministic scanner fixture:',
        'const apiKey = "AKIAIOSFODNN7EXAMPLE";',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({
        name: 'guardscan-e2e-fixture',
        version: '1.0.0',
        private: true,
        dependencies: { lodash: '4.17.20' },
      }, null, 2)
    );
    fs.writeFileSync(
      path.join(project, 'package-lock.json'),
      JSON.stringify({
        name: 'guardscan-e2e-fixture',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': {
            name: 'guardscan-e2e-fixture',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          },
          'node_modules/lodash': {
            version: '4.17.20',
            license: 'MIT',
          },
        },
      }, null, 2)
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('initializes private defaults in the isolated GuardScan home', () => {
    const result = runCli(['--no-telemetry', 'init']);
    expect(result.status).toBe(0);

    const configPath = path.join(home, '.guardscan', 'config.yml');
    expect(fs.existsSync(configPath)).toBe(true);
    const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(config).toMatchObject({
      provider: 'none',
      telemetryEnabled: false,
      offlineMode: true,
    });
    expect(config.clientId).toBeUndefined();
  });

  it('emits a versioned security envelope and honors CVE/partial flags', () => {
    const output = path.join(project, 'security.json');
    const result = runCli([
      '--no-telemetry',
      'security',
      '--offline',
      '--no-cve',
      '--allow-partial',
      '--ci',
      '--format',
      'json',
      '--output',
      output,
      '--max-findings',
      '1000',
    ]);

    expect(result.status).toBe(0);
    expect(fs.existsSync(output)).toBe(true);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(report.schemaVersion).toBe('guardscan.scan.v1');
    expect(report.command).toBe('security');
    expect(report.run).toMatchObject({
      offline: true,
      ci: true,
      allowPartial: false,
      executionMode: 'static-analysis',
    });
    expect(report.security.findings).toEqual(expect.any(Array));
    expect(report.security.scanners).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scanner: 'dependencies',
        status: 'skipped',
        skipReason: 'disabled',
      }),
    ]));
    expect(report.policy).toMatchObject({ status: 'passed', exitCode: 0 });
    expect(report.errors).toEqual([]);
  }, 90_000);

  it('uses exit code 1 for a finding-policy failure and records it in JSON', () => {
    const output = path.join(project, 'policy-failure.json');
    const result = runCli([
      '--no-telemetry',
      'security',
      '--offline',
      '--no-cve',
      '--allow-partial',
      '--ci',
      '--format',
      'json',
      '--output',
      output,
      '--max-findings',
      '0',
    ]);

    expect(result.status).toBe(1);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.policy.status).toBe('policy-failed');
    expect(report.policy.exitCode).toBe(1);
    expect(report.policy.reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/exceeds maximum 0/),
    ]));
  }, 90_000);

  it('keeps every comprehensive-scan section in machine-readable JSON', () => {
    const output = path.join(project, 'comprehensive.json');
    const result = runCli([
      '--no-telemetry',
      'scan',
      '--offline',
      '--no-cve',
      '--allow-partial',
      '--skip-tests',
      '--skip-ai',
      '--ci',
      '--format',
      'json',
      '--output',
      output,
      '--max-findings',
      '1000',
    ], 120_000);

    expect(result.status).toBe(0);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(report.schemaVersion).toBe('guardscan.scan.v1');
    expect(report.command).toBe('scan');
    expect(report.run).toMatchObject({
      offline: true,
      ci: true,
      allowPartial: false,
      executionMode: 'static-analysis',
    });
    expect(report.security).toEqual(expect.objectContaining({
      findings: expect.any(Array),
      scanners: expect.any(Array),
    }));
    expect(report.quality).toEqual(expect.objectContaining({ status: expect.any(String) }));
    expect(report.sbom).toEqual(expect.objectContaining({ status: expect.any(String) }));
    expect(report.ai).toEqual(expect.objectContaining({ status: expect.any(String) }));
    expect(report.policy).toMatchObject({ status: 'passed', exitCode: 0 });
    expect(report.errors).toEqual(expect.any(Array));
  }, 150_000);

  it('writes SARIF with complete fix objects only', () => {
    const output = path.join(project, 'security.sarif');
    const result = runCli([
      '--no-telemetry',
      'security',
      '--offline',
      '--no-cve',
      '--allow-partial',
      '--format',
      'sarif',
      '--output',
      output,
      '--max-findings',
      '1000',
    ]);

    expect(result.status).toBe(0);
    const sarif = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(sarif.$schema).toBe(
      'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json'
    );
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].results).toEqual(expect.any(Array));
    for (const finding of sarif.runs[0].results) {
      for (const fix of finding.fixes || []) {
        expect(fix.artifactChanges).toEqual(expect.any(Array));
        expect(fix.artifactChanges.length).toBeGreaterThan(0);
      }
    }
  }, 90_000);

  it('generates an offline SBOM from the local lockfile inventory', () => {
    const output = path.join(project, 'sbom.json');
    const result = runCli(['--no-telemetry', '--offline', 'sbom', '--format', 'spdx', '--output', output]);

    expect(result.status).toBe(0);
    const sbom = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(sbom).toMatchObject({
      spdxVersion: 'SPDX-2.3',
      dataLicense: 'CC0-1.0',
      name: 'project',
    });
    expect(sbom.documentNamespace).toMatch(/^https:\/\/guardscancli\.com\/spdx\/project\//);
    expect(sbom.packages).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'lodash', versionInfo: '4.17.20' }),
    ]));
  }, 90_000);

  it('fails closed with exit code 2 when offline CVE coverage is unavailable', () => {
    const result = runCli([
      '--no-telemetry',
      'vuln',
      '.',
      '--offline',
      '--format',
      'json',
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/snapshot|offline vulnerability/i);
  });

  it('reports telemetry as opt-in and refuses synchronization while disabled', () => {
    const status = runCli(['--no-telemetry', 'telemetry', 'status']);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain('Consent: disabled');
    expect(status.stdout).toContain('Pending events: 0');

    const sync = runCli(['--no-telemetry', 'telemetry', 'sync']);
    expect(sync.status).toBe(1);
    expect(sync.stderr).toMatch(/disabled/i);
  });

  it('clears all repository caches without deleting the telemetry spool', () => {
    const cacheRoot = path.join(home, '.guardscan', 'cache');
    const cachedFile = path.join(cacheRoot, 'repo-a', 'exact-cache.json');
    const eventFile = path.join(home, '.guardscan', 'telemetry', 'events', 'event-1.json');
    fs.mkdirSync(path.dirname(cachedFile), { recursive: true });
    fs.mkdirSync(path.dirname(eventFile), { recursive: true });
    fs.writeFileSync(cachedFile, '{}');
    fs.writeFileSync(eventFile, JSON.stringify({
      eventId: 'event-1', action: 'scan', loc: 1, durationMs: 1,
      executionMode: 'static', occurredAt: Date.now(),
    }));

    const result = runCli(['--no-telemetry', 'cache', 'clear', '--all', '--force']);
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(cacheRoot, 'repo-a'))).toBe(false);
    expect(fs.existsSync(eventFile)).toBe(true);
  });
});
