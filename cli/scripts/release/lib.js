'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const {spawnSync} = require('child_process');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const semver = require('semver');

const MAX_RELEASE_FILE_BYTES = 1024 * 1024;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const PROFILE_ORDER = Object.freeze({node: 0, native: 1, full: 2});
const CHANNELS = Object.freeze([
  {id: 'npm', phase: 'node', operation: 'publish', artifacts: ['npm-tarball']},
  {id: 'pnpm', phase: 'node', operation: 'verify', artifacts: ['npm-tarball']},
  {id: 'yarn', phase: 'node', operation: 'verify', artifacts: ['npm-tarball']},
  {id: 'bun', phase: 'node', operation: 'verify', artifacts: ['npm-tarball']},
  {id: 'github', phase: 'native', operation: 'publish', artifacts: ['standalone', 'checksum', 'sbom']},
  {id: 'homebrew', phase: 'full', operation: 'update-adapter', artifacts: ['standalone']},
  {id: 'scoop', phase: 'full', operation: 'update-adapter', artifacts: ['standalone']},
  {id: 'winget', phase: 'full', operation: 'submit', artifacts: ['standalone']},
  {id: 'chocolatey', phase: 'full', operation: 'publish', artifacts: ['standalone']},
  {id: 'pypi', phase: 'full', operation: 'publish', artifacts: ['python-wheel', 'standalone']},
]);

function readBounded(file, label = 'file') {
  const descriptor = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${file}`);
    if (stat.size > MAX_RELEASE_FILE_BYTES) {
      throw new Error(`${label} exceeds ${MAX_RELEASE_FILE_BYTES} bytes: ${file}`);
    }
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const bytes = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (bytes === 0) break;
      offset += bytes;
    }
    if (offset > MAX_RELEASE_FILE_BYTES) {
      throw new Error(`${label} exceeds ${MAX_RELEASE_FILE_BYTES} bytes: ${file}`);
    }
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function readJson(file, label = 'JSON file') {
  try {
    return JSON.parse(readBounded(file, label));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} is invalid JSON: ${file}`);
    throw error;
  }
}

function resolveGitCommit(repositoryRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not resolve git commit: ${result.stderr.trim()}`);
  return result.stdout.trim().toLowerCase();
}

function resolveGitTimestamp(repositoryRoot, commit) {
  const result = spawnSync('git', ['show', '-s', '--format=%cI', commit], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not resolve git timestamp: ${result.stderr.trim()}`);
  const timestamp = new Date(result.stdout.trim());
  if (!Number.isFinite(timestamp.getTime())) throw new Error('Git commit timestamp is invalid');
  return timestamp.toISOString();
}

function validateSource(options = {}) {
  const packageRoot = path.resolve(options.packageRoot || path.resolve(__dirname, '..', '..'));
  const repositoryRoot = path.resolve(options.repositoryRoot || path.resolve(packageRoot, '..'));
  const packageJson = readJson(path.join(packageRoot, 'package.json'), 'package.json');
  const packageLock = readJson(path.join(packageRoot, 'package-lock.json'), 'package-lock.json');
  const errors = [];

  if (packageJson.name !== 'guardscan') errors.push('package.json name must be guardscan');
  if (!semver.valid(packageJson.version)) errors.push('package.json version must be valid semantic version');
  if (packageLock.version !== packageJson.version) errors.push('package-lock.json version does not match package.json');
  if (packageLock.packages?.['']?.version !== packageJson.version) {
    errors.push('package-lock.json root package version does not match package.json');
  }
  if (packageJson.engines?.node !== '>=22.0.0') {
    errors.push('package.json must declare the supported Node runtime as >=22.0.0');
  }
  if (packageLock.packages?.['']?.engines?.node !== packageJson.engines?.node) {
    errors.push('package-lock.json Node engine does not match package.json');
  }

  if (semver.valid(packageJson.version)) {
    const changelog = readBounded(path.join(packageRoot, 'CHANGELOG.md'), 'CHANGELOG.md');
    const escapedVersion = packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^## \\[${escapedVersion}\\](?:\\s|$)`, 'm').test(changelog)) {
      errors.push(`CHANGELOG.md has no release section for ${packageJson.version}`);
    }
  }

  const expectedTag = `v${packageJson.version}`;
  if (options.tag && options.tag !== expectedTag) {
    errors.push(`tag ${options.tag} does not match package version ${expectedTag}`);
  }
  const commit = String(options.commit || resolveGitCommit(repositoryRoot)).toLowerCase();
  if (!COMMIT_PATTERN.test(commit)) errors.push('commit must be a 40-character lowercase git SHA');
  if (errors.length > 0) throw new Error(errors.join('\n'));

  return Object.freeze({
    packageRoot,
    repositoryRoot,
    packageName: packageJson.name,
    version: packageJson.version,
    tag: expectedTag,
    commit,
    nodeRange: packageJson.engines.node,
  });
}

function createPlan(source, profile = 'node') {
  if (!(profile in PROFILE_ORDER)) throw new Error(`Unknown release profile: ${profile}`);
  const channels = CHANNELS.map(channel => ({
    id: channel.id,
    phase: channel.phase,
    operation: channel.operation,
    artifacts: [...channel.artifacts],
    status: PROFILE_ORDER[channel.phase] <= PROFILE_ORDER[profile] ? 'planned' : 'deferred',
  }));
  const gates = [
    'source-contract',
    'source-cleanliness',
    'version-lockfile-changelog',
    'typecheck',
    'build',
    'tests',
    'coverage',
    'lint-ratchet',
    'git-diff-check',
    'audit',
    'packed-artifact-inspection',
    'package-smoke',
    'package-manager-smoke',
  ];
  if (PROFILE_ORDER[profile] >= PROFILE_ORDER.native) {
    gates.push('standalone-smoke', 'checksums', 'artifact-sbom', 'provenance', 'platform-signatures');
  }
  if (PROFILE_ORDER[profile] >= PROFILE_ORDER.full) {
    gates.push(
      'adapter-validation',
      'install-upgrade-uninstall',
      '24-hour-canaries',
      'machine-promotion-decision'
    );
  }
  return {
    schemaVersion: 'guardscan.release-plan.v1',
    version: source.version,
    tag: source.tag,
    commit: source.commit,
    profile,
    nodeRange: source.nodeRange,
    gates,
    channels,
  };
}

function createInitialState(source, profile, timestamp) {
  if (!(profile in PROFILE_ORDER)) throw new Error(`Unknown release profile: ${profile}`);
  const normalizedTimestamp = new Date(timestamp).toISOString();
  const publicationChannels = CHANNELS.filter(channel => (
    channel.operation !== 'verify' && PROFILE_ORDER[channel.phase] <= PROFILE_ORDER[profile]
  ));
  return {
    schemaVersion: 'guardscan.release-state.v1',
    version: source.version,
    tag: source.tag,
    commit: source.commit,
    updatedAt: normalizedTimestamp,
    channels: Object.fromEntries(publicationChannels.map(channel => [channel.id, {
      status: 'planned',
      artifactIds: [],
      updatedAt: normalizedTimestamp,
    }])),
  };
}

function prepareRelease(source, options = {}) {
  if (!options.outputDir) throw new Error('prepare requires an output directory');
  const profile = options.profile || 'node';
  const timestamp = options.timestamp || resolveGitTimestamp(source.repositoryRoot, source.commit);
  const plan = createPlan(source, profile);
  const state = createInitialState(source, profile, timestamp);
  const outputDir = path.resolve(options.outputDir);
  const files = {
    'release-plan.json': `${JSON.stringify(plan, null, 2)}\n`,
    'release-state.json': `${JSON.stringify(state, null, 2)}\n`,
  };

  if (fs.existsSync(outputDir)) {
    const entries = fs.readdirSync(outputDir).sort();
    if (entries.join('\n') !== Object.keys(files).sort().join('\n')) {
      throw new Error(`release output already exists with unexpected contents: ${outputDir}`);
    }
    for (const [name, contents] of Object.entries(files)) {
      if (readBounded(path.join(outputDir, name), name) !== contents) {
        throw new Error(`release output conflicts with existing ${name}`);
      }
    }
    return {created: false, outputDir, plan, state};
  }

  const parent = path.dirname(outputDir);
  fs.mkdirSync(parent, {recursive: true, mode: 0o700});
  const stage = path.join(parent, `.${path.basename(outputDir)}.tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    fs.mkdirSync(stage, {mode: 0o700});
    for (const [name, contents] of Object.entries(files)) {
      fs.writeFileSync(path.join(stage, name), contents, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    }
    fs.renameSync(stage, outputDir);
  } finally {
    fs.rmSync(stage, {recursive: true, force: true});
  }
  return {created: true, outputDir, plan, state};
}

function validateDocument(kind, file, packageRoot) {
  const document = readJson(path.resolve(file), kind);
  const schemaNames = {
    approval: 'guardscan.release-approval.v1.schema.json',
    decision: 'guardscan.promotion-decision.v1.schema.json',
    event: 'guardscan.release-event.v1.schema.json',
    manifest: 'guardscan.release-manifest.v1.schema.json',
    state: document.schemaVersion === 'guardscan.release-state.v2'
      ? 'guardscan.release-state.v2.schema.json'
      : 'guardscan.release-state.v1.schema.json',
  };
  const schemaName = schemaNames[kind];
  if (!schemaName) throw new Error(`Unknown release document kind: ${kind}`);
  const schema = readJson(path.join(packageRoot, 'schemas', schemaName), `${kind} schema`);
  const ajv = new Ajv({allErrors: true, strict: false});
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(document)) throw new Error(`${kind} is invalid: ${ajv.errorsText(validate.errors)}`);
  assertInternalDocumentIdentity(kind, document);
  return document;
}

function assertInternalDocumentIdentity(kind, document) {
  if (kind === 'decision') return;
  if (document.tag !== `v${document.version}`) {
    throw new Error(`${kind} tag does not match its version`);
  }
  if (kind !== 'manifest') return;
  const ids = new Set();
  const filenames = new Set();
  for (const artifact of document.artifacts) {
    if (ids.has(artifact.id)) throw new Error(`manifest contains duplicate artifact id: ${artifact.id}`);
    if (filenames.has(artifact.filename)) {
      throw new Error(`manifest contains duplicate artifact filename: ${artifact.filename}`);
    }
    if (['standalone', 'python-wheel'].includes(artifact.kind) && !artifact.platform) {
      throw new Error(`manifest ${artifact.kind} artifact requires platform metadata: ${artifact.id}`);
    }
    if (artifact.kind === 'standalone') {
      if (!artifact.archiveFormat || !artifact.entrypoint) {
        throw new Error(`manifest standalone artifact requires archive metadata: ${artifact.id}`);
      }
      const entrypointSegments = artifact.entrypoint.split('/');
      if (entrypointSegments.some(segment => segment === '.' || segment === '..')) {
        throw new Error(`manifest standalone entrypoint contains an unsafe path segment: ${artifact.id}`);
      }
      const expectedSuffix = artifact.archiveFormat === 'tar.gz' ? '.tar.gz' : '.zip';
      if (!artifact.filename.endsWith(expectedSuffix)) {
        throw new Error(`manifest standalone filename does not match its archive format: ${artifact.id}`);
      }
    } else if (artifact.archiveFormat || artifact.entrypoint) {
      throw new Error(`manifest archive metadata is only valid for standalone artifacts: ${artifact.id}`);
    }
    ids.add(artifact.id);
    filenames.add(artifact.filename);
  }
}

function assertDocumentMatchesSource(kind, document, source) {
  for (const field of ['version', 'tag', 'commit']) {
    if (document[field] !== source[field]) {
      throw new Error(`${kind} ${field} does not match the validated release source`);
    }
  }
}

function assertStateReferencesManifest(state, manifest) {
  const artifactIds = new Set(manifest.artifacts.map(artifact => artifact.id));
  for (const [channel, channelState] of Object.entries(state.channels)) {
    for (const artifactId of channelState.artifactIds) {
      if (!artifactIds.has(artifactId)) {
        throw new Error(`state channel ${channel} references unknown artifact: ${artifactId}`);
      }
    }
  }
}

function summarizeState(state) {
  const entries = Object.entries(state.channels || {});
  const terminal = new Set(['verified', 'skipped', 'withdrawn', 'superseded']);
  return {
    schemaVersion: state.schemaVersion,
    version: state.version,
    tag: state.tag,
    commit: state.commit,
    totalChannels: entries.length,
    verifiedChannels: entries.filter(([, value]) => value.status === 'verified').map(([id]) => id),
    failedChannels: entries.filter(([, value]) => value.status === 'failed').map(([id]) => id),
    remainingChannels: entries.filter(([, value]) => !terminal.has(value.status)).map(([id]) => id),
  };
}

module.exports = {
  CHANNELS,
  MAX_RELEASE_FILE_BYTES,
  assertDocumentMatchesSource,
  assertStateReferencesManifest,
  assertInternalDocumentIdentity,
  createInitialState,
  createPlan,
  prepareRelease,
  readBounded,
  readJson,
  resolveGitCommit,
  resolveGitTimestamp,
  summarizeState,
  validateDocument,
  validateSource,
};
