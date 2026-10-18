import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

const repository = path.resolve(__dirname, '../../..');
const load = (filename: string): any => yaml.load(
  fs.readFileSync(path.join(repository, '.github/workflows', filename), 'utf8')
);
const namedStep = (job: any, name: string): any => {
  const found = job.steps.find((candidate: any) => candidate.name === name);
  if (!found) throw new Error('missing workflow step: ' + name);
  return found;
};

describe('release workflow safety', () => {
  it('keeps release side effects behind the existing disabled-by-default repository switch', () => {
    const guard = "vars.RELEASE_AUTOMATION_ENABLED == 'true'";
    const train = load('release-train.yml');
    for (const job of Object.values(train.jobs) as any[]) expect(job.if).toContain(guard);
    expect(load('release-build.yml').jobs.quality.if).toBe(guard);
    expect(load('release-publish.yml').jobs.github.if).toBe(guard);
    expect(load('release-please.yml').jobs['release-pr'].if).toContain(guard);
    const canary = load('release-canary.yml');
    expect(canary.jobs.discover.if).toContain(guard);
    expect(canary.jobs.record.if).toContain(guard);
    expect(canary.jobs.record.if).toContain("needs.discover.result == 'success'");
  });

  it('installs pinned Scoop with admin support before the canary uses it', () => {
    const adapters = load('release-canary.yml').jobs.adapters;
    const setup = namedStep(adapters, 'Install Scoop for adapter canary');
    const exercise = namedStep(adapters, 'Scoop install, update check, invocation, and uninstall');
    expect(adapters.steps.indexOf(setup)).toBeLessThan(adapters.steps.indexOf(exercise));
    expect(setup.if).toBe("matrix.adapter == 'scoop'");
    expect(setup.run).toMatch(/ScoopInstaller\/Install\/[a-f0-9]{40}\/install\.ps1/);
    expect(setup.run).toContain('-RunAsAdmin');
    expect(setup.run).toContain('$LASTEXITCODE');
    expect(setup.run).toContain('GITHUB_PATH');
  });

  it('normalizes the source timestamp once for every native builder', () => {
    const native = load('release-build.yml').jobs.native;
    const timestamp = namedStep(native, 'Resolve canonical native build timestamp');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-source-time-'));
    try {
      const envFile = path.join(root, 'environment');
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', timestamp.run], {
        cwd: repository, encoding: 'utf8',
        env: {...process.env, SOURCE_REF: 'HEAD', GITHUB_ENV: envFile},
      });
      expect(result.error).toBeUndefined();
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      const raw = spawnSync('git', ['show', '-s', '--format=%cI', 'HEAD'], {
        cwd: repository, encoding: 'utf8',
      });
      expect(raw.status).toBe(0);
      expect(fs.readFileSync(envFile, 'utf8')).toBe(
        'SOURCE_TIMESTAMP=' + new Date(raw.stdout.trim()).toISOString() + '\n'
      );
      for (const name of [
        'Generate executable SPDX and CycloneDX SBOMs',
        'Archive signed executable deterministically',
        'Build wheel containing the exact signed executable',
      ]) {
        const builder = namedStep(native, name);
        expect(native.steps.indexOf(timestamp)).toBeLessThan(native.steps.indexOf(builder));
        expect(builder.run).toContain('--timestamp "$SOURCE_TIMESTAMP"');
        expect(builder.run).not.toContain('--timestamp "$(git show');
      }
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('signs the SEA with minimal JIT entitlements and exercises it after signing', () => {
    const signing = namedStep(
      load('release-build.yml').jobs.native,
      'Sign, notarize, staple, and verify macOS executable'
    ).run as string;
    expect(signing).toContain('--entitlements .github/release/macos-entitlements.plist');
    expect(signing).toContain('standalone/guardscan --version');
    expect(signing.indexOf('--entitlements')).toBeLessThan(signing.indexOf('standalone/guardscan --version'));
    expect(signing.indexOf('standalone/guardscan --version')).toBeLessThan(signing.indexOf('notarytool submit'));
    const entitlements = fs.readFileSync(
      path.join(repository, '.github/release/macos-entitlements.plist'), 'utf8'
    );
    expect(entitlements).toContain('<key>com.apple.security.cs.allow-jit</key><true/>');
    expect(entitlements).toContain('<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>');
    expect(entitlements).not.toMatch(/disable-library-validation|get-task-allow/);
  });

  it('assesses the signed stapled DMG and binds the canary to its exact executable', () => {
    const build = load('release-build.yml');
    const signing = namedStep(
      build.jobs.native, 'Sign, notarize, staple, and verify macOS executable'
    ).run as string;
    expect(signing).not.toContain('spctl --assess --type execute');
    expect(signing).toContain('spctl --assess --type open');
    expect(signing).toMatch(/codesign[^\n]+guardscan-notarization\.dmg/);
    expect(namedStep(build.jobs.native, 'Archive signed executable deterministically').run)
      .toContain("'stapled-notarization.dmg'");
    expect(JSON.stringify(build.jobs.aggregate.steps)).toContain("*.dmg");
    const canary = namedStep(load('release-canary.yml').jobs['native-and-pypi'],
      'Verify macOS signing and Gatekeeper').run as string;
    expect(canary).not.toContain('spctl --assess --type execute');
    for (const required of [
      '$TARGET.stapled-notarization.dmg', 'ENTRY_COUNT', 'sha256sum --check',
      'stapler validate', 'spctl --assess --type open',
      'hdiutil attach', 'hdiutil detach', 'cmp "$MOUNT_POINT/guardscan" executable/guardscan',
    ]) expect(canary).toContain(required);
    expect(canary.indexOf('sha256sum --check')).toBeLessThan(canary.indexOf('hdiutil attach'));
  });

  it('accepts exact Release Please and legacy release branches without a wildcard trust expansion', () => {
    const run = namedStep(load('release-train.yml').jobs.prepare,
      'Validate request and resolve unchanged release PR head').run as string;
    expect(run).toContain('release-please--branches--main');
    const predicate = run.match(/jq -e --arg repository[\s\S]*?'\n?([\s\S]*?)' <<< "\$PR_DETAILS"/)?.[1];
    expect(predicate).toBeTruthy();
    const check = (head: string, extra: Record<string, unknown> = {}) => spawnSync('jq', [
      '-e', '--arg', 'repository', 'ntanwir10/guardscan', '--arg', 'branch', 'release/1.2.3',
      '--arg', 'release_please_branch', 'release-please--branches--main', predicate!,
    ], {input: JSON.stringify({
      state: 'OPEN', baseRefName: 'main', headRefName: head, headRefOid: 'a'.repeat(40),
      headRepository: {nameWithOwner: 'ntanwir10/GuardScan'}, ...extra,
    }), encoding: 'utf8'});
    for (const branch of ['release/1.2.3', 'release-please--branches--main']) {
      expect(check(branch).status).toBe(0);
    }
    for (const branch of ['release/1.2.4', 'release-please--branches--main--attacker', 'feature/unsafe']) {
      expect(check(branch).status).not.toBe(0);
    }
    expect(check('release-please--branches--main', {headRepository: {nameWithOwner: 'attacker/GuardScan'}}).status)
      .not.toBe(0);
  });

  it('requires visible matching npm bytes and tag, allowing bounded propagation retries', () => {
    const verification = namedStep(load('release-publish.yml').jobs.npm, 'Verify public registry integrity');
    const script = verification.run.split('${{ inputs.channel }}').join('stable');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-npm-post-publish-'));
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', {mode: 0o700});
    fs.writeFileSync(path.join(bin, 'npm'), [
      '#!/bin/sh',
      'count=0; test ! -f "$RUNNER_TEMP/count" || count=$(cat "$RUNNER_TEMP/count")',
      'count=$((count + 1)); printf "%s" "$count" > "$RUNNER_TEMP/count"',
      'published=false; matching=true; drift=false',
      'if [ "$NPM_MODE" = missing ] || { [ "$NPM_MODE" = propagate ] && [ "$count" -lt 2 ]; }; then published=true; matching=false; fi',
      'if [ "$NPM_MODE" = drift ]; then drift=true; fi',
      'printf "publish-required=%s\\nmatching=%s\\ndist-tag-repair-required=%s\\n" "$published" "$matching" "$drift" >> "$RUNNER_TEMP/npm-preflight-output"',
    ].join('\n'), {mode: 0o700});
    const run = (mode: string) => {
      for (const name of ['count', 'npm-preflight-output']) fs.rmSync(path.join(root, name), {force: true});
      return spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
        cwd: root, encoding: 'utf8', timeout: 10000,
        env: {...process.env, PATH: bin + path.delimiter + process.env.PATH,
          RUNNER_TEMP: root, NPM_MODE: mode},
      });
    };
    try {
      expect(run('matching').status).toBe(0);
      expect(run('missing').status).not.toBe(0);
      expect(run('drift').status).not.toBe(0);
      expect(run('propagate').status).toBe(0);
      expect(Number(fs.readFileSync(path.join(root, 'count'), 'utf8'))).toBeGreaterThan(1);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('configures app-token Git authentication before cloning or pushing adapter repositories', () => {
    const publication = namedStep(load('release-publish.yml').jobs.adapters,
      'Push deterministic adapter branches and open PRs');
    expect(publication.run).toContain('gh auth setup-git --hostname github.com');
    expect(publication.run.indexOf('gh auth setup-git')).toBeLessThan(publication.run.indexOf('gh repo clone'));
    expect(publication.env.GH_TOKEN).toBe('${{ steps.app.outputs.token }}');
  });

  it('does not dispatch repeated promotion attempts before the publication soak expires', () => {
    const promotion = namedStep(load('release-train.yml').jobs.reconcile,
      'Trigger promotion when the machine policy is eligible').run as string;
    const script = promotion.match(/node - <<'NODE'\n([\s\S]*?)\nNODE/)?.[1];
    expect(script).toBeTruthy();
    const publishedAt = Date.parse('2026-10-01T00:00:00.000Z');
    const canaries = Object.fromEntries(['npm', 'pnpm', 'yarn', 'bun', 'github', 'homebrew', 'scoop', 'pypi']
      .map(channel => [channel, Array.from({length: 24}, () => ({status: 'passed'}))]));
    const evaluate = (now: number, published = true) => {
      let output = '';
      vm.runInNewContext(script!, {
        require: () => ({
          readEvents: () => published ? [{
            type: 'channel_published', channel: 'github', timestamp: new Date(publishedAt).toISOString(),
          }] : [],
          materializeReleaseState: () => ({canaries, incidents: {}}),
        }),
        Date: {now: () => now, parse: Date.parse},
        process: {stdout: {write: (value: string) => { output += value; }}},
      });
      return output;
    };
    expect(evaluate(publishedAt + 23 * 60 * 60 * 1000)).toBe('false');
    expect(evaluate(publishedAt + 24 * 60 * 60 * 1000)).toBe('true');
    expect(evaluate(publishedAt + 48 * 60 * 60 * 1000, false)).toBe('false');
  });
});
