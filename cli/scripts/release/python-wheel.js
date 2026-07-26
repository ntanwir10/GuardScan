'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {buildArchive, inspectArchive} = require('./archive');
const {toPep440} = require('./renderers');
const {readJson} = require('./lib');

const WHEEL_SCHEMA = 'guardscan.python-wheel.v1';
const PLATFORM_TAGS = Object.freeze({
  'darwin-arm64': 'macosx_11_0_arm64',
  'darwin-x64': 'macosx_11_0_x86_64',
  'linux-arm64-glibc': 'manylinux_2_28_aarch64',
  'linux-x64-glibc': 'manylinux_2_28_x86_64',
  'windows-x64': 'win_amd64',
});

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function recordDigest(buffer) {
  return `sha256=${crypto.createHash('sha256').update(buffer).digest('base64url')}`;
}

function targetId(platform) {
  return [platform.os, platform.arch, platform.libc].filter(Boolean).join('-');
}

function launcherSource(binaryName, digest) {
  return [
    '"""Standard-library-only launcher for the bundled GuardScan executable."""',
    'from importlib.resources import files',
    'import hashlib',
    'import os',
    'import subprocess',
    'import sys',
    '',
    `EXPECTED_SHA256 = "${digest}"`,
    `BINARY_NAME = "${binaryName}"`,
    '',
    'def main():',
    '    binary = files("guardscan_cli").joinpath("bin", BINARY_NAME)',
    '    executable = os.fspath(binary)',
    '    with open(executable, "rb") as stream:',
    '        digest = hashlib.file_digest(stream, "sha256").hexdigest()',
    '    if digest != EXPECTED_SHA256:',
    '        raise RuntimeError("bundled GuardScan executable failed integrity verification")',
    '    argv = [executable, *sys.argv[1:]]',
    '    if os.name != "nt":',
    '        os.execv(executable, argv)',
    '    completed = subprocess.run(argv, check=False)',
    '    raise SystemExit(completed.returncode)',
    '',
  ].join('\n');
}

function buildWheel(source, executableFile, platform, outputDir, timestamp) {
  const target = targetId(platform);
  const platformTag = PLATFORM_TAGS[target];
  if (!platformTag) throw new Error(`unsupported Python wheel target: ${target}`);
  const executable = fs.readFileSync(path.resolve(executableFile));
  if (executable.length <= 0) throw new Error('Python wheel executable is empty');
  const binaryDigest = sha256(executable);
  const binaryName = platform.os === 'windows' ? 'guardscan.exe' : 'guardscan';
  const pythonVersion = toPep440(source.version);
  const distribution = 'guardscan_cli';
  const distInfo = `${distribution}-${pythonVersion}.dist-info`;
  const files = new Map([
    [`${distribution}/__init__.py`, Buffer.from(`__version__ = "${pythonVersion}"\n`)],
    [`${distribution}/launcher.py`, Buffer.from(launcherSource(binaryName, binaryDigest))],
    [`${distribution}/bin/${binaryName}`, executable],
    [`${distInfo}/METADATA`, Buffer.from([
      'Metadata-Version: 2.3',
      'Name: guardscan-cli',
      `Version: ${pythonVersion}`,
      'Summary: Privacy-first code review and security scanning CLI',
      'License-Expression: MIT',
      'Requires-Python: >=3.9',
      '',
    ].join('\n'))],
    [`${distInfo}/WHEEL`, Buffer.from([
      'Wheel-Version: 1.0',
      'Generator: guardscan-release',
      'Root-Is-Purelib: false',
      `Tag: py3-none-${platformTag}`,
      '',
    ].join('\n'))],
    [`${distInfo}/entry_points.txt`, Buffer.from([
      '[console_scripts]',
      'guardscan = guardscan_cli.launcher:main',
      '',
    ].join('\n'))],
  ]);
  const recordPath = `${distInfo}/RECORD`;
  const record = [...files.entries()].map(([name, data]) => (
    `${name},${recordDigest(data)},${data.length}`
  ));
  record.push(`${recordPath},,`);
  files.set(recordPath, Buffer.from(`${record.join('\n')}\n`));
  const entries = [...files.entries()].map(([name, data]) => ({
    name,
    data,
    mode: name.endsWith(`/${binaryName}`) ? 0o755 : 0o644,
  }));
  const filename = `guardscan_cli-${pythonVersion}-py3-none-${platformTag}.whl`;
  const archive = buildArchive('zip', entries, timestamp);
  const resolvedOutput = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutput, {recursive: true, mode: 0o700});
  const wheelFile = path.join(resolvedOutput, filename);
  fs.writeFileSync(wheelFile, archive, {mode: 0o600, flag: 'wx'});
  const inspected = inspectArchive(wheelFile, 'zip', entries.map(entry => entry.name));
  const metadata = {
    schemaVersion: WHEEL_SCHEMA,
    version: source.version,
    tag: source.tag,
    commit: source.commit,
    pythonVersion,
    platform,
    wheelTag: `py3-none-${platformTag}`,
    filename,
    size: inspected.size,
    sha256: inspected.sha256,
    embeddedExecutable: {
      filename: binaryName,
      size: executable.length,
      sha256: binaryDigest,
    },
    launcher: {
      implementation: 'standard-library-only',
      forwardsArguments: true,
      forwardsExitStatus: true,
      forwardsSignals: platform.os !== 'windows',
    },
  };
  fs.writeFileSync(path.join(resolvedOutput, `${filename}.json`), `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  return {wheelFile, metadata};
}

function finalizeWheelArtifact(
  source,
  wheelMetadataFile,
  standaloneMetadataFile,
  provenanceUrl,
  outputFile
) {
  const wheel = readJson(path.resolve(wheelMetadataFile), 'Python wheel metadata');
  const standalone = readJson(
    path.resolve(standaloneMetadataFile),
    'standalone artifact metadata'
  ).artifact;
  for (const field of ['version', 'tag', 'commit']) {
    if (wheel[field] !== source[field]) throw new Error(`Python wheel ${field} does not match source`);
  }
  if (targetId(wheel.platform) !== targetId(standalone.platform)) {
    throw new Error('Python wheel platform does not match standalone artifact');
  }
  const executable = standalone.archiveEntries.find(entry => entry.path === standalone.entrypoint);
  if (!executable || executable.sha256 !== wheel.embeddedExecutable.sha256) {
    throw new Error('Python wheel does not contain the signed standalone executable');
  }
  const parsed = new URL(provenanceUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Python wheel provenance URL is invalid');
  }
  const artifact = {
    id: `python-wheel:${targetId(wheel.platform)}`,
    kind: 'python-wheel',
    filename: wheel.filename,
    size: wheel.size,
    sha256: wheel.sha256,
    source: {
      version: source.version,
      tag: source.tag,
      commit: source.commit,
    },
    capabilities: standalone.capabilities,
    platform: wheel.platform,
    embeddedStandaloneId: standalone.id,
    embeddedExecutableSha256: wheel.embeddedExecutable.sha256,
    provenance: {
      type: 'slsa',
      url: provenanceUrl,
      verified: true,
    },
  };
  const metadata = {
    schemaVersion: 'guardscan.artifact-metadata.v1',
    version: source.version,
    tag: source.tag,
    commit: source.commit,
    artifact,
  };
  const resolved = path.resolve(outputFile);
  fs.writeFileSync(resolved, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  return {outputFile: resolved, metadata};
}

module.exports = {
  PLATFORM_TAGS,
  WHEEL_SCHEMA,
  buildWheel,
  finalizeWheelArtifact,
  launcherSource,
  targetId,
};
