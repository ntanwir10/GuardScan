'use strict';

const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {verifyChecksumInventory} = require('./checksum-inventory');
const {readJson} = require('./lib');
const {parsePointer, verifyCanonical} = require('./canonical-payload');

// Checkpoints transport bytes; only the original authenticated producer authorizes reuse.
function authenticatePayload(directory, tag, releaseState, execute = execFileSync) {
  const repository = process.env.GITHUB_REPOSITORY;
  if (repository !== 'ntanwir10/GuardScan' || !/^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(tag || '')) {
    throw new Error('Invalid release authority or tag');
  }
  const manifest = readJson(path.join(directory, 'release-manifest.json'));
  const producer = manifest.producer;
  if (!producer || !/^[1-9][0-9]{0,19}$/.test(producer.runId || '')
      || typeof producer.runId !== 'string' || !Number.isSafeInteger(producer.runAttempt)
      || producer.runAttempt < 1 || producer.runAttempt > 1000) throw new Error('Invalid payload producer');
  const api = endpoint => JSON.parse(execute('gh', ['api', endpoint], {encoding: 'utf8'}));
  const run = api(`repos/${repository}/actions/runs/${producer.runId}/attempts/${producer.runAttempt}`);
  if (String(run.path || '').split('@')[0] !== '.github/workflows/release-train.yml'
      || run.event !== 'workflow_dispatch' || run.head_branch !== 'main'
      || run.repository?.full_name?.toLowerCase() !== repository.toLowerCase()
      || run.head_repository?.full_name?.toLowerCase() !== repository.toLowerCase()
      || String(run.id) !== producer.runId || Number(run.run_attempt) !== producer.runAttempt
      || !/^[a-f0-9]{40}$/.test(run.head_sha || '')) throw new Error('Payload producer is not the trusted main train');
  execute('cosign', ['verify-blob', '--bundle', path.join(directory, 'SHA256SUMS.sigstore.json'),
    '--certificate-identity', `https://github.com/${repository}/.github/workflows/release-build.yml@refs/heads/main`,
    '--certificate-github-workflow-ref', 'refs/heads/main',
    '--certificate-github-workflow-sha', run.head_sha,
    '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com', path.join(directory, 'SHA256SUMS')],
  {stdio: 'pipe'});
  verifyChecksumInventory(directory);
  verifyChecksumInventory(directory, fs.readdirSync(directory)
    .filter(name => !['SHA256SUMS', 'SHA256SUMS.sigstore.json'].includes(name)));
  const commit = api(`repos/${repository}/commits/${tag}`).sha;
  if (!/^[a-f0-9]{40}$/.test(commit || '') || manifest.schemaVersion !== 'guardscan.release-manifest.v1'
      || manifest.version !== tag.slice(1) || manifest.tag !== tag || manifest.commit !== commit
      || producer.provider !== 'github-actions' || producer.repository?.toLowerCase() !== repository.toLowerCase()
      || producer.workflow !== '.github/workflows/release-build.yml' || producer.workflowSha !== run.head_sha
      || producer.sourceRef !== `refs/tags/${tag}`) {
    throw new Error('Signed payload does not match the immutable release tag');
  }
  const provenance = readJson(path.join(directory, 'release-build-provenance.json'));
  if (provenance.schemaVersion !== 'guardscan.release-build-provenance.v1'
      || provenance.workflow !== producer.workflow || provenance.ref !== 'refs/heads/main'
      || provenance.sha !== producer.workflowSha) throw new Error('Signed build provenance is inconsistent');
  if (releaseState) {
    if (releaseState.tag_name !== tag && releaseState.tagName !== tag) throw new Error('Canonical release tag mismatch');
    const pointer = parsePointer(releaseState.body, tag);
    if (!pointer) throw new Error('Recovered payload has no immutable canonical pointer');
    verifyCanonical(directory, pointer);
  }
  return run.head_sha;
}

if (require.main === module) {
  const [directory, tag, stateFile] = process.argv.slice(2);
  authenticatePayload(directory, tag, stateFile && JSON.parse(fs.readFileSync(stateFile, 'utf8')));
}
module.exports = {authenticatePayload};
