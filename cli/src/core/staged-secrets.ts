import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { GuardScanError } from '../utils/error-handler';
import { MAX_SECRET_FILE_BYTES, SecretFinding, secretsDetector } from './secrets-detector';
import { lintStagedText, StagedLintFinding } from './staged-lint';

export const STAGED_SCOPE = 'staged changes (secrets, lint, code patterns)';

/** Git's own binary heuristic: a NUL byte in the first 8000 bytes. */
const BINARY_SNIFF_BYTES = 8000;
const GIT_OUTPUT_MAX_BYTES = 256 * 1024 * 1024;
const READ_BATCH_BYTES = 32 * 1024 * 1024;
// Path arguments per git call stay far under the 32,767-character Windows command line.
const PATHSPEC_CHUNK_BYTES = 16 * 1024;

export interface StagedExclusion {
  path: string;
  reason: 'symlink' | 'submodule' | 'binary' | 'oversized';
}

export interface StagedScanResult {
  findings: SecretFinding[];
  lint: StagedLintFinding[];
  excluded: StagedExclusion[];
}

interface StagedEntry {
  path: string;
  status: string;
  mode: string;
  oldOid: string;
  oid: string;
  size: number;
  /** Line numbers this commit adds, or `all` when there is no earlier text version to compare against. */
  added: readonly number[] | 'all';
}

// The inherited environment matters: under `git commit -a`, GIT_INDEX_FILE names the index being committed.
function git(cwd: string, args: string[], input?: string, maxBuffer = GIT_OUTPUT_MAX_BYTES): Buffer {
  try {
    return execFileSync('git', args, {cwd, input, maxBuffer, stdio: ['pipe', 'pipe', 'pipe'], shell: false});
  } catch (error) {
    const shown = args.includes('--') ? [...args.slice(0, args.indexOf('--')), '-- <paths>'] : args;
    throw new GuardScanError(`git ${shown.join(' ')} failed: ${gitFailure(error)}`, 'STAGED_GIT_FAILED');
  }
}

function gitFailure(error: unknown): string {
  const stderr = error && typeof error === 'object' ? (error as {stderr?: unknown}).stderr : undefined;
  const text = Buffer.isBuffer(stderr) ? stderr.toString('utf8').trim().split('\n')[0] : '';
  return text || (error instanceof Error ? error.message : String(error));
}

/**
 * Resolve the work-tree root that staged paths are relative to, and refuse an index
 * with unmerged entries: a conflicted path has no single staged version to judge.
 */
export function resolveStagedWorkTree(cwd: string): string {
  let root: string;
  try {
    root = fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).toString('utf8').replace(/\r?\n$/, ''));
  } catch (error) {
    throw new GuardScanError(
      `--staged needs a Git work tree; run it inside a repository checkout (${error instanceof Error ? error.message : String(error)}).`,
      'STAGED_NOT_A_WORK_TREE'
    );
  }
  if (git(root, ['ls-files', '-u', '-z']).length > 0) {
    throw new GuardScanError(
      'The Git index has unmerged paths. Resolve the conflicts and stage the results before running --staged.',
      'STAGED_INDEX_UNMERGED'
    );
  }
  return root;
}

function unexpectedGitOutput(command: string): GuardScanError {
  return new GuardScanError(`Unexpected output from git ${command}; staged content was not scanned.`, 'STAGED_GIT_OUTPUT');
}

/** Index entries added, copied, modified, or type-changed relative to HEAD (or the empty tree before a first commit). */
function stagedEntries(root: string): StagedEntry[] {
  const fields = git(root, ['diff', '--cached', '--raw', '-z', '--no-abbrev', '--no-renames', '--diff-filter=ACMT'])
    .toString('utf8')
    .split('\0');
  if (fields.pop() !== '' || fields.length % 2 !== 0) {throw unexpectedGitOutput('diff');}
  const entries: StagedEntry[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const header = /^:[0-7]{6} ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) ([ACMT])$/.exec(fields[index]);
    if (!header || !fields[index + 1]) {throw unexpectedGitOutput('diff');}
    entries.push({
      path: fields[index + 1], status: header[4], mode: header[1], oldOid: header[2], oid: header[3], size: 0, added: 'all',
    });
  }
  return entries;
}

/**
 * Scan the blobs staged for the next commit: whole blobs for secrets, and the lines this
 * commit adds for lint and code patterns. The working tree is never read.
 */
export function scanStagedChanges(root: string): StagedScanResult {
  const excluded: StagedExclusion[] = [];
  const blobs: StagedEntry[] = [];
  for (const entry of stagedEntries(root)) {
    if (entry.mode === '120000') {excluded.push({path: entry.path, reason: 'symlink'});}
    else if (entry.mode === '160000') {excluded.push({path: entry.path, reason: 'submodule'});}
    else {blobs.push(entry);}
  }
  const result: StagedScanResult = {findings: [], lint: [], excluded};
  if (blobs.length === 0) {return result;}

  // Sizes first, so oversized blobs are never loaded into memory.
  const sizes = blobSizes(root, blobs.map(blob => blob.oid));
  const readable: StagedEntry[] = [];
  blobs.forEach((blob, index) => {
    blob.size = sizes[index];
    if (blob.size > MAX_SECRET_FILE_BYTES) {excluded.push({path: blob.path, reason: 'oversized'});}
    else {readable.push(blob);}
  });
  assignAddedLines(root, readable);
  // Read in byte-bounded batches, so many staged files never need one huge buffer.
  for (let start = 0; start < readable.length;) {
    let end = start;
    let bytes = 0;
    while (end < readable.length && (end === start || bytes + readable[end].size <= READ_BATCH_BYTES)) {
      bytes += readable[end].size;
      end++;
    }
    scanBlobBatch(root, readable.slice(start, end), result);
    start = end;
  }
  return result;
}

function scanBlobBatch(root: string, batch: StagedEntry[], result: StagedScanResult): void {
  const expectedBytes = batch.reduce((total, blob) => total + blob.oid.length + 32 + blob.size, 0);
  const output = git(root, ['--no-replace-objects', 'cat-file', '--batch'], batch.map(blob => `${blob.oid}\n`).join(''), expectedBytes + 1024);
  let offset = 0;
  for (const blob of batch) {
    const headerEnd = output.indexOf(0x0a, offset);
    const contentEnd = headerEnd + 1 + blob.size;
    if (headerEnd < 0 || output.toString('utf8', offset, headerEnd) !== `${blob.oid} blob ${blob.size}` ||
      output[contentEnd] !== 0x0a) {
      throw unexpectedGitOutput('cat-file --batch');
    }
    const content = output.subarray(headerEnd + 1, contentEnd);
    offset = contentEnd + 1;
    if (content.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      result.excluded.push({path: blob.path, reason: 'binary'});
    } else {
      const text = content.toString('utf8');
      // Append one by one: spreading a large result into push() exceeds the engine's argument limit.
      for (const finding of secretsDetector.scanContent(blob.path, text)) {result.findings.push(finding);}
      for (const finding of lintStagedText(blob.path, text, blob.added)) {result.lint.push(finding);}
    }
  }
}

function blobSizes(root: string, oids: readonly string[]): number[] {
  const lines = git(root, ['--no-replace-objects', 'cat-file', '--batch-check'], oids.map(oid => `${oid}\n`).join(''))
    .toString('utf8')
    .split('\n');
  return oids.map((oid, index) => {
    const [echoed, type, size] = (lines[index] || '').split(' ');
    if (echoed !== oid || type !== 'blob' || !/^\d+$/.test(size || '')) {throw unexpectedGitOutput('cat-file --batch-check');}
    return Number(size);
  });
}

/**
 * Give each modified blob the lines this commit adds. Added, copied, and type-changed
 * entries keep `all`: they have no earlier text version of the same path.
 */
function assignAddedLines(root: string, blobs: readonly StagedEntry[]): void {
  // Same blob: only the mode changed, so nothing is added.
  const modified = blobs.filter(blob => blob.status === 'M' && blob.oldOid !== blob.oid);
  for (const blob of blobs) {
    if (blob.status === 'M' && blob.oldOid === blob.oid) {blob.added = [];}
  }
  if (modified.length === 0) {return;}
  const oldSizes = blobSizes(root, modified.map(blob => blob.oldOid));
  // Only eligible files are diffed: `blobs` holds no symlink, submodule, or oversized entry, and an
  // oversized old version (whose removed lines would flood the patch) keeps `all` for its small new one.
  const diffed = modified.flatMap((blob, index) => oldSizes[index] > MAX_SECRET_FILE_BYTES ? [] : [{blob, bytes: blob.size + oldSizes[index]}]);
  const addedByBlobPair = new Map<string, number[]>();
  for (const chunk of diffChunks(diffed)) {
    const patch = git(root, [
      '--literal-pathspecs', 'diff', '--cached', '--patch', '-U0', '--inter-hunk-context=0', '--no-renames', '--diff-filter=M',
      '--full-index', '--no-color', '--no-ext-diff', '--no-textconv', '--submodule=short', '--', ...chunk,
    ]).toString('latin1');
    for (const [pair, added] of addedLinesByBlobPair(patch)) {addedByBlobPair.set(pair, added);}
  }
  for (const blob of modified) {
    // No hunks (git judged the pair binary, `-diff` is set, or the old version is oversized): check every line.
    blob.added = addedByBlobPair.get(`${blob.oldOid}..${blob.oid}`) ?? 'all';
  }
}

/**
 * Paths for successive diff calls: each call's path arguments stay under PATHSPEC_CHUNK_BYTES,
 * and the blobs it compares under READ_BATCH_BYTES, so every patch stays well inside GIT_OUTPUT_MAX_BYTES.
 */
function diffChunks(entries: ReadonlyArray<{blob: StagedEntry; bytes: number}>): string[][] {
  const chunks: string[][] = [];
  let pathBytes = 0;
  let blobBytes = 0;
  for (const {blob, bytes} of entries) {
    const size = Buffer.byteLength(blob.path) + 1;
    if (chunks.length === 0 || pathBytes + size > PATHSPEC_CHUNK_BYTES || blobBytes + bytes > READ_BATCH_BYTES) {
      chunks.push([]);
      pathBytes = 0;
      blobBytes = 0;
    }
    chunks[chunks.length - 1].push(blob.path);
    pathBytes += size;
    blobBytes += bytes;
  }
  return chunks;
}

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: |$)/;
const BLOB_PAIR = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: [0-7]{6})?$/;

/**
 * Added line numbers per `old..new` blob pair, from `git diff --patch --full-index`. Paths are
 * never parsed: patch headers quote unusual paths, and the blob IDs already identify each entry.
 * Hunk bodies are walked by their line counts, so file content can never pass for a header.
 */
export function addedLinesByBlobPair(patch: string): Map<string, number[]> {
  const lines = patch.split('\n');
  if (lines.pop() !== '' || (lines.length > 0 && !lines[0].startsWith('diff --git '))) {throw unexpectedGitOutput('diff');}
  const pairs = new Map<string, number[]>();
  let pair: string | undefined;
  let added: number[] | undefined;
  for (let index = 0; index < lines.length;) {
    const line = lines[index++];
    const hunk = HUNK_HEADER.exec(line);
    if (line.startsWith('diff --git ')) {
      pair = undefined;
      added = undefined;
    } else if (!hunk) {
      // Before the first hunk only extended headers appear; after one, only "\ No newline at end of file".
      if (added && !line.startsWith('\\')) {throw unexpectedGitOutput('diff');}
      const ids = added ? null : BLOB_PAIR.exec(line);
      if (ids) {pair = `${ids[1]}..${ids[2]}`;}
    } else {
      if (!pair) {throw unexpectedGitOutput('diff');}
      // Entries with the same blob pair have the same hunks, so a later section replaces an earlier one.
      if (!added) {pairs.set(pair, added = []);}
      let oldLeft = Number(hunk[1] ?? 1);
      let newLeft = Number(hunk[3] ?? 1);
      let next = Number(hunk[2]);
      // GIT_DIFF_OPTS can force context lines into a -U0 hunk, so count them rather than assume none.
      while (oldLeft > 0 || newLeft > 0) {
        const body = index < lines.length ? lines[index++] : undefined;
        if (body === undefined) {throw unexpectedGitOutput('diff');}
        if (body.startsWith('\\')) {continue;}
        if (body.startsWith('+') && newLeft > 0) {
          added.push(next++);
          newLeft--;
        } else if (body.startsWith('-') && oldLeft > 0) {
          oldLeft--;
        } else if ((body === '' || body.startsWith(' ')) && oldLeft > 0 && newLeft > 0) {
          next++;
          oldLeft--;
          newLeft--;
        } else {
          throw unexpectedGitOutput('diff');
        }
      }
    }
  }
  return pairs;
}
