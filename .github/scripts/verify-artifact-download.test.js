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
  for (const job of [build.jobs['npm-finalize'], build.jobs['native-finalize'], build.jobs['provider-finalize'], publish.jobs.npm]) {
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
  assert.equal(build.jobs.aggregate.permissions.actions, 'read');
  // The aggregate's seven transports are exercised by the assembly regressions below.
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


// Exercise aggregate assembly directly from the trusted workflow scripts.
const yaml = require('../../cli/node_modules/js-yaml');
const root = path.resolve(__dirname, '../..');
const steps = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/release-build.yml'), 'utf8')).jobs.aggregate.steps;
const targets = ['linux-x64-glibc', 'linux-arm64-glibc', 'darwin-arm64', 'darwin-x64', 'windows-x64'];
const transports = [...targets, 'npm', 'npm-provenance'];
const transportName = name => `release-${targets.includes(name) ? 'native-' : ''}${name}-v1.1.0`;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function run(fixture, name) {
  const step = steps.find(value => value.name === name);
  assert.ok(step, `missing aggregate step: ${name}`);
  return spawnSync('bash', ['-euo', 'pipefail', '-c', step.run], {
    cwd: fixture.directory, encoding: 'utf8', env: {...process.env,
      PYTHONDONTWRITEBYTECODE: '1', GITHUB_REPOSITORY: 'ntanwir10/GuardScan', GITHUB_RUN_ID: '42',
      RELEASE_TAG: 'v1.1.0', RELEASE_BUILD_WORKFLOW_SHA: 'a'.repeat(40),
      PATH: fixture.directory + path.delimiter + path.dirname(process.execPath) + path.delimiter + process.env.PATH},
  });
}

function aggregateFixture(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-aggregate-'));
  const artifacts = [];
  const files = [];
  const write = (transport, name, bytes, payload = false) => {
    const file = path.join(directory, 'collected', transport, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, bytes);
    files.push(name);
    if (payload) artifacts.push({id: name, filename: path.basename(name), size: Buffer.byteLength(bytes), sha256: digest(bytes)});
  };
  try {
    for (const name of transports) fs.mkdirSync(path.join(directory, 'collected', name), {recursive: true});
    for (const target of targets) {
      write(target, `native/guardscan-${target}.zip`, `${target} archive`, true);
      write(target, `wheel/guardscan-${target}.whl`, `${target} wheel`, true);
      write(target, `native/guardscan-${target}.spdx.json`, '{}');
      write(target, `native/${target}.provenance.sigstore.json`, '{}');
    }
    write('darwin-arm64', 'native/guardscan-darwin-arm64.dmg', 'disk image', true);
    write('darwin-arm64', 'native/darwin-arm64.apple-notarization.json', '{}');
    write('darwin-arm64', 'native/darwin-arm64-license.txt', 'license');
    write('npm', 'guardscan-1.1.0.tgz', 'npm archive', true);
    write('npm-provenance', 'npm.provenance.sigstore.json', '{}');
    fs.mkdirSync(path.join(directory, '.github/scripts'), {recursive: true});
    fs.copyFileSync(path.join(__dirname, 'verify-artifact-download.py'), path.join(directory, '.github/scripts/verify-artifact-download.py'));
    fs.symlinkSync(path.join(root, 'cli'), path.join(directory, 'cli'), 'dir');
    callback({directory, artifacts, files: files.map(name => path.basename(name)), write});
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

function manifest(f) {
  fs.writeFileSync(path.join(f.directory, 'release/release-manifest.json'), JSON.stringify({artifacts: f.artifacts}));
}

test('aggregate downloads only the five finalizer artifacts and separate npm transports', () => {
  const downloads = steps.filter(step => step.uses?.startsWith('actions/download-artifact@'));
  assert.ok(downloads.every(step => !step.with.pattern));
  assert.deepEqual(downloads.map(step => step.with.name).sort(), transports.map(name => transportName(name).replace('v1.1.0', '${{ inputs.tag }}')).sort());
  for (const name of transports) {
    assert.equal(downloads.find(step => step.with.name === transportName(name).replace('v1.1.0', '${{ inputs.tag }}')).with.path, `collected/${name}`);
  }
  const guard = steps.find(step => step.name === 'Authenticate every release transport before manifest assembly');
  assert.equal(guard.env.GH_TOKEN, '${{ github.token }}');
  assert.equal(guard.env.RELEASE_TAG, '${{ inputs.tag }}');
  assert.equal(guard.shell, 'bash');
  const ordered = [guard.name, 'Reject links and collect release assets', 'Build production manifest from all native and wheel metadata', 'Produce and sign aggregate checksums', 'Keyless-sign aggregate checksums'].map(name => steps.findIndex(step => step.name === name));
  assert.ok(ordered.every((index, position) => index >= 0 && (position === 0 || index > ordered[position - 1])));
});

test('actual aggregate collection retains native, wheel, dmg and proof assets before verified checksums', () => aggregateFixture(f => {
  assert.equal(run(f, 'Reject links and collect release assets').status, 0);
  manifest(f);
  const result = run(f, 'Produce and sign aggregate checksums');
  assert.equal(result.status, 0, result.stderr);
  for (const file of f.files) assert.ok(fs.readFileSync(path.join(f.directory, 'release/SHA256SUMS'), 'utf8').includes(`  ${file}\n`), file);
}));

for (const [name, change, message] of [
  ['rogue native input transport', f => f.write('release-native-input-rogue-v1.1.0', 'injected.zip', 'injected'), /Unexpected release transport inventory/],
  ['flattened filename collision', f => f.write('npm', 'guardscan-linux-x64-glibc.zip', 'collision'), /EEXIST/],
  ['link', f => fs.symlinkSync('/etc/hosts', path.join(f.directory, 'collected/npm/link.txt')), /link or special file|Command failed/],
]) test(`actual aggregate collection rejects ${name}`, () => aggregateFixture(f => {
  change(f);
  const result = run(f, 'Reject links and collect release assets');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
}));

for (const [name, bytes, message] of [
  ['size drift', 'short', /artifact size mismatch/],
  ['digest drift', 'x'.repeat('linux-x64-glibc archive'.length), /artifact digest mismatch/],
]) test(`actual aggregate refuses checksums for ${name}`, () => aggregateFixture(f => {
  assert.equal(run(f, 'Reject links and collect release assets').status, 0);
  manifest(f);
  fs.writeFileSync(path.join(f.directory, 'release/guardscan-linux-x64-glibc.zip'), bytes);
  const result = run(f, 'Produce and sign aggregate checksums');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
  assert.equal(fs.existsSync(path.join(f.directory, 'release/SHA256SUMS')), false);
}));

function authenticatedTransports(f) {
  const artifacts = transports.map((name, index) => ({id: index + 1, name: transportName(name), expired: false, workflow_run: {id: 42}}));
  execFileSync('python3', ['-c', [
    'import pathlib,sys,zipfile',
    'root=pathlib.Path(sys.argv[1])',
    'for index,name in enumerate(sys.argv[2:]):',
    ' with zipfile.ZipFile(root / (str(index+1)+".zip"), "w") as archive:',
    '  for file in (root / "collected" / name).rglob("*"):',
    '   if file.is_file(): archive.write(file, file.relative_to(root / "collected" / name))',
  ].join('\n'), f.directory, ...transports]);
  for (const artifact of artifacts) artifact.digest = 'sha256:' + digest(fs.readFileSync(path.join(f.directory, `${artifact.id}.zip`)));
  fs.writeFileSync(path.join(f.directory, 'metadata.json'), JSON.stringify([{artifacts}]));
  fs.writeFileSync(path.join(f.directory, 'gh'), `#!${process.execPath}\n` + [
    "const fs=require('fs'),path=require('path'); const args=process.argv.slice(2);",
    "fs.appendFileSync(path.join(__dirname,'calls.jsonl'),JSON.stringify(args)+'\\n');",
    "const id=args.at(-1).match(/artifacts\\/(\\d+)\\/zip$/)?.[1];",
    "process.stdout.write(fs.readFileSync(path.join(__dirname,id?id+'.zip':'metadata.json')));",
  ].join('\n'), {mode: 0o755});
}

test('aggregate authenticates all seven exact transports against artifact-service ZIP bytes', () => aggregateFixture(f => {
  authenticatedTransports(f);
  const result = run(f, 'Authenticate every release transport before manifest assembly');
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(path.join(f.directory, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(args => args.at(-1).endsWith('/zip')).length, 7);
}));

for (const target of ['linux-x64-glibc', 'npm', 'npm-provenance']) test(`aggregate rejects unauthenticated ${target} transport bytes`, () => aggregateFixture(f => {
  authenticatedTransports(f);
  fs.writeFileSync(path.join(f.directory, 'collected', target, 'unrequested.txt'), 'injected');
  const result = run(f, 'Authenticate every release transport before manifest assembly');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /inventories differ/);
}));
