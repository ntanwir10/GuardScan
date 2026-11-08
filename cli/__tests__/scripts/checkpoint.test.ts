import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import vm from 'vm';

const {createCheckpoint, verifyCheckpoint} = require('../../scripts/release/checkpoint') as {
  createCheckpoint: (source: Record<string, any>, options: Record<string, any>) => Record<string, any>;
  verifyCheckpoint: (source: Record<string, any>, options: Record<string, any>) => Record<string, any>;
};

const source = {
  version: '1.2.3',
  tag: 'v1.2.3',
  commit: 'a'.repeat(40),
};
const producer = {
  provider: 'github-actions',
  repository: 'ntanwir10/GuardScan',
  workflow: '.github/workflows/release-train.yml',
  runId: '123456',
  runAttempt: 1,
  sourceRef: 'refs/tags/v1.2.3',
};
const timestamp = '2026-08-12T12:00:00.000Z';

function fixture(): {root: string; output: string} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-checkpoint-test-'));
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'README.md'), 'checkpoint\n');
  fs.writeFileSync(path.join(root, 'nested', 'file.txt'), 'nested file\n');
  return {root, output: path.join(root, 'output')};
}

function productionFiles(): string[] {
  const {REQUIRED_NATIVE_TARGETS} = require('../../scripts/release/manifest');
  const {PLATFORM_TAGS} = require('../../scripts/release/python-wheel');
  return [
    ...REQUIRED_NATIVE_TARGETS.flatMap((target: string) => [
      `payload/guardscan-${source.version}-${target}.${target.startsWith('linux') ? 'tar.gz' : 'zip'}`,
      `payload/guardscan_cli-${source.version}-py3-none-${PLATFORM_TAGS[target]}.whl`,
      ...['spdx', 'cyclonedx'].map(format => `payload/guardscan-${source.version}-${target}.${format}.json`),
      ...['executable', 'archive', 'wheel'].map(subject => `payload/${target}.${subject}.provenance.sigstore.json`),
      ...(target.startsWith('darwin') ? [
        `payload/${target}.apple-code-signing.txt`, `payload/${target}.apple-notarization.json`,
        `payload/${target}.stapled-notarization.dmg`, `payload/${target}.dmg.apple-notarization.json`,
      ] : [`payload/${target}.${target.startsWith('linux') ? 'guardscan.sigstore.json' : 'authenticode.txt'}`]),
    ]),
    `payload/guardscan-${source.version}.tgz`, 'payload/npm.provenance.sigstore.json',
    'payload/release-manifest.json', 'payload/release-build-provenance.json',
    'payload/SHA256SUMS', 'payload/SHA256SUMS.sigstore.json', 'npm-artifact/npm-artifact.json',
  ];
}

afterEach(() => {
  // Each test owns and removes its temporary fixture in its body.
});

describe('deterministic release checkpoints', () => {
  it('rejects mismatched new archive names without installing either file', () => {
    const {root, output} = fixture();
    try {
      expect(() => createCheckpoint(source, {
        root, outputDir: output, archiveFile: path.join(output, 'wrong.tar.gz'),
        files: ['README.md'], producer, timestamp,
      })).toThrow(/archive filename/);
      expect(fs.existsSync(output)).toBe(false);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('creates a sorted archive and verifies its sidecar and extraction', () => {
    const first = fixture();
    const second = fixture();
    try {
      const options = {files: ['nested/file.txt', 'README.md'], producer, timestamp};
      const one = createCheckpoint(source, {...options, outputDir: first.output, root: first.root});
      const two = createCheckpoint(source, {...options, outputDir: second.output, root: second.root});
      expect(fs.readFileSync(one.archiveFile).equals(fs.readFileSync(two.archiveFile))).toBe(true);
      expect(one.sidecar.files.map((file: any) => file.path)).toEqual(['README.md', 'nested/file.txt']);
      expect(verifyCheckpoint(source, {
        archiveFile: one.archiveFile,
        sidecarFile: one.sidecarFile,
        root: first.root,
      })).toMatchObject({valid: true, files: one.sidecar.files});
    } finally {
      fs.rmSync(first.root, {recursive: true, force: true});
      fs.rmSync(second.root, {recursive: true, force: true});
    }
  });

  it('round-trips the complete five-target production payload and its npm metadata', () => {
    const {root, output} = fixture();
    const files = productionFiles();
    try {
      expect(files).toHaveLength(53);
      for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
        fs.writeFileSync(path.join(root, file), `bytes for ${file}`);
      }
      const result = createCheckpoint(source, {outputDir: output, root, files, producer, timestamp});
      const extraction = path.join(root, 'production-extracted');
      const verified = verifyCheckpoint(source, {
        archiveFile: result.archiveFile, sidecarFile: result.sidecarFile, extractDir: extraction,
      });
      expect(verified.files.map((file: any) => file.path)).toEqual([...files].sort());
      for (const file of files) {
        expect(fs.readFileSync(path.join(extraction, file), 'utf8')).toBe(`bytes for ${file}`);
      }
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('enforces the checkpoint file boundary in creation, sidecars, and archive inspection', () => {
    const {MAX_CHECKPOINT_FILES} = require('../../scripts/release/checkpoint');
    const {buildArchive} = require('../../scripts/release/archive');
    const {root, output} = fixture();
    const files = Array.from({length: MAX_CHECKPOINT_FILES}, (_, index) => `file-${index}.json`);
    try {
      for (const file of files) fs.writeFileSync(path.join(root, file), file);
      const result = createCheckpoint(source, {outputDir: output, root, files, producer, timestamp});
      expect(result.sidecar.files).toHaveLength(MAX_CHECKPOINT_FILES);
      expect(() => createCheckpoint(source, {
        outputDir: path.join(root, 'over-limit'), root, files: [...files, 'extra.json'], producer, timestamp,
      })).toThrow(/checkpoint must contain/);

      const sidecar = JSON.parse(fs.readFileSync(result.sidecarFile, 'utf8'));
      const oversized = {...sidecar, files: [...sidecar.files, {...sidecar.files[0], path: 'extra.json'}]};
      fs.writeFileSync(result.sidecarFile, JSON.stringify(oversized));
      expect(() => verifyCheckpoint(source, {archiveFile: result.archiveFile, sidecarFile: result.sidecarFile}))
        .toThrow(/maxItems|more than 64/);

      const tar = zlib.gunzipSync(fs.readFileSync(result.archiveFile));
      const extra = zlib.gunzipSync(buildArchive('tar.gz', [{name: 'extra.json', data: Buffer.from('extra')}], timestamp));
      const archive = zlib.gzipSync(Buffer.concat([tar.subarray(0, -1024), extra]));
      fs.writeFileSync(result.archiveFile, archive);
      sidecar.archive.size = archive.length;
      sidecar.archive.sha256 = crypto.createHash('sha256').update(archive).digest('hex');
      fs.writeFileSync(result.sidecarFile, JSON.stringify(sidecar));
      expect(() => verifyCheckpoint(source, {archiveFile: result.archiveFile, sidecarFile: result.sidecarFile}))
        .toThrow(/too many entries/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('preserves native and wheel archive count and decompression limits', () => {
    const {buildArchive, inspectArchive, MAX_ARCHIVE_ENTRIES, MAX_EXPANDED_BYTES} = require('../../scripts/release/archive');
    const {root} = fixture();
    const entries = Array.from({length: MAX_ARCHIVE_ENTRIES + 1}, (_, index) => ({name: `file-${index}`, data: Buffer.from('x')}));
    try {
      for (const format of ['tar.gz', 'zip']) {
        expect(() => buildArchive(format, entries, timestamp)).toThrow(/archive must contain 1-32/);
      }
      const file = path.join(root, 'checkpoint.tar.gz');
      fs.writeFileSync(file, buildArchive('tar.gz', entries, timestamp, {checkpoint: true}));
      expect(() => inspectArchive(file, 'tar.gz')).toThrow(/too many entries/);
      expect(inspectArchive(file, 'tar.gz', undefined, {checkpoint: true}).entries).toHaveLength(33);

      const zip = Buffer.alloc(31);
      zip.writeUInt32LE(0x04034b50, 0);
      zip.writeUInt16LE(8, 8);
      zip.writeUInt32LE(MAX_EXPANDED_BYTES + 1, 22);
      fs.writeFileSync(path.join(root, 'bomb.zip'), zip);
      expect(() => inspectArchive(path.join(root, 'bomb.zip'), 'zip', undefined, {checkpoint: true}))
        .toThrow(/expanded size exceeds/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('includes TAR framing in source and sidecar expansion bounds before reading payload bytes', () => {
    const {MAX_CHECKPOINT_EXPANDED_BYTES} = require('../../scripts/release/archive');
    const {root, output} = fixture();
    try {
      const result = createCheckpoint(source, {outputDir: output, root, files: ['README.md'], producer, timestamp});
      const sidecar = JSON.parse(fs.readFileSync(result.sidecarFile, 'utf8'));
      sidecar.files[0].size = MAX_CHECKPOINT_EXPANDED_BYTES - 1024;
      fs.writeFileSync(result.sidecarFile, JSON.stringify(sidecar));
      expect(() => verifyCheckpoint(source, {archiveFile: result.archiveFile, sidecarFile: result.sidecarFile}))
        .toThrow(/expanded size exceeds/);

      const large = path.join(root, 'large-payload');
      fs.writeFileSync(large, 'small test fixture');
      const lstat = fs.lstatSync;
      const largeStat = Object.assign(Object.create(lstat(large)), {size: MAX_CHECKPOINT_EXPANDED_BYTES - 1024});
      const spy = jest.spyOn(fs, 'lstatSync').mockImplementation(((file: any, ...options: any[]) => (
        String(file) === large ? largeStat : (lstat as any)(file, ...options)
      )) as any);
      try {
        expect(() => createCheckpoint(source, {
          outputDir: path.join(root, 'large-output'), root, files: ['large-payload'], producer, timestamp,
        })).toThrow(/expanded size exceeds/);
      } finally {
        spy.mockRestore();
      }
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('enforces TAR framing and gzip bomb bounds with lowered test-only byte limits', () => {
    const archivePath = path.resolve(__dirname, '../../scripts/release/archive.js');
    const code = fs.readFileSync(archivePath, 'utf8')
      .replace('const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;', 'const MAX_EXPANDED_BYTES = 2048;')
      .replace('const MAX_CHECKPOINT_EXPANDED_BYTES = 1024 * 1024 * 1024;', 'const MAX_CHECKPOINT_EXPANDED_BYTES = 4096;');
    const module = {exports: {} as any};
    vm.runInNewContext(code, {module, Buffer, require: (name: string) => (
      require(name.startsWith('.') ? path.resolve(path.dirname(archivePath), name) : name)
    )});
    const bounded = module.exports;
    expect(bounded.MAX_EXPANDED_BYTES).toBe(2048);
    expect(bounded.MAX_CHECKPOINT_EXPANDED_BYTES).toBe(4096);
    const entry = (size: number) => [{name: 'payload', data: Buffer.alloc(size)}];
    const {root} = fixture();
    try {
      expect(() => bounded.buildArchive('tar.gz', entry(512), timestamp)).not.toThrow();
      expect(() => bounded.buildArchive('tar.gz', entry(513), timestamp)).toThrow(/expanded size exceeds/);
      expect(() => bounded.buildArchive('tar.gz', entry(2561), timestamp, {checkpoint: true}))
        .toThrow(/expanded size exceeds/);
      const file = path.join(root, 'bounded.tar.gz');
      fs.writeFileSync(file, bounded.buildArchive('tar.gz', entry(2560), timestamp, {checkpoint: true}));
      expect(bounded.inspectArchive(file, 'tar.gz', undefined, {checkpoint: true}).entries).toHaveLength(1);
      expect(() => bounded.inspectArchive(file, 'tar.gz')).toThrow(/unbounded/);
      const {buildArchive} = require('../../scripts/release/archive');
      fs.writeFileSync(file, buildArchive('tar.gz', entry(4096), timestamp, {checkpoint: true}));
      expect(() => bounded.inspectArchive(file, 'tar.gz', undefined, {checkpoint: true})).toThrow(/unbounded/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('bounds the checkpoint extraction parser as well as its initial inspection', () => {
    const {MAX_CHECKPOINT_EXPANDED_BYTES} = require('../../scripts/release/archive');
    const {root, output} = fixture();
    const gunzip = zlib.gunzipSync;
    try {
      const result = createCheckpoint(source, {outputDir: output, root, files: ['README.md'], producer, timestamp});
      let calls = 0;
      const spy = jest.spyOn(zlib, 'gunzipSync').mockImplementation(((buffer: any, options: any) => {
        calls += 1;
        return gunzip(buffer, {...options, maxOutputLength: calls === 2 ? 1024 : options.maxOutputLength});
      }) as any);
      try {
        expect(() => verifyCheckpoint(source, {archiveFile: result.archiveFile, sidecarFile: result.sidecarFile}))
          .toThrow(/larger than|size|limit/i);
        expect(spy).toHaveBeenCalledTimes(2);
        for (const call of spy.mock.calls) expect(call[1]).toEqual({maxOutputLength: MAX_CHECKPOINT_EXPANDED_BYTES});
      } finally {
        spy.mockRestore();
      }
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('rejects traversal, duplicates, and symlinks', () => {
    const {root, output} = fixture();
    try {
      const base = {outputDir: output, root, producer, timestamp};
      expect(() => createCheckpoint(source, {...base, files: ['../README.md']})).toThrow(/unsafe/);
      expect(() => createCheckpoint(source, {...base, files: ['README.md', 'README.md']})).toThrow(/duplicate/);
      fs.symlinkSync(path.join(root, 'README.md'), path.join(root, 'link.md'));
      expect(() => createCheckpoint(source, {...base, files: ['link.md']})).toThrow(/symlink/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('rejects archive tampering and source digest drift', () => {
    const {root, output} = fixture();
    try {
      const result = createCheckpoint(source, {
        outputDir: output,
        root,
        files: ['README.md'],
        producer,
        timestamp,
      });
      const archive = fs.readFileSync(result.archiveFile);
      archive[archive.length - 1] ^= 1;
      fs.writeFileSync(result.archiveFile, archive);
      expect(() => verifyCheckpoint(source, {
        archiveFile: result.archiveFile,
        sidecarFile: result.sidecarFile,
        root,
      })).toThrow(/digest/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('rejects producer metadata that is not bound to the release tag', () => {
    const {root, output} = fixture();
    try {
      expect(() => createCheckpoint(source, {
        outputDir: output,
        root,
        files: ['README.md'],
        producer: {...producer, sourceRef: 'refs/tags/v9.9.9'},
        timestamp,
      })).toThrow(/source ref/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('atomically materializes verified extraction output and rejects non-empty destinations', () => {
    const {root, output} = fixture();
    const extraction = path.join(root, 'extracted');
    try {
      const result = createCheckpoint(source, {
        outputDir: output,
        root,
        files: ['README.md', 'nested/file.txt'],
        producer,
        timestamp,
      });
      expect(verifyCheckpoint(source, {
        archiveFile: result.archiveFile,
        sidecarFile: result.sidecarFile,
        extractDir: extraction,
      })).toMatchObject({valid: true, extractionDir: extraction});
      expect(fs.readFileSync(path.join(extraction, 'README.md'), 'utf8')).toBe('checkpoint\n');
      expect(fs.readFileSync(path.join(extraction, 'nested', 'file.txt'), 'utf8'))
        .toBe('nested file\n');

      const nonEmpty = path.join(root, 'non-empty');
      fs.mkdirSync(nonEmpty);
      fs.writeFileSync(path.join(nonEmpty, 'keep.txt'), 'keep');
      expect(() => verifyCheckpoint(source, {
        archiveFile: result.archiveFile,
        sidecarFile: result.sidecarFile,
        extractDir: nonEmpty,
      })).toThrow(/not empty/);
      expect(fs.readFileSync(path.join(nonEmpty, 'keep.txt'), 'utf8')).toBe('keep');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});
