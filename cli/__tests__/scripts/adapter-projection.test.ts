import fs from 'fs';
import os from 'os';
import path from 'path';
import {execFileSync} from 'child_process';

const {verifyCatalogProjection, verifyAdapterProjection} = require('../../scripts/release/adapter-projection');
const targets = ['Formula/guardscan.rb', 'bucket/guardscan.json', 'channel-lock.json', '.github/workflows/verify.yml'];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-projection-'));
  const repo = path.join(root, 'repo');
  const rendered = path.join(root, 'rendered');
  const workflow = path.join(root, 'verify.yml');
  fs.mkdirSync(repo); fs.mkdirSync(rendered);
  const git = (...args: string[]) => execFileSync('git', args, {cwd: repo, encoding: 'utf8',
    env: {...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'}}).trim();
  const put = (target: string, bytes: string) => {
    const file = path.join(repo, target);
    fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes);
  };
  const commit = () => {
    git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  git('init', '--quiet');
  for (const target of targets) put(target, 'old\n');
  const base = commit();
  for (const target of targets) {
    const file = target === targets[3] ? workflow : path.join(rendered, target);
    fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `canonical ${target}\n`);
    put(target, `canonical ${target}\n`);
  }
  const head = commit();
  return {root, repo, rendered, workflow, git, put, commit, base, head,
    verify: (headSha = head, baseSha = base) => verifyCatalogProjection(repo, rendered, workflow, headSha, baseSha)};
}

describe('immutable shared catalog projection', () => {
  it('accepts the complete canonical four-file PR and its merged diff', () => {
    const f = fixture();
    try {
      expect(() => f.verify()).not.toThrow();
      f.git('checkout', '--quiet', '--detach', f.base);
      f.git('-c', 'commit.gpgsign=false', 'merge', '--quiet', '--no-ff', f.head, '-m', 'merge fixture');
      expect(() => f.verify(f.git('rev-parse', 'HEAD'))).not.toThrow();
    } finally { fs.rmSync(f.root, {recursive: true, force: true}); }
  });

  it('accepts unchanged canonical files while still checking the complete four-file head', () => {
    const f = fixture();
    try {
      f.git('checkout', '--quiet', '--detach', f.base);
      f.put(targets[0], `canonical ${targets[0]}\n`);
      const partiallyCurrentBase = f.commit();
      for (const target of targets.slice(1)) f.put(target, `canonical ${target}\n`);
      expect(() => f.verify(f.commit(), partiallyCurrentBase)).not.toThrow();
    } finally { fs.rmSync(f.root, {recursive: true, force: true}); }
  });

  it('rejects extra files anywhere in the complete PR diff and an empty projection', () => {
    const f = fixture();
    try {
      f.put('unrelated.txt', 'smuggled\n');
      expect(() => f.verify(f.commit())).toThrow(/complete|projection/i);
      expect(() => f.verify(f.head, f.head)).toThrow(/complete|projection/i);
    } finally { fs.rmSync(f.root, {recursive: true, force: true}); }
  });

  it.each(targets)('rejects incorrect bytes or a missing canonical %s', target => {
    const f = fixture();
    try {
      f.put(target, 'unexpected\n');
      expect(() => f.verify(f.commit())).toThrow(/bytes/);
      fs.unlinkSync(path.join(f.repo, target));
      expect(() => f.verify(f.commit())).toThrow(/regular/);
    } finally { fs.rmSync(f.root, {recursive: true, force: true}); }
  });

  it.each(['120000', '100755'])('rejects canonical files with Git mode %s', mode => {
    const f = fixture();
    try {
      for (const target of targets) {
        const blob = f.git('rev-parse', `${f.head}:${target}`);
        f.git('update-index', '--cacheinfo', `${mode},${blob},${target}`);
      }
      f.git('-c', 'commit.gpgsign=false', 'commit', '-m', 'non-regular projection');
      expect(() => f.verify(f.git('rev-parse', 'HEAD'))).toThrow(/regular/);
    } finally { fs.rmSync(f.root, {recursive: true, force: true}); }
  });

  it.each(['Formula/guardscan.rb', 'workflow'])('requires bounded regular trusted input for %s', target => {
    const f = fixture();
    try {
      const renderedFile = target === 'workflow' ? f.workflow : path.join(f.rendered, target);
      fs.writeFileSync(renderedFile, Buffer.alloc(1024 * 1024 + 1));
      expect(() => f.verify()).toThrow(/bounded regular/);
      fs.unlinkSync(renderedFile);
      fs.symlinkSync(path.join(f.repo, targets[0]), renderedFile);
      expect(() => f.verify()).toThrow(/bounded regular/);
    } finally { fs.rmSync(f.root, {recursive: true, force: true}); }
  });

  it('retains the one-target adapter invariant and strict commit identities', () => {
    const f = fixture();
    try {
      expect(() => verifyAdapterProjection(f.repo, path.join(f.rendered, targets[0]), targets[0], f.head, f.base))
        .toThrow(/complete|projection/i);
      expect(() => f.verify('HEAD')).toThrow(/identity/);
      expect(() => f.verify(f.head, 'main')).toThrow(/identity/);
    } finally { fs.rmSync(f.root, {recursive: true, force: true}); }
  });
});
