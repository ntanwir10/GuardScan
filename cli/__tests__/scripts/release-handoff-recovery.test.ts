import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

const repo = path.resolve(__dirname, '../../..');
const workflow = (name: string): any => yaml.load(fs.readFileSync(path.join(repo, '.github/workflows', name), 'utf8'));
const build = workflow('release-build.yml');
const train = workflow('release-train.yml');
const publish = workflow('release-publish.yml');
const step = (job: any, name: string): any => {
  const result = job.steps.find((candidate: any) => candidate.name === name);
  if (!result) throw new Error(`missing step ${name}`);
  return result;
};
const temporary = (check: (root: string) => void) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-handoff-'));
  try { check(root); } finally { fs.rmSync(root, {recursive: true, force: true}); }
};
const shell = (script: string, root: string, env: Record<string, string> = {}) => spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
  cwd: root, encoding: 'utf8', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1', ...env},
});

describe('release handoff recovery regressions', () => {
  it('retains the classified snapshot across both checkout cleanups without refetching it', () => temporary(root => {
    const job = train.jobs['resolve-checkpoint'];
    const classify = step(job, 'Classify remote checkpoint state');
    const restore = step(job, 'Restore the classified release snapshot after checkouts');
    const checkoutIndices = job.steps.map((candidate: any, index: number) => candidate.uses?.startsWith('actions/checkout@') ? index : -1).filter((index: number) => index >= 0);
    expect(job.steps.indexOf(restore)).toBeGreaterThan(Math.max(...checkoutIndices));
    expect(restore.run).not.toContain('gh api');
    const temp = path.join(root, 'runner-temp');
    fs.mkdirSync(temp);
    const original = JSON.stringify({draft: true, tag_name: 'v1.2.3', assets: [{name: 'guardscan-release-checkpoint-1.2.3.tar.gz'}]});
    const result = shell('gh() { printf "%s" "$RELEASE_FIXTURE"; };\n' + classify.run, root, {
      RUNNER_TEMP: temp, RELEASE_FIXTURE: JSON.stringify([JSON.parse(original)]), RELEASE_TAG: 'v1.2.3', GITHUB_REPOSITORY: 'ntanwir10/GuardScan', GITHUB_OUTPUT: path.join(temp, 'output'),
    });
    expect(result.status).toBe(0);
    fs.rmSync(path.join(root, 'release-state.json'));
    expect(shell(restore.run, root, {RUNNER_TEMP: temp}).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'release-state.json'), 'utf8'))).toEqual(JSON.parse(original));
  }));

  it('finds drafts on later REST pages and fails closed on lookup errors', () => temporary(root => {
    const classify = step(train.jobs['resolve-checkpoint'], 'Classify remote checkpoint state');
    const temp = path.join(root, 'runner-temp');
    fs.mkdirSync(temp);
    const output = path.join(temp, 'output');
    const release = {draft: true, tag_name: 'v1.2.3', assets: [
      {name: 'guardscan-release-checkpoint-1.2.3.tar.gz'},
      {name: 'guardscan-release-checkpoint-1.2.3.tar.gz.metadata.json'},
    ]};
    const env = {RUNNER_TEMP: temp, RELEASE_TAG: 'v1.2.3', GITHUB_REPOSITORY: 'ntanwir10/GuardScan', GITHUB_OUTPUT: output};
    const stub = 'gh() { printf "%s" "$RELEASE_FIXTURE"; };\n';
    const run = (pages: unknown[]) => shell(stub + classify.run, root, {
      ...env, RELEASE_FIXTURE: pages.map(page => JSON.stringify(page)).join('\n'),
    });
    expect(run([[{tag_name: 'v0.0.1'}], [release]]).status).toBe(0);
    expect(fs.readFileSync(output, 'utf8')).toBe('mode=checkpoint\n');
    expect(JSON.parse(fs.readFileSync(path.join(temp, 'classified-release-state.json'), 'utf8'))).toEqual(release);
    fs.unlinkSync(output);
    expect(run([[], []]).status).toBe(0);
    expect(fs.readFileSync(output, 'utf8')).toBe('mode=build\n');
    fs.unlinkSync(output);
    expect(run([[release], [release]]).status).not.toBe(0);
    for (const code of [4, 22]) {
      expect(shell(`gh() { echo 'HTTP 404 or provider failure' >&2; return ${code}; };\n` + classify.run, root, env).status).toBe(code);
      expect(fs.existsSync(output)).toBe(false);
    }
  }));

  it('uses draft-capable lookup URLs before both publication API reads', () => {
    for (const name of ['Remove private checkpoint only after the expanded draft is complete',
      'Revalidate exact release asset IDs and digests immediately before publication']) {
      const script = step(Object.values(publish.jobs).find((job: any) => job.steps?.some((candidate: any) => candidate.name === name)), name).run;
      expect(script).toContain('--json apiUrl --jq .apiUrl');
      expect(script).toContain('gh api "$RELEASE_API_URL"');
      expect(script).not.toContain('/releases/tags/');
    }
  });

  it('keeps canonical npm bytes separate from verified provenance and retains the public proof', () => temporary(root => {
    const job = build.jobs['npm-finalize'];
    const bind = step(job, 'Bind npm tarball to source and provenance');
    const bytes = Buffer.from('canonical npm bytes');
    const source = {packageName: 'guardscan', version: '1.2.3', tag: 'v1.2.3', commit: 'a'.repeat(40)};
    const metadata = {schemaVersion: 'guardscan.npm-artifact.v1', ...source, createdAt: '2026-01-01T00:00:00.000Z', filename: 'guardscan-1.2.3.tgz', size: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64')};
    fs.mkdirSync(path.join(root, 'npm-artifact'));
    fs.writeFileSync(path.join(root, 'npm-artifact/npm-artifact.json'), JSON.stringify(metadata));
    fs.writeFileSync(path.join(root, 'npm-artifact', metadata.filename), bytes);
    fs.writeFileSync(path.join(root, 'bundle.json'), '{}');
    const code = bind.run.match(/node - <<'NODE'\n([\s\S]*?)\nNODE/)[1];
    const prefix = bind.run.slice(0, bind.run.indexOf("node - <<'NODE'"));
    const env = {BUNDLE_PATH: path.join(root, 'bundle.json'), BUNDLE_FILE: 'npm.provenance.sigstore.json', BUNDLE_URL: 'https://example.test/proof', SIGNER_WORKFLOW_SHA: 'b'.repeat(40), SOURCE_COMMIT: source.commit, GITHUB_REPOSITORY: 'ntanwir10/GuardScan'};
    expect(shell('gh() { printf "{}"; };\n' + prefix, root, env).status).toBe(0);
    const script = "const Module=require('module');const original=Module._load;Module._load=function(name,...rest){if(name==='./cli/scripts/release/provenance')return {createVerifiedAttestationEvidence:()=>({verified:true})};return original.call(this,name,...rest)};\n" + code;
    const generated = spawnSync(process.execPath, ['-e', script], {cwd: root, env: {...process.env, ...env}, encoding: 'utf8'});
    expect(generated.stderr).toBe('');
    expect(generated.status).toBe(0);
    const {verifyNpmArtifact} = require('../../scripts/release/npm-artifact');
    expect(() => verifyNpmArtifact(source, path.join(root, 'npm-artifact'))).not.toThrow();
    expect(fs.readdirSync(path.join(root, 'npm-artifact')).sort()).toEqual([metadata.filename, 'npm-artifact.json']);
    expect(fs.readFileSync(path.join(root, 'npm-provenance/npm.provenance.sigstore.json'), 'utf8')).toBe('{}');
    expect(fs.existsSync(path.join(root, 'npm-provenance/npm-artifact.metadata.json'))).toBe(true);
    const evidence = build.jobs.aggregate.steps.find((candidate: any) => candidate.with?.name === 'release-npm-provenance-${{ inputs.tag }}');
    expect(evidence).toBeTruthy();
    for (const target of ['linux-x64-glibc', 'linux-arm64-glibc', 'darwin-arm64', 'darwin-x64', 'windows-x64']) {
      fs.mkdirSync(path.join(root, 'collected', target), {recursive: true});
    }
    fs.mkdirSync(path.join(root, 'collected/npm'), {recursive: true});
    fs.mkdirSync(path.join(root, 'collected/npm-provenance'), {recursive: true});
    fs.copyFileSync(path.join(root, 'npm-artifact', metadata.filename), path.join(root, 'collected/npm', metadata.filename));
    fs.cpSync(path.join(root, 'npm-provenance'), path.join(root, 'collected/npm-provenance'), {recursive: true});
    expect(shell(step(build.jobs.aggregate, 'Reject links and collect release assets').run, root).status).toBe(0);
    expect(fs.existsSync(path.join(root, 'release/npm.provenance.sigstore.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'release', metadata.filename))).toBe(true);
  }));

  it.each([
    ['native-finalize', 'Restore executable permissions after native input authentication', 'standalone', 'Validate native input structure and digest before signing', 'Keyless-sign Linux executable'],
    ['provider-finalize', 'Restore executable permissions after provider input authentication', 'rehearsal-standalone', 'Require artifact-service digest for provider input', 'Sign and notarize Apple rehearsal executable'],
  ])('restores authenticated 0644 Unix executables before signing: %s', (jobName, name, directory, validation, signing) => temporary(root => {
    const job = build.jobs[jobName];
    const chmod = step(job, name);
    expect(job.steps.indexOf(chmod)).toBeGreaterThan(job.steps.indexOf(step(job, validation)));
    expect(job.steps.indexOf(chmod)).toBeLessThan(job.steps.indexOf(step(job, signing)));
    expect(chmod.if).not.toContain("matrix.os == 'windows'");
    fs.mkdirSync(path.join(root, directory));
    const file = path.join(root, directory, 'guardscan');
    fs.writeFileSync(file, '#!/bin/sh\nprintf verified-native\n', {mode: 0o644});
    expect(spawnSync(file).status).not.toBe(0);
    const result = shell(chmod.run + '\n"./' + directory + '/guardscan"', root, {EXPECTED_EXECUTABLE: 'guardscan'});
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('verified-native');
  }));

  it.each([['winget', 'Render WinGet adapter with trusted tooling'], ['chocolatey', 'Render Chocolatey adapter with trusted tooling']])('uses an explicitly compatible renderer shell on Windows: %s', (job, name) => temporary(root => {
    const render = step(publish.jobs[job], name);
    expect(render.shell).toBe('bash');
    const script = "node() { printf '%s\\n' \"$@\"; };\n" + render.run;
    const workspace = path.join(root, 'workspace with spaces');
    const result = shell(script, root, {GITHUB_WORKSPACE: workspace});
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(workspace + '/source/cli');
    expect(result.stdout).toContain(workspace + '/cli');
  }));

  it('loads successful rehearsal notarization JSON as a file rather than a package', () => temporary(root => {
    fs.mkdirSync(path.join(root, 'rehearsal-standalone'));
    fs.writeFileSync(path.join(root, 'rehearsal-standalone/notary-submission.json'), JSON.stringify({status: 'Accepted'}));
    const run = step(build.jobs['provider-finalize'], 'Sign and notarize Apple rehearsal executable').run;
    const probe = run.split('\n').find((line: string) => line.includes('node -p') && line.includes('Accepted'));
    expect(probe).toBeTruthy();
    expect(shell(probe, root).status).toBe(0);
  }));
});
