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
