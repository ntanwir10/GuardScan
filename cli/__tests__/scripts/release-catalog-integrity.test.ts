import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import os from 'os';
import {spawnSync} from 'child_process';

const source = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/release-train.yml'), 'utf8');
const workflow: any = yaml.load(source);
const step = (name: string): string => Object.values(workflow.jobs).flatMap((job: any) => job.steps || [])
  .find((entry: any) => entry.name === name).run;

describe('catalog reconciliation and rollback integrity', () => {
  it('rejects unbound PR identities and requires an actual merge when recording final evidence', () => {
    const {validateCatalogPullRequest} = require('../../scripts/release/adapter-projection');
    const head = 'a'.repeat(40);
    const valid = {state: 'MERGED', baseRefName: 'main', headRefOid: head,
      headRepository: {nameWithOwner: 'ntanwir10/homebrew-tap'}, mergeCommit: {oid: 'b'.repeat(40)}};
    expect(() => validateCatalogPullRequest(valid, head, true)).not.toThrow();
    expect(() => validateCatalogPullRequest({...valid, state: 'OPEN', mergeCommit: null}, head, false)).not.toThrow();
    for (const invalid of [
      {...valid, baseRefName: 'other'}, {...valid, headRefOid: 'c'.repeat(40)},
      {...valid, headRepository: {nameWithOwner: 'attacker/tap'}}, {...valid, state: 'CLOSED'},
      {...valid, state: 'OPEN'}, {...valid, mergeCommit: null}, {...valid, mergeCommit: {oid: 'invalid'}},
    ]) expect(() => validateCatalogPullRequest(invalid, head, true)).toThrow();
  });

  it('restores the complete known-good catalog and authenticates its workflow against the pinned source', () => {
    const run = step('Restore the shared catalog to the exact known-good projection');
    const preparation = run.slice(run.indexOf('git -C catalog-rollback switch'),
      run.indexOf('git -C catalog-rollback config'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-known-good-'));
    const repo = path.join(root, 'catalog-rollback');
    const workflowPath = '.github/workflows/verify.yml';
    const targets = ['Formula/guardscan.rb', 'bucket/guardscan.json', 'channel-lock.json', workflowPath];
    const git = (cwd: string, ...args: string[]) => {
      const result = spawnSync('git', args, {cwd, encoding: 'utf8', env: {...process.env,
        GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'}});
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    const commit = (cwd: string) => {git(cwd, 'add', '.'); git(cwd, '-c', 'commit.gpgsign=false',
      'commit', '-m', 'fixture'); return git(cwd, 'rev-parse', 'HEAD');};
    try {
      fs.mkdirSync(repo);
      git(root, 'init');
      fs.mkdirSync(path.join(root, 'catalog/homebrew-tap/.github/workflows'), {recursive: true});
      fs.writeFileSync(path.join(root, 'catalog/homebrew-tap', workflowPath), 'known-good workflow\n');
      const sourceCommit = commit(root);
      fs.writeFileSync(path.join(root, 'known-good-workflow.yml'), 'known-good workflow\n');
      fs.writeFileSync(path.join(root, 'catalog/homebrew-tap', workflowPath), 'defective workflow\n');
      git(repo, 'init');
      for (const target of targets) {
        fs.mkdirSync(path.dirname(path.join(repo, target)), {recursive: true});
        fs.writeFileSync(path.join(repo, target), target === workflowPath ? 'known-good workflow\n'
          : target === 'channel-lock.json' ? JSON.stringify({sourceCommit}) : `${target} known-good\n`);
      }
      const knownGood = commit(repo);
      for (const target of targets) fs.writeFileSync(path.join(repo, target), `${target} defective\n`);
      const base = commit(repo);
      const execute = () => spawnSync('bash', ['-euo', 'pipefail', '-c', preparation.replace(/\r\n/g, '\n')],
        {cwd: root, encoding: 'utf8', env: {...process.env,
          PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
          CATALOG_BRANCH: `recovery-${git(repo, 'rev-parse', '--short', 'HEAD')}`,
          CATALOG_BASE: base, KNOWN_GOOD_CATALOG_COMMIT: knownGood, KNOWN_GOOD_COMMIT: sourceCommit}});
      expect(execute().status).toBe(0);
      const restored = commit(repo);
      const {verifyCatalogProjection} = require('../../scripts/release/adapter-projection');
      expect(() => verifyCatalogProjection(repo, path.join(root, 'catalog-rollback-trusted'),
        path.join(root, 'known-good-workflow.yml'), restored, base)).not.toThrow();
      expect(git(repo, 'show', `${restored}:${workflowPath}`)).toBe('known-good workflow');
      // A ledger catalog whose workflow disagrees with its authenticated source must stop before publication.
      fs.writeFileSync(path.join(repo, workflowPath), 'mismatched catalog workflow\n');
      const mismatched = commit(repo);
      const rejected = spawnSync('bash', ['-euo', 'pipefail', '-c', preparation.replace(/\r\n/g, '\n')
        + '\ntouch push-reached'], {cwd: root, encoding: 'utf8', env: {...process.env,
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
        CATALOG_BRANCH: 'mismatched-recovery', CATALOG_BASE: base,
        KNOWN_GOOD_CATALOG_COMMIT: mismatched, KNOWN_GOOD_COMMIT: sourceCommit}});
      expect(rejected.status).not.toBe(0);
      expect(fs.existsSync(path.join(root, 'push-reached'))).toBe(false);
    } finally {fs.rmSync(root, {recursive: true, force: true});}
  });

  it.each([
    'Authoritatively refetch and reconcile the shared catalog',
    'Restore the shared catalog to the exact known-good projection',
  ])('checks full head projection before exact-head merge and merged projection before evidence: %s', name => {
    const run = step(name);
    const merge = run.indexOf('gh pr merge');
    const checks = [...run.matchAll(/verifyCatalogProjection\(/g)].map(match => match.index!);
    expect(checks.length).toBeGreaterThanOrEqual(2);
    expect(checks[0]).toBeLessThan(merge);
    expect(checks.at(-1)).toBeGreaterThan(merge);
    expect(run).toContain('validateCatalogPullRequest');
    expect(run).toContain('--match-head-commit');
    expect(run).not.toContain('--auto');
    expect(run).toContain('merge-base --is-ancestor');
    expect(run).toContain('^1');
    expect(spawnSync('bash', ['-n'], {input: run.replace(/\r\n/g, '\n'), encoding: 'utf8'}).status).toBe(0);
  });

  it.each([
    ['Authoritatively refetch and reconcile the shared catalog', 'catalog-checkout', 'catalog-verification/rendered', 'EXPECTED_HEAD'],
    ['Restore the shared catalog to the exact known-good projection', 'catalog-rollback', 'catalog-rollback-trusted', 'CATALOG_HEAD'],
  ])('never reaches the extracted merge command for an extra-path or unsafe-mode head: %s', (name, checkout, renderedName, headVariable) => {
    const run = step(name);
    const check = run.match(/node -e '[^\n]*verifyCatalogProjection[^\n]*' \\\n[^\n]*\\\n[^\n]*/)?.[0];
    const merge = run.match(/^\s*gh pr merge[^\n]*--match-head-commit[^\n]*/m)?.[0];
    expect(check).toBeTruthy();
    expect(merge).toBeTruthy();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-before-merge-'));
    const repo = path.join(root, checkout);
    const rendered = path.join(root, renderedName);
    const targets = ['Formula/guardscan.rb', 'bucket/guardscan.json', 'channel-lock.json', '.github/workflows/verify.yml'];
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, {cwd: repo, encoding: 'utf8', env: {...process.env,
        GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'}});
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    const commit = () => {git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'); return git('rev-parse', 'HEAD');};
    try {
      fs.mkdirSync(repo);
      fs.symlinkSync(path.resolve(__dirname, '../..'), path.join(root, 'cli'), 'dir');
      git('init');
      fs.writeFileSync(path.join(repo, 'README'), 'base\n');
      const base = commit();
      for (const target of targets) {
        for (const directory of [repo, rendered, path.join(root, 'catalog/homebrew-tap')]) {
          fs.mkdirSync(path.dirname(path.join(directory, target)), {recursive: true});
          fs.writeFileSync(path.join(directory, target), `${target}\n`);
        }
      }
      const good = commit();
      const execute = (head: string) => spawnSync('bash', ['-euo', 'pipefail', '-c', [
        'gh() { echo merged > merge-invoked; }', check!.replace(/\r\n/g, '\n'), merge!.replace(/\r\n/g, '\n'),
      ].join('\n')], {cwd: root, encoding: 'utf8', env: {...process.env,
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
        [headVariable]: head, PROJECTION_BASE: base, PR_NUMBER: '1', CATALOG_PR: '1'}});
      expect(execute(good).status).toBe(0);
      fs.unlinkSync(path.join(root, 'merge-invoked'));
      fs.writeFileSync(path.join(repo, 'extra'), 'unreviewed\n');
      expect(execute(commit()).status).not.toBe(0);
      expect(fs.existsSync(path.join(root, 'merge-invoked'))).toBe(false);
      git('-c', 'commit.gpgsign=false', 'revert', '--no-edit', 'HEAD');
      const blob = git('rev-parse', `${good}:${targets[0]}`);
      git('update-index', '--cacheinfo', `120000,${blob},${targets[0]}`);
      git('-c', 'commit.gpgsign=false', 'commit', '-m', 'unsafe mode');
      expect(execute(git('rev-parse', 'HEAD')).status).not.toBe(0);
      expect(fs.existsSync(path.join(root, 'merge-invoked'))).toBe(false);
    } finally {fs.rmSync(root, {recursive: true, force: true});}
  });
});
