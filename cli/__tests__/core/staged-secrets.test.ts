import {execFileSync} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {securityCommand} from '../../src/commands/security';
import {configManager} from '../../src/core/config';
import {repositoryManager} from '../../src/core/repository';
import {evaluateScanPolicy, scanEngine, serializeScanResult} from '../../src/core/scan-engine';
import type {ScanEngineResult} from '../../src/core/scan-engine';
import {MAX_SECRET_FILE_BYTES} from '../../src/core/secrets-detector';
import {STAGED_SCOPE} from '../../src/core/staged-secrets';

const RAW_SECRET = 'AKIAIOSFODNN7EXAMPLE';
const SECRET_LINE = `AWS_ACCESS_KEY=${RAW_SECRET}\n`;
const GIT_ENV = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES', 'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE'];
const savedEnv = Object.fromEntries(GIT_ENV.map(name => [name, process.env[name]]));
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-staged-')));

beforeAll(() => {
  // Keep the developer's Git configuration and any enclosing hook environment out of the fixtures.
  fs.writeFileSync(path.join(tempRoot, 'gitconfig'), '');
  process.env.GIT_CONFIG_GLOBAL = path.join(tempRoot, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CEILING_DIRECTORIES = tempRoot;
  for (const name of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) {delete process.env[name];}
});

afterAll(() => {
  fs.rmSync(tempRoot, {recursive: true, force: true});
  for (const name of GIT_ENV) {
    if (savedEnv[name] === undefined) {delete process.env[name];} else {process.env[name] = savedEnv[name];}
  }
});

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=GuardScan Test', '-c', 'user.email=test@example.invalid', ...args], {
    cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function write(repo: string, file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(path.join(repo, file)), {recursive: true});
  fs.writeFileSync(path.join(repo, file), content);
}

function secretFiles(result: ScanEngineResult): string[] {
  return result.findings.filter(finding => finding.category === 'Secret Detection: AWS Access Key')
    .map(finding => finding.file).sort();
}

function stagedMetadata(result: ScanEngineResult): Record<string, unknown> | undefined {
  return result.scannerResults.find(scanner => scanner.scanner === 'secrets')?.metadata;
}

describe('staged secret scan', () => {
  let repo: string;
  const scan = (): Promise<ScanEngineResult> => scanEngine.runSecurityScan({repoPath: repo, staged: true, offline: true});

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(tempRoot, 'repo-'));
    git(repo, 'init', '-q');
  });

  afterEach(() => {
    fs.rmSync(repo, {recursive: true, force: true});
    jest.restoreAllMocks();
  });

  it('reports a staged secret after it is removed from the working copy', async () => {
    write(repo, 'README.md', 'fixture\n');
    git(repo, 'add', 'README.md');
    git(repo, 'commit', '-qm', 'initial');
    write(repo, 'config.env', SECRET_LINE);
    git(repo, 'add', 'config.env');
    write(repo, 'config.env', 'AWS_ACCESS_KEY=\n');

    const result = await scan();

    expect(result.status).toBe('complete');
    expect(secretFiles(result)).toEqual(['config.env']);
    expect(result.scannerResults.map(scanner => scanner.scanner)).toEqual(['secrets']);
  });

  it('ignores a secret that exists only in the working copy', async () => {
    write(repo, 'config.env', 'AWS_ACCESS_KEY=\n');
    git(repo, 'add', 'config.env');
    git(repo, 'commit', '-qm', 'initial');
    write(repo, 'config.env', SECRET_LINE);
    write(repo, 'untracked.env', SECRET_LINE);

    const result = await scan();

    expect(result.status).toBe('complete');
    expect(result.findings).toEqual([]);
    expect(stagedMetadata(result)).toEqual({scope: STAGED_SCOPE, excluded: []});
  });

  it('scans the first commit on an unborn branch', async () => {
    write(repo, 'config.env', SECRET_LINE);
    git(repo, 'add', 'config.env');
    expect(() => git(repo, 'rev-parse', '--verify', '-q', 'HEAD')).toThrow();

    const result = await scan();

    expect(result.status).toBe('complete');
    expect(secretFiles(result)).toEqual(['config.env']);
  });

  it('scans paths with spaces, non-ASCII characters, and newlines', async () => {
    const files = ['dir with space/my key.env', '密钥/設定.env'];
    if (process.platform !== 'win32') {files.push('new\nline.env');}
    for (const file of files) {write(repo, file, SECRET_LINE);}
    git(repo, 'add', '-A');

    const result = await scan();

    expect(secretFiles(result)).toEqual([...files].sort());
  });

  it('reports a staged rename or copy at its new path', async () => {
    write(repo, 'old.env', SECRET_LINE);
    git(repo, 'add', 'old.env');
    git(repo, 'commit', '-qm', 'initial');
    git(repo, 'mv', 'old.env', 'renamed.env');
    write(repo, 'copied.env', SECRET_LINE);
    git(repo, 'add', 'copied.env');

    const result = await scan();

    expect(secretFiles(result)).toEqual(['copied.env', 'renamed.env']);
  });

  it('scans a staged change from a symlink to a regular file', async () => {
    const linkTarget = execFileSync('git', ['hash-object', '-w', '--stdin'], {cwd: repo, input: 'target', encoding: 'utf8'}).trim();
    git(repo, 'update-index', '--add', '--cacheinfo', `120000,${linkTarget},config.env`);
    git(repo, 'commit', '-qm', 'link');
    const secretBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], {cwd: repo, input: SECRET_LINE, encoding: 'utf8'}).trim();
    git(repo, 'update-index', '--cacheinfo', `100644,${secretBlob},config.env`);

    const result = await scan();

    expect(git(repo, 'diff', '--cached', '--name-status')).toBe('T\tconfig.env\n');
    expect(secretFiles(result)).toEqual(['config.env']);
  });

  it('reports binary, symlink, submodule, and oversized entries as excluded without scanning them', async () => {
    write(repo, 'image.bin', Buffer.concat([Buffer.from([0x89, 0x00]), Buffer.from(SECRET_LINE)]));
    write(repo, 'big.txt', `${'a'.repeat(MAX_SECRET_FILE_BYTES)}\n${SECRET_LINE}`);
    git(repo, 'add', 'image.bin', 'big.txt');
    // Index entries built from object IDs stage a link and a gitlink without touching the filesystem.
    const linkTarget = execFileSync('git', ['hash-object', '-w', '--stdin'], {cwd: repo, input: SECRET_LINE, encoding: 'utf8'}).trim();
    git(repo, 'update-index', '--add', '--cacheinfo', `120000,${linkTarget},link.env`);
    git(repo, 'update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(linkTarget.length)},vendor/module`);

    const result = await scan();

    expect(result.status).toBe('complete');
    expect(result.findings).toEqual([]);
    const excluded = stagedMetadata(result)?.excluded as Array<{path: string; reason: string}>;
    expect([...excluded].sort((left, right) => left.path.localeCompare(right.path))).toEqual([
      {path: 'big.txt', reason: 'oversized'},
      {path: 'image.bin', reason: 'binary'},
      {path: 'link.env', reason: 'symlink'},
      {path: 'vendor/module', reason: 'submodule'},
    ]);
  });

  it('refuses an unmerged index as an operational failure with exit 2', async () => {
    write(repo, 'conflict.txt', 'base\n');
    git(repo, 'add', 'conflict.txt');
    git(repo, 'commit', '-qm', 'base');
    git(repo, 'checkout', '-q', '-b', 'other');
    write(repo, 'conflict.txt', 'other\n');
    git(repo, 'commit', '-qam', 'other');
    git(repo, 'checkout', '-q', '-');
    write(repo, 'conflict.txt', 'main\n');
    git(repo, 'commit', '-qam', 'main');
    expect(() => git(repo, 'merge', 'other')).toThrow();

    await expect(scan()).rejects.toMatchObject({code: 'STAGED_INDEX_UNMERGED'});

    jest.spyOn(configManager, 'loadOrInit').mockReturnValue({
      provider: 'none', telemetryEnabled: false, offlineMode: true,
    } as never);
    jest.spyOn(repositoryManager, 'getRepoInfo').mockReturnValue({
      repoId: 'fixture', name: 'fixture', path: repo, isGit: true,
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation((code => {
      throw new Error(`process.exit(${String(code)})`);
    }) as typeof process.exit);

    await expect(securityCommand({staged: true, ci: true})).rejects.toThrow('process.exit(2)');
    expect(errors.mock.calls.flat().join('\n')).toContain('unmerged paths');
  });

  it('never writes the raw secret into JSON or SARIF output', async () => {
    write(repo, 'config.env', SECRET_LINE);
    git(repo, 'add', 'config.env');

    const result = await scan();
    const policy = {failOn: 'high' as const};
    const policyResult = evaluateScanPolicy(result, policy);
    const json = serializeScanResult(result, 'json', repo, {command: 'security', ci: true, policy, policyResult});
    const sarif = serializeScanResult(result, 'sarif', repo, {command: 'security', ci: true, policy, policyResult});

    expect(policyResult.exitCode).toBe(1);
    expect(JSON.parse(json).security.findings[0]).toMatchObject({file: 'config.env', scanners: ['secrets']});
    expect(JSON.parse(json).security.scanners[0].metadata.scope).toBe(STAGED_SCOPE);
    expect(sarif).toContain('config.env');
    expect(json).not.toContain(RAW_SECRET);
    expect(sarif).not.toContain(RAW_SECRET);
  });

  it('names the staged scope in a clean command result', async () => {
    write(repo, 'notes.txt', 'nothing secret\n');
    git(repo, 'add', 'notes.txt');
    jest.spyOn(configManager, 'loadOrInit').mockReturnValue({
      provider: 'none', telemetryEnabled: false, offlineMode: true,
    } as never);
    jest.spyOn(repositoryManager, 'getRepoInfo').mockReturnValue({
      repoId: 'fixture', name: 'fixture', path: repo, isGit: true,
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const output = path.join(repo, 'report.md');

    await securityCommand({staged: true, output});

    expect(process.exitCode).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain(`Scope: ${STAGED_SCOPE}`);
    expect(fs.readFileSync(output, 'utf8')).toContain(`Scope: ${STAGED_SCOPE}`);
  });

  it.each([
    [{files: ['src/a.ts']}, '--files'],
    [{licenses: true}, '--licenses'],
    [{cve: true}, '--cve'],
    [{aiFix: true}, '--ai-fix'],
    [{interactive: true}, '--interactive'],
  ])('rejects --staged combined with %j', async (extra, flag) => {
    const loadConfig = jest.spyOn(configManager, 'loadOrInit');
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation((code => {
      throw new Error(`process.exit(${String(code)})`);
    }) as typeof process.exit);

    await expect(securityCommand({staged: true, ...extra})).rejects.toThrow('process.exit(2)');
    expect(errors.mock.calls.flat().join('\n')).toContain(`cannot be combined with ${flag}`);
    expect(loadConfig).not.toHaveBeenCalled();
  });
});
