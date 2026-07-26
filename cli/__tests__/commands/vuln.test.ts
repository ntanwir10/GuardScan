import { Command } from 'commander';
import { createVulnerabilityCommand } from '../../src/commands/vuln';
import { configManager } from '../../src/core/config';
import { DependencyScanner } from '../../src/core/dependency-scanner';

function result(severity: 'critical' | 'high' | 'medium' | 'low' = 'high') {
  return [{
    vulnerabilities: [{
      package: 'lodash', version: '4.17.20', severity, advisorySeverity: severity, policySeverity: severity,
      title: 'Prototype pollution', cve: 'CVE-2026-1234', canonicalId: 'CVE-2026-1234', aliases: [],
      advisoryIds: ['CVE-2026-1234'], cveIds: ['CVE-2026-1234'], recommendation: 'Update to 4.17.21 or later',
      fixedVersions: ['4.17.21'], ecosystem: 'npm', osvEcosystem: 'npm', scope: 'runtime', direct: true,
      manifestPath: 'package.json', lockfilePath: 'package-lock.json', dependencyPaths: ['lodash'], knownExploited: false,
      cweIds: [], modifiedAt: '2026-01-01T00:00:00Z', references: [], source: 'osv', fingerprint: 'a'.repeat(64),
    }],
    totalVulnerabilities: 1,
    critical: severity === 'critical' ? 1 : 0,
    high: severity === 'high' ? 1 : 0,
    medium: severity === 'medium' ? 1 : 0,
    low: severity === 'low' ? 1 : 0,
    ecosystem: 'npm', status: 'complete', source: 'osv', queriedPackages: 1, unresolvedPackages: 0,
    inventoryDigest: 'digest', dataFreshness: 'live', errors: [],
  }] as any;
}

describe('vuln command', () => {
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;
  let config: jest.SpyInstance;

  beforeEach(() => {
    process.exitCode = 0;
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    config = jest.spyOn(configManager, 'loadOrInit').mockReturnValue({ offlineMode: false } as any);
    delete process.env.GUARDSCAN_OFFLINE;
    delete process.env.GUARDSCAN_NO_CACHE;
  });

  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
    config.mockRestore();
    process.exitCode = 0;
  });

  it('registers cve and audit aliases and applies CI policy without hiding output', async () => {
    const scanner = { scan: jest.fn().mockResolvedValue(result('high')) } as unknown as DependencyScanner;
    const program = new Command().exitOverride();
    program.addCommand(createVulnerabilityCommand(scanner));

    await program.parseAsync(['node', 'test', 'cve', '.', '--format', 'json', '--ci']);

    expect((scanner.scan as jest.Mock)).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      offline: false, strictInventory: true, concurrency: 4, scope: 'all',
    }));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('guardscan.vulnerability.v1'));
    expect(process.exitCode).toBe(1);
    expect(createVulnerabilityCommand(scanner).aliases()).toEqual(['cve', 'audit']);
  });

  it('returns operational exit code 2 when offline snapshot access is disabled', async () => {
    const scanner = { scan: jest.fn() } as unknown as DependencyScanner;
    const program = new Command().exitOverride();
    program.addCommand(createVulnerabilityCommand(scanner));

    await program.parseAsync(['node', 'test', 'audit', '.', '--offline', '--no-cache']);

    expect(scanner.scan).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('requires an existing snapshot'));
    expect(process.exitCode).toBe(2);
  });

  it('treats the deprecated --no-cloud alias as offline in standalone command parsing', async () => {
    const scanner = { scan: jest.fn().mockResolvedValue(result('low')) } as unknown as DependencyScanner;
    const program = new Command().exitOverride();
    program.addCommand(createVulnerabilityCommand(scanner));

    await program.parseAsync(['node', 'test', 'vuln', '.', '--no-cloud']);

    expect(scanner.scan).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ offline: true }));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('--no-cloud is deprecated'));
  });

  it('supports explicit database update, status, and forced clearing', async () => {
    const scanner = {
      updateSnapshot: jest.fn().mockResolvedValue(result('low')),
      snapshotStatus: jest.fn().mockReturnValue({
        inventory: { coordinates: [], errors: [], digest: 'digest' },
        status: { exists: true, fresh: true, inventoryMatches: true, ageDays: 0 },
      }),
      clearSnapshot: jest.fn(),
      clearAllSnapshots: jest.fn(),
      knownExploitedStatus: jest.fn().mockReturnValue({ exists: false, fresh: false }),
      clearKnownExploitedCache: jest.fn(),
    } as unknown as DependencyScanner;

    const updateProgram = new Command().exitOverride();
    updateProgram.addCommand(createVulnerabilityCommand(scanner));
    await updateProgram.parseAsync(['node', 'test', 'vuln', 'db', 'update']);
    expect(scanner.updateSnapshot).toHaveBeenCalled();

    const statusProgram = new Command().exitOverride();
    statusProgram.addCommand(createVulnerabilityCommand(scanner));
    await statusProgram.parseAsync(['node', 'test', 'vuln', 'db', 'status']);
    expect(scanner.snapshotStatus).toHaveBeenCalled();

    const clearProgram = new Command().exitOverride();
    clearProgram.addCommand(createVulnerabilityCommand(scanner));
    await clearProgram.parseAsync(['node', 'test', 'vuln', 'db', 'clear', '--all', '--force']);
    expect(scanner.clearAllSnapshots).toHaveBeenCalled();
    expect(scanner.clearKnownExploitedCache).toHaveBeenCalled();
  });

  it('uses vulnerability config defaults while allowing CLI scope to override them', async () => {
    config.mockReturnValue({
      offlineMode: false,
      vulnerabilities: {
        enabled: true,
        source: 'osv',
        endpoint: 'https://osv.example.test',
        scope: 'runtime',
        snapshotMaxAgeDays: 3,
        enrichKnownExploited: false,
      },
    } as any);
    const scanner = { scan: jest.fn().mockResolvedValue(result('low')) } as unknown as DependencyScanner;
    const program = new Command().exitOverride();
    program.addCommand(createVulnerabilityCommand(scanner));

    await program.parseAsync(['node', 'test', 'vuln', '.', '--format', 'json']);
    expect(scanner.scan).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      endpoint: 'https://osv.example.test',
      scope: 'runtime',
      maxSnapshotAgeDays: 3,
      enrichKnownExploited: false,
      kevMaxCacheAgeDays: 3,
    }));

    await program.parseAsync(['node', 'test', 'vuln', '.', '--format', 'json', '--scope', 'all']);
    expect(scanner.scan).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ scope: 'all' }));
  });
});
