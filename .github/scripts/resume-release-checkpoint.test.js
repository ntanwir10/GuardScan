'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const {resumeCheckpoint} = require('./resume-release-checkpoint');
const {createCheckpoint} = require('../../cli/scripts/release/checkpoint');
const {createPointer, formatPointer} = require('../../cli/scripts/release/canonical-payload');

const repository = 'ntanwir10/GuardScan';
const tag = 'v1.1.0';
const commit = 'b'.repeat(40);
const workflowSha = 'a'.repeat(40);
const archive = 'guardscan-release-checkpoint-1.1.0.tar.gz';
const sidecar = `${archive}.metadata.json`;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(existing = archive) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-checkpoint-resume-'));
  const input = path.join(root, 'input');
  const payload = path.join(input, 'payload');
  fs.mkdirSync(payload, {recursive: true});
  const producer = {provider: 'github-actions', repository, workflow: '.github/workflows/release-build.yml',
    workflowSha, runId: '42', runAttempt: 2, sourceRef: `refs/tags/${tag}`};
  const manifest = {schemaVersion: 'guardscan.release-manifest.v1', version: '1.1.0', tag, commit, producer};
  fs.writeFileSync(path.join(payload, 'release-manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(payload, 'release-build-provenance.json'), JSON.stringify({
    schemaVersion: 'guardscan.release-build-provenance.v1', workflow: producer.workflow,
    ref: 'refs/heads/main', sha: workflowSha,
  }));
  fs.writeFileSync(path.join(payload, 'SHA256SUMS'), ['release-build-provenance.json', 'release-manifest.json']
    .map(name => `${digest(fs.readFileSync(path.join(payload, name)))}  ${name}\n`).join(''));
  fs.writeFileSync(path.join(payload, 'SHA256SUMS.sigstore.json'), '{}');
  const state = {draft: true, tag_name: tag, assets: [{name: existing}], body: formatPointer(createPointer(payload, tag))};
  const canonical = path.join(root, 'canonical');
  // Checkpoint producer has a deliberately narrower schema than the signed build producer.
  const checkpointProducer = {...producer, workflow: '.github/workflows/release-train.yml'};
  delete checkpointProducer.workflowSha;
  createCheckpoint({version: '1.1.0', tag, commit}, {root: input, outputDir: canonical,
    files: fs.readdirSync(payload).map(name => `payload/${name}`), timestamp: '2026-08-12T12:00:00.000Z', producer: checkpointProducer});
  const zip = path.join(root, 'canonical.zip');
  execFileSync('zip', ['-q', zip, archive, sidecar], {cwd: canonical});
  const bytes = fs.readFileSync(zip);
  const artifact = {id: 123, name: `release-checkpoint-${tag}`, expired: false,
    digest: `sha256:${digest(bytes)}`, workflow_run: {id: 42, head_sha: workflowSha}};
  const run = {id: 42, run_attempt: 2, path: '.github/workflows/release-train.yml', event: 'workflow_dispatch',
    head_branch: 'main', head_sha: workflowSha, repository: {full_name: repository}, head_repository: {full_name: repository}};
  const context = {root, state, artifact, artifacts: [artifact], run, bytes, drift: false, rejectSignature: false,
    mutations: [], calls: []};
  context.execute = (command, args, options) => {
    context.calls.push([command, args]);
    if (command === 'unzip') return execFileSync(command, args, options);
    if (command === 'cosign') {
      if (context.rejectSignature) throw new Error('signature rejected');
      return '';
    }
    assert.equal(command, 'gh');
    if (args[0] === 'api') {
      if (args.includes('--paginate')) return JSON.stringify([{artifacts: context.artifacts}]);
      if (args[1].endsWith('/zip')) return context.bytes;
      if (args[1].includes('/actions/runs/')) return JSON.stringify(context.run);
      if (args[1].includes('/commits/')) return JSON.stringify({sha: commit});
      throw new Error(`unexpected API ${args}`);
    }
    if (args[1] === 'upload') {
      context.mutations.push(args);
      assert.equal(path.basename(args[3]), existing === archive ? sidecar : archive);
      assert.ok(!args.includes('--clobber'));
      return '';
    }
    assert.equal(args[1], 'download');
    const directory = args[args.indexOf('--dir') + 1];
    for (const [index, arg] of args.entries()) {
      if (arg !== '--pattern') continue;
      fs.copyFileSync(path.join(canonical, args[index + 1]), path.join(directory, args[index + 1]));
    }
    if (context.drift && directory.endsWith('existing')) fs.appendFileSync(path.join(directory, existing), 'drift');
    return '';
  };
  return context;
}

function withFixture(name, check, existing) {
  test(name, () => {
    const previous = process.env.GITHUB_REPOSITORY;
    process.env.GITHUB_REPOSITORY = repository;
    const f = fixture(existing);
    try { check(f, () => resumeCheckpoint(tag, commit, f.state, f.root, f.execute)); }
    finally {
      fs.rmSync(f.root, {recursive: true, force: true});
      if (previous === undefined) delete process.env.GITHUB_REPOSITORY;
      else process.env.GITHUB_REPOSITORY = previous;
    }
  });
}

for (const existing of [archive, sidecar]) {
  withFixture(`resumes only the missing asset when ${existing} already exists`, (f, resume) => {
    resume();
    assert.equal(f.mutations.length, 1);
    const auth = f.calls.findIndex(([command]) => command === 'cosign');
    const upload = f.calls.findIndex(([, args]) => args[1] === 'upload');
    assert.ok(auth >= 0 && auth < upload);
    assert.deepEqual(fs.readFileSync(path.join(f.root, 'rehydrated/payload/release-manifest.json')),
      fs.readFileSync(path.join(f.root, 'input/payload/release-manifest.json')));
  }, existing);
}

for (const [name, change] of [
  ['existing byte drift', f => { f.drift = true; }],
  ['missing retained artifact', f => { f.artifacts = []; }],
  ['ambiguous artifact history', f => { f.artifacts.push({...f.artifact, id: 124}); }],
  ['expired artifact', f => { f.artifact.expired = true; }],
  ['artifact digest drift', f => { f.artifact.digest = `sha256:${'0'.repeat(64)}`; }],
  ['untrusted event', f => { f.run.event = 'pull_request'; }],
  ['untrusted head repository', f => { f.run.head_repository.full_name = 'attacker/GuardScan'; }],
  ['wrong run attempt', f => { f.run.run_attempt = 3; }],
  ['untrusted signer', f => { f.rejectSignature = true; }],
  ['unknown checkpoint suffix', f => { f.state.assets[0].name = `${archive}.unexpected`; }],
  ['duplicate existing asset', f => { f.state.assets.push({...f.state.assets[0]}); }],
  ['published checkpoint', f => { f.state.draft = false; }],
  ['tag drift', f => { f.state.tag_name = 'v1.1.1'; }],
]) {
  withFixture(`rejects ${name} without release writes`, (f, resume) => {
    change(f);
    assert.throws(resume);
    assert.equal(f.mutations.length, 0);
  });
}

withFixture('rejects checkpoint source SHA drift without release writes', (f) => {
  assert.throws(() => resumeCheckpoint(tag, 'c'.repeat(40), f.state, f.root, f.execute));
  assert.equal(f.mutations.length, 0);
});

withFixture('rejects an unexpected zip member before extraction or release writes', (f, resume) => {
  const canonical = path.join(f.root, 'canonical');
  fs.writeFileSync(path.join(canonical, 'unexpected.js'), 'process.exit(1)');
  const zip = path.join(f.root, 'unexpected.zip');
  execFileSync('zip', ['-q', zip, archive, sidecar, 'unexpected.js'], {cwd: canonical});
  f.bytes = fs.readFileSync(zip);
  f.artifact.digest = `sha256:${digest(f.bytes)}`;
  assert.throws(resume, /inventory mismatch/);
  assert.equal(f.mutations.length, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'checkpoint-recovery/unexpected.js')), false);
});

withFixture('rejects a checkpoint sidecar from a different run attempt without release writes', (f, resume) => {
  const canonical = path.join(f.root, 'canonical');
  const document = JSON.parse(fs.readFileSync(path.join(canonical, sidecar), 'utf8'));
  document.producer.runAttempt = 3;
  fs.writeFileSync(path.join(canonical, sidecar), JSON.stringify(document));
  const zip = path.join(f.root, 'wrong-attempt.zip');
  execFileSync('zip', ['-q', zip, archive, sidecar], {cwd: canonical});
  f.bytes = fs.readFileSync(zip);
  f.artifact.digest = `sha256:${digest(f.bytes)}`;
  assert.throws(resume, /run attempt mismatch/);
  assert.equal(f.mutations.length, 0);
});
