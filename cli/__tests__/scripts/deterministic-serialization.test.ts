import fs from 'fs';
import os from 'os';
import path from 'path';

const {createArtifactSboms} = require('../../scripts/release/artifact-sbom') as Record<string, any>;
const {createCheckpoint} = require('../../scripts/release/checkpoint') as Record<string, any>;
const {renderAdapters} = require('../../scripts/release/renderers') as Record<string, any>;

const commit = 'a'.repeat(40);
const source = {version: '1.2.3', tag: 'v1.2.3', commit};

describe('locale-independent release serialization', () => {
  it('orders checkpoint paths and SBOM identities by UTF-8 bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-byte-order-'));
    try {
      fs.writeFileSync(path.join(root, 'a.txt'), 'a');
      fs.writeFileSync(path.join(root, 'B.txt'), 'upper');
      const checkpoint = createCheckpoint(source, {
        root,
        outputDir: path.join(root, 'checkpoint'),
        files: ['a.txt', 'B.txt'],
        timestamp: '2026-08-19T00:00:00.000Z',
        producer: {
          provider: 'github-actions',
          repository: 'ntanwir10/GuardScan',
          workflow: '.github/workflows/release-train.yml',
          runId: '1',
          runAttempt: 1,
          sourceRef: 'refs/tags/v1.2.3',
        },
      });
      expect(checkpoint.sidecar.files.map((file: Record<string, string>) => file.path))
        .toEqual(['B.txt', 'a.txt']);

      const sboms = createArtifactSboms({
        ...source,
        createdAt: '2026-08-19T00:00:00.000Z',
        platformId: 'linux-x64-glibc',
        nodeVersion: '22.23.1',
        executable: {filename: 'guardscan', sha256: 'b'.repeat(64)},
        components: [
          {name: 'a', version: '1', type: 'library', purl: 'pkg:generic/a@1'},
          {name: 'B', version: '1', type: 'library', purl: 'pkg:generic/b@1'},
        ],
      });
      expect(sboms.spdx.packages.map((component: Record<string, string>) => component.name))
        .toEqual(['B', 'a', 'guardscan', 'node']);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('orders rendered wheel filenames by UTF-8 bytes', () => {
    const wheel = (id: string, filename: string) => ({
      id,
      kind: 'python-wheel',
      filename,
      size: 1,
      sha256: id.repeat(64).slice(0, 64),
      platform: {os: 'linux', arch: 'x64', libc: 'glibc'},
      embeddedStandaloneId: 'binary:linux-x64-glibc',
      embeddedExecutableSha256: 'b'.repeat(64),
      provenance: {
        type: 'slsa',
        url: `https://github.com/ntanwir10/GuardScan/attestations/${id}`,
        verified: true,
      },
    });
    const rendered = renderAdapters({
      ...source,
      artifacts: [wheel('c', 'a.whl'), wheel('d', 'B.whl')],
    }, 'pypi');
    const publication = JSON.parse(rendered.files['pypi/publication.json']);
    expect(publication.wheels.map((value: Record<string, string>) => value.filename))
      .toEqual(['B.whl', 'a.whl']);
  });
});
