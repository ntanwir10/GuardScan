#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const SUPPORTED_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

function commandFor(manager) {
  if (manager === 'npm' && process.platform === 'win32') return 'npm.cmd';
  if (manager === 'pnpm' && process.platform === 'win32') return 'pnpm.cmd';
  if (manager === 'yarn' && process.platform === 'win32') return 'yarn.cmd';
  if (manager === 'bun' && process.platform === 'win32') return 'bun.exe';
  return manager;
}

function installArgs(manager, tarball) {
  if (manager === 'npm') return ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball];
  if (manager === 'pnpm') return ['add', '--ignore-scripts', tarball];
  if (manager === 'yarn') return ['add', tarball];
  if (manager === 'bun') return ['add', '--ignore-scripts', '--yarn', tarball];
  throw new Error(`Unsupported package manager: ${manager}`);
}

function execArgs(manager, cliArgs) {
  if (manager === 'npm') return ['exec', '--', 'guardscan', ...cliArgs];
  if (manager === 'pnpm') return ['exec', 'guardscan', ...cliArgs];
  if (manager === 'yarn') return ['guardscan', ...cliArgs];
  if (manager === 'bun') return ['run', 'guardscan', ...cliArgs];
  throw new Error(`Unsupported package manager: ${manager}`);
}

function parseManager(argv) {
  const index = argv.indexOf('--manager');
  const manager = index >= 0 ? argv[index + 1] : process.env.GUARDSCAN_PACKAGE_MANAGER;
  if (!manager || !SUPPORTED_MANAGERS.has(manager)) {
    throw new Error(`--manager must be one of: ${[...SUPPORTED_MANAGERS].join(', ')}`);
  }
  return manager;
}

function parseTarball(argv) {
  const index = argv.indexOf('--tarball');
  let value = index >= 0 ? argv[index + 1] : process.env.GUARDSCAN_PACKAGE_TARBALL;
  if (!value && process.env.GUARDSCAN_PACKAGE_ARTIFACT_DIR) {
    const artifactDir = path.resolve(process.env.GUARDSCAN_PACKAGE_ARTIFACT_DIR);
    const metadata = JSON.parse(fs.readFileSync(path.join(artifactDir, 'npm-artifact.json'), 'utf8'));
    value = path.join(artifactDir, metadata.filename);
  }
  if (!value) return undefined;
  const resolved = path.resolve(value);
  if (!fs.statSync(resolved).isFile() || !resolved.endsWith('.tgz')) {
    throw new Error(`invalid package tarball: ${resolved}`);
  }
  return resolved;
}

function main(argv = process.argv.slice(2)) {
  const manager = parseManager(argv);
  const packageRoot = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `guardscan-${manager}-smoke-`));
  const npmEnv = {...process.env, npm_config_cache: path.join(tempRoot, 'npm-cache')};

  try {
    const suppliedTarball = parseTarball(argv);
    let tarball = suppliedTarball;
    if (!tarball) {
      const pack = run(commandFor('npm'), ['pack', '--json', '--pack-destination', tempRoot], packageRoot, npmEnv);
      const packed = JSON.parse(pack.stdout)[0];
      tarball = path.join(tempRoot, packed.filename);
    }
    const project = path.join(tempRoot, 'project');
    const home = path.join(tempRoot, 'home');
    fs.mkdirSync(project, {recursive: true});
    fs.mkdirSync(home, {recursive: true});
    fs.writeFileSync(path.join(project, 'package.json'), `${JSON.stringify({
      name: `guardscan-${manager}-smoke`,
      version: '1.0.0',
      private: true,
    }, null, 2)}\n`);
    if (manager === 'yarn') {
      fs.writeFileSync(path.join(project, '.yarnrc.yml'), 'nodeLinker: node-modules\nenableScripts: false\n');
    }

    const env = {
      ...npmEnv,
      HOME: home,
      USERPROFILE: home,
      GUARDSCAN_HOME: path.join(home, '.guardscan-state'),
      GUARDSCAN_NO_TELEMETRY: 'true',
      YARN_ENABLE_SCRIPTS: 'false',
    };
    run(commandFor(manager), installArgs(manager, tarball), project, env);

    const version = runCli(manager, ['--version'], project, env);
    const versionLines = version.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    assert(
      versionLines.includes(packageJson.version),
      `${manager} output did not contain the exact version line ${packageJson.version}`
    );
    const help = runCli(manager, ['--help'], project, env);
    assert(help.stdout.includes('scan'), `${manager} CLI help is missing scan`);

    const output = path.join(project, 'scan.json');
    runCli(manager, scanArgsFor(manager, output), project, env);
    const scan = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert(scan.schemaVersion === 'guardscan.scan.v1', `${manager} emitted the wrong scan schema`);
    assert(scan.run?.executionMode === 'static-analysis', `${manager} did not preserve safe execution mode`);
    assert(scan.run?.offline === true, `${manager} did not preserve offline mode`);
    assert(scan.run?.allowPartial === false, `${manager} weakened the partial-inventory policy`);

    const telemetry = runCli(manager, ['--no-telemetry', 'telemetry', 'status'], project, env);
    assert(telemetry.stdout.includes('Consent: disabled'), `${manager} did not preserve telemetry opt-out`);
    process.stdout.write(`${manager} package-manager smoke passed: ${path.basename(tarball)}\n`);
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true});
  }
}

function runCli(manager, args, cwd, env) {
  return run(commandFor(manager), execArgs(manager, args), cwd, env);
}

function scanArgsFor(_manager, output) {
  return [
    '--no-telemetry', 'scan', '--offline', '--no-cve', '--skip-tests', '--skip-ai',
    '--format', 'json', '--output', output,
  ];
}

function run(command, args, cwd, env) {
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
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  commandFor,
  execArgs,
  installArgs,
  main,
  parseManager,
  parseTarball,
  scanArgsFor,
};
