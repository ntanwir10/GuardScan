'use strict';

// Called only after authenticating the original tag's signed checksum bundle.
const fs = require('fs');
const path = require('path');
const {assertDocumentMatchesSource, validateDocument, validateSource} = require('./lib');
const {verifyNpmArtifact, METADATA_SCHEMA} = require('./npm-artifact');

function restoreNpmPayload(source, manifest, payload, output) {
  assertDocumentMatchesSource('manifest', manifest, source);
  const artifacts = manifest.artifacts.filter(artifact => artifact.kind === 'npm-tarball');
  if (artifacts.length !== 1) throw new Error('Canonical payload requires exactly one npm tarball');
  const artifact = artifacts[0];
  assertDocumentMatchesSource('npm artifact', artifact.source, source);
  if (!/^[A-Za-z0-9][A-Za-z0-9._+~-]*\.tgz$/.test(artifact.filename)) {
    throw new Error('Canonical npm filename is unsafe');
  }
  const file = path.join(payload, artifact.filename);
  if (!fs.lstatSync(file).isFile()) throw new Error('Canonical npm tarball is not a regular file');
  fs.mkdirSync(output, {mode: 0o700});
  fs.copyFileSync(file, path.join(output, artifact.filename), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(output, 'npm-artifact.json'), JSON.stringify({
    schemaVersion: METADATA_SCHEMA, packageName: source.packageName,
    version: source.version, tag: source.tag, commit: source.commit,
    createdAt: manifest.createdAt, filename: artifact.filename, size: artifact.size,
    sha256: artifact.sha256, integrity: artifact.integrity,
  }, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  return verifyNpmArtifact(source, output);
}

if (require.main === module) {
  const [payload, output, tag] = process.argv.slice(2);
  const source = validateSource({tag});
  const manifest = validateDocument('manifest', path.join(payload, 'release-manifest.json'), source.packageRoot);
  restoreNpmPayload(source, manifest, payload, output);
}

module.exports = {restoreNpmPayload};
