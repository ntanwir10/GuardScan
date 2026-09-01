import * as fs from 'fs';
import * as path from 'path';
import { getGuardScanCacheDir } from '../utils/path-helper';
import {
  atomicReplaceJson,
  ensurePrivateDirectory,
  quarantineFile,
  readJsonFileBounded,
} from '../utils/private-state';
import { readBoundedResponseBody } from './bounded-response';

const DEFAULT_ENDPOINT = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_QUARANTINE_ENTRIES = 20;

export type CisaKevErrorCode =
  | 'INVALID_ENDPOINT'
  | 'INVALID_OPTIONS'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_TOO_LARGE';

export class CisaKevError extends Error {
  constructor(
    public readonly code: CisaKevErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'CisaKevError';
  }
}

export interface CisaKevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse: string;
  notes: string;
  cwes?: string[];
}

export interface CisaKevCatalog {
  title: string;
  catalogVersion: string;
  dateReleased: string;
  count: number;
  vulnerabilities: CisaKevEntry[];
}

export interface CisaKevClientOptions {
  endpoint?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

export interface CisaKevCacheEntry {
  schemaVersion: 'guardscan.cisa-kev-cache.v1';
  retrievedAt: string;
  sourceEndpoint: string;
  catalog: CisaKevCatalog;
}

export interface CisaKevCacheStatus {
  exists: boolean;
  fresh: boolean;
  ageDays?: number;
  entry?: CisaKevCacheEntry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, field: string, context: string): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new CisaKevError('INVALID_RESPONSE', `${context} has invalid ${field}`);
  }
  return value;
}

function requiredDate(record: Record<string, unknown>, field: string, context: string): string {
  const value = requiredString(record, field, context);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value) {
    throw new CisaKevError('INVALID_RESPONSE', `${context} has invalid ${field}`);
  }
  return value;
}

/** Validate and retain the published CISA KEV fields used by GuardScan. */
export function parseCisaKevCatalog(value: unknown): CisaKevCatalog {
  if (!isRecord(value) || !Array.isArray(value.vulnerabilities)) {
    throw new CisaKevError('INVALID_RESPONSE', 'CISA KEV response is not a catalog');
  }
  const count = value.count;
  if (!Number.isInteger(count) || (count as number) < 0 || count !== value.vulnerabilities.length) {
    throw new CisaKevError('INVALID_RESPONSE', 'CISA KEV catalog count does not match its entries');
  }
  const vulnerabilities = value.vulnerabilities.map((item, index): CisaKevEntry => {
    if (!isRecord(item)) {
      throw new CisaKevError('INVALID_RESPONSE', `CISA KEV entry ${index} is not an object`);
    }
    const cveID = requiredString(item, 'cveID', `CISA KEV entry ${index}`).toUpperCase();
    if (!/^CVE-\d{4}-\d{4,}$/i.test(cveID)) {
      throw new CisaKevError('INVALID_RESPONSE', `CISA KEV entry ${index} has an invalid cveID`);
    }
    const cwes = item.cwes;
    if (cwes !== undefined && (!Array.isArray(cwes) || cwes.some(cwe => typeof cwe !== 'string'))) {
      throw new CisaKevError('INVALID_RESPONSE', `CISA KEV entry ${index} has invalid cwes`);
    }
    return {
      cveID,
      vendorProject: requiredString(item, 'vendorProject', `CISA KEV entry ${index}`),
      product: requiredString(item, 'product', `CISA KEV entry ${index}`),
      vulnerabilityName: requiredString(item, 'vulnerabilityName', `CISA KEV entry ${index}`),
      dateAdded: requiredDate(item, 'dateAdded', `CISA KEV entry ${index}`),
      shortDescription: requiredString(item, 'shortDescription', `CISA KEV entry ${index}`),
      requiredAction: requiredString(item, 'requiredAction', `CISA KEV entry ${index}`),
      dueDate: requiredDate(item, 'dueDate', `CISA KEV entry ${index}`),
      knownRansomwareCampaignUse: requiredString(item, 'knownRansomwareCampaignUse', `CISA KEV entry ${index}`),
      notes: requiredString(item, 'notes', `CISA KEV entry ${index}`),
      ...(cwes ? { cwes: cwes as string[] } : {}),
    };
  });
  const dateReleased = requiredString(value, 'dateReleased', 'CISA KEV catalog');
  if (!Number.isFinite(Date.parse(dateReleased))) {
    throw new CisaKevError('INVALID_RESPONSE', 'CISA KEV catalog has invalid dateReleased');
  }
  return {
    title: requiredString(value, 'title', 'CISA KEV catalog'),
    catalogVersion: requiredString(value, 'catalogVersion', 'CISA KEV catalog'),
    dateReleased,
    count: count,
    vulnerabilities,
  };
}

function normalizeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CisaKevError('INVALID_ENDPOINT', 'CISA KEV endpoint must be a valid absolute URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new CisaKevError(
      'INVALID_ENDPOINT',
      'CISA KEV endpoint must use HTTPS and cannot contain credentials, query parameters, or fragments'
    );
  }
  return url.toString();
}

export class CisaKevClient {
  readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CisaKevClientOptions = {}) {
    this.endpoint = normalizeEndpoint(options.endpoint || process.env.GUARDSCAN_CISA_KEV_URL || DEFAULT_ENDPOINT);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) {
      throw new CisaKevError('INVALID_OPTIONS', 'CISA KEV timeout must be an integer from 1 through 120000 milliseconds');
    }
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1 || this.maxResponseBytes > 64 * 1024 * 1024) {
      throw new CisaKevError('INVALID_OPTIONS', 'CISA KEV response limit must be an integer from 1 byte through 64 MiB');
    }
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new CisaKevError('NETWORK_ERROR', 'This Node.js runtime does not provide fetch');
    }
  }

  async fetchCatalog(): Promise<CisaKevCatalog> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new CisaKevError('HTTP_ERROR', `CISA KEV request failed with HTTP ${response.status}`, response.status);
      }
      const text = await readBoundedResponseBody(response, this.maxResponseBytes, () =>
        new CisaKevError('RESPONSE_TOO_LARGE', 'CISA KEV response exceeded the configured size limit')
      );
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (error) {
        if (error instanceof CisaKevError) {throw error;}
        throw new CisaKevError('INVALID_RESPONSE', 'CISA KEV returned invalid JSON');
      }
      return parseCisaKevCatalog(value);
    } catch (error: unknown) {
      if (error instanceof CisaKevError) {throw error;}
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CisaKevError('TIMEOUT', 'CISA KEV request timed out');
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new CisaKevError('NETWORK_ERROR', `CISA KEV request failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseCacheEntry(value: unknown): CisaKevCacheEntry {
  if (!isRecord(value) || value.schemaVersion !== 'guardscan.cisa-kev-cache.v1' ||
      typeof value.retrievedAt !== 'string' || !Number.isFinite(Date.parse(value.retrievedAt)) ||
      typeof value.sourceEndpoint !== 'string') {
    throw new Error('invalid cache envelope');
  }
  return {
    schemaVersion: 'guardscan.cisa-kev-cache.v1',
    retrievedAt: value.retrievedAt,
    sourceEndpoint: normalizeEndpoint(value.sourceEndpoint),
    catalog: parseCisaKevCatalog(value.catalog),
  };
}

export class CisaKevCatalogStore {
  private readonly baseDir: string;

  constructor(baseDir: string = path.join(getGuardScanCacheDir(), 'vulnerabilities', 'cisa-kev')) {
    this.baseDir = path.resolve(baseDir);
  }

  save(catalog: CisaKevCatalog, sourceEndpoint: string): CisaKevCacheEntry {
    const entry: CisaKevCacheEntry = {
      schemaVersion: 'guardscan.cisa-kev-cache.v1',
      retrievedAt: new Date().toISOString(),
      sourceEndpoint,
      catalog,
    };
    ensurePrivateDirectory(this.baseDir);
    const target = path.join(this.baseDir, 'catalog.json');
    atomicReplaceJson(target, entry);
    return entry;
  }

  status(maxAgeDays: number = 1): CisaKevCacheStatus {
    const file = path.join(this.baseDir, 'catalog.json');
    if (!fs.existsSync(file)) {return { exists: false, fresh: false };}
    try {
      const entry = parseCacheEntry(readJsonFileBounded(file, MAX_CACHE_BYTES));
      const ageDays = Math.max(0, (Date.now() - Date.parse(entry.retrievedAt)) / 86_400_000);
      return {
        exists: true,
        fresh: Number.isFinite(ageDays) && ageDays <= maxAgeDays,
        ageDays,
        entry,
      };
    } catch {
      quarantineFile(file, path.join(this.baseDir, 'quarantine'), MAX_QUARANTINE_ENTRIES);
      return { exists: false, fresh: false };
    }
  }

  clear(): void {
    fs.rmSync(this.baseDir, { recursive: true, force: true });
  }
}
