import { Command } from 'commander';
import { jest } from '@jest/globals';
import { createVulnerabilityCommand } from '../../src/commands/vuln';
import type { DependencyScanner, DependencyScanResult } from '../../src/core/dependency-scanner';
import { filterPackageInventory, PackageInventory } from '../../src/core/package-inventory';
import { configManager } from '../../src/core/config';

jest.mock('../../src/core/config', () => ({
  configManager: { loadOrInit: jest.fn() },
}));

const mockedConfigManager = configManager as jest.Mocked<typeof configManager>;

function getSubcommand(program: Command, name: string): Command {
  const command = program.commands.find(candidate => candidate.name() === name);
  if (!command) {throw new Error(`Missing ${name} command`);}
  return command;
}

function getOutput(spy: jest.SpiedFunction<typeof console.log>): string {
  return spy.mock.calls.map(([value]) => String(value ?? '')).join('\n');
}

function scanResult(overrides: Partial<DependencyScanResult> = {}): DependencyScanResult {
  return {
    vulnerabilities: [], totalVulnerabilities: 0, critical: 0, high: 0, medium: 0, low: 0,
    ecosystem: 'npm', status: 'complete', source: 'osv', queriedPackages: 1,
    unresolvedPackages: 0, inventoryDigest: 'digest', dataFreshness: 'live',
    knownExploitedEnrichment: { status: 'disabled', source: 'cisa-kev' }, errors: [],
    ...overrides,
  };
}

describe('vuln database commands', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
    mockedConfigManager.loadOrInit.mockReturnValue({
      clientId: 'test', provider: 'none', telemetryEnabled: false, offlineMode: false,
      createdAt: '2026-01-01T00:00:00.000Z', lastUsed: '2026-01-01T00:00:00.000Z',
      vulnerabilities: { enabled: true, source: 'osv', scope: 'runtime' },
    } as any);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errorSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('fails update without printing success when snapshot persistence is partial', async () => {
    const scanner = {
      updateSnapshot: jest.fn<DependencyScanner['updateSnapshot']>().mockResolvedValue([scanResult({
        status: 'partial',
        errors: [{ code: 'SNAPSHOT_PERSIST_FAILED', message: 'disk full' }],
      })]),
    } as unknown as DependencyScanner;

    const db = getSubcommand(createVulnerabilityCommand(scanner), 'db');
    const update = getSubcommand(db, 'update');
    await update.parseAsync(['/tmp/repository'], { from: 'user' });

    expect(process.exitCode).toBe(2);
    expect(getOutput(logSpy)).not.toMatch(/snapshot updated/i);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/update failed.*SNAPSHOT_PERSIST_FAILED|disk full/i));
  });

  it('fails update when the returned snapshot is not usable', async () => {
    const scanner = {
      updateSnapshot: jest.fn<DependencyScanner['updateSnapshot']>().mockResolvedValue([scanResult()]),
      snapshotStatus: jest.fn().mockReturnValue({
        inventory: { coordinates: [], manifests: [], errors: [], digest: 'current' },
        status: { exists: false, fresh: false, inventoryMatches: false },
      }),
    } as unknown as DependencyScanner;

    const db = getSubcommand(createVulnerabilityCommand(scanner), 'db');
    await getSubcommand(db, 'update').parseAsync(['/tmp/repository'], { from: 'user' });

    expect(process.exitCode).toBe(2);
    expect(getOutput(logSpy)).not.toMatch(/snapshot updated/i);
  });

  it('computes status inventory coverage using the configured runtime scope', async () => {
    const inventory: PackageInventory = {
      repository: '/tmp/repository',
      coordinates: [
        {
          ecosystem: 'npm', osvEcosystem: 'npm', name: 'runtime-package', exactVersion: '1.0.0',
          scope: 'runtime', direct: true, manifestPath: 'package.json', lockfilePath: 'package-lock.json', dependencyPaths: ['runtime-package'],
        },
        {
          ecosystem: 'npm', osvEcosystem: 'npm', name: 'dev-package', exactVersion: '2.0.0',
          scope: 'development', direct: true, manifestPath: 'package.json', lockfilePath: 'package-lock.json', dependencyPaths: ['dev-package'],
        },
      ], manifests: ['package.json', 'package-lock.json'], errors: [], digest: 'all-digest',
    };
    const runtimeInventory = filterPackageInventory(inventory, { scope: 'runtime' });
    const scanner = {
      snapshotStatus: jest.fn().mockReturnValue({
        inventory,
        status: {
          exists: true, fresh: true, inventoryMatches: false, sourceMatches: true, ageDays: 0,
          snapshot: {
            inventoryDigest: runtimeInventory.digest, createdAt: '2026-09-07T00:00:00.000Z',
            sourceEndpoint: 'https://api.osv.dev', coordinates: [], matches: [], droppedMatches: 0,
            complete: true, schemaVersion: 'guardscan.vulnerability-snapshot.v1',
          },
        },
      }),
      knownExploitedStatus: jest.fn().mockReturnValue({ exists: false, fresh: false }),
    } as unknown as DependencyScanner;

    const db = getSubcommand(createVulnerabilityCommand(scanner), 'db');
    await getSubcommand(db, 'status').parseAsync(['/tmp/repository'], { from: 'user' });

    const output = JSON.parse(getOutput(logSpy));
    expect(output.inventoryMatches).toBe(true);
    expect(output.packages).toBe(1);
    expect(output.inventoryDigest).toBe(runtimeInventory.digest);
  });

  it('uses a sanitized repository identifier in JSON output', async () => {
    const scanner = {
      scan: jest.fn<DependencyScanner['scan']>().mockResolvedValue([scanResult()]),
    } as unknown as DependencyScanner;
    const command = createVulnerabilityCommand(scanner);

    await command.parseAsync(['/private/user-sensitive/repository', '--format', 'json'], { from: 'user' });

    const output = JSON.parse(getOutput(logSpy));
    expect(output.run.repository).toBe('.');
    expect(JSON.stringify(output)).not.toContain('/private/user-sensitive/repository');
  });
});
