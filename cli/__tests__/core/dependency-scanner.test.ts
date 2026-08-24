import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DependencyScanner,
  DependencyScanError,
} from '../../src/core/dependency-scanner';
import { OsvClient } from '../../src/core/osv-client';
import { VulnerabilitySnapshotStore } from '../../src/core/vulnerability-cache';
import { CisaKevCatalogStore, CisaKevClient } from '../../src/core/cisa-kev';
import { collectPackageInventory } from '../../src/core/package-inventory';

function jsonResponse(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function writeNpmLock(repository: string, version = '4.17.20'): void {
  fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.17.0' } }));
  fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { lodash: '^4.17.0' } },
      'node_modules/lodash': { version },
    },
  }));
}

function advisory(id: string, aliases: string[]) {
  return {
    schema_version: '1.6.0',
    id,
    aliases,
    modified: '2026-01-02T00:00:00Z',
    published: '2026-01-01T00:00:00Z',
    summary: '<b>Prototype pollution</b>\nthrough unsafe merge',
    database_specific: { severity: 'HIGH', cwe_ids: ['CWE-1321'] },
    affected: [{
      package: { ecosystem: 'npm', name: 'lodash' },
      ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }],
    }],
    references: [{ type: 'ADVISORY', url: 'https://example.test/advisory' }],
  };
}

function kevCatalog(cves: string[]) {
  return {
    title: 'CISA Known Exploited Vulnerabilities Catalog',
    catalogVersion: '2026.07.13',
    dateReleased: '2026-07-13T10:00:00.000Z',
    count: cves.length,
    vulnerabilities: cves.map(cveID => ({
      cveID, vendorProject: 'Fixture', product: 'Fixture', vulnerabilityName: 'Fixture',
      dateAdded: '2026-07-13', shortDescription: 'Fixture', requiredAction: 'Update',
      dueDate: '2026-08-01', knownRansomwareCampaignUse: 'Unknown', notes: '',
    })),
  };
}

describe('DependencyScanner OSV integration', () => {
  let repository: string;
  let cache: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-vuln-'));
    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-vuln-cache-'));
    writeNpmLock(repository);
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
  });

  it('sends only package coordinates, canonicalizes aliases, and saves offline coverage', async () => {
    const requests: Array<{ url: string; body?: any }> = [];
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/v1/querybatch')) {
        return jsonResponse({ results: [{ vulns: [
          { id: 'GHSA-test-test-test', modified: '2026-01-02T00:00:00Z' },
          { id: 'CVE-2026-1234', modified: '2026-01-02T00:00:00Z' },
        ] }] });
      }
      if (url.endsWith('GHSA-test-test-test')) {return jsonResponse(advisory('GHSA-test-test-test', ['CVE-2026-1234']));}
      return jsonResponse(advisory('CVE-2026-1234', ['GHSA-test-test-test']));
    }) as typeof fetch;
    const client = new OsvClient({ fetchImpl, retries: 0 });
    const store = new VulnerabilitySnapshotStore(cache);
    const kevStore = new CisaKevCatalogStore(path.join(cache, 'kev'));
    const kevClient = new CisaKevClient({
      endpoint: 'https://example.test/kev.json',
      fetchImpl: jest.fn(async () => jsonResponse(kevCatalog(['CVE-2026-1234']))) as typeof fetch,
    });
    const scanner = new DependencyScanner();

    const results = await scanner.scan(repository, { client, snapshotStore: store, kevClient, kevStore });
    const vulnerability = results[0].vulnerabilities[0];

    expect(requests[0].body).toEqual({ queries: [{ package: { ecosystem: 'npm', name: 'lodash' }, version: '4.17.20' }] });
    expect(JSON.stringify(requests[0].body)).not.toContain(repository);
    expect(vulnerability).toMatchObject({
      canonicalId: 'CVE-2026-1234',
      aliases: ['GHSA-test-test-test'],
      advisorySeverity: 'high',
      severity: 'high',
      fixedVersions: ['4.17.21'],
      recommendation: 'Update to 4.17.21 or later',
      title: 'Prototype pollution through unsafe merge',
      cweIds: ['CWE-1321'],
      knownExploited: true,
    });
    expect(results[0].knownExploitedEnrichment).toMatchObject({ status: 'live', catalogVersion: '2026.07.13' });
    expect(results[0].totalVulnerabilities).toBe(1);
    expect(vulnerability.fingerprint).toMatch(/^[a-f0-9]{64}$/);

    const offline = await scanner.scan(repository, { offline: true, snapshotStore: store, kevStore });
    expect(offline[0]).toMatchObject({ dataFreshness: 'fresh-cache', status: 'complete' });
    expect(offline[0].vulnerabilities[0].canonicalId).toBe('CVE-2026-1234');
    expect(offline[0].vulnerabilities[0].knownExploited).toBe(true);
    expect(offline[0].knownExploitedEnrichment.status).toBe('fresh-cache');

    const kevCacheFile = path.join(cache, 'kev', 'catalog.json');
    const cachedKev = JSON.parse(fs.readFileSync(kevCacheFile, 'utf8'));
    cachedKev.retrievedAt = '2000-01-01T00:00:00.000Z';
    fs.writeFileSync(kevCacheFile, JSON.stringify(cachedKev), 'utf8');
    const staleKev = await scanner.scan(repository, {
      offline: true, snapshotStore: store, kevStore, kevMaxCacheAgeDays: 1,
    });
    expect(staleKev[0].status).toBe('complete');
    expect(staleKev[0].knownExploitedEnrichment.status).toBe('stale-cache');
    expect(staleKev[0].vulnerabilities[0].knownExploited).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('fails closed when offline coverage is missing or mismatches the inventory', async () => {
    const scanner = new DependencyScanner();
    const store = new VulnerabilitySnapshotStore(cache);

    await expect(scanner.scan(repository, { offline: true, snapshotStore: store, enrichKnownExploited: false })).rejects.toMatchObject({
      code: 'OFFLINE_COVERAGE_UNAVAILABLE',
    });

    const client = new OsvClient({
      retries: 0,
      fetchImpl: jest.fn(async (input: string | URL | Request) => String(input).endsWith('/v1/querybatch')
        ? jsonResponse({ results: [{ vulns: [] }] })
        : jsonResponse({})) as typeof fetch,
    });
    await scanner.scan(repository, { client, snapshotStore: store, enrichKnownExploited: false });
    writeNpmLock(repository, '4.17.21');

    await expect(scanner.scan(repository, { offline: true, snapshotStore: store, enrichKnownExploited: false })).rejects.toMatchObject({
      code: 'OFFLINE_COVERAGE_MISMATCH',
    });
    const partial = await scanner.scan(repository, { offline: true, snapshotStore: store, allowPartial: true, enrichKnownExploited: false });
    expect(partial[0]).toMatchObject({ status: 'partial', dataFreshness: 'stale-cache' });
    expect(partial[0].errors[0].code).toBe('OFFLINE_COVERAGE_MISMATCH');
  });

  it('reuses matching stale OSV coverage only when partial coverage is explicit', async () => {
    const scanner = new DependencyScanner();
    const store = new VulnerabilitySnapshotStore(cache);
    const fetchImpl = jest.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/querybatch')) {
        return jsonResponse({ results: [{ vulns: [{ id: 'CVE-2026-1234', modified: '2026-01-02T00:00:00Z' }] }] });
      }
      return jsonResponse(advisory('CVE-2026-1234', []));
    }) as typeof fetch;
    await scanner.scan(repository, {
      client: new OsvClient({ fetchImpl, retries: 0 }), snapshotStore: store, enrichKnownExploited: false,
    });
    const snapshotDirectory = fs.readdirSync(cache)
      .map(value => path.join(cache, value))
      .find(file => fs.statSync(file).isDirectory());
    const snapshot = snapshotDirectory && path.join(snapshotDirectory, 'snapshot.json');
    expect(snapshot).toBeDefined();
    const value = JSON.parse(fs.readFileSync(snapshot!, 'utf8'));
    value.createdAt = '2000-01-01T00:00:00.000Z';
    fs.writeFileSync(snapshot!, JSON.stringify(value), 'utf8');

    await expect(scanner.scan(repository, {
      offline: true, snapshotStore: store, maxSnapshotAgeDays: 1, enrichKnownExploited: false,
    })).rejects.toMatchObject({ code: 'OFFLINE_COVERAGE_STALE' });
    const partial = await scanner.scan(repository, {
      offline: true, snapshotStore: store, maxSnapshotAgeDays: 1,
      allowPartial: true, enrichKnownExploited: false,
    });
    expect(partial[0]).toMatchObject({ status: 'partial', dataFreshness: 'stale-cache', totalVulnerabilities: 1 });
    expect(partial[0].vulnerabilities[0].canonicalId).toBe('CVE-2026-1234');
  });

  it('rejects refresh in offline mode and can enforce unresolved inventory errors', async () => {
    const scanner = new DependencyScanner();
    await expect(scanner.scan(repository, { offline: true, refresh: true, enrichKnownExploited: false })).rejects.toBeInstanceOf(DependencyScanError);

    fs.rmSync(path.join(repository, 'package-lock.json'));
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.17.0' } }));
    await expect(scanner.scan(repository, { strictInventory: true, enrichKnownExploited: false })).rejects.toMatchObject({ code: 'INVENTORY_INCOMPLETE' });
  });

  it('scores CVSS 3.1 vectors and derives policy severity from the standards-based score', async () => {
    const fetchImpl = jest.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/querybatch')) {
        return jsonResponse({ results: [{ vulns: [{ id: 'GHSA-unknown', modified: '2026-01-01T00:00:00Z' }] }] });
      }
      return jsonResponse({
        id: 'GHSA-unknown',
        modified: '2026-01-01T00:00:00Z',
        summary: 'No rating',
        severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N' }],
      });
    }) as typeof fetch;

    const results = await new DependencyScanner().scan(repository, {
      client: new OsvClient({ fetchImpl, retries: 0 }),
      snapshotStore: new VulnerabilitySnapshotStore(cache),
      enrichKnownExploited: false,
    });

    expect(results[0].vulnerabilities[0]).toMatchObject({
      advisorySeverity: 'medium',
      policySeverity: 'medium',
      severity: 'medium',
      cvss: { version: '3.1', vector: expect.stringContaining('CVSS:3.1'), score: 6.5, source: 'GHSA-unknown' },
    });
  });

  it('reuses a caller-owned package inventory without collecting the repository again', async () => {
    const inventory = collectPackageInventory(repository);
    const client = new OsvClient({
      retries: 0,
      fetchImpl: jest.fn(async (input: string | URL | Request) => String(input).endsWith('/v1/querybatch')
        ? jsonResponse({ results: [{ vulns: [] }] })
        : jsonResponse({})) as typeof fetch,
    });
    const results = await new DependencyScanner().scan(path.join(repository, 'missing'), {
      inventory,
      client,
      snapshotStore: new VulnerabilitySnapshotStore(cache),
      enrichKnownExploited: false,
    });
    expect(results[0]).toMatchObject({ queriedPackages: 1, inventoryDigest: inventory.digest });
  });

  it('reports KEV enrichment failure without downgrading complete OSV coverage', async () => {
    const osvFetch = jest.fn(async (input: string | URL | Request) => String(input).endsWith('/v1/querybatch')
      ? jsonResponse({ results: [{ vulns: [] }] })
      : jsonResponse({})) as typeof fetch;
    const kevClient = new CisaKevClient({
      endpoint: 'https://example.test/kev.json',
      fetchImpl: jest.fn(async () => {throw new Error('fixture unavailable');}) as typeof fetch,
    });
    const options = {
      client: new OsvClient({ fetchImpl: osvFetch, retries: 0 }),
      snapshotStore: new VulnerabilitySnapshotStore(cache),
      kevClient,
      kevStore: new CisaKevCatalogStore(path.join(cache, 'kev')),
    };
    await expect(new DependencyScanner().scan(repository, options)).rejects.toMatchObject({
      code: 'KEV_COVERAGE_UNAVAILABLE',
    });
    const partial = await new DependencyScanner().scan(repository, { ...options, allowPartial: true });
    expect(partial[0].status).toBe('partial');
    expect(partial[0].errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'KEV_COVERAGE_UNAVAILABLE' }),
    ]));
    expect(partial[0].knownExploitedEnrichment).toMatchObject({
      status: 'unavailable',
      error: { code: 'NETWORK_ERROR', message: expect.stringContaining('fixture unavailable') },
    });
  });

  it('marks vulnerability KEV state unknown when requested KEV coverage is unavailable', async () => {
    const osvFetch = jest.fn(async (input: string | URL | Request) => String(input).endsWith('/v1/querybatch')
      ? jsonResponse({ results: [{ vulns: [{ id: 'CVE-2026-1234', modified: '2026-01-02T00:00:00Z' }] }] })
      : jsonResponse(advisory('CVE-2026-1234', []))) as typeof fetch;
    const results = await new DependencyScanner().scan(repository, {
      client: new OsvClient({ fetchImpl: osvFetch, retries: 0 }),
      snapshotStore: new VulnerabilitySnapshotStore(cache),
      allowPartial: true,
      kevClient: new CisaKevClient({
        endpoint: 'https://example.test/kev.json',
        fetchImpl: jest.fn(async () => { throw new Error('fixture unavailable'); }) as typeof fetch,
      }),
      kevStore: new CisaKevCatalogStore(path.join(cache, 'kev')),
    });

    expect(results[0].vulnerabilities[0].knownExploited).toBe('unknown');
  });
});
