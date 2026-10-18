import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EmbeddingChunker } from '../../src/core/embedding-chunker';

describe('EmbeddingChunker documentation boundaries', () => {
  let repository: string;
  let external: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-chunker-'));
    external = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-external-'));
    fs.mkdirSync(path.join(repository, 'docs'));
    fs.writeFileSync(path.join(repository, 'docs', 'safe.md'), 'safe repository documentation');
    fs.symlinkSync(path.join(repository, 'docs', 'safe.md'), path.join(repository, 'docs', 'alias.md'));
    fs.writeFileSync(path.join(external, 'secret.md'), 'external sensitive documentation');
    fs.symlinkSync(path.join(external, 'secret.md'), path.join(repository, 'docs', 'linked.md'));
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  });

  (process.platform === 'win32' ? it.skip : it)('includes in-root documentation but never reads documentation symlinks', async () => {
    const chunker = new EmbeddingChunker({} as any, repository);
    const result = await chunker.chunkCodebase({
      version: '1.0.0', repoId: 'fixture', rootPath: repository, totalFiles: 0, totalLoc: 0,
      lastUpdated: new Date(), files: new Map(), functions: new Map(), classes: new Map(),
      symbols: new Map(), dependencies: new Map(), metadata: {},
    } as any, { includeDocumentation: true });

    expect(result.chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'documentation', source: 'docs/safe.md' }),
    ]));
    expect(result.chunks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'docs/linked.md' }),
      expect.objectContaining({ source: 'docs/alias.md' }),
    ]));
    expect(result.chunks.map(chunk => chunk.content).join('\n')).not.toContain('external sensitive documentation');
  });
});

describe('EmbeddingChunker bounded documentation', () => {
  let repository: string;
  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-doc-chunks-'));
    fs.mkdirSync(path.join(repository, 'docs'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(repository, {recursive: true, force: true});
  });
  function chunker() {
    const index = {files: new Map(), functions: new Map(), classes: new Map()} as any;
    return new EmbeddingChunker({} as any, repository).chunkCodebase(index, {includeDocumentation: true});
  }

  it.each(['line\n'.repeat(2_000), '🔒'.repeat(3_000)])('splits long documentation into bounded chunks without losing content (%#)', async content => {
    fs.writeFileSync(path.join(repository, 'docs', 'large.md'), content);
    const result = await chunker();
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks.every(chunk => chunk.content.length <= 2_000)).toBe(true);
    expect(result.chunks.map(chunk => chunk.content.replace(/^# Documentation: docs\/large.md\n\n/, '')).join('')).toBe(content);
    expect(result.stats.documentationChunks).toBe(result.chunks.length);
  });

  it('rejects oversized documentation before embedding while retaining readable documents', async () => {
    fs.writeFileSync(path.join(repository, 'docs', 'oversized.md'), 'x'.repeat(2 * 1024 * 1024 + 1));
    fs.writeFileSync(path.join(repository, 'README.md'), 'kept documentation');
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await chunker();
    expect(result.chunks.map(chunk => chunk.source)).toEqual(['README.md']);
    expect(warning).toHaveBeenCalledWith(expect.stringMatching(/oversized.md/));
  });
});
