import crypto from 'crypto';
import {execFileSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

const {
  appendEvent,
  createEvent,
  materializeReleaseState,
  readEvents,
} = require('../../scripts/release/events') as {
  appendEvent: (file: string, input: Record<string, any>) => Record<string, any>;
  createEvent: (
    input: Record<string, any>,
    previous?: Record<string, any>
  ) => Record<string, any>;
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
  createPublicationEvidence,
} = require('../../scripts/release/publication-evidence') as {
  createPublicationEvidence: (input: Record<string, any>) => Record<string, any>;
};
const {
  handlePublication,
  main,
} = require('../../scripts/release/index') as {
  handlePublication: (
    command: string,
    source: Record<string, any>,
    manifest: Record<string, any>,
    options: Record<string, any>
  ) => Record<string, any>;
  main: (argv: string[]) => Promise<void>;
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
  planFirstReleaseWithdrawal,
  planRollback,
  reconcileRelease,
} = require('../../scripts/release/reconcile') as {
  planFirstReleaseWithdrawal: (
    state: Record<string, any>,
    authority: Record<string, any>
  ) => Record<string, any>;
  planRollback: (
    state: Record<string, any>,
    knownGoodVersion?: string,
    knownGoodCommit?: string
  ) => Record<string, any>;
  reconcileRelease: (state: Record<string, any>) => Record<string, any>;
};
const {
  assertFirstReleaseWithdrawal,
  prepareFirstReleaseCatalogWithdrawal,
} = require('../../scripts/release/first-release-withdrawal') as {
  assertFirstReleaseWithdrawal: (
    ledgerRoot: string,
    defectiveVersion: string,
    ledgerCommit: string
  ) => Record<string, any>;
  prepareFirstReleaseCatalogWithdrawal: (
    catalogRoot: string,
    defectiveVersion: string,
    defectiveCommit: string
  ) => Record<string, any>;
};
const {releaseTrainChannels} = require('../../scripts/release/lib') as {
  releaseTrainChannels: (
    channel: string,
    options?: {homebrewCoreEnabled?: boolean}
  ) => string[];
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
const workflowSha = 'f'.repeat(40);

function attestation(subjectSha256: string, name: string): Record<string, any> {
  return {
    type: 'slsa',
    url: `https://github.com/ntanwir10/GuardScan/releases/download/${source.tag}/${name}.provenance.sigstore.json`,
    verified: true,
    sha256: 'e'.repeat(64),
    subjectSha256,
    sourceVersion: source.version,
    sourceTag: source.tag,
    sourceCommit: source.commit,
    signerIdentity: 'https://github.com/ntanwir10/GuardScan/.github/workflows/release-build.yml',
    signerDigest: workflowSha,
    predicateType: 'https://slsa.dev/provenance/v1',
  };
}

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
    payload: type === 'train_started' ? {channels: ['npm']} : {},
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
    provenance: attestation(digest.repeat(64), suffix),
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
    provenance: attestation(digest.repeat(64), `wheel-${digest}`),
  };
}

describe('append-only release train', () => {
  it('canonicalizes provider files with the same code-point ordering used by release workflows', () => {
    const files = {
      'guardscan-linux-x64.tar.gz': 'c'.repeat(64),
      'SHA256SUMS.sigstore.json': 'b'.repeat(64),
      SHA256SUMS: 'a'.repeat(64),
    };
    const evidence = createPublicationEvidence({
      channel: 'github',
      version: source.version,
      tag: source.tag,
      remoteIdentity: `github:ntanwir10/GuardScan/releases/tag/${source.tag}`,
      files,
    });
    expect(Object.keys(evidence.files)).toEqual(Object.keys(files).sort());
    expect(createPublicationEvidence({...evidence, files: {...files}})).toEqual(evidence);
  });

  it('requires exact provider evidence for primary publication events and the CLI', () => {
    const first = createEvent(eventInput('train_started', 0, {
      payload: {channels: ['npm']},
    }));
    const artifact = {
      id: `npm:guardscan@${source.version}`,
      kind: 'npm-tarball',
      filename: `guardscan-${source.version}.tgz`,
      sha256: 'b'.repeat(64),
    };
    const remoteIdentity = `npm:guardscan@${source.version}`;
    expect(() => createEvent(eventInput('channel_published', 1, {
      channel: 'npm',
      payload: {remoteIdentity, remoteDigest: artifact.sha256},
    }), first)).toThrow(/requires provider-bound file evidence/);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-publication-evidence-'));
    const ledger = path.join(root, 'ledger.jsonl');
    const evidenceFile = path.join(root, 'npm-publication-evidence.json');
    try {
      fs.writeFileSync(ledger, `${JSON.stringify(first)}\n`);
      const publication = createPublicationEvidence({
        channel: 'npm',
        version: source.version,
        tag: source.tag,
        remoteIdentity,
        files: {[artifact.filename]: artifact.sha256},
      });
      fs.writeFileSync(evidenceFile, `${JSON.stringify(publication, null, 2)}\n`);
      const options = {
        manifest: path.join(root, 'release-manifest.json'),
        ledger,
        channel: 'npm',
        artifactId: artifact.id,
        remoteIdentity,
        remoteDigest: publication.aggregateSha256,
        timestamp: eventInput('channel_published', 1).timestamp,
        idempotencyKey: 'published:npm:test',
      };
      expect(() => handlePublication('publish', source, {artifacts: [artifact]}, options))
        .toThrow(/requires --publication-evidence/);
      expect(handlePublication('publish', source, {artifacts: [artifact]}, {
        ...options,
        publicationEvidence: evidenceFile,
      }).event.payload.publication).toEqual(publication);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('rejects unknown train channels and terminal or backward channel transitions', () => {
    expect(() => createEvent(eventInput('train_started', 0, {
      payload: {channels: ['npm', 'npm']},
    }))).toThrow(/non-empty unique supported channel list/);
    expect(() => createEvent(eventInput('train_started', 0, {
      payload: {channels: ['unknown']},
    }))).toThrow(/non-empty unique supported channel list/);

    const first = createEvent(eventInput('train_started', 0, {
      payload: {channels: ['npm']},
    }));
    const publication = createPublicationEvidence({
      channel: 'npm',
      version: source.version,
      tag: source.tag,
      remoteIdentity: `npm:guardscan@${source.version}`,
      files: {[`guardscan-${source.version}.tgz`]: 'b'.repeat(64)},
    });
    const publishedInput = eventInput('channel_published', 1, {
      channel: 'npm',
      payload: {
        remoteIdentity: publication.remoteIdentity,
        remoteDigest: publication.aggregateSha256,
        publication,
      },
    });
    const published = createEvent(publishedInput, first);
    const verified = createEvent(eventInput('channel_verified', 2, {
      channel: 'npm',
    }), published);
    const regression = createEvent(eventInput('channel_published', 3, {
      channel: 'npm',
      payload: publishedInput.payload,
    }), verified);
    expect(() => materializeReleaseState([first, published, verified, regression]))
      .toThrow(/cannot move npm from verified to published/);

    const superseded = createEvent(eventInput('superseded', 3, {
      channel: 'npm',
    }), verified);
    const reopened = createEvent(eventInput('channel_published', 4, {
      channel: 'npm',
      payload: publishedInput.payload,
    }), superseded);
    expect(() => materializeReleaseState([first, published, verified, superseded, reopened]))
      .toThrow(/cannot move npm from superseded to published/);

    const catalogStarted = createEvent(eventInput('train_started', 0, {
      payload: {channels: ['homebrew']},
    }));
    const catalogVerified = createEvent(eventInput('channel_verified', 1, {
      channel: 'homebrew',
    }), catalogStarted);
    expect(materializeReleaseState([catalogStarted, catalogVerified]).channels.homebrew.status)
      .toBe('verified');
  });

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
          publication: createPublicationEvidence({
            channel: 'npm',
            version: source.version,
            tag: source.tag,
            remoteIdentity: 'guardscan@1.2.0-rc.1',
            files: {'guardscan-1.2.0-rc.1.tgz': 'b'.repeat(64)},
          }),
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
          mode: 'known-good',
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
        payload: {
          artifactIds: published.payload.artifactIds,
          remoteIdentity: published.payload.remoteIdentity,
          remoteDigest: published.payload.remoteDigest,
        },
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
            publication: expect.objectContaining({
              schemaVersion: 'guardscan.provider-publication.v1',
              aggregateSha256: 'b'.repeat(64),
            }),
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

      const firstRelease = {
        ...rollbackInput,
        version: '1.2.0',
        tag: 'v1.2.0',
        channels: {
          npm: {...rollbackInput.channels.npm, status: 'verified'},
          homebrew: {status: 'verified'},
          scoop: {status: 'verified'},
        },
      };
      const firstReleaseAuthority = {
        schemaVersion: 'guardscan.first-release-withdrawal-authority.v1',
        verified: true,
        defectiveVersion: '1.2.0',
        defectiveTag: 'v1.2.0',
        defectiveCommit: commit,
        ledgerCommit: 'c'.repeat(40),
        priorCompleteStableVersions: [],
      };
      expect(planFirstReleaseWithdrawal(firstRelease, firstReleaseAuthority)).toMatchObject({
        schemaVersion: 'guardscan.rollback-plan.v1',
        mode: 'first-release-withdrawal',
        requiredNextVersion: '1.2.1',
        authority: {
          ledgerCommit: 'c'.repeat(40),
          priorCompleteStableVersions: [],
        },
        repositoryActions: expect.arrayContaining([
          expect.objectContaining({id: 'open-recovery-incident'}),
          expect.objectContaining({id: 'shared-catalog-withdrawal'}),
          expect.objectContaining({id: 'deactivate-train'}),
        ]),
        actions: expect.arrayContaining([
          expect.objectContaining({
            channel: 'npm',
            action: 'deprecate-defective-release',
            automation: 'external-action-required',
          }),
          expect.objectContaining({
            channel: 'homebrew',
            action: 'remove-first-release-listing',
            automation: 'repository-automated',
          }),
        ]),
      });
      expect(planFirstReleaseWithdrawal(firstRelease, firstReleaseAuthority))
        .not.toHaveProperty('knownGood');
      expect(planFirstReleaseWithdrawal(firstRelease, firstReleaseAuthority))
        .not.toHaveProperty('forwardFixBranch');
      expect(() => planFirstReleaseWithdrawal(firstRelease, {
        ...firstReleaseAuthority,
        priorCompleteStableVersions: ['1.1.9'],
      })).toThrow(/requires exact protected-ledger authority/);
      expect(() => planFirstReleaseWithdrawal(rollbackInput, firstReleaseAuthority))
        .toThrow(/requires a stable defective release/);
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

  it('permits first-release withdrawal only without a verified stable predecessor', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-first-withdrawal-'));
    const eventsRoot = path.join(root, 'events');
    fs.mkdirSync(eventsRoot);
    const stableEvent = (
      version: string,
      type: string,
      sequence: number,
      overrides: Record<string, any> = {}
    ) => eventInput(type, sequence, {
      version,
      tag: `v${version}`,
      ...overrides,
    });
    try {
      const defectiveLedger = path.join(eventsRoot, 'v1.2.0.jsonl');
      const stableChannels = releaseTrainChannels('stable');
      appendEvent(defectiveLedger, stableEvent('1.2.0', 'train_started', 0, {
        payload: {channels: stableChannels},
      }));
      fs.writeFileSync(path.join(root, 'active-versions.json'), `${JSON.stringify({
        schemaVersion: 'guardscan.active-trains.v1',
        trains: [{version: '1.2.0', releasePr: 32, channel: 'stable'}],
      })}\n`);
      expect(assertFirstReleaseWithdrawal(root, '1.2.0', 'd'.repeat(40))).toEqual({
        schemaVersion: 'guardscan.first-release-withdrawal-authority.v1',
        verified: true,
        defectiveVersion: '1.2.0',
        defectiveTag: 'v1.2.0',
        defectiveCommit: commit,
        ledgerCommit: 'd'.repeat(40),
        priorCompleteStableVersions: [],
        alreadyCompleted: false,
      });
      appendEvent(defectiveLedger, stableEvent('1.2.0', 'rollback_started', 1, {
        payload: {mode: 'first-release-withdrawal', requiredNextVersion: '1.2.1'},
      }));
      let sequence = 2;
      for (const channel of stableChannels) {
        appendEvent(defectiveLedger, stableEvent('1.2.0', 'withdrawn', sequence, {
          channel,
          payload: {artifactIds: []},
        }));
        sequence += 1;
      }
      appendEvent(defectiveLedger, stableEvent('1.2.0', 'rollback_repository_completed', sequence, {
        payload: {
          schemaVersion: 'guardscan.rollback-repository-evidence.v1',
          mode: 'first-release-withdrawal',
          defectiveVersion: '1.2.0',
          requiredNextVersion: '1.2.1',
          externalActionsPending: [],
          catalog: {
            state: 'already-absent',
            branch: 'rollback/v1.2.0-remove-first-release',
            pullRequest: 0,
            commit: 'd'.repeat(40),
          },
          completedAt: new Date(Date.parse(timestamp) + sequence * 60_000).toISOString(),
        },
      }));
      fs.writeFileSync(path.join(root, 'active-versions.json'), `${JSON.stringify({
        schemaVersion: 'guardscan.active-trains.v1',
        trains: [],
      })}\n`);
      expect(assertFirstReleaseWithdrawal(root, '1.2.0', 'd'.repeat(40))).toMatchObject({
        alreadyCompleted: true,
      });
      fs.writeFileSync(path.join(root, 'active-versions.json'), `${JSON.stringify({
        schemaVersion: 'guardscan.active-trains.v1',
        trains: [{version: '1.2.0', releasePr: 32, channel: 'stable'}],
      })}\n`);
      expect(() => assertFirstReleaseWithdrawal(root, '1.2.0', 'd'.repeat(40)))
        .toThrow(/not an active protected train/);
      fs.writeFileSync(path.join(root, 'active-versions.json'), `${JSON.stringify({
        schemaVersion: 'guardscan.active-trains.v1',
        trains: [],
      })}\n`);

      const laterLedger = path.join(eventsRoot, 'v1.2.1.jsonl');
      appendEvent(laterLedger, stableEvent('1.2.1', 'train_started', 0, {
        payload: {channels: ['pnpm']},
      }));
      appendEvent(laterLedger, stableEvent('1.2.1', 'channel_verified', 1, {
        channel: 'pnpm',
      }));
      expect(assertFirstReleaseWithdrawal(root, '1.2.0', 'd'.repeat(40))).toMatchObject({
        alreadyCompleted: true,
      });

      const priorLedger = path.join(eventsRoot, 'v1.1.9.jsonl');
      appendEvent(priorLedger, stableEvent('1.1.9', 'train_started', 0, {
        payload: {channels: ['pnpm']},
      }));
      appendEvent(priorLedger, stableEvent('1.1.9', 'channel_verified', 1, {
        channel: 'pnpm',
      }));
      expect(() => assertFirstReleaseWithdrawal(root, '1.2.0', 'd'.repeat(40)))
        .toThrow(/verified stable predecessors exist \(1.1.9\)/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('removes only a complete catalog projection for the defective first release', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-catalog-withdrawal-'));
    try {
      fs.mkdirSync(path.join(root, 'Formula'));
      fs.mkdirSync(path.join(root, 'bucket'));
      const formula = 'class Guardscan < Formula\n  version "1.2.0"\nend\n';
      const scoop = `${JSON.stringify({version: '1.2.0'})}\n`;
      fs.writeFileSync(path.join(root, 'Formula/guardscan.rb'), formula);
      fs.writeFileSync(path.join(root, 'bucket/guardscan.json'), scoop);
      const lock = {
        schemaVersion: 'guardscan.channel-catalog.v1',
        source: {
          repository: 'ntanwir10/GuardScan',
          version: '1.2.0',
          tag: 'v1.2.0',
          commit,
          manifestUrl: 'https://github.com/ntanwir10/GuardScan/releases/download/v1.2.0/release-manifest.json',
          manifestSha256: 'f'.repeat(64),
        },
        generator: {repository: 'ntanwir10/GuardScan', commit},
        files: {
          'Formula/guardscan.rb': {
            sha256: crypto.createHash('sha256').update(formula).digest('hex'),
          },
          'bucket/guardscan.json': {
            sha256: crypto.createHash('sha256').update(scoop).digest('hex'),
          },
        },
      };
      fs.writeFileSync(path.join(root, 'channel-lock.json'), `${JSON.stringify({
        ...lock,
        files: {
          ...lock.files,
          'Formula/guardscan.rb': {sha256: '0'.repeat(64)},
        },
      })}\n`);
      expect(() => prepareFirstReleaseCatalogWithdrawal(root, '1.2.0', commit))
        .toThrow(/does not exactly identify/);
      fs.writeFileSync(path.join(root, 'channel-lock.json'), `${JSON.stringify(lock)}\n`);
      expect(prepareFirstReleaseCatalogWithdrawal(root, '1.2.0', commit)).toEqual({
        changed: true,
        state: 'removed',
        removed: [
          'Formula/guardscan.rb',
          'bucket/guardscan.json',
          'channel-lock.json',
        ],
      });
      expect(prepareFirstReleaseCatalogWithdrawal(root, '1.2.0', commit))
        .toEqual({changed: false, state: 'already-absent', removed: []});
      fs.writeFileSync(path.join(root, 'channel-lock.json'), '{}\n');
      expect(() => prepareFirstReleaseCatalogWithdrawal(root, '1.2.0', commit))
        .toThrow(/catalog is partial/);
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

  it('rejects conflicting recovery starts and malformed withdrawal completion evidence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-recovery-conflict-'));
    const ledger = path.join(root, 'ledger.jsonl');
    const stable = (type: string, sequence: number, overrides: Record<string, any> = {}) => (
      eventInput(type, sequence, {
        version: '1.2.0',
        tag: 'v1.2.0',
        ...overrides,
      })
    );
    try {
      appendEvent(ledger, stable('train_started', 0, {
        payload: {channels: ['npm']},
      }));
      appendEvent(ledger, stable('rollback_started', 1, {
        payload: {mode: 'first-release-withdrawal', requiredNextVersion: '1.2.1'},
      }));
      appendEvent(ledger, stable('rollback_started', 2, {
        payload: {
          mode: 'known-good',
          knownGoodVersion: '1.1.9',
          knownGoodCommit: 'b'.repeat(40),
          forwardFixVersion: '1.2.1',
          forwardFixBranch: 'release/forward-fix-v1.2.1-from-v1.1.9',
        },
      }));
      expect(() => materializeReleaseState(readEvents(ledger)))
        .toThrow(/recovery cannot be started more than once/);

      const invalidLedger = path.join(root, 'invalid.jsonl');
      appendEvent(invalidLedger, stable('train_started', 0, {
        payload: {channels: ['npm']},
      }));
      appendEvent(invalidLedger, stable('rollback_started', 1, {
        payload: {mode: 'first-release-withdrawal', requiredNextVersion: '1.2.1'},
      }));
      expect(() => appendEvent(invalidLedger, stable('rollback_repository_completed', 2, {
        payload: {
          schemaVersion: 'guardscan.rollback-repository-evidence.v1',
          mode: 'first-release-withdrawal',
          defectiveVersion: '1.2.0',
          requiredNextVersion: '1.2.1',
          externalActionsPending: [],
          catalog: {
            state: 'already-absent',
            branch: 'rollback/v1.2.0-remove-first-release',
            pullRequest: 9,
            commit: 'd'.repeat(40),
          },
          completedAt: new Date(Date.parse(timestamp) + 2 * 60_000).toISOString(),
        },
      }))).toThrow(/first-release rollback repository evidence is invalid/);

      const legacyLedger = path.join(root, 'legacy.jsonl');
      appendEvent(legacyLedger, stable('train_started', 0, {
        payload: {channels: ['npm']},
      }));
      appendEvent(legacyLedger, stable('rollback_started', 1, {
        payload: {
          knownGoodVersion: '1.1.9',
          knownGoodCommit: 'b'.repeat(40),
          forwardFixVersion: '1.2.1',
          forwardFixBranch: 'release/forward-fix-v1.2.1-from-v1.1.9',
        },
      }));
      expect(materializeReleaseState(readEvents(legacyLedger)).recovery.mode)
        .toBe('known-good');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('runs first-release withdrawal through the CLI idempotently', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-withdrawal-cli-'));
    const ledger = path.join(root, 'ledger.jsonl');
    const authorityFile = path.join(root, 'authority.json');
    const repositoryRoot = path.resolve(__dirname, '../../..');
    const packageRoot = path.join(repositoryRoot, 'cli');
    const actualCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim();
    const cliSource = {
      version: '1.1.0',
      tag: 'v1.1.0',
      commit: actualCommit,
    };
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      appendEvent(ledger, {
        ...cliSource,
        timestamp,
        type: 'train_started',
        idempotencyKey: 'train:v1.1.0',
        payload: {channels: ['npm', 'homebrew']},
      });
      fs.writeFileSync(authorityFile, `${JSON.stringify({
        schemaVersion: 'guardscan.first-release-withdrawal-authority.v1',
        verified: true,
        defectiveVersion: '1.1.0',
        defectiveTag: 'v1.1.0',
        defectiveCommit: actualCommit,
        ledgerCommit: 'c'.repeat(40),
        priorCompleteStableVersions: [],
      })}\n`);
      const args = [
        'rollback',
        '--package-root', packageRoot,
        '--repository-root', repositoryRoot,
        '--commit', actualCommit,
        '--tag', 'v1.1.0',
        '--ledger', ledger,
        '--timestamp', '2026-07-20T00:01:00.000Z',
        '--idempotency-key', 'rollback:1.1.0',
        '--first-release-withdrawal',
        '--first-release-authority', authorityFile,
      ];
      await main(args);
      const first = readEvents(ledger);
      await main(args);
      expect(readEvents(ledger)).toEqual(first);
      expect(materializeReleaseState(first)).toMatchObject({
        recovery: {
          status: 'started',
          mode: 'first-release-withdrawal',
          requiredNextVersion: '1.1.1',
        },
        incidents: {
          'first-release-withdrawal-v1.1.0': {
            kind: 'recovery',
            status: 'open',
          },
        },
      });
    } finally {
      stdout.mockRestore();
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('models moderated rejection, correction, and resubmission without losing provider identity', () => {
    const wingetEvidence = (
      state: string,
      pullRequest: number,
      providerCommit: string,
      digestCharacter: string,
      reason?: string
    ) => {
      const files = {
        'NaumanTanwir.GuardScan.installer.yaml': digestCharacter.repeat(64),
        'NaumanTanwir.GuardScan.locale.en-US.yaml': digestCharacter.repeat(64),
        'NaumanTanwir.GuardScan.yaml': digestCharacter.repeat(64),
      };
      const digestInput = Object.keys(files).sort()
        .map(name => `${name}\0${files[name as keyof typeof files]}\n`).join('');
      const remoteDigest = crypto.createHash('sha256').update(digestInput).digest('hex');
      const providerPath = `manifests/n/NaumanTanwir/GuardScan/${source.version}`;
      return {
        schemaVersion: 'guardscan.moderated-submission.v1',
        channel: 'winget',
        version: source.version,
        tag: source.tag,
        state,
        packageIdentity: `NaumanTanwir.GuardScan@${source.version}`,
        remoteIdentity: `github:microsoft/winget-pkgs/pull/${pullRequest}@${providerCommit}#${providerPath}`,
        remoteDigest,
        files,
        provider: {
          repository: 'microsoft/winget-pkgs',
          path: providerPath,
          pullRequest,
          commit: providerCommit,
          publicBytesVerified: false,
          pendingStateQuery: 'digest-bound open pull request, then protected release ledger',
        },
        ...(reason ? {reason} : {}),
      };
    };
    const first = eventInput('train_started', 0, {
      payload: {channels: ['winget']},
    });
    const submittedEvidence = wingetEvidence('submitted', 42, 'b'.repeat(40), 'c');
    const submitted = eventInput('channel_submitted', 1, {
      channel: 'winget',
      payload: {
        artifactIds: ['standalone:windows-x64'],
        remoteIdentity: submittedEvidence.remoteIdentity,
        remoteDigest: submittedEvidence.remoteDigest,
        submission: submittedEvidence,
      },
    });
    const rejectionReason = 'provider pull request closed without merge';
    const rejectedEvidence = {
      ...submittedEvidence,
      state: 'rejected',
      reason: rejectionReason,
    };
    const rejected = eventInput('channel_rejected', 2, {
      channel: 'winget',
      payload: {
        artifactIds: ['standalone:windows-x64'],
        remoteIdentity: submitted.payload.remoteIdentity,
        remoteDigest: submitted.payload.remoteDigest,
        reason: rejectionReason,
        submission: rejectedEvidence,
      },
    });
    const correctedEvidence = wingetEvidence('corrected', 42, 'd'.repeat(40), 'e');
    const corrected = eventInput('channel_corrected', 3, {
      channel: 'winget',
      payload: {
        artifactIds: ['standalone:windows-x64'],
        remoteIdentity: correctedEvidence.remoteIdentity,
        remoteDigest: correctedEvidence.remoteDigest,
        submission: correctedEvidence,
      },
    });
    const resubmittedEvidence = wingetEvidence('resubmitted', 43, 'f'.repeat(40), 'e');
    const resubmitted = eventInput('channel_resubmitted', 4, {
      channel: 'winget',
      payload: {
        artifactIds: ['standalone:windows-x64'],
        remoteIdentity: resubmittedEvidence.remoteIdentity,
        remoteDigest: resubmittedEvidence.remoteDigest,
        submission: resubmittedEvidence,
      },
    });
    const events = [createEvent(first)];
    for (const input of [submitted, rejected, corrected, resubmitted]) {
      events.push(createEvent(input, events.at(-1)));
    }
    const state = materializeReleaseState(events);
    expect(state.channels.winget).toMatchObject({
      status: 'resubmitted',
      remoteIdentity: resubmitted.payload.remoteIdentity,
      remoteDigest: resubmitted.payload.remoteDigest,
      submission: resubmittedEvidence,
    });
    expect(reconcileRelease(state)).toMatchObject({
      complete: false,
      actions: [{
        channel: 'winget',
        required: true,
        currentStatus: 'resubmitted',
        action: 'poll-resubmission',
      }],
    });
    expect(() => materializeReleaseState([events[0], events[1], createEvent(
      eventInput('channel_resubmitted', 2, {
        channel: 'winget',
        payload: {
          artifactIds: ['standalone:windows-x64'],
          remoteIdentity: resubmittedEvidence.remoteIdentity,
          remoteDigest: resubmittedEvidence.remoteDigest,
          submission: resubmittedEvidence,
        },
      }),
      events[1]
    )])).toThrow(/cannot move winget from submitted to resubmitted/);
  });
});

describe('promotion policy and remote idempotency', () => {
  function decisionInput(): Record<string, any> {
    const channels = ['npm', 'pnpm', 'yarn', 'bun', 'github', 'homebrew', 'scoop', 'pypi'];
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
        sourcePrBase: 'd'.repeat(40),
        sourcePrTree: 'e'.repeat(40),
      },
      currentSourcePrHead: commit,
      currentSourcePrBase: 'd'.repeat(40),
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
    changed.currentSourcePrBase = 'f'.repeat(40);
    changed.incidents = [{incidentId: 'incident-1', kind: 'integrity', status: 'open'}];
    expect(createPromotionDecision(changed)).toMatchObject({
      eligible: false,
      result: 'denied',
      reasons: expect.arrayContaining([
        'source_pr_head_changed',
        'source_pr_base_changed',
        'active_release_incident',
      ]),
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
        workflowSha,
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
        workflow: '.github/workflows/release-build.yml',
        workflowSha,
        runId: '123456',
        runAttempt: 1,
        sourceRef: source.tag,
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
