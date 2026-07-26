import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CisaKevCatalog,
  CisaKevCatalogStore,
  CisaKevClient,
  CisaKevError,
} from '../../src/core/cisa-kev';
import { DependencyCoordinate, PackageInventory } from '../../src/core/package-inventory';
import { OsvMatch } from '../../src/core/osv-client';
import { VulnerabilitySnapshotStore } from '../../src/core/vulnerability-cache';

const MAX_CACHE_BYTES = 16 * 1024 * 1024;

function catalog(cves: string[] = ['CVE-2021-44228']): CisaKevCatalog {
  return {
    title: 'CISA Known Exploited Vulnerabilities Catalog',
    catalogVersion: '2026.07.13',
    dateReleased: '2026-07-13T10:00:00.000Z',
    count: cves.length,
    vulnerabilities: cves.map(cveID => ({
      cveID,
      vendorProject: 'Example',
      product: 'Package',
      vulnerabilityName: 'Example vulnerability',
      dateAdded: '2026-07-13',
      shortDescription: 'Fixture only',
      requiredAction: 'Update',
      dueDate: '2026-08-01',
      knownRansomwareCampaignUse: 'Unknown',
      notes: '',
      cwes: ['CWE-79'],
    })),
  };
}

function inventory(repository: string, digest = 'inventory-digest'): PackageInventory {
  return { repository, digest, coordinates: [], manifests: [], errors: [] };
}

function coordinate(): DependencyCoordinate {
  return {
    ecosystem: 'npm', osvEcosystem: 'npm', name: 'lodash', exactVersion: '4.17.20',
    scope: 'runtime', direct: true, manifestPath: 'package.json', lockfilePath: 'package-lock.json', dependencyPaths: ['lodash'],
  };
}

describe('CISA KEV enrichment', () => {
  let cache: string;

  beforeEach(() => {
    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-kev-'));
  });

  afterEach(() => {
    fs.rmSync(cache, { recursive: true, force: true });
  });

  it('requires a credential-free HTTPS endpoint and validates the catalog fixture', async () => {
    expect(() => new CisaKevClient({ endpoint: 'http://127.0.0.1/catalog.json' })).toThrow(CisaKevError);
    expect(() => new CisaKevClient({ endpoint: 'https://user@example.test/catalog.json' })).toThrow(CisaKevError);
    expect(() => new CisaKevClient({ endpoint: 'https://example.test/catalog.json?x=1' })).toThrow(CisaKevError);

    const fetchImpl = jest.fn(async () => new Response(JSON.stringify(catalog()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
    const client = new CisaKevClient({ endpoint: 'https://example.test/catalog.json', fetchImpl });
    await expect(client.fetchCatalog()).resolves.toMatchObject({ count: 1, catalogVersion: '2026.07.13' });
    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/catalog.json', expect.objectContaining({
      method: 'GET', redirect: 'error',
    }));
  });

  it('rejects declared and streamed responses over the configured size limit', async () => {
    const declared = new CisaKevClient({
      endpoint: 'https://example.test/catalog.json',
      maxResponseBytes: 10,
      fetchImpl: jest.fn(async () => new Response('{}', { status: 200, headers: { 'content-length': '11' } })) as typeof fetch,
    });
    await expect(declared.fetchCatalog()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });

    const streamed = new CisaKevClient({
      endpoint: 'https://example.test/catalog.json',
      maxResponseBytes: 10,
      fetchImpl: jest.fn(async () => new Response('01234567890', { status: 200 })) as typeof fetch,
    });
    await expect(streamed.fetchCatalog()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });

  it('enforces the request timeout', async () => {
    const fetchImpl = jest.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })) as typeof fetch;
    const client = new CisaKevClient({ endpoint: 'https://example.test/catalog.json', timeoutMs: 1, fetchImpl });
    await expect(client.fetchCatalog()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('writes an atomic private cache and quarantines invalid data', () => {
    const store = new CisaKevCatalogStore(cache);
    const entry = store.save(catalog(), 'https://example.test/catalog.json');
    expect(entry.catalog.vulnerabilities[0].cveID).toBe('CVE-2021-44228');
    expect(store.status(1)).toMatchObject({ exists: true, fresh: true });
    expect(fs.readdirSync(cache)).toEqual(['catalog.json']);
    if (process.platform !== 'win32') {
      expect(fs.statSync(cache).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(cache, 'catalog.json')).mode & 0o777).toBe(0o600);
    }

    store.save(catalog(['CVE-2024-1234']), 'https://example.test/catalog.json');
    expect(store.status(1).entry?.catalog.vulnerabilities[0].cveID).toBe('CVE-2024-1234');
    expect(fs.readdirSync(cache).filter(file => file.includes('.tmp'))).toEqual([]);

    fs.writeFileSync(path.join(cache, 'catalog.json'), '{not-json', 'utf8');
    expect(store.status(1)).toEqual({ exists: false, fresh: false });
    expect(fs.readdirSync(path.join(cache, 'quarantine')).some(file => file.startsWith('catalog.json.corrupt-')))
      .toBe(true);
  });

  it('bounds oversized CISA cache reads and quarantine retention', () => {
    const store = new CisaKevCatalogStore(cache);
    const file = path.join(cache, 'catalog.json');
    store.save(catalog(), 'https://example.test/catalog.json');
    fs.truncateSync(file, MAX_CACHE_BYTES + 1);

    expect(store.status()).toEqual({ exists: false, fresh: false });
    const quarantine = path.join(cache, 'quarantine');
    expect(fs.readdirSync(quarantine)).toHaveLength(1);

    for (let index = 0; index < 24; index++) {
      fs.writeFileSync(file, `{invalid-${index}`, 'utf8');
      expect(store.status()).toEqual({ exists: false, fresh: false });
    }
    expect(fs.readdirSync(quarantine)).toHaveLength(20);
    if (process.platform !== 'win32') {
      expect(fs.statSync(quarantine).mode & 0o777).toBe(0o700);
      for (const name of fs.readdirSync(quarantine)) {
        expect(fs.statSync(path.join(quarantine, name)).mode & 0o777).toBe(0o600);
      }
    }
  });

  it('writes bounded atomic private vulnerability snapshots', () => {
    const repository = path.join(cache, 'repository');
    const snapshots = path.join(cache, 'snapshots');
    fs.mkdirSync(repository);
    const store = new VulnerabilitySnapshotStore(snapshots);
    const firstInventory = inventory(repository, 'first');

    store.save(firstInventory, [], 'https://api.osv.dev');
    const repositoryDirectory = path.join(snapshots, fs.readdirSync(snapshots)[0]);
    const file = path.join(repositoryDirectory, 'snapshot.json');
    expect(store.status(firstInventory)).toMatchObject({ exists: true, inventoryMatches: true });

    const secondInventory = inventory(repository, 'second');
    store.save(secondInventory, [], 'https://api.osv.dev');
    expect(store.status(secondInventory)).toMatchObject({ exists: true, inventoryMatches: true });
    expect(fs.readdirSync(repositoryDirectory).filter(name => name.includes('.tmp'))).toEqual([]);
    if (process.platform !== 'win32') {
      expect(fs.statSync(repositoryDirectory).mode & 0o777).toBe(0o700);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }

    fs.truncateSync(file, MAX_CACHE_BYTES + 1);
    expect(store.status(secondInventory)).toEqual({ exists: false, fresh: false, inventoryMatches: false });
    const quarantine = path.join(repositoryDirectory, 'quarantine');
    expect(fs.readdirSync(quarantine)).toHaveLength(1);

    for (let index = 0; index < 24; index++) {
      fs.writeFileSync(file, `{invalid-${index}`, 'utf8');
      expect(store.status(secondInventory)).toEqual({ exists: false, fresh: false, inventoryMatches: false });
    }
    expect(fs.readdirSync(quarantine)).toHaveLength(20);
  });

  it('saves an exact sanitized vulnerability snapshot schema', () => {
    const repository = path.join(cache, 'repository');
    const snapshots = path.join(cache, 'snapshots');
    fs.mkdirSync(repository);
    const store = new VulnerabilitySnapshotStore(snapshots);
    const dependency = coordinate();
    const firstInventory = { ...inventory(repository), coordinates: [dependency] };
    const match: OsvMatch = {
      coordinate: dependency,
      vulnerability: {
        schema_version: '1.6.0',
        id: 'OSV-2026-1234',
        modified: '2026-01-02T00:00:00Z',
        published: '2026-01-01T00:00:00Z',
        aliases: ['CVE-2026-1234'],
        summary: 'Unsafe merge',
        affected: [{
          package: { ecosystem: 'npm', name: 'lodash', purl: 'pkg:npm/lodash@4.17.20' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0', fixed: '4.17.21' }] }],
          database_specific: { cwe_ids: ['CWE-1321'], ignored: 'must not persist' },
          ecosystem_specific: { severity: 'high', ignored: { nested: true } },
        }],
        database_specific: { severity: 'HIGH', cwes: ['CWE-1321'], ignored: ['must not persist'] },
        references: [{ type: 'ADVISORY', url: 'https://example.test/advisory', ignored: 'must not persist' } as never],
        ignoredTopLevel: { secret: 'must not persist' },
      } as never,
    };

    store.save(firstInventory, [match], 'https://api.osv.dev');
    const repositoryDirectory = path.join(snapshots, fs.readdirSync(snapshots)[0]);
    const saved = JSON.parse(fs.readFileSync(path.join(repositoryDirectory, 'snapshot.json'), 'utf8'));
    const savedVulnerability = saved.matches[0].vulnerability;

    expect(savedVulnerability).toEqual(expect.objectContaining({
      schema_version: '1.6.0', id: 'OSV-2026-1234', aliases: ['CVE-2026-1234'],
      summary: 'Unsafe merge',
      database_specific: { severity: 'HIGH', cwes: ['CWE-1321'] },
    }));
    expect(savedVulnerability).not.toHaveProperty('ignoredTopLevel');
    expect(savedVulnerability.affected[0]).toEqual(expect.objectContaining({
      package: { ecosystem: 'npm', name: 'lodash', purl: 'pkg:npm/lodash@4.17.20' },
      database_specific: { cwe_ids: ['CWE-1321'] },
      ecosystem_specific: { severity: 'high' },
    }));
    expect(savedVulnerability.affected[0].database_specific).not.toHaveProperty('ignored');
    expect(savedVulnerability.references[0]).toEqual({ type: 'ADVISORY', url: 'https://example.test/advisory' });
    expect(store.status(firstInventory).snapshot?.matches[0].vulnerability)
      .toEqual(savedVulnerability);
  });

  it('quarantines snapshots with malformed nested vulnerability data', () => {
    const repository = path.join(cache, 'repository');
    const snapshots = path.join(cache, 'snapshots');
    fs.mkdirSync(repository);
    const store = new VulnerabilitySnapshotStore(snapshots);
    const dependency = coordinate();
    const firstInventory = { ...inventory(repository), coordinates: [dependency] };
    store.save(firstInventory, [{
      coordinate: dependency,
      vulnerability: { id: 'OSV-2026-1234', modified: '2026-01-02T00:00:00Z' },
    }], 'https://api.osv.dev');
    const repositoryDirectory = path.join(snapshots, fs.readdirSync(snapshots)[0]);
    const file = path.join(repositoryDirectory, 'snapshot.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.matches[0].vulnerability.affected = [{
      ranges: [{ events: [{ fixed: 4.17 }] }],
    }];
    fs.writeFileSync(file, JSON.stringify(saved), 'utf8');

    expect(store.status(firstInventory)).toEqual({ exists: false, fresh: false, inventoryMatches: false });
    expect(fs.readdirSync(path.join(repositoryDirectory, 'quarantine')))
      .toEqual(expect.arrayContaining([expect.stringMatching(/^snapshot\.json\.corrupt-/)]));
  });

  it('rejects invalid snapshot endpoints and timestamps before exposing persisted data', () => {
    const repository = path.join(cache, 'repository');
    const snapshots = path.join(cache, 'snapshots');
    fs.mkdirSync(repository);
    const store = new VulnerabilitySnapshotStore(snapshots);
    const dependency = coordinate();
    const firstInventory = { ...inventory(repository), coordinates: [dependency] };
    const matches: OsvMatch[] = [{
      coordinate: dependency,
      vulnerability: { id: 'OSV-2026-1234', modified: '2026-01-02T00:00:00Z' },
    }];

    expect(() => store.save(firstInventory, matches, 'file:///tmp/advisories.json'))
      .toThrow(/HTTP\(S\).*URL/i);
    expect(() => store.save(firstInventory, [{
      coordinate: dependency,
      vulnerability: { id: 'OSV-2026-1234', modified: 'not-a-date' },
    }], 'https://api.osv.dev')).toThrow(/RFC3339 timestamp/i);

    store.save(firstInventory, matches, 'https://api.osv.dev');
    const repositoryDirectory = path.join(snapshots, fs.readdirSync(snapshots)[0]);
    const file = path.join(repositoryDirectory, 'snapshot.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.createdAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fs.writeFileSync(file, JSON.stringify(saved), 'utf8');

    expect(store.status(firstInventory)).toEqual({ exists: false, fresh: false, inventoryMatches: false });
    expect(fs.readdirSync(path.join(repositoryDirectory, 'quarantine')))
      .toEqual(expect.arrayContaining([expect.stringMatching(/^snapshot\.json\.corrupt-/)]));
  });
});
