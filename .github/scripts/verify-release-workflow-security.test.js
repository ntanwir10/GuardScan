'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
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
    'docs/RELEASE_ONBOARDING.md',
  ]) assert(ATTESTED_PATHS.includes(required), `${required} must be attested`);

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-provider-attestation-'));
  try {
    for (const file of ATTESTED_PATHS) {
      const absolute = path.join(fixture, file);
      fs.mkdirSync(path.dirname(absolute), {recursive: true});
      fs.writeFileSync(absolute, `${file}\n`);
    }
    const first = computeProviderOnboardingAttestation(fixture);
    assert.match(first, /^sha256:[a-f0-9]{64}$/);
    assert.equal(computeProviderOnboardingAttestation(fixture), first);
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
    fs.appendFileSync(path.join(fixture, ATTESTED_PATHS[0]), 'changed\n');
    assert.notEqual(computeProviderOnboardingAttestation(fixture), first);
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
    const source = readWorkflow(name);
    assert.match(source, /--certificate-identity\s+"https:\/\/github\.com\/\$\{GITHUB_REPOSITORY\}\/\.github\/workflows\/release-build\.yml@refs\/heads\/main"/);
    assert.match(source, /--certificate-github-workflow-ref\s+"refs\/heads\/main"/);
    assert.match(source, /--certificate-github-workflow-sha\s+"\$RELEASE_BUILD_WORKFLOW_SHA"/);
    assert.doesNotMatch(source, /certificate-identity-regexp/);
  }
});

test('Chocolatey publication selects the exact expected package', () => {
  const source = readWorkflow('release-publish.yml');
  assert.doesNotMatch(source, /local-feed\\\\\*\.nupkg\s*\|\s*Select-Object\s+-First/);
  assert.match(source, /expectedPackageName\s*=\s*"guardscan\.\$candidateVersion\.nupkg"/);
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
  assert.match(source, /record-canary/);
  assert.match(source, /--expected-targets/);
  assert.match(source, /invalidCanaryReport: true/);
  assert.match(source, /invalidReports\.filter\(report => report\.version === version\)/);
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
