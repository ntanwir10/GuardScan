'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {spawnSync} = require('node:child_process');
const yaml = require('../../cli/node_modules/js-yaml');
const {
  ATTESTED_PATHS,
  computeProviderOnboardingAttestation,
  createProviderOnboardingAttestation,
  validateProviderOnboardingAttestation,
} = require('./provider-onboarding-attestation');

const root = path.resolve(__dirname, '..', '..');
const workflowRoot = path.join(root, '.github', 'workflows');
const workflowFiles = fs.readdirSync(workflowRoot).filter(name => name.endsWith('.yml')).sort();

function readWorkflow(name) {
  return fs.readFileSync(path.join(workflowRoot, name), 'utf8');
}

function parseWorkflow(name) {
  return yaml.load(readWorkflow(name));
}

function jobs(workflow) {
  return Object.entries(workflow.jobs || {});
}

function walk(value, visit) {
  visit(value);
  if (!value || typeof value !== 'object') return;
  for (const child of Object.values(value)) walk(child, visit);
}

test('provider onboarding attestation is deterministic and content-bound', () => {
  assert.equal(new Set(ATTESTED_PATHS).size, ATTESTED_PATHS.length);
  for (const required of [
    '.github/CODEOWNERS',
    '.github/workflows/ci.yml',
    '.github/workflows/release-credential-health.yml',
    '.github/workflows/release-provider-rehearsal.yml',
    '.github/workflows/release-publish.yml',
    '.github/workflows/release-train.yml',
    'cli/scripts/release',
    'cli/schemas',
    'cli/package.json',
    'cli/package-lock.json',
    'docs/RELEASE_ONBOARDING.md',
  ]) assert(ATTESTED_PATHS.includes(required), `${required} must be attested`);

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-provider-attestation-'));
  try {
    for (const file of ATTESTED_PATHS) {
      const absolute = path.join(fixture, file);
      if (file === 'cli/scripts/release' || file === 'cli/schemas') {
        fs.mkdirSync(absolute, {recursive: true});
        fs.writeFileSync(path.join(absolute, 'fixture.json'), `${file}\n`);
      } else {
        fs.mkdirSync(path.dirname(absolute), {recursive: true});
        fs.writeFileSync(absolute, file.endsWith('package.json') || file.endsWith('package-lock.json')
          ? JSON.stringify({version: '1.2.3', packages: {'': {version: '1.2.3'}}, dependencies: {fixture: '1.0.0'}})
          : `${file}\n`);
      }
    }
    const securityHelpers = [
      '.github/scripts/verify-artifact-download.py',
      '.github/scripts/resume-release-checkpoint.js',
    ];
    for (const file of securityHelpers) fs.writeFileSync(path.join(fixture, file), `${file}\n`);
    const first = computeProviderOnboardingAttestation(fixture);
    assert.match(first, /^sha256:[a-f0-9]{64}$/);
    assert.equal(computeProviderOnboardingAttestation(fixture), first);
    for (const file of ['cli/package.json', 'cli/package-lock.json']) {
      const absolute = path.join(fixture, file);
      const document = JSON.parse(fs.readFileSync(absolute, 'utf8'));
      document.version = '1.2.4';
      document.packages[''].version = '1.2.4';
      fs.writeFileSync(absolute, JSON.stringify(document));
      assert.equal(computeProviderOnboardingAttestation(fixture), first);
    }
    const packageFile = path.join(fixture, 'cli/package.json');
    const originalPackage = fs.readFileSync(packageFile);
    const changedPackage = JSON.parse(originalPackage);
    changedPackage.dependencies.fixture = '2.0.0';
    fs.writeFileSync(packageFile, JSON.stringify(changedPackage));
    assert.notEqual(computeProviderOnboardingAttestation(fixture), first);
    fs.writeFileSync(packageFile, originalPackage);
    const issuedAt = new Date('2026-08-24T12:00:00.000Z');
    const attestation = createProviderOnboardingAttestation(first, issuedAt, 30);
    assert.match(
      attestation,
      /^guardscan\.provider-onboarding\.v1\|sha256:[a-f0-9]{64}\|issued=.+Z\|expires=.+Z$/
    );
    assert.equal(
      validateProviderOnboardingAttestation(attestation, first, issuedAt).valid,
      true
    );
    assert.equal(
      validateProviderOnboardingAttestation(
        attestation,
        first,
        new Date('2026-09-24T00:00:00.000Z')
      ).valid,
      false
    );
    assert.equal(
      validateProviderOnboardingAttestation(attestation, `sha256:${'0'.repeat(64)}`, issuedAt).valid,
      false
    );
    assert.throws(() => createProviderOnboardingAttestation(first, issuedAt, 31), /between 1 and 30/);
    for (const file of securityHelpers) {
      const absolute = path.join(fixture, file);
      const original = fs.readFileSync(absolute);
      fs.appendFileSync(absolute, 'changed security helper\n');
      const changedSubject = computeProviderOnboardingAttestation(fixture);
      assert.notEqual(changedSubject, first, `${file} bytes must bind the subject`);
      assert.equal(validateProviderOnboardingAttestation(attestation, changedSubject, issuedAt).reason,
        'subject-mismatch');
      fs.writeFileSync(absolute, original);
      assert.equal(computeProviderOnboardingAttestation(fixture), first);
    }
    fs.appendFileSync(path.join(fixture, ATTESTED_PATHS[0]), 'changed\n');
    assert.notEqual(computeProviderOnboardingAttestation(fixture), first);
    const beforeNestedChange = computeProviderOnboardingAttestation(fixture);
    fs.appendFileSync(path.join(fixture, 'cli/scripts/release/fixture.json'), 'nested-change\n');
    assert.notEqual(computeProviderOnboardingAttestation(fixture), beforeNestedChange);
    assert.throws(
      () => computeProviderOnboardingAttestation(fixture, 'other/repository'),
      /repository identity drifted/
    );
  } finally {
    fs.rmSync(fixture, {recursive: true, force: true});
  }
});

test('every checkout explicitly disables persisted credentials', () => {
  for (const name of workflowFiles) {
    const workflow = parseWorkflow(name);
    walk(workflow, value => {
      if (value && typeof value === 'object' && value.uses?.startsWith('actions/checkout@')) {
        assert.equal(value.with?.['persist-credentials'], false, `${name} checkout must set persist-credentials:false`);
      }
    });
  }
});

test('release workflows do not inherit secrets and scope every App token', () => {
  for (const name of workflowFiles.filter(file => file.startsWith('release-'))) {
    const source = readWorkflow(name);
    assert.doesNotMatch(source, /secrets:\s*inherit/, `${name} must map secrets explicitly`);
    const workflow = parseWorkflow(name);
    walk(workflow, value => {
      if (value && typeof value === 'object' && value.uses?.startsWith('actions/create-github-app-token@')) {
        assert.ok(
          Object.keys(value.with || {}).some(key => key.startsWith('permission-')),
          `${name} App token must declare least-privilege permissions`
        );
      }
    });
  }
});

test('workflow inputs are not interpolated directly into shell scripts', () => {
  for (const name of workflowFiles) {
    const workflow = parseWorkflow(name);
    walk(workflow, value => {
      if (value && typeof value === 'object' && typeof value.run === 'string') {
        assert.doesNotMatch(value.run, /\$\{\{\s*inputs\./, `${name} must pass inputs through env`);
      }
    });
  }
});

test('ledger commits distinguish no-op from commit failure', () => {
  for (const name of workflowFiles.filter(file => file.startsWith('release-'))) {
    assert.doesNotMatch(readWorkflow(name), /git commit[^\n]*\|\|\s*exit\s+0/,
      `${name} must not mask ledger commit failures`);
  }
});

test('manual release entry points fail closed while disabled', () => {
  const train = readWorkflow('release-train.yml');
  const rehearsal = readWorkflow('release-provider-rehearsal.yml');
  const releasePlease = readWorkflow('release-please.yml');
  assert.match(train, /manual-guard:[\s\S]*RELEASE_AUTOMATION_ENABLED/);
  assert.match(rehearsal, /manual-guard:[\s\S]*RELEASE_PROVIDER_REHEARSAL_ENABLED/);
  assert.match(releasePlease, /manual-guard:[\s\S]*RELEASE_PLEASE_ENABLED/);
});

test('release signer verification binds the reusable workflow and SHA', () => {
  for (const name of ['release-build.yml', 'release-publish.yml', 'release-train.yml', 'release-canary.yml']) {
    const source = name === 'release-train.yml'
      ? readWorkflow(name) + fs.readFileSync(path.join(root, 'cli/scripts/release/authenticate-payload.js'), 'utf8')
      : readWorkflow(name);
    if (name === 'release-train.yml') {
      assert.match(source, /authenticatePayload/);
      assert.match(source, /'--certificate-identity', `https:\/\/github\.com\/\$\{repository\}\/\.github\/workflows\/release-build\.yml@refs\/heads\/main`/);
      assert.match(source, /'--certificate-github-workflow-ref', 'refs\/heads\/main'/);
      assert.match(source, /'--certificate-github-workflow-sha', run\.head_sha/);
      continue;
    }
    assert.match(source, /--certificate-identity\s+"https:\/\/github\.com\/\$\{GITHUB_REPOSITORY\}\/\.github\/workflows\/release-build\.yml@refs\/heads\/main"/);
    assert.match(source, /--certificate-github-workflow-ref\s+"refs\/heads\/main"/);
    assert.match(source, /--certificate-github-workflow-sha\s+"\$(?:RELEASE_BUILD_WORKFLOW_SHA|BUILD_WORKFLOW_SHA)"/);
    if (name === 'release-publish.yml') {
      assert.match(source, /BUILD_WORKFLOW_SHA="\$\(jq -er '\.head_sha' <<< "\$BUILD_RUN"\)"/);
      assert.match(source, /\.event == "workflow_dispatch" and \.head_branch == "main"/);
    }
    assert.doesNotMatch(source, /certificate-identity-regexp/);
  }
});

test('Chocolatey publication selects the exact expected package', () => {
  const source = readWorkflow('release-publish.yml');
  assert.doesNotMatch(source, /local-feed\\\\\*\.nupkg\s*\|\s*Select-Object\s+-First/);
  assert.match(source, /Get-Item -LiteralPath "local-feed\/guardscan\.\$version\.nupkg"/);
  assert.match(source, /\$version = \$env:RELEASE_TAG.TrimStart\('v'\)/);
});

test('rollback pins trusted control-plane code and fetches the defective tag as data', () => {
  assert.match(readWorkflow('release-train.yml'), /rollback:[\s\S]*?ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(readWorkflow('release-first-withdrawal.yml'), /ref: \$\{\{ job\.workflow_sha \}\}/);
  for (const name of ['release-train.yml', 'release-first-withdrawal.yml']) {
    assert.match(readWorkflow(name), /Fetch defective release tag as data only/);
  }
});

test('release train requires explicit preflight eligibility while monitoring preserves unknown state', () => {
  const train = readWorkflow('release-train.yml');
  const workflow = parseWorkflow('release-train.yml');
  const health = readWorkflow('release-credential-health.yml');
  assert.match(train, /uses: \.\/\.github\/workflows\/release-credential-health\.yml/);
  assert.deepEqual(workflow.jobs['credential-health'].needs, ['validate-request']);
  assert.equal(workflow.jobs['credential-health'].permissions?.['id-token'], 'write');
  assert.equal(workflow.jobs['credential-health'].permissions?.contents, 'read');
  assert.equal(workflow.jobs['credential-health'].with?.release_preflight, true);
  assert.match(train, /needs\.credential-health\.outputs\.release_eligible == 'true'/);
  for (const name of ['rollback', 'first-release-withdrawal']) {
    assert.deepEqual(workflow.jobs[name].needs, ['validate-request']);
    assert.doesNotMatch(workflow.jobs[name].if, /credential-health/);
  }
  assert.doesNotMatch(train, /needs\.credential-health\.outputs\.status == 'healthy'/);
  assert.match(health, /RELEASE_PROVIDER_ONBOARDING_ATTESTATION/);
  assert.match(health, /provider-onboarding-attestation\.js/);
  assert.match(health, /ref: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(health, /item\.status === 'unknown' && allowedUnknown\.has\(item\.provider\)/);
  assert.match(health, /report\.releaseEligibility\.status !== 'eligible'/);
  assert.match(health, /report\.status !== 'healthy'/);
});

test('canary aggregation delegates fail-closed incident handling to record-canary', () => {
  const source = readWorkflow('release-canary.yml');
  assert.match(source, /recordCanary\(\{ledgerFile: ledger/);
  assert.match(source, /const expectedTargets = \{\.\.\.DEFAULT_RC_CANARY_TARGETS\}/);
  assert.match(source, /invalidCanaryReport: true/);
  assert.match(source, /\.filter\(\(\{report\}\) => report\.version === process\.env\.TRAIN_VERSION\)/);
  assert.doesNotMatch(source, /appendEvent/);
});

test('release build separates source execution from privileged finalization', () => {
  const workflow = parseWorkflow('release-build.yml');
  for (const name of ['npm-build', 'native-build', 'provider-build']) {
    const job = workflow.jobs[name];
    assert.ok(job, `${name} source builder is required`);
    assert.equal(job.environment, undefined, `${name} must not enter a provider environment`);
    assert.notEqual(job.permissions?.['id-token'], 'write', `${name} must not mint OIDC credentials`);
    assert.notEqual(job.permissions?.attestations, 'write', `${name} must not attest source output`);
  }
  for (const name of ['npm-finalize', 'native-finalize', 'provider-finalize', 'aggregate']) {
    assert.ok(workflow.jobs[name], `${name} privileged finalizer is required`);
    const runs = [];
    walk(workflow.jobs[name], value => {
      if (value && typeof value === 'object' && typeof value.run === 'string') runs.push(value.run);
    });
    assert.doesNotMatch(runs.join('\n'), /(^|\n)\s*npm ci\s*$/m,
      `${name} must not install source dependencies with lifecycle scripts`);
    for (const run of runs.filter(value => value.includes('node cli/scripts/release/index.js'))) {
      assert.match(run, /--schema-root\s+"\$GITHUB_WORKSPACE\/cli"/,
        `${name} must use default-branch schemas for release CLI execution`);
    }
  }
  assert.match(readWorkflow('release-build.yml'), /repository: \$\{\{ job\.workflow_repository \}\}[\s\S]*?ref: \$\{\{ job\.workflow_sha \}\}[\s\S]*?path: source/);
  assert.match(readWorkflow('release-build.yml'), /working-directory: cli\n\s+run: npm ci --ignore-scripts/);
  assert.match(readWorkflow('release-build.yml'), /lstatSync/);
  assert.match(readWorkflow('release-build.yml'), /prototype\.executable\.sha256/);
  assert.match(readWorkflow('release-build.yml'), /aggregate:[\s\S]*?needs: \[npm-finalize, native-finalize\]/);
});

test('credentialed release jobs never execute release-source code', () => {
  const releaseWorkflows = workflowFiles.filter(file => file.startsWith('release-'));
  for (const name of releaseWorkflows) {
    const workflow = parseWorkflow(name);
    for (const [jobName, job] of jobs(workflow)) {
      const steps = job.steps || [];
      const privileged = job.environment !== undefined
        || job.permissions?.contents === 'write'
        || job.permissions?.['id-token'] === 'write'
        || job.permissions?.attestations === 'write'
        || steps.some(step => step.uses?.startsWith('actions/create-github-app-token@'));
      if (!privileged) continue;

      const rootCheckouts = steps.filter(step => (
        step.uses?.startsWith('actions/checkout@') && step.with?.path === undefined
      ));
      for (const checkout of rootCheckouts) {
        assert.ok(
          ["${{ github.workflow_sha }}", "${{ job.workflow_sha }}"].includes(checkout.with?.ref),
          `${name}:${jobName} root checkout must pin the executing control-plane workflow SHA`
        );
      }

      for (const step of steps) {
        assert.notEqual(step['working-directory'], 'source/cli',
          `${name}:${jobName} must not install or run from release source`);
        if (typeof step.run !== 'string') continue;
        const run = step.run;
        assert.doesNotMatch(run, /(^|\n)\s*npm ci\s*$/m,
          `${name}:${jobName} must disable lifecycle scripts for privileged installs`);
        assert.doesNotMatch(run, /(?:node|npm)\s+(?:\.\/)?source\/cli\//,
          `${name}:${jobName} must not execute release-source tooling`);
        assert.doesNotMatch(run, /require\(['"]\.\/source\/cli\//,
          `${name}:${jobName} must not import release-source tooling`);
      }
    }
  }
});


test('App-token Git authentication uses the GitHub credential helper without secret arguments', () => {
  for (const name of ['release-train.yml', 'release-canary.yml', 'release-publish.yml', 'release-first-withdrawal.yml']) {
    const source = readWorkflow(name);
    assert.doesNotMatch(source, /http\.extraheader=AUTHORIZATION: bearer/);
    assert.match(source, /-c credential\.helper= -c 'credential\.https:\/\/github\.com\.helper=!gh auth git-credential'/);
  }
  const args = ['-c', 'credential.helper=', '-c',
    'credential.https://github.com.helper=!gh auth git-credential', 'credential', 'fill'];
  const token = 'guardscan-fixture-installation-token';
  const result = spawnSync('git', args, {encoding: 'utf8', timeout: 5000,
    input: 'protocol=https\nhost=github.com\n\n',
    env: {...process.env, GH_HOST: 'github.com', GH_TOKEN: token, GITHUB_TOKEN: '',
      GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'}});
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes(`password=${token}`), true);
  assert.equal(args.some(argument => argument.includes(token)), false);
});

test('catalog branch validation allows unchanged verifier bytes and rejects unrelated or missing files', () => {
  const required = ['Formula/guardscan.rb', 'bucket/guardscan.json', 'channel-lock.json'];
  for (const name of ['release-publish.yml', 'release-train.yml']) {
    const workflow = parseWorkflow(name);
    const job = name === 'release-publish.yml' ? workflow.jobs.catalog : workflow.jobs.reconcile;
    const run = job.steps.find(step => step.run?.includes('assert_exact_')).run;
    const start = run.indexOf('assert_exact_');
    const end = run.indexOf(name === 'release-publish.yml' ? 'MAIN_ALREADY_CURRENT=false'
      : 'if [ "$CATALOG_CLASSIFICATION" != exact ]; then', start);
    assert.ok(end > start);
    const fn = run.slice(start, end);
    const functionName = fn.slice(0, fn.indexOf('()'));
    for (const [paths, valid] of [[required, true], [['.github/workflows/verify.yml', ...required], true],
      [[...required, 'unexpected.txt'], false], [required.slice(1), false]]) {
      const result = spawnSync('bash', ['-eu', '-c', `
        git() { case "$*" in *merge-base*) return 0;; *diff*) printf '%s\\n' "$CHANGED_FIXTURE";; *) return 1;; esac; }
        projection_matches() { return 0; }
        ${fn}
        ${functionName}
      `], {encoding: 'utf8', env: {...process.env, BRANCH: 'fixture', CHANGED_FIXTURE: paths.join('\n')}});
      assert.equal(result.status === 0, valid, `${name}: exact catalog change set`);
    }
  }
});


test('native archive optional evidence absence succeeds while copy failures propagate', () => {
  const step = parseWorkflow('release-build.yml').jobs['native-finalize'].steps
    .find(step => step.name === 'Archive signed executable with trusted tooling');
  const loop = step.run.split('\n').find(line => line.startsWith('for file in guardscan.sigstore.json'));
  assert.ok(loop);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-optional-evidence-'));
  try {
    fs.mkdirSync(path.join(root, 'standalone'));
    fs.mkdirSync(path.join(root, 'native-output'));
    for (const [id, file] of [['linux-x64-glibc', 'guardscan.sigstore.json'],
      ['darwin-arm64', 'apple-code-signing.txt'], ['windows-x64', 'authenticode.txt']]) {
      fs.writeFileSync(path.join(root, 'standalone', file), id);
      const script = loop.replaceAll('${{ matrix.id }}', id);
      const result = spawnSync('bash', ['-e', '-c', script], {cwd: root, encoding: 'utf8'});
      assert.equal(result.status, 0);
      assert.equal(fs.readFileSync(path.join(root, 'native-output', `${id}.${file}`), 'utf8'), id);
      const failure = spawnSync('bash', ['-e', '-c', `cp() { return 23; }; ${script}`], {cwd: root, encoding: 'utf8'});
      assert.equal(failure.status, 23);
      fs.unlinkSync(path.join(root, 'standalone', file));
    }
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
