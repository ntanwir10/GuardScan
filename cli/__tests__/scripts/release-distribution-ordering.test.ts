import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import vm from 'vm';
import yaml from 'js-yaml';

const workflow: any = yaml.load(fs.readFileSync(path.resolve(__dirname,
  '../../../.github/workflows/release-train.yml'), 'utf8'));
const version = '1.2.3-rc.1';
const tag = `v${version}`;
const commit = 'a'.repeat(40);
const future = '2099-01-01T00:00:00.000Z';
const checkedAt = '2026-01-01T00:00:00.000Z';
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const script = (name: string) => {
  const step = Object.values(workflow.jobs).flatMap((job: any) => job.steps || [])
    .find((step: any) => step.name === name) as any;
  if (!step) throw new Error(`Missing workflow step ${name}`);
  return step.run.match(/node - <<'NODE'\n([\s\S]*?)\nNODE/)[1];
};

function harness(initial: any[] = [{timestamp: future, commit, idempotencyKey: 'later-writer'}]) {
  const events = [...initial];
  const attempts: any[] = [];
  const realEvents = require('../../scripts/release/events');
  const eventApi = {
    readEvents: () => [...events],
    monotonicLedgerTimestamp: realEvents.monotonicLedgerTimestamp,
    materializeReleaseState: () => ({channels: {homebrew: {status: 'submitted'}, scoop: {status: 'submitted'}}}),
    appendEvent: (_file: string, input: any) => {
      attempts.push(input);
      const existing = events.find(event => event.idempotencyKey === input.idempotencyKey);
      if (existing) {
        if (existing.timestamp !== input.timestamp) throw new Error('Retry changed its timestamp');
        return {changed: false};
      }
      if (input.timestamp < events.at(-1)?.timestamp) throw new Error('Release timestamp moved backward');
      events.push(input);
      return {changed: true};
    },
  };
  return {events, attempts, eventApi};
}

function publication(retry = false) {
  const manifest = {version, tag, commit, artifacts: [
    {id: 'npm', kind: 'npm-tarball', filename: 'guardscan.tgz', sha256: 'b'.repeat(64)},
    {id: 'wheel', kind: 'python-wheel', filename: 'guardscan.whl', sha256: 'c'.repeat(64)},
    {id: 'darwin', kind: 'standalone', platform: {os: 'darwin'}},
    {id: 'windows', kind: 'standalone', platform: {os: 'windows'}},
  ]};
  const manifestBytes = JSON.stringify(manifest);
  const manifestSha = digest(manifestBytes);
  const lock = {source: {version, tag, commit, manifestSha256: manifestSha},
    generator: {repository: 'ntanwir10/GuardScan', commit},
    files: {'Formula/guardscan.rb': {sha256: 'd'.repeat(64)}, 'bucket/guardscan.json': {sha256: 'e'.repeat(64)}}};
  const lockBytes = JSON.stringify(lock);
  const catalog = {schemaVersion: 'guardscan.catalog-publication.v1', repository: 'ntanwir10/homebrew-tap',
    branch: `channel-preview/${tag}`, pullRequest: 1, state: 'OPEN', commit, headCommit: commit,
    mergeCommit: null, lockSha256: digest(lockBytes)};
  const documents: Record<string, string> = {
    'payload/release-manifest.json': manifestBytes,
    'catalog-evidence/catalog-result.json': JSON.stringify(catalog),
    'catalog-evidence/catalog-output/channel-lock.json': lockBytes,
  };
  const providerFiles: Record<string, any> = {github: {'release-manifest.json': manifestSha},
    npm: {'guardscan.tgz': 'b'.repeat(64)}, pypi: {'guardscan.whl': 'c'.repeat(64)}};
  const identities: Record<string, string> = {
    github: `github:ntanwir10/GuardScan/releases/tag/${tag}`,
    npm: `npm:guardscan@${version}`, pypi: `pypi:guardscan-cli@${version.replace('-rc.', 'rc')}`,
  };
  for (const channel of ['github', 'npm', 'pypi']) {
    documents[`provider-evidence/${channel}/${channel}-publication-evidence.json`] = JSON.stringify({
      channel, version, tag, checkedAt, files: providerFiles[channel], remoteIdentity: identities[channel],
      aggregateSha256: 'f'.repeat(64),
    });
  }
  const initial = retry ? [
    {commit, timestamp: checkedAt, idempotencyKey: `manifest:${manifestSha}`},
    {commit, timestamp: future, idempotencyKey: 'later-writer'},
  ] : undefined;
  const h = harness(initial);
  vm.runInNewContext(script('Fetch ledger, append chained events, and push'), {
    process: {env: {RELEASE_TAG: tag, RELEASE_CHANNEL: 'rc', GITHUB_REPOSITORY: 'ntanwir10/GuardScan'}, cwd: () => '/fixture'},
    require: (name: string) => {
      if (name === 'fs') return {readFileSync: (file: string, encoding?: string) => {
        if (!(file in documents)) throw new Error(`Unexpected fixture file ${file}`);
        return encoding ? documents[file] : Buffer.from(documents[file]);
      }, readdirSync: () => ['release-manifest.json']};
      if (name === 'child_process') return {execFileSync: () => commit};
      if (name.endsWith('/events')) return h.eventApi;
      if (name.endsWith('/lib')) return {validateDocument: (kind: string) => kind === 'manifest' ? manifest : lock,
        assertDocumentMatchesSource: () => undefined, releaseTrainChannels: () => ['github']};
      if (name.endsWith('/publication-evidence')) return {createPublicationEvidence: (value: any) => value};
      return require(name);
    },
  });
  return h;
}

describe('distribution workflow ledger ordering', () => {
  it.each([false, true])('publication preserves monotonic append order and provider check time (retry=%s)', retry => {
    const h = publication(retry);
    const published = h.attempts.filter(event => event.type === 'channel_published');
    expect(published).toHaveLength(3);
    expect(published.map(event => event.timestamp)).toEqual([future, future, future]);
    expect(published.map(event => event.payload.publication.checkedAt)).toEqual([checkedAt, checkedAt, checkedAt]);
    if (retry) expect(h.attempts.find(event => event.type === 'manifest_created').timestamp).toBe(checkedAt);
  });

  it('catalog reconciliation clamps newly observed publication events to the latest protected ledger time', () => {
    const h = harness();
    const evidence = {repository: 'ntanwir10/homebrew-tap', commit, pullRequest: 1,
      lockSha256: 'f'.repeat(64), manifestSha256: 'b'.repeat(64),
      files: {'Formula/guardscan.rb': {sha256: 'd'.repeat(64)}, 'bucket/guardscan.json': {sha256: 'e'.repeat(64)}}};
    vm.runInNewContext(script('Persist refetched catalog publication evidence'), {
      process: {env: {RELEASE_VERSION: version}},
      require: (name: string) => {
        if (name === 'fs') return {};
        if (name.endsWith('/events')) return h.eventApi;
        if (name === './catalog-verification/evidence.json') return evidence;
        if (name.endsWith('/distribution-guards')) return require('../../scripts/release/distribution-guards');
        return require(name);
      },
    });
    expect(h.attempts.map(event => event.channel)).toEqual(['homebrew', 'scoop']);
    expect(h.attempts.map(event => event.timestamp)).toEqual([future, future]);
  });

  it('rollback completion and failed-channel supersession preserve ledger order on retries', () => {
    const h = harness();
    const eventsApi = {...h.eventApi, materializeReleaseState: () => ({
      version: '1.2.3', tag: 'v1.2.3', commit,
      channels: {homebrew: {status: 'failed', artifactIds: ['archive:darwin-arm64']}},
    })};
    const run = () => vm.runInNewContext(script('Complete repository recovery and deactivate the defective train'), {
      process: {env: {
        DEFECTIVE_VERSION: '1.2.3', KNOWN_GOOD_VERSION: '1.2.2',
        FORWARD_FIX_VERSION: '1.2.4', FORWARD_FIX_BRANCH: 'release/1.2.4',
        FORWARD_FIX_PR: '42', FORWARD_FIX_COMMIT: commit,
        CATALOG_BRANCH: 'rollback/1.2.3', CATALOG_PR: '43', CATALOG_COMMIT: commit,
      }},
      require: (name: string) => {
        if (name === 'fs') return {writeFileSync: () => undefined};
        if (name.endsWith('/events')) return eventsApi;
        return require(name);
      },
    });
    run();
    expect(h.events.slice(1).map(event => event.type)).toEqual(['rollback_repository_completed', 'superseded']);
    expect(h.events.slice(1).map(event => event.timestamp)).toEqual([future, future]);
    run();
    expect(h.events).toHaveLength(3);
  });
});
