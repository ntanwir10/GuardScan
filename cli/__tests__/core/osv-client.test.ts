import { OsvClient, OsvClientError } from '../../src/core/osv-client';
import { DependencyCoordinate } from '../../src/core/package-inventory';

const coordinate = (index: number): DependencyCoordinate => ({
  ecosystem: 'npm', osvEcosystem: 'npm', name: `package-${index}`, exactVersion: '1.0.0',
  scope: 'runtime', direct: true, manifestPath: 'package.json', lockfilePath: 'package-lock.json', dependencyPaths: [],
});

const response = (value: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(value), { status, headers });

describe('OsvClient', () => {
  it('batches at 100, preserves association, and follows per-query pagination', async () => {
    const batchSizes: number[] = [];
    let batchCall = 0;
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v1/querybatch')) {
        const queries = JSON.parse(String(init?.body)).queries;
        batchSizes.push(queries.length);
        batchCall++;
        if (batchCall === 1) {
          return response({ results: queries.map((_query: unknown, index: number) => index === 0
            ? { vulns: [{ id: 'OSV-FIRST', modified: '2026-01-01' }], next_page_token: 'next' }
            : { vulns: [] }) });
        }
        if (batchCall === 2) {
          expect(queries).toHaveLength(1);
          expect(queries[0].page_token).toBe('next');
          return response({ results: [{ vulns: [{ id: 'OSV-SECOND', modified: '2026-01-02' }] }] });
        }
        return response({ results: queries.map(() => ({ vulns: [] })) });
      }
      const id = decodeURIComponent(url.split('/').pop() || '');
      return response({ id, modified: '2026-01-02T00:00:00Z' });
    }) as typeof fetch;

    const matches = await new OsvClient({ fetchImpl, retries: 0, detailConcurrency: 2 }).query(
      Array.from({ length: 101 }, (_, index) => coordinate(index))
    );

    expect(batchSizes).toEqual([100, 1, 1]);
    expect(matches.map(match => `${match.coordinate.name}:${match.vulnerability.id}`)).toEqual([
      'package-0:OSV-FIRST', 'package-0:OSV-SECOND',
    ]);
  });

  it('retries retryable responses and rejects malformed result counts', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({ results: [] }));
    const client = new OsvClient({ fetchImpl: fetchImpl as typeof fetch, retries: 1 });

    await expect(client.query([coordinate(0)])).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects unsafe endpoints and oversized responses', async () => {
    expect(() => new OsvClient({ endpoint: 'http://example.test' })).toThrow(OsvClientError);
    expect(() => new OsvClient({ endpoint: 'https://user:pass@example.test' })).toThrow(OsvClientError);
    expect(() => new OsvClient({ endpoint: 'http://127.0.0.1:8000' })).not.toThrow();
    expect(() => new OsvClient({ timeoutMs: 0 })).toThrow(OsvClientError);
    expect(() => new OsvClient({ maxResponseBytes: 0 })).toThrow(OsvClientError);
    expect(() => new OsvClient({ retries: 6 })).toThrow(OsvClientError);

    const client = new OsvClient({
      maxResponseBytes: 10,
      retries: 0,
      fetchImpl: jest.fn(async () => response({ results: [] }, 200, { 'content-length': '100' })) as typeof fetch,
    });
    await expect(client.query([coordinate(0)])).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });

    const streamed = new OsvClient({
      maxResponseBytes: 10,
      retries: 0,
      fetchImpl: jest.fn(async () => new Response('01234567890', { status: 200 })) as typeof fetch,
    });
    await expect(streamed.query([coordinate(0)])).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });
});
