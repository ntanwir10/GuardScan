import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

const workflowPath = path.resolve(
  __dirname,
  '../../../.github/workflows/release-credential-health.yml'
);

type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, {
    if?: string;
    environment?: string;
    'timeout-minutes'?: number;
    permissions?: Record<string, string>;
    steps?: Array<{name?: string; uses?: string; run?: string}>;
  }>;
};

function loadWorkflow(): {source: string; workflow: Workflow} {
  const source = fs.readFileSync(workflowPath, 'utf8');
  return {source, workflow: yaml.load(source) as Workflow};
}

describe('release credential and provider health workflow', () => {
  it('is scheduled and manually runnable but inert until explicitly enabled', () => {
    const {workflow} = loadWorkflow();
    expect(workflow.on).toHaveProperty('schedule');
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(workflow.on).not.toHaveProperty('push');
    expect(workflow.on).not.toHaveProperty('pull_request');

    for (const job of Object.values(workflow.jobs)) {
      expect(job.if).toContain("vars.RELEASE_CREDENTIAL_MONITOR_ENABLED == 'true'");
      expect(job.if).toContain("vars.RELEASE_AUTOMATION_ENABLED == 'true'");
    }
  });

  it('uses least privilege, protected environments, and only commit-pinned actions', () => {
    const {source, workflow} = loadWorkflow();
    expect(workflow.permissions).toEqual({contents: 'read'});
    expect(workflow.jobs.apple.environment).toBe('apple-notarization');
    expect(workflow.jobs.azure.environment).toBe('windows-signing');
    expect(workflow.jobs.winget.environment).toBe('winget');
    expect(workflow.jobs.chocolatey.environment).toBe('chocolatey');
    expect(workflow.jobs.azure.permissions).toMatchObject({
      contents: 'read',
      'id-token': 'write',
    });

    const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map(match => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) {
      expect(action).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
    }

    for (const job of Object.values(workflow.jobs)) {
      expect(job['timeout-minutes']).toBeGreaterThan(0);
      expect(job['timeout-minutes']).toBeLessThanOrEqual(15);
    }
  });

  it('covers provider authentication and explicitly records unsupported states as unknown', () => {
    const {source, workflow} = loadWorkflow();
    expect(Object.keys(workflow.jobs)).toEqual(expect.arrayContaining([
      'github-catalog',
      'trusted-publishers',
      'apple',
      'azure',
      'winget',
      'chocolatey',
      'report',
    ]));
    expect(source).toContain('guardscan.credential-health.v1');
    expect(source).toContain('ntanwir10/homebrew-tap');
    expect(source).toContain('permission-contents: read');
    expect(source).toContain('permission-metadata: read');
    expect(source).not.toMatch(/permission-(actions|pull-requests|issues):/);
    expect(source).not.toContain('permission-workflows: write');
    expect(source).not.toMatch(/permission-[a-z-]+: write/);
    expect(source).toContain("run('xcrun', [");
    expect(source).toContain("'notarytool', 'history'");
    expect(source).toContain('APPLE_CERTIFICATE_P12');
    expect(source).toContain('azure/login@');
    expect(source).toContain('AZURE_SIGNING_PROFILE');
    expect(source).toContain('github-authentication-token-expiration');
    expect(source).toContain('WINGET_CREATE_GITHUB_TOKEN');
    expect(source).toContain('CHOCO_API_KEY');
    expect(source).toContain("claStatus: {status: 'unknown'");
    expect(source).toContain("expiry: {status: 'unknown'");
    expect(source).toContain("signingProfile = {status: 'unknown'");
    expect(source).toContain("apiKeyAuthentication: {status: 'unknown'");
  });

  it('separates honest monitoring status from explicit release eligibility', () => {
    const {source} = loadWorkflow();
    expect(source).toContain('release_preflight:');
    expect(source).toContain('release_eligible:');
    expect(source).toContain('RELEASE_PROVIDER_ONBOARDING_ATTESTATION');
    expect(source).toContain('validateProviderOnboardingAttestation');
    expect(source).toContain("'azure-artifact-signing'");
    expect(source).toContain("'chocolatey-publisher'");
    expect(source).toContain("'trusted-publishers'");
    expect(source).toContain("'winget-submitter'");
    expect(source).toContain("status: releaseEligible ? 'eligible' : 'blocked'");
    expect(source).toContain("report.releaseEligibility.status !== 'eligible'");
    expect(source).toContain("report.status !== 'healthy'");

    const policySource = source.match(
      /function isReleaseEligible\([^)]*\) \{[\s\S]*?\n          \}/
    )?.[0];
    expect(policySource).toBeTruthy();
    const isReleaseEligible = new Function(
      `${policySource}; return isReleaseEligible;`
    )() as (
      preflight: boolean,
      onboardingVerified: boolean,
      evidence: Array<{provider: string; status: string}>
    ) => boolean;
    const observable = [
      {provider: 'github-app-catalog', status: 'healthy'},
      {provider: 'trusted-publishers', status: 'unknown'},
    ];
    expect(isReleaseEligible(false, true, observable)).toBe(false);
    expect(isReleaseEligible(true, false, observable)).toBe(false);
    expect(isReleaseEligible(true, true, observable)).toBe(true);
    expect(isReleaseEligible(true, true, [
      {provider: 'apple-signing-notary', status: 'unknown'},
    ])).toBe(false);
    expect(isReleaseEligible(true, true, [
      {provider: 'trusted-publishers', status: 'warning'},
    ])).toBe(false);
    expect(isReleaseEligible(true, true, [
      {provider: 'trusted-publishers', status: 'unhealthy'},
    ])).toBe(false);
  });

  it('executes the aggregate report with the attestation helper in report scope', () => {
    const {source, workflow} = loadWorkflow();
    expect(source.match(/validateProviderOnboardingAttestation/g)).toHaveLength(2);
    const reportRun = workflow.jobs.report.steps?.find(
      step => step.name === 'Build machine-readable health report'
    )?.run;
    expect(reportRun).toContain("const {validateProviderOnboardingAttestation} = require(");
    const script = reportRun?.match(/node - <<'NODE'\n([\s\S]*?)\nNODE/)?.[1];
    expect(script).toBeTruthy();

    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-health-report-'));
    try {
      const evidenceRoot = path.join(fixture, 'credential-health-evidence');
      const helperRoot = path.join(fixture, 'release-control-plane', '.github', 'scripts');
      fs.mkdirSync(evidenceRoot, {recursive: true});
      fs.mkdirSync(helperRoot, {recursive: true});
      fs.copyFileSync(
        path.resolve(__dirname, '../../../.github/scripts/provider-onboarding-attestation.js'),
        path.join(helperRoot, 'provider-onboarding-attestation.js')
      );
      const statuses = {
        'apple-signing-notary': 'healthy',
        'azure-artifact-signing': 'unknown',
        'chocolatey-publisher': 'unknown',
        'github-app-catalog': 'healthy',
        'trusted-publishers': 'unknown',
        'winget-submitter': 'unknown',
      };
      for (const [provider, status] of Object.entries(statuses)) {
        fs.writeFileSync(path.join(evidenceRoot, `${provider}.json`), JSON.stringify({
          schemaVersion: 'guardscan.credential-health.v1',
          provider,
          status,
        }));
      }
      const scriptPath = path.join(fixture, 'report.js');
      const output = path.join(fixture, 'github-output.txt');
      fs.writeFileSync(scriptPath, script || '');
      const subject = `sha256:${'a'.repeat(64)}`;
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000);
      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: fixture,
        env: {
          ...process.env,
          RELEASE_PREFLIGHT: 'true',
          EXPECTED_PROVIDER_ONBOARDING_ATTESTATION: subject,
          RELEASE_PROVIDER_ONBOARDING_ATTESTATION: [
            'guardscan.provider-onboarding.v1',
            subject,
            `issued=${issuedAt.toISOString()}`,
            `expires=${expiresAt.toISOString()}`,
          ].join('|'),
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: path.join(fixture, 'summary.md'),
        },
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(fs.readFileSync(output, 'utf8')).toContain('release_eligible=true');
    } finally {
      fs.rmSync(fixture, {recursive: true, force: true});
    }
  });

  it('is non-publishing and does not contain secret-printing constructs', () => {
    const {source} = loadWorkflow();
    for (const forbidden of [
      'npm publish',
      'npm dist-tag',
      'twine upload',
      'gh release create',
      'git push',
      'wingetcreate submit',
      'choco push',
      'repository_dispatch',
      'set -x',
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/echo[^\n]*(RELEASE_APP_PRIVATE_KEY|APPLE_CERTIFICATE_P12|APPLE_NOTARY_PRIVATE_KEY|WINGET_CREATE_GITHUB_TOKEN|CHOCO_API_KEY)/i);
    expect(source).not.toMatch(/Write-(Host|Output)[^\n]*(WINGET_CREATE_GITHUB_TOKEN|CHOCO_API_KEY)/i);
  });

  it('keeps every embedded Node evidence generator syntactically valid', () => {
    const {workflow} = loadWorkflow();
    let generators = 0;
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps || []) {
        if (!step.run) continue;
        for (const match of step.run.matchAll(/node - <<'NODE'\n([\s\S]*?)\nNODE/g)) {
          expect(() => new Function('require', 'process', 'console', match[1])).not.toThrow();
          generators += 1;
        }
      }
    }
    expect(generators).toBeGreaterThanOrEqual(7);
  });
});
