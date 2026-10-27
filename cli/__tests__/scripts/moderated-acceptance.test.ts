import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import vm from 'vm';
import yaml from 'js-yaml';
import {execFileSync} from 'child_process';
const events = require('../../scripts/release/events');
const {renderAdapters} = require('../../scripts/release/renderers');
const {buildArchive} = require('../../scripts/release/archive');
const {EXPECTED_CANARY_TARGETS} = require('../../scripts/release/canary-reports');
const source = {version: '1.2.3', tag: 'v1.2.3', commit: 'a'.repeat(40)};
const checkedAt = '2026-10-01T00:00:00.000Z', future = '2099-01-01T00:00:00.000Z';
const sha256 = (bytes: any) => crypto.createHash('sha256').update(bytes).digest('hex');
function manifest() {
  const url = 'https://github.com/ntanwir10/GuardScan/releases/download/v1.2.3/guardscan-windows.zip';
  return {...source, schemaVersion: 'guardscan.release-manifest.v1', createdAt: checkedAt,
    producer: {provider: 'github-actions', repository: 'ntanwir10/GuardScan', workflow: '.github/workflows/release-build.yml', runId: '1', runAttempt: 1, sourceRef: 'refs/tags/v1.2.3'},
    toolchain: {node: '22.12.0', packageManager: {name: 'npm', version: '10.9.0'}, tools: [{name: 'esbuild', version: '1'}]},
    artifacts: [{id: 'windows', kind: 'standalone', productionReady: true, filename: 'guardscan-windows.zip', size: 123, sha256: 'b'.repeat(64), source,
      platform: {os: 'windows', arch: 'x64'}, archiveFormat: 'zip', entrypoint: 'guardscan.exe', url,
      capabilities: {coreScan: true, sbom: true, chartRendering: false, accurateTokenCounting: false},
      optionalCapabilities: {schemaVersion: 'guardscan.runtime-capabilities.v1',
        tokenCounting: {dependency: 'tiktoken', dependencyAvailable: false, mode: 'estimated', sampleTokenCount: 1, safeFallbackObserved: true},
        chartRendering: {dependency: 'chartjs-node-canvas', dependencyAvailable: false, mode: 'unavailable', safeFallbackObserved: true}},
      archiveEntries: [{path: 'guardscan.exe', size: 12, mode: '0755', sha256: 'c'.repeat(64)}],
      signatures: [{type: 'authenticode', url: url + '.sig', verified: true}],
      sboms: ['spdx', 'cyclonedx'].map(type => ({type, url: url + '.' + type, verified: true})),
      provenance: {type: 'slsa', url: url + '.attestation', verified: true}}]};
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moderated-acceptance-')), ledger = path.join(root, 'ledger.jsonl');
  let doc: any = manifest(), absent = false, corrupt = false, unavailable = false;
  const rendered = renderAdapters(doc, 'winget,chocolatey').files;
  const files: Record<string, Buffer> = Object.fromEntries(Object.entries(rendered).filter(([n]) => n.startsWith('winget/')).map(([n, v]) => [path.basename(n), Buffer.from(v as string)]));
  const remoteCommit = 'e'.repeat(40), prefix = 'manifests/n/NaumanTanwir/GuardScan/1.2.3/';
  const blobSha = (b: Buffer) => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
  const calls: any[] = [];
  const execute = (command: string, args: string[], options: any): any => {
    calls.push({command, args, options});
    if (unavailable) throw new Error('provider unavailable');
    if (command === 'gh' && args[0] === 'release') { fs.writeFileSync(path.join(args[args.indexOf('--dir') + 1], 'release-manifest.json'), JSON.stringify(doc)); return ''; }
    if (command === 'gh' && args[0] === 'api') {
      if (args[1].endsWith('/commits/master')) return JSON.stringify({sha: remoteCommit});
      if (args[1].includes('/contents/')) {
        if (absent) throw Object.assign(new Error('HTTP 404'), {stderr: 'HTTP 404'});
        return JSON.stringify(Object.entries(files).map(([n, b]) => ({type: 'file', path: prefix + n, sha: blobSha(b)})));
      }
      if (args[1].includes('/git/blobs/')) { const sha = args[1].split('/').at(-1), b = Object.values(files).find(b => blobSha(b) === sha)!;
        return JSON.stringify({sha, size: b.length, encoding: 'base64', content: (corrupt ? Buffer.from('corrupt') : b).toString('base64')}); }
    }
    if (command === 'python3') {
      const remote = buildArchive('zip', Object.entries(rendered).filter(([n]) => n.startsWith('chocolatey/')).map(([n, value]) => ({
        name: n.slice(11), data: n.endsWith('.nuspec')
          ? (value as string).replace(/\s*<files>[\s\S]*?<\/files>/, '')
            .replace('2015/06/nuspec.xsd', '2013/05/nuspec.xsd')
          : value,
      })), checkedAt);
      const script = ['import importlib.util,sys,urllib.error,json', 's=importlib.util.spec_from_file_location("p",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
        'def fetch(v):', '    if sys.argv[3]=="absent": raise urllib.error.HTTPError("url",404,"missing",{},None)', '    return bytes.fromhex(sys.argv[3])',
        'print(json.dumps(m.preflight(sys.argv[2],"1.2.3",fetch)))'].join('\n');
      return execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script, args[0], args[args.indexOf('--package') + 1], absent ? 'absent' : (corrupt ? Buffer.from('corrupt') : remote).toString('hex')], {...options, stdio: 'pipe'});
    }
    throw new Error('Unexpected provider call');
  };
  const initial: any[] = [];
  const add = (type: string, payload: any, channel?: string) => initial.push(events.createEvent({...source, type, payload, ...(channel ? {channel} : {}), timestamp: future, idempotencyKey: `${type}:${channel || ''}`}, initial.at(-1)));
  add('train_started', {channels: [...new Set(EXPECTED_CANARY_TARGETS.map(([c]: string[]) => c))]});
  add('manifest_created', {manifestSha256: sha256(JSON.stringify(doc))});
  for (const channel of ['winget', 'chocolatey']) {
    const digests = Object.fromEntries(Object.keys(files).sort().map(n => [n, 'd'.repeat(64)]));
    const remoteDigest = channel === 'winget' ? sha256(Object.entries(digests).map(([n, d]) => `${n}\0${d}\n`).join('')) : 'd'.repeat(64);
    const remoteIdentity = channel === 'winget' ? `github:microsoft/winget-pkgs/pull/42@${'d'.repeat(40)}#${prefix.slice(0, -1)}` : 'chocolatey:guardscan@1.2.3';
    add('channel_submitted', {artifactIds: ['windows'], remoteIdentity, remoteDigest, submission: {
      schemaVersion: 'guardscan.moderated-submission.v1', version: source.version, tag: source.tag, channel, state: 'submitted', remoteIdentity, remoteDigest,
      packageIdentity: `${channel === 'winget' ? 'NaumanTanwir.GuardScan' : 'guardscan'}@1.2.3`,
      ...(channel === 'winget' ? {files: digests, provider: {repository: 'microsoft/winget-pkgs', commit: 'd'.repeat(40), path: prefix.slice(0, -1), pullRequest: 42, publicBytesVerified: false, pendingStateQuery: 'PR'}}
        : {packageFilename: 'guardscan.1.2.3.nupkg', provider: {url: 'https://community.chocolatey.org/api/v2/package/guardscan/1.2.3', publicBytesVerified: false, pendingStateQuery: 'registry'}}),
    }}, channel);
  }
  fs.writeFileSync(ledger, initial.map(e => JSON.stringify(e) + '\n').join(''));
  const transition = (channel: string, type: string, status?: string) => {
    const previous = events.readEvents(ledger);
    const submission = {...initial.find(e => e.channel === channel).payload.submission, state: status};
    const payload = status ? {...initial.find(e => e.channel === channel).payload, submission} : {};
    if (status === 'rejected') { payload.reason = 'provider correction'; submission.reason = payload.reason; }
    events.appendEvent(ledger, {...source, type, channel, timestamp: future,
      idempotencyKey: `${type}:${channel}:extra`, payload});
    expect(events.readEvents(ledger)).toHaveLength(previous.length + 1);
  };
  const rebind = () => {
    const rebound: any[] = [];
    for (const e of initial) rebound.push(events.createEvent({...e,
      ...(e.type === 'manifest_created' ? {payload: {manifestSha256: sha256(JSON.stringify(doc))}} : {})}, rebound.at(-1)));
    fs.writeFileSync(ledger, rebound.map(e => JSON.stringify(e) + '\n').join(''));
  };
  return {root, ledger, initial, execute, calls, files, remoteCommit, transition, rebind,
    change: (f: (d: any) => any) => {doc = f(doc);}, absent: () => {absent = true;}, corrupt: () => {corrupt = true;}, unavailable: () => {unavailable = true;}, cleanup: () => fs.rmSync(root, {recursive: true, force: true})};
}
function accept(h: ReturnType<typeof fixture>, channel: string, extra = {}) {
  return require('../../scripts/release/moderated-acceptance').acceptModeratedChannel(h.ledger, channel, {passed: true, complete: true, checkedAt, ...extra}, h.execute);
}
describe('scheduled moderated acceptance', () => {
  it('rolls back resubmitted moderated packages through the CLI idempotently', async () => {
    const h = fixture();
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      for (const channel of ['winget', 'chocolatey']) {
        h.transition(channel, 'channel_rejected', 'rejected');
        h.transition(channel, 'channel_corrected', 'corrected');
        h.transition(channel, 'channel_resubmitted', 'resubmitted');
      }
      fs.writeFileSync(path.join(h.root, 'package.json'), JSON.stringify({
        name: 'guardscan', version: source.version, engines: {node: '>=22.0.0'},
      }));
      fs.writeFileSync(path.join(h.root, 'package-lock.json'), JSON.stringify({
        version: source.version, packages: {'': {version: source.version, engines: {node: '>=22.0.0'}}},
      }));
      fs.writeFileSync(path.join(h.root, 'CHANGELOG.md'), `## [${source.version}]\n`);
      const args = ['rollback', '--package-root', h.root,
        '--repository-root', path.resolve(__dirname, '../../..'), '--commit', source.commit,
        '--tag', source.tag, '--ledger', h.ledger, '--timestamp', future,
        '--idempotency-key', 'rollback:resubmitted', '--known-good', '1.0.5',
        '--known-good-commit', 'b'.repeat(40)];
      const {main} = require('../../scripts/release/index');
      await main(args);
      const first = events.readEvents(h.ledger);
      expect(first.filter((e: any) => e.type === 'action_required')).toEqual(
        ['chocolatey', 'winget'].map(channel => expect.objectContaining({
          channel, payload: expect.objectContaining({authority: `${channel}-maintainer`,
            action: channel === 'winget' ? 'submit-corrective-manifest' : 'unlist-or-supersede'}),
        })));
      expect(events.materializeReleaseState(first)).toMatchObject({
        recovery: {status: 'started', mode: 'known-good'},
        channels: {winget: {status: 'resubmitted'}, chocolatey: {status: 'resubmitted'}},
      });
      const bytes = fs.readFileSync(h.ledger, 'utf8');
      await main(args);
      expect(events.readEvents(h.ledger)).toEqual(first);
      expect(fs.readFileSync(h.ledger, 'utf8')).toBe(bytes);
    } finally { stdout.mockRestore(); h.cleanup(); }
  });
  it.each(['winget', 'chocolatey'])('binds fresh %s bytes to the protected manifest and suppresses repeat acceptance', channel => {
    const h = fixture(); try {
      expect(accept(h, channel)).toBe(true);
      const last = events.readEvents(h.ledger).at(-1);
      expect(last.type).toBe('channel_accepted'); expect(last.timestamp).toBe(future);
      expect(last.payload.artifactIds).toEqual(['windows']); expect(last.payload.submission.state).toBe('public-exact');
      expect(last.payload.submission.provider.publicBytesVerified).toBe(true);
      expect(last.payload.remoteIdentity).not.toBe(h.initial.find(e => e.channel === channel).payload.remoteIdentity);
      expect(h.calls[0].args).toEqual(['release', 'download', source.tag, '--repo', 'ntanwir10/GuardScan', '--pattern', 'release-manifest.json', '--dir', expect.any(String)]);
      expect(fs.existsSync(h.calls[0].args.at(-1))).toBe(false);
      const calls = h.calls.length; expect(accept(h, channel)).toBe(false); expect(h.calls).toHaveLength(calls);
    } finally { h.cleanup(); }
  });
  it.each(['winget', 'chocolatey'])('leaves %s pending on404 and rejects uncertain or corrupt provider proof', channel => {
    for (const mode of ['absent', 'unavailable', 'corrupt'] as const) { const h = fixture(); try {
      h[mode](); if (mode === 'absent') expect(accept(h, channel)).toBe(false); else expect(() => accept(h, channel)).toThrow();
      expect(events.readEvents(h.ledger)).toHaveLength(h.initial.length);
    } finally { h.cleanup(); } }
  });
  it.each(['version', 'tag', 'commit', 'hash', 'missing'])('rejects %s manifest drift before provider queries', field => {
    const h = fixture(); try { h.change(d => field === 'missing' ? {} : {...d, [field]: 'different'});
      expect(() => accept(h, 'winget')).toThrow(); expect(h.calls).toHaveLength(1); expect(events.readEvents(h.ledger)).toHaveLength(h.initial.length);
    } finally { h.cleanup(); }
  });
  it.each(['version', 'tag', 'commit', 'schemaVersion'])('checks %s even when the downloaded digest matches the ledger', field => {
    const h = fixture(); try {
      h.change(d => ({...d, [field]: field === 'version' ? '1.2.4' : field === 'tag' ? 'v1.2.4' : field === 'commit' ? 'b'.repeat(40) : 'wrong'}));
      h.rebind(); expect(() => accept(h, 'winget')).toThrow(); expect(h.calls).toHaveLength(1);
    } finally { h.cleanup(); }
  });
  it.each(['winget', 'chocolatey'])('accepts %s resubmissions with fresh public identity rather than the old submitted receipt', channel => {
    const h = fixture(); try {
      h.transition(channel, 'channel_rejected', 'rejected');
      h.transition(channel, 'channel_corrected', 'corrected');
      h.transition(channel, 'channel_resubmitted', 'resubmitted');
      expect(accept(h, channel)).toBe(true);
      expect(events.materializeReleaseState(events.readEvents(h.ledger)).channels[channel].status).toBe('accepted');
    } finally { h.cleanup(); }
  });
  it.each(['failed', 'withdrawn', 'superseded'])('suppresses provider requests for terminal %s state', status => {
    const h = fixture(); try {
      const type = status === 'failed' ? 'channel_failed' : status;
      h.transition('winget', type);
      expect(accept(h, 'winget')).toBe(false); expect(h.calls).toHaveLength(0);
    } finally { h.cleanup(); }
  });
  it.each(['winget', 'chocolatey'])('does not query %s without a complete passing report', channel => {
    const h = fixture(); try { expect(accept(h, channel, {complete: false})).toBe(false); expect(accept(h, channel, {passed: false})).toBe(false); expect(h.calls).toHaveLength(0); } finally { h.cleanup(); }
  });
  it.each(['submitted', 'resubmitted', 'accepted', 'verified', 'failed', 'withdrawn', 'superseded'])(
    'retries the real stable moderated publication loop from %s without reviving or duplicating acceptance', status => {
      const h = fixture(); try {
        const evidence: Record<string, any> = {};
        for (const channel of ['winget', 'chocolatey']) {
          accept(h, channel);
          evidence[channel] = events.readEvents(h.ledger).at(-1).payload.submission;
        }
        if (!['accepted', 'verified'].includes(status)) fs.writeFileSync(h.ledger, h.initial.map(e => JSON.stringify(e) + '\n').join(''));
        for (const channel of ['winget', 'chocolatey']) {
          if (status === 'resubmitted') {
            h.transition(channel, 'channel_rejected', 'rejected');
            h.transition(channel, 'channel_corrected', 'corrected');
            h.transition(channel, 'channel_resubmitted', 'resubmitted');
          } else if (['verified', 'failed', 'withdrawn', 'superseded'].includes(status)) {
            h.transition(channel, status === 'verified' ? 'channel_verified' : status === 'failed' ? 'channel_failed' : status);
          }
        }
        const workflow: any = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/release-train.yml'), 'utf8'));
        const body = Object.values(workflow.jobs).flatMap((j: any) => j.steps || []).find((s: any) => s.name === 'Fetch ledger, append chained events, and push') as any;
        const code = body.run.replace(/\r\n/g, '\n').match(/node - <<'NODE'\n([\s\S]*?)\nNODE/)[1];
        const validator = code.slice(code.indexOf('const readModeratedEvidence ='), code.indexOf("for (const channel of ['github', 'npm', 'pypi'])"));
        const loop = code.slice(code.lastIndexOf("if (process.env.RELEASE_CHANNEL === 'stable')"));
        const run = () => vm.runInNewContext(validator + loop, {
          process: {env: {RELEASE_CHANNEL: 'stable'}}, crypto, version: source.version, tag: source.tag,
          fs: {readFileSync: (f: string) => JSON.stringify(evidence[f.split('/')[1]])},
          ledger: h.ledger, base: source, artifactIds: {scoop: ['windows']},
          appendEvent: events.appendEvent, readEvents: events.readEvents, materializeReleaseState: events.materializeReleaseState,
          timestampFor: (key: string) => events.monotonicLedgerTimestamp(events.readEvents(h.ledger), checkedAt, key),
        });
        const before = fs.readFileSync(h.ledger, 'utf8');
        run();
        const after = events.readEvents(h.ledger);
        const expected = ['submitted', 'resubmitted'].includes(status) ? 'accepted' : status;
        for (const channel of ['winget', 'chocolatey']) expect(events.materializeReleaseState(after).channels[channel].status).toBe(expected);
        if (expected === status) expect(fs.readFileSync(h.ledger, 'utf8')).toBe(before);
        else for (const event of after.slice(-2)) {
          expect(event.type).toBe('channel_accepted'); expect(event.timestamp).toBe(future);
          expect(event.payload).toMatchObject({artifactIds: ['windows'], submission: evidence[event.channel], remoteIdentity: evidence[event.channel].remoteIdentity, remoteDigest: evidence[event.channel].remoteDigest});
          expect(event.idempotencyKey.split(':').at(-1)).toHaveLength(16);
        }
        const hashChain = fs.readFileSync(h.ledger, 'utf8'); run(); expect(fs.readFileSync(h.ledger, 'utf8')).toBe(hashChain);
        if (status === 'accepted') {
          for (const channel of ['winget', 'chocolatey']) evidence[channel] = h.initial.find(e => e.channel === channel).payload.submission;
          run(); expect(fs.readFileSync(h.ledger, 'utf8')).toBe(hashChain);
          for (const channel of ['winget', 'chocolatey']) expect(events.materializeReleaseState(events.readEvents(h.ledger)).channels[channel].status).toBe('accepted');
        }
      } finally { h.cleanup(); }
    }
  );
  it.each([false, true])('executes scheduled acceptance and cleanup with previously verified npm failure=%s', failed => {
    const h = fixture(); try {
      const workflow: any = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/release-canary.yml'), 'utf8'));
      const body = workflow.jobs.record.steps.find((s: any) => s.name === 'Append hash-chained canary and verification events').run.replace(/\r\n/g, '\n').match(/node - <<'NODE'\n([\s\S]*?)\nNODE/)[1];
      fs.mkdirSync(path.join(h.root, 'reports', 'current'), {recursive: true});
      for (const [channel, target] of EXPECTED_CANARY_TARGETS) fs.writeFileSync(path.join(h.root, 'reports', 'current', `${channel}-${target}.json`), JSON.stringify({...source, channel, target, checkedAt, status: 'passed', evidenceUrl: 'https://github.com/ntanwir10/GuardScan/actions/runs/123'}));
      let original = fs.readFileSync(h.ledger, 'utf8'), runId = '123';
      const run = () => vm.runInNewContext(body, {process: {env: {TRAIN_VERSION: source.version, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: 'ntanwir10/GuardScan', GITHUB_SERVER_URL: 'https://github.com'}}, require: (name: string) => {
        if (name === 'fs') return Object.fromEntries(['readdirSync', 'readFileSync', 'writeFileSync', 'mkdirSync'].map(method => [method, (file: string, ...args: any[]) => (fs as any)[method](path.resolve(h.root, file), ...args)]));
        if (name === 'child_process') return {execFileSync: (_c: string, args: string[]) => args[0] === 'show' ? original : source.commit};
        if (name.endsWith('/moderated-acceptance')) return {acceptModeratedChannel: (file: string, c: string, report: any) => require('../../scripts/release/moderated-acceptance').acceptModeratedChannel(path.resolve(h.root, file), c, report, h.execute)};
        if (name.endsWith('/events')) return {...events, readEvents: (f: string) => events.readEvents(path.resolve(h.root, f)), appendEvent: (f: string, input: any) => events.appendEvent(path.resolve(h.root, f), input)};
        if (name.startsWith('./cli/')) return require(path.resolve(__dirname, '../../../', name)); return require(name);
      }});
      const output = path.join(h.root, 'ledgers', source.tag + '.jsonl');
      const moderatedReports = ['winget', 'chocolatey'].map(channel =>
        path.join(h.root, 'reports', 'current', `${channel}-windows-x64.json`));
      for (const file of moderatedReports) {
        const report = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.writeFileSync(file, JSON.stringify({...report, status: 'pending'}));
      }
      run();
      expect(h.calls).toHaveLength(0);
      const pending = events.materializeReleaseState(events.readEvents(output));
      expect(pending.channels.winget.status).toBe('submitted');
      expect(pending.channels.chocolatey.status).toBe('submitted');
      original = fs.readFileSync(output, 'utf8');
      for (const file of moderatedReports) {
        const report = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.writeFileSync(file, JSON.stringify({...report, status: 'passed'}));
      }
      if (failed) {
        runId = '124';
        for (const name of fs.readdirSync(path.join(h.root, 'reports', 'current'))) {
          const file = path.join(h.root, 'reports', 'current', name);
          const report = JSON.parse(fs.readFileSync(file, 'utf8'));
          fs.writeFileSync(file, JSON.stringify({...report, evidenceUrl: 'https://github.com/ntanwir10/GuardScan/actions/runs/124'}));
        }
        const file = path.join(h.root, 'reports', 'current', 'npm-npm.json');
        const report = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.writeFileSync(file, JSON.stringify({...report, status: 'failed'}));
      }
      run();
      const completed = events.readEvents(output);
      for (const c of ['winget', 'chocolatey']) { expect(completed.filter((e: any) => e.channel === c).map((e: any) => e.type)).toEqual(['channel_submitted', 'canary_recorded', 'channel_accepted', 'channel_verified']); expect(events.materializeReleaseState(completed).channels[c].status).toBe('verified'); }
      expect(completed.filter((e: any) => e.type === 'canary_recorded').every((e: any) => e.payload.checkedAt === checkedAt)).toBe(true);
      original = fs.readFileSync(output, 'utf8'); const calls = h.calls.length; run(); expect(events.readEvents(output)).toHaveLength(completed.length); expect(h.calls).toHaveLength(calls);
      expect(events.materializeReleaseState(completed).channels.npm.status).toBe(failed ? 'failed' : 'verified');
      expect(completed.filter((e: any) => e.type === 'channel_failed')).toHaveLength(failed ? 1 : 0);
      const branch = path.join(h.root, 'ledger-branch');
      fs.mkdirSync(path.join(branch, 'events'), {recursive: true});
      fs.copyFileSync(output, path.join(branch, 'events', source.tag + '.jsonl'));
      const stable = {version: source.version, channel: 'stable'}, rc = {version: '1.2.4-rc.1', channel: 'rc'};
      fs.writeFileSync(path.join(branch, 'active-versions.json'), JSON.stringify({trains: [stable, rc]}));
      const cleanup = workflow.jobs.record.steps.find((s: any) => s.name === 'Append hash-chained canary and verification events').run.replace(/\r\n/g, '\n').matchAll(/node - <<'NODE'\n([\s\S]*?)\nNODE/g);
      const cleanupBody = [...cleanup][1][1];
      vm.runInNewContext(cleanupBody, {require: (name: string) => {
        if (name === 'fs') return {existsSync: (f: string) => fs.existsSync(path.resolve(h.root, f)), readFileSync: (f: string) => fs.readFileSync(path.resolve(h.root, f)), writeFileSync: (f: string, v: string) => fs.writeFileSync(path.resolve(h.root, f), v)};
        if (name.endsWith('/events')) return {...events, readEvents: (f: string) => events.readEvents(path.resolve(h.root, f))};
        if (name.startsWith('./cli/')) return require(path.resolve(__dirname, '../../../', name));
        return require(name);
      }});
      expect(JSON.parse(fs.readFileSync(path.join(branch, 'active-versions.json'), 'utf8')).trains).toEqual(failed ? [stable, rc] : [rc]);
    } finally { h.cleanup(); }
  });
});
