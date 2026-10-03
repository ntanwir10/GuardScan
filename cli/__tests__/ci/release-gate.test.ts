import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

describe('required GitHub release gate', () => {
  it('always reports an aggregate status for every non-publishing CI job', () => {
    const workflow = yaml.load(fs.readFileSync(
      path.resolve(__dirname, '../../../.github/workflows/ci.yml'),
      'utf8'
    )) as {jobs?: Record<string, {name?: string; if?: string; needs?: string[]; steps?: Array<{run?: string}>}>};
    const gate = workflow.jobs?.['release-gate'];

    expect(gate).toMatchObject({
      name: 'Release gate',
      if: 'always()',
      needs: ['lint', 'test-cli', 'build-cli', 'security-scan', 'integration-test'],
    });
    expect(gate?.steps?.[0]?.run).toContain(
      'success success success success success'
    );
    expect(workflow.jobs?.['publish-npm']?.needs).toContain('release-gate');
    expect(workflow.jobs?.['publish-npm']?.if).toContain("needs.release-gate.result == 'success'");
  });

  it('runs every Node CLI workflow job on the package-supported runtime', () => {
    const workflowText = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/ci.yml'), 'utf8');
    const workflow = yaml.load(workflowText) as {jobs?: Record<string, {strategy?: {matrix?: {'node-version'?: number[]}}}>};

    expect(workflowText.match(/node-version:\s*["']?(?:18|20)["']?/g)).toBeNull();
    expect(workflowText.match(/node-version:\s*["']?22["']?/g)?.length).toBeGreaterThan(0);
    expect(workflow.jobs?.['test-cli']?.strategy?.matrix?.['node-version']).toEqual([22]);
  });
});
