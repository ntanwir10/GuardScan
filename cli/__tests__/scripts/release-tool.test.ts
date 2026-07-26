import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  assertDocumentMatchesSource,
  assertStateReferencesManifest,
  createInitialState,
  createPlan,
  prepareRelease,
  summarizeState,
  validateSource,
} = require('../../scripts/release/lib') as {
  assertDocumentMatchesSource: (
    kind: string,
    document: Record<string, unknown>,
    source: Record<string, string>
  ) => void;
  assertStateReferencesManifest: (
    state: Record<string, unknown>,
    manifest: Record<string, unknown>
  ) => void;
  createPlan: (source: Record<string, string>, profile?: string) => Record<string, unknown>;
  createInitialState: (
    source: Record<string, string>,
    profile: string,
    timestamp: string
  ) => Record<string, unknown>;
  prepareRelease: (
    source: Record<string, string>,
    options: Record<string, string>
  ) => {created: boolean; outputDir: string};
  summarizeState: (state: Record<string, unknown>) => Record<string, unknown>;
  validateSource: (options: Record<string, string>) => Record<string, string>;
};
const {
  classifyNpmRemote,
  verifyNpmArtifact,
} = require('../../scripts/release/npm-artifact') as {
  classifyNpmRemote: (
    artifact: Record<string, unknown>,
    remoteIntegrity?: string
  ) => Record<string, boolean>;
  verifyNpmArtifact: (
    source: Record<string, string>,
    outputDir: string
  ) => Record<string, unknown>;
};
const {
  transitionState,
  writeStateTransition,
} = require('../../scripts/release/ledger') as {
  transitionState: (
    state: Record<string, any>,
    options: Record<string, any>
  ) => {changed: boolean; state: Record<string, any>};
  writeStateTransition: (
    stateFile: string,
    originalState: Record<string, any>,
    nextState: Record<string, any>
  ) => void;
};

const COMMIT = 'a'.repeat(40);
let root: string;
let packageRoot: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-release-tool-'));
  packageRoot = path.join(root, 'cli');
  fs.mkdirSync(packageRoot);
  writeJson('package.json', {
    name: 'guardscan',
    version: '1.2.3',
    engines: {node: '>=22.0.0'},
  });
  writeJson('package-lock.json', {
    name: 'guardscan',
    version: '1.2.3',
    packages: {'': {name: 'guardscan', version: '1.2.3', engines: {node: '>=22.0.0'}}},
  });
  fs.writeFileSync(path.join(packageRoot, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.3] - 2026-07-20\n');
});

afterEach(() => {
  fs.rmSync(root, {recursive: true, force: true});
});

describe('release source validation', () => {
  it('normalizes one version, tag, commit, and runtime contract', () => {
    expect(validateSource({packageRoot, repositoryRoot: root, commit: COMMIT, tag: 'v1.2.3'})).toMatchObject({
      packageName: 'guardscan',
      version: '1.2.3',
      tag: 'v1.2.3',
      commit: COMMIT,
      nodeRange: '>=22.0.0',
    });
  });

  it('rejects drift between package, lockfile, changelog, tag, and Node floor', () => {
    writeJson('package-lock.json', {
      name: 'guardscan',
      version: '1.2.2',
      packages: {'': {name: 'guardscan', version: '1.2.2', engines: {node: '>=18.0.0'}}},
    });
    expect(() => validateSource({
      packageRoot,
      repositoryRoot: root,
      commit: COMMIT,
      tag: 'v9.9.9',
    })).toThrow(/package-lock\.json version does not match|tag v9\.9\.9 does not match/);
  });

  it('rejects malformed source identities', () => {
    expect(() => validateSource({packageRoot, repositoryRoot: root, commit: 'not-a-sha'}))
      .toThrow(/commit must be a 40-character lowercase git SHA/);
  });
});

describe('release planning and state summaries', () => {
  it('creates a deterministic phased plan without activating deferred channels', () => {
    const source = validateSource({packageRoot, repositoryRoot: root, commit: COMMIT});
    const first = createPlan(source, 'node');
    const second = createPlan(source, 'node');
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 'guardscan.release-plan.v1',
      version: '1.2.3',
      tag: 'v1.2.3',
      profile: 'node',
    });
    const channels = first.channels as Array<{id: string; status: string}>;
    expect(channels.find(channel => channel.id === 'npm')?.status).toBe('planned');
    expect(channels.find(channel => channel.id === 'github')?.status).toBe('deferred');
    expect(channels.find(channel => channel.id === 'pypi')?.status).toBe('deferred');
  });

  it('reports failed and remaining channels without treating them as complete', () => {
    expect(summarizeState({
      schemaVersion: 'guardscan.release-state.v1',
      version: '1.2.3',
      tag: 'v1.2.3',
      commit: COMMIT,
      channels: {
        npm: {status: 'verified'},
        github: {status: 'failed'},
        pypi: {status: 'planned'},
        homebrew: {status: 'skipped'},
      },
    })).toMatchObject({
      verifiedChannels: ['npm'],
      failedChannels: ['github'],
      remainingChannels: ['github', 'pypi'],
    });
  });

  it('creates publication state only for channels active in the selected phase', () => {
    const source = validateSource({packageRoot, repositoryRoot: root, commit: COMMIT});
    const state = createInitialState(source, 'native', '2026-07-20T12:00:00.000Z') as {
      channels: Record<string, unknown>;
    };
    expect(Object.keys(state.channels)).toEqual(['npm', 'github']);
  });

  it('prepares one atomic ledger and treats an identical retry as a no-op', () => {
    const source = validateSource({packageRoot, repositoryRoot: root, commit: COMMIT});
    const outputDir = path.join(root, 'evidence', 'v1.2.3');
    const options = {outputDir, profile: 'node', timestamp: '2026-07-20T12:00:00.000Z'};
    expect(prepareRelease(source, options).created).toBe(true);
    expect(prepareRelease(source, options).created).toBe(false);
    expect(fs.readdirSync(outputDir).sort()).toEqual(['release-plan.json', 'release-state.json']);

    fs.writeFileSync(path.join(outputDir, 'release-plan.json'), '{}\n');
    expect(() => prepareRelease(source, options)).toThrow(/conflicts with existing release-plan\.json/);
  });

  it('rejects release documents that drift from source or reference unknown artifacts', () => {
    const source = validateSource({packageRoot, repositoryRoot: root, commit: COMMIT});
    expect(() => assertDocumentMatchesSource('manifest', {
      version: '1.2.4', tag: 'v1.2.4', commit: COMMIT,
    }, source)).toThrow(/manifest version does not match/);

    expect(() => assertStateReferencesManifest({
      channels: {npm: {artifactIds: ['npm:missing']}},
    }, {
      artifacts: [{id: 'npm:guardscan@1.2.3'}],
    })).toThrow(/references unknown artifact/);
  });

  it('verifies immutable npm artifact handoffs and classifies idempotent registry retries', () => {
    const source = validateSource({packageRoot, repositoryRoot: root, commit: COMMIT});
    const outputDir = path.join(root, 'npm-artifact');
    fs.mkdirSync(outputDir);
    const filename = 'guardscan-1.2.3.tgz';
    const tarball = Buffer.from('synthetic packed artifact');
    fs.writeFileSync(path.join(outputDir, filename), tarball);
    const integrity = `sha512-${crypto.createHash('sha512').update(tarball).digest('base64')}`;
    const metadata = {
      schemaVersion: 'guardscan.npm-artifact.v1',
      packageName: 'guardscan',
      version: '1.2.3',
      tag: 'v1.2.3',
      commit: COMMIT,
      createdAt: '2026-07-20T12:00:00.000Z',
      filename,
      size: tarball.length,
      sha256: crypto.createHash('sha256').update(tarball).digest('hex'),
      integrity,
    };
    fs.writeFileSync(path.join(outputDir, 'npm-artifact.json'), `${JSON.stringify(metadata)}\n`);

    expect(verifyNpmArtifact(source, outputDir)).toMatchObject(metadata);
    expect(classifyNpmRemote(metadata, undefined)).toMatchObject({publishRequired: true});
    expect(classifyNpmRemote(metadata, integrity)).toMatchObject({
      exists: true,
      matching: true,
      publishRequired: false,
    });
    expect(() => classifyNpmRemote(metadata, `sha512-${'x'.repeat(86)}==`))
      .toThrow(/different integrity/);

    fs.appendFileSync(path.join(outputDir, filename), 'tampered');
    expect(() => verifyNpmArtifact(source, outputDir)).toThrow(/does not match metadata/);
  });
});

describe('release publication ledger transitions', () => {
  const timestamp = '2026-07-20T12:00:00.000Z';
  const transitionTimestamp = '2026-07-20T12:01:00.000Z';
  const digest = 'b'.repeat(64);

  function state(): Record<string, any> {
    return {
      schemaVersion: 'guardscan.release-state.v1',
      version: '1.2.3',
      tag: 'v1.2.3',
      commit: COMMIT,
      updatedAt: timestamp,
      channels: {
        npm: {status: 'planned', artifactIds: [], updatedAt: timestamp},
      },
    };
  }

  function approval(): Record<string, any> {
    return {
      schemaVersion: 'guardscan.release-approval.v1',
      version: '1.2.3',
      tag: 'v1.2.3',
      commit: COMMIT,
      manifestSha256: digest,
      scope: 'stable-promotion',
      channels: ['npm'],
      approvedAt: timestamp,
      evidence: {
        provider: 'github-actions',
        repository: 'ntanwir10/GuardScan',
        environment: 'stable-promotion',
        runId: '12345',
        actor: 'release-maintainer',
      },
    };
  }

  it('requires exact expected state and promotion approval before publication', () => {
    const input = state();
    expect(() => transitionState(input, {
      channel: 'npm',
      expectedStatus: 'planned',
      targetStatus: 'published',
      timestamp: transitionTimestamp,
      manifestSha256: digest,
      artifactIds: ['npm:guardscan@1.2.3'],
      remoteIdentity: 'guardscan@1.2.3',
    })).toThrow(/requires stable-promotion approval/);

    const result = transitionState(input, {
      channel: 'npm',
      expectedStatus: 'planned',
      targetStatus: 'published',
      timestamp: transitionTimestamp,
      manifestSha256: digest,
      artifactIds: ['npm:guardscan@1.2.3'],
      remoteIdentity: 'guardscan@1.2.3',
      approval: approval(),
    });
    expect(result).toMatchObject({
      changed: true,
      state: {
        manifestSha256: digest,
        channels: {
          npm: {
            status: 'published',
            artifactIds: ['npm:guardscan@1.2.3'],
            remoteIdentity: 'guardscan@1.2.3',
          },
        },
      },
    });
    expect(transitionState(result.state, {
      channel: 'npm',
      expectedStatus: 'planned',
      targetStatus: 'published',
      timestamp: transitionTimestamp,
      manifestSha256: digest,
      artifactIds: ['npm:guardscan@1.2.3'],
      remoteIdentity: 'guardscan@1.2.3',
      approval: approval(),
    })).toMatchObject({changed: false});
    expect(() => transitionState(result.state, {
      channel: 'npm',
      expectedStatus: 'planned',
      targetStatus: 'published',
      timestamp: transitionTimestamp,
      manifestSha256: digest,
      artifactIds: ['npm:guardscan@1.2.3'],
      remoteIdentity: 'guardscan@1.2.3',
    })).toThrow(/requires stable-promotion approval/);
  });

  it('rejects stale, expired, cross-manifest, and backward transitions', () => {
    const expired = approval();
    expired.expiresAt = '2026-07-20T12:00:30.000Z';
    expect(() => transitionState(state(), {
      channel: 'npm',
      expectedStatus: 'planned',
      targetStatus: 'published',
      timestamp: transitionTimestamp,
      manifestSha256: digest,
      artifactIds: ['npm:guardscan@1.2.3'],
      remoteIdentity: 'guardscan@1.2.3',
      approval: expired,
    })).toThrow(/expired/);

    const tested = state();
    tested.channels.npm.status = 'tested';
    expect(() => transitionState(tested, {
      channel: 'npm',
      expectedStatus: 'tested',
      targetStatus: 'built',
      timestamp: transitionTimestamp,
      manifestSha256: digest,
    })).toThrow(/cannot move backward/);

    const wrongManifest = approval();
    wrongManifest.manifestSha256 = 'c'.repeat(64);
    expect(() => transitionState(state(), {
      channel: 'npm',
      expectedStatus: 'planned',
      targetStatus: 'published',
      timestamp: transitionTimestamp,
      manifestSha256: digest,
      artifactIds: ['npm:guardscan@1.2.3'],
      remoteIdentity: 'guardscan@1.2.3',
      approval: wrongManifest,
    })).toThrow(/exact release manifest/);
  });

  it('atomically writes a transition and rejects a concurrent source change', () => {
    const stateFile = path.join(root, 'release-state.json');
    const original = state();
    fs.writeFileSync(stateFile, `${JSON.stringify(original, null, 2)}\n`);
    const transitioned = transitionState(original, {
      channel: 'npm',
      expectedStatus: 'planned',
      targetStatus: 'tested',
      timestamp: transitionTimestamp,
      manifestSha256: digest,
      artifactIds: ['npm:guardscan@1.2.3'],
    }).state;
    writeStateTransition(stateFile, original, transitioned);
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8'))).toEqual(transitioned);

    fs.writeFileSync(stateFile, `${JSON.stringify({...original, updatedAt: transitionTimestamp}, null, 2)}\n`);
    expect(() => writeStateTransition(stateFile, original, transitioned)).toThrow(/changed after validation/);
  });
});

function writeJson(name: string, value: unknown): void {
  fs.writeFileSync(path.join(packageRoot, name), `${JSON.stringify(value, null, 2)}\n`);
}
