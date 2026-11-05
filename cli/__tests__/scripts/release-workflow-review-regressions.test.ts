import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

const workflowRoot = path.resolve(__dirname, '../../../.github/workflows');

function workflow(filename: string): any {
  return yaml.load(fs.readFileSync(path.join(workflowRoot, filename), 'utf8'));
}

function step(job: any, name: string): any {
  const match = (job.steps || []).find((candidate: any) => candidate.name === name);
  if (!match) throw new Error(`missing workflow step: ${name}`);
  return match;
}

describe('release workflow review regressions', () => {
  it('collects the versioned Apple notarization evidence emitted by native builders', () => {
    const build = workflow('release-build.yml');
    const aggregateSteps = Object.values(build.jobs).flatMap((job: any) => job.steps || []);
    const collect = aggregateSteps.find((candidate: any) => (
      candidate.name === 'Reject links and collect release assets'
    ));
    expect(collect).toBeTruthy();
    expect(collect.run).toContain("-name '*.apple-notarization.json'");
    expect(collect.run).not.toContain("-name 'apple-notarization.json'");
  });

  it('authenticates producer runs before trusting signed release metadata in every checksum consumer', () => {
    const build = workflow('release-build.yml');
    const buildSteps = Object.values(build.jobs).flatMap((job: any) => job.steps || []);
    const producer = buildSteps.find((candidate: any) => candidate.name === 'Keyless-sign aggregate checksums');
    expect(producer.run).toContain('--certificate-identity "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/release-build.yml@refs/heads/main"');
    expect(producer.run).toContain('--certificate-github-workflow-sha "${GITHUB_SHA}"');

    for (const filename of ['release-canary.yml', 'release-publish.yml']) {
      const parsed = workflow(filename);
      const jobs = Object.values(parsed.jobs) as any[];
      const identity = jobs.flatMap((job: any) => job.steps || []).find((candidate: any) => (
        candidate.name === 'Authenticate the release-build producer and verify signed checksums'
          || candidate.name === 'Authenticate release-build producer and verify payload'
      ));
      expect(identity).toBeTruthy();
      const run = identity.run as string;
      expect(run).toContain('actions/runs/$PRODUCER_RUN_ID/attempts/$PRODUCER_ATTEMPT');
      expect(run).toContain('.event == "workflow_dispatch"');
      expect(run).toContain('.head_branch == "main"');
      expect(run).toContain('.head_repository.full_name');
      expect(run).toContain('--certificate-identity "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/release-build.yml@refs/heads/main"');
      expect(run).toContain('--certificate-github-workflow-sha "$BUILD_WORKFLOW_SHA"');
      expect(run).not.toContain('--certificate-identity-regexp');
      if (filename === 'release-publish.yml') {
        expect(run.indexOf('cosign verify-blob')).toBeLessThan(run.indexOf('sha256sum --check'));
      }
      if (filename === 'release-publish.yml') {
        expect(run).toContain('.commit == $tag_sha');
        expect(run).toContain('.producer.sourceRef == ("refs/tags/v" + $version)');
      }
    }

    const canary = workflow('release-canary.yml');
    const job = canary.jobs['native-and-pypi'];
    expect(job.permissions).toEqual({contents: 'read', actions: 'read'});
    const steps = job.steps;
    const verifyIdentity = steps.findIndex((candidate: any) => (
      candidate.name === 'Authenticate the release-build producer and verify signed checksums'
    ));
    const verifyManifest = steps.findIndex((candidate: any) => (
      candidate.name === 'Verify signed checksums and bind the manifest to the immutable tag'
    ));
    const extract = steps.findIndex((candidate: any) => candidate.name === 'Extract verified GitHub archive');
    expect(verifyIdentity).toBeGreaterThanOrEqual(0);
    expect(verifyIdentity).toBeLessThan(verifyManifest);
    expect(verifyManifest).toBeLessThan(extract);
    expect(steps[verifyIdentity].run).toContain('cosign verify-blob');
    expect(steps[verifyManifest].run).toContain('checksum-inventory.js release "$ARCHIVE_NAME" release-manifest.json');
    const manifestBinding = steps[verifyManifest].run as string;
    expect(manifestBinding).toContain('ENTRY_COUNT');
    expect(manifestBinding).toContain('ARCHIVE_NAME="guardscan-$VERSION-$TARGET.$ARCHIVE"');
    expect(manifestBinding).toContain('.sha256 == $archive_sha');
    expect(manifestBinding).toContain('.source.commit == $tag_sha');
    expect(manifestBinding).toContain('ENTRY_COUNT" -ne 1');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-canary-integrity-'));
    const release = path.join(root, 'release');
    fs.mkdirSync(release);
    const archiveName = 'guardscan-1.2.3-linux-x64-glibc.tar.gz';
    const digest = 'a'.repeat(64);
    fs.writeFileSync(path.join(release, archiveName), 'archive fixture');
    fs.writeFileSync(path.join(release, 'release-manifest.json'), '{}');
    const entryGuard = manifestBinding.slice(
      manifestBinding.indexOf('ARCHIVE_NAME='), manifestBinding.indexOf('ARCHIVE_SHA=')
    );
    const checkEntries = (contents: string) => {
      fs.writeFileSync(path.join(release, 'SHA256SUMS'), contents);
      return spawnSync('bash', ['-euo', 'pipefail', '-c', entryGuard], {
        cwd: root,
        encoding: 'utf8',
        env: {...process.env, VERSION: '1.2.3', TARGET: 'linux-x64-glibc', ARCHIVE: 'tar.gz'},
      });
    };
    try {
      const validEntries = `${digest}  ${archiveName}\n${'b'.repeat(64)}  release-manifest.json\n`;
      expect(checkEntries(validEntries).status).toBe(0);
      expect(checkEntries(`${'b'.repeat(64)}  release-manifest.json\n`).status).not.toBe(0);
      expect(checkEntries(`${validEntries}${digest}  ${archiveName}\n`).status).not.toBe(0);
      expect(checkEntries(`${validEntries}${'c'.repeat(64)}  release-manifest.json\n`).status).not.toBe(0);

      const manifestPredicate = manifestBinding.match(/jq -e --arg repository "\$GITHUB_REPOSITORY" --arg version "\$VERSION"[\s\S]*?'\n([\s\S]*?)\n\s*' release\/release-manifest\.json/);
      const manifestPolicy = manifestPredicate?.[1];
      if (!manifestPolicy) throw new Error('missing canary release manifest predicate');
      const trustedManifest = {
        schemaVersion: 'guardscan.release-manifest.v1',
        version: '1.2.3',
        tag: 'v1.2.3',
        commit: 'c'.repeat(40),
        producer: {
          provider: 'github-actions', repository: 'ntanwir10/GuardScan',
          workflow: '.github/workflows/release-build.yml', workflowSha: 'a'.repeat(40), runId: '123',
          runAttempt: 2, sourceRef: 'refs/tags/v1.2.3',
        },
        artifacts: [{
          filename: archiveName, kind: 'standalone', sha256: digest,
          source: {version: '1.2.3', tag: 'v1.2.3', commit: 'c'.repeat(40)},
        }],
      };
      const checkManifest = (manifest: Record<string, unknown>) => spawnSync('jq', [
        '-e', '--arg', 'repository', 'ntanwir10/GuardScan', '--arg', 'version', '1.2.3',
        '--arg', 'archive', archiveName, '--arg', 'archive_sha', digest,
        '--arg', 'run_id', '123', '--arg', 'attempt', '2', '--arg', 'tag_sha', 'c'.repeat(40),
        '--arg', 'workflow_sha', 'a'.repeat(40),
        manifestPolicy,
      ], {input: JSON.stringify(manifest), encoding: 'utf8'});
      expect(checkManifest(trustedManifest).status).toBe(0);
      expect(checkManifest({...trustedManifest, version: '1.2.4'}).status).not.toBe(0);
      expect(checkManifest({...trustedManifest, producer: {...trustedManifest.producer, workflowSha: 'b'.repeat(40)}}).status).not.toBe(0);
      expect(checkManifest({...trustedManifest, artifacts: [{...trustedManifest.artifacts[0], filename: 'other.tar.gz'}]}).status).not.toBe(0);
      expect(checkManifest({...trustedManifest, artifacts: [
        trustedManifest.artifacts[0], trustedManifest.artifacts[0],
      ]}).status).not.toBe(0);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }

    const apiStep = steps[verifyIdentity];
    const predicate = apiStep.run.match(/jq -e --arg repository[\s\S]*?--arg run_id[\s\S]*?'\n([\s\S]*?)\n\s*' <<< "\$BUILD_RUN"/);
    expect(predicate).toBeTruthy();
    const runPolicy = predicate[1];
    const trustedRun = {
      path: '.github/workflows/release-train.yml@refs/heads/main',
      event: 'workflow_dispatch',
      head_branch: 'main',
      repository: {full_name: 'ntanwir10/GuardScan'},
      head_repository: {full_name: 'ntanwir10/GuardScan'},
      id: 123,
      run_attempt: 2,
      head_sha: 'a'.repeat(40),
    };
    const checkRun = (metadata: Record<string, unknown>) => spawnSync('jq', [
      '-e', '--arg', 'repository', 'ntanwir10/GuardScan', '--arg', 'run_id', '123',
      '--arg', 'attempt', '2', runPolicy,
    ], {input: JSON.stringify(metadata), encoding: 'utf8'});
    const valid = checkRun(trustedRun);
    expect(valid.error).toBeUndefined();
    expect(valid.status).toBe(0);
    for (const malicious of [
      {...trustedRun, event: 'pull_request'},
      {...trustedRun, path: '.github/workflows/attacker.yml@refs/heads/main'},
      {...trustedRun, head_branch: 'release/1.2.3'},
      {...trustedRun, head_repository: {full_name: 'attacker/GuardScan'}},
      {...trustedRun, id: 456},
      {...trustedRun, id: undefined, run_id: 123},
      {...trustedRun, run_attempt: 3},
      {...trustedRun, head_sha: 'not-a-commit'},
    ]) {
      const rejected = checkRun(malicious);
      expect(rejected.error).toBeUndefined();
      expect(rejected.status).not.toBe(0);
    }
  });

  it.each(['release-canary.yml', 'release-publish.yml'])(
    'validates the REST run-attempt id in %s',
    filename => {
      const parsed = workflow(filename);
      const identity = (Object.values(parsed.jobs) as any[])
        .flatMap(job => job.steps || [])
        .find(candidate => candidate.run?.includes('BUILD_RUN="$(gh api'));
      const predicate = identity?.run.match(
        /jq -e --arg repository[\s\S]*?--arg run_id[\s\S]*?'\n([\s\S]*?)\n\s*' <<< "\$BUILD_RUN"/
      )?.[1];
      expect(predicate).toBeTruthy();
      const trustedRun = {
        id: 123,
        run_attempt: 2,
        path: '.github/workflows/release-train.yml',
        event: 'workflow_dispatch',
        head_branch: 'main',
        head_sha: 'a'.repeat(40),
        repository: {full_name: 'ntanwir10/GuardScan'},
        head_repository: {full_name: 'ntanwir10/GuardScan'},
      };
      const check = (metadata: Record<string, unknown>) => spawnSync('jq', [
        '-e', '--arg', 'repository', 'ntanwir10/GuardScan',
        '--arg', 'run_id', '123', '--arg', 'attempt', '2', predicate,
      ], {input: JSON.stringify(metadata), encoding: 'utf8'});
      const valid = check(trustedRun);
      expect(valid.error).toBeUndefined();
      expect(valid.status).toBe(0);
      for (const invalid of [
        {...trustedRun, id: 456, run_id: 123},
        {...trustedRun, id: undefined, run_id: 123},
        {...trustedRun, run_attempt: 3},
      ]) {
        const rejected = check(invalid);
        expect(rejected.error).toBeUndefined();
        expect(rejected.status).not.toBe(0);
      }
    }
  );

  it('pins npm for trusted OIDC publishing and fails closed on reused release channel drift', () => {
    const publish = workflow('release-publish.yml');
    const npm = publish.jobs.npm;
    const setupNode = npm.steps.find((candidate: any) => candidate.uses?.startsWith('actions/setup-node@'));
    expect(setupNode).toBeTruthy();
    expect(publish.env.RELEASE_NPM_VERSION).toBe('11.21.0');
    const npmInstall = step(npm, 'Install OIDC-compatible npm');
    expect(npmInstall.run).toContain('npm install --global "npm@${RELEASE_NPM_VERSION}"');
    expect(npmInstall.run).toContain('test "$(npm --version)" = "$RELEASE_NPM_VERSION"');
    expect(JSON.stringify(npm.steps)).not.toMatch(/_authToken|NODE_AUTH_TOKEN|--token/);

    const github = publish.jobs.github;
    const reuse = step(github, 'Create or reuse draft and upload only missing identical assets');
    expect(reuse.run).toContain('--json isDraft,isPrerelease');
    expect(reuse.run).toContain('EXPECTED_PRERELEASE');
    expect(reuse.run).toContain('Release channel mismatch');
  });

  it('serializes every release-ledger writer without cancelling queued writers', () => {
    const canary = workflow('release-canary.yml');
    const train = workflow('release-train.yml');
    const writerJobs = [
      canary.jobs.record,
      train.jobs.prepare,
      train.jobs.record,
      train.jobs.rollback,
    ];
    expect(writerJobs).toHaveLength(4);
    for (const job of writerJobs) {
      expect(job.concurrency).toEqual({
        group: 'release-ledger',
        queue: 'max',
        'cancel-in-progress': false,
      });
    }
  });

  it('records each canary train using trusted tooling, its immutable tag and only its own reports', () => {
    const canary = workflow('release-canary.yml');
    const discover = canary.jobs.discover;
    expect(discover.outputs).not.toHaveProperty('implementation_ref');

    const record = canary.jobs.record;
    expect(record.strategy.matrix.train).toBe('${{ fromJSON(needs.discover.outputs.trains) }}');
    expect(record.if).toContain("needs.discover.outputs.trains != '[]'");
    expect(step(record, 'Checkout exact train implementation').with.ref).toBe('${{ github.workflow_sha }}');
    expect(step(record, 'Download this train reports').with.pattern)
      .toBe('canary-${{ matrix.train.version }}-*');
    const append = step(record, 'Append hash-chained canary and verification events');
    expect(append.env.TRAIN_VERSION).toBe('${{ matrix.train.version }}');
    expect(append.run).toContain('report.version === process.env.TRAIN_VERSION');
    expect(append.run).toContain('commit !== checkoutCommit');
    expect(append.run).toContain("['rev-list', '-n', '1', tag]");
    expect(append.run).toContain('refs/tags/v$TRAIN_VERSION:refs/tags/v$TRAIN_VERSION');
  });

  it('authorizes release source PR metadata before checking out or mutating a ref', () => {
    const train = workflow('release-train.yml');
    const prepare = train.jobs.prepare;
    const validate = step(prepare, 'Validate request and resolve unchanged release PR head');
    expect(prepare.env.REQUEST_RELEASE_PR).toBe('${{ inputs.release_pr }}');
    expect(validate.run).toContain('gh api "repos/${GITHUB_REPOSITORY}/pulls/$REQUEST_RELEASE_PR" > release-pr.json');
    expect(validate.run).toContain("pr.state !== 'open' && !resumableMergedPromotion");
    expect(validate.run).toContain("pr.base?.ref !== 'main'");
    expect(validate.run).toContain('pr.head?.repo?.full_name?.toLowerCase()');
    expect(validate.run).toContain('`release/${baseVersion}`');
    expect(validate.run).toContain("/^[a-f0-9]{40}$/.test(pr.head?.sha || '')");
    const checkout = prepare.steps.find((candidate: any) => candidate.uses?.startsWith('actions/checkout@')
      && candidate.with?.ref === '${{ steps.source.outputs.head_sha }}');
    expect(checkout).toBeTruthy();
    expect(prepare.steps.indexOf(validate)).toBeLessThan(prepare.steps.indexOf(checkout));
  });

  it('reuses a stable tag only when its peeled commit is the exact merged PR commit', () => {
    const train = workflow('release-train.yml');
    const stable = step(train.jobs.prepare, 'Auto-merge unchanged stable release PR and create stable tag');
    expect(stable.env.EXPECTED_HEAD).toBe('${{ steps.source.outputs.head_sha }}');
    expect(stable.run).toContain('--match-head-commit "$EXPECTED_HEAD"');
    expect(stable.run).toContain('git ls-remote --exit-code');
    expect(stable.run).toContain('git rev-list -n 1');
    expect(stable.run).toContain('EXISTING_TAG_SHA" != "$MERGE_SHA"');
    expect(stable.run.indexOf('EXISTING_TAG_SHA" != "$MERGE_SHA"'))
      .toBeLessThan(stable.run.indexOf('push origin "refs/tags/'));
    expect(stable.run).toContain('TAG_PUSH_REQUIRED=false');
    expect(stable.run).toContain('TAG_PUSH_REQUIRED=true');
  });

  it('retains existing stable tags and creates/pushes only when the remote tag is absent', () => {
    const train = workflow('release-train.yml');
    const stable = step(train.jobs.prepare, 'Auto-merge unchanged stable release PR and create stable tag');
    const start = stable.run.indexOf('TAG_REF=');
    const end = stable.run.indexOf('echo "ref=$MERGE_SHA"');
    const script = stable.run.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-stable-tag-'));
    const bin = path.join(root, 'bin');
    const calls = path.join(root, 'git.calls');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), [
      '#!/bin/sh',
      'while [ "$1" = -c ]; do shift 2; done',
      'printf "%s\\n" "$*" >> "$GIT_CALLS"',
      'case "$1" in',
      '  ls-remote) case "$TAG_MODE" in',
      '    annotated) printf "%s\\trefs/tags/v1.2.3\\n%s\\trefs/tags/v1.2.3^{}\\n" "$TAG_OBJECT" "$MERGE_SHA" ;;',
      '    lightweight) printf "%s\\trefs/tags/v1.2.3\\n" "$MERGE_SHA" ;;',
      '    mismatch) printf "%s\\trefs/tags/v1.2.3\\n" "$WRONG_SHA" ;;',
      '    absent) exit 2 ;;',
      '    api-error) exit 128 ;;',
      '  esac ;;',
      '  rev-parse) [ "$LOCAL_TAG" = true ] ;;',
      '  rev-list) printf "%s\\n" "${LOCAL_SHA:-$MERGE_SHA}" ;;',
      '  tag|push) exit 0 ;;',
      '  *) exit 0 ;;',
      'esac',
    ].join('\n'), {mode: 0o700});

    const run = (tagMode: string, extra: Record<string, string> = {}) => spawnSync(
      'bash', ['-euo', 'pipefail', '-c', 'GIT_CALLS="$PWD/git.calls"; git() { sh ./bin/git "$@"; };\n' + script], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          GIT_CALLS: calls,
          TAG_MODE: tagMode,
          TAG_OBJECT: 'b'.repeat(40),
          MERGE_SHA: 'a'.repeat(40),
          STABLE_VERSION: '1.2.3',
          RELEASE_APP_TOKEN: 'test-token',
          WRONG_SHA: 'c'.repeat(40),
          LOCAL_TAG: 'false',
          ...extra,
        },
      }
    );
    const callLog = () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
    const reset = () => { if (fs.existsSync(calls)) fs.rmSync(calls); };

    try {
      for (const existing of ['annotated', 'lightweight']) {
        reset();
        const result = run(existing);
        expect(result.error).toBeUndefined();
        if (result.status !== 0) throw new Error(result.stderr || result.stdout);
        expect(callLog()).not.toMatch(/^tag /m);
        expect(callLog()).not.toMatch(/^push /m);
      }

      for (const invalid of ['mismatch', 'api-error']) {
        reset();
        const result = run(invalid);
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(callLog()).not.toMatch(/^push /m);
      }

      reset();
      const absent = run('absent');
      expect(absent.error).toBeUndefined();
      expect(absent.status).toBe(0);
      expect(callLog()).toMatch(/^tag v1\.2\.3 /m);
      expect(callLog()).toMatch(/^push origin refs\/tags\/v1\.2\.3$/m);

      reset();
      const localMismatch = run('absent', {LOCAL_TAG: 'true', LOCAL_SHA: 'c'.repeat(40)});
      expect(localMismatch.error).toBeUndefined();
      expect(localMismatch.status).not.toBe(0);
      expect(callLog()).not.toMatch(/^push /m);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('prepares WinGet local-manifest installation and submits only the version leaf', () => {
    const publish = workflow('release-publish.yml');
    const winget = publish.jobs.winget;
    const local = step(winget, 'Validate and install WinGet local manifest');
    expect(local.run).toContain('winget settings --enable LocalManifestFiles');
    expect(local.run.indexOf('winget settings --enable LocalManifestFiles'))
      .toBeLessThan(local.run.indexOf('winget install --manifest'));
    expect(local.run).toContain("if ($LASTEXITCODE -ne 0) { throw 'WinGet local manifest setting failed' }");
    const submit = step(winget, 'Preflight and submit WinGet manifests with exact evidence');
    expect(submit.run).toContain('$manifestDirectory = $installer.Directory.FullName');
    expect(submit.run).toContain('Get-ChildItem $manifestDirectory -File');
    expect(submit.run).toContain('cli/scripts/release/winget-submission.js');
    expect(submit.run).toContain('& .\\wingetcreate.exe submit --prtitle');
    expect(submit.run).toContain('--token $env:WINGET_GITHUB_TOKEN $manifestDirectory');
    expect(submit.run.indexOf("throw 'Pinned wingetcreate executable failed SHA-256 verification'"))
      .toBeLessThan(submit.run.indexOf('& .\\wingetcreate.exe submit'));
    expect(submit.run).not.toContain('wingetcreate submit adapters\\winget ');
  });

  it('initializes Linux Homebrew and exercises preview formulas through the tap identifier', () => {
    const canary = workflow('release-canary.yml');
    const brew = step(canary.jobs.adapters, 'Homebrew install, test, upgrade check, and uninstall');
    expect(brew.run).toContain('brew shellenv');
    expect(brew.run.indexOf('brew shellenv')).toBeLessThan(brew.run.indexOf('brew tap'));
    expect(brew.run).toContain('brew tap --custom-remote ntanwir10/tap');
    expect(brew.run).toContain('brew style ntanwir10/tap/guardscan');
    expect(brew.run).toContain('brew audit --strict ntanwir10/tap/guardscan');
    expect(brew.run).toContain('brew install ntanwir10/tap/guardscan');
    expect(brew.run).not.toContain('brew install --formula preview-tap/Formula/guardscan.rb');
  });

  it('configures Scoop admin installs and exposes shims before adding a bucket', () => {
    const canary = workflow('release-canary.yml');
    const scoop = step(canary.jobs.adapters, 'Scoop install, update check, invocation, and uninstall');
    expect(scoop.run).toContain('scoop config installRunAsAdmin true');
    expect(scoop.run).toContain("Join-Path $scoopRoot 'shims'");
    expect(scoop.run.indexOf("Join-Path $scoopRoot 'shims'")).toBeLessThan(scoop.run.indexOf('scoop bucket add'));
  });

  it('normalizes only explicit moderated-channel not-public responses and requires exact Chocolatey version evidence', () => {
    const canary = workflow('release-canary.yml');
    const moderated = step(canary.jobs.moderated, 'Poll, install, invoke, and uninstall public moderated channels');
    expect(moderated.run).toContain('$notPublic');
    expect(moderated.run).toContain("$report.status = 'pending'");
    expect(moderated.run).toContain("$report.reason = 'not_public'");
    expect(moderated.run).toContain('Unexpected moderated registry error:');
    expect(moderated.run).toContain('choco info guardscan --exact --version');
    expect(moderated.run).toContain('$exactVersion');
    expect(moderated.run).toContain('$LASTEXITCODE');
  });
});


describe('release review recovery contracts', () => {
  it('binds reusable callee signer provenance only in supported step contexts', () => {
    const build = workflow('release-build.yml');
    let readers = 0;
    for (const job of Object.values(build.jobs) as any[]) {
      expect(JSON.stringify(job.env || {})).not.toContain('job.workflow_sha');
      for (const candidate of job.steps || []) {
        if (candidate.run?.includes('RELEASE_BUILD_WORKFLOW_SHA')) {
          expect(candidate.env?.RELEASE_BUILD_WORKFLOW_SHA).toBe('${{ job.workflow_sha }}');
          readers++;
        }
        if (candidate.env?.SIGNER_WORKFLOW_SHA) {
          expect(candidate.env.SIGNER_WORKFLOW_SHA).toBe('${{ job.workflow_sha }}');
          readers++;
        }
      }
    }
    expect(readers).toBe(7);
  });

  it('declares and forwards exactly the publication secrets its consumers need', () => {
    const publish = workflow('release-publish.yml');
    const caller = workflow('release-train.yml').jobs.publish;
    const inventory = ['RELEASE_APP_PRIVATE_KEY', 'WINGET_CREATE_GITHUB_TOKEN', 'WINGET_GITHUB_TOKEN', 'CHOCO_API_KEY'];
    expect(Object.keys(publish.on.workflow_call.secrets).sort()).toEqual(inventory.sort());
    expect(Object.keys(caller.secrets).sort()).toEqual(inventory.sort());
    expect(publish.on.workflow_call.secrets.RELEASE_APP_PRIVATE_KEY.required).toBe(true);
    for (const secret of inventory) expect(caller.secrets[secret]).toBe('${{ secrets.' + secret + ' }}');
  });

  it('authenticates the final canary ledger push without checkout credentials', () => {
    const record = workflow('release-canary.yml').jobs.record;
    const push = record.steps.find((candidate: any) => candidate.run?.includes('push origin HEAD:release-ledger'));
    expect(push.run).toMatch(/git -c credential.helper= -c 'credential.https:\/\/github.com.helper=!gh auth git-credential'\s+push origin HEAD:release-ledger/);
    expect(push.run).toContain('export GH_TOKEN="$RELEASE_APP_TOKEN"');
  });

  it('publishes recovered payloads only after both direct prerequisites succeed and without cancellation', () => {
    const publish = workflow('release-train.yml').jobs.publish;
    expect(publish.needs).toEqual(['prepare', 'payload-ready']);
    const condition = publish.if.replace(/\s+/g, ' ').trim();
    expect(condition).toContain('always()');
    expect(condition).toContain('!cancelled()');
    for (const prepare of ['success', 'failure', 'cancelled', 'skipped']) {
      for (const payload of ['success', 'failure', 'cancelled', 'skipped']) {
        for (const cancelled of [false, true]) {
          const expression = condition.replace(/always\(\)/g, 'true')
            .replace(/cancelled\(\)/g, String(cancelled))
            .replace(/vars.RELEASE_AUTOMATION_ENABLED/g, "'true'")
            .replace(/needs.prepare.outputs.build/g, "'true'")
            .replace(/needs.prepare.result/g, JSON.stringify(prepare))
            .replace(/needs.payload-ready.result/g, JSON.stringify(payload));
          expect(Function('return (' + expression + ')')()).toBe(!cancelled && prepare === 'success' && payload === 'success');
        }
      }
    }
  });

  it('compares catalog path inventories in byte order in both writers', () => {
    for (const filename of ['release-train.yml', 'release-publish.yml']) {
      const source = fs.readFileSync(path.join(workflowRoot, filename), 'utf8');
      expect(source).toMatch(/CHANGED_PATHS="\$\(git[^\n]*diff --name-only origin\/main\.\.\.HEAD \| LC_ALL=C sort\)"/);
    }
  });
});

describe('immutable partial checkpoint workflow routing', () => {
  it('routes only one exact canonical asset to partial recovery and rejects unknown checkpoint names', () => {
    const job = workflow('release-train.yml').jobs['resolve-checkpoint'];
    const classify = step(job, 'Classify remote checkpoint state').run.match(/node - <<'NODE'\n([\s\S]*?)\nNODE/)[1];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-checkpoint-classify-'));
    const archive = 'guardscan-release-checkpoint-1.1.0.tar.gz';
    const sidecar = archive + '.metadata.json';
    const check = (names: string[], draft = true) => {
      fs.writeFileSync(path.join(root, 'release-state.json'), JSON.stringify({draft, assets: names.map(name => ({name}))}));
      const output = path.join(root, 'output');
      fs.writeFileSync(output, '');
      const result = spawnSync(process.execPath, ['-e', classify], {cwd: root, encoding: 'utf8',
        env: {...process.env, ARCHIVE: archive, SIDECAR: sidecar, GITHUB_OUTPUT: output}});
      return {status: result.status, mode: fs.readFileSync(output, 'utf8').trim()};
    };
    try {
      expect(check([])).toEqual({status: 0, mode: 'mode=build'});
      expect(check([archive])).toEqual({status: 0, mode: 'mode=partial'});
      expect(check([sidecar])).toEqual({status: 0, mode: 'mode=partial'});
      expect(check([archive, sidecar])).toEqual({status: 0, mode: 'mode=checkpoint'});
      expect(check([archive, 'release-manifest.json']).mode).toBe('mode=expanded');
      expect(check([archive, archive]).mode).not.toBe('mode=partial');
      expect(check([archive], false).status).not.toBe(0);
      expect(check([archive + '.unexpected']).status).not.toBe(0);
      expect(check([archive, sidecar, archive + '.unexpected']).status).not.toBe(0);
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });

  it('persists the canonical checkpoint pair before any remote upload and protects partial repairs', () => {
    const train = workflow('release-train.yml');
    const checkpoint = train.jobs.checkpoint.steps;
    const canonical = checkpoint.findIndex((candidate: any) => candidate.name === 'Persist canonical checkpoint pair before remote upload');
    const upload = checkpoint.findIndex((candidate: any) => candidate.run?.includes('gh release upload'));
    expect(canonical).toBeGreaterThan(0);
    expect(canonical).toBeLessThan(upload);
    expect(checkpoint[canonical].with.name).toBe('release-checkpoint-${{ needs.prepare.outputs.tag }}');
    expect(checkpoint[canonical].with['retention-days']).toBe(90);
    expect(checkpoint[canonical].with.overwrite).toBeUndefined();
    const resolve = train.jobs['resolve-checkpoint'];
    expect(resolve.permissions).toEqual({actions: 'read', contents: 'write'});
    expect(resolve.environment).toContain("'release-rc' || 'release-stable'");
    const repair = step(resolve, 'Resume an authenticated partial checkpoint without replacing existing bytes');
    expect(repair.if).toBe("steps.remote.outputs.mode == 'partial'");
    expect(repair.run).toContain('node .github/scripts/resume-release-checkpoint.js');
  });

  it('flattens complete review history with CLI-compatible pagination for all four authorization snapshots', () => {
    const snapshots = [workflow('release-train.yml').jobs.prepare, workflow('release-provider-rehearsal.yml').jobs.validate]
      .flatMap(job => job.steps).filter(candidate => candidate.run?.includes('cli/scripts/release/index.js validate-pr'));
    const fetches = snapshots.map(candidate => candidate.run.replace(/\\\n\s*/g, ' ').split('\n')
      .find((line: string) => line.includes('/reviews?per_page=100')));
    expect(fetches).toHaveLength(4);
    const metadata = {id: 1, state: 'APPROVED', commit_id: 'a'.repeat(40), author_association: 'OWNER',
      submitted_at: '2026-11-05T00:00:00Z', user: {login: 'maintainer'}};
    const expanded = {...metadata, body: 'long review body'.repeat(10000), html_url: 'https://example.test/review',
      user: {...metadata.user, avatar_url: 'https://example.test/avatar', links: {}}};
    const later = {...expanded, id: 101, state: 'CHANGES_REQUESTED', submitted_at: '2026-11-05T00:01:00Z'};
    const pending = {state: 'PENDING', commit_id: null, submitted_at: null};
    const pages = [Array.from({length: 100}, (_, index) => ({...expanded, id: index + 1, ...(index === 0 ? pending : {})})), [later]];
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-review-pages-'));
    try {
      fs.writeFileSync(path.join(root, 'pages.json'), JSON.stringify(pages));
      fs.writeFileSync(path.join(root, 'gh'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] !== 'api' || !args.includes('--paginate') || !args.includes('--slurp')) process.exit(2);
if (args.includes('--jq') || args.includes('--template')) {
  process.stderr.write('slurp option is not supported with jq or template'); process.exit(3);
}
process.stdout.write(fs.readFileSync(process.env.REVIEW_PAGES, 'utf8'));
`, {mode: 0o755});
      for (const fetch of fetches) {
        const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', fetch], {cwd: root, encoding: 'utf8',
          env: {...process.env, PATH: root + path.delimiter + process.env.PATH, REVIEW_PAGES: path.join(root, 'pages.json'),
            GITHUB_REPOSITORY: 'ntanwir10/GuardScan', REQUEST_RELEASE_PR: '42'}});
        expect({status: result.status, stderr: result.stderr}).toEqual({status: 0, stderr: ''});
        const file = fetch.match(/>\s*(release-[A-Za-z-]+\.json)\s*$/)[1];
        const output = fs.readFileSync(path.join(root, file), 'utf8');
        expect(JSON.parse(output)).toEqual([
          ...Array.from({length: 100}, (_, index) => ({...metadata, id: index + 1, ...(index === 0 ? pending : {})})),
          {...metadata, id: 101, state: 'CHANGES_REQUESTED', submitted_at: later.submitted_at},
        ]);
        expect(Buffer.byteLength(output)).toBeLessThan(128 * 1024);
      }
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });

  it('preserves check-run App identity in every authorization evidence projection', () => {
    const snapshots = [workflow('release-train.yml').jobs.prepare, workflow('release-provider-rehearsal.yml').jobs.validate]
      .flatMap(job => job.steps).filter(candidate => candidate.run?.includes('cli/scripts/release/index.js validate-pr'));
    expect(snapshots).toHaveLength(4);
    const check = {name: 'Release gate', head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'success',
      app: {id: 15368, slug: 'github-actions'}};
    for (const candidate of snapshots) {
      const fetch = candidate.run.replace(/\\\n\s*/g, ' ').split('\n')
        .find((line: string) => line.includes('/check-runs?per_page=100'));
      const projection = fetch.match(/--jq '([^']+)'/)[1];
      const result = spawnSync('jq', [projection], {input: JSON.stringify({check_runs: [check]}), encoding: 'utf8'});
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([check]);
    }
  });
});
