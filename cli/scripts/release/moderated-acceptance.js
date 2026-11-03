'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const {appendEvent, materializeReleaseState, monotonicLedgerTimestamp, readEvents} = require('./events');
const {readBounded, validateDocument, assertDocumentMatchesSource} = require('./lib');
const {renderAdapters, writeRenderedOutput} = require('./renderers');
const {buildArchive} = require('./archive');
const {findPublicSubmission, githubApi} = require('./winget-submission');

function acceptModeratedChannel(ledger, channel, report, execute = execFileSync) {
  const state = materializeReleaseState(readEvents(ledger));
  if (!['winget', 'chocolatey'].includes(channel) || !report.passed || !report.complete
      || !['submitted', 'resubmitted'].includes(state.channels[channel]?.status)) return false;
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(state.version)
      || state.tag !== `v${state.version}`) throw new Error('moderated acceptance requires an exact stable train');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-moderated-acceptance-'));
  const options = {encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    windowsHide: true, env: {...process.env, GH_TOKEN: process.env.RELEASE_APP_TOKEN}};
  try {
    execute('gh', ['release', 'download', state.tag, '--repo', 'ntanwir10/GuardScan',
      '--pattern', 'release-manifest.json', '--dir', root], options);
    const file = path.join(root, 'release-manifest.json');
    const digest = crypto.createHash('sha256').update(readBounded(file, 'release manifest')).digest('hex');
    if (digest !== state.manifestSha256) throw new Error('release manifest does not match the protected ledger digest');
    const manifest = validateDocument('manifest', file, path.resolve(__dirname, '../..'));
    assertDocumentMatchesSource('manifest', manifest, state);
    const artifacts = manifest.artifacts.filter(artifact => artifact.kind === 'standalone'
      && artifact.platform.os === 'windows');
    for (const artifact of artifacts) assertDocumentMatchesSource('moderated artifact', artifact.source, state);
    const artifactIds = artifacts.map(artifact => artifact.id).sort();
    if (!artifactIds.length || JSON.stringify(artifactIds) !== JSON.stringify(state.channels[channel].artifactIds)) {
      throw new Error('moderated artifacts do not match the protected submission');
    }
    const rendered = renderAdapters(manifest, channel);
    const output = path.join(root, 'rendered');
    writeRenderedOutput(manifest, rendered, output);
    const submission = {schemaVersion: 'guardscan.moderated-submission.v1', channel,
      version: state.version, tag: state.tag, state: 'public-exact'};
    if (channel === 'winget') {
      const installer = Object.keys(rendered.files).find(name => name.endsWith('.installer.yaml'));
      const proof = findPublicSubmission(path.dirname(path.join(output, installer)), state.tag,
        {api: endpoint => githubApi(endpoint, (command, args, apiOptions) => execute(command, args,
          {...apiOptions, env: options.env}))});
      if (proof.submitRequired) return false;
      const {headCommit, files, remoteDigest} = proof.publication;
      const catalogPath = `manifests/n/NaumanTanwir/GuardScan/${state.version}`;
      Object.assign(submission, {packageIdentity: `NaumanTanwir.GuardScan@${state.version}`, files,
        remoteDigest, remoteIdentity: `github:microsoft/winget-pkgs@${headCommit}#${catalogPath}`,
        provider: {repository: 'microsoft/winget-pkgs', commit: headCommit, path: catalogPath,
          pullRequest: null, publicBytesVerified: true, pendingStateQuery: 'fresh exact public catalog blobs'}});
    } else {
      const filename = `guardscan.${state.version}.nupkg`;
      const archive = buildArchive('zip', Object.entries(rendered.files).map(([name, data]) => ({
        name: name.slice('chocolatey/'.length), data,
      })), manifest.createdAt);
      const packageFile = path.join(root, filename);
      fs.writeFileSync(packageFile, archive, {mode: 0o600});
      const proof = JSON.parse(execute('python3', [path.join(__dirname, 'chocolatey-preflight.py'),
        '--package', packageFile, '--version', state.version], options));
      if (proof.publishRequired === true) return false;
      if (proof.publishRequired !== false) throw new Error('Chocolatey public verification is incomplete');
      const url = `https://community.chocolatey.org/api/v2/package/guardscan/${state.version}`;
      Object.assign(submission, {packageIdentity: `guardscan@${state.version}`, packageFilename: filename,
        remoteDigest: proof.payloadDigest, remoteIdentity: url,
        provider: {url, publicBytesVerified: true, pendingStateQuery: 'fresh exact public package payload'}});
    }
    const identityKey = crypto.createHash('sha256').update(submission.remoteIdentity).digest('hex');
    const idempotencyKey = `channel_accepted:${channel}:${state.tag}:${submission.remoteDigest}:${identityKey}`;
    return appendEvent(ledger, {version: state.version, tag: state.tag, commit: state.commit,
      timestamp: monotonicLedgerTimestamp(readEvents(ledger), new Date().toISOString(), idempotencyKey),
      type: 'channel_accepted', channel, idempotencyKey,
      payload: {artifactIds, remoteIdentity: submission.remoteIdentity,
        remoteDigest: submission.remoteDigest, submission}}).changed;
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

module.exports = {acceptModeratedChannel};
