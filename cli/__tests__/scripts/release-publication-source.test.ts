import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

const repository = path.resolve(__dirname, '../../..');
const trustedCli = path.join(repository, 'cli/scripts/release/index.js');
const load = (name: string): any => yaml.load(fs.readFileSync(path.join(repository, '.github/workflows', name), 'utf8'));
const publication = load('release-publish.yml');
const preflights = [
  publication.jobs.github.steps.find((step: any) => step.name === 'Check shared mutable tag state before publication'),
  publication.jobs.npm.steps.find((step: any) => step.name === 'Verify and classify registry state'),
  publication.jobs.npm.steps.find((step: any) => step.name === 'Verify public registry integrity'),
];
const version = '1.2.3-rc.0';
const tag = `v${version}`;
const commit = 'a'.repeat(40);

function preflightFixture(script: string, options: {tag?: string; drift?: boolean} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-candidate-preflight-'));
  for (const directory of ['cli', 'source/cli', 'tools', 'npm-artifact', 'canonical-npm', 'tmp']) fs.mkdirSync(path.join(root, directory), {recursive: true});
  for (const [directory, packageVersion] of [['cli', '1.1.0'], ['source/cli', version]]) {
    const metadata = {name: 'guardscan', version: packageVersion, engines: {node: '>=22.0.0'}};
    fs.writeFileSync(path.join(root, directory, 'package.json'), JSON.stringify(metadata));
    fs.writeFileSync(path.join(root, directory, 'package-lock.json'), JSON.stringify({...metadata, packages: {'': metadata}}));
    fs.writeFileSync(path.join(root, directory, 'CHANGELOG.md'), `# Changelog\n\n## [${packageVersion}]\n`);
  }
  const bytes = Buffer.from('immutable canonical npm tarball fixture');
  const filename = `guardscan-${version}.tgz`;
  const integrity = 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');
  const artifact = {schemaVersion: 'guardscan.npm-artifact.v1', packageName: 'guardscan', version, tag, commit,
    createdAt: '2026-01-01T00:00:00.000Z', filename, size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), integrity};
  for (const directory of ['npm-artifact', 'canonical-npm']) {
    fs.writeFileSync(path.join(root, directory, filename), options.drift ? Buffer.from('substituted bytes') : bytes);
    fs.writeFileSync(path.join(root, directory, 'npm-artifact.json'), JSON.stringify(artifact));
  }
  fs.writeFileSync(path.join(root, 'tools/npm'), '#!' + process.execPath + '\n' + [
    "const {spawnSync}=require('child_process'); const args=process.argv.slice(2);",
    "if(args[0]==='run'){const result=spawnSync(process.execPath,[process.env.TRUSTED_RELEASE_CLI,'npm-preflight',...args.slice(args.indexOf('--')+1)],{stdio:'inherit'});process.exit(result.status || 0);}",
    "if(args[0]!=='view')throw new Error('unexpected npm command');",
    "console.log(JSON.stringify(args.includes('dist-tags')?{next:process.env.FIXTURE_VERSION}:process.env.FIXTURE_INTEGRITY));",
  ].join('\n'), {mode: 0o755});
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {cwd: path.join(root, 'cli'), encoding: 'utf8', env: {
    ...process.env, PATH: path.join(root, 'tools') + path.delimiter + process.env.PATH,
    TRUSTED_RELEASE_CLI: trustedCli, FIXTURE_VERSION: version, FIXTURE_INTEGRITY: integrity,
    GITHUB_WORKSPACE: root, RUNNER_TEMP: path.join(root, 'tmp'), GITHUB_OUTPUT: path.join(root, 'output'),
    RELEASE_INPUT_TAG: options.tag || tag, RELEASE_INPUT_REF: commit, RELEASE_INPUT_CHANNEL: 'rc', RELEASE_CHANNEL: 'rc',
  }});
  const after = fs.readFileSync(path.join(root, 'npm-artifact', filename));
  fs.rmSync(root, {recursive: true, force: true});
  return {result, after, bytes};
}

describe('publication source identity', () => {
  it.each(preflights)('preflights the candidate RC through trusted tooling: $name', step => {
    const {result, after, bytes} = preflightFixture(step.run);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(after).toEqual(bytes);
    expect(step.run).toContain('--package-root "$GITHUB_WORKSPACE/source/cli"');
    expect(step.run).toContain('--repository-root "$GITHUB_WORKSPACE/source"');
    expect(step.run).toContain('--schema-root "$GITHUB_WORKSPACE/cli"');
  });
  it('checks out candidate data separately before the GitHub shared-tag preflight', () => {
    const job = publication.jobs.github;
    const checkout = job.steps.findIndex((step: any) => step.uses?.startsWith('actions/checkout@') && step.with?.path === 'source');
    expect(checkout).toBeGreaterThan(0);
    expect(checkout).toBeLessThan(job.steps.indexOf(preflights[0]));
    expect(job.steps[checkout].with.ref).toBe('${{ inputs.ref }}');
    expect(job.steps[checkout].with['persist-credentials']).toBe(false);
  });
  it.each(preflights)('keeps exact tag and immutable tarball validation: $name', step => {
    expect(preflightFixture(step.run, {tag: 'v1.2.4-rc.0'}).result.status).not.toBe(0);
    expect(preflightFixture(step.run, {drift: true}).result.status).not.toBe(0);
  });
});

describe('reconciliation promotion dispatch authority', () => {
  const reconcile = load('release-train.yml').jobs.reconcile;
  const app = reconcile.steps.find((step: any) => step.id === 'app');
  const dispatch = reconcile.steps.find((step: any) => step.name === 'Trigger promotion when the machine policy is eligible');
  it('scopes the exact App token used by dispatch with Actions write authority', () => {
    expect(app.with['permission-actions']).toBe('write');
    expect(dispatch.env.GH_TOKEN).toBe('${{ steps.app.outputs.token }}');
    expect(dispatch.if).toContain("vars.RELEASE_AUTOMATION_ENABLED == 'true'");
    expect(dispatch.if).toContain("contains(inputs.version, '-rc.')");
  });
  it.each(['true', 'false'])('dispatches only when the machine policy says eligible=%s', eligible => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-promotion-dispatch-'));
    const receipt = path.join(root, 'dispatch.json');
    const head = 'b'.repeat(40);
    fs.writeFileSync(path.join(root, 'gh'), '#!' + process.execPath + '\n' + [
      "const fs=require('fs');const args=process.argv.slice(2);",
      "if(args[0]==='pr')console.log(process.env.FIXTURE_HEAD);",
      "else if(args[0]==='workflow'&&args[1]==='run')fs.writeFileSync(process.env.DISPATCH_RECEIPT,JSON.stringify({args,token:process.env.GH_TOKEN}));",
      "else throw new Error('unexpected gh command');",
    ].join('\n'), {mode: 0o755});
    try {
      const shell = dispatch.run.slice(dispatch.run.indexOf('if [ "$ELIGIBLE" = true ]; then'));
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', shell], {cwd: root, encoding: 'utf8', env: {
        ...process.env, PATH: root + path.delimiter + process.env.PATH, GH_TOKEN: 'fixture-authorized-app-token',
        ELIGIBLE: eligible, RELEASE_PR: '42', RELEASE_VERSION: version, GITHUB_REPOSITORY: 'ntanwir10/GuardScan',
        FIXTURE_HEAD: head, DISPATCH_RECEIPT: receipt,
      }});
      expect(result.status).toBe(0);
      expect(fs.existsSync(receipt)).toBe(eligible === 'true');
      if (eligible === 'true') {
        const observed = JSON.parse(fs.readFileSync(receipt, 'utf8'));
        expect(observed.token).toBe('fixture-authorized-app-token');
        expect(observed.args).toEqual(['workflow', 'run', 'release-train.yml', '--repo', 'ntanwir10/GuardScan',
          '-f', 'action=promote', '-f', `version=${version}`, '-f', 'release_pr=42', '-f', `expected_head=${head}`]);
      }
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });
});
