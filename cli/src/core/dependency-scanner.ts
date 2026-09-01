import { createHash } from 'crypto';
import semver from 'semver';
import { fromVector } from 'ae-cvss-calculator';
import {
  collectPackageInventory,
  DependencyCoordinate,
  filterPackageInventory,
  PackageEcosystem,
  PackageInventory,
  PackageInventoryError,
} from './package-inventory';
import { OsvClient, OsvClientError, OsvMatch, OsvSeverity, OsvVulnerability } from './osv-client';
import {
  VulnerabilitySnapshot,
  VulnerabilitySnapshotStatus,
  VulnerabilitySnapshotStore,
} from './vulnerability-cache';
import {
  CisaKevCatalog,
  CisaKevCacheStatus,
  CisaKevCatalogStore,
  CisaKevClient,
  CisaKevError,
} from './cisa-kev';

export type DependencySeverity = 'critical' | 'high' | 'medium' | 'low';
export type AdvisorySeverity = DependencySeverity | 'unknown';

export interface DependencyVulnerability {
  package: string;
  version: string;
  severity: DependencySeverity;
  advisorySeverity: AdvisorySeverity;
  policySeverity: DependencySeverity;
  title: string;
  cve?: string;
  canonicalId: string;
  aliases: string[];
  advisoryIds: string[];
  cveIds: string[];
  recommendation: string;
  fixedVersions: string[];
  ecosystem: PackageEcosystem;
  osvEcosystem: string;
  scope: DependencyCoordinate['scope'];
  direct: boolean;
  manifestPath: string;
  lockfilePath: string;
  dependencyPaths: string[];
  cvss?: { version?: string; vector?: string; score?: number; source: string };
  knownExploited: boolean | 'unknown';
  cweIds: string[];
  publishedAt?: string;
  modifiedAt: string;
  references: string[];
  source: 'osv';
  fingerprint: string;
}

export interface DependencyScanErrorInfo {
  code: string;
  message: string;
  file?: string;
}

export interface DependencyScanResult {
  vulnerabilities: DependencyVulnerability[];
  totalVulnerabilities: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  ecosystem: string;
  status: 'complete' | 'partial';
  source: 'osv';
  queriedPackages: number;
  unresolvedPackages: number;
  inventoryDigest: string;
  dataFreshness: 'live' | 'fresh-cache' | 'stale-cache' | 'unavailable';
  knownExploitedEnrichment: KnownExploitedEnrichment;
  errors: DependencyScanErrorInfo[];
}

export interface KnownExploitedEnrichment {
  status: 'disabled' | 'live' | 'fresh-cache' | 'stale-cache' | 'unavailable';
  source: 'cisa-kev';
  catalogVersion?: string;
  dateReleased?: string;
  retrievedAt?: string;
  ageDays?: number;
  error?: DependencyScanErrorInfo;
}

export interface DependencyScanOptions {
  offline?: boolean;
  allowPartial?: boolean;
  cache?: boolean;
  refresh?: boolean;
  maxSnapshotAgeDays?: number;
  strictInventory?: boolean;
  endpoint?: string;
  timeoutMs?: number;
  concurrency?: number;
  ecosystems?: PackageEcosystem[];
  scope?: 'all' | 'runtime';
  inventory?: PackageInventory;
  enrichKnownExploited?: boolean;
  kevEndpoint?: string;
  kevTimeoutMs?: number;
  kevMaxResponseBytes?: number;
  kevMaxCacheAgeDays?: number;
  kevClient?: CisaKevClient;
  kevStore?: CisaKevCatalogStore;
  client?: OsvClient;
  snapshotStore?: VulnerabilitySnapshotStore;
}

export type DependencyScanErrorCode =
  | 'OFFLINE_COVERAGE_UNAVAILABLE'
  | 'OFFLINE_COVERAGE_STALE'
  | 'OFFLINE_COVERAGE_MISMATCH'
  | 'OFFLINE_COVERAGE_INCOMPLETE'
  | 'INVENTORY_INCOMPLETE'
  | 'KEV_COVERAGE_UNAVAILABLE'
  | 'INVALID_OPTIONS';

export class DependencyScanError extends Error {
  constructor(
    public readonly code: DependencyScanErrorCode,
    message: string,
    public readonly details: DependencyScanErrorInfo[] = []
  ) {
    super(message);
    this.name = 'DependencyScanError';
  }
}

interface AdvisoryGroup {
  ids: Set<string>;
  records: OsvVulnerability[];
}

const ECOSYSTEM_ORDER: PackageEcosystem[] = ['npm', 'pip', 'go', 'ruby', 'cargo', 'maven'];

function canonicalId(ids: Iterable<string>): string {
  const sorted = [...new Set(ids)].sort();
  return sorted.find(id => /^CVE-\d{4}-\d+$/i.test(id)) ||
    sorted.find(id => /^GHSA-/i.test(id)) ||
    sorted.find(id => !/^OSV-/i.test(id)) ||
    sorted[0];
}

function advisoryGroups(records: OsvVulnerability[]): AdvisoryGroup[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) {parent.set(id, id); return id;}
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const left = find(a);
    const right = find(b);
    if (left !== right) {parent.set(right, left);}
  };
  for (const record of records) {
    const ids = [record.id, ...(record.aliases || [])];
    for (const id of ids) {parent.set(id, parent.get(id) || id);}
    for (const id of ids.slice(1)) {union(record.id, id);}
  }
  const groups = new Map<string, AdvisoryGroup>();
  for (const record of records) {
    const root = find(record.id);
    const group = groups.get(root) || { ids: new Set<string>(), records: [] };
    group.records.push(record);
    for (const id of [record.id, ...(record.aliases || [])]) {group.ids.add(id);}
    groups.set(root, group);
  }
  return [...groups.values()].sort((a, b) => canonicalId(a.ids).localeCompare(canonicalId(b.ids)));
}

function severityName(value: unknown): AdvisorySeverity {
  if (typeof value !== 'string') {return 'unknown';}
  const normalized = value.toLowerCase();
  if (normalized.includes('critical')) {return 'critical';}
  if (normalized.includes('high')) {return 'high';}
  if (normalized.includes('medium') || normalized.includes('moderate')) {return 'medium';}
  if (normalized.includes('low')) {return 'low';}
  return 'unknown';
}

function cvssScoreSeverity(score: number): AdvisorySeverity {
  if (score >= 9) {return 'critical';}
  if (score >= 7) {return 'high';}
  if (score >= 4) {return 'medium';}
  if (score > 0) {return 'low';}
  return 'unknown';
}

function severityFromEntries(entries: OsvSeverity[] | undefined, source: string): {
  severity: AdvisorySeverity;
  cvss?: DependencyVulnerability['cvss'];
} {
  let rawCvss: DependencyVulnerability['cvss'] | undefined;
  for (const entry of entries || []) {
    if (typeof entry.score !== 'string') {continue;}
    if (!entry.score.trim()) {continue;}
    const numeric = Number(entry.score);
    if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 10) {
      return {
        severity: cvssScoreSeverity(numeric),
        cvss: { version: entry.type, score: numeric, source },
      };
    }
    if (/^CVSS:/i.test(entry.score)) {
      try {
        const vector = entry.score.toUpperCase();
        const calculator = fromVector(vector);
        if (calculator) {
          const score = calculator.calculateScores().base;
          if (typeof score !== 'number' || !Number.isFinite(score)) {throw new Error('CVSS base score is unavailable');}
          return {
            severity: cvssScoreSeverity(score),
            cvss: { version: vector.slice(5, 8), vector: entry.score, score, source },
          };
        }
      } catch {
        // Preserve malformed or unsupported upstream vectors without trusting them for policy severity.
      }
      rawCvss ||= { version: entry.type, vector: entry.score, source };
    }
  }
  return { severity: 'unknown', cvss: rawCvss };
}

function selectSeverity(records: OsvVulnerability[], coordinate: DependencyCoordinate): {
  severity: AdvisorySeverity;
  cvss?: DependencyVulnerability['cvss'];
} {
  const rank: Record<AdvisorySeverity, number> = {
    unknown: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  let selected: {
    severity: AdvisorySeverity;
    cvss?: DependencyVulnerability['cvss'];
  } = { severity: 'unknown' };
  let rawCvss: DependencyVulnerability['cvss'] | undefined;
  const consider = (candidate: {
    severity: AdvisorySeverity;
    cvss?: DependencyVulnerability['cvss'];
  }): void => {
    rawCvss ||= candidate.cvss;
    if (
      rank[candidate.severity] > rank[selected.severity] ||
      (candidate.severity === selected.severity && !selected.cvss && candidate.cvss)
    ) {
      selected = candidate;
    }
  };

  for (const record of records) {
    for (const affected of record.affected || []) {
      if (affected.package?.ecosystem === coordinate.osvEcosystem && affected.package?.name === coordinate.name) {
        const packageSeverity = severityFromEntries(affected.severity, `${record.id}:affected`);
        consider(packageSeverity);
        const ecosystemSpecific = affected.ecosystem_specific || {};
        const named = severityName(ecosystemSpecific.severity);
        consider({ severity: named });
      }
    }
  }
  for (const record of records) {
    const topLevel = severityFromEntries(record.severity, record.id);
    consider(topLevel);
    const named = severityName(record.database_specific?.severity);
    consider({ severity: named });
  }
  return selected.severity === 'unknown'
    ? { severity: 'unknown', cvss: rawCvss }
    : selected;
}

function fixedVersions(records: OsvVulnerability[], coordinate: DependencyCoordinate): string[] {
  const versions = new Set<string>();
  for (const record of records) {
    for (const affected of record.affected || []) {
      if (affected.package?.ecosystem !== coordinate.osvEcosystem || affected.package?.name !== coordinate.name) {continue;}
      for (const range of affected.ranges || []) {
        for (const event of range.events || []) {
          if (event.fixed) {versions.add(event.fixed);}
        }
      }
    }
  }
  const values = [...versions];
  if (coordinate.ecosystem === 'npm') {
    const currentVersion = semver.valid(coordinate.exactVersion, { loose: true });
    if (!currentVersion) {
      return values
        .filter(version => semver.valid(version, { loose: true }))
        .sort(semver.compare);
    }
    return values
      .filter(version => semver.valid(version, { loose: true }) && semver.gt(version, currentVersion, { loose: true }))
      .sort(semver.compare);
  }
  return values.sort();
}

function remediationRecommendation(
  coordinate: DependencyCoordinate,
  fixed: string[]
): string {
  if (coordinate.ecosystem === 'npm') {
    if (!semver.valid(coordinate.exactVersion, { loose: true })) {
      return 'The installed npm version is not semver-comparable; review the upstream advisory for applicable remediation.';
    }
    return fixed.length > 0
      ? `Update to ${fixed[0]} or later`
      : 'No applicable fixed npm version is currently published; review upstream guidance';
  }
  if (fixed.length > 0) {
    return `Review published fixed versions (${fixed.join(', ')}) with ${coordinate.ecosystem} ecosystem tooling; GuardScan cannot safely order these versions.`;
  }
  return 'No fixed version is currently published; review upstream guidance';
}

function safeReferences(records: OsvVulnerability[]): string[] {
  const urls = new Set<string>();
  for (const record of records) {
    for (const reference of record.references || []) {
      if (!reference.url) {continue;}
      try {
        const url = new URL(reference.url);
        if (url.protocol === 'https:' || url.protocol === 'http:') {urls.add(url.toString());}
      } catch { /* Ignore malformed upstream references. */ }
    }
  }
  return [...urls].sort().slice(0, 50);
}

function cwes(records: OsvVulnerability[]): string[] {
  const values = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string' && /^CWE-\d+$/i.test(value)) {values.add(value.toUpperCase());}
    else if (Array.isArray(value)) {value.forEach(visit);}
  };
  for (const record of records) {
    visit(record.database_specific?.cwe_ids);
    visit(record.database_specific?.cwes);
  }
  return [...values].sort();
}

function cleanTitle(value: string | undefined, fallback: string): string {
  if (!value) {return fallback;}
  return value.replace(/<[^>]*>/g, '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 500) || fallback;
}

function toVulnerability(
  coordinate: DependencyCoordinate,
  group: AdvisoryGroup,
  knownExploitedCves: ReadonlySet<string> | 'unknown'
): DependencyVulnerability {
  const canonical = canonicalId(group.ids);
  const severityResult = selectSeverity(group.records, coordinate);
  const policySeverity: DependencySeverity = severityResult.severity === 'unknown' ? 'medium' : severityResult.severity;
  const fixed = fixedVersions(group.records, coordinate);
  const first = [...group.records].sort((a, b) => a.id.localeCompare(b.id))[0];
  const cveIds = [...group.ids].filter(id => /^CVE-/i.test(id)).sort();
  const aliases = [...group.ids].filter(id => id !== canonical).sort();
  const fingerprint = createHash('sha256').update([
    canonical, coordinate.osvEcosystem, coordinate.name, coordinate.exactVersion, coordinate.lockfilePath,
  ].join('\0')).digest('hex');
  return {
    package: coordinate.name,
    version: coordinate.exactVersion,
    severity: policySeverity,
    advisorySeverity: severityResult.severity,
    policySeverity,
    title: cleanTitle(first.summary, `Known vulnerability ${canonical}`),
    cve: cveIds[0],
    canonicalId: canonical,
    aliases,
    advisoryIds: [canonical, ...aliases],
    cveIds,
    recommendation: remediationRecommendation(coordinate, fixed),
    fixedVersions: fixed,
    ecosystem: coordinate.ecosystem,
    osvEcosystem: coordinate.osvEcosystem,
    scope: coordinate.scope,
    direct: coordinate.direct,
    manifestPath: coordinate.manifestPath,
    lockfilePath: coordinate.lockfilePath,
    dependencyPaths: coordinate.dependencyPaths,
    cvss: severityResult.cvss,
    knownExploited: knownExploitedCves === 'unknown'
      ? 'unknown'
      : cveIds.some(id => knownExploitedCves.has(id.toUpperCase())),
    cweIds: cwes(group.records),
    publishedAt: first.published,
    modifiedAt: [...group.records].map(record => record.modified).sort().reverse()[0],
    references: safeReferences(group.records),
    source: 'osv',
    fingerprint,
  };
}

function normalizeMatches(matches: OsvMatch[], knownExploitedCves: ReadonlySet<string> | 'unknown'): DependencyVulnerability[] {
  const byCoordinate = new Map<string, { coordinate: DependencyCoordinate; records: Map<string, OsvVulnerability> }>();
  for (const match of matches) {
    if (match.vulnerability.withdrawn) {continue;}
    const key = [match.coordinate.osvEcosystem, match.coordinate.name, match.coordinate.exactVersion, match.coordinate.lockfilePath].join('\0');
    const entry = byCoordinate.get(key) || { coordinate: match.coordinate, records: new Map<string, OsvVulnerability>() };
    entry.records.set(match.vulnerability.id, match.vulnerability);
    byCoordinate.set(key, entry);
  }
  const vulnerabilities: DependencyVulnerability[] = [];
  for (const entry of byCoordinate.values()) {
    for (const group of advisoryGroups([...entry.records.values()])) {
      vulnerabilities.push(toVulnerability(entry.coordinate, group, knownExploitedCves));
    }
  }
  return vulnerabilities.sort((a, b) =>
    `${a.ecosystem}\0${a.package}\0${a.version}\0${a.canonicalId}`.localeCompare(
      `${b.ecosystem}\0${b.package}\0${b.version}\0${b.canonicalId}`
    )
  );
}

function inventoryErrors(errors: PackageInventoryError[]): DependencyScanErrorInfo[] {
  return errors.map(error => ({ code: error.code, message: error.message, file: error.file }));
}

function operationalError(error: unknown, fallbackCode: string): DependencyScanErrorInfo {
  return {
    code: error instanceof OsvClientError ? error.code : fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  };
}

function resultFor(
  ecosystem: string,
  inventory: PackageInventory,
  vulnerabilities: DependencyVulnerability[],
  freshness: DependencyScanResult['dataFreshness'],
  errors: DependencyScanErrorInfo[],
  knownExploitedEnrichment: KnownExploitedEnrichment
): DependencyScanResult {
  const coordinates = inventory.coordinates.filter(item => item.ecosystem === ecosystem);
  const values = vulnerabilities.filter(item => item.ecosystem === ecosystem);
  return {
    vulnerabilities: values,
    totalVulnerabilities: values.length,
    critical: values.filter(value => value.severity === 'critical').length,
    high: values.filter(value => value.severity === 'high').length,
    medium: values.filter(value => value.severity === 'medium').length,
    low: values.filter(value => value.severity === 'low').length,
    ecosystem,
    status: errors.length > 0 ? 'partial' : 'complete',
    source: 'osv',
    queriedPackages: coordinates.length,
    unresolvedPackages: inventory.errors.length,
    inventoryDigest: inventory.digest,
    dataFreshness: freshness,
    knownExploitedEnrichment,
    errors,
  };
}

function kevMetadata(
  status: KnownExploitedEnrichment['status'],
  catalog?: CisaKevCatalog,
  retrievedAt?: string,
  ageDays?: number,
  error?: unknown
): KnownExploitedEnrichment {
  const failure = error instanceof CisaKevError
    ? { code: error.code, message: error.message }
    : error
      ? { code: 'CISA_KEV_ENRICHMENT_FAILED', message: error instanceof Error ? error.message : String(error) }
      : undefined;
  return {
    status,
    source: 'cisa-kev',
    catalogVersion: catalog?.catalogVersion,
    dateReleased: catalog?.dateReleased,
    retrievedAt,
    ageDays,
    error: failure,
  };
}

async function knownExploitedData(options: DependencyScanOptions): Promise<{
  cves: ReadonlySet<string>;
  metadata: KnownExploitedEnrichment;
}> {
  if (options.enrichKnownExploited === false) {
    return { cves: new Set<string>(), metadata: kevMetadata('disabled') };
  }
  const store = options.kevStore || new CisaKevCatalogStore();
  const maxAgeDays = options.kevMaxCacheAgeDays ?? 1;
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
    throw new DependencyScanError('INVALID_OPTIONS', 'CISA KEV cache age must be a non-negative number of days');
  }
  const cached: CisaKevCacheStatus = options.cache === false
    ? { exists: false, fresh: false }
    : store.status(maxAgeDays);
  const fromCache = (status: 'fresh-cache' | 'stale-cache', error?: unknown) => {
    const entry = cached.entry;
    if (!entry) {
      return { cves: new Set<string>(), metadata: kevMetadata('unavailable', undefined, undefined, undefined, error) };
    }
    return {
      cves: new Set(entry.catalog.vulnerabilities.map(value => value.cveID.toUpperCase())),
      metadata: kevMetadata(status, entry.catalog, entry.retrievedAt, cached.ageDays, error),
    };
  };

  if (options.offline) {
    return cached.entry
      ? fromCache(cached.fresh ? 'fresh-cache' : 'stale-cache')
      : { cves: new Set<string>(), metadata: kevMetadata('unavailable', undefined, undefined, undefined, new Error('No cached CISA KEV catalog is available offline')) };
  }

  let client: CisaKevClient;
  try {
    client = options.kevClient || new CisaKevClient({
      endpoint: options.kevEndpoint,
      timeoutMs: options.kevTimeoutMs,
      maxResponseBytes: options.kevMaxResponseBytes,
    });
  } catch (error) {
    return cached.entry
      ? fromCache(cached.fresh ? 'fresh-cache' : 'stale-cache', error)
      : { cves: new Set<string>(), metadata: kevMetadata('unavailable', undefined, undefined, undefined, error) };
  }
  const cacheMatchesSource = cached.entry?.sourceEndpoint === client.endpoint;
  if (cached.fresh && cacheMatchesSource && !options.refresh) {return fromCache('fresh-cache');}

  try {
    const catalog = await client.fetchCatalog();
    const entry = options.cache === false ? undefined : store.save(catalog, client.endpoint);
    return {
      cves: new Set(catalog.vulnerabilities.map(value => value.cveID.toUpperCase())),
      metadata: kevMetadata('live', catalog, entry?.retrievedAt),
    };
  } catch (error) {
    return cached.entry && cacheMatchesSource
      ? fromCache(cached.fresh ? 'fresh-cache' : 'stale-cache', error)
      : { cves: new Set<string>(), metadata: kevMetadata('unavailable', undefined, undefined, undefined, error) };
  }
}

function statusError(status: VulnerabilitySnapshotStatus): DependencyScanError {
  if (!status.exists) {
    return new DependencyScanError('OFFLINE_COVERAGE_UNAVAILABLE', 'No offline vulnerability snapshot exists. Run "guardscan vuln db update" while online.');
  }
  if (!status.inventoryMatches || status.sourceMatches === false) {
    return new DependencyScanError('OFFLINE_COVERAGE_MISMATCH', 'The offline vulnerability snapshot does not cover the current dependency inventory and OSV source. Refresh it online.');
  }
  return new DependencyScanError('OFFLINE_COVERAGE_STALE', 'The offline vulnerability snapshot is stale. Refresh it online or use --allow-partial.');
}

export class DependencyScanner {
  async scan(repoPath: string = process.cwd(), options: DependencyScanOptions = {}): Promise<DependencyScanResult[]> {
    if (options.offline && options.refresh) {
      throw new DependencyScanError('INVALID_OPTIONS', '--refresh cannot be used with --offline');
    }
    if (options.offline && options.cache === false) {
      throw new DependencyScanError('INVALID_OPTIONS', 'Offline vulnerability scanning requires snapshot access; caching is disabled');
    }
    const maxSnapshotAgeDays = options.maxSnapshotAgeDays ?? 7;
    if (!Number.isFinite(maxSnapshotAgeDays) || maxSnapshotAgeDays < 0) {
      throw new DependencyScanError('INVALID_OPTIONS', 'Vulnerability snapshot age must be a non-negative number of days');
    }
    const inventory = filterPackageInventory(options.inventory || collectPackageInventory(repoPath), {
      ecosystems: options.ecosystems,
      scope: options.scope,
    });
    const errors = inventoryErrors(inventory.errors);
    if (options.strictInventory && errors.length > 0 && !options.allowPartial) {
      throw new DependencyScanError('INVENTORY_INCOMPLETE', 'Dependency inventory contains unresolved or invalid package data', errors);
    }
    if (inventory.coordinates.length === 0) {
      return errors.length > 0 && options.allowPartial
        ? [resultFor('inventory', inventory, [], 'unavailable', errors, kevMetadata('disabled'))]
        : [];
    }
    const store = options.snapshotStore || new VulnerabilitySnapshotStore();
    const client = options.client || new OsvClient({
      endpoint: options.endpoint,
      timeoutMs: options.timeoutMs,
      detailConcurrency: options.concurrency,
    });
    let matches: OsvMatch[] = [];
    let freshness: DependencyScanResult['dataFreshness'] = 'live';
    const recordDroppedMatches = (snapshot: VulnerabilitySnapshot): void => {
      if (snapshot.droppedMatches === 0) {return;}
      const error = new DependencyScanError(
        'OFFLINE_COVERAGE_INCOMPLETE',
        `The offline vulnerability snapshot omitted ${snapshot.droppedMatches} malformed ${snapshot.droppedMatches === 1 ? 'advisory' : 'advisories'}. Refresh it online or use --allow-partial.`
      );
      if (!options.allowPartial) {throw error;}
      errors.push({ code: error.code, message: error.message });
    };

    if (options.offline) {
      const status = store.status(inventory, maxSnapshotAgeDays, client.endpoint);
      if (!status.exists || !status.inventoryMatches || status.sourceMatches === false || !status.fresh || !status.snapshot) {
        const error = statusError(status);
        if (!options.allowPartial) {throw error;}
        errors.push({ code: error.code, message: error.message });
        const reusableSnapshot = status.exists && status.inventoryMatches && status.sourceMatches !== false
          ? status.snapshot
          : undefined;
        freshness = reusableSnapshot ? 'stale-cache' : 'unavailable';
        if (reusableSnapshot) {
          recordDroppedMatches(reusableSnapshot);
          matches = store.matches(inventory, reusableSnapshot);
        }
      } else {
        recordDroppedMatches(status.snapshot);
        matches = store.matches(inventory, status.snapshot);
        freshness = 'fresh-cache';
      }
    } else {
      const cachedStatus = options.cache !== false && !options.refresh
        ? store.status(inventory, maxSnapshotAgeDays, client.endpoint)
        : undefined;
      if (cachedStatus?.fresh
          && cachedStatus.inventoryMatches
          && cachedStatus.sourceMatches !== false
          && cachedStatus.snapshot
          && cachedStatus.snapshot.droppedMatches === 0) {
        matches = store.matches(inventory, cachedStatus.snapshot);
        freshness = 'fresh-cache';
      } else {
        try {
          matches = await client.query(inventory.coordinates);
        } catch (error: unknown) {
          if (!options.allowPartial) {throw error;}
          errors.push(operationalError(error, 'OSV_QUERY_FAILED'));
          const reusableSnapshot = cachedStatus?.exists
            && cachedStatus.inventoryMatches
            && cachedStatus.sourceMatches !== false
            ? cachedStatus.snapshot
            : undefined;
          if (reusableSnapshot) {
            recordDroppedMatches(reusableSnapshot);
            matches = store.matches(inventory, reusableSnapshot);
            freshness = cachedStatus?.fresh ? 'fresh-cache' : 'stale-cache';
          } else {
            freshness = 'unavailable';
          }
        }
        if (freshness === 'live' && options.cache !== false) {
          try {
            store.save(inventory, matches, client.endpoint);
          } catch (error: unknown) {
            errors.push(operationalError(error, 'SNAPSHOT_PERSIST_FAILED'));
          }
        }
      }
    }

    const knownExploited = await knownExploitedData(options);
    const kevIncomplete = ['stale-cache', 'unavailable'].includes(knownExploited.metadata.status);
    if (kevIncomplete) {
      const kevError = knownExploited.metadata.error || {
        code: 'KEV_COVERAGE_UNAVAILABLE',
        message: knownExploited.metadata.status === 'stale-cache'
          ? 'CISA KEV coverage is stale'
          : 'CISA KEV coverage is unavailable',
      };
      const error = new DependencyScanError(
        'KEV_COVERAGE_UNAVAILABLE',
        `CISA KEV coverage is unavailable: ${kevError.message}`,
        [kevError]
      );
      if (!options.allowPartial) {throw error;}
      errors.push({ code: error.code, message: error.message });
    }
    const vulnerabilities = normalizeMatches(matches, kevIncomplete ? 'unknown' : knownExploited.cves);
    const ecosystems = ECOSYSTEM_ORDER.filter(ecosystem => inventory.coordinates.some(item => item.ecosystem === ecosystem));
    return ecosystems.map(ecosystem => resultFor(
      ecosystem,
      inventory,
      vulnerabilities,
      freshness,
      errors,
      knownExploited.metadata
    ));
  }

  async updateSnapshot(repoPath: string = process.cwd(), options: Omit<DependencyScanOptions, 'offline'> = {}): Promise<DependencyScanResult[]> {
    return this.scan(repoPath, { ...options, offline: false, refresh: true, cache: true, strictInventory: true });
  }

  snapshotStatus(
    repoPath: string = process.cwd(),
    maxAgeDays: number = 7,
    store = new VulnerabilitySnapshotStore(),
    expectedSourceEndpoint?: string
  ): {
    inventory: PackageInventory;
    status: VulnerabilitySnapshotStatus;
  } {
    const inventory = collectPackageInventory(repoPath);
    return { inventory, status: store.status(inventory, maxAgeDays, expectedSourceEndpoint) };
  }

  clearSnapshot(repoPath: string = process.cwd(), store = new VulnerabilitySnapshotStore()): void {
    store.clearRepository(repoPath);
  }

  clearAllSnapshots(store = new VulnerabilitySnapshotStore()): void {
    store.clearAll();
  }

  knownExploitedStatus(maxAgeDays: number = 1, store = new CisaKevCatalogStore()) {
    return store.status(maxAgeDays);
  }

  clearKnownExploitedCache(store = new CisaKevCatalogStore()): void {
    store.clear();
  }
}

export const dependencyScanner = new DependencyScanner();
