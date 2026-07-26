'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const {readJson} = require('./lib');

const RENDER_SCHEMA = 'guardscan.release-render.v1';
const MARKER_FILE = '.guardscan-release-render.json';
const CATALOG_SCHEMA = 'guardscan.channel-catalog.v1';
const CATALOG_FILES = Object.freeze([
  'Formula/guardscan.rb',
  'bucket/guardscan.json',
]);
const SUPPORTED_CHANNELS = Object.freeze([
  'homebrew',
  'homebrew-core',
  'scoop',
  'winget',
  'chocolatey',
  'pypi',
]);
const DEFAULT_CHANNELS = Object.freeze(['homebrew', 'scoop', 'winget', 'chocolatey', 'pypi']);
const MAX_RENDERED_FILES = 100;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function parseChannels(value) {
  const channels = value
    ? String(value).split(',').map(channel => channel.trim()).filter(Boolean)
    : [...DEFAULT_CHANNELS];
  if (channels.length === 0) throw new Error('at least one render channel is required');
  if (new Set(channels).size !== channels.length) throw new Error('render channels must be unique');
  for (const channel of channels) {
    if (!SUPPORTED_CHANNELS.includes(channel)) throw new Error(`unsupported render channel: ${channel}`);
  }
  return channels.sort((a, b) => SUPPORTED_CHANNELS.indexOf(a) - SUPPORTED_CHANNELS.indexOf(b));
}

function assertImmutableReleaseArtifact(manifest, artifact, expectedEntrypoint) {
  if (!artifact.url) throw new Error(`standalone artifact has no immutable URL: ${artifact.id}`);
  const expectedUrl = `https://github.com/ntanwir10/GuardScan/releases/download/${manifest.tag}/${artifact.filename}`;
  if (artifact.url !== expectedUrl) {
    throw new Error(`standalone artifact URL is not the canonical versioned release URL: ${artifact.id}`);
  }
  if (artifact.entrypoint !== expectedEntrypoint) {
    throw new Error(`standalone artifact has unexpected entrypoint ${artifact.entrypoint}: ${artifact.id}`);
  }
  if (!artifact.provenance || artifact.provenance.verified !== true
      || !isSecureUrl(artifact.provenance.url)) {
    throw new Error(`standalone artifact has no secure provenance: ${artifact.id}`);
  }
  const requiredSignatures = {
    darwin: ['apple-code-signing', 'apple-notarization'],
    linux: ['sigstore'],
    windows: ['authenticode'],
  }[artifact.platform.os];
  const signatures = new Map((artifact.signatures || []).map(signature => [signature.type, signature]));
  for (const requiredSignature of requiredSignatures) {
    const signature = signatures.get(requiredSignature);
    if (signature?.verified !== true || !isSecureUrl(signature.url)) {
      throw new Error(`standalone artifact lacks required ${requiredSignature} evidence: ${artifact.id}`);
    }
  }
  const sboms = new Set((artifact.sboms || [])
    .filter(sbom => sbom.verified === true && isSecureUrl(sbom.url))
    .map(sbom => sbom.type));
  if (!sboms.has('spdx') || !sboms.has('cyclonedx')) {
    throw new Error(`standalone artifact lacks required SBOM evidence: ${artifact.id}`);
  }
  if (artifact.capabilities?.coreScan !== true || artifact.capabilities?.sbom !== true
      || artifact.capabilities?.chartRendering !== false
      || artifact.capabilities?.accurateTokenCounting !== false) {
    throw new Error(`standalone artifact lacks required core capabilities: ${artifact.id}`);
  }
}

function isSecureUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function selectStandalone(manifest, os, arch, libc) {
  const matches = manifest.artifacts.filter(artifact => (
    artifact.kind === 'standalone'
      && artifact.platform?.os === os
      && artifact.platform?.arch === arch
      && (libc ? artifact.platform?.libc === libc : artifact.platform?.libc === undefined)
  ));
  const label = [os, arch, libc].filter(Boolean).join('-');
  if (matches.length !== 1) throw new Error(`release manifest must contain exactly one ${label} standalone artifact`);
  const artifact = matches[0];
  const expectedFormat = os === 'windows' ? 'zip' : 'tar.gz';
  if (artifact.archiveFormat !== expectedFormat) {
    throw new Error(`${label} standalone artifact must use ${expectedFormat}`);
  }
  assertImmutableReleaseArtifact(manifest, artifact, os === 'windows' ? 'guardscan.exe' : 'guardscan');
  return artifact;
}

function selectNativeArtifacts(manifest, channels) {
  const selected = {};
  if (channels.includes('homebrew')) {
    selected.darwinArm64 = selectStandalone(manifest, 'darwin', 'arm64');
    selected.darwinX64 = selectStandalone(manifest, 'darwin', 'x64');
    selected.linuxArm64 = selectStandalone(manifest, 'linux', 'arm64', 'glibc');
    selected.linuxX64 = selectStandalone(manifest, 'linux', 'x64', 'glibc');
  }
  if (channels.some(channel => ['scoop', 'winget', 'chocolatey'].includes(channel))) {
    selected.windowsX64 = selectStandalone(manifest, 'windows', 'x64');
  }
  return selected;
}

function renderHomebrew(manifest, artifacts) {
  const block = (name, artifact) => [
    `    ${name} do`,
    `      url "${artifact.url}"`,
    `      sha256 "${artifact.sha256}"`,
    '    end',
  ];
  return [
    '# Generated by GuardScan release automation. Do not edit by hand.',
    'class Guardscan < Formula',
    '  desc "Privacy-first code review and security scanning CLI"',
    '  homepage "https://guardscancli.com"',
    `  version "${manifest.version}"`,
    '  license "MIT"',
    '',
    '  on_macos do',
    ...block('on_arm', artifacts.darwinArm64),
    ...block('on_intel', artifacts.darwinX64),
    '  end',
    '',
    '  on_linux do',
    ...block('on_arm', artifacts.linuxArm64),
    ...block('on_intel', artifacts.linuxX64),
    '  end',
    '',
    '  def install',
    '    bin.install "guardscan"',
    '  end',
    '',
    '  test do',
    '    assert_match version.to_s, shell_output("#{bin}/guardscan --version")',
    '  end',
    'end',
    '',
  ].join('\n');
}

function selectNpmTarball(manifest) {
  const matches = manifest.artifacts.filter(artifact => artifact.kind === 'npm-tarball');
  if (matches.length !== 1) {
    throw new Error('Homebrew Core rendering requires exactly one npm-tarball artifact');
  }
  const artifact = matches[0];
  const expectedUrl = `https://registry.npmjs.org/guardscan/-/guardscan-${manifest.version}.tgz`;
  if (artifact.url !== expectedUrl) {
    throw new Error('Homebrew Core npm tarball URL is not the canonical versioned registry URL');
  }
  if (!SHA256_PATTERN.test(artifact.sha256 || '')) {
    throw new Error('Homebrew Core npm tarball has an invalid SHA-256');
  }
  if (!artifact.integrity || artifact.provenance?.verified !== true
      || !isSecureUrl(artifact.provenance.url)) {
    throw new Error('Homebrew Core npm tarball lacks verified provenance');
  }
  return artifact;
}

function renderHomebrewCore(manifest) {
  if (semver.prerelease(manifest.version)) {
    throw new Error('Homebrew Core rendering is supported only for stable releases');
  }
  const artifact = selectNpmTarball(manifest);
  return [
    '# Generated by GuardScan release automation for submission to homebrew/core.',
    'class Guardscan < Formula',
    '  desc "Privacy-first code review and security scanning CLI"',
    '  homepage "https://guardscancli.com"',
    `  url "${artifact.url}"`,
    `  sha256 "${artifact.sha256}"`,
    '  license "MIT"',
    '',
    '  depends_on "node"',
    '',
    '  def install',
    '    system "npm", "install", *std_npm_args',
    '  end',
    '',
    '  test do',
    '    assert_match version.to_s, shell_output("#{bin}/guardscan --version")',
    '  end',
    'end',
    '',
  ].join('\n');
}

function renderScoop(manifest, artifact) {
  return `${JSON.stringify({
    version: manifest.version,
    description: 'Privacy-first code review and security scanning CLI',
    homepage: 'https://guardscancli.com',
    license: 'MIT',
    architecture: {
      '64bit': {
        url: artifact.url,
        hash: artifact.sha256,
      },
    },
    bin: 'guardscan.exe',
  }, null, 2)}\n`;
}

function renderWinget(manifest, artifact) {
  const id = 'NaumanTanwir.GuardScan';
  const schemaVersion = '1.10.0';
  const base = `${id}\nPackageVersion: ${manifest.version}`;
  const version = [
    '# Generated by GuardScan release automation. Do not edit by hand.',
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.${schemaVersion}.schema.json`,
    `PackageIdentifier: ${base}`,
    'DefaultLocale: en-US',
    'ManifestType: version',
    `ManifestVersion: ${schemaVersion}`,
    '',
  ].join('\n');
  const locale = [
    '# Generated by GuardScan release automation. Do not edit by hand.',
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.${schemaVersion}.schema.json`,
    `PackageIdentifier: ${base}`,
    'PackageLocale: en-US',
    'Publisher: Nauman Tanwir',
    'PackageName: GuardScan',
    'License: MIT',
    'ShortDescription: Privacy-first code review and security scanning CLI',
    'PackageUrl: https://guardscancli.com',
    'ManifestType: defaultLocale',
    `ManifestVersion: ${schemaVersion}`,
    '',
  ].join('\n');
  const installer = [
    '# Generated by GuardScan release automation. Do not edit by hand.',
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.${schemaVersion}.schema.json`,
    `PackageIdentifier: ${base}`,
    'InstallerType: zip',
    'NestedInstallerType: portable',
    'Commands:',
    '- guardscan',
    'Installers:',
    '- Architecture: x64',
    '  NestedInstallerFiles:',
    `  - RelativeFilePath: ${artifact.entrypoint}`,
    '    PortableCommandAlias: guardscan',
    `  InstallerUrl: ${artifact.url}`,
    `  InstallerSha256: ${artifact.sha256.toUpperCase()}`,
    'ManifestType: installer',
    `ManifestVersion: ${schemaVersion}`,
    '',
  ].join('\n');
  const root = `winget/manifests/n/NaumanTanwir/GuardScan/${manifest.version}`;
  return {
    [`${root}/${id}.yaml`]: version,
    [`${root}/${id}.locale.en-US.yaml`]: locale,
    [`${root}/${id}.installer.yaml`]: installer,
  };
}

function renderChocolatey(manifest, artifact) {
  const nuspec = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Generated by GuardScan release automation. Do not edit by hand. -->',
    '<package xmlns="http://schemas.microsoft.com/packaging/2015/06/nuspec.xsd">',
    '  <metadata>',
    '    <id>guardscan</id>',
    `    <version>${manifest.version}</version>`,
    '    <title>GuardScan</title>',
    '    <authors>Nauman Tanwir</authors>',
    '    <owners>Nauman Tanwir</owners>',
    '    <projectUrl>https://guardscancli.com</projectUrl>',
    '    <licenseUrl>https://github.com/ntanwir10/GuardScan/blob/main/LICENSE</licenseUrl>',
    '    <requireLicenseAcceptance>false</requireLicenseAcceptance>',
    '    <description>Privacy-first code review and security scanning CLI.</description>',
    '    <summary>Privacy-first code review and security scanning CLI.</summary>',
    '    <tags>guardscan security sast cli code-review</tags>',
    '  </metadata>',
    '  <files>',
    '    <file src="tools\\**" target="tools" />',
    '  </files>',
    '</package>',
    '',
  ].join('\n');
  const install = [
    '# Generated by GuardScan release automation. Do not edit by hand.',
    '$ErrorActionPreference = \'Stop\'',
    '$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Definition',
    '$packageArgs = @{',
    '  packageName = $env:ChocolateyPackageName',
    `  url64bit = '${artifact.url}'`,
    `  checksum64 = '${artifact.sha256}'`,
    "  checksumType64 = 'sha256'",
    '  unzipLocation = $toolsDir',
    '}',
    'Install-ChocolateyZipPackage @packageArgs',
    '',
  ].join('\n');
  return {
    'chocolatey/guardscan.nuspec': nuspec,
    'chocolatey/tools/chocolateyInstall.ps1': install,
  };
}

function toPep440(version) {
  const parsed = semver.parse(version);
  if (!parsed) throw new Error(`cannot convert invalid semantic version to PEP 440: ${version}`);
  if (parsed.build.length > 0) throw new Error('PyPI rendering rejects semantic versions with build metadata');
  let result = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (parsed.prerelease.length > 0) {
    if (parsed.prerelease.length !== 2 || !Number.isInteger(parsed.prerelease[1])) {
      throw new Error(`unsupported prerelease for PyPI: ${version}`);
    }
    const prefix = {alpha: 'a', beta: 'b', rc: 'rc'}[parsed.prerelease[0]];
    if (!prefix) throw new Error(`unsupported prerelease for PyPI: ${version}`);
    result += `${prefix}${parsed.prerelease[1]}`;
  }
  return result;
}

function renderPyPI(manifest) {
  const wheels = manifest.artifacts.filter(artifact => artifact.kind === 'python-wheel');
  if (wheels.length === 0) throw new Error('PyPI rendering requires at least one prebuilt python-wheel artifact');
  for (const wheel of wheels) {
    if (!wheel.provenance || wheel.provenance.verified !== true
        || !isSecureUrl(wheel.provenance.url)) {
      throw new Error(`python wheel has no secure provenance: ${wheel.id}`);
    }
    if (!wheel.embeddedStandaloneId || !wheel.embeddedExecutableSha256) {
      throw new Error(`python wheel is not bound to a standalone executable: ${wheel.id}`);
    }
  }
  return `${JSON.stringify({
    schemaVersion: 'guardscan.pypi-publication.v1',
    project: 'guardscan-cli',
    version: toPep440(manifest.version),
    source: {tag: manifest.tag, commit: manifest.commit},
    wheels: wheels.map(wheel => ({
      id: wheel.id,
      filename: wheel.filename,
      size: wheel.size,
      sha256: wheel.sha256,
      platform: wheel.platform,
    })).sort((a, b) => a.filename.localeCompare(b.filename)),
  }, null, 2)}\n`;
}

function renderAdapters(manifest, channelInput) {
  const channels = parseChannels(channelInput);
  const artifacts = selectNativeArtifacts(manifest, channels);
  const files = {};
  if (channels.includes('homebrew')) {
    files['homebrew/Formula/guardscan.rb'] = renderHomebrew(manifest, artifacts);
  }
  if (channels.includes('homebrew-core')) {
    files['homebrew-core/Formula/guardscan.rb'] = renderHomebrewCore(manifest);
  }
  if (channels.includes('scoop')) {
    files['scoop/bucket/guardscan.json'] = renderScoop(manifest, artifacts.windowsX64);
  }
  if (channels.includes('winget')) Object.assign(files, renderWinget(manifest, artifacts.windowsX64));
  if (channels.includes('chocolatey')) Object.assign(files, renderChocolatey(manifest, artifacts.windowsX64));
  if (channels.includes('pypi')) files['pypi/publication.json'] = renderPyPI(manifest);
  return {channels, files};
}

function validateCatalogOptions(manifest, options = {}) {
  const manifestUrl = String(options.manifestUrl || '');
  const manifestSha256 = String(options.manifestSha256 || '');
  const generatorRepository = String(options.generatorRepository || '');
  const generatorCommit = String(options.generatorCommit || '').toLowerCase();
  if (!isSecureUrl(manifestUrl)) throw new Error('catalog manifestUrl must be a secure HTTPS URL');
  const expectedManifestUrl = `https://github.com/ntanwir10/GuardScan/releases/download/${manifest.tag}/release-manifest.json`;
  if (manifestUrl !== expectedManifestUrl) {
    throw new Error('catalog manifestUrl is not the canonical immutable GuardScan release URL');
  }
  if (!SHA256_PATTERN.test(manifestSha256)) {
    throw new Error('catalog manifestSha256 must be a lowercase SHA-256');
  }
  if (!REPOSITORY_PATTERN.test(generatorRepository)
      || generatorRepository !== 'ntanwir10/GuardScan') {
    throw new Error('catalog generator repository must be ntanwir10/GuardScan');
  }
  if (!COMMIT_PATTERN.test(generatorCommit)) {
    throw new Error('catalog generator commit must be a lowercase 40-character SHA');
  }
  if (generatorCommit !== manifest.commit) {
    throw new Error('catalog generator commit must match the exact release source commit');
  }
  return {manifestUrl, manifestSha256, generatorRepository, generatorCommit};
}

function renderChannelCatalog(manifest, options = {}) {
  const catalogOptions = validateCatalogOptions(manifest, options);
  const artifacts = selectNativeArtifacts(manifest, ['homebrew', 'scoop']);
  const files = {
    'Formula/guardscan.rb': renderHomebrew(manifest, artifacts),
    'bucket/guardscan.json': renderScoop(manifest, artifacts.windowsX64),
  };
  const lock = {
    schemaVersion: CATALOG_SCHEMA,
    source: {
      repository: 'ntanwir10/GuardScan',
      version: manifest.version,
      tag: manifest.tag,
      commit: manifest.commit,
      manifestUrl: catalogOptions.manifestUrl,
      manifestSha256: catalogOptions.manifestSha256,
    },
    generator: {
      repository: catalogOptions.generatorRepository,
      commit: catalogOptions.generatorCommit,
    },
    files: Object.fromEntries(CATALOG_FILES.map(file => [
      file,
      {sha256: sha256(files[file])},
    ])),
  };
  return {
    files: {
      ...files,
      'channel-lock.json': `${JSON.stringify(lock, null, 2)}\n`,
    },
    lock,
  };
}

function assertSafeCatalogTarget(root, relative) {
  let current = root;
  if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
    throw new Error(`catalog output root must not be a symbolic link: ${root}`);
  }
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`catalog output contains a symbolic link: ${relative}`);
    }
  }
}

function listManagedCatalogFiles(outputDir) {
  const files = [];
  function visit(directory, relative) {
    if (!fs.existsSync(directory)) return;
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink()) {
      throw new Error(`catalog managed path contains a symbolic link: ${relative}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`catalog managed path is not a directory: ${relative}`);
    }
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const nextRelative = `${relative}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`catalog managed path contains a symbolic link: ${nextRelative}`);
      }
      if (entry.isDirectory()) visit(absolute, nextRelative);
      else if (entry.isFile()) files.push(nextRelative);
      else throw new Error(`catalog managed path contains a non-regular entry: ${nextRelative}`);
    }
  }
  for (const directory of ['Formula', 'bucket']) {
    visit(path.join(outputDir, directory), directory);
  }
  return files.sort();
}

function compareCatalogOutput(outputDir, rendered) {
  const managedFiles = listManagedCatalogFiles(outputDir);
  if (managedFiles.join('\n') !== [...CATALOG_FILES].sort().join('\n')) return false;
  return Object.entries(rendered.files).every(([relative, contents]) => {
    assertSafeCatalogTarget(outputDir, relative);
    const target = path.join(outputDir, ...relative.split('/'));
    return fs.existsSync(target)
      && fs.statSync(target).isFile()
      && fs.readFileSync(target, 'utf8') === contents;
  });
}

function writeChannelCatalogOutput(rendered, outputDir, checkOnly = false) {
  const resolved = path.resolve(outputDir);
  if (path.dirname(resolved) === resolved) {
    throw new Error('refusing to use a filesystem root as catalog output');
  }
  const unexpectedManagedFiles = listManagedCatalogFiles(resolved)
    .filter(file => !CATALOG_FILES.includes(file));
  if (unexpectedManagedFiles.length > 0) {
    throw new Error(
      `refusing to update catalog with unmanaged generated paths: ${unexpectedManagedFiles.join(', ')}`
    );
  }
  if (compareCatalogOutput(resolved, rendered)) {
    return {
      changed: false,
      checked: checkOnly,
      outputDir: resolved,
      files: Object.keys(rendered.files).sort(),
      lockSha256: sha256(rendered.files['channel-lock.json']),
    };
  }
  if (checkOnly) throw new Error(`channel catalog is missing, stale, or manually edited: ${resolved}`);
  fs.mkdirSync(resolved, {recursive: true, mode: 0o700});
  const staged = [];
  try {
    for (const [relative, contents] of Object.entries(rendered.files)) {
      assertSafeCatalogTarget(resolved, relative);
      const target = path.join(resolved, ...relative.split('/'));
      fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
      const stage = `${target}.guardscan-${process.pid}-${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(stage, contents, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
      staged.push({stage, target});
    }
    for (const entry of staged) fs.renameSync(entry.stage, entry.target);
  } finally {
    for (const entry of staged) fs.rmSync(entry.stage, {force: true});
  }
  return {
    changed: true,
    checked: false,
    outputDir: resolved,
    files: Object.keys(rendered.files).sort(),
    lockSha256: sha256(rendered.files['channel-lock.json']),
  };
}

function readCatalogLock(catalogRoot) {
  const resolved = path.resolve(catalogRoot);
  const lockFile = path.join(resolved, 'channel-lock.json');
  if (!fs.existsSync(lockFile)) return undefined;
  assertSafeCatalogTarget(resolved, 'channel-lock.json');
  const text = fs.readFileSync(lockFile, 'utf8');
  return {document: readJson(lockFile, 'channel catalog lock'), text};
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');
}

function isSelfConsistentCatalog(lock, catalogRoot) {
  try {
    if (!hasExactKeys(lock, ['schemaVersion', 'source', 'generator', 'files'])
        || lock.schemaVersion !== CATALOG_SCHEMA
        || !hasExactKeys(lock.source, [
          'repository',
          'version',
          'tag',
          'commit',
          'manifestUrl',
          'manifestSha256',
        ])
        || !hasExactKeys(lock.generator, ['repository', 'commit'])
        || !hasExactKeys(lock.files, CATALOG_FILES)) {
      return false;
    }
    if (lock.source.repository !== 'ntanwir10/GuardScan'
        || lock.generator.repository !== 'ntanwir10/GuardScan'
        || !COMMIT_PATTERN.test(lock.source.commit || '')
        || lock.generator.commit !== lock.source.commit
        || lock.source.tag !== `v${lock.source.version}`
        || lock.source.manifestUrl
          !== `https://github.com/ntanwir10/GuardScan/releases/download/${lock.source.tag}/release-manifest.json`
        || !SHA256_PATTERN.test(lock.source.manifestSha256 || '')) {
      return false;
    }
    const managedFiles = listManagedCatalogFiles(path.resolve(catalogRoot));
    if (managedFiles.join('\n') !== [...CATALOG_FILES].sort().join('\n')) return false;
    for (const relative of CATALOG_FILES) {
      if (!hasExactKeys(lock.files[relative], ['sha256'])
          || !SHA256_PATTERN.test(lock.files[relative].sha256 || '')) {
        return false;
      }
      assertSafeCatalogTarget(path.resolve(catalogRoot), relative);
      const contents = fs.readFileSync(path.join(catalogRoot, ...relative.split('/')));
      if (sha256(contents) !== lock.files[relative].sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function classifyChannelCatalog(rendered, catalogRoot) {
  const actual = readCatalogLock(catalogRoot);
  const desiredLock = rendered.lock;
  const desiredLockSha256 = sha256(rendered.files['channel-lock.json']);
  if (!actual) {
    return {
      classification: 'missing',
      integrityIncident: false,
      action: 'open-or-reuse-update-pr',
      desiredLockSha256,
    };
  }
  const actualLock = actual.document;
  const actualLockSha256 = sha256(actual.text);
  if (!actualLock || typeof actualLock !== 'object' || Array.isArray(actualLock)
      || actualLock.schemaVersion !== CATALOG_SCHEMA
      || !actualLock.source || !actualLock.generator || !actualLock.files) {
    return {
      classification: 'invalid',
      integrityIncident: true,
      action: 'stop',
      desiredLockSha256,
      actualLockSha256,
    };
  }
  if (!isSelfConsistentCatalog(actualLock, catalogRoot)) {
    return {
      classification: 'digest-conflict',
      integrityIncident: true,
      action: 'stop',
      desiredLockSha256,
      actualLockSha256,
    };
  }
  const actualVersion = semver.valid(actualLock.source.version);
  const desiredVersion = semver.valid(desiredLock.source.version);
  if (!actualVersion || !desiredVersion) {
    return {
      classification: 'invalid',
      integrityIncident: true,
      action: 'stop',
      desiredLockSha256,
      actualLockSha256,
    };
  }
  if (semver.gt(actualVersion, desiredVersion)) {
    return {
      classification: 'unexpected-newer',
      integrityIncident: true,
      action: 'stop',
      desiredLockSha256,
      actualLockSha256,
    };
  }
  if (semver.lt(actualVersion, desiredVersion)) {
    return {
      classification: 'older',
      integrityIncident: false,
      action: 'open-or-reuse-update-pr',
      desiredLockSha256,
      actualLockSha256,
    };
  }
  if (actualLock.source.tag !== desiredLock.source.tag
      || actualLock.source.commit !== desiredLock.source.commit
      || actualLock.source.manifestSha256 !== desiredLock.source.manifestSha256) {
    return {
      classification: 'release-identity-conflict',
      integrityIncident: true,
      action: 'stop',
      desiredLockSha256,
      actualLockSha256,
    };
  }
  if (!compareCatalogOutput(path.resolve(catalogRoot), rendered)) {
    return {
      classification: 'digest-conflict',
      integrityIncident: true,
      action: 'stop',
      desiredLockSha256,
      actualLockSha256,
    };
  }
  return {
    classification: 'exact',
    integrityIncident: false,
    action: 'record-verified',
    desiredLockSha256,
    actualLockSha256,
  };
}

function expectedOutput(manifest, rendered) {
  const paths = Object.keys(rendered.files).sort();
  const marker = {
    schemaVersion: RENDER_SCHEMA,
    version: manifest.version,
    tag: manifest.tag,
    commit: manifest.commit,
    channels: rendered.channels,
    files: paths,
  };
  return {...rendered.files, [MARKER_FILE]: `${JSON.stringify(marker, null, 2)}\n`};
}

function listFiles(root) {
  const files = [];
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      if (entry.isSymbolicLink()) throw new Error(`render output contains a symbolic link: ${entry.name}`);
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, nextRelative);
      else if (entry.isFile()) files.push(nextRelative);
      else throw new Error(`render output contains a non-regular entry: ${nextRelative}`);
      if (files.length > MAX_RENDERED_FILES) throw new Error('render output contains too many files');
    }
  }
  visit(root);
  return files.sort();
}

function compareOutput(outputDir, expected) {
  if (!fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) return false;
  const actualFiles = listFiles(outputDir);
  const expectedFiles = Object.keys(expected).sort();
  if (actualFiles.join('\n') !== expectedFiles.join('\n')) return false;
  return expectedFiles.every(file => fs.readFileSync(path.join(outputDir, file), 'utf8') === expected[file]);
}

function assertOwnedOutput(outputDir) {
  const markerPath = path.join(outputDir, MARKER_FILE);
  if (!fs.existsSync(markerPath)) throw new Error(`refusing to replace unmanaged render output: ${outputDir}`);
  const marker = readJson(markerPath, 'render marker');
  if (marker.schemaVersion !== RENDER_SCHEMA || !Array.isArray(marker.files)) {
    throw new Error(`render output has an invalid ownership marker: ${outputDir}`);
  }
  const actual = listFiles(outputDir);
  const owned = [...marker.files, MARKER_FILE].sort();
  if (actual.join('\n') !== owned.join('\n')) {
    throw new Error(`render output contains files outside its ownership marker: ${outputDir}`);
  }
}

function writeFiles(root, files) {
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
    fs.writeFileSync(target, contents, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  }
}

function writeRenderedOutput(manifest, rendered, outputDir, checkOnly = false) {
  const resolved = path.resolve(outputDir);
  if (path.dirname(resolved) === resolved) throw new Error('refusing to use a filesystem root as render output');
  const expected = expectedOutput(manifest, rendered);
  if (checkOnly) {
    if (!compareOutput(resolved, expected)) throw new Error(`rendered adapters are missing or stale: ${resolved}`);
    return {changed: false, checked: true, outputDir: resolved, files: Object.keys(rendered.files).sort()};
  }
  if (compareOutput(resolved, expected)) {
    return {changed: false, checked: false, outputDir: resolved, files: Object.keys(rendered.files).sort()};
  }
  if (fs.existsSync(resolved)) assertOwnedOutput(resolved);
  const parent = path.dirname(resolved);
  fs.mkdirSync(parent, {recursive: true, mode: 0o700});
  const suffix = `${process.pid}-${crypto.randomUUID()}`;
  const stage = path.join(parent, `.${path.basename(resolved)}.tmp-${suffix}`);
  const backup = path.join(parent, `.${path.basename(resolved)}.backup-${suffix}`);
  let movedExisting = false;
  try {
    writeFiles(stage, expected);
    if (fs.existsSync(resolved)) {
      fs.renameSync(resolved, backup);
      movedExisting = true;
    }
    fs.renameSync(stage, resolved);
    if (movedExisting) fs.rmSync(backup, {recursive: true, force: true});
  } catch (error) {
    if (!fs.existsSync(resolved) && movedExisting && fs.existsSync(backup)) fs.renameSync(backup, resolved);
    throw error;
  } finally {
    fs.rmSync(stage, {recursive: true, force: true});
  }
  return {changed: true, checked: false, outputDir: resolved, files: Object.keys(rendered.files).sort()};
}

module.exports = {
  CATALOG_FILES,
  CATALOG_SCHEMA,
  DEFAULT_CHANNELS,
  MARKER_FILE,
  RENDER_SCHEMA,
  SUPPORTED_CHANNELS,
  classifyChannelCatalog,
  parseChannels,
  renderAdapters,
  renderChannelCatalog,
  toPep440,
  writeChannelCatalogOutput,
  writeRenderedOutput,
};
