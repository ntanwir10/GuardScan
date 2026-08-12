'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const test = require('node:test');
const yaml = require('../../cli/node_modules/js-yaml');

const root = path.resolve(__dirname, '..', '..');
const provenancePath = path.join(root, '.github', 'release-bootstrap-provenance.json');
const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
const releaseWorkflowNames = [
  'release-build.yml',
  'release-canary.yml',
  'release-credential-health.yml',
  'release-first-withdrawal.yml',
  'release-please.yml',
  'release-provider-rehearsal.yml',
  'release-publish.yml',
  'release-train.yml',
];

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function exactKeys(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

function relativeFiles(entry) {
  const absolute = path.join(root, entry);
  const stat = fs.lstatSync(absolute);
  assert.equal(stat.isSymbolicLink(), false, `${entry} must not be a symlink`);
  if (stat.isFile()) return [entry];
  assert.equal(stat.isDirectory(), true, `${entry} must be a regular file or directory`);
  const files = [];
  const walk = directory => {
    for (const name of fs.readdirSync(path.join(root, directory)).sort()) {
      const relative = path.posix.join(directory, name);
      const child = fs.lstatSync(path.join(root, relative));
      assert.equal(child.isSymbolicLink(), false, `${relative} must not be a symlink`);
      if (child.isDirectory()) walk(relative);
      else {
        assert.equal(child.isFile(), true, `${relative} must be a regular file`);
        files.push(relative);
      }
    }
  };
  walk(entry);
  return files;
}

function sourceFiles() {
  const files = provenance.sourceRoots.flatMap(relativeFiles).sort();
  assert.equal(new Set(files).size, files.length, 'source roots must not overlap');
  return files;
}

function workflow(name) {
  const file = path.join(root, '.github', 'workflows', name);
  return {
    source: fs.readFileSync(file, 'utf8'),
    document: yaml.load(fs.readFileSync(file, 'utf8')),
  };
}

function needsFor(job) {
  if (job.needs === undefined) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

test('bootstrap is based on the declared current main and changes only the release control plane', () => {
  exactKeys(provenance, [
    'schemaVersion', 'baseCommit', 'sourceCommit', 'publicVersion',
    'requiredRepositoryVariables', 'sourceRoots', 'sourceFileCount', 'sourceTreeSha256',
  ]);
  assert.equal(provenance.schemaVersion, 'guardscan.release-bootstrap-provenance.v1');
  assert.match(provenance.baseCommit, /^[a-f0-9]{40}$/);
  assert.match(provenance.sourceCommit, /^[a-f0-9]{40}$/);
  assert.notEqual(provenance.baseCommit, provenance.sourceCommit);
  git(['merge-base', '--is-ancestor', provenance.baseCommit, 'HEAD']);

  const allowedFiles = new Set([
    ...sourceFiles(),
    '.github/release-bootstrap-provenance.json',
    '.github/scripts/verify-inert-release-bootstrap.test.js',
    '.github/workflows/ci.yml',
    '.release-please-manifest.json',
  ]);
  const changed = git(['diff', '--name-only', provenance.baseCommit, '--'])
    .trim().split('\n').filter(Boolean);
  assert.ok(changed.length > 0, 'bootstrap must contain a scoped change');
  assert.deepEqual(changed.filter(file => !allowedFiles.has(file)), []);
});

test('every imported control-plane byte is bound to the reviewed source commit', () => {
  git(['cat-file', '-e', `${provenance.sourceCommit}^{commit}`]);
  const records = [];
  const files = sourceFiles();
  assert.equal(files.length, provenance.sourceFileCount);
  for (const file of files) {
    const current = fs.readFileSync(path.join(root, file));
    const reviewed = git(['show', `${provenance.sourceCommit}:${file}`], {encoding: null});
    assert.equal(Buffer.compare(current, reviewed), 0, `${file} drifted from the reviewed source`);
    records.push(`${file}\0${sha256(current)}\n`);
  }
  assert.equal(sha256(records.join('')), provenance.sourceTreeSha256);
});

test('public version and Release Please state remain neutral at 1.0.5', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'cli/package.json')));
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'cli/package-lock.json')));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.release-please-manifest.json')));
  const config = JSON.parse(fs.readFileSync(path.join(root, 'release-please-config.json')));
  assert.equal(packageJson.version, provenance.publicVersion);
  assert.equal(packageLock.version, provenance.publicVersion);
  assert.equal(packageLock.packages[''].version, provenance.publicVersion);
  assert.deepEqual(manifest, {cli: provenance.publicVersion});
  assert.equal(config['bootstrap-sha'], provenance.baseCommit);
  assert.equal(config['skip-github-release'], true);
  assert.equal(config.packages.cli['package-name'], 'guardscan');
});

test('legacy tag-triggered publication is removed from CI', () => {
  const {source, document} = workflow('ci.yml');
  assert.deepEqual(document.on.push.branches, ['main', 'develop']);
  assert.equal(document.on.push.tags, undefined);
  assert.equal(document.permissions.contents, 'read');
  assert.ok(document.jobs['release-bootstrap']);
  assert.equal(document.jobs['publish-npm'], undefined);
  assert.equal(document.jobs['create-release'], undefined);
  assert.equal(document.jobs.lint.name, 'Typecheck unchanged 1.0.5 source');
  assert.doesNotMatch(source, /npm publish|gh release (?:create|edit|upload)|action-gh-release/);
});

test('all workflow YAML parses, has a closed acyclic dependency graph, and pins actions', () => {
  const directory = path.join(root, '.github', 'workflows');
  for (const name of fs.readdirSync(directory).filter(file => file.endsWith('.yml')).sort()) {
    const {source, document} = workflow(name);
    assert.ok(document && document.jobs, `${name} must define jobs`);
    assert.doesNotMatch(source, /pull_request_target/);
    for (const match of source.matchAll(/^\s*uses:\s+([^./\s][^@\s]+)@([^\s#]+)/gm)) {
      assert.match(match[2], /^[a-f0-9]{40}$/, `${name} action ${match[1]} is not SHA-pinned`);
    }
    const visiting = new Set();
    const complete = new Set();
    const visit = id => {
      assert.ok(document.jobs[id], `${name} references missing job ${id}`);
      if (complete.has(id)) return;
      assert.equal(visiting.has(id), false, `${name} has a dependency cycle at ${id}`);
      visiting.add(id);
      for (const dependency of needsFor(document.jobs[id])) visit(dependency);
      visiting.delete(id);
      complete.add(id);
    };
    for (const id of Object.keys(document.jobs)) visit(id);
  }
});

test('every release mutation remains behind its explicit disabled authority', () => {
  assert.deepEqual(provenance.requiredRepositoryVariables, {
    RELEASE_AUTOMATION_ENABLED: 'false',
    RELEASE_PLEASE_ENABLED: 'false',
    RELEASE_PROVIDER_REHEARSAL_ENABLED: 'false',
  });
  const train = workflow('release-train.yml');
  const publish = workflow('release-publish.yml');
  for (const id of [
    'scheduler', 'catalog-hint', 'prepare', 'build', 'checkpoint', 'pypi-test',
    'pypi', 'publish', 'record', 'reconcile', 'first-release-withdrawal', 'rollback',
  ]) {
    assert.match(train.document.jobs[id].if, /vars\.RELEASE_AUTOMATION_ENABLED == 'true'/);
  }
  for (const id of ['github', 'npm', 'catalog', 'winget', 'chocolatey']) {
    assert.match(publish.document.jobs[id].if, /vars\.RELEASE_AUTOMATION_ENABLED == 'true'/);
  }
  assert.match(
    workflow('release-canary.yml').document.jobs.record.if,
    /vars\.RELEASE_AUTOMATION_ENABLED == 'true'/
  );
  assert.match(
    workflow('release-first-withdrawal.yml').document.jobs.withdraw.if,
    /vars\.RELEASE_AUTOMATION_ENABLED == 'true'/
  );
  assert.match(
    workflow('release-please.yml').document.jobs['release-pr'].if,
    /vars\.RELEASE_PLEASE_ENABLED == 'true'/
  );
  const rehearsal = workflow('release-provider-rehearsal.yml');
  for (const id of ['validate', 'rehearsal']) {
    assert.match(rehearsal.document.jobs[id].if, /vars\.RELEASE_AUTOMATION_ENABLED != 'true'/);
    assert.match(rehearsal.document.jobs[id].if, /vars\.RELEASE_PROVIDER_REHEARSAL_ENABLED == 'true'/);
  }
  assert.doesNotMatch(rehearsal.source, /npm publish|gh release|choco push|wingetcreate/);
});

test('ledger seed and first-withdrawal bootstrap contract are neutral and fail closed', () => {
  const seed = JSON.parse(fs.readFileSync(path.join(root, '.github/release-ledger/active-versions.json')));
  assert.deepEqual(seed, {schemaVersion: 'guardscan.active-trains.v1', trains: []});
  const ledgerFiles = relativeFiles('.github/release-ledger');
  assert.deepEqual(ledgerFiles, [
    '.github/release-ledger/README.md',
    '.github/release-ledger/active-versions.json',
  ]);
  const withdrawal = workflow('release-first-withdrawal.yml').source;
  assert.match(withdrawal, /first-release-authority\.json/);
  assert.match(withdrawal, /known-good baseline/);
  assert.match(withdrawal, /provider-actions-pending/);
  assert.match(withdrawal, /RELEASE_AUTOMATION_ENABLED == 'true'/);
});

test('checkpoint retry and top-level trusted-publisher topology are present', () => {
  const train = workflow('release-train.yml');
  assert.deepEqual(needsFor(train.document.jobs.build), ['prepare', 'resolve-checkpoint']);
  assert.deepEqual(needsFor(train.document.jobs.checkpoint), ['prepare', 'resolve-checkpoint', 'build']);
  assert.equal(train.document.jobs['pypi-test'].environment, 'testpypi');
  assert.equal(train.document.jobs.pypi.environment, 'pypi');
  assert.equal(train.document.jobs['pypi-test'].permissions['id-token'], 'write');
  assert.equal(train.document.jobs.pypi.permissions['id-token'], 'write');
  assert.match(train.source, /mode=checkpoint/);
  assert.match(train.source, /mode=expanded/);
  assert.match(train.source, /verify-checkpoint/);
  assert.doesNotMatch(workflow('release-publish.yml').source, /pypa\/gh-action-pypi-publish/);
});
