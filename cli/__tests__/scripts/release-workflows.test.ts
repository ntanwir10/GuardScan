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
  'release-first-withdrawal.yml',
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
    expect(source).toContain('group: ci-${{ github.event.pull_request.number || github.ref }}');
    expect(source).toContain('cancel-in-progress: true');
    expect(source).not.toContain('npm publish');
    expect(source).not.toContain('gh release create');
    expect(source).toContain('npm test -- --coverage --runInBand');
    expect(source).toContain('npm audit --omit=dev --audit-level=high');
    expect(source).toContain('npm ci --omit=optional');
    expect(source).toContain('Build without optional native dependencies');
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
    expect(canary).toContain('Install default-branch ledger tooling');
    expect(canary).toMatch(
      /record:\n[\s\S]*?actions\/setup-node@[a-f0-9]+[\s\S]*?working-directory: cli\n\s+run: npm ci/
    );
    expect(train).toContain('samples.length >= 24');
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
    expect(train).toMatch(
      /publish:\n[\s\S]*?permissions:\n\s+actions: read\n\s+contents: write\n\s+id-token: write/
    );
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
    expect(train).toContain('CURRENT_BASE="$(gh api "repos/$GITHUB_REPOSITORY/pulls/$REQUEST_RELEASE_PR" --jq .base.sha)"');
    expect(train).toContain('--squash --match-head-commit "$EXPECTED_HEAD"');
    expect(train).not.toContain('--auto --squash --match-head-commit "$EXPECTED_HEAD"');
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

  it('uses default-branch canary tooling while every matrix entry verifies its own version', () => {
    const canary = workflowSource('release-canary.yml');
    expect(canary).not.toContain('implementation_ref');
    expect(canary).not.toContain('trains[0]');
    expect(canary).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(canary).toContain('VERSION: ${{ matrix.train.version }}');
    expect(canary).toContain('version = \'${{ matrix.train.version }}\'');
    expect(canary).toContain('assert_version guardscan --version');
    expect(canary).toContain('test "$ACTUAL_VERSION" = "$VERSION"');
    expect(canary).toContain('test "$(guardscan --version | tr -d \'\\r\')" = "$VERSION"');
    expect(canary).toContain('test "$("$PIPX_GUARDSCAN" --version | tr -d \'\\r\')" = "$VERSION"');
    expect(canary).toContain('$installedVersion -ne $env:VERSION');
    expect(canary).toContain('const expectedTargetCounts = {');
    expect(canary).toContain('resolved.length === expectedCount');
    expect(canary).toContain("type: 'channel_failed'");
    expect(canary).toContain("error: 'one or more current public canary targets failed'");
    expect(canary).toContain('const versionAggregateTimestamp = versionReports');
    expect(canary).not.toContain('{remoteIdentity: `${channel}:${version}`}');
    expect(canary).toContain("if: inputs.version == '' || vars.RELEASE_AUTOMATION_ENABLED == 'true'");
    expect(canary).toMatch(
      /record:\n[\s\S]*?if: >-\n\s+always\(\)\n\s+&& vars\.RELEASE_AUTOMATION_ENABLED == 'true'/
    );
  });

  it('keeps undiscovered moderated packages pending and fails discovered lifecycle errors', () => {
    const canary = workflowSource('release-canary.yml');
    expect(canary).toContain('$discovered = $false');
    expect(canary).toContain('$discovered = $true');
    expect(canary).toContain("if ($discovered) { $report.status = 'failed' }");
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
    expect(train).toContain('--match-head-commit "$EXPECTED_HEAD"');
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
    expect(publish).toContain('RELEASE_NPM_VERSION: 11.5.2');
    expect(publish).toContain('npm install --global "npm@${RELEASE_NPM_VERSION}"');
    expect(publish).toContain('pypa/gh-action-pypi-publish@');
    expect(publish).toContain('cp payload/*.whl dist/');
    expect(publish).toContain('Verify complete TestPyPI file set');
    expect(publish).toContain('Verify complete PyPI file set');
    expect(publish).toContain('remote == local');
    expect(publish).not.toContain('try:\n          try:');
    expect(publish).toContain('wingetcreate.exe submit');
    expect(publish).toContain('choco push');
    expect(combined).toContain('/.github/workflows/release-train.yml@');
    expect(combined).not.toContain('/.github/workflows/release-build.yml@');
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
    expect(publish).toContain('repos/microsoft/winget-pkgs/contents/${manifestPath}');
    expect(publish).toContain('repos/microsoft/winget-pkgs/pulls/$($pullRequest.number)/files');
    expect(publish).toContain('https://community.chocolatey.org/api/v2/package/guardscan/$version');
    expect(publish).toContain("throw 'WinGet public manifest integrity conflict'");
    expect(publish).toContain("throw 'Chocolatey public package integrity conflict'");
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
    expect(canary).toContain('$installedVersion -ne \'${{ matrix.train.version }}\'');
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
