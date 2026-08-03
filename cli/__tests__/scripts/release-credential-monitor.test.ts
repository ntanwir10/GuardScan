import fs from 'fs';
import path from 'path';
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
    expect(source).toContain('permission-workflows: write');
    expect(source).toContain("run('xcrun', [");
    expect(source).toContain("'notarytool', 'history'");
    expect(source).toContain('APPLE_CERTIFICATE_P12');
    expect(source).toContain('azure/login@');
    expect(source).toContain('AZURE_SIGNING_PROFILE');
    expect(source).toContain('github-authentication-token-expiration');
    expect(source).toContain('WINGET_GITHUB_TOKEN');
    expect(source).toContain('CHOCO_API_KEY');
    expect(source).toContain("claStatus: {status: 'unknown'");
    expect(source).toContain("expiry: {status: 'unknown'");
    expect(source).toContain("signingProfile = {status: 'unknown'");
    expect(source).toContain("apiKeyAuthentication: {status: 'unknown'");
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
    expect(source).not.toMatch(/echo[^\n]*(RELEASE_APP_PRIVATE_KEY|APPLE_CERTIFICATE_P12|APPLE_NOTARY_PRIVATE_KEY|WINGET_GITHUB_TOKEN|CHOCO_API_KEY)/i);
    expect(source).not.toMatch(/Write-(Host|Output)[^\n]*(WINGET_GITHUB_TOKEN|CHOCO_API_KEY)/i);
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
