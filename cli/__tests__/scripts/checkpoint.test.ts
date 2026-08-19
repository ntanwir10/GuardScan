import fs from 'fs';
import os from 'os';
import path from 'path';

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

afterEach(() => {
  // Each test owns and removes its temporary fixture in its body.
});

describe('deterministic release checkpoints', () => {
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
