'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {verifyCheckpoint} = require('../../cli/scripts/release/checkpoint');
const {authenticatePayload} = require('../../cli/scripts/release/authenticate-payload');

// shortcut: canonical Actions artifacts expire after 90 days; older partial uploads need investigation.
function resumeCheckpoint(tag, commit, state, root = '.', execute = execFileSync) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (repository !== 'ntanwir10/GuardScan' || !/^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(tag)
      || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid checkpoint recovery identity');
  const archive = `guardscan-release-checkpoint-${tag.slice(1)}.tar.gz`;
  const names = [archive, `${archive}.metadata.json`];
  const assets = state.assets || [];
  if (!state.draft || state.tag_name !== tag || assets.length !== 1 || !names.includes(assets[0].name)) {
    throw new Error('Partial checkpoint must contain exactly one canonical asset');
  }
  const api = endpoint => JSON.parse(execute('gh', ['api', endpoint], {encoding: 'utf8'}));
  const pages = JSON.parse(execute('gh', ['api', '--paginate', '--slurp',
    `repos/${repository}/actions/artifacts?name=release-checkpoint-${tag}&per_page=100`], {encoding: 'utf8'}));
  const artifacts = pages.flatMap(page => page.artifacts || [])
    .filter(artifact => artifact.name === `release-checkpoint-${tag}` && !artifact.expired);
  if (artifacts.length !== 1) throw new Error('Expected one retained canonical checkpoint artifact; legacy or expired partial uploads cannot be resumed');
  const artifact = artifacts[0];
  if (!Number.isSafeInteger(artifact.id) || artifact.id < 1
      || !Number.isSafeInteger(artifact.workflow_run?.id) || artifact.workflow_run.id < 1
      || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest || '')) {
    throw new Error('Invalid canonical checkpoint artifact metadata');
  }
  const run = api(`repos/${repository}/actions/runs/${artifact.workflow_run.id}`);
  const assertRun = candidate => {
    if (String(candidate.id) !== String(artifact.workflow_run.id)
        || String(candidate.path || '').split('@')[0] !== '.github/workflows/release-train.yml'
        || candidate.event !== 'workflow_dispatch' || candidate.head_branch !== 'main'
        || candidate.repository?.full_name?.toLowerCase() !== repository.toLowerCase()
        || candidate.head_repository?.full_name?.toLowerCase() !== repository.toLowerCase()
        || !/^[a-f0-9]{40}$/.test(candidate.head_sha || '')
        || candidate.head_sha !== artifact.workflow_run.head_sha) {
      throw new Error('Canonical checkpoint artifact is not from the trusted main train');
    }
  };
  assertRun(run);
  const bytes = execute('gh', ['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`],
    {maxBuffer: 1024 * 1024 * 1024});
  if (`sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}` !== artifact.digest) {
    throw new Error('Canonical checkpoint artifact digest mismatch');
  }
  const directory = path.join(root, 'checkpoint-recovery');
  fs.mkdirSync(directory, {recursive: false});
  const zip = path.join(directory, 'canonical.zip');
  fs.writeFileSync(zip, bytes, {flag: 'wx'});
  const entries = execute('unzip', ['-Z1', zip], {encoding: 'utf8'}).trim().split('\n');
  if (entries.length !== 2 || new Set(entries).size !== 2 || entries.some(name => !names.includes(name))) {
    throw new Error('Canonical checkpoint artifact inventory mismatch');
  }
  execute('unzip', ['-q', zip, '-d', directory]);
  for (const name of names) {
    if (!fs.lstatSync(path.join(directory, name)).isFile()) throw new Error('Checkpoint asset is not a regular file');
  }
  const sidecar = JSON.parse(fs.readFileSync(path.join(directory, names[1]), 'utf8'));
  const producer = sidecar.producer;
  if (producer?.runId !== String(artifact.workflow_run.id) || !Number.isSafeInteger(producer.runAttempt)
      || producer.runAttempt < 1 || producer.runAttempt > 1000
      || producer.workflow !== '.github/workflows/release-train.yml') throw new Error('Checkpoint artifact producer mismatch');
  const attempt = api(`repos/${repository}/actions/runs/${producer.runId}/attempts/${producer.runAttempt}`);
  assertRun(attempt);
  if (Number(attempt.run_attempt) !== producer.runAttempt) throw new Error('Checkpoint artifact run attempt mismatch');
  const downloaded = path.join(directory, 'existing');
  fs.mkdirSync(downloaded);
  execute('gh', ['release', 'download', tag, '--repo', repository, '--pattern', assets[0].name, '--dir', downloaded]);
  if (!fs.readFileSync(path.join(downloaded, assets[0].name)).equals(fs.readFileSync(path.join(directory, assets[0].name)))) {
    throw new Error('Existing immutable checkpoint asset differs from canonical artifact');
  }
  verifyCheckpoint({version: tag.slice(1), tag, commit}, {
    archiveFile: path.join(directory, archive), sidecarFile: path.join(directory, names[1]),
    extractDir: path.join(root, 'rehydrated'),
  });
  authenticatePayload(path.join(root, 'rehydrated/payload'), tag, state, execute);
  const missing = names.find(name => name !== assets[0].name);
  execute('gh', ['release', 'upload', tag, path.join(directory, missing), '--repo', repository]);
  // No clobber or deletion: concurrent asset creation must fail instead of replacing authority.
  const persisted = path.join(directory, 'persisted');
  fs.mkdirSync(persisted);
  execute('gh', ['release', 'download', tag, '--repo', repository, '--pattern', archive,
    '--pattern', names[1], '--dir', persisted]);
  for (const name of names) {
    if (!fs.readFileSync(path.join(persisted, name)).equals(fs.readFileSync(path.join(directory, name)))) {
      throw new Error('Persisted checkpoint differs from canonical artifact');
    }
  }
}

if (require.main === module) {
  const [tag, commit, stateFile] = process.argv.slice(2);
  resumeCheckpoint(tag, commit, JSON.parse(fs.readFileSync(stateFile, 'utf8')));
}
module.exports = {resumeCheckpoint};
