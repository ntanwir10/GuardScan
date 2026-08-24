import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  buildStandaloneArtifact,
} = require('../../scripts/release/standalone-artifact') as {
  buildStandaloneArtifact: (
    source: Record<string, string>,
    executableFile: string,
    platform: Record<string, string>,
    outputDir: string,
    timestamp: string,
    evidenceFile: string
  ) => {metadata: Record<string, any>};
};

const source = {
  version: '1.2.3',
  tag: 'v1.2.3',
  commit: 'a'.repeat(40),
};
const platform = {os: 'linux', arch: 'x64', libc: 'glibc'};
const timestamp = '2026-08-02T12:00:00.000Z';

function optionalCapabilities(): Record<string, any> {
  return {
    schemaVersion: 'guardscan.runtime-capabilities.v1',
    tokenCounting: {
      dependency: 'tiktoken',
      dependencyAvailable: false,
      mode: 'estimated',
      sampleTokenCount: 7,
      safeFallbackObserved: true,
    },
    chartRendering: {
      dependency: 'chartjs-node-canvas',
      dependencyAvailable: false,
      mode: 'unavailable',
      safeFallbackObserved: true,
    },
  };
}

function evidence(): Record<string, any> {
  return {
    schemaVersion: 'guardscan.standalone-evidence.v1',
    ...source,
    platform,
    optionalCapabilities: optionalCapabilities(),
    signatures: [{
      type: 'sigstore',
      url: `https://github.com/ntanwir10/GuardScan/releases/download/${source.tag}/linux.sigstore.json`,
      verified: true,
    }],
    sboms: [{
      type: 'spdx',
      url: `https://github.com/ntanwir10/GuardScan/releases/download/${source.tag}/guardscan.spdx.json`,
      verified: true,
    }],
    provenance: {
      type: 'slsa',
      url: 'https://github.com/ntanwir10/GuardScan/attestations/123',
      verified: true,
    },
  };
}

function withArtifact(
  descriptor: Record<string, any>,
  assertion: (result: {metadata: Record<string, any>}) => void
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-standalone-artifact-'));
  try {
    const executable = path.join(root, 'guardscan');
    const evidenceFile = path.join(root, 'evidence.json');
    fs.writeFileSync(executable, 'signed executable');
    fs.writeFileSync(evidenceFile, `${JSON.stringify(descriptor)}\n`);
    assertion(buildStandaloneArtifact(
      source,
      executable,
      platform,
      path.join(root, 'output'),
      timestamp,
      evidenceFile
    ));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

describe('production standalone artifact evidence', () => {
  it('binds observed optional capability evidence into artifact metadata', () => {
    const descriptor = evidence();

    withArtifact(descriptor, result => {
      expect(result.metadata.artifact.optionalCapabilities)
        .toEqual(descriptor.optionalCapabilities);
      expect(result.metadata.artifact.capabilities).toEqual({
        coreScan: true,
        sbom: true,
        chartRendering: false,
        accurateTokenCounting: false,
      });
    });
  });

  it('rejects standalone evidence without observed optional capability evidence', () => {
    const descriptor = evidence();
    delete descriptor.optionalCapabilities;

    expect(() => withArtifact(descriptor, () => undefined)).toThrow(
      /standalone reduced-capability contract failed/
    );
  });

  it('rejects inconsistent optional capability evidence', () => {
    const descriptor = evidence();
    descriptor.optionalCapabilities.tokenCounting.dependencyAvailable = true;

    expect(() => withArtifact(descriptor, () => undefined)).toThrow(
      /standalone reduced-capability contract failed/
    );
  });
});
