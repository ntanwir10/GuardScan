import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

const repositoryRoot = path.resolve(__dirname, '../../..');
const workflowRoot = path.join(repositoryRoot, '.github/workflows');
const catalogWorkflow = path.join(
  repositoryRoot,
  'catalog/homebrew-tap/.github/workflows/verify.yml'
);
const releaseWorkflows = [
  'release-build.yml',
  'release-canary.yml',
  'release-first-withdrawal.yml',
  'release-please.yml',
  'release-publish.yml',
  'release-train.yml',
];

function workflowSource(filename: string): string {
  return fs.readFileSync(path.join(workflowRoot, filename), 'utf8').replace(/\r\n?/g, '\n');
}

function assertActionPins(source: string): void {
  for (const match of source.matchAll(/^\s*(?:-\s+)?uses:\s+([^./\s][^@\s]+)@([^\s#]+)/gm)) {
    expect(match[2]).toMatch(/^[a-f0-9]{40}$/);
  }
}

function stepCommands(job: any): string {
  return (job?.steps || []).map((step: any) => `${step.name || ''}\n${step.run || ''}`).join('\n');
}

function runWhitespaceCheck(step: any, cwd: string, baseSha: string): ReturnType<typeof spawnSync> {
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', step.run], {
    cwd,
    encoding: 'utf8',
    env: {...process.env, ...(step.env || {}), BASE_SHA: baseSha},
  });
  if (result.error) throw result.error;
  if (result.status === null) throw new Error(result.stderr || 'bash did not return an exit status');
  return result;
}

function createGitFixture(
  root: string,
  name: string,
  firstCommit: string,
): {cwd: string; base: string; commit: (contents: string) => string} {
  const cwd = path.join(root, name);
  fs.mkdirSync(cwd);
  const git = (args: string[]) => {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Workflow Test',
        GIT_AUTHOR_EMAIL: 'workflow-test@example.invalid',
        GIT_COMMITTER_NAME: 'Workflow Test',
        GIT_COMMITTER_EMAIL: 'workflow-test@example.invalid',
      },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
    return result.stdout.trim();
  };
  git(['init']);
  const commit = (contents: string) => {
    fs.writeFileSync(path.join(cwd, 'tracked.txt'), contents);
    git(['add', 'tracked.txt']);
    git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture commit']);
    return git(['rev-parse', 'HEAD']);
  };
  const base = commit(firstCommit);
  return {cwd, base, commit};
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
        '  *"--json isDraft,isPrerelease"*) printf "%s" "$GH_RELEASE_STATE" ;;',
        '  *"/releases/assets/"*) printf "%s" "$GH_ASSET_BYTES" ;;',
        'esac',
      ].join('\n'), {mode: 0o700});
      const runStep = (
        name: string,
        assets: Array<Record<string, unknown>>,
        options: {draft?: string; prerelease?: string; bytes?: string; channel?: string} = {}
      ) => {
        const run = (step.run as string).split('${{ inputs.tag }}').join('v1.2.3')
          .split('${{ inputs.channel }}').join(options.channel || 'stable')
          .split('${{ github.repository }}').join('owner/repo');
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
            GH_RELEASE_STATE: JSON.stringify({
              isDraft: (options.draft || 'true') === 'true',
              isPrerelease: (options.prerelease || 'false') === 'true',
            }),
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

      const channelMismatch = runStep('artifact.zip', [validAsset('artifact.zip')], {
        channel: 'rc', prerelease: 'false',
      });
      expect(channelMismatch.status).toBe(1);
      expect(channelMismatch.stderr).toContain('Release channel mismatch');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('collects the exact Apple notarization evidence filename emitted by the producer', () => {
    const build = workflowSource('release-build.yml');
    expect(build).toContain("'apple-notarization.json'");
    expect(build).toContain("-name '*.apple-notarization.json'");
  });
  it('validates the production or inert-bootstrap CI gates without allowing publication', () => {
    const source = workflowSource('ci.yml');
    const workflow = yaml.load(source) as any;
    expect(workflow).toBeTruthy();
    expect(source).not.toMatch(/^\s+tags:/m);
    expect(workflow.on.push.branches).toEqual(['main', 'develop']);
    expect(workflow.on.pull_request.branches).toEqual(['main', 'develop', 'release/**', 'review/**']);
    expect(workflow.permissions).toEqual({contents: 'read'});
    expect(source).toContain('group: ci-${{ github.event.pull_request.number || github.ref }}');
    expect(source).toContain('cancel-in-progress: true');
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

  it('checks committed whitespace against the event base, including empty-tree fallbacks', () => {
    const workflow = yaml.load(workflowSource('ci.yml')) as any;
    const job = workflow.jobs['source-contract'] || workflow.jobs['release-bootstrap'];
    const step = job.steps.find((candidate: any) => candidate.name === 'Reject whitespace and patch corruption');
    expect(step).toBeTruthy();

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-committed-diff-'));
    try {
      const clean = createGitFixture(root, 'clean-repo', 'clean\n');
      const cleanHead = clean.commit('clean\nsecond clean line\n');
      expect(runWhitespaceCheck(step, clean.cwd, clean.base).status).toBe(0);
      expect(runWhitespaceCheck(step, clean.cwd, '').status).toBe(0);
      expect(runWhitespaceCheck(step, clean.cwd, '0'.repeat(40)).status).toBe(0);

      clean.commit('clean\nsecond clean line \n');
      expect(runWhitespaceCheck(step, clean.cwd, cleanHead).status).not.toBe(0);
      const invalidBase = runWhitespaceCheck(step, clean.cwd, 'not-a-revision');
      expect(invalidBase.status).not.toBe(0);
      expect(invalidBase.stderr).toContain('Refusing invalid base SHA');

      const firstCommitWhitespace = createGitFixture(
        root,
        'first-commit-whitespace',
        'first commit has trailing whitespace \n',
      );
      expect(runWhitespaceCheck(step, firstCommitWhitespace.cwd, '').status).not.toBe(0);
      expect(runWhitespaceCheck(step, firstCommitWhitespace.cwd, '0'.repeat(40)).status).not.toBe(0);
      expect(step.env?.BASE_SHA).toBe('${{ github.event.pull_request.base.sha || github.event.before }}');
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
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
      assertActionPins(source);
    }
  });

  it('rejects mutable action references even when uses is the first step key', () => {
    for (const prefix of ['      - uses: ', '        uses: ']) {
      expect(() => assertActionPins(prefix + 'actions/checkout@v4')).toThrow();
      expect(() => assertActionPins(prefix + 'actions/checkout@' + 'a'.repeat(40))).not.toThrow();
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

  it('passes an explicit package manager to the reusable release quality gate', () => {
    expect(workflowSource('release-build.yml'))
      .toContain('npm run test:package-manager -- --manager npm');
  });

  it('keeps workflow heredoc terminators at shell column zero', () => {
    const sources = [
      ...['ci.yml', ...releaseWorkflows].map(workflowSource),
      fs.readFileSync(catalogWorkflow, 'utf8'),
    ];
    for (const source of sources) {
      const workflow = yaml.load(source) as {
        jobs?: Record<string, {steps?: Array<{run?: string}>}>;
      };
      for (const job of Object.values(workflow.jobs || {})) {
        for (const step of job.steps || []) {
          if (!step.run) continue;
          const lines = step.run.split('\n');
          for (let index = 0; index < lines.length; index += 1) {
            const opener = lines[index].match(/<<'?([A-Z][A-Z0-9_]*)'?/);
            if (!opener) continue;
            const terminatorIndex = lines.findIndex(
              (line, candidate) => candidate > index && line.trim() === opener[1]
            );
            const terminator = lines[terminatorIndex];
            expect(terminator).toBe(opener[1]);
            if (/\bnode(?:\s+-)?\s+<</.test(lines[index])) {
              const body = lines.slice(index + 1, terminatorIndex).join('\n');
              expect(() => new Function(body)).not.toThrow();
            }
          }
        }
      }
    }
  });

  it('runs one concurrency-safe RC soak and machine-only promotion train', () => {
    const train = workflowSource('release-train.yml');
    const canary = workflowSource('release-canary.yml');
    const ledgerSeed = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, '.github/release-ledger/active-versions.json'),
      'utf8'
    ));
    expect(ledgerSeed).toEqual({
      schemaVersion: 'guardscan.active-trains.v1',
      trains: [],
    });
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
    expect(train).toContain('const decision = createPromotionDecision(input)');
    expect(canary).toMatch(
      /record:\n[\s\S]*?actions\/setup-node@[a-f0-9]+[\s\S]*?working-directory: cli\n\s+run: npm ci/
    );
    expect(train).toContain("types: [catalog_updated]");
    expect(train).toContain('hinted-channel-lock.json');
    expect(train).toContain('channel-preview/v$RELEASE_VERSION');
    expect(train).toContain("type: 'channel_published'");
    expect(train).toContain("type: 'channel_submitted'");
    expect(train).toContain("releaseTrainChannels(process.env.RELEASE_CHANNEL)");
    expect(train).not.toContain("? ['homebrew-core', 'winget', 'chocolatey']");
    expect(train).toContain('cannot start or promote while a stable train remains incomplete');
    expect(canary).toContain("train.channel !== 'stable'");
    expect(canary).toContain('reconcileRelease(materializeReleaseState(readEvents(ledger))).complete');
    expect(train).toContain("vars.RELEASE_AUTOMATION_ENABLED == 'true'");
    expect(train).toMatch(
      /build:\n[\s\S]*?permissions:\n\s+contents: read\n\s+id-token: write\n\s+attestations: write/
    );
    expect((yaml.load(train) as any).jobs.publish.permissions).toEqual({
      actions: 'read', contents: 'write', 'id-token': 'write',
    });
  });

  it('fails closed and persists an idempotent repository-side rollback recovery', () => {
    const train = workflowSource('release-train.yml');
    const publish = workflowSource('release-publish.yml');
    expect(train).toContain('repositories: GuardScan,homebrew-tap');
    expect(train).toContain("plan.schemaVersion !== 'guardscan.rollback-plan.v1'");
    expect(train).toContain('verified known-good release is required');
    expect(train).toContain('known-good release ledger is incomplete');
    expect(train).toContain('known-good manifest digest does not match its protected ledger');
    expect(train).toContain('DEFECTIVE_VERSION: ${{ inputs.version }}');
    expect(train).toContain('KNOWN_GOOD_VERSION: ${{ inputs.known_good }}');
    expect(train).toContain('require("./rollback-plan.json").forwardFixBranch');
    expect(train).toContain('Rollback GuardScan v$DEFECTIVE_VERSION catalog to v$KNOWN_GOOD_VERSION');
    expect(train).toContain('gh pr create "${FORWARD_FIX_PR_ARGS[@]}"');
    expect(train).toContain('gh pr merge --repo ntanwir10/homebrew-tap');
    expect(train).toContain("event.type === 'action_required'");
    expect(train).toContain('active.trains = active.trains.filter');
    expect(train).toContain('rollback-plan-v${{ inputs.version }}');
    expect(train).toContain('rollback-plan.json');
    expect(train).toContain('rollback-evidence.json');
    expect(train).toContain('ROLLBACK_KEY="rollback:$DEFECTIVE_VERSION"');
    expect(train).not.toContain('ROLLBACK_KEY="rollback:$DEFECTIVE_VERSION:$GITHUB_RUN_ID"');
    expect(train).toContain('test "$(git rev-list -n 1 "v$KNOWN_GOOD_VERSION")" = "$KNOWN_GOOD_COMMIT"');
    expect(train).toContain('git worktree add forward-fix-source "v$KNOWN_GOOD_VERSION"');
    expect(train).toContain('FORWARD_FIX_CREATED_AT="$(git show -s --format=%cI "$KNOWN_GOOD_COMMIT")"');
    expect(train).toContain('merged forward-fix pull request does not match the deterministic trusted tree');
    expect(train).toContain('--force-with-lease="refs/heads/$FORWARD_FIX_BRANCH:$FORWARD_FIX_REMOTE_HEAD"');
    expect(train).toContain('forward-fix branch has a closed-unmerged pull request');
    expect(train).toContain('forward-fix pull request is not bound to the pushed head');
    expect(train).toContain('const expected = [\'cli/CHANGELOG.md\', \'cli/package-lock.json\', \'cli/package.json\'];');
    expect(train).toContain('git -C catalog-rollback fetch origin main');
    expect(train).toContain('git -C catalog-rollback switch -c "$CATALOG_BRANCH" "$CATALOG_BASE"');
    expect(train).toContain('--force-with-lease="refs/heads/$CATALOG_BRANCH:$CATALOG_REMOTE_HEAD"');
    expect(train).toContain('catalog rollback branch contains unreviewed paths');
    expect(train).toContain("const allowed = ['Formula/guardscan.rb', 'bucket/guardscan.json', 'channel-lock.json'];");
    expect(train).toContain('catalog already-restored path has no bound merged pull request');
    expect(train).toContain('catalog rollback pull request is not bound to the pushed head');
    expect(train).toContain('gh pr merge --repo ntanwir10/homebrew-tap "$CATALOG_PR" --squash');
    expect(train).not.toContain('gh pr merge --repo ntanwir10/homebrew-tap "$CATALOG_PR" --auto --squash');
    expect(train).toContain('test "$CATALOG_PR_STATE" = MERGED');
    expect(train).toContain('catalog rollback has no actual merge commit');
    expect(train).toContain('git -C catalog-rollback rev-parse "$CATALOG_MERGE_SHA:$CATALOG_PATH"');
    expect(train).toContain('echo "commit=$CATALOG_MERGE_SHA" >> "$GITHUB_OUTPUT"');
    expect(train).toContain('EXPECTED_BASE="$(node -p \'require("./promotion-decision.json").stable.sourcePrBase\')"');
    expect(train).toContain('CURRENT_BASE="$(gh api "repos/$GITHUB_REPOSITORY/pulls/$RELEASE_PR" --jq .base.sha)"');
    expect(train).toContain('test "$CURRENT_BASE" = "$EXPECTED_BASE"');
    expect(train).toContain('--squash --match-head-commit "${{ steps.source.outputs.head_sha }}"');
    expect(train).not.toContain('--auto --squash --match-head-commit');
    expect(train).toContain('const canonicalEntries = entries => entries.sort(([left], [right])');
    expect(train).toContain('npm: Object.fromEntries(canonicalEntries(');
    expect(train).toContain('pypi: Object.fromEntries(canonicalEntries(');
    expect(publish).toMatch(
      /channel_accepted', 'channel_rejected', 'channel_corrected', 'channel_resubmitted'/
    );
    expect(publish.match(/channel_accepted', 'channel_rejected', 'channel_corrected', 'channel_resubmitted'/g))
      .toHaveLength(2);
    expect(train).not.toContain('NPM_TOKEN');
    expect(train).not.toContain('PYPI_TOKEN');
  });

  it('withdraws the first stable release only with protected-ledger authority', () => {
    const train = workflowSource('release-train.yml');
    const withdrawal = workflowSource('release-first-withdrawal.yml');
    expect(train).toContain("inputs.known_good == ''");
    expect(train).toContain("inputs.known_good != ''");
    expect(train).toContain('uses: ./.github/workflows/release-first-withdrawal.yml');
    expect(withdrawal).toContain('assertFirstReleaseWithdrawal');
    expect(withdrawal).toContain('first-release-authority.json');
    expect(withdrawal).toContain('--first-release-withdrawal');
    expect(withdrawal).toContain('--first-release-authority first-release-authority.json');
    expect(withdrawal).toContain("plan.mode !== 'first-release-withdrawal'");
    expect(withdrawal).toContain("event.payload.kind === 'recovery'");
    expect(withdrawal).toContain('prepareFirstReleaseCatalogWithdrawal');
    expect(withdrawal).toContain('PUBLISH_BRANCH="guardscan/v$DEFECTIVE_VERSION"');
    expect(withdrawal).toContain('gh pr close --repo ntanwir10/homebrew-tap');
    expect(withdrawal).toContain('completed withdrawal was republished at $CATALOG_PATH');
    expect(withdrawal).toContain("'D\\tFormula/guardscan.rb'");
    expect(withdrawal).toContain("'D\\tbucket/guardscan.json'");
    expect(withdrawal).toContain("'D\\tchannel-lock.json'");
    expect(withdrawal).toContain('catalog withdrawal left $CATALOG_PATH published');
    expect(withdrawal).toContain("github: 'superseded'");
    expect(withdrawal).toContain("homebrew: 'withdrawn'");
    expect(withdrawal).toContain("scoop: 'withdrawn'");
    expect(withdrawal).toContain('externalActionsPending');
    expect(withdrawal).toContain("'provider-actions-pending'");
    expect(withdrawal).not.toContain('git worktree add forward-fix-source');
    expect(withdrawal).not.toContain('known-good-release');
    expect(withdrawal).not.toContain('gh release delete');
    expect(withdrawal).not.toContain('npm unpublish');
    expect(train).toContain('sourcePrBase: process.env.SOURCE_PR_BASE');
    expect(train).toContain('sourcePrTree: process.env.SOURCE_PR_TREE');
    expect(train).not.toMatch(/Persist refetched catalog publication evidence\n\s+if:[^\n]+\n\s+env:\s*\n/);
  });

  it('pins each canary train implementation to its immutable ledger identity and verifies its own version', () => {
    const canary = workflowSource('release-canary.yml');
    expect(canary).not.toContain('implementation_ref');
    expect(canary).not.toContain('trains[0]');
    const record = (yaml.load(canary) as any).jobs.record;
    expect(record.strategy.matrix.train).toBe('${{ fromJSON(needs.discover.outputs.trains) }}');
    const checkout = record.steps.find((step: any) => step.name === 'Checkout exact train implementation');
    expect(checkout.with.ref).toBe('v${{ matrix.train.version }}');
    expect(stepCommands(record)).toContain('if (commit !== checkoutCommit) throw new Error');
    expect(stepCommands(record)).toContain("['rev-parse', 'HEAD']");
    expect(stepCommands(record)).toContain('origin/release-ledger:events/${tag}.jsonl');
    expect(canary).toContain('VERSION: ${{ matrix.train.version }}');
    expect(canary).toContain('version = \'${{ matrix.train.version }}\'');
    expect(canary).toContain('assert_version guardscan --version');
    expect(canary).toContain('test "$ACTUAL_VERSION" = "$VERSION"');
    expect(canary).toContain('test "$(guardscan --version | tr -d \'\\r\')" = "$VERSION"');
    expect(canary).toContain('PIPX_REPORTED_VERSION="$("$PIPX_APP" --version | tr -d \'\\r\')"');
    expect(canary).toContain('test "$PIPX_REPORTED_VERSION" = "$VERSION"');
    expect(canary).toContain('$installedVersion -ne $env:VERSION');
    expect(canary).toContain('const expectedTargetCounts = {');
    expect(canary).toContain('resolved.length === expectedCount');
    expect(canary).toContain("type === 'channel_failed'");
    expect(canary).toContain("error: 'one or more current public canary targets failed'");
    expect(canary).toContain('const versionAggregateTimestamp = reports');
    expect(canary).toContain('canaryChannelEventType(state, channel, passed, complete)');
    expect(canary).not.toContain("? ['channel_accepted', 'channel_verified']");
    const train = workflowSource('release-train.yml');
    expect(train).toContain('catalogReconciliationAllowed(');
    expect(train).toContain('shouldPublishCatalogChannel(');
    expect(train).toContain("['published', 'submitted', 'accepted', 'verified', 'failed']");
    expect(train.indexOf('if [ "$INTEGRITY_INCIDENT" = true ]'))
      .toBeLessThan(train.indexOf('if [ "$CATALOG_RECONCILE" != true ]'));
    expect(train).toContain('if [ "$CATALOG_RECONCILE" != true ] && [ "$CATALOG_CLASSIFICATION" != exact ]; then');
    expect(canary).not.toContain('{remoteIdentity: `${channel}:${version}`}');
    expect(canary).toContain("if: inputs.version == '' || vars.RELEASE_AUTOMATION_ENABLED == 'true'");
    expect(record.if).toContain("always() && vars.RELEASE_AUTOMATION_ENABLED == 'true'");
  });

  it('keeps undiscovered moderated packages pending and fails discovered lifecycle errors', () => {
    const canary = workflowSource('release-canary.yml');
    expect(canary).toContain('$notPublic = $false');
    expect(canary).toContain('$notPublic = $true');
    expect(canary.match(/\$report.reason = 'not_public'/g)).toHaveLength(2);
    expect(canary).toContain("$report.status = 'failed'");
    expect(canary).toContain('throw "Unexpected moderated registry error: $unexpectedFailure"');
    expect(canary).toContain("$availabilityStatus -eq 2 -and $noResult");
    expect(canary).not.toContain("throw 'WinGet package is not public yet'");
    expect(canary).not.toContain("throw 'Chocolatey package is not public yet'");
    expect(canary).not.toContain("-notmatch 'not found|No package found|Unable to find'");
  });

  it('tests every TestPyPI wheel natively before production PyPI publication', () => {
    const source = workflowSource('release-publish.yml');
    const workflow = yaml.load(source) as {
      jobs: Record<string, {
        needs?: string[];
        'runs-on'?: string;
        strategy?: {matrix?: {target?: Array<{id: string; runner: string}>}};
      }>;
    };
    const lifecycle = workflow.jobs['pypi-test-lifecycle'];
    expect(lifecycle.needs).toEqual(['pypi-test']);
    expect(lifecycle['runs-on']).toBe('${{ matrix.target.runner }}');
    expect(lifecycle.strategy?.matrix?.target).toEqual([
      {id: 'linux-x64-glibc', runner: 'ubuntu-24.04'},
      {id: 'linux-arm64-glibc', runner: 'ubuntu-24.04-arm'},
      {id: 'darwin-arm64', runner: 'macos-15'},
      {id: 'darwin-x64', runner: 'macos-15-intel'},
      {id: 'windows-x64', runner: 'windows-2025'},
    ]);
    expect(workflow.jobs.pypi.needs).toEqual(['pypi-test-lifecycle']);
    expect(source).toContain('Test TestPyPI wheel through pip and pipx on ${{ matrix.target.id }}');
    expect(source).toContain('python -m pipx environment --value PIPX_BIN_DIR');
    expect(source).toContain('exercise_guardscan guardscan pip');
    expect(source).toContain('exercise_guardscan "$GUARDSCAN" pipx');
    expect(source).toContain('"$executable" --help');
    expect(source).toContain('--no-telemetry scan --offline --no-cve --skip-tests --skip-ai');
    expect(source).toContain("scan.get('schemaVersion') != 'guardscan.scan.v1'");
  });

  it('validates and readies the exact same-repository main release PR before candidate tagging', () => {
    const train = workflowSource('release-train.yml');
    expect(train).toContain("pr.state !== 'open'");
    expect(train).toContain("pr.base?.ref !== 'main'");
    expect(train).toContain('pr.head?.repo?.full_name?.toLowerCase()');
    expect(train).toContain('process.env.GITHUB_REPOSITORY.toLowerCase()');
    expect(train).toContain('REQUEST_RELEASE_PR: ${{ inputs.release_pr }}');
    expect(train).toContain('EXPECTED_HEAD: ${{ steps.source.outputs.head_sha }}');
    expect(train).toContain('gh pr ready "$REQUEST_RELEASE_PR"');
    expect(train.indexOf('gh pr ready "$REQUEST_RELEASE_PR"'))
      .toBeLessThan(train.indexOf('Derive bot-owned RC commit from exact stable PR head'));
    expect(train).toContain('--match-head-commit "${{ steps.source.outputs.head_sha }}"');
    expect(train).not.toContain('gh pr ready "${{ inputs.release_pr }}"');
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
    expect(build).toContain('security find-identity -v -p codesigning "$KEYCHAIN" | grep -F "$IDENTITY"');
    expect(build).toContain("if: always() && matrix.os == 'darwin'");
    expect(build).toContain('security delete-keychain "$RUNNER_TEMP/guardscan-signing.keychain-db" || true');
    expect(build).toContain('rm -f "$RUNNER_TEMP/certificate.p12" "$RUNNER_TEMP/AuthKey.p8"');
    expect(build).toContain('Azure/artifact-signing-action@');
    expect(build).toContain('actions/attest-build-provenance@');
    expect(build).toContain('release-manifest.json');
    expect(build).toContain('npm run test:package');
    expect(build).toContain('npm run test:package-manager');
    expect(publish).toContain('--provenance');
    expect(publish).toContain('RELEASE_NPM_VERSION: 11.21.0');
    expect(publish).toContain('npm install --global "npm@${RELEASE_NPM_VERSION}"');
    expect(publish).toContain('pypa/gh-action-pypi-publish@');
    expect(publish).toContain('& .\\wingetcreate.exe submit');
    expect(publish.indexOf("throw 'Pinned wingetcreate executable failed SHA-256 verification'"))
      .toBeLessThan(publish.indexOf('& .\\wingetcreate.exe submit'));
    expect(publish).toContain('cp payload/*.whl dist/');
    expect(publish).toContain('Verify complete TestPyPI file set');
    expect(publish).toContain('Verify complete PyPI file set');
    expect(publish).toContain('remote == local');
    expect(publish).not.toContain('try:\n          try:');
    expect(publish).toContain('choco push');
    const producer = (yaml.load(publish) as any).jobs.github.steps.find((step: any) => (
      step.name === 'Authenticate release-build producer and verify payload'
    )).run;
    expect(producer).toContain('((.path | split("@")[0]) == ".github/workflows/release-train.yml")');
    expect(producer).toContain('.event == "workflow_dispatch" and .head_branch == "main"');
    expect(producer).toContain('(.head_repository.full_name | ascii_downcase) == ($repository | ascii_downcase)');
    expect(producer).toContain('/.github/workflows/release-build.yml@refs/heads/main');
    expect(producer).toContain('--certificate-github-workflow-sha "$BUILD_WORKFLOW_SHA"');
    expect(producer).toContain('.producer.runId == $run_id and (.producer.runAttempt | tostring) == $attempt');
    expect(producer).toContain('.commit == $tag_sha');
  });

  it('binds moderated submissions to exact provider evidence and fail-closed preflights', () => {
    const publish = workflowSource('release-publish.yml');
    const train = workflowSource('release-train.yml');
    expect(publish).toContain("schemaVersion = 'guardscan.moderated-submission.v1'");
    expect(publish).toContain('release-winget-evidence-${{ inputs.tag }}');
    expect(publish).toContain('release-chocolatey-evidence-${{ inputs.tag }}');
    expect(publish).toContain('RELEASE_WINGETCREATE_VERSION: 1.12.13.0');
    expect(publish).toContain(
      'RELEASE_WINGETCREATE_SHA256: 24042bd37915805615e6cf969ac57c6439124c3fe85823327f5f3fb24bd9ffea'
    );
    expect(publish).not.toContain('dotnet tool install --global wingetcreate');
    expect(publish).toContain('Pinned wingetcreate executable failed SHA-256 verification');
    expect(publish).toContain("'cli/scripts/release/winget-submission.js', $manifestDirectory, $env:RELEASE_TAG");
    expect(publish).toContain("Get-WinGetState '--public'");
    const wingetHelper = fs.readFileSync(path.resolve(__dirname, '../../scripts/release/winget-submission.js'), 'utf8');
    expect(wingetHelper).toContain('contents/${prefix.slice(0, -1)}?ref=${commit}');
    expect(wingetHelper).toContain('api(`${endpoint}/files?per_page=100`)');
    expect(wingetHelper).toContain('api(`repos/${REPOSITORY}/git/blobs/${file.sha}`)');
    expect(wingetHelper).toContain("throw new Error('WinGet manifest blob digest mismatch')");
    expect(publish).toContain('https://community.chocolatey.org/api/v2/package/guardscan/$version');
    expect(publish).toContain("throw 'WinGet public manifest integrity conflict or verification unavailable'");
    expect(publish).toContain('python cli/scripts/release/chocolatey-preflight.py --package $package.FullName --version $version');
    expect(publish).toContain("throw 'Chocolatey public package integrity conflict or verification unavailable'");
    expect(publish).toContain('protected release ledger prevents a blind duplicate');
    expect(publish.match(/throw 'Unable to fetch protected release ledger'/g)).toHaveLength(2);
    expect(train).toContain('release-winget-evidence-${{ needs.prepare.outputs.tag }}');
    expect(train).toContain('release-chocolatey-evidence-${{ needs.prepare.outputs.tag }}');
    expect(train).toContain('readModeratedEvidence');
    expect(train).toContain("evidence.schemaVersion !== 'guardscan.moderated-submission.v1'");
    expect(train).toContain('evidence.remoteIdentity');
    expect(train).toContain('evidence.remoteDigest');
    expect(train).toContain('expectedRemoteIdentity');
    expect(train).toContain('submission: evidence');
    expect(train).toContain('releaseTrainChannels(process.env.RELEASE_CHANNEL)');
    expect(train).not.toMatch(
      /for \(const channel of \['winget', 'chocolatey'\]\)[\s\S]*?remoteIdentity: `\$\{channel\}:\$\{tag\}`/
    );
  });

  it('requires exact public moderated CLI versions after discovery', () => {
    const canary = workflowSource('release-canary.yml');
    const publish = workflowSource('release-publish.yml');
    expect(canary).toContain('$installedVersion = (& guardscan --version | Out-String).Trim()');
    expect(canary.match(/\$reportedVersion -cne '\$\{\{ matrix.train.version \}\}'/g)).toHaveLength(2);
    expect(publish.match(/\$installedVersion -ne '\$\{\{ inputs\.tag \}\}'\.TrimStart\('v'\)/g))
      .toHaveLength(2);
    expect(publish).toContain('WinGet is unavailable on the selected Windows runner');
    expect(publish).toContain('Chocolatey is unavailable on the selected Windows runner');
  });

  it('uses one cryptographically bound shared Homebrew and Scoop catalog', () => {
    const publish = workflowSource('release-publish.yml');
    const canary = workflowSource('release-canary.yml');
    const train = workflowSource('release-train.yml');
    const combined = `${publish}\n${canary}\n${train}`;
    expect(combined).toContain('ntanwir10/homebrew-tap');
    expect(combined).not.toContain('scoop-bucket');
    expect(publish).toContain('Formula/guardscan.rb');
    expect(publish).toContain('bucket/guardscan.json');
    expect(publish).toContain('channel-lock.json');
    expect(publish).toContain('catalog/homebrew-tap/.github/workflows/verify.yml');
    expect(publish).toContain('channel-preview/$RELEASE_TAG');
    expect(publish).toContain('--generator-commit "$RELEASE_REF"');
    expect(train).toContain('github:${catalogResult.repository}@${catalogResult.commit}#${catalogPath}');
    expect(train).toContain('catalog: {');
    expect(train).toContain("type: 'channel_submitted'");
  });

  it('ships a pinned, reproducible, native catalog verification workflow', () => {
    const source = fs.readFileSync(catalogWorkflow, 'utf8');
    expect(yaml.load(source)).toBeTruthy();
    assertActionPins(source);
    expect(source).toContain('manifest digest mismatch');
    expect(source).toContain('published=false');
    expect(source).toContain('catalog metadata is partially initialized');
    expect(source).toContain("needs.integrity.outputs.published == 'true'");
    expect(source).toContain('node scripts/release/index.js catalog');
    expect(source).toContain('--check');
    expect(source).toContain('runs-on: macos-15');
    expect(source).toContain('runs-on: windows-2025');
    expect(source).toContain('brew install --formula');
    expect(source).toContain('SCOOP_INSTALL_COMMIT: b0ee913725139b816f9178163af0aecdba07a7ed');
    expect(source).toContain('SCOOP_COMMIT: b588a06e41d920d2123ec70aee682bae14935939');
    expect(source).toContain('scoop install guardscan-catalog/guardscan');
    expect(source).toContain('guardscan.exe');
    expect(source).toContain("event_type: 'catalog_updated'");
  });

  it('binds release automation decisions to complete provider evidence', () => {
    const build = workflowSource('release-build.yml');
    const publish = workflowSource('release-publish.yml');
    const canary = workflowSource('release-canary.yml');
    const train = workflowSource('release-train.yml');

    expect(build).toContain('--prototype-metadata "../standalone/standalone-prototype.json"');
    expect(publish).toContain('remote == local');
    expect(publish).toContain('PyPI has unexpected files for this version');
    expect(publish).toContain('PyPI returned unexpected files for this version');
    expect(publish).toContain('PyPI returned a conflicting wheel digest');
    expect(publish).toContain('complete tested wheel set');
    expect(publish).toContain('--expected-dist-tag "$DIST_TAG"');
    expect(publish).toContain("steps.preflight.outputs.dist-tag-repair-required == 'true'");
    expect(publish).toContain('for ATTEMPT in $(seq 1 60)');
    expect(publish).toContain('headRefOid');
    expect(publish).toContain('mergeCommit');
    expect(publish).toContain('git show "$MERGE_SHA:$TARGET"');
    const catalogJob = (yaml.load(publish) as any).jobs.catalog;
    const catalogRun = catalogJob.steps.find((step: any) => step.name === 'Push one deterministic catalog update').run;
    const validator = catalogRun.match(/validate_pr_details\(\) \{[\s\S]*?node - <<'NODE'\n([\s\S]*?)\nNODE/)[1];
    const head = 'a'.repeat(40);
    const valid = {baseRefName: 'main', headRepository: {nameWithOwner: 'ntanwir10/homebrew-tap'},
      headRefOid: head, state: 'MERGED', mergeCommit: {oid: 'b'.repeat(40)}};
    const validate = (pr: any) => spawnSync(process.execPath, ['-e', validator], {
      encoding: 'utf8', env: {...process.env, PR_DETAILS: JSON.stringify(pr), EXPECTED_HEAD: head,
        CATALOG_REPOSITORY: 'ntanwir10/homebrew-tap'},
    });
    expect(validate(valid).status).toBe(0);
    expect(validate({...valid, state: 'OPEN', mergeCommit: null}).status).toBe(0);
    for (const invalid of [
      {...valid, baseRefName: 'other'}, {...valid, headRepository: {nameWithOwner: 'attacker/tap'}},
      {...valid, headRefOid: 'c'.repeat(40)}, {...valid, headRefOid: 'invalid'},
      {...valid, state: 'CLOSED'}, {...valid, mergeCommit: null},
    ]) expect(validate(invalid).status).not.toBe(0);
    expect(catalogRun).toContain('if [ "$RELEASE_CHANNEL" = stable ]; then test "$PR_STATE" = MERGED; fi');
    expect(catalogRun).toContain('validate_pr_details');
    expect(publish).toContain("schemaVersion: 'guardscan.catalog-publication.v1'");
    expect(train).toContain("catalogResult.schemaVersion !== 'guardscan.catalog-publication.v1'");
    const mergePolling = catalogRun;
    expect(mergePolling).toContain("!['OPEN', 'MERGED'].includes(pr.state)");
    expect(mergePolling).toContain('pr.headRefOid !== expectedHead');
    expect(mergePolling).toContain('pr.headRepository?.nameWithOwner !== process.env.CATALOG_REPOSITORY');
    expect(mergePolling).toContain('for ATTEMPT in $(seq 1 60)');
    expect(publish).toContain('git merge-base --is-ancestor "$MERGE_SHA" HEAD');
    expect(publish).toContain('headCommit: process.env.EXPECTED_HEAD');
    expect(publish).toContain('release-catalog-${{ inputs.tag }}');
    expect(train).toContain('release-catalog-${{ needs.prepare.outputs.tag }}');
    expect(train).toContain("catalogResult.state !== 'MERGED'");
    expect(train).toContain('catalogResult.lockSha256 !== lockSha256');
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
