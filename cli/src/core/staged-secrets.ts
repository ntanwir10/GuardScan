import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { GuardScanError } from '../utils/error-handler';
import { MAX_SECRET_FILE_BYTES, SecretFinding, secretsDetector } from './secrets-detector';

export const STAGED_SCOPE = 'staged changes (secrets only)';

/** Git's own binary heuristic: a NUL byte in the first 8000 bytes. */
const BINARY_SNIFF_BYTES = 8000;
const GIT_OUTPUT_MAX_BYTES = 256 * 1024 * 1024;
const READ_BATCH_BYTES = 32 * 1024 * 1024;

export interface StagedExclusion {
  path: string;
  reason: 'symlink' | 'submodule' | 'binary' | 'oversized';
}

export interface StagedSecretsResult {
  findings: SecretFinding[];
  excluded: StagedExclusion[];
}

interface StagedEntry {
  path: string;
  mode: string;
  oid: string;
  size: number;
}

// The inherited environment matters: under `git commit -a`, GIT_INDEX_FILE names the index being committed.
function git(cwd: string, args: string[], input?: string, maxBuffer = GIT_OUTPUT_MAX_BYTES): Buffer {
  try {
    return execFileSync('git', args, {cwd, input, maxBuffer, stdio: ['pipe', 'pipe', 'pipe'], shell: false});
  } catch (error) {
    throw new GuardScanError(`git ${args.join(' ')} failed: ${gitFailure(error)}`, 'STAGED_GIT_FAILED');
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
    const header = /^:[0-7]{6} ([0-7]{6}) [0-9a-f]+ ([0-9a-f]+) [ACMT]$/.exec(fields[index]);
    if (!header || !fields[index + 1]) {throw unexpectedGitOutput('diff');}
    entries.push({path: fields[index + 1], mode: header[1], oid: header[2], size: 0});
  }
  return entries;
}

/** Scan the blobs staged for the next commit. The working tree is never read. */
export function scanStagedSecrets(root: string): StagedSecretsResult {
  const excluded: StagedExclusion[] = [];
  const blobs: StagedEntry[] = [];
  for (const entry of stagedEntries(root)) {
    if (entry.mode === '120000') {excluded.push({path: entry.path, reason: 'symlink'});}
    else if (entry.mode === '160000') {excluded.push({path: entry.path, reason: 'submodule'});}
    else {blobs.push(entry);}
  }
  const result = {findings: [] as SecretFinding[], excluded};
  if (blobs.length === 0) {return result;}

  // Sizes first, so oversized blobs are never loaded into memory.
  const sizes = git(root, ['--no-replace-objects', 'cat-file', '--batch-check'], blobs.map(blob => `${blob.oid}\n`).join(''))
    .toString('utf8')
    .split('\n');
  const readable: StagedEntry[] = [];
  blobs.forEach((blob, index) => {
    const [oid, type, size] = (sizes[index] || '').split(' ');
    if (oid !== blob.oid || type !== 'blob' || !/^\d+$/.test(size || '')) {throw unexpectedGitOutput('cat-file --batch-check');}
    blob.size = Number(size);
    if (blob.size > MAX_SECRET_FILE_BYTES) {excluded.push({path: blob.path, reason: 'oversized'});}
    else {readable.push(blob);}
  });
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

function scanBlobBatch(root: string, batch: StagedEntry[], result: StagedSecretsResult): void {
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
      result.findings.push(...secretsDetector.scanContent(blob.path, content.toString('utf8')));
    }
  }
}
