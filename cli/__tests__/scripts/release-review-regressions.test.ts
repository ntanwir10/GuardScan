import fs = require('fs');
import os = require('os');
import path = require('path');

const {transitionState} = require('../../scripts/release/ledger');
const {writeReleaseManifest, createReleaseManifest, INPUT_SCHEMA} = require('../../scripts/release/manifest');
const {createPromotionDecision} = require('../../scripts/release/promotion');
const {nativeValidationPlan} = require('../../scripts/release/validators');
const {buildWheel, launcherSource} = require('../../scripts/release/python-wheel');
const {assertCandidateVersion} = require('../../scripts/release/candidate');
const {buildArchive, inspectArchive} = require('../../scripts/release/archive');
const {validateDocument} = require('../../scripts/release/lib');

const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const source = {
  version: '1.2.3',
  tag: 'v1.2.3',
  commit,
  packageRoot: path.resolve(__dirname, '../..'),
};
const timestamp = '2026-10-01T00:00:00.000Z';

describe('release reviewer regressions', () => {
  it('deflates wheels deterministically while retaining executable modes and exact bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-wheel-compression-'));
    try {
      const executable = Buffer.alloc(4 * 1024 * 1024, 'native executable fixture\n');
      const binary = path.join(root, 'guardscan');
      fs.writeFileSync(binary, executable);
      const first = buildWheel(source, binary, {os: 'linux', arch: 'x64', libc: 'glibc'}, path.join(root, 'one'), timestamp);
      const second = buildWheel(source, binary, {os: 'linux', arch: 'x64', libc: 'glibc'}, path.join(root, 'two'), timestamp);
      const bytes = fs.readFileSync(first.wheelFile);
      expect(bytes.equals(fs.readFileSync(second.wheelFile))).toBe(true);
      expect(bytes.length).toBeLessThan(executable.length / 10);
      expect(inspectArchive(first.wheelFile, 'zip').entries).toContainEqual(expect.objectContaining({
        path: 'guardscan_cli/bin/guardscan', size: executable.length, mode: '0755',
        sha256: require('crypto').createHash('sha256').update(executable).digest('hex'),
      }));
      for (const [offset, value] of [[22, 513 * 1024 * 1024], [14, 0]]) {
        const tampered = Buffer.from(bytes);
        tampered.writeUInt32LE(value, offset);
        const file = path.join(root, 'tampered-' + offset + '.zip');
        fs.writeFileSync(file, tampered);
        expect(() => inspectArchive(file, 'zip')).toThrow(/expanded size|CRC/);
      }
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
  it('requires stable promotion approval for every promotion-or-later transition', () => {
    const state = {
      schemaVersion: 'guardscan.release-state.v1',
      version: source.version,
      tag: source.tag,
      commit,
      updatedAt: timestamp,
      channels: {
        npm: {
          status: 'uploaded',
          artifactIds: ['npm:guardscan@1.2.3'],
          remoteIdentity: 'npm:guardscan@1.2.3',
          updatedAt: timestamp,
        },
      },
    };
    expect(() => transitionState(state, {
      channel: 'npm',
      expectedStatus: 'uploaded',
      targetStatus: 'verified',
      timestamp: '2026-10-01T00:01:00.000Z',
      manifestSha256: digest,
      artifactIds: ['npm:guardscan@1.2.3'],
      remoteIdentity: 'npm:guardscan@1.2.3',
    })).toThrow(/requires stable-promotion approval/);

    const plannedState = {
      ...state,
      channels: {npm: {status: 'planned', artifactIds: [], updatedAt: timestamp}},
    };
    expect(() => transitionState(plannedState, {
      channel: 'npm',
      expectedStatus: 'planned',
      targetStatus: 'verified',
      timestamp: '2026-10-01T00:01:00.000Z',
      manifestSha256: digest,
      artifactIds: ['npm:guardscan@1.2.3'],
      remoteIdentity: 'npm:guardscan@1.2.3',
    })).toThrow(/requires stable-promotion approval/);
  });

  it('does not require stable promotion approval for transitions before published', () => {
    const state = {
      schemaVersion: 'guardscan.release-state.v1',
      version: source.version,
      tag: source.tag,
      commit,
      updatedAt: timestamp,
      channels: {npm: {status: 'planned', artifactIds: [], updatedAt: timestamp}},
    };
    expect(transitionState(state, {
      channel: 'npm',
      expectedStatus: 'planned',
      targetStatus: 'uploaded',
      timestamp: '2026-10-01T00:01:00.000Z',
      manifestSha256: digest,
      artifactIds: ['npm:guardscan@1.2.3'],
      remoteIdentity: 'npm:guardscan@1.2.3',
    }).changed).toBe(true);
  });

  it.each([
    ['first sample arrives after the publication window', 91, 24 * 60, 'canary_start_late'],
    ['latest sample does not reach soak eligibility', 1, 23 * 60 + 59, 'canary_soak_incomplete'],
  ])('denies promotion when %s', (_label, firstMinute, finalMinute, reason) => {
    const channels = ['npm'];
    const published = Date.parse(timestamp);
    const canaries = Array.from({length: 24}, (_, index) => {
      const minute = Number(firstMinute) + (Number(finalMinute) - Number(firstMinute)) * index / 23;
      return {
        channel: 'npm',
        status: 'passed',
        checkedAt: new Date(published + minute * 60_000).toISOString(),
      };
    });
    const decision = createPromotionDecision({
      rc: {
        ...source,
        version: '1.2.3-rc.1',
        tag: 'v1.2.3-rc.1',
        manifestSha256: digest,
        publishedAt: timestamp,
        sourcePr: 42,
        sourcePrHead: commit,
        sourcePrBase: 'c'.repeat(40),
        sourcePrTree: 'd'.repeat(40),
      },
      currentSourcePrHead: commit,
      currentSourcePrBase: 'c'.repeat(40),
      evaluatedAt: '2026-10-02T01:00:00.000Z',
      requiredChannels: channels,
      canaries,
      incidents: [],
    });
    expect(decision.reasons).toContain(`${reason}:npm`);
  });

  it.each([
    ['published promptly with fresh evidence', 1, 24 * 60 + 1, true],
    ['started late but covered soak with fresh evidence', 91, 24 * 60 + 31, false],
  ])('validates the %s machine decision against its schema', (_label, firstMinute, finalMinute, eligible) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-promotion-schema-'));
    try {
      const publishedAt = timestamp;
      const published = Date.parse(publishedAt);
      const decision = createPromotionDecision({
        rc: {
          version: '1.2.3-rc.1',
          tag: 'v1.2.3-rc.1',
          commit,
          manifestSha256: digest,
          publishedAt,
          sourcePr: 42,
          sourcePrHead: commit,
          sourcePrBase: 'c'.repeat(40),
          sourcePrTree: 'd'.repeat(40),
        },
        currentSourcePrHead: commit,
        currentSourcePrBase: 'c'.repeat(40),
        evaluatedAt: '2026-10-02T01:00:00.000Z',
        requiredChannels: ['npm'],
        canaries: Array.from({length: 24}, (_, index) => {
          const minute = Number(firstMinute) + (Number(finalMinute) - Number(firstMinute)) * index / 23;
          return {
            channel: 'npm',
            status: 'passed',
            checkedAt: new Date(published + minute * 60_000).toISOString(),
          };
        }),
        incidents: [],
      });
      const file = path.join(root, 'decision.json');
      fs.writeFileSync(file, `${JSON.stringify(decision, null, 2)}\n`);
      expect(decision.eligible).toBe(eligible);
      expect(() => validateDocument('decision', file, source.packageRoot)).not.toThrow();
      for (const section of ['rc', 'stable']) {
        for (const field of ['sourcePrBase', 'sourcePrTree']) {
          const missing = JSON.parse(JSON.stringify(decision));
          delete missing[section][field];
          fs.writeFileSync(file, JSON.stringify(missing));
          expect(() => validateDocument('decision', file, source.packageRoot)).toThrow(new RegExp(field));
        }
      }
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('validates manifest schema before retrying and never leaves an invalid target', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-manifest-validation-'));
    const artifact = {
      id: 'checksum:invalid-name',
      kind: 'checksum',
      filename: 'invalid name.txt',
      size: 1,
      sha256: digest,
      source: {version: source.version, tag: source.tag, commit},
      capabilities: {
        coreScan: true,
        sbom: true,
        chartRendering: false,
        accurateTokenCounting: false,
      },
    };
    const descriptor = {
      schemaVersion: INPUT_SCHEMA,
      createdAt: timestamp,
      producer: {
        provider: 'github-actions',
        repository: 'ntanwir10/GuardScan',
        workflow: '.github/workflows/release.yml',
        runId: '123',
        runAttempt: 1,
        sourceRef: 'refs/tags/v1.2.3',
      },
      toolchain: {
        node: '22.12.0',
        packageManager: {name: 'npm', version: '10.0.0'},
        tools: [{name: 'release-tool', version: '1.0.0'}],
      },
      artifactFiles: ['artifact.json'],
    };
    try {
      fs.writeFileSync(path.join(root, 'artifact.json'), JSON.stringify({
        schemaVersion: 'guardscan.artifact-metadata.v1',
        version: source.version,
        tag: source.tag,
        commit,
        artifact,
      }));
      fs.writeFileSync(path.join(root, 'input.json'), JSON.stringify(descriptor));
      const manifest = createReleaseManifest(source, {...descriptor, artifacts: [artifact]});
      const contents = `${JSON.stringify(manifest, null, 2)}\n`;
      const output = path.join(root, 'manifest.json');

      fs.writeFileSync(output, contents);
      expect(() => writeReleaseManifest(source, path.join(root, 'input.json'), output))
        .toThrow(/manifest is invalid/);
      expect(fs.readFileSync(output, 'utf8')).toBe(contents);

      fs.unlinkSync(output);
      expect(() => writeReleaseManifest(source, path.join(root, 'input.json'), output))
        .toThrow(/manifest is invalid/);
      expect(fs.existsSync(output)).toBe(false);
      expect(fs.readdirSync(root).filter(name => name.includes('.tmp-'))).toEqual([]);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('uses a quoted literal Scoop manifest path and the versioned WinGet directory', () => {
    const output = path.join(os.tmpdir(), "GuardScan release's output");
    const plan = nativeValidationPlan(output, ['scoop', 'winget'], 'win32', os.tmpdir(), '1.2.3');
    const scoop = plan.find((step: any) => step.channel === 'scoop');
    const command = scoop.args[scoop.args.indexOf('-Command') + 1];
    expect(command).toContain("GuardScan release''s output");
    expect(command).not.toContain('$args[0]');
    expect(scoop.args).toHaveLength(4);
    expect(plan.find((step: any) => step.channel === 'winget').args.at(-1))
      .toBe(path.join(output, 'winget', 'manifests', 'n', 'NaumanTanwir', 'GuardScan', '1.2.3'));
    expect(() => nativeValidationPlan(output, ['winget'], 'win32'))
      .toThrow(/requires a valid release version/);
    expect(() => nativeValidationPlan(output, ['winget'], 'win32', os.tmpdir(), '../1.2.3'))
      .toThrow(/requires a valid release version/);
  });

  it('uses Core Metadata 2.4 for the wheel License-Expression field', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-wheel-metadata-'));
    try {
      const executable = path.join(root, 'guardscan');
      fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', {mode: 0o755});
      const built = buildWheel(
        source,
        executable,
        {os: 'darwin', arch: 'arm64'},
        path.join(root, 'dist'),
        timestamp
      );
      const archive = fs.readFileSync(built.wheelFile);
      const entries = inspectArchive(built.wheelFile, 'zip').entries;
      expect(entries.some((entry: any) => entry.path.endsWith('.dist-info/METADATA'))).toBe(true);
      let localOffset = 0;
      let metadata = '';
      while (archive.readUInt32LE(localOffset) === 0x04034b50) {
        const length = archive.readUInt32LE(localOffset + 18);
        const nameLength = archive.readUInt16LE(localOffset + 26);
        const name = archive.subarray(localOffset + 30, localOffset + 30 + nameLength).toString('utf8');
        const start = localOffset + 30 + nameLength;
        if (name.endsWith('.dist-info/METADATA')) {
          metadata = require('zlib').inflateRawSync(archive.subarray(start, start + length)).toString('utf8');
        }
        localOffset = start + length;
      }
      expect(metadata).toContain('Metadata-Version: 2.4\n');
      expect(metadata).toContain('License-Expression: MIT\n');
      const executableName = 'guardscan_cli/bin/guardscan';
      let offset = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      let executableUnixMode = 0;
      while (offset >= 0 && offset + 46 <= archive.length
          && archive.readUInt32LE(offset) === 0x02014b50) {
        const nameLength = archive.readUInt16LE(offset + 28);
        const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
        if (name === executableName) {
          executableUnixMode = (archive.readUInt32LE(offset + 38) >>> 16) & 0xffff;
          break;
        }
        offset = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset + 46 + nameLength);
      }
      expect(executableUnixMode & 0xf000).toBe(0x8000);
      expect(executableUnixMode & 0o777).toBe(0o755);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('uses stable UTF-8 byte ordering and marks ZIP entries as regular files', () => {
    const entries = [
      {name: '𐀀.txt', data: Buffer.from('supplementary')},
      {name: 'z.txt', data: Buffer.from('ascii')},
      {name: 'é.txt', data: Buffer.from('accented')},
    ];
    const archive = buildArchive('zip', entries, timestamp);
    const second = buildArchive('zip', entries, timestamp);
    expect(archive.equals(second)).toBe(true);
    const expected = entries.map(entry => entry.name).sort((left, right) => (
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
    ));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-archive-mode-'));
    try {
      const file = path.join(root, 'archive.zip');
      fs.writeFileSync(file, archive);
      const inspected = inspectArchive(file, 'zip');
      expect(inspected.entries.map((entry: any) => entry.path)).toEqual(expected);
      expect(inspected.entries.map((entry: any) => entry.mode)).toEqual(['0644', '0644', '0644']);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it.each(['1.2.3-rc.1.extra', '1.2.3-rc.1+build.2'])('rejects non-exact release candidate %s', version => {
    expect(() => assertCandidateVersion('1.2.3', version)).toThrow(/candidate version/);
  });
});
