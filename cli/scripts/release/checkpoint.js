'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const {compareUtf8} = require('./deterministic');
const {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_EXPANDED_BYTES,
  inspectArchive,
  normalizeArchivePath,
  writeArchive,
} = require('./archive');

const CHECKPOINT_SCHEMA = 'guardscan.release-checkpoint.v1';
const ARCHIVE_FORMAT = 'tar.gz';
const MAX_CHECKPOINT_FILES = MAX_ARCHIVE_ENTRIES;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const MAX_SIDECAR_BYTES = 1024 * 1024;
const checkpointSchema = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'schemas', 'guardscan.release-checkpoint.v1.schema.json'),
  'utf8'
));
const checkpointAjv = new Ajv({allErrors: true, strict: false});
addFormats(checkpointAjv);
const validateCheckpointSchema = checkpointAjv.compile(checkpointSchema);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort(compareUtf8).map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function assertIdentity(source) {
  if (!source || typeof source !== 'object') throw new Error('checkpoint source is required');
  if (typeof source.version !== 'string' || source.tag !== `v${source.version}`) {
    throw new Error('checkpoint version and tag do not match');
  }
  if (!COMMIT_PATTERN.test(source.commit || '')) throw new Error('checkpoint commit is invalid');
}

function assertTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
    throw new Error('checkpoint timestamp must be canonical');
  }
}

function assertProducer(producer, source) {
  if (!producer || typeof producer !== 'object' || Array.isArray(producer)) {
    throw new Error('checkpoint producer is required');
  }
  const required = ['provider', 'repository', 'workflow', 'runId', 'runAttempt', 'sourceRef'];
  if (required.some(field => producer[field] === undefined)) {
    throw new Error('checkpoint producer is incomplete');
  }
  if (producer.provider !== 'github-actions' || producer.repository !== 'ntanwir10/GuardScan') {
    throw new Error('checkpoint producer identity is invalid');
  }
  if (!/^\.github\/workflows\/[A-Za-z0-9._-]+\.yml$/.test(producer.workflow || '')
      || !/^[1-9][0-9]{0,19}$/.test(producer.runId || '')
      || !Number.isSafeInteger(producer.runAttempt) || producer.runAttempt < 1
      || !/^refs\/(heads|tags)\/[A-Za-z0-9._/-]+$/.test(producer.sourceRef || '')) {
    throw new Error('checkpoint producer metadata is invalid');
  }
  if (Object.keys(producer).some(field => !required.includes(field))) {
    throw new Error('checkpoint producer contains unknown fields');
  }
  if (source && producer.sourceRef !== `refs/tags/${source.tag}`) {
    throw new Error('checkpoint producer source ref does not match release tag');
  }
}

function normalizePaths(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_CHECKPOINT_FILES) {
    throw new Error(`checkpoint must contain 1-${MAX_CHECKPOINT_FILES} files`);
  }
  const seen = new Set();
  return files.map(file => {
    if (typeof file !== 'string') throw new Error('checkpoint file path must be a string');
    const normalized = normalizeArchivePath(file);
    const folded = normalized.toLocaleLowerCase('en-US');
    if (seen.has(folded)) throw new Error(`checkpoint contains duplicate file: ${normalized}`);
    seen.add(folded);
    return normalized;
  }).sort(compareUtf8);
}

function assertRegularPath(root, relative) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relative.split('/'));
  const relativeToRoot = path.relative(resolvedRoot, resolved);
  if (relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    throw new Error(`checkpoint file escapes source root: ${relative}`);
  }
  let current = resolvedRoot;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`checkpoint file path contains a symlink: ${relative}`);
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile()) throw new Error(`checkpoint file is not regular: ${relative}`);
  return {resolved, stat};
}

function readEntries(root, files) {
  return files.map(relative => {
    const {resolved, stat} = assertRegularPath(root, relative);
    const data = fs.readFileSync(resolved);
    return {
      name: relative,
      data,
      mode: stat.mode & 0o777,
    };
  });
}

function fileMetadata(entries) {
  return entries.map(entry => ({
    path: entry.name,
    size: entry.data.length,
    mode: entry.mode.toString(8).padStart(4, '0'),
    sha256: sha256(entry.data),
  }));
}

function assertNoSymlinkComponents(target) {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  let current = root;
  for (const segment of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        const tempRoot = path.resolve(os.tmpdir());
        const isSystemTempAlias = tempRoot.startsWith(`${current}${path.sep}`)
          && resolved.startsWith(`${tempRoot}${path.sep}`);
        if (!isSystemTempAlias) {
          throw new Error(`checkpoint extraction path contains a symlink: ${target}`);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return resolved;
}

function prepareExtraction(extractDir) {
  const destination = assertNoSymlinkComponents(extractDir);
  const parent = path.dirname(destination);
  assertNoSymlinkComponents(parent);
  fs.mkdirSync(parent, {recursive: true, mode: 0o700});
  let existed = false;
  try {
    const stat = fs.lstatSync(destination);
    if (stat.isSymbolicLink()) throw new Error(`checkpoint extraction path is a symlink: ${destination}`);
    if (!stat.isDirectory()) throw new Error(`checkpoint extraction path is not a directory: ${destination}`);
    if (fs.readdirSync(destination).length > 0) {
      throw new Error(`checkpoint extraction path is not empty: ${destination}`);
    }
    existed = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const stage = fs.mkdtempSync(path.join(parent, `.${path.basename(destination)}.tmp-`));
  return {destination, existed, stage};
}

function finalizeExtraction(extraction) {
  if (extraction.existed) {
    // Removing only the verified-empty directory lets the staged tree take its
    // place with one rename while never overwriting a concurrent destination.
    fs.rmdirSync(extraction.destination);
  }
  try {
    fs.renameSync(extraction.stage, extraction.destination);
  } catch (error) {
    // Preserve an originally empty destination if a rename race prevents the
    // staged tree from taking its place. Never remove or overwrite a racer.
    if (extraction.existed && !fs.existsSync(extraction.destination)) {
      try { fs.mkdirSync(extraction.destination, {mode: 0o700}); } catch {}
    }
    throw error;
  }
  return extraction.destination;
}

function checkpointNames(source, options) {
  const archiveFilename = options.archiveFilename
    || `guardscan-release-checkpoint-${source.version}.tar.gz`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*\.tar\.gz$/.test(archiveFilename)) {
    throw new Error('checkpoint archive filename is unsafe');
  }
  const sidecarFilename = options.sidecarFilename || `${archiveFilename}.metadata.json`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*\.json$/.test(sidecarFilename)) {
    throw new Error('checkpoint sidecar filename is unsafe');
  }
  return {archiveFilename, sidecarFilename};
}

function sidecarDocument(source, timestamp, producer, archive, files) {
  return canonicalize({
    schemaVersion: CHECKPOINT_SCHEMA,
    version: source.version,
    tag: source.tag,
    commit: source.commit,
    createdAt: timestamp,
    producer,
    archive: {
      filename: archive.filename,
      format: ARCHIVE_FORMAT,
      size: archive.size,
      sha256: archive.sha256,
    },
    files,
  });
}

function assertSidecar(source, sidecar) {
  assertIdentity(source);
  if (!validateCheckpointSchema(sidecar)) {
    throw new Error(`checkpoint sidecar is invalid: ${checkpointAjv.errorsText(validateCheckpointSchema.errors)}`);
  }
  if (!sidecar || sidecar.schemaVersion !== CHECKPOINT_SCHEMA) {
    throw new Error('checkpoint sidecar schema is unsupported');
  }
  const expectedFields = ['archive', 'commit', 'createdAt', 'files', 'producer', 'schemaVersion', 'tag', 'version'];
  if (Object.keys(sidecar).sort(compareUtf8).join('\n') !== expectedFields.join('\n')) {
    throw new Error('checkpoint sidecar contains unknown or missing fields');
  }
  for (const field of ['version', 'tag', 'commit']) {
    if (sidecar[field] !== source[field]) throw new Error(`checkpoint ${field} does not match source`);
  }
  assertTimestamp(sidecar.createdAt);
  assertProducer(sidecar.producer, source);
  if (!sidecar.archive || Object.keys(sidecar.archive).sort(compareUtf8).join('\n') !== 'filename\nformat\nsha256\nsize'
      || !/^[A-Za-z0-9][A-Za-z0-9._+-]*\.tar\.gz$/.test(sidecar.archive.filename || '')
      || sidecar.archive.format !== ARCHIVE_FORMAT
      || !Number.isSafeInteger(sidecar.archive.size) || sidecar.archive.size <= 0
      || !SHA256_PATTERN.test(sidecar.archive.sha256 || '')) {
    throw new Error('checkpoint archive metadata is invalid');
  }
  if (!Array.isArray(sidecar.files) || sidecar.files.length < 1) {
    throw new Error('checkpoint sidecar contains no files');
  }
  const paths = normalizePaths(sidecar.files.map(file => file.path));
  if (paths.join('\n') !== sidecar.files.map(file => file.path).join('\n')) {
    throw new Error('checkpoint files are not sorted');
  }
  for (const file of sidecar.files) {
    if (!file || Object.keys(file).sort(compareUtf8).join('\n') !== 'mode\npath\nsha256\nsize') {
      throw new Error('checkpoint file metadata contains unknown or missing fields');
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0
        || !/^[0-7]{4}$/.test(file.mode || '') || !SHA256_PATTERN.test(file.sha256 || '')) {
      throw new Error(`checkpoint file metadata is invalid: ${file.path}`);
    }
  }
}

function parseTarEntries(buffer) {
  const tar = zlib.gunzipSync(buffer, {maxOutputLength: MAX_EXPANDED_BYTES});
  const entries = [];
  let offset = 0;
  let zeroBlocks = 0;
  const names = new Set();
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every(byte => byte === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) break;
      continue;
    }
    if (zeroBlocks > 0) throw new Error('checkpoint archive contains data after its end marker');
    const headerOffset = offset - 512;
    const raw = (start, length) => tar.subarray(headerOffset + start, headerOffset + start + length)
      .toString('ascii').replace(/\0.*$/, '').trim();
    const checksum = raw(148, 8);
    if (!/^[0-7]+$/.test(checksum)) throw new Error('checkpoint archive checksum is invalid');
    const checked = Buffer.from(header);
    checked.fill(0x20, 148, 156);
    if (Number.parseInt(checksum, 8) !== checked.reduce((sum, byte) => sum + byte, 0)) {
      throw new Error('checkpoint archive checksum mismatch');
    }
    const name = normalizeArchivePath(raw(0, 100));
    const folded = name.toLocaleLowerCase('en-US');
    if (names.has(folded)) throw new Error(`checkpoint archive contains duplicate: ${name}`);
    names.add(folded);
    if (![0, 0x30].includes(header[156])) throw new Error(`checkpoint archive contains a link: ${name}`);
    const sizeText = raw(124, 12);
    const modeText = raw(100, 8);
    if (!/^[0-7]+$/.test(sizeText) || !/^[0-7]+$/.test(modeText)) {
      throw new Error(`checkpoint archive metadata is invalid: ${name}`);
    }
    const size = Number.parseInt(sizeText, 8);
    const mode = Number.parseInt(modeText, 8) & 0o777;
    if (!Number.isSafeInteger(size) || offset + size > tar.length) {
      throw new Error(`checkpoint archive entry is truncated: ${name}`);
    }
    const data = Buffer.from(tar.subarray(offset, offset + size));
    entries.push({name, data, mode});
    offset += Math.ceil(size / 512) * 512;
  }
  if (zeroBlocks !== 2 || tar.subarray(offset).some(byte => byte !== 0)) {
    throw new Error('checkpoint archive end marker is invalid');
  }
  return entries;
}

function verifyExtractedFiles(archiveFile, sidecar, options = {}) {
  const archiveStat = fs.statSync(archiveFile);
  if (!archiveStat.isFile() || archiveStat.size <= 0 || archiveStat.size > MAX_ARCHIVE_BYTES) {
    throw new Error('checkpoint archive size is outside the supported range');
  }
  const archive = fs.readFileSync(archiveFile);
  if (archive.length !== sidecar.archive.size || sha256(archive) !== sidecar.archive.sha256) {
    throw new Error('checkpoint archive digest does not match sidecar');
  }
  const inspected = inspectArchive(archiveFile, ARCHIVE_FORMAT, sidecar.files.map(file => file.path));
  if (inspected.sha256 !== sidecar.archive.sha256 || inspected.size !== sidecar.archive.size) {
    throw new Error('checkpoint archive inspection does not match sidecar');
  }
  const entries = parseTarEntries(archive);
  const expected = new Map(sidecar.files.map(file => [file.path, file]));
  const extraction = options.extractDir
    ? prepareExtraction(options.extractDir)
    : {destination: undefined, existed: false, stage: fs.mkdtempSync(
      path.join(options.tempRoot || os.tmpdir(), 'guardscan-checkpoint-')
    )};
  try {
    for (const entry of entries) {
      const metadata = expected.get(entry.name);
      if (!metadata || entry.data.length !== metadata.size || sha256(entry.data) !== metadata.sha256
          || entry.mode.toString(8).padStart(4, '0') !== metadata.mode) {
        throw new Error(`checkpoint extracted file digest or mode mismatch: ${entry.name}`);
      }
      const target = path.join(extraction.stage, ...entry.name.split('/'));
      fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
      fs.writeFileSync(target, entry.data, {mode: entry.mode, flag: 'wx'});
      const stat = fs.statSync(target);
      if (!stat.isFile() || stat.size !== metadata.size || sha256(fs.readFileSync(target)) !== metadata.sha256) {
        throw new Error(`checkpoint extraction verification failed: ${entry.name}`);
      }
    }
    if (entries.length !== expected.size) throw new Error('checkpoint archive file count does not match sidecar');
    if (options.root) {
      const current = fileMetadata(readEntries(options.root, sidecar.files.map(file => file.path)));
      if (canonicalJson(current) !== canonicalJson(sidecar.files)) {
        throw new Error('checkpoint source files do not match sidecar');
      }
    }
    const extractionDir = options.extractDir ? finalizeExtraction(extraction) : undefined;
    return {
      size: inspected.size,
      sha256: inspected.sha256,
      files: sidecar.files,
      ...(extractionDir ? {extractionDir} : {}),
    };
  } finally {
    fs.rmSync(extraction.stage, {recursive: true, force: true});
  }
}

function verifyCheckpoint(source, options = {}) {
  assertIdentity(source);
  const archiveFile = path.resolve(options.archiveFile || options.archive || '');
  const sidecarFile = path.resolve(options.sidecarFile || options.sidecar || '');
  if (!options.archiveFile && !options.archive) throw new Error('checkpoint archive file is required');
  if (!options.sidecarFile && !options.sidecar) throw new Error('checkpoint sidecar file is required');
  const sidecarStat = fs.statSync(sidecarFile);
  if (!sidecarStat.isFile() || sidecarStat.size <= 0 || sidecarStat.size > MAX_SIDECAR_BYTES) {
    throw new Error('checkpoint sidecar size is outside the supported range');
  }
  const sidecar = JSON.parse(fs.readFileSync(sidecarFile, 'utf8'));
  assertSidecar(source, sidecar);
  if (path.basename(archiveFile) !== sidecar.archive.filename) {
    throw new Error('checkpoint archive filename does not match sidecar');
  }
  return {valid: true, ...verifyExtractedFiles(archiveFile, sidecar, options), sidecar};
}

function createCheckpoint(source, options = {}) {
  assertIdentity(source);
  assertTimestamp(options.timestamp);
  const producer = options.producer || source.producer;
  assertProducer(producer, source);
  const root = options.root || options.sourceRoot || source.repositoryRoot;
  if (!root) throw new Error('checkpoint source root is required');
  const files = normalizePaths(options.files);
  const entries = readEntries(root, files);
  const metadata = fileMetadata(entries);
  const names = checkpointNames(source, options);
  const outputDir = path.resolve(options.outputDir || path.dirname(path.resolve(options.archiveFile || names.archiveFilename)));
  const archiveFile = path.resolve(options.archiveFile || path.join(outputDir, names.archiveFilename));
  const sidecarFile = path.resolve(options.sidecarFile || path.join(outputDir, names.sidecarFilename));
  if (fs.existsSync(archiveFile) || fs.existsSync(sidecarFile)) {
    return {created: false, ...verifyCheckpoint(source, {archiveFile, sidecarFile, root})};
  }
  fs.mkdirSync(path.dirname(archiveFile), {recursive: true, mode: 0o700});
  if (path.dirname(sidecarFile) !== path.dirname(archiveFile)) {
    fs.mkdirSync(path.dirname(sidecarFile), {recursive: true, mode: 0o700});
  }
  const archiveTemp = `${archiveFile}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const sidecarTemp = `${sidecarFile}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    const archive = writeArchive(archiveTemp, ARCHIVE_FORMAT, entries, options.timestamp);
    const inspected = inspectArchive(archiveTemp, ARCHIVE_FORMAT, files);
    if (archive.sha256 !== inspected.sha256 || canonicalJson(archive.entries) !== canonicalJson(inspected.entries)) {
      throw new Error('checkpoint archive failed deterministic structural verification');
    }
    const document = sidecarDocument(
      source,
      options.timestamp,
      producer,
      {...archive, filename: names.archiveFilename},
      metadata
    );
    fs.writeFileSync(sidecarTemp, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    });
    fs.renameSync(archiveTemp, archiveFile);
    fs.renameSync(sidecarTemp, sidecarFile);
    return {
      created: true,
      archiveFile,
      sidecarFile,
      sidecar: document,
      ...verifyCheckpoint(source, {archiveFile, sidecarFile, root}),
    };
  } finally {
    for (const file of [archiveTemp, sidecarTemp]) {
      try { fs.rmSync(file, {force: true}); } catch {}
    }
  }
}

module.exports = {
  ARCHIVE_FORMAT,
  CHECKPOINT_SCHEMA,
  MAX_CHECKPOINT_FILES,
  createCheckpoint,
  normalizePaths,
  verifyCheckpoint,
};
