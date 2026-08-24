'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const yaml = require('js-yaml');
const {readBounded} = require('./lib');
const {
  parseChannels,
  renderAdapters,
  writeRenderedOutput,
} = require('./renderers');

function readOutput(outputDir, relative, label) {
  return readBounded(path.join(outputDir, ...relative.split('/')), label);
}

function validateStructuredOutput(manifest, outputDir, channels) {
  const results = {};
  if (channels.includes('homebrew')) {
    const formula = readOutput(outputDir, 'homebrew/Formula/guardscan.rb', 'Homebrew formula');
    if (!formula.includes(`version "${manifest.version}"`) || !formula.includes('bin.install "guardscan"')) {
      throw new Error('Homebrew formula does not preserve the release version and executable contract');
    }
    results.homebrew = {valid: true, files: 1};
  }
  if (channels.includes('scoop')) {
    const scoop = JSON.parse(readOutput(outputDir, 'scoop/bucket/guardscan.json', 'Scoop manifest'));
    if (scoop.version !== manifest.version || scoop.bin !== 'guardscan.exe'
        || !/^[a-f0-9]{64}$/.test(scoop.architecture?.['64bit']?.hash || '')) {
      throw new Error('Scoop manifest does not preserve the release identity and checksum contract');
    }
    results.scoop = {valid: true, files: 1};
  }
  if (channels.includes('winget')) {
    const root = `winget/manifests/n/NaumanTanwir/GuardScan/${manifest.version}`;
    const names = [
      'NaumanTanwir.GuardScan.yaml',
      'NaumanTanwir.GuardScan.locale.en-US.yaml',
      'NaumanTanwir.GuardScan.installer.yaml',
    ];
    const documents = names.map(name => yaml.load(readOutput(outputDir, `${root}/${name}`, `WinGet ${name}`)));
    for (const document of documents) {
      if (document.PackageIdentifier !== 'NaumanTanwir.GuardScan'
          || document.PackageVersion !== manifest.version) {
        throw new Error('WinGet manifests do not share one package identity and version');
      }
    }
    const installer = documents[2];
    if (!/^[A-F0-9]{64}$/.test(installer.Installers?.[0]?.InstallerSha256 || '')) {
      throw new Error('WinGet installer manifest has an invalid SHA-256');
    }
    results.winget = {valid: true, files: 3};
  }
  if (channels.includes('chocolatey')) {
    const nuspec = readOutput(outputDir, 'chocolatey/guardscan.nuspec', 'Chocolatey nuspec');
    const install = readOutput(
      outputDir,
      'chocolatey/tools/chocolateyInstall.ps1',
      'Chocolatey install script'
    );
    if (!nuspec.includes(`<version>${manifest.version}</version>`)
        || !/checksum64 = '[a-f0-9]{64}'/.test(install)
        || !install.includes("checksumType64 = 'sha256'")) {
      throw new Error('Chocolatey package does not preserve the release version and checksum contract');
    }
    results.chocolatey = {valid: true, files: 2};
  }
  if (channels.includes('pypi')) {
    const publication = JSON.parse(readOutput(outputDir, 'pypi/publication.json', 'PyPI publication plan'));
    if (publication.schemaVersion !== 'guardscan.pypi-publication.v1'
        || publication.source?.tag !== manifest.tag
        || publication.source?.commit !== manifest.commit
        || !Array.isArray(publication.wheels)
        || publication.wheels.length === 0) {
      throw new Error('PyPI publication plan does not preserve source and wheel identities');
    }
    results.pypi = {valid: true, files: 1};
  }
  return results;
}

function nativeValidationPlan(outputDir, channels, platform = process.platform, tempDir = os.tmpdir()) {
  const plan = [];
  const skip = (channel, reason) => plan.push({channel, skipped: true, reason});
  if (channels.includes('homebrew')) {
    if (platform === 'darwin' || platform === 'linux') {
      plan.push({
        channel: 'homebrew',
        command: 'brew',
        args: ['style', path.join(outputDir, 'homebrew', 'Formula', 'guardscan.rb')],
      });
    } else {
      skip('homebrew', 'Homebrew validation requires macOS or Linux');
    }
  }
  if (channels.includes('scoop')) {
    if (platform === 'win32') {
      plan.push({
        channel: 'scoop',
        command: 'pwsh',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$value = Get-Content -Raw -LiteralPath $args[0] | ConvertFrom-Json; if (-not $value.bin) { exit 1 }',
          path.join(outputDir, 'scoop', 'bucket', 'guardscan.json'),
        ],
      });
    } else {
      skip('scoop', 'Scoop validation requires Windows PowerShell');
    }
  }
  if (channels.includes('winget')) {
    if (platform === 'win32') {
      plan.push({
        channel: 'winget',
        command: 'winget',
        args: [
          'validate',
          '--manifest',
          path.join(outputDir, 'winget', 'manifests', 'n', 'NaumanTanwir', 'GuardScan'),
        ],
      });
    } else {
      skip('winget', 'WinGet validation requires Windows');
    }
  }
  if (channels.includes('chocolatey')) {
    if (platform === 'win32') {
      plan.push({
        channel: 'chocolatey',
        command: 'choco',
        args: [
          'pack',
          path.join(outputDir, 'chocolatey', 'guardscan.nuspec'),
          '--outputdirectory',
          tempDir,
          '--no-progress',
        ],
      });
    } else {
      skip('chocolatey', 'Chocolatey validation requires Windows');
    }
  }
  if (channels.includes('pypi')) {
    plan.push({
      channel: 'pypi',
      command: platform === 'win32' ? 'python.exe' : 'python3',
      args: [
        '-c',
        'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))',
        path.join(outputDir, 'pypi', 'publication.json'),
      ],
    });
  }
  return plan;
}

function defaultRunner(command) {
  return spawnSync(command.command, command.args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function validateAdapters(manifest, outputDir, channelInput, options = {}) {
  const channels = parseChannels(channelInput);
  const rendered = renderAdapters(manifest, channels.join(','));
  writeRenderedOutput(manifest, rendered, outputDir, true);
  const structural = validateStructuredOutput(manifest, path.resolve(outputDir), channels);
  const native = [];
  if (options.native) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-adapter-validation-'));
    try {
      const plan = nativeValidationPlan(path.resolve(outputDir), channels, options.platform, tempDir);
      for (const command of plan) {
        if (command.skipped) {
          if (options.requireNative) throw new Error(`${command.channel}: ${command.reason}`);
          native.push(command);
          continue;
        }
        const result = (options.runner || defaultRunner)(command);
        if (result.error) throw result.error;
        if (result.status !== 0) {
          throw new Error(
            `${command.channel} native validation failed (${result.status}): `
            + `${String(result.stderr || result.stdout || '').trim()}`
          );
        }
        native.push({channel: command.channel, valid: true});
      }
    } finally {
      fs.rmSync(tempDir, {recursive: true, force: true});
    }
  }
  return {valid: true, channels, structural, native};
}

module.exports = {
  nativeValidationPlan,
  validateAdapters,
  validateStructuredOutput,
};
