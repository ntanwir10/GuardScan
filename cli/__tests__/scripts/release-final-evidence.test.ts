import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

const repository = path.resolve(__dirname, '../../..');
const workflow = (name: string): any => yaml.load(fs.readFileSync(path.join(repository, '.github/workflows', name), 'utf8'));

describe('final release evidence boundaries', () => {
  it('rejects yanked or unknown-yank-state files in every PyPI acceptance path', () => {
    const publish = workflow('release-publish.yml');
    const steps = [
      publish.jobs['pypi-test'].steps.find((s: any) => s.name === 'Reject conflicting TestPyPI files'),
      publish.jobs['pypi-test'].steps.find((s: any) => s.name === 'Verify complete TestPyPI file set'),
      publish.jobs.pypi.steps.find((s: any) => s.name === 'Reject conflicting PyPI files'),
      publish.jobs.pypi.steps.find((s: any) => s.name === 'Verify complete PyPI file set'),
    ];
    for (const step of steps) {
      const script = step.run.match(/python - <<'PY'\n([\s\S]*?)\nPY/)[1];
      for (const yanked of [false, true, undefined]) {
        const document = {urls: [{filename: 'guardscan.whl',
          digests: {sha256: crypto.createHash('sha256').update('wheel').digest('hex')},
          ...(yanked === undefined ? {} : {yanked})}]};
        const harness = [
          'import io, json, os, pathlib, sys, tempfile, time, urllib.request',
          'previous = os.getcwd()',
          'with tempfile.TemporaryDirectory() as root:',
          '    try:',
          '        os.chdir(root); pathlib.Path("dist").mkdir(); pathlib.Path("dist/guardscan.whl").write_bytes(b"wheel")',
          '        urllib.request.urlopen = lambda *args, **kwargs: io.StringIO(sys.argv[2])',
          '        time.sleep = lambda _: None',
          '        exec(sys.argv[1])',
          '    finally:',
          '        os.chdir(previous)',
        ].join('\n');
        const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', harness, script, JSON.stringify(document)], {
          encoding: 'utf8', timeout: 10000,
          env: {...process.env, REGISTRY_JSON_BASE: 'https://pypi.org/pypi/guardscan-cli', RELEASE_VERSION: 'v1.2.3'},
        });
        if (yanked === false && result.status !== 0) throw new Error(result.stderr || String(result.error));
        expect(result.status === 0).toBe(yanked === false);
      }
    }
  });

  it('checks the actual executable version before accepting moderated canaries', () => {
    const job = workflow('release-canary.yml').jobs.moderated;
    const step = job.steps.find((s: any) => s.name === 'Poll, install, invoke, and uninstall public moderated channels');
    expect(step.run.match(/\$reportedVersion = \(& guardscan --version \| Out-String\)\.Trim\(\)/g)).toHaveLength(2);
    expect(step.run.match(/\$reportedVersion -cne '\$\{\{ matrix.train.version \}\}'/g)).toHaveLength(2);
    expect(step.run.indexOf('reportedVersion -cne')).toBeLessThan(step.run.indexOf("$report.status = 'passed'"));
  });

  it('refreshes installed WinGet paths without discarding process-only tools before invocation', () => {
    const step = workflow('release-canary.yml').jobs.moderated.steps.find((s: any) => (
      s.name === 'Poll, install, invoke, and uninstall public moderated channels'
    ));
    const winget = step.run.slice(step.run.indexOf('winget install --exact'), step.run.indexOf('winget uninstall --exact'));
    const refresh = "$env:PATH = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), $env:PATH) -join ';'";
    expect(winget).toContain(refresh);
    expect(winget.indexOf(refresh)).toBeGreaterThan(winget.indexOf("throw 'WinGet installation failed'"));
    expect(winget.indexOf(refresh)).toBeLessThan(winget.indexOf('& guardscan --version'));
  });

  it('verifies the complete immutable adapter projection, not only matching target bytes', () => {
    const {verifyAdapterProjection} = require('../../scripts/release/adapter-projection');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-projection-'));
    const target = 'Formula/guardscan.rb';
    const rendered = path.join(root, 'rendered.rb');
    const repo = path.join(root, 'catalog'); fs.mkdirSync(repo);
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, {cwd: repo, encoding: 'utf8', env: {...process.env,
        GIT_AUTHOR_NAME: 'Release Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Release Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'}});
      if (result.status !== 0) throw new Error(result.stderr || String(result.error));
      return result.stdout.trim();
    };
    const commit = () => { git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
    try {
      git('init'); fs.mkdirSync(path.join(repo, 'Formula'));
      fs.writeFileSync(path.join(repo, target), 'old\n');
      const base = commit();
      fs.writeFileSync(rendered, 'verified projection\n');
      fs.writeFileSync(path.join(repo, target), 'verified projection\n');
      const good = commit();
      expect(() => verifyAdapterProjection(repo, rendered, target, good, base)).not.toThrow();
      fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'smuggled change\n');
      const extra = commit();
      expect(() => verifyAdapterProjection(repo, rendered, target, extra, base)).toThrow(/complete|projection/);
      fs.writeFileSync(path.join(repo, target), 'different\n');
      const wrong = commit();
      expect(() => verifyAdapterProjection(repo, rendered, target, wrong, extra)).toThrow(/bytes|projection/);
      const blob = git('rev-parse', `${good}:${target}`);
      git('update-index', '--cacheinfo', `120000,${blob},${target}`);
      git('-c', 'commit.gpgsign=false', 'commit', '-m', 'symlink fixture');
      const symlink = git('rev-parse', 'HEAD');
      expect(() => verifyAdapterProjection(repo, rendered, target, symlink, wrong)).toThrow(/regular/);
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });

  it('validates the complete shared catalog projection before merge and verifies the actual merge again', () => {
    const run = workflow('release-publish.yml').jobs.catalog.steps.find((s: any) => s.name === 'Push one deterministic catalog update').run;
    const merge = run.indexOf('gh pr merge');
    const checks = [...run.matchAll(/verifyCatalogProjection\(/g)].map(match => match.index!);
    expect(merge).toBeGreaterThan(-1);
    expect(checks.length).toBeGreaterThanOrEqual(2);
    expect(checks[0]).toBeLessThan(merge);
    expect(checks.at(-1)).toBeGreaterThan(merge);
    expect(run).toContain('$MERGE_SHA^1');
  });

  it('rejects extra paths, altered bytes, and symlinks in the shared catalog projection', () => {
    const {verifyCatalogProjection} = require('../../scripts/release/adapter-projection');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-projection-'));
    const repo = path.join(root, 'catalog');
    const rendered = path.join(root, 'rendered');
    fs.mkdirSync(repo);
    const targets = ['Formula/guardscan.rb', 'bucket/guardscan.json', 'channel-lock.json', '.github/workflows/verify.yml'];
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, {cwd: repo, encoding: 'utf8', env: {...process.env,
        GIT_AUTHOR_NAME: 'Release Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Release Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'}});
      if (result.status !== 0) throw new Error(result.stderr || String(result.error));
      return result.stdout.trim();
    };
    const commit = () => { git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
    try {
      git('init');
      fs.writeFileSync(path.join(repo, 'README.md'), 'catalog\n');
      const base = commit();
      for (const target of targets) {
        for (const directory of [repo, rendered]) {
          fs.mkdirSync(path.dirname(path.join(directory, target)), {recursive: true});
          fs.writeFileSync(path.join(directory, target), `immutable ${target}\n`);
        }
      }
      const good = commit();
      const verify = (head: string) => verifyCatalogProjection(repo, rendered,
        path.join(rendered, '.github/workflows/verify.yml'), head, base);
      expect(() => verify(good)).not.toThrow();
      fs.writeFileSync(path.join(repo, 'extra.txt'), 'smuggled\n');
      const extra = commit();
      expect(() => verify(extra)).toThrow(/complete|projection/i);
      git('-c', 'commit.gpgsign=false', 'revert', '--no-edit', extra);
      fs.writeFileSync(path.join(repo, targets[1]), 'wrong bytes\n');
      const wrong = commit();
      expect(() => verify(wrong)).toThrow(/bytes|projection/);
      git('-c', 'commit.gpgsign=false', 'revert', '--no-edit', wrong);
      const blob = git('rev-parse', `${good}:${targets[0]}`);
      git('update-index', '--cacheinfo', `120000,${blob},${targets[0]}`);
      git('-c', 'commit.gpgsign=false', 'commit', '-m', 'symlink fixture');
      expect(() => verify(git('rev-parse', 'HEAD'))).toThrow(/regular/);
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });
});
