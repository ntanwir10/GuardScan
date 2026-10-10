import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

const repositoryRoot = path.resolve(__dirname, '../../..');
const workflowRoot = path.join(repositoryRoot, '.github/workflows');
const releaseWorkflows = [
  'release-build.yml',
  'release-canary.yml',
  'release-please.yml',
  'release-publish.yml',
  'release-train.yml',
];

function workflowSource(filename: string): string {
  return fs.readFileSync(path.join(workflowRoot, filename), 'utf8');
}

function stepCommands(job: any): string {
  return (job?.steps || []).map((step: any) => `${step.name || ''}\n${step.run || ''}`).join('\n');
}

function assertBootstrapCi(workflow: any, scripts: Record<string, string>): void {
  const jobs = workflow.jobs || {};
  const bootstrap = jobs['release-bootstrap'];
  expect(bootstrap).toBeTruthy();
  const bootstrapCommands = stepCommands(bootstrap);
  expect(bootstrapCommands).toContain('.github/release-bootstrap-provenance.json');
  expect(bootstrapCommands).toContain('refs/pull/${SOURCE_PR_NUMBER}/head');
  expect(bootstrapCommands).toContain('verify-inert-release-bootstrap.test.js');
  expect(bootstrapCommands).toContain('npm run test:release:bootstrap');
  expect(stepCommands(jobs.lint)).toContain('npm run typecheck');
  expect(stepCommands(jobs.lint)).toContain('npm run lint:ratchet');
  expect(stepCommands(jobs['test-cli'])).toContain('npm run test:bootstrap');
  expect(stepCommands(jobs['build-cli'])).toContain('npm run build');
  expect(stepCommands(jobs['security-scan'])).toContain('npm run audit:bootstrap');
  expect(stepCommands(jobs['integration-test'])).toContain('Run self-scan');
  expect(stepCommands(bootstrap)).toContain('npm run test:package:bootstrap');
  expect(scripts['test:bootstrap']).toContain('npm test -- --coverage --runInBand');
  expect(scripts['test:bootstrap']).not.toMatch(/--testNamePattern|--testPathIgnorePatterns|--runTestsByPath/);
  expect(scripts['test:release:bootstrap']).toContain('npm run test:release');
  expect(scripts['test:release:bootstrap']).not.toMatch(/--testNamePattern|--testPathIgnorePatterns|--runTestsByPath/);
  expect(scripts['test:package:bootstrap']).toBe('node ../.github/scripts/verify-bootstrap-package.js');
  expect(scripts['audit:bootstrap']).toBe('node ../.github/scripts/verify-bootstrap-audit.js');
  expect(jobs['build-cli'].needs).toContain('test-cli');
  expect(jobs['integration-test'].needs).toContain('build-cli');
  expect(jobs['release-gate']).toBeTruthy();
  expect(jobs['release-gate'].needs).toEqual([
    'release-bootstrap', 'lint', 'test-cli', 'build-cli', 'security-scan', 'integration-test',
  ]);
  expect(Object.keys(jobs)).not.toContain('release-publish');
  expect(Object.keys(jobs)).not.toContain('release-build');
  expect(stepCommands(jobs['security-scan'])).toContain('npm run audit:bootstrap');
  expect(stepCommands(jobs['security-scan'])).not.toMatch(/--omit=dev|--no-audit/);
  expect(stepCommands(jobs['test-cli'])).not.toMatch(/--testPathIgnorePatterns|--runTestsByPath/);
}

describe('zero-touch release workflow contracts', () => {
  it('lists draft release assets through gh release view and downloads the selected asset URL', () => {
    const publish = workflowSource('release-publish.yml');
    expect(publish).toContain('--json assets');
    expect(publish).toContain('select(.name == $name)');
    expect(publish).toContain('.apiUrl');
    expect(publish).toContain('.id');
    expect(publish).toContain('ASSET_API_URL');
    expect(publish).toContain('Release-integrity incident');
    expect(publish).toContain('cmp --silent');
    expect(publish).not.toContain('releases/tags/${{ inputs.tag }}');
  });

  it('uses the selected draft asset API identity and preserves its bytes', () => {
    const parsed = yaml.load(workflowSource('release-publish.yml')) as any;
    const step = parsed.jobs.github.steps.find((candidate: any) => (
      candidate.name === 'Create or reuse draft and upload only missing identical assets'
    ));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-gh-assets-'));
    const payload = path.join(root, 'payload');
    const runnerTemp = path.join(root, 'runner-temp');
    const bin = path.join(root, 'bin');
    const log = path.join(root, 'gh.log');
    try {
      fs.mkdirSync(payload);
      fs.mkdirSync(runnerTemp);
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'gh'), [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$GH_CALL_LOG"',
        'case "$*" in',
        '  *"--json assets"*) printf "%s\\n" "$GH_ASSET_JSON" ;;',
        '  *"--json isDraft"*) printf "%s\\n" "$GH_DRAFT_STATE" ;;',
        '  *"/releases/assets/"*) printf "%s" "$GH_ASSET_BYTES" ;;',
        'esac',
      ].join('\n'), {mode: 0o700});
      const run = (step.run as string).split('${{ inputs.tag }}').join('v1.2.3')
        .split('${{ github.repository }}').join('owner/repo');
      const runStep = (
        name: string,
        assets: Array<Record<string, unknown>>,
        options: {draft?: string; bytes?: string} = {}
      ) => {
        for (const file of fs.readdirSync(payload)) fs.rmSync(path.join(payload, file));
        fs.writeFileSync(path.join(payload, name), 'identical payload');
        return spawnSync('bash', ['-euo', 'pipefail', '-c', run], {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            GITHUB_REPOSITORY: 'owner/repo',
            GH_CALL_LOG: log,
            RUNNER_TEMP: runnerTemp,
            GH_ASSET_JSON: JSON.stringify({assets}),
            GH_DRAFT_STATE: options.draft || 'true',
            GH_ASSET_BYTES: options.bytes || 'identical payload',
          },
        });
      };
      const validAsset = (name: string, apiUrl = 'https://api.github.com/repos/owner/repo/releases/assets/218451881') => ({
        name, id: 'RA_kwDODKw3uc4NBU-p', apiUrl,
      });
      const result = runStep('artifact.zip', [validAsset('artifact.zip')]);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(fs.readFileSync(path.join(runnerTemp, 'artifact.zip'), 'utf8')).toBe('identical payload');
      const calls = fs.readFileSync(log, 'utf8');
      expect(calls).toContain('https://api.github.com/repos/owner/repo/releases/assets/218451881');
      expect(calls).not.toContain('releases/tags/');

      const mismatch = runStep('artifact.zip', [validAsset('artifact.zip')], {bytes: 'different payload'});
      expect(mismatch.status).toBe(1);
      expect(mismatch.stdout).toContain('Release-integrity incident');

      for (const invalid of [
        [validAsset('artifact.zip', 'https://evil.test/repos/owner/repo/releases/assets/218451881')],
        [validAsset('artifact.zip', 'https://api.github.com/repos/attacker/repo/releases/assets/218451881')],
        [{...validAsset('artifact.zip'), id: ''}],
        [{...validAsset('artifact.zip'), id: 17}],
        [validAsset('artifact.zip', 'https://api.github.com/repos/owner/repo/releases/assets/0218451881')],
        [validAsset('artifact.zip'), validAsset('artifact.zip')],
      ]) {
        expect(runStep('artifact.zip', invalid).status).not.toBe(0);
      }

      if (process.platform !== 'win32') {
        const quotedName = 'artifact "quoted".zip';
        const quoted = runStep(quotedName, [validAsset(quotedName)]);
        expect(quoted.status).toBe(0);
        expect(fs.existsSync(path.join(runnerTemp, quotedName))).toBe(true);
      }

      const publishedMissing = runStep('artifact.zip', [], {draft: 'false'});
      expect(publishedMissing.status).toBe(1);
      expect(publishedMissing.stdout).toContain('Published release is missing required immutable asset');
      expect(fs.readFileSync(log, 'utf8')).not.toContain('release upload');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('collects the exact Apple notarization evidence filename emitted by the producer', () => {
    const build = workflowSource('release-build.yml');
    expect(build).toContain("'apple-notarization.json'");
    expect(build).toContain("-name 'apple-notarization.json'");
  });
  it('validates the production or inert-bootstrap CI gates without allowing publication', () => {
    const source = workflowSource('ci.yml');
    const workflow = yaml.load(source) as any;
    expect(workflow).toBeTruthy();
    expect(source).not.toMatch(/^\s+tags:/m);
    expect(source).not.toContain('npm publish');
    expect(source).not.toContain('gh release create');
    if (!workflow.jobs['source-contract']) {
      const scripts = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'cli/package.json'), 'utf8')).scripts;
      expect(() => assertBootstrapCi(workflow, scripts)).not.toThrow();
      return;
    }
    expect(Object.keys(workflow.jobs)).toEqual([
      'source-contract', 'lint', 'test', 'npm-artifact', 'installed-package',
      'package-manager', 'standalone', 'integration', 'release-gate',
    ]);
    expect(source).toContain('npm test -- --coverage --runInBand');
    expect(source).toContain('npm audit --audit-level=moderate');
    expect(source).not.toContain('npm audit --omit=dev');
    expect(source).toContain('npm run test:package');
    expect(source).toContain('npm run test:package-manager');
    expect(source).toContain('npm run lint:ratchet');
    expect(source).toContain('git diff --check');
    for (const target of [
      'linux-x64',
      'linux-arm64',
      'macos-x64',
      'macos-arm64',
      'windows-x64',
    ]) {
      expect(source).toContain(target);
    }
    expect(source).not.toContain('continue-on-error');
    expect(workflow.jobs['release-gate'].needs).toEqual([
      'source-contract', 'lint', 'test', 'npm-artifact', 'installed-package',
      'package-manager', 'standalone', 'integration',
    ]);
  });

  it('accepts a full inert-bootstrap gate graph and rejects a missing gate or dev audit', () => {
    const fixture = {
      jobs: {
        'release-bootstrap': {steps: [
          {run: 'node -p require("./.github/release-bootstrap-provenance.json")'},
          {run: 'git fetch origin refs/pull/${SOURCE_PR_NUMBER}/head'},
          {run: 'node --test .github/scripts/verify-inert-release-bootstrap.test.js'},
          {run: 'npm run test:release:bootstrap && npm run test:package:bootstrap'},
        ]},
        lint: {steps: [{run: 'npm run typecheck && npm run lint:ratchet'}]},
        'test-cli': {steps: [{run: 'npm run test:bootstrap'}]},
        'build-cli': {needs: ['test-cli'], steps: [{run: 'npm run build'}]},
        'security-scan': {steps: [{run: 'npm run audit:bootstrap'}]},
        'integration-test': {needs: ['build-cli'], steps: [{name: 'Run self-scan', run: 'node dist/index.js security'}]},
        'release-gate': {needs: [
          'release-bootstrap', 'lint', 'test-cli', 'build-cli', 'security-scan', 'integration-test',
        ]},
      },
    };
    const scripts = {
      'test:bootstrap': 'npm test -- --coverage --runInBand',
      'test:release:bootstrap': 'npm run test:release',
      'test:package:bootstrap': 'node ../.github/scripts/verify-bootstrap-package.js',
      'audit:bootstrap': 'node ../.github/scripts/verify-bootstrap-audit.js',
    };
    expect(() => assertBootstrapCi(fixture, scripts)).not.toThrow();
    expect(() => assertBootstrapCi({jobs: {...fixture.jobs, 'security-scan': {steps: [{run: 'npm run audit:bootstrap --omit=dev'}]}}}, scripts))
      .toThrow();
    expect(() => assertBootstrapCi({jobs: {...fixture.jobs, 'security-scan': {steps: []}}}, scripts))
      .toThrow();
    expect(() => assertBootstrapCi({jobs: {...fixture.jobs, 'release-gate': {needs: ['lint']}}}, scripts))
      .toThrow();
    const withoutGate = {jobs: {...fixture.jobs}};
    delete (withoutGate.jobs as any)['release-gate'];
    expect(() => assertBootstrapCi(withoutGate, scripts)).toThrow();
    expect(() => assertBootstrapCi(fixture, {
      ...scripts,
      'test:release:bootstrap': 'npm run test:release -- --testNamePattern=bootstrap',
    })).toThrow();
  });

  it('parses every release workflow and pins every external action to a commit', () => {
    for (const filename of ['ci.yml', ...releaseWorkflows]) {
      const source = workflowSource(filename);
      expect(yaml.load(source)).toBeTruthy();
      expect(source).not.toContain('pull_request_target');
      for (const match of source.matchAll(/^\s*uses:\s+([^./\s][^@\s]+)@([^\s#]+)/gm)) {
        expect(match[2]).toMatch(/^[a-f0-9]{40}$/);
      }
    }
  });

  it('registers every npm script invoked by release workflows and pins artifact upload correctly', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'cli/package.json'), 'utf8'));
    const scripts = packageJson.scripts as Record<string, string>;
    for (const filename of ['ci.yml', ...releaseWorkflows]) {
      const source = workflowSource(filename);
      for (const match of source.matchAll(/\bnpm run ([a-z][a-z0-9:_-]*)/g)) {
        expect(scripts[match[1]]).toEqual(expect.any(String));
      }
    }

    const publish = workflowSource('release-publish.yml');
    expect(publish).toContain('uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(publish).not.toContain('uses: actions/upload-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093');
  });

  it('runs one concurrency-safe RC soak and machine-only promotion train', () => {
    const train = workflowSource('release-train.yml');
    const canary = workflowSource('release-canary.yml');
    expect(train).toContain('cron: "*/30 * * * *"');
    expect(train).toContain("group: release-train-${{ inputs.version || 'scheduler' }}");
    expect(train).toContain('actions/create-github-app-token@');
    expect(train).toContain('promotion-decision.json');
    expect(train).toContain('release-ledger');
    expect(train).toContain("inputs.action == 'rollback'");
    expect(train).toContain('release-events.jsonl');
    expect(train).not.toContain('stable-promotion-approval');
    expect(canary).toContain('cron: "7 * * * *"');
    expect(canary).toContain('group: release-ledger');
    expect(train).toContain('samples.length >= 24');
  });

  it('builds signed artifacts and publishes through isolated provider environments', () => {
    const build = workflowSource('release-build.yml');
    const publish = workflowSource('release-publish.yml');
    const combined = `${build}\n${publish}\n${workflowSource('release-train.yml')}`;
    for (const environment of [
      'release-rc',
      'release-stable',
      'npm-publish',
      'pypi',
      'apple-notarization',
      'windows-signing',
      'winget',
      'chocolatey',
    ]) {
      expect(combined).toContain(environment);
    }
    expect(build).toContain('cosign sign-blob --yes');
    expect(build).toContain('xcrun notarytool submit');
    expect(build).toContain('xcrun stapler staple');
    expect(build).toContain('Azure/artifact-signing-action@');
    expect(build).toContain('actions/attest-build-provenance@');
    expect(build).toContain('release-manifest.json');
    expect(publish).toContain('--provenance');
    expect(publish).toContain('pypa/gh-action-pypi-publish@');
    expect(publish).toContain('wingetcreate submit');
    expect(publish).toContain('choco push');
  });

  it('binds release automation decisions to complete provider evidence', () => {
    const build = workflowSource('release-build.yml');
    const publish = workflowSource('release-publish.yml');
    const canary = workflowSource('release-canary.yml');
    const train = workflowSource('release-train.yml');

    expect(build).toContain('--prototype-metadata "../standalone/standalone-prototype.json"');
    expect(publish).toContain('remote == local');
    expect(publish).toContain('PyPI has unexpected files for this version');
    expect(publish).toContain('--expected-dist-tag "$DIST_TAG"');
    expect(publish).toContain("steps.preflight.outputs.dist-tag-repair-required == 'true'");
    expect(publish).toContain('for ATTEMPT in $(seq 1 60)');
    expect(publish).toContain('headRefOid');
    expect(publish).toContain('mergeCommit');
    expect(publish).toContain('git show "$MERGE_SHA:$TARGET"');
    const mergePolling = publish.slice(publish.indexOf('for ATTEMPT in $(seq 1 60)'), publish.indexOf('FILE_SHA256='));
    expect(mergePolling).toContain("pr.state !== 'MERGED' || pr.baseRefName !== 'main'");
    expect(mergePolling).toContain('pr.headRefOid !== process.env.EXPECTED_HEAD');
    expect(mergePolling).toContain('process.env.REPO}`.toLowerCase()');
    expect(publish).toContain('release-catalog-publication-${{ inputs.tag }}');
    expect(train).toContain('release-catalog-publication-${{ needs.prepare.outputs.tag }}');
    expect(train).toContain('catalog.state !== \'MERGED\'');
    expect(train).toContain('active.trains = (active.trains || []).filter');
    expect(canary).toContain('monotonicLedgerTimestamp(readEvents(ledger), report.checkedAt, `canary:${suffix}`)');
    expect(canary).toContain('checkedAt: report.checkedAt');
    expect(train).toContain('Refuse a denied promotion after persistence');
    expect(train).toContain('DIFF_STATUS=$?');
    expect(train).not.toContain('git commit -m "release ledger: ${RELEASE_TAG}" || exit 0');
    expect(canary).toContain('test "$(guardscan --version | tr -d \'\\r\')" = "$VERSION"');
    expect(canary).toContain('$installedVersion -ne $env:VERSION');
  });

  it('exposes every required maintainer release interface', () => {
    const source = fs.readFileSync(
      path.join(repositoryRoot, 'cli/scripts/release/index.js'),
      'utf8'
    );
    for (const command of [
      'build',
      'manifest',
      'publish',
      'verify',
      'reconcile',
      'promote',
      'rollback',
      'status',
    ]) {
      expect(source).toContain(`  ${command}`);
    }
  });
});
