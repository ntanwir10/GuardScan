#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const {parseNpmPackResult} = require('./release/npm-artifact');
const {assertCompiledRuntimeFilesClean} = require('./release/runtime-artifact-policy');

const packageRoot = path.resolve(__dirname, '..');
const expectedVersion = require(path.join(packageRoot, 'package.json')).version;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-package-smoke-'));
const npmEnv = {
  ...process.env,
  npm_config_cache: path.join(tempRoot, 'npm-cache'),
};

try {
  const tarball = resolveTarball(process.argv.slice(2), tempRoot, npmEnv);
  const project = path.join(tempRoot, 'installed-project');
  const globalPrefix = path.join(tempRoot, 'global-prefix');
  const home = path.join(tempRoot, 'home');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
    name: 'guardscan-package-smoke', version: '1.0.0', private: true,
  }));
  fs.writeFileSync(path.join(project, 'index.js'), 'module.exports = () => 42;\n');
  runNpm(
    [
      'install',
      '--global',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--prefix',
      globalPrefix,
      tarball,
    ],
    project,
    npmEnv
  );

  const installedPackage = process.platform === 'win32'
    ? path.join(globalPrefix, 'node_modules', 'guardscan')
    : path.join(globalPrefix, 'lib', 'node_modules', 'guardscan');
  const files = new Set(listPackageFiles(installedPackage));
  assertCompiledRuntimeFilesClean(installedPackage, files, 'npm packed runtime');
  for (const required of [
    'package.json',
    'dist/index.js',
    'schemas/guardscan.scan.v1.schema.json',
    'schemas/guardscan.release-manifest.v1.schema.json',
    'schemas/guardscan.release-approval.v1.schema.json',
    'schemas/guardscan.release-state.v1.schema.json',
    'schemas/sarif-schema-2.1.0.json',
    'schemas/spdx-2.3.schema.json',
    'schemas/cyclonedx-1.7.schema.json',
    'schemas/spdx.schema.json',
    'schemas/jsf-0.82.schema.json',
    'schemas/cryptography-defs.schema.json',
    'README.md',
    'LICENSE',
  ]) {
    assert(files.has(required), `package is missing ${required}`);
  }
  for (const file of files) {
    assert(!file.startsWith('src/'), `package unexpectedly contains ${file}`);
    assert(!file.startsWith('__tests__/'), `package unexpectedly contains ${file}`);
    assert(!file.startsWith('coverage/'), `package unexpectedly contains ${file}`);
    assert(!file.includes('.env'), `package unexpectedly contains ${file}`);
    assert(!file.includes('.guardscan'), `package unexpectedly contains ${file}`);
  }

  const cli = process.platform === 'win32'
    ? path.join(globalPrefix, 'guardscan.cmd')
    : path.join(globalPrefix, 'bin', 'guardscan');
  assert(fs.existsSync(cli), `global install did not create the GuardScan shim at ${cli}`);
  const cliCommand = process.platform === 'win32' ? process.execPath : cli;
  const cliPrefix = process.platform === 'win32'
    ? [path.join(installedPackage, 'dist', 'index.js')]
    : [];
  if (process.platform === 'win32') {
    const shim = fs.readFileSync(cli, 'utf8').replace(/\\/g, '/');
    assert(shim.includes('node_modules/guardscan/dist/index.js'), 'Windows shim has the wrong target');
  }
  const env = {
    ...npmEnv,
    GUARDSCAN_HOME: home,
    HOME: home,
    USERPROFILE: home,
    GUARDSCAN_NO_TELEMETRY: 'true',
  };
  const version = run(cliCommand, [...cliPrefix, '--version'], project, env);
  const versionLines = version.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const reportedVersion = versionLines.at(-1);
  assert(
    reportedVersion === expectedVersion,
    `installed CLI reported ${JSON.stringify(reportedVersion)}; expected ${expectedVersion}`
  );
  const help = run(cliCommand, [...cliPrefix, '--help'], project, env);
  for (const command of ['scan', 'security', 'vuln|cve', 'telemetry', 'cache']) {
    assert(help.stdout.includes(command), `installed CLI help is missing ${command}`);
  }
  run(cliCommand, [...cliPrefix, '--no-telemetry', 'init'], project, env);
  const config = parseJsonLikeYaml(path.join(home, '.guardscan', 'config.yml'));
  assert(config.telemetryEnabled === false, 'installed CLI did not default telemetry off');
  assert(config.offlineMode === true, 'installed CLI did not default offline mode on');

  const output = path.join(project, 'scan.json');
  run(cliCommand, [...cliPrefix,
    '--no-telemetry',
    'scan',
    '--offline',
    '--no-cve',
    '--skip-tests',
    '--skip-ai',
    '--format',
    'json',
    '--output',
    output,
  ], project, env);
  const scan = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert(scan.schemaVersion === 'guardscan.scan.v1', 'installed scan emitted the wrong schema');
  assert(scan.command === 'scan', 'installed scan emitted the wrong command identity');
  assert(scan.run.offline === true, 'installed scan did not record offline execution');
  assert(scan.run.allowPartial === false, 'installed scan recorded an unrequested partial policy');
  assert(scan.run.executionMode === 'static-analysis', 'installed scan executed project code by default');
  assert(scan.policy.exitCode === 0, 'installed scan JSON disagrees with its successful exit code');
  const dependencyScanner = scan.security.scanners.find(entry => entry.scanner === 'dependencies');
  assert(dependencyScanner && dependencyScanner.status === 'skipped', '--no-cve did not skip dependency scanning');
  assert(dependencyScanner.skipReason === 'disabled', '--no-cve emitted the wrong skip reason');

  const spdxOutput = path.join(project, 'sbom-spdx.json');
  const cycloneDxOutput = path.join(project, 'sbom-cyclonedx.json');
  run(cliCommand, [...cliPrefix,
    '--no-telemetry', '--offline', 'sbom', '--format', 'spdx', '--output', spdxOutput,
  ], project, env);
  run(cliCommand, [...cliPrefix,
    '--no-telemetry', '--offline', 'sbom', '--format', 'cyclonedx', '--output', cycloneDxOutput,
  ], project, env);
  validateSboms(
    JSON.parse(fs.readFileSync(spdxOutput, 'utf8')),
    JSON.parse(fs.readFileSync(cycloneDxOutput, 'utf8'))
  );

  const telemetry = run(
    cliCommand,
    [...cliPrefix, '--no-telemetry', 'telemetry', 'status'],
    project,
    env
  );
  assert(telemetry.stdout.includes('Consent: disabled'), 'installed telemetry consent default is wrong');
  assert(telemetry.stdout.includes('Pending events: 0'), 'installed telemetry outbox is not empty');
  process.stdout.write(`Package smoke passed: ${path.basename(tarball)}\n`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function runNpm(args, cwd, env) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && fs.existsSync(npmCli)) {
    return run(process.execPath, [npmCli, ...args], cwd, env);
  }
  assert(process.platform !== 'win32', 'npm_execpath is required for shell-free Windows smoke tests');
  return run('npm', args, cwd, env);
}

function resolveTarball(argv, destination, env) {
  const index = argv.indexOf('--tarball');
  let supplied = index >= 0 ? argv[index + 1] : process.env.GUARDSCAN_PACKAGE_TARBALL;
  if (!supplied && process.env.GUARDSCAN_PACKAGE_ARTIFACT_DIR) {
    const artifactDir = path.resolve(process.env.GUARDSCAN_PACKAGE_ARTIFACT_DIR);
    const metadata = JSON.parse(fs.readFileSync(path.join(artifactDir, 'npm-artifact.json'), 'utf8'));
    supplied = path.join(artifactDir, metadata.filename);
  }
  if (supplied) {
    const resolved = path.resolve(supplied);
    const stat = fs.statSync(resolved);
    assert(stat.isFile() && resolved.endsWith('.tgz'), `invalid package tarball: ${resolved}`);
    return resolved;
  }
  const packed = runNpm(
    ['pack', '--json', '--pack-destination', destination],
    packageRoot,
    env
  );
  const packResult = parseNpmPackResult(packed.stdout);
  return path.join(destination, packResult.filename);
}

function listPackageFiles(root) {
  const files = [];
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, next);
      else if (entry.isFile()) files.push(next);
    }
  }
  visit(root);
  return files;
}

function run(command, args, cwd, env = process.env, allowed = [0]) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (!allowed.includes(result.status)) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}\n${result.stderr}`
    );
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateSboms(spdx, cyclonedx) {
  const ajv = new Ajv({allErrors: true, strict: false});
  addFormats(ajv);
  ajv.addFormat('iri-reference', true);
  ajv.addFormat('idn-email', true);
  ajv.addSchema(readSchema('spdx.schema.json'), 'spdx.schema.json');
  ajv.addSchema(readSchema('jsf-0.82.schema.json'), 'jsf-0.82.schema.json');
  ajv.addSchema(readSchema('cryptography-defs.schema.json'), 'cryptography-defs.schema.json');
  const validateSpdx = ajv.compile(readSchema('spdx-2.3.schema.json'));
  const validateCycloneDx = ajv.compile(readSchema('cyclonedx-1.7.schema.json'));
  assert(validateSpdx(spdx), `installed CLI emitted invalid SPDX: ${ajv.errorsText(validateSpdx.errors)}`);
  assert(
    validateCycloneDx(cyclonedx),
    `installed CLI emitted invalid CycloneDX: ${ajv.errorsText(validateCycloneDx.errors)}`
  );
}

function readSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, 'schemas', name), 'utf8'));
}

function parseJsonLikeYaml(file) {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/);
    if (!match) continue;
    if (match[2] === 'true') values[match[1]] = true;
    else if (match[2] === 'false') values[match[1]] = false;
    else values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}
