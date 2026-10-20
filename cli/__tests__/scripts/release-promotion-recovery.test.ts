import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
import yaml from 'js-yaml';

const {createEvent} = require('../../scripts/release/events');
const {createPromotionDecision} = require('../../scripts/release/promotion');
const head = 'a'.repeat(40);
const merge = 'b'.repeat(40);
const publishedAt = '2026-01-01T00:00:00.000Z';
const evaluatedAt = '2026-01-02T02:00:00.000Z';

function fixture() {
  const candidate = {sourcePr: 42, sourcePrHead: head};
  const rc = {version: '1.2.3-rc.1', tag: 'v1.2.3-rc.1', commit: 'c'.repeat(40),
    manifestSha256: 'd'.repeat(64), publishedAt, ...candidate};
  const decision = createPromotionDecision({rc, currentSourcePrHead: head, evaluatedAt,
    requiredChannels: ['github'], canaries: Array.from({length: 24}, (_, index) => ({
      channel: 'github', status: 'passed', checkedAt: index ? evaluatedAt : publishedAt,
    })), incidents: []});
  const text = `${JSON.stringify(decision, null, 2)}\n`;
  const events: any[] = [];
  const append = (type: string, payload: any, channel?: string) => {
    events.push(createEvent({version: rc.version, tag: rc.tag, commit: rc.commit,
      timestamp: events.length < 3 ? publishedAt : evaluatedAt, type, payload,
      idempotencyKey: `fixture:${events.length}`, ...(channel ? {channel} : {})}, events.at(-1)));
  };
  append('train_started', {releasePr: 42, sourcePrHead: head, channels: ['github']});
  append('manifest_created', {manifestSha256: rc.manifestSha256});
  append('channel_published', {}, 'github');
  append('promotion_decided', {result: 'permitted', eligible: true, reasons: [],
    decisionSha256: crypto.createHash('sha256').update(text).digest('hex')});
  const blob = 'e'.repeat(40);
  const blobs = new Map([[blob, text]]);
  let tree = `100644 blob ${blob}\tdecisions/${rc.tag}-123-1.json\0`;
  const calls: string[][] = [];
  const git = (...args: string[]) => {
    calls.push(args);
    if (args[0] === 'ls-remote') return Buffer.from(`${merge}\trefs/tags/v1.2.3\n`);
    if (args[0] === 'ls-tree') return Buffer.from(tree);
    if (args[0] === 'cat-file' && blobs.has(args[2])) return Buffer.from(String(Buffer.byteLength(blobs.get(args[2])!)));
    if (args[0] === 'show' && blobs.has(args[1])) return Buffer.from(blobs.get(args[1])!);
    throw new Error(`unexpected Git command: ${args.join(' ')}`);
  };
  return {input: {events, candidate, sourcePr: 42, currentHead: head, mergeCommit: merge},
    events, append, git, calls, decision, text, blobs, blob, setTree: (value: string) => { tree = value; }};
}

function recover(input: any, git: any) {
  return require('../../scripts/release/promotion-recovery').recoverPromotionApproval(input, git);
}

describe('immutable stable promotion approval recovery', () => {
  it('reuses the exact original bytes despite later failed or stale canary evidence', () => {
    const f = fixture();
    f.append('canary_recorded', {status: 'failed', checkedAt: evaluatedAt}, 'github');
    f.append('incident_opened', {incidentId: 'late', kind: 'availability', summary: 'later failure'});
    expect(recover(f.input, f.git)).toEqual({text: f.text, decision: f.decision});
  });

  it('keeps the ordinary full policy path when no stable tag exists', () => {
    const f = fixture();
    expect(recover(f.input, (...args: string[]) => {
      if (args[0] === 'ls-remote') throw Object.assign(new Error('no tag'), {status: 2});
      return f.git(...args);
    })).toBeUndefined();
  });

  it('does not confuse remote lookup failure with an absent stable tag', () => {
    const f = fixture();
    expect(() => recover(f.input, () => { throw Object.assign(new Error('network unavailable'), {status: 128}); }))
      .toThrow('network unavailable');
  });

  it.each([{mergeCommit: ''}, {mergeCommit: 'f'.repeat(40)}, {currentHead: 'f'.repeat(40)}, {sourcePr: 43}])(
    'rejects an unmerged, different-tag, or changed source identity %j', change => {
      const f = fixture();
      expect(() => recover({...f.input, ...change}, f.git)).toThrow(/identity|source|merge|tag/i);
    }
  );

  it('requires approval bytes authenticated by the protected RC hash chain', () => {
    const f = fixture();
    f.blobs.set(f.blob, `${f.text} `);
    expect(() => recover(f.input, f.git)).toThrow(/approval/i);
    f.setTree('');
    expect(() => recover(f.input, f.git)).toThrow(/approval/i);
  });

  it.each(['120000', '100755'])('rejects non-regular approval mode %s', mode => {
    const f = fixture();
    f.setTree(`${mode} blob ${f.blob}\tdecisions/v1.2.3-rc.1-123-1.json\0`);
    expect(() => recover(f.input, f.git)).toThrow(/regular/);
  });

  it('never treats a denied decision as publication recovery authority', () => {
    const f = fixture();
    f.events.pop();
    f.append('promotion_decided', {result: 'denied', eligible: false, reasons: ['canary_failed:github'],
      decisionSha256: crypto.createHash('sha256').update(f.text).digest('hex')});
    expect(() => recover(f.input, f.git)).toThrow(/approval/);
  });

  it('bounds approval bytes before reading their immutable Git blob', () => {
    const f = fixture();
    expect(() => recover(f.input, (...args: string[]) => (
      args[0] === 'cat-file' ? Buffer.from('1048577\n') : f.git(...args)
    ))).toThrow(/byte limit/);
    expect(f.calls.some(args => args[0] === 'show')).toBe(false);
  });

  it('reads the exact protected approval blob and remote tag using real Git', () => {
    const f = fixture();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-recovery-'));
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, {cwd: root, encoding: 'utf8', env: {...process.env,
        GIT_AUTHOR_NAME: 'Release Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Release Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'}});
      if (result.status !== 0) throw new Error(result.stderr || String(result.error));
      return result.stdout.trim();
    };
    try {
      git('init'); git('config', 'core.autocrlf', 'false');
      fs.mkdirSync(path.join(root, 'decisions'));
      fs.writeFileSync(path.join(root, 'decisions/v1.2.3-rc.1-123-1.json'), f.text);
      git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'protected approval fixture');
      const commit = git('rev-parse', 'HEAD');
      git('tag', 'v1.2.3', commit);
      git('update-ref', 'refs/remotes/origin/release-ledger', commit);
      git('remote', 'add', 'origin', root);
      expect(recover({...f.input, repository: root, mergeCommit: commit}, undefined))
        .toEqual({text: f.text, decision: f.decision});
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });

  it('rejects a previously permitted decision bound to a different source', () => {
    const f = fixture();
    const text = JSON.stringify({...f.decision, stable: {...f.decision.stable, sourcePrHead: 'f'.repeat(40)}});
    f.blobs.set(f.blob, text);
    f.events.pop();
    f.append('promotion_decided', {result: 'permitted', eligible: true, reasons: [],
      decisionSha256: crypto.createHash('sha256').update(text).digest('hex')});
    expect(() => recover(f.input, f.git)).toThrow(/approval|identity/i);
  });

  it('does not revive a rolled-back RC or stable release', () => {
    const f = fixture();
    f.append('rollback_started', {});
    expect(() => recover(f.input, f.git)).toThrow(/rollback|terminal/i);
    f.events.pop();
    const stable = [createEvent({version: '1.2.3', tag: 'v1.2.3', commit: merge,
      timestamp: evaluatedAt, type: 'train_started', idempotencyKey: 'stable', payload: {channels: ['github']}})];
    stable.push(createEvent({...stable[0], type: 'rollback_started', idempotencyKey: 'rollback'}, stable[0]));
    const blob = 'f'.repeat(40);
    f.blobs.set(blob, stable.map(event => JSON.stringify(event)).join('\n') + '\n');
    f.setTree(`100644 blob ${f.blob}\tdecisions/v1.2.3-rc.1-123-1.json\0` +
      `100644 blob ${blob}\tevents/v1.2.3.jsonl\0`);
    expect(() => recover(f.input, f.git)).toThrow(/rollback|terminal/i);
  });

  it('runs recovery before new policy and never rewrites the original decision on a retry', () => {
    const workflow = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/release-train.yml'), 'utf8')) as any;
    const steps = workflow.jobs.prepare.steps;
    const recovery = steps.findIndex((s: any) => s.id === 'recovery');
    const policy = steps.findIndex((s: any) => s.id === 'promotion');
    expect(recovery).toBeGreaterThan(-1);
    expect(recovery).toBeLessThan(policy);
    expect(steps[policy].if).toContain("steps.recovery.outputs.recovered != 'true'");
    expect(steps.find((s: any) => s.name === 'Persist the machine promotion decision before applying its result').if)
      .toContain("steps.recovery.outputs.recovered != 'true'");
    expect(steps[recovery].run).toContain('recoverPromotionApproval');
  });
});
