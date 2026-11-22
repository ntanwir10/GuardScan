import {execFileSync} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {securityCommand} from '../../src/commands/security';
import {configManager} from '../../src/core/config';
import {repositoryManager} from '../../src/core/repository';
import {scanEngine} from '../../src/core/scan-engine';
import {lintStagedText} from '../../src/core/staged-lint';
import {scanStagedChanges} from '../../src/core/staged-secrets';
import type {ScanEngineResult} from '../../src/core/scan-engine';

// Runtime overrides (GIT_CONFIG_COUNT, GIT_CONFIG_PARAMETERS) beat config files, so they must be cleared too.
const CLEARED_ENV = [
  'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_DIFF_OPTS',
];
const GIT_ENV = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES', ...CLEARED_ENV];
const savedEnv = Object.fromEntries(GIT_ENV.map(name => [name, process.env[name]]));
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-staged-lint-')));
// Built from parts, so this file never holds a real conflict marker.
const OURS = `${'<'.repeat(7)} HEAD`;
const SEPARATOR = '='.repeat(7);
const THEIRS = `${'>'.repeat(7)} feature`;

beforeAll(() => {
  // Keep the developer's Git configuration and any enclosing hook environment out of the fixtures.
  fs.writeFileSync(path.join(tempRoot, 'gitconfig'), '');
  process.env.GIT_CONFIG_GLOBAL = path.join(tempRoot, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CEILING_DIRECTORIES = tempRoot;
  for (const name of CLEARED_ENV) {delete process.env[name];}
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

/** Line-check findings as `file:line:ruleId`, sorted. */
function lint(result: ScanEngineResult): string[] {
  return result.findings.filter(finding => /^guardscan\.(?:lint|pattern)\./.test(finding.ruleId))
    .map(finding => `${finding.file}:${finding.line}:${finding.ruleId}`).sort();
}

const POSITIVE: ReadonlyArray<readonly [string, string, string]> = [
  ['guardscan.lint.merge-conflict-marker', 'txt', THEIRS],
  ['guardscan.lint.trailing-whitespace', 'txt', 'value \t'],
  ['guardscan.lint.todo-comment', 'ts', 'const a = 1; // TODO: tidy'],
  ['guardscan.lint.todo-comment', 'js', '/* FIXME: later */'],
  ['guardscan.lint.todo-comment', 'py', '# XXX: revisit'],
  ['guardscan.lint.debug-statement', 'js', 'console.log(value);'],
  ['guardscan.lint.debug-statement', 'tsx', 'debugger;'],
  ['guardscan.lint.debug-statement', 'py', 'breakpoint()'],
  ['guardscan.lint.debug-statement', 'py', 'import pdb'],
  ['guardscan.lint.debug-statement', 'py', 'ipdb.set_trace()'],
  ['guardscan.lint.debug-statement', 'rb', 'binding.pry'],
  ['guardscan.lint.debug-statement', 'rb', 'byebug'],
  ['guardscan.lint.debug-statement', 'php', 'var_dump($user);'],
  ['guardscan.lint.debug-statement', 'php', 'dd($user);'],
  ['guardscan.lint.debug-statement', 'go', 'spew.Dump(user)'],
  ['guardscan.lint.debug-statement', 'java', 'System.out.println(user);'],
  ['guardscan.lint.debug-statement', 'java', 'error.printStackTrace();'],
  ['guardscan.pattern.dynamic-code-execution', 'js', 'eval(code);'],
  ['guardscan.pattern.dynamic-code-execution', 'ts', 'const run = new Function(body);'],
  ['guardscan.pattern.dynamic-code-execution', 'py', 'exec(code)'],
  ['guardscan.pattern.dynamic-code-execution', 'php', 'eval($code);'],
  ['guardscan.pattern.dynamic-code-execution', 'rb', 'eval(code)'],
  ['guardscan.pattern.unsafe-yaml-load', 'py', 'data = yaml.load(text, Loader=yaml.FullLoader)'],
  ['guardscan.pattern.unsafe-deserialization', 'py', 'obj = pickle.loads(blob)'],
  ['guardscan.pattern.sql-string-building', 'js', 'db.query("SELECT * FROM users WHERE id = " + id);'],
  ['guardscan.pattern.sql-string-building', 'ts', 'db.query(`DELETE FROM users WHERE id = ${id}`);'],
  ['guardscan.pattern.sql-string-building', 'py', 'cur.execute(f"SELECT name FROM users WHERE id = {uid}")'],
  ['guardscan.pattern.sql-string-building', 'py', `cur.execute("UPDATE users SET name = '%s'" % name)`],
  ['guardscan.pattern.sql-string-building', 'rb', 'db.execute("INSERT INTO logs VALUES (#{entry})")'],
  ['guardscan.pattern.sql-string-building', 'php', '$db->query("SELECT * FROM users WHERE id = $id");'],
  ['guardscan.pattern.sql-string-building', 'java', `stmt.execute("SELECT * FROM users WHERE name = '" + name + "'");`],
  ['guardscan.pattern.shell-command-injection', 'py', 'subprocess.run(command, shell=True)'],
  ['guardscan.pattern.shell-command-injection', 'js', 'child_process.exec("rm -rf " + dir);'],
  ['guardscan.pattern.shell-command-injection', 'ts', 'exec(`git log ${ref}`);'],
];

// Each must produce no line-check finding at all.
const NEGATIVE: ReadonlyArray<readonly [string, string]> = [
  ['md', `Title\n${SEPARATOR}`],
  ['txt', 'value\r'],
  ['ts', 'const url = "https://example.com/TODO";'],
  ['py', 'label = "TODO"'],
  ['js', '// console.log(value);'],
  ['js', 'logger.log(value);'],
  ['ts', 'const debuggerEnabled = true;'],
  ['py', '# breakpoint()'],
  ['rb', '# binding.pry'],
  ['php', '$this->dump($user);'],
  ['php', 'function dump($value) {'],
  ['go', '// spew.Dump(user)'],
  ['java', '// System.out.println(user);'],
  ['java', 'logger.info(user);'],
  ['js', 'const value = obj.eval(code) + evaluate(code);'],
  ['js', 'const match = pattern.exec(text);'],
  ['py', 'value = ast.literal_eval(text)'],
  ['py', 'cursor.execute(query, params)'],
  ['py', '# eval(code)'],
  ['php', '$parser->eval($code);'],
  ['rb', 'record.instance_eval { name }'],
  ['py', 'data = yaml.load(text, Loader=yaml.SafeLoader)'],
  ['py', 'data = yaml.safe_load(text)'],
  ['py', 'data = json.loads(blob)'],
  ['js', 'db.query("SELECT * FROM users WHERE id = ?", [id]);'],
  ['py', 'cur.execute("SELECT * FROM users WHERE id = %s", (uid,))'],
  ['js', 'const label = "Select an item from the list: " + name;'],
  ['js', 'log("DELETE " + url);'],
  ['py', 'subprocess.run(["ls", path])'],
  ['py', 'subprocess.run(command, shell=False)'],
  ['js', 'execFile("ls", [dir]);'],
  ['js', 'exec(command);'],
  ['ts', '// eval(code); new Function(body); db.query("SELECT * FROM t WHERE id = " + id);'],
];

describe('staged lint and code-pattern checks', () => {
  let repo: string;
  const scan = (): Promise<ScanEngineResult> => scanEngine.runSecurityScan({repoPath: repo, staged: true, offline: true});

  async function runCli(extra: Partial<Parameters<typeof securityCommand>[0]> = {}): Promise<number> {
    jest.spyOn(configManager, 'loadOrInit').mockReturnValue({
      provider: 'none', telemetryEnabled: false, offlineMode: true,
    } as never);
    jest.spyOn(repositoryManager, 'getRepoInfo').mockReturnValue({
      repoId: 'fixture', name: 'fixture', path: repo, isGit: true,
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    // applyExitCode keeps the highest code seen, so each run starts clean.
    process.exitCode = undefined;
    await securityCommand({staged: true, ci: true, output: path.join(tempRoot, `${path.basename(repo)}.json`), ...extra});
    return Number(process.exitCode);
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(tempRoot, 'repo-'));
    git(repo, 'init', '-q');
  });

  afterEach(() => {
    fs.rmSync(repo, {recursive: true, force: true});
    delete process.env.GIT_DIFF_OPTS;
    process.exitCode = undefined;
    jest.restoreAllMocks();
  });

  it.each([undefined, '--unified=3'])('reports a TODO this commit adds but not one already in the file (GIT_DIFF_OPTS=%s)', async options => {
    write(repo, 'app.ts', '// TODO: old one\nconst a = 1;\nconst b = 2;\n');
    git(repo, 'add', 'app.ts');
    git(repo, 'commit', '-qm', 'initial');
    // A line inserted above the old TODO shifts it, and the line after it changes.
    write(repo, 'app.ts', 'const top = 0;\n// TODO: old one\nconst a = 10;\n// FIXME: new one\nconst b = 2;\n');
    git(repo, 'add', 'app.ts');
    if (options) {process.env.GIT_DIFF_OPTS = options;}

    expect(lint(await scan())).toEqual(['app.ts:4:guardscan.lint.todo-comment']);
  });

  it('checks only the staged added lines of a partially staged file', async () => {
    write(repo, 'job.py', 'x = 1\n');
    git(repo, 'add', 'job.py');
    git(repo, 'commit', '-qm', 'initial');
    write(repo, 'job.py', 'x = 1\nprint(x)  # TODO: staged\n');
    git(repo, 'add', 'job.py');
    write(repo, 'job.py', `x = 1\nprint(x)  # TODO: staged\nbreakpoint()\n${OURS}\n`);

    expect(lint(await scan())).toEqual(['job.py:2:guardscan.lint.todo-comment']);
  });

  it('reports conflict markers as high and blocks a --ci run', async () => {
    write(repo, 'notes.md', ['intro', OURS, 'ours', SEPARATOR, 'theirs', THEIRS, ''].join('\n'));
    write(repo, 'heading.md', `Title\n${SEPARATOR}\n`);
    git(repo, 'add', '-A');

    const result = await scan();

    expect(result.findings.filter(finding => finding.ruleId === 'guardscan.lint.merge-conflict-marker')
      .map(finding => `${finding.file}:${finding.line}:${finding.severity}`))
      .toEqual(['notes.md:2:high', 'notes.md:4:high', 'notes.md:6:high']);
    expect(await runCli()).toBe(1);
  });

  it('reports a medium code pattern without blocking unless --fail-on medium', async () => {
    write(repo, 'run.js', 'eval(input);\n');
    git(repo, 'add', 'run.js');

    expect(lint(await scan())).toEqual(['run.js:1:guardscan.pattern.dynamic-code-execution']);
    expect(await runCli()).toBe(0);
    expect(await runCli({failOn: 'medium'})).toBe(1);
  });

  it('fires each rule on its positive fixture and on none of the negative ones', async () => {
    POSITIVE.forEach(([, extension, line], index) => write(repo, `pos/${index}.${extension}`, `${line}\n`));
    NEGATIVE.forEach(([extension, line], index) => write(repo, `neg/${index}.${extension}`, `${line}\n`));
    git(repo, 'add', '-A');

    const found = lint(await scan());

    expect(POSITIVE.filter(([ruleId, extension], index) => !found.includes(`pos/${index}.${extension}:1:${ruleId}`)))
      .toEqual([]);
    expect(found.filter(entry => entry.startsWith('neg/'))).toEqual([]);
  });

  it('checks a first commit and modified files at paths with spaces, non-ASCII characters, and newlines', async () => {
    const files: Array<[string, string]> = [['dir with space/my file.js', 'console.log(1);'], ['目录/設定.py', 'breakpoint()']];
    if (process.platform !== 'win32') {files.push(['new\nline.rb', 'binding.pry']);}
    for (const [file, line] of files) {write(repo, file, `${line}\n`);}
    git(repo, 'add', '-A');
    expect(() => git(repo, 'rev-parse', '--verify', '-q', 'HEAD')).toThrow();

    expect(lint(await scan())).toEqual(files.map(([file]) => `${file}:1:guardscan.lint.debug-statement`).sort());

    git(repo, 'commit', '-qm', 'initial');
    for (const [file, line] of files) {write(repo, file, `${line}\n\t\n`);}
    git(repo, 'add', '-A');

    expect(lint(await scan())).toEqual(files.map(([file]) => `${file}:2:guardscan.lint.trailing-whitespace`).sort());
  });

  it('skips excluded binary and symlink entries', async () => {
    write(repo, 'blob.js', Buffer.concat([Buffer.from([0]), Buffer.from(`${OURS}\nconsole.log(1);\n`)]));
    git(repo, 'add', 'blob.js');
    const linkTarget = execFileSync('git', ['hash-object', '-w', '--stdin'], {cwd: repo, input: `${OURS}\neval(x)\n`, encoding: 'utf8'}).trim();
    git(repo, 'update-index', '--add', '--cacheinfo', `120000,${linkTarget},link.js`);

    const result = await scan();

    expect(lint(result)).toEqual([]);
    expect(result.scannerResults[0].metadata?.excluded).toEqual(expect.arrayContaining([
      {path: 'blob.js', reason: 'binary'}, {path: 'link.js', reason: 'symlink'},
    ]));
  });

  it('checks every line when git shows no text diff, and none for a mode-only change', async () => {
    write(repo, '.gitattributes', 'gen.js -diff\n');
    write(repo, 'gen.js', '// TODO: old\n');
    write(repo, 'tool.py', '# TODO: old\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'initial');
    write(repo, 'gen.js', '// TODO: old\nconsole.log(1);\n');
    git(repo, 'add', 'gen.js');
    git(repo, 'update-index', '--chmod=+x', 'tool.py');

    expect(lint(await scan())).toEqual([
      'gen.js:1:guardscan.lint.todo-comment', 'gen.js:2:guardscan.lint.debug-statement',
    ]);
  });
});

describe('staged lint at scale', () => {
  it('checks a long run of spaces in linear time', () => {
    const started = Date.now();
    expect(lintStagedText('a.txt', `${' '.repeat(80000)}x\n`, 'all')).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('collects very many findings from one staged file without overflowing push()', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-staged-scale-'));
    try {
      git(repo, 'init', '-q');
      write(repo, 'spaces.txt', ' \n'.repeat(150000));
      git(repo, 'add', 'spaces.txt');
      expect(scanStagedChanges(repo).lint).toHaveLength(150000);
    } finally {
      fs.rmSync(repo, {recursive: true, force: true});
    }
  });
});
