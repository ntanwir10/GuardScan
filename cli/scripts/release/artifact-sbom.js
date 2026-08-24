'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {compareUtf8} = require('./deterministic');

const SBOM_SCHEMA = 'guardscan.artifact-sbom.v1';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function uuidFrom(value) {
  const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function componentPurl(name, version) {
  return `pkg:generic/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function createArtifactSboms(input) {
  const timestamp = new Date(input.createdAt);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== input.createdAt) {
    throw new Error('artifact SBOM createdAt must be a canonical ISO timestamp');
  }
  if (!/^[a-f0-9]{64}$/.test(input.executable.sha256 || '')) {
    throw new Error('artifact SBOM executable digest is invalid');
  }
  const components = [
    {
      name: 'node',
      version: input.nodeVersion,
      type: 'runtime',
      purl: componentPurl('node', input.nodeVersion),
    },
    {
      name: 'guardscan',
      version: input.version,
      type: 'application',
      purl: `pkg:npm/guardscan@${encodeURIComponent(input.version)}`,
    },
    ...(input.components || []),
  ].sort((a, b) => compareUtf8(`${a.name}@${a.version}`, `${b.name}@${b.version}`));
  const namespaceSeed = `${input.commit}\0${input.platformId}\0${input.executable.sha256}`;
  const spdxPackages = components.map(component => ({
    name: component.name,
    SPDXID: `SPDXRef-Package-${crypto.createHash('sha256')
      .update(`${component.name}@${component.version}`).digest('hex').slice(0, 16)}`,
    versionInfo: component.version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
    externalRefs: [{
      referenceCategory: 'PACKAGE-MANAGER',
      referenceType: 'purl',
      referenceLocator: component.purl,
    }],
  }));
  const spdx = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `guardscan-${input.version}-${input.platformId}`,
    documentNamespace: `https://guardscancli.com/spdx/artifact/${sha256(Buffer.from(namespaceSeed))}`,
    creationInfo: {
      created: input.createdAt,
      creators: [`Tool: GuardScan-release-${input.version}`],
    },
    packages: spdxPackages,
    files: [{
      fileName: `./${input.executable.filename}`,
      SPDXID: 'SPDXRef-File-GuardScanExecutable',
      checksums: [{algorithm: 'SHA256', checksumValue: input.executable.sha256}],
      licenseConcluded: 'NOASSERTION',
      copyrightText: 'NOASSERTION',
    }],
    relationships: [
      ...spdxPackages.map(value => ({
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
        relatedSpdxElement: value.SPDXID,
      })),
      {
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
        relatedSpdxElement: 'SPDXRef-File-GuardScanExecutable',
      },
    ],
  };
  const rootRef = `urn:guardscan:artifact:${input.platformId}:${input.executable.sha256}`;
  const cycloneComponents = components.map(component => ({
    type: component.type === 'application' ? 'application' : 'library',
    'bom-ref': component.purl,
    name: component.name,
    version: component.version,
    purl: component.purl,
    scope: 'required',
    hashes: component.name === 'guardscan'
      ? [{alg: 'SHA-256', content: input.executable.sha256}]
      : undefined,
  })).map(component => {
    if (!component.hashes) delete component.hashes;
    return component;
  });
  const cyclonedx = {
    $schema: 'https://cyclonedx.org/schema/bom-1.7.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.7',
    serialNumber: `urn:uuid:${uuidFrom(namespaceSeed)}`,
    version: 1,
    metadata: {
      timestamp: input.createdAt,
      tools: {components: [{type: 'application', name: 'GuardScan release', version: input.version}]},
      component: {
        type: 'application',
        name: `guardscan-${input.platformId}`,
        version: input.version,
        'bom-ref': rootRef,
        hashes: [{alg: 'SHA-256', content: input.executable.sha256}],
      },
    },
    components: cycloneComponents,
    dependencies: [
      {ref: rootRef, dependsOn: cycloneComponents.map(component => component['bom-ref'])},
      ...cycloneComponents.map(component => ({ref: component['bom-ref'], dependsOn: []})),
    ],
  };
  return {spdx, cyclonedx};
}

function writeArtifactSboms(input, outputDir) {
  const documents = createArtifactSboms(input);
  const resolved = path.resolve(outputDir);
  fs.mkdirSync(resolved, {recursive: true, mode: 0o700});
  const files = [];
  for (const [format, document] of Object.entries(documents)) {
    const filename = `guardscan-${input.version}-${input.platformId}.${format}.json`;
    const contents = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
    fs.writeFileSync(path.join(resolved, filename), contents, {mode: 0o600, flag: 'wx'});
    files.push({format, filename, size: contents.length, sha256: sha256(contents)});
  }
  const metadata = {
    schemaVersion: SBOM_SCHEMA,
    version: input.version,
    tag: input.tag,
    commit: input.commit,
    platformId: input.platformId,
    executableSha256: input.executable.sha256,
    files,
  };
  fs.writeFileSync(path.join(resolved, 'artifact-sbom.json'), `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  return {outputDir: resolved, metadata};
}

module.exports = {SBOM_SCHEMA, createArtifactSboms, writeArtifactSboms};
