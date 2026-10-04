import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

describe('required GitHub release gate', () => {
  it('always requires all catalog quality jobs and does not publish artifacts', () => {
    const workflow = yaml.load(fs.readFileSync(
      path.resolve(__dirname, '../../../.github/workflows/ci.yml'),
      'utf8'
    )) as {
      on?: {pull_request?: {branches?: string[]}};
      jobs?: Record<string, {name?: string; if?: string; needs?: string[]; steps?: Array<{run?: string}>}>;
    };
    const gate = workflow.jobs?.['release-gate'];
    const pullRequestBranches = workflow.on?.pull_request?.branches || [];
    const matchesPullRequestBase = (branch: string) => pullRequestBranches.some(pattern => (
      pattern.endsWith('/**')
        ? branch.startsWith(pattern.slice(0, -2))
        : pattern === branch
    ));

    expect(gate).toMatchObject({
      name: 'Release gate',
      if: 'always()',
      needs: [
        'source-contract',
        'lint',
        'test',
        'npm-artifact',
        'installed-package',
        'package-manager',
        'standalone',
        'integration',
      ],
    });
    expect(gate?.steps?.[0]?.run).toContain('success success success success success success success success');
    expect(workflow.jobs?.['publish-npm']).toBeUndefined();
    expect(workflow.jobs?.['create-release']).toBeUndefined();

    for (const base of [
      'main',
      'develop',
      'release/1.1.0',
      'review/1.1.0-core',
      'review/1.1.0-catalog',
      'review/1.1.0-distribution',
    ]) {
      expect(matchesPullRequestBase(base)).toBe(true);
    }
    for (const unrelated of ['feature/user-auth', 'releasecandidate/1.1.0', 'reviewish/1.1.0']) {
      expect(matchesPullRequestBase(unrelated)).toBe(false);
    }
  });

  it('runs every Node CLI workflow job on the package-supported runtime', () => {
    const workflowText = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/ci.yml'), 'utf8');
    const workflow = yaml.load(workflowText) as {
      env?: {RELEASE_NODE_VERSION?: string};
      jobs?: Record<string, {strategy?: {matrix?: {node?: string[]}}}>;
    };

    expect(workflowText.match(/node-version:\s*["']?(?:18|20)["']?/g)).toBeNull();
    expect(workflow.env?.RELEASE_NODE_VERSION).toMatch(/^22\.\d+\.\d+$/);
    const matrixNodes = workflow.jobs?.['test']?.strategy?.matrix?.node || [];
    expect(matrixNodes).toContain(workflow.env?.RELEASE_NODE_VERSION);
    expect(matrixNodes).toEqual(['22.23.1', '24.18.0', '26.5.0']);
    expect(matrixNodes.every(version => Number.parseInt(version.split('.')[0], 10) >= 22)).toBe(true);
  });

  it('propagates npm audit failures through the required source contract job', () => {
    const workflow = yaml.load(fs.readFileSync(
      path.resolve(__dirname, '../../../.github/workflows/ci.yml'),
      'utf8'
    )) as {jobs?: Record<string, {
      'continue-on-error'?: boolean;
      steps?: Array<{name?: string; run?: string; 'continue-on-error'?: boolean}>;
    }>};
    const sourceContract = workflow.jobs?.['source-contract'];
    const audit = sourceContract?.steps?.find(step => step.name === 'Audit production dependency graph');

    expect(audit?.run).toBe('npm audit --omit=dev --audit-level=high');
    expect(audit?.['continue-on-error']).not.toBe(true);
    expect(sourceContract?.['continue-on-error']).not.toBe(true);
  });
});
