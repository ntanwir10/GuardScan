import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

const {
  appendEvent,
  materializeReleaseState,
  readEvents,
} = require('../../scripts/release/events') as {
  appendEvent: (file: string, input: Record<string, any>) => Record<string, any>;
  materializeReleaseState: (events: Array<Record<string, any>>) => Record<string, any>;
  readEvents: (file: string) => Array<Record<string, any>>;
};
const {
  buildArchive,
  inspectArchive,
} = require('../../scripts/release/archive') as {
  buildArchive: (
    format: string,
    entries: Array<{name: string; data: Buffer; mode: number}>,
    timestamp: string
  ) => Buffer;
  inspectArchive: (
    file: string,
    format: string,
    expected?: string[]
  ) => Record<string, any>;
};
const {
  createPromotionDecision,
} = require('../../scripts/release/promotion') as {
  createPromotionDecision: (input: Record<string, any>) => Record<string, any>;
};
const {
  classifyRemoteArtifact,
} = require('../../scripts/release/remote') as {
  classifyRemoteArtifact: (
    local: Record<string, string>,
    remote?: Record<string, string>
  ) => Record<string, any>;
};
const {
  planRollback,
  reconcileRelease,
} = require('../../scripts/release/reconcile') as {
  planRollback: (
    state: Record<string, any>,
    knownGoodVersion?: string,
    knownGoodCommit?: string
  ) => Record<string, any>;
  reconcileRelease: (state: Record<string, any>) => Record<string, any>;
};
const {
  prepareForwardFixSource,
} = require('../../scripts/release/recovery-source') as {
  prepareForwardFixSource: (
    repositoryRoot: string,
    input: Record<string, string>
  ) => Record<string, any>;
};
const {
  createReleaseManifest,
} = require('../../scripts/release/manifest') as {
  createReleaseManifest: (
    source: Record<string, string>,
    input: Record<string, any>
  ) => Record<string, any>;
};
const {
  buildWheel,
} = require('../../scripts/release/python-wheel') as {
  buildWheel: (
    source: Record<string, string>,
    executable: string,
    platform: Record<string, string>,
    output: string,
    timestamp: string
  ) => Record<string, any>;
};

const commit = 'a'.repeat(40);
const source = {
  version: '1.2.0-rc.1',
  tag: 'v1.2.0-rc.1',
  commit,
  packageRoot: '/tmp/package',
};
const timestamp = '2026-07-20T00:00:00.000Z';

function eventInput(
  type: string,
  sequence: number,
  overrides: Record<string, any> = {}
): Record<string, any> {
  return {
    ...source,
    timestamp: new Date(Date.parse(timestamp) + sequence * 60_000).toISOString(),
    type,
    idempotencyKey: `${type}:${sequence}`,
    payload: {},
    ...overrides,
  };
}

function evidence(type: string): Record<string, any> {
  return {
    type,
    url: `https://github.com/ntanwir10/GuardScan/releases/download/${source.tag}/evidence-${type}.json`,
    sha256: 'b'.repeat(64),
    verified: true,
  };
}

function standalone(
  osName: string,
  arch: string,
  suffix: string,
  digest: string,
  libc?: string
): Record<string, any> {
  const filename = `guardscan-${source.version}-${suffix}.${osName === 'windows' ? 'zip' : 'tar.gz'}`;
  const entrypoint = osName === 'windows' ? 'guardscan.exe' : 'guardscan';
  const signatures = osName === 'darwin'
    ? [evidence('apple-code-signing'), evidence('apple-notarization')]
    : [evidence(osName === 'windows' ? 'authenticode' : 'sigstore')];
  return {
    id: `standalone:${suffix}`,
    kind: 'standalone',
    productionReady: true,
    filename,
    size: 4096,
    sha256: digest.repeat(64),
    source,
    capabilities: {
      coreScan: true,
      sbom: true,
      chartRendering: false,
      accurateTokenCounting: false,
    },
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
    platform: {os: osName, arch, ...(libc ? {libc} : {})},
    archiveFormat: osName === 'windows' ? 'zip' : 'tar.gz',
    entrypoint,
    url: `https://github.com/ntanwir10/GuardScan/releases/download/${source.tag}/${filename}`,
    archiveEntries: [{
      path: entrypoint,
      size: 2048,
      mode: '0755',
      sha256: digest.repeat(64),
    }],
    signatures,
    sboms: [evidence('spdx'), evidence('cyclonedx')],
    provenance: {
      type: 'slsa',
      url: `https://github.com/ntanwir10/GuardScan/attestations/${suffix}`,
      verified: true,
    },
  };
}

function wheel(native: Record<string, any>, digest: string): Record<string, any> {
  return {
    id: `pypi:${native.id}`,
    kind: 'python-wheel',
    filename: `${native.id.replace(/[:]/g, '-')}.whl`,
    size: 8192,
    sha256: digest.repeat(64),
    source,
    capabilities: native.capabilities,
    platform: native.platform,
    embeddedStandaloneId: native.id,
    embeddedExecutableSha256: native.archiveEntries[0].sha256,
    provenance: {
      type: 'slsa',
      url: `https://github.com/ntanwir10/GuardScan/attestations/wheel-${digest}`,
      verified: true,
    },
  };
}

describe('append-only release train', () => {
  it('prepares deterministic forward-fix source from the exact known-good tree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-forward-fix-'));
    const cli = path.join(root, 'cli');
    fs.mkdirSync(cli);
    fs.writeFileSync(path.join(cli, 'package.json'), `${JSON.stringify({
      name: 'guardscan',
      version: '1.1.9',
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(cli, 'package-lock.json'), `${JSON.stringify({
      name: 'guardscan',
      version: '1.1.9',
      lockfileVersion: 3,
      packages: {'': {name: 'guardscan', version: '1.1.9'}},
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(cli, 'CHANGELOG.md'), [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '## [1.1.9]',
      '',
      '- Known good.',
      '',
    ].join('\n'));
    try {
      const input = {
        knownGoodVersion: '1.1.9',
        defectiveVersion: '1.2.0',
        forwardFixVersion: '1.2.1',
      };
      const first = prepareForwardFixSource(root, input);
      const second = prepareForwardFixSource(root, input);
      expect(first).toMatchObject({
        changed: true,
        version: '1.2.1',
        files: ['cli/CHANGELOG.md', 'cli/package-lock.json', 'cli/package.json'],
      });
      expect(second).toMatchObject({changed: false, version: '1.2.1'});
      expect(JSON.parse(fs.readFileSync(path.join(cli, 'package.json'), 'utf8')).version)
        .toBe('1.2.1');
      expect(JSON.parse(fs.readFileSync(path.join(cli, 'package-lock.json'), 'utf8')))
        .toMatchObject({version: '1.2.1', packages: {'': {version: '1.2.1'}}});
      expect(fs.readFileSync(path.join(cli, 'CHANGELOG.md'), 'utf8'))
        .toContain('## [1.2.1]\n\n### Fixed\n\n- Restore verified v1.1.9 source');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('appends, replays, retries idempotently, and models rollback without backward mutation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-ledger-'));
    const ledger = path.join(root, 'v1.2.0-rc.1.jsonl');
    try {
      appendEvent(ledger, eventInput('train_started', 0, {
        payload: {channels: ['npm', 'github', 'winget']},
      }));
      const published = eventInput('channel_published', 1, {
        channel: 'npm',
        payload: {
          artifactIds: ['npm:guardscan@1.2.0-rc.1'],
          remoteIdentity: 'guardscan@1.2.0-rc.1',
          remoteDigest: 'b'.repeat(64),
        },
      });
      expect(appendEvent(ledger, published).changed).toBe(true);
      expect(appendEvent(ledger, published).changed).toBe(false);
      expect(() => appendEvent(ledger, {
        ...published,
        payload: {...published.payload, remoteDigest: 'c'.repeat(64)},
      })).toThrow(/idempotency key conflicts/);
      appendEvent(ledger, eventInput('channel_verified', 2, {
        channel: 'npm',
        payload: {},
      }));
      appendEvent(ledger, eventInput('rollback_started', 3, {
        payload: {
          knownGoodVersion: '1.1.9',
          knownGoodCommit: 'b'.repeat(40),
          forwardFixVersion: '1.2.1',
          forwardFixBranch: 'release/forward-fix-v1.2.1-from-v1.1.9',
        },
      }));
      appendEvent(ledger, eventInput('action_required', 4, {
        channel: 'npm',
        payload: {
          action: 'deprecate-and-forward-fix',
          authority: 'npm-maintainer',
          reason: 'GitHub OIDC trusted publishing cannot deprecate an existing npm version',
        },
      }));
      appendEvent(ledger, eventInput('superseded', 5, {
        channel: 'npm',
        payload: published.payload,
      }));

      const state = materializeReleaseState(readEvents(ledger));
      expect(state).toMatchObject({
        schemaVersion: 'guardscan.release-state.v2',
        lastSequence: 6,
        actionRequired: [{
          channel: 'npm',
          action: 'deprecate-and-forward-fix',
          authority: 'npm-maintainer',
          reason: 'GitHub OIDC trusted publishing cannot deprecate an existing npm version',
          requestedAt: '2026-07-20T00:04:00.000Z',
        }],
        channels: {
          npm: {
            status: 'superseded',
            artifactIds: ['npm:guardscan@1.2.0-rc.1'],
            remoteDigest: 'b'.repeat(64),
          },
        },
      });
      expect(reconcileRelease(state)).toMatchObject({
        complete: false,
        actions: expect.arrayContaining([
          {channel: 'github', currentStatus: 'planned', action: 'publish', required: true},
          {channel: 'winget', currentStatus: 'planned', action: 'submit', required: true},
        ]),
      });
      const rollbackInput = {
        ...state,
        channels: {
          ...state.channels,
          npm: {...state.channels.npm, status: 'verified'},
        },
      };
      expect(planRollback(rollbackInput, '1.1.9', 'b'.repeat(40))).toMatchObject({
        schemaVersion: 'guardscan.rollback-plan.v1',
        knownGood: {
          version: '1.1.9',
          tag: 'v1.1.9',
          commit: 'b'.repeat(40),
        },
        forwardFixVersion: '1.2.1',
        forwardFixBranch: 'release/forward-fix-v1.2.1-from-v1.1.9',
        repositoryActions: expect.arrayContaining([
          expect.objectContaining({id: 'deactivate-train'}),
          expect.objectContaining({id: 'forward-fix-pr'}),
          expect.objectContaining({id: 'shared-catalog-rollback'}),
        ]),
        actions: expect.arrayContaining([
          expect.objectContaining({
            channel: 'npm',
            automation: 'external-action-required',
            authority: 'npm-maintainer',
          }),
        ]),
      });
      expect(() => planRollback(rollbackInput)).toThrow(/verified known-good version is required/);
      expect(() => planRollback(rollbackInput, '1.1.9')).toThrow(/known-good commit is required/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('detects partial or tampered ledger records', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-ledger-tamper-'));
    const ledger = path.join(root, 'ledger.jsonl');
    try {
      appendEvent(ledger, eventInput('train_started', 0));
      fs.appendFileSync(ledger, '{"partial":');
      expect(() => readEvents(ledger)).toThrow(/partial final record/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('rejects malformed external recovery authority events', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-ledger-action-'));
    const ledger = path.join(root, 'ledger.jsonl');
    try {
      appendEvent(ledger, eventInput('train_started', 0, {
        payload: {channels: ['npm']},
      }));
      expect(() => appendEvent(ledger, eventInput('action_required', 1, {
        channel: 'npm',
        payload: {action: 'deprecate-and-forward-fix'},
      }))).toThrow(/action_required payload/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});

describe('promotion policy and remote idempotency', () => {
  function decisionInput(): Record<string, any> {
    const channels = ['npm', 'github', 'pypi'];
    const canaries = channels.flatMap(channel => Array.from({length: 24}, (_, index) => ({
      channel,
      status: 'passed',
      checkedAt: new Date(Date.parse(timestamp) + (index + 1) * 60 * 60 * 1000).toISOString(),
    })));
    return {
      rc: {
        ...source,
        manifestSha256: 'b'.repeat(64),
        publishedAt: timestamp,
        sourcePr: 42,
        sourcePrHead: commit,
      },
      currentSourcePrHead: commit,
      evaluatedAt: '2026-07-21T00:30:00.000Z',
      requiredChannels: channels,
      canaries,
      incidents: [],
    };
  }

  it('permits only a fully soaked unchanged RC with fresh green canaries', () => {
    expect(createPromotionDecision(decisionInput())).toMatchObject({
      eligible: true,
      result: 'permitted',
      stable: {version: '1.2.0', tag: 'v1.2.0'},
    });
    const changed = decisionInput();
    changed.currentSourcePrHead = 'c'.repeat(40);
    changed.incidents = [{incidentId: 'incident-1', kind: 'integrity', status: 'open'}];
    expect(createPromotionDecision(changed)).toMatchObject({
      eligible: false,
      result: 'denied',
      reasons: expect.arrayContaining(['source_pr_head_changed', 'active_release_incident']),
    });
  });

  it('classifies missing, identical, and conflicting remote artifacts', () => {
    const local = {sha256: 'a'.repeat(64)};
    expect(classifyRemoteArtifact(local)).toMatchObject({state: 'missing', publishRequired: true});
    expect(classifyRemoteArtifact(local, {
      identity: 'remote/1',
      sha256: local.sha256,
    })).toMatchObject({state: 'identical', matching: true});
    expect(classifyRemoteArtifact(local, {
      identity: 'remote/1',
      sha256: 'b'.repeat(64),
    })).toMatchObject({state: 'conflict', integrityIncident: true});
  });
});

describe('deterministic artifacts and manifest aggregation', () => {
  it.each(['zip', 'tar.gz'])('creates deterministic bounded %s archives', format => {
    const entries = [{name: 'guardscan', data: Buffer.from('binary'), mode: 0o755}];
    const first = buildArchive(format, entries, timestamp);
    const second = buildArchive(format, entries, timestamp);
    expect(first.equals(second)).toBe(true);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-archive-'));
    const file = path.join(root, format === 'zip' ? 'guardscan.zip' : 'guardscan.tar.gz');
    try {
      fs.writeFileSync(file, first);
      expect(inspectArchive(file, format, ['guardscan'])).toMatchObject({
        entries: [{path: 'guardscan', size: 6, mode: '0755'}],
      });
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('rejects traversal paths and tar links', () => {
    expect(() => buildArchive('zip', [
      {name: '../guardscan', data: Buffer.from('x'), mode: 0o755},
    ], timestamp)).toThrow(/unsafe/);

    const tarGz = buildArchive(
      'tar.gz',
      [{name: 'guardscan', data: Buffer.from('binary'), mode: 0o755}],
      timestamp
    );
    const tar = zlib.gunzipSync(tarGz);
    tar[156] = 0x32;
    tar.fill(0x20, 148, 156);
    const checksum = tar.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
    tar.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
    tar[154] = 0;
    tar[155] = 0x20;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-link-'));
    const file = path.join(root, 'link.tar.gz');
    try {
      fs.writeFileSync(file, zlib.gzipSync(tar, {level: 9}));
      expect(() => inspectArchive(file, 'tar.gz')).toThrow(/link or unsupported/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('requires the complete target matrix and binds every wheel to its signed executable', () => {
    const native = [
      standalone('darwin', 'arm64', 'darwin-arm64', '1'),
      standalone('darwin', 'x64', 'darwin-x64', '2'),
      standalone('linux', 'arm64', 'linux-arm64-glibc', '3', 'glibc'),
      standalone('linux', 'x64', 'linux-x64-glibc', '4', 'glibc'),
      standalone('windows', 'x64', 'windows-x64', '5'),
    ];
    const artifacts = [...native, ...native.map((artifact, index) => wheel(artifact, String(index + 5)))];
    const manifest = createReleaseManifest(source, {
      schemaVersion: 'guardscan.release-manifest-input.v1',
      profile: 'full',
      createdAt: timestamp,
      producer: {
        provider: 'github-actions',
        repository: 'ntanwir10/GuardScan',
        workflow: '.github/workflows/release-build.yml',
        runId: '123456',
        runAttempt: 1,
        sourceRef: source.tag,
      },
      toolchain: {
        node: '22.23.1',
        packageManager: {name: 'npm', version: '10.9.2'},
        tools: [{name: 'esbuild', version: '0.28.1'}],
      },
      artifacts,
    });
    expect(manifest.artifacts).toHaveLength(10);
    expect(manifest.artifacts
      .filter((artifact: Record<string, any>) => artifact.kind === 'standalone')
      .every((artifact: Record<string, any>) => (
        artifact.optionalCapabilities?.schemaVersion
          === 'guardscan.runtime-capabilities.v1'
      ))).toBe(true);
    const mismatched = JSON.parse(JSON.stringify(artifacts));
    mismatched[5].embeddedExecutableSha256 = 'f'.repeat(64);
    expect(() => createReleaseManifest(source, {
      schemaVersion: 'guardscan.release-manifest-input.v1',
      profile: 'full',
      createdAt: timestamp,
      producer: {
        provider: 'github-actions',
        repository: 'ntanwir10/GuardScan',
      },
      toolchain: {node: '22.23.1', packageManager: {}, tools: [{}]},
      artifacts: mismatched,
    })).toThrow(/embedded executable does not match/);
  });

  it('builds a deterministic platform wheel containing the exact standalone executable', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-wheel-'));
    const executable = path.join(root, 'guardscan');
    try {
      fs.writeFileSync(executable, 'signed executable');
      const first = buildWheel(
        source,
        executable,
        {os: 'linux', arch: 'x64', libc: 'glibc'},
        path.join(root, 'first'),
        timestamp
      );
      const second = buildWheel(
        source,
        executable,
        {os: 'linux', arch: 'x64', libc: 'glibc'},
        path.join(root, 'second'),
        timestamp
      );
      expect(first.metadata).toMatchObject({
        pythonVersion: '1.2.0rc1',
        wheelTag: 'py3-none-manylinux_2_28_x86_64',
        embeddedExecutable: {sha256: cryptoDigest('signed executable')},
      });
      expect(fs.readFileSync(first.wheelFile).equals(fs.readFileSync(second.wheelFile))).toBe(true);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});

function cryptoDigest(value: string): string {
  return require('crypto').createHash('sha256').update(value).digest('hex');
}
