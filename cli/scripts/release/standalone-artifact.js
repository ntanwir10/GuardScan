'use strict';

const fs = require('fs');
const path = require('path');
const {inspectArchive, writeArchive} = require('./archive');
const {readJson} = require('./lib');
const {assertReducedCapabilityEvidence} = require('./standalone');

const ARTIFACT_METADATA_SCHEMA = 'guardscan.artifact-metadata.v1';
const EVIDENCE_SCHEMA = 'guardscan.standalone-evidence.v1';

function targetId(platform) {
  return [platform.os, platform.arch, platform.libc].filter(Boolean).join('-');
}

function assertEvidence(source, platform, evidence) {
  if (evidence.schemaVersion !== EVIDENCE_SCHEMA) {
    throw new Error(`standalone evidence schema must be ${EVIDENCE_SCHEMA}`);
  }
  for (const field of ['version', 'tag', 'commit']) {
    if (evidence[field] !== source[field]) throw new Error(`standalone evidence ${field} does not match source`);
  }
  if (targetId(evidence.platform) !== targetId(platform)) {
    throw new Error('standalone evidence platform does not match artifact target');
  }
  if (!Array.isArray(evidence.signatures) || !Array.isArray(evidence.sboms)
      || !evidence.provenance) {
    throw new Error('standalone evidence is incomplete');
  }
  assertReducedCapabilityEvidence(evidence.optionalCapabilities);
  return evidence;
}

function buildStandaloneArtifact(source, executableFile, platform, outputDir, timestamp, evidenceFile) {
  const evidence = assertEvidence(source, platform, readJson(path.resolve(evidenceFile), 'standalone evidence'));
  const executable = fs.readFileSync(path.resolve(executableFile));
  if (executable.length <= 0) throw new Error('standalone executable is empty');
  const target = targetId(platform);
  const executableName = platform.os === 'windows' ? 'guardscan.exe' : 'guardscan';
  if (path.basename(executableFile) !== executableName) {
    throw new Error(`standalone executable must be named ${executableName}`);
  }
  const format = platform.os === 'windows' ? 'zip' : 'tar.gz';
  const extension = format === 'zip' ? 'zip' : 'tar.gz';
  const filename = `guardscan-${source.version}-${target}.${extension}`;
  const resolvedOutput = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutput, {recursive: true, mode: 0o700});
  const archive = writeArchive(
    path.join(resolvedOutput, filename),
    format,
    [{name: executableName, data: executable, mode: 0o755}],
    timestamp
  );
  const inspected = inspectArchive(
    path.join(resolvedOutput, filename),
    format,
    [executableName]
  );
  if (archive.sha256 !== inspected.sha256
      || JSON.stringify(archive.entries) !== JSON.stringify(inspected.entries)) {
    throw new Error('standalone archive failed deterministic structural verification');
  }
  const artifact = {
    id: `standalone:${target}`,
    kind: 'standalone',
    productionReady: true,
    filename,
    size: archive.size,
    sha256: archive.sha256,
    source: {
      version: source.version,
      tag: source.tag,
      commit: source.commit,
    },
    capabilities: {
      coreScan: true,
      sbom: true,
      chartRendering: evidence.optionalCapabilities.chartRendering.dependencyAvailable,
      accurateTokenCounting: evidence.optionalCapabilities.tokenCounting.mode === 'accurate',
    },
    optionalCapabilities: evidence.optionalCapabilities,
    platform,
    archiveFormat: format,
    entrypoint: executableName,
    url: `https://github.com/ntanwir10/GuardScan/releases/download/${source.tag}/${filename}`,
    archiveEntries: archive.entries,
    signatures: evidence.signatures,
    sboms: evidence.sboms,
    provenance: evidence.provenance,
  };
  const metadata = {
    schemaVersion: ARTIFACT_METADATA_SCHEMA,
    version: source.version,
    tag: source.tag,
    commit: source.commit,
    createdAt: timestamp,
    artifact,
  };
  const metadataFile = path.join(resolvedOutput, `${filename}.metadata.json`);
  fs.writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  return {artifactFile: path.join(resolvedOutput, filename), metadataFile, metadata};
}

module.exports = {
  ARTIFACT_METADATA_SCHEMA,
  EVIDENCE_SCHEMA,
  buildStandaloneArtifact,
  targetId,
};
