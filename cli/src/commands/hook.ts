/* eslint-disable no-console -- Hook commands report the managed hook path and its state. */
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

const BLOCK_START = '# >>> guardscan >>>';
const BLOCK_END = '# <<< guardscan <<<';
/** Fails closed: any status above 2, including 127 when guardscan is missing, becomes 2. */
export const HOOK_BLOCK = [
  BLOCK_START,
  // The report goes in the git dir, so a later `git add -A` can never commit it.
  'guardscan security --staged --ci --output "$(git rev-parse --git-dir)/guardscan-pre-commit.json"',
  'guardscan_status=$?',
  'if [ "$guardscan_status" -ne 0 ]; then [ "$guardscan_status" -le 2 ] || guardscan_status=2; exit "$guardscan_status"; fi',
  BLOCK_END,
  '',
].join('\n');
const SHELL_SHEBANG = /^#!\s*(?:\S*\/)?(?:env\s+)?(?:\S*\/)?(?:sh|bash|zsh|dash)(?=\s|$)/;

interface HookLocation {
  hooksDir: string;
  hookPath: string;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false})
    .replace(/\r?\n$/, '');
}

/** `--git-path hooks` honors core.hooksPath and worktrees; its output is relative to the work-tree root. */
function locateHook(cwd: string): HookLocation {
  let root: string;
  try {
    root = git(['rev-parse', '--show-toplevel'], cwd);
  } catch {
    throw new Error('Not inside a Git work tree. Run guardscan hook from a repository checkout.');
  }
  const hooksDir = path.resolve(root, git(['rev-parse', '--git-path', 'hooks'], root));
  return {hooksDir, hookPath: path.join(hooksDir, 'pre-commit')};
}

function refuse(reason: string): never {
  throw new Error(`${reason}\nAdd GuardScan's block to your hook by hand:\n\n${HOOK_BLOCK}`);
}

function markerLine(content: string, marker: string, from: number): number {
  for (let index = content.indexOf(marker, from); index >= 0; index = content.indexOf(marker, index + 1)) {
    if (index === 0 || content[index - 1] === '\n') {return index;}
  }
  return -1;
}

/** Offsets of the managed block, markers and the end marker's newline included. */
function findBlock(content: string, hookPath: string): {start: number; end: number} | undefined {
  const start = markerLine(content, BLOCK_START, 0);
  if (start < 0) {return undefined;}
  const endMarker = markerLine(content, BLOCK_END, start);
  if (endMarker < 0) {throw new Error(`${hookPath} has a GuardScan start marker but no end marker; fix the hook by hand.`);}
  const newline = content.indexOf('\n', endMarker);
  return {start, end: newline < 0 ? content.length : newline + 1};
}

/** Read the hook as latin1 so every foreign byte round-trips unchanged. */
function readHook(hookPath: string, forUninstall = false): string | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(hookPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return undefined;}
    throw error;
  }
  if (stat.isSymbolicLink()) {
    const reason = `${hookPath} is a symlink; changing it would change the file it points to.`;
    if (forUninstall) {throw new Error(`${reason} Remove GuardScan's block from the link target by hand.`);}
    refuse(reason);
  }
  if (!stat.isFile()) {throw new Error(`${hookPath} is not a regular file.`);}
  return fs.readFileSync(hookPath, 'latin1');
}

/** Replace the hook atomically; a rename never writes through a symlink swapped in after the check. */
function writeHook(hookPath: string, content: string, mode: number): void {
  const temporary = `${hookPath}.guardscan-${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, {encoding: 'latin1', mode, flag: 'wx'});
  try {
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, hookPath);
  } finally {
    fs.rmSync(temporary, {force: true});
  }
}

export function installHook(cwd: string = process.cwd()): void {
  const {hooksDir, hookPath} = locateHook(cwd);
  if (hooksDir.split(path.sep).includes('.husky')) {
    refuse(`Husky manages ${hooksDir} and regenerates its hooks, so add the block to .husky/pre-commit yourself.`);
  }
  const existing = readHook(hookPath);
  let content: string;
  if (existing === undefined) {
    content = `#!/bin/sh\n${HOOK_BLOCK}`;
  } else {
    const block = findBlock(existing, hookPath);
    const firstLineEnd = existing.indexOf('\n');
    const firstLine = firstLineEnd < 0 ? existing : existing.slice(0, firstLineEnd);
    if (block) {
      content = existing.slice(0, block.start) + HOOK_BLOCK + existing.slice(block.end);
    } else if (!firstLine.startsWith('#!')) {
      content = HOOK_BLOCK + existing;
    } else if (!SHELL_SHEBANG.test(firstLine)) {
      refuse(`${hookPath} is not a shell script (${firstLine.trim()}).`);
    } else {
      content = firstLineEnd < 0
        ? `${existing}\n${HOOK_BLOCK}`
        : existing.slice(0, firstLineEnd + 1) + HOOK_BLOCK + existing.slice(firstLineEnd + 1);
    }
  }
  fs.mkdirSync(hooksDir, {recursive: true});
  const mode = existing === undefined ? 0o755 : fs.statSync(hookPath).mode & 0o777;
  writeHook(hookPath, content, mode);
  console.log(`GuardScan pre-commit check installed: ${hookPath}`);
  if (process.platform !== 'win32' && (mode & 0o111) === 0) {
    console.warn(`Warning: ${hookPath} is not executable, so Git will not run it. Make it executable with chmod +x.`);
  }
}

export function uninstallHook(cwd: string = process.cwd()): void {
  const {hookPath} = locateHook(cwd);
  const existing = readHook(hookPath, true);
  const block = existing === undefined ? undefined : findBlock(existing, hookPath);
  if (existing === undefined || !block) {
    console.log(`GuardScan is not installed in ${hookPath}.`);
    return;
  }
  const remaining = existing.slice(0, block.start) + existing.slice(block.end);
  if (/^(?:#![^\n]*)?\s*$/.test(remaining)) {
    fs.unlinkSync(hookPath);
    console.log(`Removed ${hookPath}; it held only GuardScan's check.`);
    return;
  }
  writeHook(hookPath, remaining, fs.statSync(hookPath).mode & 0o777);
  console.log(`Removed GuardScan's check from ${hookPath}; the rest of the hook was kept.`);
}

export function hookStatus(cwd: string = process.cwd()): void {
  const {hookPath} = locateHook(cwd);
  let content: string | undefined;
  try {
    content = fs.readFileSync(hookPath, 'latin1');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {throw error;}
  }
  console.log(`Hook: ${hookPath}`);
  console.log(`GuardScan: ${content !== undefined && markerLine(content, BLOCK_START, 0) >= 0 ? 'installed' : 'not installed'}`);
}

export function createHookCommand(): Command {
  const command = new Command('hook').description('Install, remove, or check the GuardScan Git pre-commit hook');
  command.command('install')
    .description('Scan staged changes for secrets before each commit')
    .action(() => installHook());
  command.command('uninstall')
    .description("Remove only GuardScan's block from the pre-commit hook")
    .action(() => uninstallHook());
  command.command('status')
    .description('Show the pre-commit hook path and whether GuardScan is installed')
    .action(() => hookStatus());
  return command;
}
