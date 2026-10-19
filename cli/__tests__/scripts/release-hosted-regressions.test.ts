import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

const repository = path.resolve(__dirname, '../../..');
const workflow = (name: string): any => yaml.load(fs.readFileSync(
  path.join(repository, '.github/workflows', name), 'utf8'
));
const step = (job: any, name: string): any => {
  const found = job.steps.find((item: any) => item.name === name);
  if (!found) throw new Error('Missing step: ' + name);
  return found;
};

describe('hosted release review regressions', () => {
  it('validates dispatch versions before credentials and never embeds dispatch input in shell source', () => {
    const train = workflow('release-train.yml');
    for (const key of ['prepare', 'reconcile', 'rollback']) {
      const job = train.jobs[key];
      const validation = step(job, 'Validate dispatch inputs');
      expect(job.steps.indexOf(validation)).toBe(0);
      const check = (version: string, knownGood = '') => spawnSync('bash', [
        '-euo', 'pipefail', '-c', validation.run,
      ], {encoding: 'utf8', env: {...process.env, RELEASE_VERSION: version, KNOWN_GOOD: knownGood}});
      for (const version of ['0.0.0', '1.2.3', '1.2.3-rc.1']) expect(check(version).status).toBe(0);
      for (const version of ['1.2.3; exit 0', '1.2.3-rc.1.extra', '01.2.3', '1.2.3+build', '$(exit 0)']) {
        expect(check(version).status).not.toBe(0);
        expect(check('1.2.3', version).status).not.toBe(0);
      }
      for (const item of job.steps) expect(item.run || '').not.toMatch(/\$\{\{\s*inputs\./);
    }
    const discover = step(workflow('release-canary.yml').jobs.discover, 'Load protected active-train index');
    expect(discover.env.REQUESTED_VERSION).toBe('${{ inputs.version }}');
    expect(discover.run).not.toContain('${{ inputs.version }}');
    expect(discover.run).toContain('Invalid canary release version');
    const script = discover.run.match(/node - <<'NODE'\n([\s\S]*?)\nNODE/)?.[1];
    expect(script).toBeTruthy();
    const discoverVersion = (version: string) => {
      let output = '';
      vm.runInNewContext(script!, {
        process: {env: {REQUESTED_VERSION: version}},
        require: () => ({writeFileSync: (_file: string, value: string) => { output = value; }}),
      });
      return JSON.parse(output);
    };
    expect(discoverVersion('1.2.3-rc.1').trains[0].channel).toBe('rc');
    for (const value of ['1.2.3\n', "1.2.3'; exit 0; '", '1.2.3-rc.01']) {
      expect(() => discoverVersion(value)).toThrow('Invalid canary release version');
    }
  });

  it('grants reusable callers the least union of callee permissions', () => {
    const train = workflow('release-train.yml');
    expect(train.jobs.build.permissions).toEqual({contents: 'read', 'id-token': 'write', attestations: 'write'});
    expect(train.jobs.publish.permissions).toEqual({contents: 'write', actions: 'read', 'id-token': 'write'});
    expect(train.permissions).toEqual({contents: 'read'});
  });

  it('installs dependencies and pinned Node before publication ledger imports', () => {
    for (const [file, name] of [
      ['release-train.yml', 'Fetch ledger, append chained events, and push'],
      ['release-canary.yml', 'Append hash-chained canary and verification events'],
    ]) {
      const job = workflow(file).jobs.record;
      const node = job.steps.findIndex((item: any) => item.uses?.startsWith('actions/setup-node@'));
      const install = job.steps.findIndex((item: any) => item.run === 'npm ci' && item['working-directory'] === 'cli');
      const append = job.steps.indexOf(step(job, name));
      expect(node).toBeGreaterThan(0);
      expect(job.steps[node].with['node-version']).toBe('${{ env.RELEASE_NODE_VERSION }}');
      expect(install).toBeGreaterThan(node);
      expect(append).toBeGreaterThan(install);
    }
  });

  it('refuses to tag an unsoaked merge tree even when the PR head and package version match', () => {
    const run = step(workflow('release-train.yml').jobs.prepare,
      'Auto-merge unchanged stable release PR and create stable tag').run as string;
    const start = run.indexOf('MERGE_TREE=');
    const end = run.indexOf('test "$(node -p');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const check = (headTree: string) => spawnSync('bash', ['-euo', 'pipefail', '-c',
      'git() { if [ "$2" = "merge^{tree}" ]; then printf "%s" "$MERGED_TREE"; else printf "%s" "$HEAD_TREE"; fi; };\n' + run.slice(start, end),
    ], {encoding: 'utf8', env: {...process.env, MERGE_SHA: 'merge', SOURCE_HEAD: 'head',
      MERGED_TREE: 'a'.repeat(40), HEAD_TREE: headTree}});
    expect(check('a'.repeat(40)).status).toBe(0);
    expect(check('b'.repeat(40)).status).not.toBe(0);
  });

  it('treats unchanged canary ledger retries as no-ops while propagating actual Git errors', () => {
    const run = step(workflow('release-canary.yml').jobs.record,
      'Append hash-chained canary and verification events').run as string;
    const start = run.indexOf('if git diff --cached --quiet; then');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = run.indexOf('\n)', start);
    const script = run.slice(start, end);
    const check = (diff: string, commit = '0') => spawnSync('bash', ['-euo', 'pipefail', '-c',
      'git() { case "$1" in diff) return "$DIFF_STATUS_FIXTURE" ;; commit) echo commit; return "$COMMIT_STATUS_FIXTURE" ;; push) echo push ;; esac; };\n' + script,
    ], {encoding: 'utf8', env: {...process.env, DIFF_STATUS_FIXTURE: diff,
      COMMIT_STATUS_FIXTURE: commit, GITHUB_RUN_ID: '123'}});
    expect(check('0').status).toBe(0);
    expect(check('0').stdout).not.toMatch(/commit|push/);
    expect(check('1').status).toBe(0);
    expect(check('1').stdout).toContain('commit');
    expect(check('1', '128').status).toBe(128);
    expect(check('1', '128').stdout).not.toContain('push');
    expect(check('128').status).toBe(128);
  });

  it('refreshes WinGet PATH and downloads a hash-pinned supported manifest creator', () => {
    const winget = workflow('release-publish.yml').jobs.winget;
    const install = step(winget, 'Validate and install WinGet local manifest').run as string;
    expect(install).toContain("[Environment]::GetEnvironmentVariable('Path', 'Machine')");
    expect(install).toContain("[Environment]::GetEnvironmentVariable('Path', 'User')");
    expect(install.indexOf('GetEnvironmentVariable')).toBeLessThan(install.indexOf('guardscan --version'));
    const submit = step(winget, 'Submit WinGet manifests').run as string;
    expect(submit).not.toContain('dotnet tool install');
    expect(submit).toMatch(/microsoft\/winget-create\/releases\/download\/v[0-9.]+\/wingetcreate.exe/);
    expect(submit).toContain('Get-FileHash');
    expect(submit).toMatch(/[a-f0-9]{64}/);
    expect(submit).toContain('WinGet submission failed');
  });

  it('checks Scoop lifecycle exit codes before recording success', () => {
    const run = step(workflow('release-canary.yml').jobs.adapters,
      'Scoop install, update check, invocation, and uninstall').run as string;
    for (const command of ['scoop install guardscan', 'scoop update guardscan', 'scoop uninstall guardscan']) {
      expect(run).toMatch(new RegExp(command + '\\r?\\n\\s*if \\(\\$LASTEXITCODE -ne 0\\)'));
    }
  });

  it('pins adapter merges and recovers already merged PR heads when branches were deleted', () => {
    const run = step(workflow('release-publish.yml').jobs.adapters,
      'Push deterministic adapter branches and open PRs').run as string;
    expect(run).toContain('--auto --squash --match-head-commit "$EXPECTED_HEAD"');
    expect(run.indexOf('PR_NUMBER=')).toBeLessThan(run.indexOf('git commit'));
    expect(run).toContain('git fetch origin "$EXPECTED_HEAD"');
    expect(run).toContain('git show "$EXPECTED_HEAD:$TARGET"');
  });

  it('retires prior stable trains without discarding unrelated RC trains', () => {
    const run = step(workflow('release-train.yml').jobs.record,
      'Fetch ledger, append chained events, and push').run as string;
    const scripts = [...run.matchAll(/node - <<'NODE'\n([\s\S]*?)\nNODE/g)];
    const script = scripts.find(match => match[1].includes('active.trains.push'))?.[1];
    expect(script).toBeTruthy();
    let output = '';
    vm.runInNewContext(script!, {
      require: () => ({existsSync: () => true, readFileSync: () => JSON.stringify({trains: [
        {version: '1.0.0', channel: 'stable', releasePr: 1},
        {version: '1.2.3-rc.1', channel: 'rc', releasePr: 42},
        {version: '2.0.0-rc.1', channel: 'rc', releasePr: 50},
      ]}), writeFileSync: (_file: string, value: string) => { output = value; }}),
      process: {env: {RELEASE_TAG: 'v1.2.3', RELEASE_PR: '42', RELEASE_CHANNEL: 'stable'}},
    });
    expect(JSON.parse(output).trains.map((item: any) => item.version).sort())
      .toEqual(['1.2.3', '2.0.0-rc.1']);
  });

  it('admits only authenticated merged promotion retries and avoids a second merge', () => {
    const prepare = workflow('release-train.yml').jobs.prepare;
    const validation = step(prepare, 'Validate request and resolve unchanged release PR head').run as string;
    expect(validation).toContain('.state == "MERGED"');
    expect(validation).toContain('RELEASE_ACTION');
    expect(validation).toContain('.mergeCommit.oid');
    const decision = step(prepare, 'Materialize machine promotion decision').run as string;
    expect(decision).toContain('candidate.sourcePr !== Number(process.env.RELEASE_PR)');
    expect(decision).toContain('candidate.sourcePrHead !== process.env.CURRENT_HEAD');
    const script = decision.match(/node - <<'NODE'\n([\s\S]*?)\nNODE/)?.[1];
    expect(script).toBeTruthy();
    const head = 'a'.repeat(40);
    const evaluate = (candidate: any, recordedHead = head) => vm.runInNewContext(script!, {
      process: {env: {RELEASE_PR: '42', CURRENT_HEAD: head}}, Date,
      require: (name: string) => name === 'fs' ? {
        readFileSync: () => JSON.stringify(candidate), writeFileSync: () => {},
      } : {
        readEvents: () => [
          {type: 'train_started', payload: {releasePr: 42, sourcePrHead: recordedHead}},
          {type: 'channel_published', channel: 'github', timestamp: '2026-10-01T00:00:00.000Z'},
        ],
        materializeReleaseState: () => ({manifestSha256: 'b'.repeat(64), canaries: {}, incidents: {}}),
      },
    });
    expect(() => evaluate({sourcePr: 42, sourcePrHead: head})).not.toThrow();
    expect(() => evaluate({sourcePr: 43, sourcePrHead: head})).toThrow('Promotion source PR');
    expect(() => evaluate({sourcePr: 42, sourcePrHead: 'c'.repeat(40)})).toThrow('Promotion source PR');
    expect(() => evaluate({sourcePr: 42, sourcePrHead: head}, 'c'.repeat(40))).toThrow('Promotion source PR');
    const merge = step(prepare, 'Auto-merge unchanged stable release PR and create stable tag').run as string;
    expect(merge).toContain('if [ "$STATE" = OPEN ]');
    expect(merge).toContain('SOURCE_MERGE_SHA');
  });

  it('reuses an existing rollback event timestamp and keeps new timestamps monotonic', () => {
    const run = step(workflow('release-train.yml').jobs.rollback,
      'Generate append-only recovery plan').run as string;
    const script = run.match(/ROLLBACK_TIMESTAMP="\$\(node - <<'NODE'\n([\s\S]*?)\nNODE/)?.[1];
    expect(script).toBeTruthy();
    const check = (events: any[]) => {
      let output = '';
      vm.runInNewContext(script!, {
        require: () => ({readEvents: () => events}), Date,
        process: {env: {RELEASE_VERSION: '1.2.3', GITHUB_RUN_ID: '123'},
          stdout: {write: (value: string) => { output = value; }}},
      });
      return output;
    };
    const timestamp = '2099-01-01T00:00:00.000Z';
    expect(check([{idempotencyKey: 'rollback:1.2.3:123', timestamp}])).toBe(timestamp);
    expect(Date.parse(check([{idempotencyKey: 'other', timestamp}]))).toBeGreaterThanOrEqual(Date.parse(timestamp));
  });
});
