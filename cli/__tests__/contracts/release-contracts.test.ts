import * as fs from 'fs';
import * as path from 'path';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

type JsonDocument = Record<string, unknown>;

function loadValidator(filename: string): ValidateFunction {
  const schemaPath = path.resolve(__dirname, '../../schemas', filename);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

const timestamp = '2026-07-20T14:30:00.000Z';
const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);

function makeManifest(): JsonDocument {
  const capabilities = {
    coreScan: true,
    sbom: true,
    chartRendering: false,
    accurateTokenCounting: false,
  };
  const source = {
    version: '1.2.0-rc.1+build.7',
    tag: 'v1.2.0-rc.1+build.7',
    commit,
  };

  return {
    schemaVersion: 'guardscan.release-manifest.v1',
    version: '1.2.0-rc.1+build.7',
    tag: 'v1.2.0-rc.1+build.7',
    commit,
    createdAt: timestamp,
    producer: {
      provider: 'github-actions',
      repository: 'ntanwir10/GuardScan',
      workflow: '.github/workflows/release-build.yml',
      runId: '123456789',
      runAttempt: 1,
      sourceRef: 'refs/tags/v1.2.0-rc.1',
    },
    toolchain: {
      node: '22.17.0',
      packageManager: { name: 'npm', version: '10.9.2' },
      tools: [
        { name: '@vercel/ncc', version: '0.38.3' },
        { name: 'python', version: '3.13.5' },
      ],
    },
    artifacts: [
      {
        id: 'npm:guardscan@1.2.0-rc.1',
        kind: 'npm-tarball',
        filename: 'guardscan-1.2.0-rc.1.tgz',
        size: 1024,
        sha256: digest,
        source,
        capabilities: {
          ...capabilities,
          chartRendering: true,
          accurateTokenCounting: true,
        },
        url: 'https://registry.npmjs.org/guardscan/-/guardscan-1.2.0-rc.1.tgz',
        integrity: `sha512-${'A'.repeat(86)}==`,
        provenance: {
          type: 'slsa',
          url: 'https://github.com/ntanwir10/GuardScan/attestations/1',
          sha256: 'c'.repeat(64),
          predicateType: 'https://slsa.dev/provenance/v1',
          verified: true,
        },
      },
      {
        id: 'binary:linux-x64-glibc',
        kind: 'standalone',
        productionReady: true,
        filename: 'guardscan-linux-x64.tar.gz',
        size: 2048,
        sha256: 'd'.repeat(64),
        source,
        capabilities,
        optionalCapabilities: {
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
        },
        platform: { os: 'linux', arch: 'x64', libc: 'glibc' },
        archiveFormat: 'tar.gz',
        entrypoint: 'guardscan',
        url: 'https://github.com/ntanwir10/GuardScan/releases/download/v1.2.0/guardscan-linux-x64.tar.gz',
        signatures: [{
          type: 'sigstore',
          url: 'https://github.com/ntanwir10/GuardScan/releases/download/v1.2.0/guardscan.sigstore.json',
          bundleUrl: 'https://github.com/ntanwir10/GuardScan/releases/download/v1.2.0/guardscan.bundle.json',
          verified: true,
        }],
        sboms: [
          {
            type: 'spdx',
            url: 'https://github.com/ntanwir10/GuardScan/releases/download/v1.2.0/guardscan.spdx.json',
            verified: true,
          },
          {
            type: 'cyclonedx',
            url: 'https://github.com/ntanwir10/GuardScan/releases/download/v1.2.0/guardscan.cyclonedx.json',
            verified: true,
          },
        ],
        archiveEntries: [{
          path: 'guardscan',
          size: 1024,
          mode: '0755',
          sha256: 'd'.repeat(64),
        }],
        provenance: {
          type: 'slsa',
          url: 'https://github.com/ntanwir10/GuardScan/attestations/2',
          verified: true,
        },
      },
      {
        id: 'pypi:guardscan@1.2.0rc1',
        kind: 'python-wheel',
        filename: 'guardscan-1.2.0rc1-py3-none-any.whl',
        size: 3072,
        sha256: 'e'.repeat(64),
        source,
        capabilities,
        platform: { os: 'linux', arch: 'x64', libc: 'glibc' },
        embeddedStandaloneId: 'binary:linux-x64-glibc',
        embeddedExecutableSha256: 'd'.repeat(64),
        provenance: {
          type: 'slsa',
          url: 'https://github.com/ntanwir10/GuardScan/attestations/3',
          verified: true,
        },
      },
      {
        id: 'sbom:release',
        kind: 'sbom',
        filename: 'guardscan-release.spdx.json',
        size: 4096,
        sha256: 'f'.repeat(64),
        source,
        capabilities,
      },
      {
        id: 'checksums:sha256',
        kind: 'checksum',
        filename: 'SHA256SUMS',
        size: 512,
        sha256: '0'.repeat(64),
        source,
        capabilities,
      },
    ],
  };
}

function makeState(): JsonDocument {
  return {
    schemaVersion: 'guardscan.release-state.v1',
    version: '1.2.0-rc.1+build.7',
    tag: 'v1.2.0-rc.1+build.7',
    commit,
    updatedAt: timestamp,
    manifestSha256: digest,
    channels: {
      npm: {
        status: 'verified',
        artifactIds: ['npm:guardscan@1.2.0-rc.1'],
        remoteIdentity: 'guardscan@1.2.0-rc.1',
        updatedAt: timestamp,
      },
      github: {
        status: 'uploaded',
        artifactIds: ['binary:linux-x64-glibc', 'checksums:sha256'],
        remoteIdentity: 'ntanwir10/GuardScan@v1.2.0-rc.1',
        updatedAt: timestamp,
      },
      pypi: {
        status: 'failed',
        artifactIds: ['pypi:guardscan@1.2.0rc1'],
        error: 'Trusted publishing rejected the request',
        updatedAt: timestamp,
      },
      chocolatey: {
        status: 'planned',
        artifactIds: [],
        updatedAt: timestamp,
      },
    },
  };
}

function makeApproval(): JsonDocument {
  return {
    schemaVersion: 'guardscan.release-approval.v1',
    version: '1.2.0-rc.1+build.7',
    tag: 'v1.2.0-rc.1+build.7',
    commit,
    manifestSha256: digest,
    scope: 'stable-promotion',
    channels: ['npm', 'github'],
    approvedAt: timestamp,
    expiresAt: '2026-07-20T15:30:00.000Z',
    evidence: {
      provider: 'github-actions',
      repository: 'ntanwir10/GuardScan',
      environment: 'stable-promotion',
      runId: '123456789',
      actor: 'release-maintainer',
    },
  };
}

describe('release contract schemas', () => {
  const validateApproval = loadValidator('guardscan.release-approval.v1.schema.json');
  const validateCatalog = loadValidator('guardscan.channel-catalog.v1.schema.json');
  const validateEvent = loadValidator('guardscan.release-event.v1.schema.json');
  const validateManifest = loadValidator('guardscan.release-manifest.v1.schema.json');
  const validateState = loadValidator('guardscan.release-state.v1.schema.json');

  it('accepts representative release manifest and state documents', () => {
    const manifest = makeManifest();
    const state = makeState();

    expect(validateManifest(manifest)).toBe(true);
    expect(validateManifest.errors).toBeNull();
    expect(validateState(state)).toBe(true);
    expect(validateState.errors).toBeNull();
    expect(validateApproval(makeApproval())).toBe(true);
    expect(validateApproval.errors).toBeNull();
  });

  it('binds the shared channel catalog to GuardScan source, generator, and file digests', () => {
    const catalog = {
      schemaVersion: 'guardscan.channel-catalog.v1',
      source: {
        repository: 'ntanwir10/GuardScan',
        version: '1.2.3',
        tag: 'v1.2.3',
        commit,
        manifestUrl: 'https://github.com/ntanwir10/GuardScan/releases/download/v1.2.3/release-manifest.json',
        manifestSha256: digest,
      },
      generator: {
        repository: 'ntanwir10/GuardScan',
        commit,
      },
      files: {
        'Formula/guardscan.rb': {sha256: 'c'.repeat(64)},
        'bucket/guardscan.json': {sha256: 'd'.repeat(64)},
      },
    };
    expect(validateCatalog(catalog)).toBe(true);
    expect(validateCatalog.errors).toBeNull();

    const circular = clone(catalog) as Record<string, unknown>;
    circular.catalogCommit = commit;
    expect(validateCatalog(circular)).toBe(false);

    const unknownFile = clone(catalog) as {files: Record<string, unknown>};
    unknownFile.files['unmanaged.txt'] = {sha256: 'e'.repeat(64)};
    expect(validateCatalog(unknownFile)).toBe(false);
  });

  it('models Homebrew Core as an explicit release event channel', () => {
    expect(validateEvent({
      schemaVersion: 'guardscan.release-event.v1',
      version: '1.2.3',
      tag: 'v1.2.3',
      commit,
      sequence: 2,
      previousHash: 'c'.repeat(64),
      timestamp,
      type: 'channel_submitted',
      channel: 'homebrew-core',
      idempotencyKey: 'homebrew-core:v1.2.3',
      payload: {},
      eventHash: 'd'.repeat(64),
    })).toBe(true);
  });

  it('rejects broad, malformed, and untrusted promotion approvals', () => {
    const wrongEnvironment = clone(makeApproval()) as {
      evidence: { environment: string };
    };
    wrongEnvironment.evidence.environment = 'production';
    expect(validateApproval(wrongEnvironment)).toBe(false);

    const broadChannel = clone(makeApproval()) as { channels: string[] };
    broadChannel.channels.push('all');
    expect(validateApproval(broadChannel)).toBe(false);

    const unknownField = clone(makeApproval());
    unknownField.reason = 'ship it';
    expect(validateApproval(unknownField)).toBe(false);
  });

  it('rejects malformed release identifiers and artifact digests', () => {
    const badVersion = clone(makeManifest());
    badVersion.version = '01.2.0';
    expect(validateManifest(badVersion)).toBe(false);

    const badTag = clone(makeManifest());
    badTag.tag = '1.2.0';
    expect(validateManifest(badTag)).toBe(false);

    const badCommit = clone(makeManifest());
    badCommit.commit = 'A'.repeat(40);
    expect(validateManifest(badCommit)).toBe(false);

    const badDigest = clone(makeManifest()) as { artifacts: Array<{ sha256: string }> };
    badDigest.artifacts[0].sha256 = 'ABC123';
    expect(validateManifest(badDigest)).toBe(false);
  });

  it('rejects unknown manifest fields at every modeled boundary', () => {
    const unknownTopLevel = clone(makeManifest());
    unknownTopLevel.unexpected = true;
    expect(validateManifest(unknownTopLevel)).toBe(false);

    const unknownCapability = clone(makeManifest()) as {
      artifacts: Array<{ capabilities: Record<string, unknown> }>;
    };
    unknownCapability.artifacts[0].capabilities.telemetry = true;
    expect(validateManifest(unknownCapability)).toBe(false);

    const unknownSignature = clone(makeManifest()) as {
      artifacts: Array<{ signatures?: Array<Record<string, unknown>> }>;
    };
    unknownSignature.artifacts[1].signatures![0].issuer = 'unexpected';
    expect(validateManifest(unknownSignature)).toBe(false);
  });

  it('requires observed reduced-capability evidence on standalone artifacts', () => {
    const missing = clone(makeManifest()) as {
      artifacts: Array<{optionalCapabilities?: Record<string, unknown>}>;
    };
    delete missing.artifacts[1].optionalCapabilities;
    expect(validateManifest(missing)).toBe(false);

    const inconsistent = clone(makeManifest()) as {
      artifacts: Array<{
        optionalCapabilities?: {tokenCounting: {dependencyAvailable: boolean}};
      }>;
    };
    inconsistent.artifacts[1].optionalCapabilities!.tokenCounting.dependencyAvailable = true;
    expect(validateManifest(inconsistent)).toBe(false);
  });

  it('rejects invalid state transitions, channel names, and unknown fields', () => {
    const badStatus = clone(makeState()) as {
      channels: Record<string, { status: string }>;
    };
    badStatus.channels.npm.status = 'complete';
    expect(validateState(badStatus)).toBe(false);

    const badChannel = clone(makeState()) as { channels: Record<string, unknown> };
    badChannel.channels.apt = {
      status: 'planned',
      artifactIds: [],
      updatedAt: timestamp,
    };
    expect(validateState(badChannel)).toBe(false);

    const unknownChannelField = clone(makeState()) as {
      channels: Record<string, Record<string, unknown>>;
    };
    unknownChannelField.channels.npm.attempts = 2;
    expect(validateState(unknownChannelField)).toBe(false);
  });

  it('enforces status-specific error and remote identity metadata', () => {
    const failedWithoutError = clone(makeState()) as {
      channels: Record<string, Record<string, unknown>>;
    };
    delete failedWithoutError.channels.pypi.error;
    expect(validateState(failedWithoutError)).toBe(false);

    const plannedWithError = clone(makeState()) as {
      channels: Record<string, Record<string, unknown>>;
    };
    plannedWithError.channels.chocolatey.error = 'not a failure';
    expect(validateState(plannedWithError)).toBe(false);

    const publishedWithoutIdentity = clone(makeState()) as {
      channels: Record<string, Record<string, unknown>>;
    };
    delete publishedWithoutIdentity.channels.npm.remoteIdentity;
    expect(validateState(publishedWithoutIdentity)).toBe(false);
  });
});
