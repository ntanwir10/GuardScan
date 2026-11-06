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
    "if(args[0]==='run'){const result=spawnSync(process.execPath,[process.env.TRUSTED_RELEASE_CLI,'npm-preflight',...args.slice(args.indexOf('--')+1)],{stdio:'inherit'});process.exit(result.status ?? 1);}",
    "if(args[0]!=='view')throw new Error('unexpected npm command');",
    "console.log(JSON.stringify(args.includes('dist-tags')?{next:process.env.FIXTURE_VERSION}:process.env.FIXTURE_INTEGRITY));",
  ].join('\n'), {mode: 0o755});
  const shim = path.join(root, 'fixture-commands.cjs');
  fs.writeFileSync(shim, `const cp=require('child_process');const original=cp.spawnSync;
cp.spawnSync=function(command,args,options){
  if(command==='npm'||command==='npm.cmd')return original.call(this,process.execPath,[${JSON.stringify(path.join(root, 'tools/npm'))},...args],options);
  return original.call(this,command,args,options);
};`);
  const env = {
    ...process.env, NODE_OPTIONS: `--require "${shim.replace(/\\/g, '/')}"`, PATH: path.join(root, 'tools') + path.delimiter + process.env.PATH,
    TRUSTED_RELEASE_CLI: trustedCli, FIXTURE_VERSION: version, FIXTURE_INTEGRITY: integrity,
    GITHUB_WORKSPACE: root, RUNNER_TEMP: path.join(root, 'tmp'), GITHUB_OUTPUT: path.join(root, 'output'),
    RELEASE_INPUT_TAG: options.tag || tag, RELEASE_INPUT_REF: commit, RELEASE_INPUT_CHANNEL: 'rc', RELEASE_CHANNEL: 'rc',
  };
  const probe = spawnSync(process.execPath, ['-e', `
    const assert=require('assert/strict');const {spawnSync}=require('child_process');
    for(const command of ['npm','npm.cmd']) {
      const result=spawnSync(command,['view','guardscan','dist.integrity'],{encoding:'utf8'});
      assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout),process.env.FIXTURE_INTEGRITY);
    }
  `], {encoding: 'utf8', env});
  expect(probe.stderr).toBe('');
  expect(probe.status).toBe(0);
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {cwd: path.join(root, 'cli'), encoding: 'utf8', env});
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

describe('candidate npm restoration through trusted schemas', () => {
  const restore = path.join(repository, 'cli/scripts/release/restore-npm-payload.js');
  const check = (options: {tag?: string; commit?: string; drift?: boolean; invalidManifest?: boolean} = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-npm-restore-'));
    const product = path.join(root, 'source/cli');
    const payload = path.join(root, 'payload');
    const output = path.join(root, 'canonical-npm');
    fs.mkdirSync(path.join(product, 'schemas'), {recursive: true});
    fs.mkdirSync(payload);
    const packageJson = {name: 'guardscan', version, engines: {node: '>=22.0.0'}};
    fs.writeFileSync(path.join(product, 'package.json'), JSON.stringify(packageJson));
    fs.writeFileSync(path.join(product, 'package-lock.json'), JSON.stringify({...packageJson, packages: {'': packageJson}}));
    fs.writeFileSync(path.join(product, 'CHANGELOG.md'), `# Changelog\n\n## [${version}]\n`);
    fs.writeFileSync(path.join(product, 'schemas/guardscan.release-manifest.v1.schema.json'), '{}');
    const bytes = Buffer.from('authenticated canonical RC tarball');
    const filename = `guardscan-${version}.tgz`;
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const manifest: any = {schemaVersion: 'guardscan.release-manifest.v1', version, tag, commit,
      createdAt: '2026-01-01T00:00:00.000Z', producer: {provider: 'github-actions', repository: 'ntanwir10/GuardScan',
        workflow: '.github/workflows/release-build.yml', workflowSha: 'b'.repeat(40), runId: '42', runAttempt: 1, sourceRef: `refs/tags/${tag}`},
      toolchain: {node: '22.12.0', packageManager: {name: 'npm', version: '10.9.0'}, tools: [{name: 'esbuild', version: '0.28.1'}]},
      artifacts: [{id: 'npm:guardscan', kind: 'npm-tarball', filename, size: bytes.length, sha256, source: {version, tag, commit},
        capabilities: {coreScan: true, sbom: true, chartRendering: true, accurateTokenCounting: true},
        url: `https://registry.npmjs.org/guardscan/-/${filename}`, integrity: 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64'),
        provenance: {type: 'slsa', url: `https://github.com/ntanwir10/GuardScan/releases/download/${tag}/npm.provenance.sigstore.json`, verified: true,
          sha256: 'c'.repeat(64), subjectSha256: sha256, sourceVersion: version, sourceTag: tag, sourceCommit: commit,
          signerIdentity: 'https://github.com/ntanwir10/GuardScan/.github/workflows/release-build.yml', signerDigest: 'b'.repeat(40), predicateType: 'https://slsa.dev/provenance/v1'}}]};
    if (options.invalidManifest) delete manifest.producer;
    fs.writeFileSync(path.join(payload, 'release-manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(payload, filename), options.drift ? Buffer.from('substituted bytes') : bytes);
    const result = spawnSync(process.execPath, [restore, payload, output, options.tag || tag, product, path.join(root, 'source'),
      path.join(repository, 'cli'), options.commit || commit], {encoding: 'utf8'});
    const restored = fs.existsSync(path.join(output, filename)) ? fs.readFileSync(path.join(output, filename)) : undefined;
    const metadata = fs.existsSync(path.join(output, 'npm-artifact.json')) ? JSON.parse(fs.readFileSync(path.join(output, 'npm-artifact.json'), 'utf8')) : undefined;
    fs.rmSync(root, {recursive: true, force: true});
    return {result, restored, metadata, bytes};
  };
  it('restores the RC from candidate roots through the trusted CLI and schemas', () => {
    const {result, restored, metadata, bytes} = check();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(restored).toEqual(bytes);
    expect(metadata).toMatchObject({version, tag, commit});
    const invocation = publication.jobs.github.steps.find((step: any) => step.name === 'Restore npm artifact from authenticated canonical payload').run;
    expect(invocation).toContain('"$GITHUB_WORKSPACE/source/cli" "$GITHUB_WORKSPACE/source" "$GITHUB_WORKSPACE/cli" "$RELEASE_INPUT_REF"');
  });
  it.each([{tag: 'v1.2.4-rc.0'}, {commit: 'd'.repeat(40)}, {drift: true}, {invalidManifest: true}])('rejects source, bytes, or untrusted-schema substitution: %j', options => {
    expect(check(options).result.status).not.toBe(0);
  });
});
