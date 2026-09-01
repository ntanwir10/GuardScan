import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DependencyScanner,
  DependencyScanError,
} from '../../src/core/dependency-scanner';
import { OsvClient, OsvMatch } from '../../src/core/osv-client';
import { VulnerabilitySnapshotStore } from '../../src/core/vulnerability-cache';
import { CisaKevCatalogStore, CisaKevClient } from '../../src/core/cisa-kev';
import { collectPackageInventory, filterPackageInventory } from '../../src/core/package-inventory';
import {
  ScanEngine,
  ScanEngineOptions,
  ScannerTask,
  ScannerTaskOutput,
} from '../../src/core/scan-engine';

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

  it.each([
    'https://api.osv.dev',
    'http://localhost:8000',
    'http://127.0.0.0:8000',
    'http://127.0.0.2:8000',
    'http://127.255.255.255:8000',
    'http://[::1]:8000',
  ])('accepts the configured OSV endpoint policy for %s', endpoint => {
    expect(new OsvClient({ endpoint, retries: 0 }).endpoint).toBe(endpoint);
  });

  it.each([
    'http://example.test',
    'http://128.0.0.1:8000',
    'http://127.256.0.1:8000',
    'ftp://127.0.0.1:8000',
  ])('rejects an OSV endpoint outside the configured policy: %s', endpoint => {
    expect(() => new OsvClient({ endpoint, retries: 0 })).toThrow(/OSV endpoint/);
  });

  it('continues inventory collection when a directory cannot be read', () => {
    const blocked = path.join(repository, 'blocked');
    fs.mkdirSync(blocked);
    const canonicalBlocked = fs.realpathSync(blocked);
    const nativeFs = require('fs') as typeof fs;
    const originalReaddirSync = nativeFs.readdirSync;
    const readdirSpy = jest.spyOn(nativeFs, 'readdirSync').mockImplementation((function (
      directory: fs.PathLike,
      options?: unknown
    ) {
      if (path.resolve(String(directory)) === canonicalBlocked) {
        const error = new Error('permission denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      }
      return Reflect.apply(originalReaddirSync, nativeFs, [directory, options]);
    }) as typeof fs.readdirSync);

    try {
      const inventory = collectPackageInventory(repository);
      expect(inventory.coordinates).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'lodash', exactVersion: '4.17.20' }),
      ]));
      expect(inventory.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ file: 'blocked', code: 'INVALID_MANIFEST' }),
      ]));
    } finally {
      readdirSpy.mockRestore();
    }
  });

  it('records manifest read failures and continues collecting other ecosystems', () => {
    const unreadable = new Set(['requirements.txt', 'go.mod', 'Gemfile.lock']);
    for (const name of unreadable) {
      fs.writeFileSync(path.join(repository, name), 'fixture');
    }
    const nativeFs = require('fs') as typeof fs;
    const originalReadFileSync = nativeFs.readFileSync;
    const readSpy = jest.spyOn(nativeFs, 'readFileSync').mockImplementation((function (
      file: fs.PathOrFileDescriptor,
      options?: unknown
    ) {
      if (typeof file !== 'number' && unreadable.has(path.basename(String(file)))) {
        const error = new Error('permission denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      }
      return Reflect.apply(originalReadFileSync, nativeFs, [file, options]);
    }) as typeof fs.readFileSync);

    try {
      const inventory = collectPackageInventory(repository);
      expect(inventory.coordinates).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'lodash', exactVersion: '4.17.20' }),
      ]));
      expect(inventory.errors).toEqual(expect.arrayContaining(
        [...unreadable].map(file => expect.objectContaining({ file, code: 'INVALID_MANIFEST' }))
      ));
    } finally {
      readSpy.mockRestore();
    }
  });

  it('parses commented Go requirements and reports unresolved entries', () => {
    fs.writeFileSync(path.join(repository, 'go.mod'), [
      'module example.test/fixture',
      '',
      'go 1.24',
      '',
      'require (',
      '  example.test/direct v1.2.3 // required by the fixture',
      '  example.test/indirect v2.0.0 // indirect',
      '  example.test/unresolved latest // invalid version fixture',
      ')',
      'require example.test/standalone v3.4.5 // tool dependency',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'example.test/direct', exactVersion: 'v1.2.3', direct: true }),
      expect.objectContaining({ name: 'example.test/indirect', exactVersion: 'v2.0.0', direct: false }),
      expect.objectContaining({ name: 'example.test/standalone', exactVersion: 'v3.4.5', direct: true }),
    ]));
    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'go.mod',
        code: 'UNRESOLVED_VERSION',
        message: expect.stringContaining('example.test/unresolved latest'),
      }),
    ]));
  });

  it('parses pinned Python requirements with multiple extras', () => {
    fs.writeFileSync(
      path.join(repository, 'requirements.txt'),
      'Requests [ security, tests ] == 2.32.4\n'
    );

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ecosystem: 'pip',
        name: 'requests',
        exactVersion: '2.32.4',
        direct: true,
      }),
    ]));
    expect(inventory.errors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'requirements.txt' }),
    ]));
  });

  it.each([
    'requests==1.0.*',
    'requests==1.0.0,<2.0',
  ])('rejects non-exact Python requirement %s', requirement => {
    fs.writeFileSync(path.join(repository, 'requirements.txt'), `${requirement}\n`);

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ ecosystem: 'pip', name: 'requests' }),
    ]));
    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'requirements.txt',
        code: 'UNRESOLVED_VERSION',
      }),
    ]));
  });

  it('marks only package.json dependencies direct in npm v1 lockfiles', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: { direct: '1.0.0' },
    }));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        direct: { version: '1.0.0' },
        hoisted: { version: '2.0.0' },
      },
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({ ecosystem: 'npm', name: 'direct', direct: true }),
      expect.objectContaining({ ecosystem: 'npm', name: 'hoisted', direct: false }),
    ]));
  });

  it('derives pnpm directness and scope from lockfile importers', () => {
    fs.rmSync(path.join(repository, 'package-lock.json'));
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: { direct: '^1.0.0' },
      devDependencies: { tooling: '^2.0.0' },
    }));
    fs.writeFileSync(path.join(repository, 'pnpm-lock.yaml'), [
      "lockfileVersion: '9.0'",
      'importers:',
      '  .:',
      '    dependencies:',
      '      direct:',
      "        specifier: ^1.0.0",
      "        version: 1.2.3",
      '    devDependencies:',
      '      tooling:',
      "        specifier: ^2.0.0",
      "        version: 2.1.0",
      'packages:',
      "  direct@1.2.3: {}",
      "  tooling@2.1.0: {}",
      "  transitive@3.0.0: {}",
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'direct', exactVersion: '1.2.3', direct: true, scope: 'runtime' }),
      expect.objectContaining({ name: 'tooling', exactVersion: '2.1.0', direct: true, scope: 'development' }),
      expect.objectContaining({ name: 'transitive', exactVersion: '3.0.0', direct: false }),
    ]));
  });

  it('derives Yarn directness and scope from the adjacent manifest', () => {
    fs.rmSync(path.join(repository, 'package-lock.json'));
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: { direct: '^1.0.0' },
      devDependencies: { tooling: '^2.0.0' },
    }));
    fs.writeFileSync(path.join(repository, 'yarn.lock'), [
      '"direct@~1.2.0", "direct@^1.0.0":',
      '  version "1.2.3"',
      'direct@^4.0.0:',
      '  version "4.1.0"',
      'tooling@^2.0.0:',
      '  version "2.1.0"',
      'transitive@^3.0.0:',
      '  version "3.0.0"',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'direct', exactVersion: '1.2.3', direct: true, scope: 'runtime' }),
      expect.objectContaining({ name: 'direct', exactVersion: '4.1.0', direct: false, scope: 'unknown' }),
      expect.objectContaining({ name: 'tooling', exactVersion: '2.1.0', direct: true, scope: 'development' }),
      expect.objectContaining({ name: 'transitive', exactVersion: '3.0.0', direct: false, scope: 'unknown' }),
    ]));
  });

  it('applies remote Go module replacements and rejects local replacements', () => {
    fs.writeFileSync(path.join(repository, 'go.mod'), [
      'module example.test/fixture',
      'require (',
      '  example.test/original v1.2.3',
      '  example.test/local v2.0.0',
      ')',
      'replace (',
      '  example.test/original => example.test/fork v1.4.0',
      '  example.test/local => ./local-module',
      ')',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ecosystem: 'go',
        name: 'example.test/fork',
        exactVersion: 'v1.4.0',
      }),
    ]));
    const goNames = inventory.coordinates
      .filter(coordinate => coordinate.ecosystem === 'go')
      .map(coordinate => coordinate.name);
    expect(goNames).not.toContain('example.test/original');
    expect(goNames).not.toContain('example.test/local');
    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'go.mod',
        code: 'UNSUPPORTED_FORMAT',
        message: expect.stringContaining('example.test/local'),
      }),
    ]));
  });

  it('prefers version-specific Go replacements over wildcard replacements', () => {
    fs.writeFileSync(path.join(repository, 'go.mod'), [
      'module example.test/fixture',
      'require example.test/original v1.2.3',
      'replace example.test/original v1.2.3 => example.test/specific v1.2.4',
      'replace example.test/original => example.test/wildcard v1.9.0',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ecosystem: 'go',
        name: 'example.test/specific',
        exactVersion: 'v1.2.4',
      }),
    ]));
    expect(inventory.coordinates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'example.test/wildcard' }),
    ]));
  });

  it('emits crates.io coordinates only for crates.io Cargo packages', () => {
    fs.writeFileSync(path.join(repository, 'Cargo.lock'), [
      'version = 3',
      '',
      '[[package]]',
      'name = "fixture-root"',
      'version = "0.1.0"',
      '',
      '[[package]]',
      'name = "serde"',
      'version = "1.0.219"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
      '',
      '[[package]]',
      'name = "git-only"',
      'version = "1.2.3"',
      'source = "git+https://example.test/git-only#abcdef"',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({ ecosystem: 'cargo', name: 'serde', exactVersion: '1.0.219' }),
    ]));
    const cargoNames = inventory.coordinates
      .filter(coordinate => coordinate.ecosystem === 'cargo')
      .map(coordinate => coordinate.name);
    expect(cargoNames).not.toContain('fixture-root');
    expect(cargoNames).not.toContain('git-only');
    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'Cargo.lock',
        code: 'UNSUPPORTED_FORMAT',
        message: expect.stringContaining('git-only'),
      }),
    ]));
  });

  it('keeps pattern findings when another scan file has disappeared', async () => {
    const readable = path.join(repository, 'readable.ts');
    fs.writeFileSync(readable, 'eval("fixture");');
    const missing = path.join(repository, 'missing.ts');
    type BuiltInTaskFactory = {
      createBuiltInTasks(
        options: ScanEngineOptions,
        repoPath: string,
        files: Array<{path: string}>,
        offline: boolean
      ): ScannerTask[];
    };
    const tasks = (new ScanEngine() as unknown as BuiltInTaskFactory).createBuiltInTasks(
      { includeVulnerabilities: false, includeGitHistory: false },
      repository,
      [{ path: missing }, { path: readable }],
      true
    );
    const patterns = tasks.find(task => task.scanner === 'patterns');

    const output = await patterns!.run() as ScannerTaskOutput;

    expect(output.error).toMatchObject({ code: 'PATTERN_SCAN_PARTIAL' });
    expect(output.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'Code Injection', file: readable }),
    ]));
  });

  it.each([
    ['missing', {}, 250],
    ['zero', { 'retry-after': '0' }, 250],
    ['negative', { 'retry-after': '-1' }, 250],
    ['invalid', { 'retry-after': 'later' }, 250],
    ['positive and capped', { 'retry-after': '10' }, 5_000],
  ] as Array<[string, Record<string, string>, number]>)('uses exponential fallback or a capped positive Retry-After (%s)', async (_label, headers, delayMs) => {
    jest.useFakeTimers();
    try {
      let calls = 0;
      const fetchImpl = jest.fn(async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({}, 503, headers)
          : jsonResponse({ results: [{ vulns: [] }] });
      }) as typeof fetch;
      const client = new OsvClient({ fetchImpl, retries: 1 });
      const promise = client.query([collectPackageInventory(repository).coordinates[0]]);

      await Promise.resolve();
      await Promise.resolve();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(delayMs - 1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await expect(promise).resolves.toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
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
    await expect(scanner.scan(repository, {
      offline: true, snapshotStore: store, kevStore, kevMaxCacheAgeDays: 1,
    })).rejects.toMatchObject({ code: 'KEV_COVERAGE_UNAVAILABLE' });
    const staleKev = await scanner.scan(repository, {
      offline: true, snapshotStore: store, kevStore, kevMaxCacheAgeDays: 1, allowPartial: true,
    });
    expect(staleKev[0].status).toBe('partial');
    expect(staleKev[0].knownExploitedEnrichment.status).toBe('stale-cache');
    expect(staleKev[0].vulnerabilities[0].knownExploited).toBe('unknown');
    expect(staleKev[0].errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'KEV_COVERAGE_UNAVAILABLE' }),
    ]));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('reuses fresh matching OSV snapshots unless refresh is requested', async () => {
    const scanner = new DependencyScanner();
    const store = new VulnerabilitySnapshotStore(cache);
    const fetchImpl = jest.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/querybatch')) {
        return jsonResponse({ results: [{ vulns: [{ id: 'CVE-2026-1234', modified: '2026-01-02T00:00:00Z' }] }] });
      }
      return jsonResponse(advisory('CVE-2026-1234', []));
    }) as typeof fetch;
    const client = new OsvClient({ endpoint: 'https://api.osv.dev', fetchImpl, retries: 0 });

    await scanner.scan(repository, { client, snapshotStore: store, enrichKnownExploited: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const cached = await scanner.scan(repository, { client, snapshotStore: store, enrichKnownExploited: false });
    expect(cached[0].dataFreshness).toBe('fresh-cache');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const refreshed = await scanner.scan(repository, {
      client, snapshotStore: store, refresh: true, enrichKnownExploited: false,
    });
    expect(refreshed[0].dataFreshness).toBe('live');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
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
    expect(partial[0]).toMatchObject({ status: 'partial', dataFreshness: 'unavailable' });
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

  it('does not reuse offline coverage created by a different OSV endpoint', async () => {
    const scanner = new DependencyScanner();
    const store = new VulnerabilitySnapshotStore(cache);
    const sourceFetch = jest.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/querybatch')) {
        return jsonResponse({ results: [{ vulns: [{ id: 'CVE-2026-1234', modified: '2026-01-02T00:00:00Z' }] }] });
      }
      return jsonResponse(advisory('CVE-2026-1234', []));
    }) as typeof fetch;
    await scanner.scan(repository, {
      client: new OsvClient({
        endpoint: 'https://source.example.test',
        fetchImpl: sourceFetch,
        retries: 0,
      }),
      snapshotStore: store,
      enrichKnownExploited: false,
    });

    await expect(scanner.scan(repository, {
      offline: true,
      client: new OsvClient({
        endpoint: 'https://mirror.example.test',
        fetchImpl: sourceFetch,
        retries: 0,
      }),
      snapshotStore: store,
      enrichKnownExploited: false,
    })).rejects.toMatchObject({ code: 'OFFLINE_COVERAGE_MISMATCH' });

    const partial = await scanner.scan(repository, {
      offline: true,
      endpoint: 'https://mirror.example.test/',
      snapshotStore: store,
      allowPartial: true,
      enrichKnownExploited: false,
    });
    expect(partial[0]).toMatchObject({
      status: 'partial',
      dataFreshness: 'unavailable',
      totalVulnerabilities: 0,
      errors: [expect.objectContaining({ code: 'OFFLINE_COVERAGE_MISMATCH' })],
    });
  });

  it('rejects a malformed expected endpoint without quarantining a valid snapshot', () => {
    const inventory = collectPackageInventory(repository);
    const store = new VulnerabilitySnapshotStore(cache);
    store.save(inventory, [], 'https://api.osv.dev/v1/');
    const snapshotDirectory = path.join(cache, fs.readdirSync(cache)[0]);
    const snapshotFile = path.join(snapshotDirectory, 'snapshot.json');

    expect(() => store.status(inventory, 7, 'not a URL')).toThrow(/expectedSourceEndpoint/);
    expect(fs.existsSync(snapshotFile)).toBe(true);
    expect(fs.existsSync(path.join(snapshotDirectory, 'quarantine'))).toBe(false);
  });

  it('preserves lockfile identity when restoring duplicate coordinates from a snapshot', () => {
    const nestedRepository = path.join(repository, 'packages', 'fixture');
    fs.mkdirSync(nestedRepository, { recursive: true });
    writeNpmLock(nestedRepository);
    const inventory = collectPackageInventory(repository);
    const coordinates = inventory.coordinates.filter(coordinate => coordinate.name === 'lodash');
    expect(coordinates).toHaveLength(2);
    const matches = coordinates.map((coordinate): OsvMatch => ({
      coordinate,
      vulnerability: advisory('CVE-2026-1234', []),
    }));
    const store = new VulnerabilitySnapshotStore(cache);
    const snapshot = store.save(inventory, matches, 'https://api.osv.dev');

    expect(store.matches(inventory, snapshot).map(match => match.coordinate.lockfilePath).sort())
      .toEqual(['package-lock.json', 'packages/fixture/package-lock.json']);
  });

  it('preserves a snapshot that cannot be read temporarily and reports it as unavailable', () => {
    const inventory = collectPackageInventory(repository);
    const store = new VulnerabilitySnapshotStore(cache);
    store.save(inventory, [], 'https://api.osv.dev');
    const snapshotDirectory = path.join(cache, fs.readdirSync(cache)[0]);
    const snapshotFile = path.join(snapshotDirectory, 'snapshot.json');
    const nativeFs = require('fs') as typeof fs;
    const originalOpenSync = nativeFs.openSync;
    const openSpy = jest.spyOn(nativeFs, 'openSync').mockImplementation((function (
      file: fs.PathLike,
      flags: string | number,
      mode?: fs.Mode
    ) {
      if (path.resolve(String(file)) === snapshotFile) {
        const error = new Error('snapshot temporarily unavailable') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      }
      return Reflect.apply(originalOpenSync, nativeFs, [file, flags, mode]);
    }) as typeof fs.openSync);

    try {
      expect(store.status(inventory)).toEqual({
        exists: false,
        fresh: false,
        inventoryMatches: false,
      });
    } finally {
      openSpy.mockRestore();
    }
    expect(fs.existsSync(snapshotFile)).toBe(true);
    expect(fs.existsSync(path.join(snapshotDirectory, 'quarantine'))).toBe(false);
  });

  it('still quarantines snapshot content that cannot be parsed', () => {
    const inventory = collectPackageInventory(repository);
    const store = new VulnerabilitySnapshotStore(cache);
    store.save(inventory, [], 'https://api.osv.dev');
    const snapshotDirectory = path.join(cache, fs.readdirSync(cache)[0]);
    const snapshotFile = path.join(snapshotDirectory, 'snapshot.json');
    fs.writeFileSync(snapshotFile, '{invalid json', 'utf8');

    expect(store.status(inventory)).toEqual({
      exists: false,
      fresh: false,
      inventoryMatches: false,
    });
    expect(fs.existsSync(snapshotFile)).toBe(false);
    expect(fs.readdirSync(path.join(snapshotDirectory, 'quarantine'))).toHaveLength(1);
  });

  it('keeps live OSV findings when snapshot persistence fails', async () => {
    const store = new VulnerabilitySnapshotStore(cache);
    jest.spyOn(store, 'save').mockImplementation(() => {
      throw new Error('snapshot write fixture failed');
    });
    const fetchImpl = jest.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/v1/querybatch')
        ? jsonResponse({ results: [{ vulns: [{ id: 'CVE-2026-1234', modified: '2026-01-02T00:00:00Z' }] }] })
        : jsonResponse(advisory('CVE-2026-1234', []))) as typeof fetch;

    const results = await new DependencyScanner().scan(repository, {
      client: new OsvClient({ fetchImpl, retries: 0 }),
      snapshotStore: store,
      enrichKnownExploited: false,
    });

    expect(results[0]).toMatchObject({
      status: 'partial',
      dataFreshness: 'live',
      totalVulnerabilities: 1,
      errors: [expect.objectContaining({
        code: 'SNAPSHOT_PERSIST_FAILED',
        message: expect.stringContaining('snapshot write fixture failed'),
      })],
    });
  });

  it('reuses matching stale coverage after an allowed live OSV query failure', async () => {
    const store = new VulnerabilitySnapshotStore(cache);
    const liveFetch = jest.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/v1/querybatch')
        ? jsonResponse({ results: [{ vulns: [{ id: 'CVE-2026-1234', modified: '2026-01-02T00:00:00Z' }] }] })
        : jsonResponse(advisory('CVE-2026-1234', []))) as typeof fetch;
    await new DependencyScanner().scan(repository, {
      client: new OsvClient({ fetchImpl: liveFetch, retries: 0 }),
      snapshotStore: store,
      enrichKnownExploited: false,
    });
    const snapshotDirectory = path.join(cache, fs.readdirSync(cache)[0]);
    const snapshotFile = path.join(snapshotDirectory, 'snapshot.json');
    const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    snapshot.createdAt = '2000-01-01T00:00:00.000Z';
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot), 'utf8');
    const unavailable = new OsvClient({
      fetchImpl: jest.fn(async () => { throw new Error('OSV fixture unavailable'); }) as typeof fetch,
      retries: 0,
    });

    const results = await new DependencyScanner().scan(repository, {
      client: unavailable,
      snapshotStore: store,
      allowPartial: true,
      maxSnapshotAgeDays: 1,
      enrichKnownExploited: false,
    });

    expect(results[0]).toMatchObject({
      status: 'partial',
      dataFreshness: 'stale-cache',
      totalVulnerabilities: 1,
      errors: [expect.objectContaining({
        code: 'NETWORK_ERROR',
        message: expect.stringContaining('OSV fixture unavailable'),
      })],
    });
  });

  it('normalizes only endpoint path slashes and preserves query and fragment data', () => {
    const inventory = collectPackageInventory(repository);
    const snapshot = new VulnerabilitySnapshotStore(cache).save(
      inventory,
      [],
      'https://example.test/v1///?token=//#fragment///'
    );

    expect(snapshot.sourceEndpoint).toBe('https://example.test/v1?token=//#fragment///');
  });

  it('rejects oversized vulnerability snapshots without replacing usable coverage', () => {
    const inventory = collectPackageInventory(repository);
    const store = new VulnerabilitySnapshotStore(cache);
    store.save(inventory, [], 'https://api.osv.dev');
    const match: OsvMatch = {
      coordinate: inventory.coordinates[0],
      vulnerability: {
        ...advisory('GHSA-oversized', []),
        summary: 'x'.repeat(17 * 1024 * 1024),
      },
    };

    expect(() => store.save(inventory, [match], 'https://api.osv.dev')).toThrow(
      /snapshot.*size|size.*snapshot/i
    );
    expect(store.status(inventory).snapshot?.matches).toEqual([]);
  });

  it('filters inventory errors with an ecosystem selection', () => {
    fs.writeFileSync(path.join(repository, 'requirements.txt'), 'requests>=2\n');
    const inventory = collectPackageInventory(repository);

    const npmOnly = filterPackageInventory(inventory, { ecosystems: ['npm'] });

    expect(npmOnly.coordinates.every(coordinate => coordinate.ecosystem === 'npm')).toBe(true);
    expect(npmOnly.errors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'requirements.txt' }),
    ]));
  });

  it('rejects refresh in offline mode and can enforce unresolved inventory errors', async () => {
    const scanner = new DependencyScanner();
    await expect(scanner.scan(repository, { offline: true, refresh: true, enrichKnownExploited: false })).rejects.toBeInstanceOf(DependencyScanError);

    fs.rmSync(path.join(repository, 'package-lock.json'));
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.17.0' } }));
    await expect(scanner.scan(repository, { strictInventory: true, enrichKnownExploited: false })).rejects.toMatchObject({ code: 'INVENTORY_INCOMPLETE' });
  });

  it('returns explicit partial inventory coverage when every package is unresolved', async () => {
    fs.rmSync(path.join(repository, 'package-lock.json'));
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.17.0' } }));

    const results = await new DependencyScanner().scan(repository, {
      strictInventory: true,
      allowPartial: true,
      enrichKnownExploited: false,
    });

    expect(results).toEqual([
      expect.objectContaining({
        ecosystem: 'inventory',
        status: 'partial',
        queriedPackages: 0,
        unresolvedPackages: 1,
        dataFreshness: 'unavailable',
        knownExploitedEnrichment: expect.objectContaining({ status: 'disabled' }),
        errors: [expect.objectContaining({
          code: 'UNRESOLVED_VERSION',
          file: 'package.json',
          message: expect.stringContaining('lodash'),
        })],
      }),
    ]);
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

  it('scores CVSS 4.0 vectors without downgrading critical policy severity', async () => {
    const vector = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H';
    const fetchImpl = jest.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/querybatch')) {
        return jsonResponse({ results: [{ vulns: [{ id: 'GHSA-cvss4', modified: '2026-01-01T00:00:00Z' }] }] });
      }
      return jsonResponse({
        id: 'GHSA-cvss4',
        modified: '2026-01-01T00:00:00Z',
        summary: 'CVSS 4 only',
        severity: [{ type: 'CVSS_V4', score: vector }],
      });
    }) as typeof fetch;

    const results = await new DependencyScanner().scan(repository, {
      client: new OsvClient({ fetchImpl, retries: 0 }),
      snapshotStore: new VulnerabilitySnapshotStore(cache),
      enrichKnownExploited: false,
    });

    expect(results[0].vulnerabilities[0]).toMatchObject({
      advisorySeverity: 'critical',
      policySeverity: 'critical',
      severity: 'critical',
      cvss: { version: '4.0', vector, score: 10, source: 'GHSA-cvss4' },
    });
  });

  it('continues past malformed and unsupported CVSS vectors to a later supported vector', async () => {
    const fetchImpl = jest.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/querybatch')) {
        return jsonResponse({ results: [{ vulns: [{ id: 'GHSA-mixed-cvss', modified: '2026-01-01T00:00:00Z' }] }] });
      }
      return jsonResponse({
        id: 'GHSA-mixed-cvss',
        modified: '2026-01-01T00:00:00Z',
        summary: 'Mixed CVSS records',
        severity: [
          { type: 'CVSS_V3', score: '   ' },
          { type: 'CVSS_V3', score: 'CVSS:3.1/not-a-valid-vector' },
          { type: 'CVSS_V4', score: 'CVSS:4.0/not-a-valid-vector' },
          { type: 'CVSS_V3', score: 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N' },
        ],
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
      cvss: {
        version: '3.0',
        vector: 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N',
        score: 6.5,
        source: 'GHSA-mixed-cvss',
      },
    });
  });

  it('does not fail when an npm coordinate has an invalid exact version', async () => {
    const inventory = collectPackageInventory(repository);
    inventory.coordinates[0].exactVersion = 'not-a-semver';
    const fetchImpl = jest.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/querybatch')) {
        return jsonResponse({ results: [{ vulns: [{ id: 'GHSA-invalid-version', modified: '2026-01-01T00:00:00Z' }] }] });
      }
      return jsonResponse(advisory('GHSA-invalid-version', []));
    }) as typeof fetch;

    const results = await new DependencyScanner().scan(repository, {
      inventory,
      client: new OsvClient({ fetchImpl, retries: 0 }),
      snapshotStore: new VulnerabilitySnapshotStore(cache),
      enrichKnownExploited: false,
    });

    expect(results[0].vulnerabilities[0]).toMatchObject({
      fixedVersions: ['4.17.21'],
      recommendation: expect.stringMatching(/not semver-comparable.*upstream advisory/i),
    });
  });

  it('selects the highest severity across aliased advisory records', async () => {
    const low = {
      ...advisory('GHSA-low-alias', ['CVE-2026-9999']),
      database_specific: { severity: 'LOW' },
    };
    const critical = {
      ...advisory('CVE-2026-9999', ['GHSA-low-alias']),
      database_specific: { severity: 'CRITICAL' },
    };
    const fetchImpl = jest.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/querybatch')) {
        return jsonResponse({ results: [{ vulns: [
          { id: low.id, modified: low.modified },
          { id: critical.id, modified: critical.modified },
        ] }] });
      }
      return jsonResponse(String(input).endsWith(low.id) ? low : critical);
    }) as typeof fetch;

    const results = await new DependencyScanner().scan(repository, {
      client: new OsvClient({ fetchImpl, retries: 0 }),
      snapshotStore: new VulnerabilitySnapshotStore(cache),
      enrichKnownExploited: false,
    });

    expect(results[0].vulnerabilities).toHaveLength(1);
    expect(results[0].vulnerabilities[0]).toMatchObject({
      advisorySeverity: 'critical',
      policySeverity: 'critical',
      severity: 'critical',
    });
  });

  it('does not invent an ordered upgrade target for non-npm OSV versions', async () => {
    fs.rmSync(path.join(repository, 'package.json'));
    fs.rmSync(path.join(repository, 'package-lock.json'));
    fs.writeFileSync(path.join(repository, 'requirements.txt'), 'demo==1.0.dev1\n');
    const record = {
      schema_version: '1.6.0',
      id: 'PYSEC-2026-1',
      modified: '2026-01-02T00:00:00Z',
      summary: 'Fixture advisory',
      affected: [{
        package: { ecosystem: 'PyPI', name: 'demo' },
        ranges: [{
          type: 'ECOSYSTEM',
          events: [
            { introduced: '0' },
            { fixed: '1.0.post1' },
            { introduced: '1.0.post2' },
            { fixed: '1.0rc2' },
          ],
        }],
      }],
    };
    const fetchImpl = jest.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/v1/querybatch')
        ? jsonResponse({ results: [{ vulns: [{ id: record.id, modified: record.modified }] }] })
        : jsonResponse(record)
    ) as typeof fetch;

    const results = await new DependencyScanner().scan(repository, {
      client: new OsvClient({ fetchImpl, retries: 0 }),
      snapshotStore: new VulnerabilitySnapshotStore(cache),
      enrichKnownExploited: false,
    });

    expect(results[0].vulnerabilities[0].fixedVersions).toEqual(
      expect.arrayContaining(['1.0.post1', '1.0rc2'])
    );
    expect(results[0].vulnerabilities[0].recommendation).toMatch(
      /review published fixed versions.*ecosystem tooling/i
    );
    expect(results[0].vulnerabilities[0].recommendation).not.toMatch(/or later/i);
  });

  it('keeps valid live advisories cacheable when another advisory is malformed', async () => {
    const malformed = {
      ...advisory('GHSA-malformed-advisory', []),
      severity: [{ type: 'CVSS_V3', score: 9 }],
    };
    const valid = advisory('GHSA-valid-advisory', []);
    const fetchImpl = jest.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/querybatch')) {
        return jsonResponse({ results: [{ vulns: [
          { id: malformed.id, modified: malformed.modified },
          { id: valid.id, modified: valid.modified },
        ] }] });
      }
      return jsonResponse(String(input).endsWith(malformed.id) ? malformed : valid);
    }) as typeof fetch;
    const client = new OsvClient({ fetchImpl, retries: 0 });
    const store = new VulnerabilitySnapshotStore(cache);
    const scanner = new DependencyScanner();

    const live = await scanner.scan(repository, {
      client,
      snapshotStore: store,
      enrichKnownExploited: false,
    });
    expect(live[0]).toMatchObject({ status: 'complete', dataFreshness: 'live', totalVulnerabilities: 2 });

    const inventory = collectPackageInventory(repository);
    expect(store.status(inventory, 7, client.endpoint).snapshot?.droppedMatches).toBe(1);

    await expect(scanner.scan(repository, {
      client,
      snapshotStore: store,
      offline: true,
      enrichKnownExploited: false,
    })).rejects.toMatchObject({ code: 'OFFLINE_COVERAGE_INCOMPLETE' });

    const offline = await scanner.scan(repository, {
      client,
      snapshotStore: store,
      offline: true,
      allowPartial: true,
      enrichKnownExploited: false,
    });
    expect(offline[0]).toMatchObject({
      status: 'partial',
      dataFreshness: 'fresh-cache',
      totalVulnerabilities: 1,
      errors: [expect.objectContaining({ code: 'OFFLINE_COVERAGE_INCOMPLETE' })],
    });
    expect(offline[0].vulnerabilities[0].canonicalId).toBe(valid.id);
  });

  it('loads legacy complete snapshots without a dropped-match counter', () => {
    const inventory = collectPackageInventory(repository);
    const store = new VulnerabilitySnapshotStore(cache);
    store.save(inventory, [], 'https://api.osv.dev');
    const snapshotDirectory = path.join(cache, fs.readdirSync(cache)[0]);
    const snapshotFile = path.join(snapshotDirectory, 'snapshot.json');
    const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    delete snapshot.droppedMatches;
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot), 'utf8');

    expect(store.status(inventory, 7, 'https://api.osv.dev')).toMatchObject({
      exists: true,
      snapshot: { droppedMatches: 0 },
    });
  });

  it('reports snapshot source mismatch against the configured OSV endpoint', () => {
    const inventory = collectPackageInventory(repository);
    const store = new VulnerabilitySnapshotStore(cache);
    store.save(inventory, [], 'https://one.example.test');

    const { status } = new DependencyScanner().snapshotStatus(
      repository,
      7,
      store,
      'https://two.example.test'
    );

    expect(status.sourceMatches).toBe(false);
  });

  it('clears a repository snapshot after the checkout is deleted', () => {
    const inventory = collectPackageInventory(repository);
    const store = new VulnerabilitySnapshotStore(cache);
    store.save(inventory, [], 'https://api.osv.dev');
    const snapshotDirectory = path.join(cache, fs.readdirSync(cache)[0]);
    expect(fs.existsSync(snapshotDirectory)).toBe(true);
    fs.rmSync(repository, { recursive: true, force: true });

    expect(() => store.clearRepository(repository)).not.toThrow();
    expect(fs.existsSync(snapshotDirectory)).toBe(false);
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
