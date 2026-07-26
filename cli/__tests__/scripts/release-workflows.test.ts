import fs from 'fs';
import path from 'path';
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

describe('zero-touch release workflow contracts', () => {
  it('keeps general CI non-publishing and requires the complete release gate', () => {
    const source = workflowSource('ci.yml');
    expect(yaml.load(source)).toBeTruthy();
    expect(source).not.toMatch(/^\s+tags:/m);
    expect(source).not.toContain('npm publish');
    expect(source).not.toContain('gh release create');
    expect(source).toContain('npm test -- --coverage --runInBand');
    expect(source).toContain('npm audit --omit=dev --audit-level=high');
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
