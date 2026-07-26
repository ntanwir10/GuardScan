import fs from 'fs';
import path from 'path';
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
  'release-please.yml',
  'release-publish.yml',
  'release-train.yml',
];

function workflowSource(filename: string): string {
  return fs.readFileSync(path.join(workflowRoot, filename), 'utf8').replace(/\r\n?/g, '\n');
}

describe('zero-touch release workflow contracts', () => {
  it('keeps general CI non-publishing and requires the complete release gate', () => {
    const source = workflowSource('ci.yml');
    expect(yaml.load(source)).toBeTruthy();
    expect(source).not.toMatch(/^\s+tags:/m);
    expect(source).not.toContain('"release/**"');
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
    expect(train).toContain('samples.length >= 24');
    expect(train).toContain("types: [catalog_updated]");
    expect(train).toContain('hinted-channel-lock.json');
    expect(train).toContain('channel-preview/v$RELEASE_VERSION');
    expect(train).toContain("type: 'channel_published'");
    expect(train).toContain("type: 'channel_submitted'");
    expect(train).toContain("['homebrew-core', 'winget', 'chocolatey']");
    expect(train).toContain('cannot start or promote while a stable train remains incomplete');
    expect(canary).toContain("train.channel !== 'stable'");
    expect(canary).toContain('reconcileRelease(materializeReleaseState(readEvents(ledger))).complete');
    expect(train).toContain("vars.RELEASE_AUTOMATION_ENABLED == 'true'");
    expect(train).toMatch(
      /build:\n[\s\S]*?permissions:\n\s+contents: read\n\s+id-token: write\n\s+attestations: write/
    );
    expect(train).toMatch(
      /publish:\n[\s\S]*?permissions:\n\s+actions: read\n\s+contents: write\n\s+id-token: write/
    );
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
    expect(publish).toContain('RELEASE_NPM_VERSION: 11.5.2');
    expect(publish).toContain('npm install --global "npm@${RELEASE_NPM_VERSION}"');
    expect(publish).toContain('pypa/gh-action-pypi-publish@');
    expect(publish).toContain('cp payload/*.whl dist/');
    expect(publish).toContain('Verify complete TestPyPI file set');
    expect(publish).toContain('Verify complete PyPI file set');
    expect(publish).toContain('remote == local');
    expect(publish).not.toContain('try:\n          try:');
    expect(publish).toContain('wingetcreate submit');
    expect(publish).toContain('choco push');
    expect(combined).toContain('/.github/workflows/release-train.yml@');
    expect(combined).not.toContain('/.github/workflows/release-build.yml@');
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
    for (const match of source.matchAll(/^\s*uses:\s+([^./\s][^@\s]+)@([^\s#]+)/gm)) {
      expect(match[2]).toMatch(/^[a-f0-9]{40}$/);
    }
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
