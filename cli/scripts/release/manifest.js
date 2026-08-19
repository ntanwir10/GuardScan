'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  assertDocumentMatchesSource,
  readBounded,
  readJson,
  validateDocument,
} = require('./lib');
const {canonicalJson} = require('./events');
const {compareUtf8} = require('./deterministic');
const {assertVerifiedAttestation} = require('./provenance');

const MANIFEST_SCHEMA = 'guardscan.release-manifest.v1';
const INPUT_SCHEMA = 'guardscan.release-manifest-input.v1';
const REQUIRED_NATIVE_TARGETS = Object.freeze([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64-glibc',
  'linux-x64-glibc',
  'windows-x64',
]);
const REQUIRED_SIGNATURE = Object.freeze({
  darwin: ['apple-code-signing', 'apple-notarization'],
  linux: ['sigstore'],
  windows: ['authenticode'],
});

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertPrivateRegularFile(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1) {
    throw new Error(`${label} must be a private regular file`);
  }
}

function canonicalTimestamp(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function platformId(platform) {
  return [platform?.os, platform?.arch, platform?.libc].filter(Boolean).join('-');
}

function assertHttps(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an HTTPS URL`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`${label} must be an HTTPS URL without credentials`);
  }
}

function assertDigest(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error(`${label} SHA-256 is invalid`);
}

function assertArtifactSource(source, artifact) {
  if (!artifact.source || typeof artifact.source !== 'object') {
    throw new Error(`artifact has no source identity: ${artifact.id}`);
  }
  for (const field of ['version', 'tag', 'commit']) {
    if (artifact.source[field] !== source[field]) {
      throw new Error(`artifact ${artifact.id} source ${field} does not match the release`);
    }
  }
}

function assertEvidenceCollection(values, label, artifactId) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${artifactId} has no ${label} evidence`);
  }
  const types = new Set();
  for (const evidence of values) {
    if (!evidence || typeof evidence !== 'object' || typeof evidence.type !== 'string') {
      throw new Error(`${artifactId} has invalid ${label} evidence`);
    }
    if (types.has(evidence.type)) throw new Error(`${artifactId} has duplicate ${label} type ${evidence.type}`);
    types.add(evidence.type);
    assertHttps(evidence.url, `${artifactId} ${label}`);
    if (evidence.sha256) assertDigest(evidence.sha256, `${artifactId} ${label}`);
    if (evidence.verified !== true) throw new Error(`${artifactId} ${label} evidence is not verified`);
  }
  return types;
}

function assertArtifactProvenance(source, producer, artifact) {
  return assertVerifiedAttestation(artifact.provenance, {
    artifactSha256: artifact.sha256,
    source,
    signerDigest: producer.workflowSha,
  }, `${artifact.id} provenance`);
}

function assertStandaloneArtifact(source, producer, artifact) {
  if (artifact.productionReady !== true) {
    throw new Error(`standalone artifact is not production ready: ${artifact.id}`);
  }
  const target = platformId(artifact.platform);
  if (!REQUIRED_NATIVE_TARGETS.includes(target)) {
    throw new Error(`standalone artifact has unsupported target ${target}: ${artifact.id}`);
  }
  const expectedFormat = artifact.platform.os === 'windows' ? 'zip' : 'tar.gz';
  const expectedEntrypoint = artifact.platform.os === 'windows' ? 'guardscan.exe' : 'guardscan';
  if (artifact.archiveFormat !== expectedFormat || artifact.entrypoint !== expectedEntrypoint) {
    throw new Error(`standalone artifact archive contract is invalid: ${artifact.id}`);
  }
  const expectedUrl = `https://github.com/ntanwir10/GuardScan/releases/download/${source.tag}/${artifact.filename}`;
  if (artifact.url !== expectedUrl) {
    throw new Error(`standalone artifact URL is not immutable and canonical: ${artifact.id}`);
  }
  if (!Array.isArray(artifact.archiveEntries) || artifact.archiveEntries.length < 1
      || !artifact.archiveEntries.some(entry => entry.path === expectedEntrypoint)) {
    throw new Error(`standalone artifact archive inventory is incomplete: ${artifact.id}`);
  }
  for (const entry of artifact.archiveEntries) {
    assertDigest(entry.sha256, `${artifact.id} archive entry`);
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0) {
      throw new Error(`${artifact.id} archive entry size is invalid`);
    }
  }
  const signatures = assertEvidenceCollection(artifact.signatures, 'signature', artifact.id);
  for (const required of REQUIRED_SIGNATURE[artifact.platform.os]) {
    if (!signatures.has(required)) throw new Error(`${artifact.id} lacks required ${required} evidence`);
  }
  const sbomFormats = assertEvidenceCollection(artifact.sboms, 'SBOM', artifact.id);
  for (const required of ['spdx', 'cyclonedx']) {
    if (!sbomFormats.has(required)) throw new Error(`${artifact.id} lacks required ${required} SBOM`);
  }
  assertArtifactProvenance(source, producer, artifact);
  if (artifact.capabilities?.coreScan !== true || artifact.capabilities?.sbom !== true
      || artifact.capabilities?.chartRendering !== false
      || artifact.capabilities?.accurateTokenCounting !== false) {
    throw new Error(`${artifact.id} standalone capability profile is invalid`);
  }
}

function assertArtifact(source, producer, artifact) {
  if (!artifact || typeof artifact !== 'object' || typeof artifact.id !== 'string') {
    throw new Error('artifact metadata is invalid');
  }
  assertArtifactSource(source, artifact);
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
    throw new Error(`artifact size is invalid: ${artifact.id}`);
  }
  assertDigest(artifact.sha256, artifact.id);
  if (artifact.url) assertHttps(artifact.url, `${artifact.id} URL`);
  if (artifact.kind === 'standalone') assertStandaloneArtifact(source, producer, artifact);
  if (artifact.kind === 'npm-tarball') {
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(artifact.integrity || '')) {
      throw new Error(`npm tarball integrity is invalid: ${artifact.id}`);
    }
    assertArtifactProvenance(source, producer, artifact);
  }
  if (artifact.kind === 'python-wheel') {
    if (!artifact.platform || !artifact.embeddedStandaloneId) {
      throw new Error(`python wheel is not bound to a standalone artifact: ${artifact.id}`);
    }
    assertDigest(artifact.embeddedExecutableSha256, `${artifact.id} embedded executable`);
    assertArtifactProvenance(source, producer, artifact);
  }
  return artifact;
}

function createReleaseManifest(source, input) {
  if (input.schemaVersion !== INPUT_SCHEMA) {
    throw new Error(`manifest input schema must be ${INPUT_SCHEMA}`);
  }
  canonicalTimestamp(input.createdAt, 'manifest createdAt');
  if (!input.producer || input.producer.provider !== 'github-actions'
      || input.producer.repository !== 'ntanwir10/GuardScan'
      || !/^[a-f0-9]{40}$/.test(input.producer.workflowSha || '')) {
    throw new Error('manifest producer must be the GuardScan GitHub Actions release workflow');
  }
  if (!input.toolchain || !input.toolchain.node || !input.toolchain.packageManager
      || !Array.isArray(input.toolchain.tools) || input.toolchain.tools.length === 0) {
    throw new Error('manifest toolchain identity is incomplete');
  }
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) {
    throw new Error('manifest input contains no artifacts');
  }
  const artifacts = input.artifacts.map(artifact => assertArtifact(source, input.producer, artifact));
  const ids = new Set();
  const filenames = new Set();
  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) throw new Error(`duplicate artifact id: ${artifact.id}`);
    if (filenames.has(artifact.filename)) throw new Error(`duplicate artifact filename: ${artifact.filename}`);
    ids.add(artifact.id);
    filenames.add(artifact.filename);
  }
  if (input.profile === 'full') {
    const targets = artifacts
      .filter(artifact => artifact.kind === 'standalone')
      .map(artifact => platformId(artifact.platform))
      .sort(compareUtf8);
    if (targets.join('\n') !== [...REQUIRED_NATIVE_TARGETS].sort(compareUtf8).join('\n')) {
      throw new Error(`full release requires exact native target matrix: ${REQUIRED_NATIVE_TARGETS.join(', ')}`);
    }
    const wheelTargets = artifacts
      .filter(artifact => artifact.kind === 'python-wheel')
      .map(artifact => platformId(artifact.platform))
      .sort(compareUtf8);
    if (wheelTargets.join('\n') !== [...REQUIRED_NATIVE_TARGETS].sort(compareUtf8).join('\n')) {
      throw new Error('full release requires one Python wheel for every native target');
    }
  }
  for (const wheel of artifacts.filter(artifact => artifact.kind === 'python-wheel')) {
    const embedded = artifacts.find(artifact => artifact.id === wheel.embeddedStandaloneId);
    if (!embedded || embedded.kind !== 'standalone') {
      throw new Error(`python wheel references an unknown standalone: ${wheel.id}`);
    }
    const executable = embedded.archiveEntries.find(entry => entry.path === embedded.entrypoint);
    if (wheel.embeddedExecutableSha256 !== executable?.sha256
        || platformId(wheel.platform) !== platformId(embedded.platform)) {
      throw new Error(`python wheel embedded executable does not match its standalone: ${wheel.id}`);
    }
  }
  return {
    schemaVersion: MANIFEST_SCHEMA,
    version: source.version,
    tag: source.tag,
    commit: source.commit,
    createdAt: input.createdAt,
    producer: input.producer,
    toolchain: input.toolchain,
    artifacts: artifacts.sort((a, b) => compareUtf8(a.id, b.id)),
  };
}

function loadManifestInput(source, descriptorFile) {
  const descriptor = readJson(path.resolve(descriptorFile), 'release manifest input');
  if (!Array.isArray(descriptor.artifactFiles)) {
    throw new Error('release manifest input artifactFiles must be an array');
  }
  const base = path.dirname(path.resolve(descriptorFile));
  const artifacts = descriptor.artifactFiles.map(relative => {
    if (path.isAbsolute(relative)) throw new Error('manifest artifact metadata paths must be relative');
    const resolved = path.resolve(base, relative);
    if (!resolved.startsWith(`${base}${path.sep}`)) throw new Error('manifest artifact metadata path escapes its root');
    const metadata = readJson(resolved, 'artifact metadata');
    assertDocumentMatchesSource('artifact metadata', metadata, source);
    return metadata.artifact;
  });
  return {...descriptor, artifacts};
}

function writeReleaseManifest(source, descriptorFile, outputFile) {
  const manifest = createReleaseManifest(source, loadManifestInput(source, descriptorFile));
  const resolved = path.resolve(outputFile);
  const contents = `${JSON.stringify(manifest, null, 2)}\n`;
  if (fs.existsSync(resolved)) {
    assertPrivateRegularFile(resolved, 'release manifest');
    validateDocument('manifest', resolved, source.schemaRoot || source.packageRoot);
    if (readBounded(resolved, 'release manifest') !== contents) {
      throw new Error(`release manifest conflicts with existing output: ${resolved}`);
    }
    return {created: false, manifest, sha256: sha256Text(contents), outputFile: resolved};
  }
  fs.mkdirSync(path.dirname(resolved), {recursive: true, mode: 0o700});
  const staged = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  );
  try {
    fs.writeFileSync(staged, contents, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
    assertPrivateRegularFile(staged, 'staged release manifest');
    validateDocument('manifest', staged, source.schemaRoot || source.packageRoot);
    try {
      fs.linkSync(staged, resolved);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assertPrivateRegularFile(resolved, 'release manifest');
      validateDocument('manifest', resolved, source.schemaRoot || source.packageRoot);
      if (readBounded(resolved, 'release manifest') !== contents) {
        throw new Error(`release manifest conflicts with existing output: ${resolved}`);
      }
      return {created: false, manifest, sha256: sha256Text(contents), outputFile: resolved};
    }
    fs.rmSync(staged, {force: true});
    assertPrivateRegularFile(resolved, 'release manifest');
    validateDocument('manifest', resolved, source.schemaRoot || source.packageRoot);
    return {created: true, manifest, sha256: sha256Text(contents), outputFile: resolved};
  } finally {
    fs.rmSync(staged, {force: true});
  }
}

function verifyManifestFiles(manifest, artifactRoot) {
  const resolvedRoot = path.resolve(artifactRoot);
  const verified = [];
  for (const artifact of manifest.artifacts) {
    const file = path.resolve(resolvedRoot, artifact.filename);
    if (!file.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`artifact path escapes root: ${artifact.id}`);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size !== artifact.size) throw new Error(`artifact size mismatch: ${artifact.id}`);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (digest !== artifact.sha256) throw new Error(`artifact digest mismatch: ${artifact.id}`);
    verified.push(artifact.id);
  }
  return {valid: true, verified: verified.sort(compareUtf8)};
}

module.exports = {
  INPUT_SCHEMA,
  MANIFEST_SCHEMA,
  REQUIRED_NATIVE_TARGETS,
  createReleaseManifest,
  loadManifestInput,
  platformId,
  verifyManifestFiles,
  writeReleaseManifest,
};
