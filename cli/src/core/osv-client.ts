import { DependencyCoordinate } from './package-inventory';
import { isAllowedNetworkEndpoint, readBoundedResponseBody } from './bounded-response';

export interface OsvCompactVulnerability {
  id: string;
  modified: string;
}

export interface OsvSeverity {
  type?: string;
  score?: string;
}

export interface OsvAffectedRangeEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
  limit?: string;
}

export interface OsvVulnerability {
  schema_version?: string;
  id: string;
  modified: string;
  published?: string;
  withdrawn?: string;
  aliases?: string[];
  related?: string[];
  summary?: string;
  details?: string;
  severity?: OsvSeverity[];
  affected?: Array<{
    package?: { ecosystem?: string; name?: string; purl?: string };
    severity?: OsvSeverity[];
    ranges?: Array<{ type?: string; repo?: string; events?: OsvAffectedRangeEvent[] }>;
    versions?: string[];
    database_specific?: Record<string, unknown>;
    ecosystem_specific?: Record<string, unknown>;
  }>;
  references?: Array<{ type?: string; url?: string }>;
  database_specific?: Record<string, unknown>;
}

export interface OsvMatch {
  coordinate: DependencyCoordinate;
  vulnerability: OsvVulnerability;
}

export type OsvClientErrorCode =
  | 'INVALID_ENDPOINT'
  | 'INVALID_OPTIONS'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_TOO_LARGE';

export class OsvClientError extends Error {
  constructor(
    public readonly code: OsvClientErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'OsvClientError';
  }
}

export interface OsvClientOptions {
  endpoint?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  retries?: number;
  detailConcurrency?: number;
  fetchImpl?: typeof fetch;
}

interface BatchQuery {
  package: { ecosystem: string; name: string };
  version: string;
  page_token?: string;
}

interface BatchResult {
  vulns?: OsvCompactVulnerability[];
  next_page_token?: string;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function normalizeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OsvClientError('INVALID_ENDPOINT', 'OSV endpoint must be a valid absolute URL');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new OsvClientError('INVALID_ENDPOINT', 'OSV endpoint cannot contain credentials, query parameters, or fragments');
  }
  if (!isAllowedNetworkEndpoint(value)) {
    throw new OsvClientError('INVALID_ENDPOINT', 'OSV endpoint must use HTTPS (HTTP is allowed only for approved loopback hosts)');
  }
  return url.toString().replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateBatchResponse(value: unknown, expected: number): BatchResult[] {
  if (!isRecord(value) || !Array.isArray(value.results) || value.results.length !== expected) {
    throw new OsvClientError('INVALID_RESPONSE', 'OSV batch response did not match the submitted query count');
  }
  return value.results.map((result: unknown) => {
    if (!isRecord(result)) {throw new OsvClientError('INVALID_RESPONSE', 'OSV batch result is not an object');}
    const vulns = result.vulns === undefined ? [] : result.vulns;
    if (!Array.isArray(vulns) || vulns.some(v => !isRecord(v) || typeof v.id !== 'string' || typeof v.modified !== 'string')) {
      throw new OsvClientError('INVALID_RESPONSE', 'OSV batch result contains an invalid vulnerability reference');
    }
    if (result.next_page_token !== undefined && typeof result.next_page_token !== 'string') {
      throw new OsvClientError('INVALID_RESPONSE', 'OSV batch pagination token is invalid');
    }
    return { vulns: vulns as OsvCompactVulnerability[], next_page_token: result.next_page_token };
  });
}

function validateVulnerability(value: unknown, expectedId: string): OsvVulnerability {
  if (!isRecord(value) || value.id !== expectedId || typeof value.modified !== 'string') {
    throw new OsvClientError('INVALID_RESPONSE', `OSV vulnerability record ${expectedId} is invalid`);
  }
  for (const field of ['aliases', 'related', 'severity', 'affected', 'references']) {
    if (value[field] !== undefined && !Array.isArray(value[field])) {
      throw new OsvClientError('INVALID_RESPONSE', `OSV vulnerability record ${expectedId} has invalid ${field}`);
    }
  }
  return value as OsvVulnerability;
}

export class OsvClient {
  readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly retries: number;
  private readonly detailConcurrency: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OsvClientOptions = {}) {
    this.endpoint = normalizeEndpoint(options.endpoint || process.env.GUARDSCAN_OSV_URL || 'https://api.osv.dev');
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 8 * 1024 * 1024;
    this.retries = options.retries ?? 2;
    this.detailConcurrency = Math.max(1, Math.min(16, options.detailConcurrency ?? 4));
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) {
      throw new OsvClientError('INVALID_OPTIONS', 'OSV timeout must be an integer from 1 through 120000 milliseconds');
    }
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1 || this.maxResponseBytes > 64 * 1024 * 1024) {
      throw new OsvClientError('INVALID_OPTIONS', 'OSV response limit must be an integer from 1 byte through 64 MiB');
    }
    if (!Number.isInteger(this.retries) || this.retries < 0 || this.retries > 5) {
      throw new OsvClientError('INVALID_OPTIONS', 'OSV retries must be an integer from 0 through 5');
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new OsvClientError('NETWORK_ERROR', 'This Node.js runtime does not provide fetch');
    }
  }

  async query(coordinates: DependencyCoordinate[]): Promise<OsvMatch[]> {
    if (coordinates.length === 0) {return [];}
    const references = new Map<number, Set<string>>();

    for (let start = 0; start < coordinates.length; start += 100) {
      const chunk = coordinates.slice(start, start + 100);
      let pending = chunk.map((coordinate, index) => ({ coordinate, originalIndex: start + index, pageToken: undefined as string | undefined }));
      let page = 0;
      while (pending.length > 0) {
        if (++page > 100) {throw new OsvClientError('INVALID_RESPONSE', 'OSV pagination exceeded the safety limit');}
        const queries: BatchQuery[] = pending.map(item => ({
          package: { ecosystem: item.coordinate.osvEcosystem, name: item.coordinate.name },
          version: item.coordinate.exactVersion,
          ...(item.pageToken ? { page_token: item.pageToken } : {}),
        }));
        const response = validateBatchResponse(
          await this.requestJson('/v1/querybatch', { method: 'POST', body: JSON.stringify({ queries }) }),
          queries.length
        );
        const next: typeof pending = [];
        response.forEach((result, index) => {
          const item = pending[index];
          const ids = references.get(item.originalIndex) || new Set<string>();
          for (const vuln of result.vulns || []) {ids.add(vuln.id);}
          references.set(item.originalIndex, ids);
          if (result.next_page_token) {next.push({ ...item, pageToken: result.next_page_token });}
        });
        pending = next;
      }
    }

    const ids = [...new Set([...references.values()].flatMap(value => [...value]))].sort();
    const records = new Map<string, OsvVulnerability>();
    let cursor = 0;
    const workers = Array.from({ length: Math.min(this.detailConcurrency, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        const value = await this.requestJson(`/v1/vulns/${encodeURIComponent(id)}`, { method: 'GET' });
        records.set(id, validateVulnerability(value, id));
      }
    });
    await Promise.all(workers);

    const matches: OsvMatch[] = [];
    for (const [index, matchedIds] of [...references.entries()].sort((a, b) => a[0] - b[0])) {
      for (const id of [...matchedIds].sort()) {
        const vulnerability = records.get(id);
        if (vulnerability) {matches.push({ coordinate: coordinates[index], vulnerability });}
      }
    }
    return matches;
  }

  private async requestJson(route: string, init: { method: 'GET' | 'POST'; body?: string }): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.endpoint}${route}`, {
          method: init.method,
          body: init.body,
          headers: init.body ? { 'content-type': 'application/json', 'accept': 'application/json' } : { 'accept': 'application/json' },
          redirect: 'error',
          signal: controller.signal,
        });
        const retryable = response.status === 429 || response.status >= 500;
        if (!response.ok) {
          if (retryable && attempt < this.retries) {
            const retryAfter = Number(response.headers.get('retry-after'));
            const fallbackDelay = Math.min(250 * 2 ** attempt, 2_000);
            await delay(Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 5_000)
              : fallbackDelay);
            continue;
          }
          throw new OsvClientError('HTTP_ERROR', `OSV request failed with HTTP ${response.status}`, response.status);
        }
        const text = await readBoundedResponseBody(response, this.maxResponseBytes, () =>
          new OsvClientError('RESPONSE_TOO_LARGE', 'OSV response exceeded the configured size limit')
        );
        try {
          return JSON.parse(text);
        } catch {
          throw new OsvClientError('INVALID_RESPONSE', 'OSV returned invalid JSON');
        }
      } catch (error: any) {
        lastError = error;
        if (error instanceof OsvClientError) {throw error;}
        if (error?.name === 'AbortError') {
          if (attempt >= this.retries) {throw new OsvClientError('TIMEOUT', 'OSV request timed out');}
        } else if (attempt >= this.retries) {
          throw new OsvClientError('NETWORK_ERROR', `OSV request failed: ${error?.message || error}`);
        }
        await delay(Math.min(250 * 2 ** attempt, 2_000));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new OsvClientError('NETWORK_ERROR', `OSV request failed: ${String(lastError)}`);
  }
}
