'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {readJson, resolveGitTimestamp} = require('./lib');
const {compareUtf8} = require('./deterministic');

const METADATA_FILE = 'npm-artifact.json';
const METADATA_SCHEMA = 'guardscan.npm-artifact.v1';
const MAX_NPM_ARTIFACT_BYTES = 100 * 1024 * 1024;

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function assertCleanRepository(repositoryRoot) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`could not verify clean release source: ${result.stderr.trim()}`);
  if (result.stdout.trim()) throw new Error('refusing to build a release artifact from a dirty worktree');
}

function hashFile(file, algorithm) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`npm artifact is not a regular file: ${file}`);
  if (stat.size <= 0 || stat.size > MAX_NPM_ARTIFACT_BYTES) {
    throw new Error(`npm artifact size is outside the supported range: ${file}`);
  }
  const hash = crypto.createHash(algorithm);
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let offset = 0;
    while (offset < stat.size) {
      const bytes = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
      if (bytes === 0) throw new Error(`npm artifact ended before its declared size: ${file}`);
      hash.update(buffer.subarray(0, bytes));
      offset += bytes;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return {size: stat.size, digest: hash.digest(algorithm === 'sha512' ? 'base64' : 'hex')};
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  if (actual.join('\n') !== wanted.join('\n')) throw new Error(`${label} contains missing or unknown fields`);
}

function verifyNpmArtifact(source, outputDir) {
  const resolved = path.resolve(outputDir);
  const entries = fs.readdirSync(resolved, {withFileTypes: true});
  if (entries.some(entry => !entry.isFile())) throw new Error('npm artifact directory may contain regular files only');
  const metadata = readJson(path.join(resolved, METADATA_FILE), 'npm artifact metadata');
  assertExactKeys(metadata, [
    'schemaVersion', 'packageName', 'version', 'tag', 'commit', 'createdAt',
    'filename', 'size', 'sha256', 'integrity',
  ], 'npm artifact metadata');
  if (metadata.schemaVersion !== METADATA_SCHEMA) throw new Error('npm artifact metadata schema is unsupported');
  for (const field of ['packageName', 'version', 'tag', 'commit']) {
    if (metadata[field] !== source[field]) throw new Error(`npm artifact ${field} does not match release source`);
  }
  if (!Number.isFinite(Date.parse(metadata.createdAt))) throw new Error('npm artifact createdAt is invalid');
  if (!/^[A-Za-z0-9][A-Za-z0-9._+~-]*\.tgz$/.test(metadata.filename)) {
    throw new Error('npm artifact filename is unsafe');
  }
  const expectedEntries = [METADATA_FILE, metadata.filename];
  const allowedEntries = [...expectedEntries, 'npm-artifact.metadata.json'];
  const actualEntries = entries.map(entry => entry.name).sort(compareUtf8);
  if (actualEntries.some(entry => !allowedEntries.includes(entry))
      || expectedEntries.some(entry => !actualEntries.includes(entry))) {
    throw new Error('npm artifact directory contains unexpected files');
  }
  if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0) throw new Error('npm artifact size is invalid');
  if (!/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new Error('npm artifact SHA-256 is invalid');
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.integrity)) {
    throw new Error('npm artifact integrity is invalid');
  }
  const tarball = path.join(resolved, metadata.filename);
  const sha256 = hashFile(tarball, 'sha256');
  const sha512 = hashFile(tarball, 'sha512');
  if (sha256.size !== metadata.size || sha256.digest !== metadata.sha256) {
    throw new Error('npm artifact SHA-256 or size does not match metadata');
  }
  if (`sha512-${sha512.digest}` !== metadata.integrity) {
    throw new Error('npm artifact integrity does not match metadata');
  }
  return {...metadata, outputDir: resolved, tarball};
}

function buildNpmArtifact(source, outputDir, options = {}) {
  const resolved = path.resolve(outputDir);
  if (fs.existsSync(resolved)) {
    return {created: false, ...verifyNpmArtifact(source, resolved)};
  }
  if (options.requireClean !== false) assertCleanRepository(source.repositoryRoot);
  const parent = path.dirname(resolved);
  fs.mkdirSync(parent, {recursive: true, mode: 0o700});
  const stage = path.join(parent, `.${path.basename(resolved)}.tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    fs.mkdirSync(stage, {mode: 0o700});
    const result = spawnSync(options.npmCommand || npmCommand(), [
      'pack', '--json', '--pack-destination', stage,
    ], {
      cwd: source.packageRoot,
      env: {...process.env, npm_config_cache: options.npmCache || path.join(stage, '.npm-cache')},
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 300000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm pack failed: ${result.stderr.trim()}`);
    let packed;
    try {
      packed = parseNpmPackResult(result.stdout);
    } catch (error) {
      throw new Error(`npm pack did not emit valid single-artifact JSON: ${error.message}`);
    }
    if (!packed || packed.name !== source.packageName || packed.version !== source.version) {
      throw new Error('npm pack identity does not match release source');
    }
    const tarball = path.join(stage, packed.filename);
    const sha256 = hashFile(tarball, 'sha256');
    const sha512 = hashFile(tarball, 'sha512');
    const metadata = {
      schemaVersion: METADATA_SCHEMA,
      packageName: source.packageName,
      version: source.version,
      tag: source.tag,
      commit: source.commit,
      createdAt: resolveGitTimestamp(source.repositoryRoot, source.commit),
      filename: packed.filename,
      size: sha256.size,
      sha256: sha256.digest,
      integrity: `sha512-${sha512.digest}`,
    };
    if (packed.integrity && packed.integrity !== metadata.integrity) {
      throw new Error('npm pack integrity does not match the generated tarball');
    }
    fs.rmSync(path.join(stage, '.npm-cache'), {recursive: true, force: true});
    fs.writeFileSync(path.join(stage, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    });
    fs.renameSync(stage, resolved);
  } finally {
    fs.rmSync(stage, {recursive: true, force: true});
  }
  return {created: true, ...verifyNpmArtifact(source, resolved)};
}

function classifyNpmRemote(localArtifact, remoteIntegrity) {
  if (remoteIntegrity === undefined) {
    return {exists: false, matching: false, publishRequired: true};
  }
  if (remoteIntegrity !== localArtifact.integrity) {
    throw new Error(`npm already contains ${localArtifact.packageName}@${localArtifact.version} with different integrity`);
  }
  return {exists: true, matching: true, publishRequired: false};
}

function parseNpmPackResult(stdout) {
  const parsed = JSON.parse(stdout);
  const results = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? Object.values(parsed)
      : [];
  if (results.length !== 1 || !results[0] || typeof results[0] !== 'object') {
    throw new Error('unexpected pack result count');
  }
  return results[0];
}

function queryNpmRemote(localArtifact, options = {}) {
  const result = spawnSync(options.npmCommand || npmCommand(), [
    'view', `${localArtifact.packageName}@${localArtifact.version}`, 'dist.integrity', '--json',
    '--registry', 'https://registry.npmjs.org',
  ], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (/\bE404\b|404 Not Found/i.test(result.stderr)) return classifyNpmRemote(localArtifact, undefined);
    throw new Error(`npm registry preflight failed: ${result.stderr.trim()}`);
  }
  let integrity;
  try {
    integrity = JSON.parse(result.stdout);
  } catch {
    throw new Error('npm registry returned invalid integrity JSON');
  }
  if (typeof integrity !== 'string') throw new Error('npm registry returned no integrity for an existing version');
  return classifyNpmRemote(localArtifact, integrity);
}

module.exports = {
  MAX_NPM_ARTIFACT_BYTES,
  METADATA_FILE,
  METADATA_SCHEMA,
  buildNpmArtifact,
  classifyNpmRemote,
  hashFile,
  parseNpmPackResult,
  queryNpmRemote,
  verifyNpmArtifact,
};
