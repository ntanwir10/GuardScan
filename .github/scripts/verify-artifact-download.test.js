'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {spawnSync, execFileSync} = require('child_process');
const helper = path.join(__dirname, 'verify-artifact-download.py');
const python = process.platform === 'win32' ? 'python' : 'python3';

function fixture(change = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-digest-'));
  const destination = path.join(root, 'downloaded');
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'payload file.txt'), 'verified bytes');
  const context = {root, destination, entries: [{name: 'payload file.txt', bytes: 'verified bytes', mode: 0o100644}],
    artifact: {id: 19, name: 'release-input-v1.1.0', expired: false, workflow_run: {id: 42}}, duplicates: false};
  change(context);
  const zip = path.join(root, 'artifact.zip');
  execFileSync(python, ['-c', [
    'import io,json,sys,zipfile',
    'entries=json.loads(sys.argv[2])',
    'class Sink(io.BytesIO):',
    ' def seek(self,*args): raise io.UnsupportedOperation()',
    'sink=Sink()',
    'with zipfile.ZipFile(sink,"w",compression=zipfile.ZIP_DEFLATED,allowZip64=True) as archive:',
    ' for item in entries:',
    '  entry=zipfile.ZipInfo(item["name"]); entry.external_attr=item["mode"] << 16; entry.compress_type=zipfile.ZIP_DEFLATED',
    '  with archive.open(entry,"w",force_zip64=True) as member: member.write(item["bytes"].encode())',
    'with open(sys.argv[1],"wb") as target: target.write(sink.getvalue())',
  ].join('\n'), zip, JSON.stringify(context.entries)]);
  if (context.encrypted || context.oversized) {
    const bytes = fs.readFileSync(zip);
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    if (context.encrypted) {
      bytes.writeUInt16LE(bytes.readUInt16LE(6) | 1, 6);
      bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
    }
    if (context.oversized) bytes.writeUInt32LE(512 * 1024 * 1024 + 1, central + 24);
    fs.writeFileSync(zip, bytes);
  }
  const digest = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  if (!Object.hasOwn(context.artifact, 'digest')) context.artifact.digest = digest;
  let artifacts = context.duplicates ? [context.artifact, {...context.artifact, id: 20}] : [context.artifact];
  let recoveryScript;
  if (context.recovery) {
    const yaml = require('../../cli/node_modules/js-yaml');
    const train = yaml.load(fs.readFileSync(path.join(__dirname, '../workflows/release-train.yml'), 'utf8'));
    recoveryScript = train.jobs['resolve-checkpoint'].steps.find(step => step.name === 'Reuse only byte-identical current-run recovery handoffs').run;
    for (const directory of ['rehydrated/payload', 'rehydrated/npm-artifact', '.github/scripts']) fs.mkdirSync(path.join(root, directory), {recursive: true});
    for (const directory of ['rehydrated/payload', 'rehydrated/npm-artifact']) {
      fs.copyFileSync(path.join(destination, 'payload file.txt'), path.join(root, directory, 'payload file.txt'));
    }
    fs.copyFileSync(helper, path.join(root, '.github/scripts/verify-artifact-download.py'));
    artifacts = context.recovery === 'absent' ? [] : [
      {...context.artifact, name: 'release-payload-v1.1.0'},
      {...context.artifact, id: 20, name: 'release-npm-v1.1.0'},
    ];
    if (context.recovery === 'duplicate') artifacts.push({...artifacts[0], id: 21});
    if (context.recovery === 'drift') fs.writeFileSync(path.join(root, 'rehydrated/npm-artifact/payload file.txt'), 'substituted bytes');
  }
  fs.writeFileSync(path.join(root, 'metadata.json'), JSON.stringify([{artifacts}]));
  const gh = path.join(root, 'gh');
  fs.writeFileSync(gh, '#!' + process.execPath + '\n' + [
    "const fs=require('fs');const path=require('path');const args=process.argv.slice(2);",
    "fs.appendFileSync(path.join(__dirname,'calls.jsonl'),JSON.stringify(args)+'\\n');",
    "process.stdout.write(fs.readFileSync(path.join(__dirname,args.includes('--slurp')?'metadata.json':'artifact.zip')));",
  ].join('\n'), {mode: 0o755});
  const env = {...process.env, PYTHONDONTWRITEBYTECODE: '1', GITHUB_REPOSITORY: 'ntanwir10/GuardScan', GITHUB_RUN_ID: '42',
    RELEASE_TAG: 'v1.1.0', RUNNER_TEMP: root, GITHUB_OUTPUT: path.join(root, 'output'),
    PATH: root + path.delimiter + process.env.PATH};
  const result = context.recovery
    ? spawnSync('bash', ['-euo', 'pipefail', '-c', recoveryScript], {cwd: root, encoding: 'utf8', env})
    : spawnSync(python, [helper, context.artifact.name, destination], {encoding: 'utf8', env});
  const output = fs.existsSync(env.GITHUB_OUTPUT) ? fs.readFileSync(env.GITHUB_OUTPUT, 'utf8') : '';
  const calls = fs.existsSync(path.join(root, 'calls.jsonl'))
    ? fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  fs.rmSync(root, {recursive: true, force: true});
  return {result, calls, output};
}

test('binds actual action-downloaded files including spaces to one current-run artifact ZIP digest', () => {
  const {result, calls} = fixture();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls, [
    ['api', '--paginate', '--slurp', 'repos/ntanwir10/GuardScan/actions/runs/42/artifacts?per_page=100'],
    ['api', 'repos/ntanwir10/GuardScan/actions/artifacts/19/zip'],
  ]);
});

for (const [name, change] of [
  ['digest mismatch', f => { f.artifact.digest = 'sha256:' + '0'.repeat(64); }],
  ['missing digest', f => { f.artifact.digest = ''; }],
  ['missing ID', f => { delete f.artifact.id; }],
  ['wrong run', f => { f.artifact.workflow_run.id = 43; }],
  ['duplicate artifact name', f => { f.duplicates = true; }],
  ['expired artifact', f => { f.artifact.expired = true; }],
  ['unknown ZIP path', f => { f.entries.push({name: 'unrequested.txt', bytes: 'other', mode: 0o100644}); }],
  ['traversal ZIP path', f => { f.entries[0].name = '../outside'; }],
  ['duplicate ZIP member', f => { f.entries.push({...f.entries[0]}); }],
  ['encrypted ZIP member', f => { f.encrypted = true; }],
  ['expanded ZIP size limit', f => { f.oversized = true; }],
  ['ZIP symlink', f => { f.entries[0].mode = 0o120777; }],
  ['action output byte drift', f => { fs.writeFileSync(path.join(f.destination, 'payload file.txt'), 'modified bytes'); }],
  ['action output symlink', f => { fs.symlinkSync('payload file.txt', path.join(f.destination, 'link')); }],
  ['unexpected action file', f => { fs.writeFileSync(path.join(f.destination, 'unknown'), 'other'); }],
]) test(`rejects ${name}`, () => { assert.notEqual(fixture(change).result.status, 0); });

test('every guarded download verifies its exact output bytes and has the complete reusable caller permission union', () => {
  const yaml = require('../../cli/node_modules/js-yaml');
  const root = path.join(__dirname, '../workflows');
  const load = name => yaml.load(fs.readFileSync(path.join(root, name), 'utf8'));
  const build = load('release-build.yml');
  const publish = load('release-publish.yml');
  for (const job of [build.jobs['npm-finalize'], build.jobs['native-finalize'], build.jobs['provider-finalize'], build.jobs.aggregate, publish.jobs.npm]) {
    const index = job.steps.findIndex(step => step.env?.ARTIFACT_NAME);
    assert.ok(index > 0);
    const guard = job.steps[index];
    const download = job.steps[index - 1];
    assert.match(download.uses, /^actions\/download-artifact@/);
    assert.equal(guard.env.ARTIFACT_NAME, download.with.name);
    assert.equal(guard.env.ARTIFACT_DIRECTORY, download.with.path);
    assert.equal(guard.env.GH_TOKEN, '${{ github.token }}');
    assert.equal(guard.shell, 'bash');
    assert.match(guard.run, /verify-artifact-download.py "\$ARTIFACT_NAME" "\$ARTIFACT_DIRECTORY"/);
    assert.equal(job.permissions.actions, 'read');
  }
  for (const name of ['release-build.yml', 'release-publish.yml']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, name), 'utf8'), /outputs\.artifact-digest/);
  }
  for (const [name, job] of [['release-train.yml', 'build'], ['release-train.yml', 'publish'], ['release-provider-rehearsal.yml', 'rehearsal']]) {
    assert.equal(load(name).jobs[job].permissions.actions, 'read', `${name}:${job}`);
  }
  const ci = fs.readFileSync(path.join(root, 'ci.yml'), 'utf8');
  for (const name of ['verify-release-workflow-security', 'resume-release-checkpoint', 'verify-artifact-download']) {
    assert.ok(ci.includes(`.github/scripts/${name}.test.js`));
  }
});


for (const mode of ['present', 'absent', 'drift', 'duplicate']) {
  test(`current-run recovery handoff ${mode} never overwrites existing authority`, () => {
    const {result, calls, output} = fixture(f => { f.recovery = mode; });
    assert.equal(result.status === 0, mode === 'present' || mode === 'absent', result.stderr);
    assert.ok(calls.every(args => args[0] === 'api'));
    if (mode === 'present' || mode === 'absent') {
      const expected = mode === 'present' ? 'true' : 'false';
      assert.equal(output, `payload_exists=${expected}\nnpm_exists=${expected}\n`);
    }
    if (mode === 'absent' || mode === 'duplicate') assert.ok(calls.every(args => !args[1]?.endsWith('/zip')));
  });
}

test('recovery uploads only absent verified aliases without clobbering canonical originals', () => {
  const yaml = require('../../cli/node_modules/js-yaml');
  const train = yaml.load(fs.readFileSync(path.join(__dirname, '../workflows/release-train.yml'), 'utf8'));
  const job = train.jobs['resolve-checkpoint'];
  const probe = job.steps.findIndex(step => step.id === 'existing-handoffs');
  for (const [kind, suffix] of [['payload', 'payload/'], ['npm', 'npm-artifact/']]) {
    const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@') && step.with.name.startsWith(`release-${kind}-`));
    assert.ok(job.steps.indexOf(upload) > probe);
    assert.ok(upload.if.includes(`steps.existing-handoffs.outputs.${kind}_exists == 'false'`));
    assert.equal(upload.with.path, `rehydrated/${suffix}`);
    assert.equal(upload.with.overwrite, undefined);
  }
});
