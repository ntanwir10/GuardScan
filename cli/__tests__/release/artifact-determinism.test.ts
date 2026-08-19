import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const {
  buildArchive,
  inspectArchive,
} = require('../../scripts/release/archive');
const {compareUtf8} = require('../../scripts/release/deterministic');
const {launcherSource} = require('../../scripts/release/python-wheel');
const {finalizeWheelArtifact} = require('../../scripts/release/python-wheel');
const {createPublicationEvidence} = require('../../scripts/release/publication-evidence');
const {writeReleaseManifest} = require('../../scripts/release/manifest');

const source = {
  version: '1.1.0',
  tag: 'v1.1.0',
  commit: 'a'.repeat(40),
  packageRoot: path.resolve(__dirname, '../../'),
};
const workflowSha = 'f'.repeat(40);

function attestation(subjectSha256: string, name: string) {
  return {
    type: 'slsa',
    url: `https://github.com/ntanwir10/GuardScan/releases/download/${source.tag}/${name}.provenance.sigstore.json`,
    verified: true,
    sha256: 'd'.repeat(64),
    subjectSha256,
    sourceVersion: source.version,
    sourceTag: source.tag,
    sourceCommit: source.commit,
    signerIdentity: 'https://github.com/ntanwir10/GuardScan/.github/workflows/release-build.yml',
    signerDigest: workflowSha,
    predicateType: 'https://slsa.dev/provenance/v1',
  };
}

function writeManifestInput(root: string) {
  const artifact = {
    schemaVersion: 'guardscan.artifact-metadata.v1',
    version: source.version,
    tag: source.tag,
    commit: source.commit,
    artifact: {
      id: 'npm:guardscan',
      kind: 'npm-tarball',
      filename: 'guardscan.tgz',
      size: 1,
      sha256: 'b'.repeat(64),
      source: {
        version: source.version,
        tag: source.tag,
        commit: source.commit,
      },
      capabilities: {
        coreScan: true,
        sbom: true,
        chartRendering: true,
        accurateTokenCounting: true,
      },
      url: 'https://registry.npmjs.org/guardscan/-/guardscan.tgz',
      integrity: `sha512-${'A'.repeat(86)}==`,
      provenance: attestation('b'.repeat(64), 'npm'),
    },
  };
  fs.writeFileSync(path.join(root, 'artifact.json'), JSON.stringify(artifact));
  fs.writeFileSync(path.join(root, 'input.json'), JSON.stringify({
    schemaVersion: 'guardscan.release-manifest-input.v1',
    profile: 'node',
    createdAt: '2026-08-19T00:00:00.000Z',
    producer: {
      provider: 'github-actions',
      repository: 'ntanwir10/GuardScan',
      workflow: '.github/workflows/release-build.yml',
      workflowSha,
      runId: '1',
      runAttempt: 1,
      sourceRef: 'refs/tags/v1.1.0',
    },
    toolchain: {
      node: '22.0.0',
      packageManager: {name: 'npm', version: '10.0.0'},
      tools: [{name: 'typescript', version: '5.0.0'}],
    },
    artifactFiles: ['artifact.json'],
  }));
  return path.join(root, 'input.json');
}

describe('release artifact determinism', () => {
  it('orders serialized names by UTF-8 bytes', () => {
    const names = ['a', 'B', 'z'];
    expect([...names].sort(compareUtf8)).toEqual(['B', 'a', 'z']);
    const evidence = createPublicationEvidence({
      channel: 'github',
      version: '1.2.3',
      tag: 'v1.2.3',
      remoteIdentity: 'github:example/release',
      files: {
        'a.txt': 'a'.repeat(64),
        'B.txt': 'b'.repeat(64),
      },
    });
    expect(Object.keys(evidence.files)).toEqual(['B.txt', 'a.txt']);
  });

  it('writes ZIP regular-file type bits alongside intended modes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-zip-mode-'));
    const file = path.join(root, 'artifact.zip');
    try {
      fs.writeFileSync(file, buildArchive('zip', [
        {name: 'a', data: Buffer.from('plain'), mode: 0o755},
        {name: 'B', data: Buffer.from('exec'), mode: 0o644},
      ], '2026-08-19T00:00:00.000Z'));
      expect(inspectArchive(file, 'zip').entries.map((entry: any) => entry.mode))
        .toEqual(['0644', '0755']);
      const bytes = fs.readFileSync(file);
      const centralOffset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      expect(centralOffset).toBeGreaterThan(0);
      expect(bytes.readUInt32LE(centralOffset + 38) >>> 16).toBe(0o100644);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('uses a Python 3.9-compatible streaming digest loop', () => {
    const source = launcherSource('guardscan', 'a'.repeat(64));
    expect(source).not.toContain('file_digest');
    expect(source).toContain('hashlib.sha256()');
    expect(source).toContain('stream.read(1024 * 1024)');
  });

  it('validates a manifest before publishing its atomic output and on retry', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-manifest-'));
    const output = path.join(root, 'release-manifest.json');
    const descriptor = writeManifestInput(root);
    try {
      const first = writeReleaseManifest(source, descriptor, output);
      expect(first.created).toBe(true);
      expect(fs.existsSync(output)).toBe(true);
      fs.writeFileSync(output, '{}');
      expect(() => writeReleaseManifest(source, descriptor, output)).toThrow(/manifest is invalid/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('rejects a pre-existing manifest alias instead of trusting linked output bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-manifest-link-'));
    const output = path.join(root, 'release-manifest.json');
    const canonical = path.join(root, 'canonical-manifest.json');
    const descriptor = writeManifestInput(root);
    try {
      writeReleaseManifest(source, descriptor, output);
      fs.renameSync(output, canonical);
      fs.linkSync(canonical, output);
      expect(() => writeReleaseManifest(source, descriptor, output)).toThrow(/private regular file/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('rejects URL-only wheel provenance and requires exact attestation binding', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-wheel-provenance-'));
    const wheelMetadataFile = path.join(root, 'wheel.json');
    const standaloneMetadataFile = path.join(root, 'standalone.json');
    const outputFile = path.join(root, 'artifact.json');
    const wheelDigest = 'b'.repeat(64);
    const executableDigest = 'c'.repeat(64);
    const standalone = {
      id: 'standalone:linux-x64-glibc',
      platform: {os: 'linux', arch: 'x64', libc: 'glibc'},
      entrypoint: 'guardscan',
      archiveEntries: [{path: 'guardscan', sha256: executableDigest}],
      capabilities: {coreScan: true, sbom: true, chartRendering: false, accurateTokenCounting: false},
    };
    fs.writeFileSync(wheelMetadataFile, JSON.stringify({
      version: source.version,
      tag: source.tag,
      commit: source.commit,
      filename: 'guardscan.whl',
      size: 1,
      sha256: wheelDigest,
      platform: standalone.platform,
      embeddedExecutable: {sha256: executableDigest},
    }));
    fs.writeFileSync(standaloneMetadataFile, JSON.stringify({artifact: standalone}));
    try {
      expect(() => finalizeWheelArtifact(
        source,
        wheelMetadataFile,
        standaloneMetadataFile,
        'https://github.com/ntanwir10/GuardScan/attestations/1',
        outputFile,
      )).toThrow(/verified attestation bundle evidence/);
      expect(() => finalizeWheelArtifact(
        source,
        wheelMetadataFile,
        standaloneMetadataFile,
        {
          type: 'slsa',
          url: `https://github.com/ntanwir10/GuardScan/releases/download/${source.tag}/linux-x64-glibc.wheel.provenance.sigstore.json`,
          verified: true,
          sha256: 'd'.repeat(64),
          predicateType: 'https://slsa.dev/provenance/v1',
          subjectSha256: wheelDigest,
          sourceVersion: source.version,
          sourceTag: source.tag,
          sourceCommit: source.commit,
          signerIdentity: 'https://github.com/attacker/repository/.github/workflows/build.yml',
          signerDigest: workflowSha,
        },
        outputFile,
      )).toThrow(/protected release-build workflow/);
      const result = finalizeWheelArtifact(
        source,
        wheelMetadataFile,
        standaloneMetadataFile,
        attestation(wheelDigest, 'linux-x64-glibc.wheel'),
        outputFile,
      );
      expect(result.metadata.artifact.provenance)
        .toEqual(attestation(wheelDigest, 'linux-x64-glibc.wheel'));
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});
