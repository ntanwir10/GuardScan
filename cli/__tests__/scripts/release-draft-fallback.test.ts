import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';
import crypto from 'crypto';

const repo = path.resolve(__dirname, '../../..');
const workflow = yaml.load(fs.readFileSync(path.join(repo, '.github/workflows/release-publish.yml'), 'utf8')) as any;
const step = workflow.jobs.github.steps.find((item: any) => item.name === 'Reuse existing immutable tag payload');
const {createPointer, formatPointer} = require('../../scripts/release/canonical-payload');

function fixture(options: {artifact?: 'missing' | 'success' | 'tampered' | 'error' | 'auth'; unavailableMessage?: string; producerValid?: boolean; pointerMismatch?: boolean; incompleteAssets?: boolean} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-draft-fallback-'));
  const tag = 'v1.2.3';
  const runId = '123';
  const runAttempt = 1;
  const manifest = {tag, producer: {runId, runAttempt, sourceRef: `refs/tags/${tag}`}, content: 'canonical'};
  const canonical = path.join(root, 'canonical-source');
  const assets = path.join(root, 'draft-assets');
  const artifact = path.join(root, 'canonical-artifact');
  for (const directory of [canonical, assets, artifact, path.join(root, 'payload'), path.join(root, 'runner-temp'),
    path.join(root, 'bin'), path.join(root, 'cli/scripts/release')]) fs.mkdirSync(directory, {recursive: true});
  const writeManifest = (directory: string, value: unknown) => fs.writeFileSync(
    path.join(directory, 'release-manifest.json'), `${JSON.stringify(value)}\n`);
  writeManifest(canonical, manifest);
  writeManifest(assets, options.pointerMismatch ? {...manifest, content: 'substituted'} : manifest);
  writeManifest(artifact, options.artifact === 'tampered' ? {...manifest, content: 'substituted'} : manifest);
  writeManifest(path.join(root, 'payload'), {rebuilt: true});
  for (const directory of [assets, artifact]) {
    const manifestBytes = fs.readFileSync(path.join(directory, 'release-manifest.json'));
    const digest = crypto.createHash('sha256').update(manifestBytes).digest('hex');
    fs.writeFileSync(path.join(directory, 'SHA256SUMS'), `${digest}  release-manifest.json\n`);
    fs.writeFileSync(path.join(directory, 'SHA256SUMS.sigstore.json'), '{}\n');
  }

  const pointer = createPointer(canonical, tag);
  const names = ['release-manifest.json', 'SHA256SUMS', 'SHA256SUMS.sigstore.json'];
  const releaseFile = path.join(root, 'release.json');
  fs.writeFileSync(releaseFile, JSON.stringify({tagName: tag, isDraft: true,
    body: `Release notes\n${formatPointer(pointer)}`,
    assets: (options.incompleteAssets ? names.slice(0, 1) : names).map(name => ({name}))}));
  const producerFile = path.join(root, 'producer.json');
  fs.writeFileSync(producerFile, JSON.stringify({
    path: '.github/workflows/release-train.yml@refs/heads/main', event: 'workflow_dispatch', head_branch: 'main',
    repository: {full_name: 'ntanwir10/GuardScan'},
    head_repository: {full_name: options.producerValid === false ? 'attacker/fork' : 'ntanwir10/GuardScan'},
    id: runId, run_attempt: runAttempt,
  }));

  const gh = path.join(root, 'gh-fixture.cjs');
  fs.writeFileSync(gh, `const fs = require('fs');
const args = process.argv.slice(2), env = process.env;
const command = args.slice(0, 2).join(':');
if (command === 'release:view') process.stdout.write(fs.readFileSync(env.RELEASE_FILE));
else if (args[0] === 'api') process.stdout.write(fs.readFileSync(env.PRODUCER_FILE));
else if (command === 'run:download' || command === 'release:download') {
  const artifact = command === 'run:download';
  fs.appendFileSync(env.DOWNLOAD_LOG, artifact ? 'run-download\\n' : 'release-download\\n');
  const destination = args[args.indexOf('--dir') + 1];
  fs.mkdirSync(destination, {recursive: true});
  if (!artifact || ['success', 'tampered'].includes(env.ARTIFACT_MODE)) {
    fs.cpSync(artifact ? env.ARTIFACT_DIR : env.ASSET_DIR, destination, {recursive: true});
  } else {
    fs.writeFileSync(require('path').join(destination, 'partial.bin'), 'partial bytes');
    process.stderr.write(env.ARTIFACT_MODE === 'auth' ? 'error downloading artifact: token expired (HTTP 403)\\n'
      : env.ARTIFACT_MODE === 'error' ? 'HTTP 500 while downloading artifact\\n' : env.UNAVAILABLE_MESSAGE + '\\n');
    process.exitCode = 1;
  }
} else throw new Error('Unexpected gh invocation: ' + args.join(' '));
`);
  const tools = `gh() { "$FIXTURE_NODE" "$FIXTURE_GH" "$@"; }
node() {
  if [ "$1" = cli/scripts/release/canonical-payload.js ]; then
    shift
    "$FIXTURE_NODE" "$FIXTURE_HELPER" "$@"
  else
    "$FIXTURE_NODE" "$@"
  fi
}
`;
  const downloads = path.join(root, 'downloads.log');
  const normalized = (value: string) => value.replace(/\\/g, '/');
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', tools + step.run], {
    cwd: root, encoding: 'utf8', env: {...process.env,
      FIXTURE_NODE: normalized(process.execPath), FIXTURE_GH: normalized(gh),
      FIXTURE_HELPER: normalized(path.join(repo, 'cli/scripts/release/canonical-payload.js')),
      GITHUB_REPOSITORY: 'ntanwir10/GuardScan', RELEASE_TAG: tag,
      RUNNER_TEMP: normalized(path.join(root, 'runner-temp')), DOWNLOAD_LOG: downloads,
      RELEASE_FILE: releaseFile, PRODUCER_FILE: producerFile,
      ARTIFACT_DIR: artifact, ASSET_DIR: assets,
      ARTIFACT_MODE: options.artifact || 'missing',
      UNAVAILABLE_MESSAGE: options.unavailableMessage || 'no valid artifacts found to download',
    },
  });
  const downloadCalls = fs.existsSync(downloads) ? fs.readFileSync(downloads, 'utf8').trim().split('\n').filter(Boolean) : [];
  return {root, result, downloadCalls, tag};
}

describe('release draft asset fallback', () => {
  it.each(['no valid artifacts found to download', 'no artifact matches any of the names or patterns provided'])(
    'recovers complete draft assets for the real GitHub CLI absence message: %s', unavailableMessage => {
    const run = fixture({artifact: 'missing', unavailableMessage});
    try {
      expect(run.result.status).toBe(0);
      expect(run.downloadCalls).toEqual(['run-download', 'release-download']);
      expect(JSON.parse(fs.readFileSync(path.join(run.root, 'payload/release-manifest.json'), 'utf8')).content).toBe('canonical');
      expect(fs.existsSync(path.join(run.root, 'payload/partial.bin'))).toBe(false);
      expect(fs.existsSync(path.join(run.root, 'canonical-artifact-download/partial.bin'))).toBe(true);
      expect(fs.existsSync(path.join(run.root, 'rebuilt-payload'))).toBe(true);
      require('../../scripts/release/checksum-inventory').verifyChecksumInventory(path.join(run.root, 'payload'));
    } finally { fs.rmSync(run.root, {recursive: true, force: true}); }
  });

  it('fails closed on incomplete or pointer-mismatching draft assets', () => {
    for (const options of [{incompleteAssets: true}, {pointerMismatch: true}]) {
      const run = fixture({artifact: 'missing', ...options});
      try {
        expect(run.result.status).not.toBe(0);
        expect(run.downloadCalls).toContain('run-download');
        if (options.incompleteAssets) expect(run.downloadCalls).not.toContain('release-download');
        else expect(run.downloadCalls).toContain('release-download');
        expect(fs.existsSync(path.join(run.root, 'rebuilt-payload'))).toBe(false);
      } finally { fs.rmSync(run.root, {recursive: true, force: true}); }
    }
  });

  it('authenticates the pointer producer before either download path', () => {
    const run = fixture({artifact: 'missing', producerValid: false});
    try {
      expect(run.result.status).not.toBe(0);
      expect(run.downloadCalls).toEqual([]);
    } finally { fs.rmSync(run.root, {recursive: true, force: true}); }
  });

  it('does not fall back after artifact verification fails or when download fails for another reason', () => {
    for (const artifact of ['tampered', 'error', 'auth'] as const) {
      const run = fixture({artifact});
      try {
        expect(run.result.status).not.toBe(0);
        expect(run.downloadCalls).toEqual(['run-download']);
        expect(fs.existsSync(path.join(run.root, 'rebuilt-payload'))).toBe(false);
      } finally { fs.rmSync(run.root, {recursive: true, force: true}); }
    }
  });

  it('keeps the canonical artifact path unchanged when its download and pointer verification succeed', () => {
    const run = fixture({artifact: 'success'});
    try {
      expect(run.result.status).toBe(0);
      expect(run.downloadCalls).toEqual(['run-download']);
      expect(JSON.parse(fs.readFileSync(path.join(run.root, 'payload/release-manifest.json'), 'utf8')).content).toBe('canonical');
      expect(fs.existsSync(path.join(run.root, 'rebuilt-payload'))).toBe(true);
    } finally { fs.rmSync(run.root, {recursive: true, force: true}); }
  });
});
