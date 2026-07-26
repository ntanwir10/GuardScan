import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';

const {
  MARKER_FILE,
  renderAdapters,
  toPep440,
  writeRenderedOutput,
} = require('../../scripts/release/renderers') as {
  MARKER_FILE: string;
  renderAdapters: (
    manifest: Record<string, any>,
    channels?: string
  ) => {channels: string[]; files: Record<string, string>};
  toPep440: (version: string) => string;
  writeRenderedOutput: (
    manifest: Record<string, any>,
    rendered: {channels: string[]; files: Record<string, string>},
    outputDir: string,
    checkOnly?: boolean
  ) => {changed: boolean; checked: boolean; files: string[]};
};
const {
  nativeValidationPlan,
  validateAdapters,
} = require('../../scripts/release/validators') as {
  nativeValidationPlan: (
    outputDir: string,
    channels: string[],
    platform?: NodeJS.Platform,
    tempDir?: string
  ) => Array<Record<string, any>>;
  validateAdapters: (
    manifest: Record<string, any>,
    outputDir: string,
    channels: string,
    options?: Record<string, any>
  ) => Record<string, any>;
};

const commit = 'a'.repeat(40);
const source = {version: '1.2.3', tag: 'v1.2.3', commit};

function makeStandalone(
  osName: string,
  arch: string,
  suffix: string,
  digestCharacter: string,
  libc?: string
): Record<string, unknown> {
  const filename = `guardscan-v1.2.3-${suffix}.${osName === 'windows' ? 'zip' : 'tar.gz'}`;
  const signatureTypes = {
    darwin: ['apple-code-signing', 'apple-notarization'],
    linux: ['sigstore'],
    windows: ['authenticode'],
  }[osName] as string[];
  const entrypoint = osName === 'windows' ? 'guardscan.exe' : 'guardscan';
  return {
    id: `binary:${suffix}`,
    kind: 'standalone',
    productionReady: true,
    filename,
    size: 4096,
    sha256: digestCharacter.repeat(64),
    source,
    capabilities: {
      coreScan: true,
      sbom: true,
      chartRendering: false,
      accurateTokenCounting: false,
    },
    platform: {os: osName, arch, ...(libc ? {libc} : {})},
    archiveFormat: osName === 'windows' ? 'zip' : 'tar.gz',
    entrypoint,
    url: `https://github.com/ntanwir10/GuardScan/releases/download/v1.2.3/${filename}`,
    archiveEntries: [{
      path: entrypoint,
      size: 2048,
      mode: '0755',
      sha256: digestCharacter.repeat(64),
    }],
    signatures: signatureTypes.map(type => ({
      type,
      url: `https://github.com/ntanwir10/GuardScan/releases/download/v1.2.3/${filename}.signature.json`,
      verified: true,
    })),
    sboms: ['spdx', 'cyclonedx'].map(type => ({
      type,
      url: `https://github.com/ntanwir10/GuardScan/releases/download/v1.2.3/${filename}.${type}.json`,
      verified: true,
    })),
    provenance: {
      type: 'slsa',
      url: `https://github.com/ntanwir10/GuardScan/attestations/${suffix}`,
      verified: true,
    },
  };
}

function makeManifest(): Record<string, any> {
  return {
    schemaVersion: 'guardscan.release-manifest.v1',
    version: '1.2.3',
    tag: 'v1.2.3',
    commit,
    createdAt: '2026-07-20T12:00:00.000Z',
    toolchain: {},
    artifacts: [
      makeStandalone('darwin', 'arm64', 'darwin-arm64', 'a'),
      makeStandalone('darwin', 'x64', 'darwin-x64', 'b'),
      makeStandalone('linux', 'arm64', 'linux-arm64-glibc', 'c', 'glibc'),
      makeStandalone('linux', 'x64', 'linux-x64-glibc', 'd', 'glibc'),
      makeStandalone('windows', 'x64', 'windows-x64', 'e'),
      {
        id: 'pypi:guardscan-cli@1.2.3:linux-x64',
        kind: 'python-wheel',
        filename: 'guardscan_cli-1.2.3-py3-none-manylinux_2_28_x86_64.whl',
        size: 8192,
        sha256: 'f'.repeat(64),
        source,
        capabilities: {
          coreScan: true,
          sbom: true,
          chartRendering: false,
          accurateTokenCounting: false,
        },
        platform: {os: 'linux', arch: 'x64', libc: 'glibc'},
        embeddedStandaloneId: 'binary:linux-x64-glibc',
        embeddedExecutableSha256: 'd'.repeat(64),
        provenance: {
          type: 'slsa',
          url: 'https://github.com/ntanwir10/GuardScan/attestations/pypi-linux-x64',
          verified: true,
        },
      },
    ],
  };
}

describe('release adapter rendering', () => {
  it('renders deterministic native adapters and a fail-closed PyPI publication descriptor', () => {
    const manifest = makeManifest();
    const rendered = renderAdapters(manifest, 'pypi,chocolatey,winget,scoop,homebrew');

    expect(rendered.channels).toEqual(['homebrew', 'scoop', 'winget', 'chocolatey', 'pypi']);
    expect(Object.keys(rendered.files)).toHaveLength(8);

    const formula = rendered.files['homebrew/Formula/guardscan.rb'];
    expect(formula).toContain('class Guardscan < Formula');
    expect(formula).toContain('guardscan-v1.2.3-darwin-arm64.tar.gz');
    expect(formula).toContain('a'.repeat(64));

    const scoop = JSON.parse(rendered.files['scoop/bucket/guardscan.json']);
    expect(scoop).toMatchObject({
      version: '1.2.3',
      architecture: {'64bit': {hash: 'e'.repeat(64)}},
      bin: 'guardscan.exe',
    });

    const wingetPath = 'winget/manifests/n/NaumanTanwir/GuardScan/1.2.3/NaumanTanwir.GuardScan.installer.yaml';
    const winget = yaml.load(rendered.files[wingetPath]) as Record<string, any>;
    expect(winget).toMatchObject({
      PackageIdentifier: 'NaumanTanwir.GuardScan',
      PackageVersion: '1.2.3',
      InstallerType: 'zip',
      NestedInstallerType: 'portable',
    });
    expect(winget.Installers[0].InstallerSha256).toBe('E'.repeat(64));

    expect(rendered.files['chocolatey/tools/chocolateyInstall.ps1'])
      .toContain(`checksum64 = '${'e'.repeat(64)}'`);
    expect(JSON.parse(rendered.files['pypi/publication.json'])).toMatchObject({
      schemaVersion: 'guardscan.pypi-publication.v1',
      project: 'guardscan-cli',
      version: '1.2.3',
    });
  });

  it('rejects mutable URLs, missing signatures, and PyPI plans without built wheels', () => {
    const mutable = makeManifest();
    mutable.artifacts[0].url = 'https://github.com/ntanwir10/GuardScan/releases/latest/download/guardscan.tar.gz';
    expect(() => renderAdapters(mutable, 'homebrew')).toThrow(/canonical versioned release URL/);

    const unsigned = makeManifest();
    unsigned.artifacts[4].signatures = [];
    expect(() => renderAdapters(unsigned, 'scoop')).toThrow(/authenticode/);

    const noWheels = makeManifest();
    noWheels.artifacts = noWheels.artifacts.filter((artifact: Record<string, unknown>) => (
      artifact.kind !== 'python-wheel'
    ));
    expect(() => renderAdapters(noWheels, 'pypi')).toThrow(/requires at least one prebuilt/);
  });

  it('writes owned output atomically, detects drift, and refuses unmanaged replacement', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-render-'));
    try {
      const output = path.join(root, 'adapters');
      const manifest = makeManifest();
      const rendered = renderAdapters(manifest, 'scoop');
      expect(writeRenderedOutput(manifest, rendered, output)).toMatchObject({changed: true});
      expect(writeRenderedOutput(manifest, rendered, output)).toMatchObject({changed: false});
      expect(writeRenderedOutput(manifest, rendered, output, true)).toMatchObject({checked: true});
      expect(fs.existsSync(path.join(output, MARKER_FILE))).toBe(true);

      fs.writeFileSync(path.join(output, 'scoop/bucket/guardscan.json'), '{}\n');
      expect(() => writeRenderedOutput(manifest, rendered, output, true)).toThrow(/missing or stale/);
      expect(writeRenderedOutput(manifest, rendered, output)).toMatchObject({changed: true});

      const unmanaged = path.join(root, 'unmanaged');
      fs.mkdirSync(unmanaged);
      fs.writeFileSync(path.join(unmanaged, 'notes.txt'), 'user data');
      expect(() => writeRenderedOutput(manifest, rendered, unmanaged)).toThrow(/unmanaged/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('maps supported semantic prereleases to PEP 440 without creating collisions', () => {
    expect(toPep440('2.0.0-alpha.2')).toBe('2.0.0a2');
    expect(toPep440('2.0.0-beta.3')).toBe('2.0.0b3');
    expect(toPep440('2.0.0-rc.4')).toBe('2.0.0rc4');
    expect(() => toPep440('2.0.0-next.1')).toThrow(/unsupported prerelease/);
    expect(() => toPep440('2.0.0+build.1')).toThrow(/build metadata/);
  });

  it('validates exact rendered output and plans platform-native ecosystem checks', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-adapter-validate-'));
    try {
      const output = path.join(root, 'adapters');
      const manifest = makeManifest();
      const channels = 'homebrew,scoop,winget,chocolatey,pypi';
      writeRenderedOutput(manifest, renderAdapters(manifest, channels), output);
      expect(validateAdapters(manifest, output, channels)).toMatchObject({
        valid: true,
        channels: ['homebrew', 'scoop', 'winget', 'chocolatey', 'pypi'],
        structural: {
          homebrew: {valid: true},
          scoop: {valid: true},
          winget: {valid: true},
          chocolatey: {valid: true},
          pypi: {valid: true},
        },
      });

      const windowsPlan = nativeValidationPlan(
        output,
        ['homebrew', 'scoop', 'winget', 'chocolatey', 'pypi'],
        'win32',
        path.join(root, 'native-output')
      );
      expect(windowsPlan.find(step => step.channel === 'homebrew')).toMatchObject({skipped: true});
      expect(windowsPlan.find(step => step.channel === 'scoop')).toMatchObject({command: 'pwsh'});
      expect(windowsPlan.find(step => step.channel === 'winget')).toMatchObject({
        command: 'winget',
        args: expect.arrayContaining(['validate']),
      });
      expect(windowsPlan.find(step => step.channel === 'chocolatey')).toMatchObject({
        command: 'choco',
        args: expect.arrayContaining(['pack']),
      });
      expect(windowsPlan.find(step => step.channel === 'pypi')).toMatchObject({command: 'python.exe'});
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('fails closed on stale adapters and native validation errors', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-adapter-native-'));
    try {
      const output = path.join(root, 'adapters');
      const manifest = makeManifest();
      writeRenderedOutput(manifest, renderAdapters(manifest, 'homebrew'), output);
      expect(() => validateAdapters(manifest, output, 'homebrew', {
        native: true,
        platform: 'darwin',
        runner: () => ({status: 1, stderr: 'formula validation failed'}),
      })).toThrow(/formula validation failed/);

      fs.appendFileSync(path.join(output, 'homebrew/Formula/guardscan.rb'), '# drift\n');
      expect(() => validateAdapters(manifest, output, 'homebrew')).toThrow(/missing or stale/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});
