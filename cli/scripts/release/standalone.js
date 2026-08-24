'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const {builtinModules} = require('module');
const esbuild = require('esbuild');
const {inject} = require('postject');
const {assertRuntimeArtifactClean} = require('./runtime-artifact-policy');

const PROTOTYPE_SCHEMA = 'guardscan.standalone-prototype.v1';
const RUNTIME_CAPABILITY_SCHEMA = 'guardscan.runtime-capabilities.v1';
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const OPTIONAL_EXTERNALS = Object.freeze(['chartjs-node-canvas', 'tiktoken']);
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
const MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024;
const BUILTIN_MODULES = new Set(builtinModules.flatMap(name => [name, name.replace(/^node:/, '')]));
const TRANSIENT_RENAME_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);
const RENAME_RETRY_DELAYS_MS = Object.freeze([50, 100, 200, 400, 800, 1000, 1500, 2000]);

function hostPlatform() {
  const osName = {darwin: 'darwin', linux: 'linux', win32: 'windows'}[process.platform];
  if (!osName) throw new Error(`standalone prototypes do not support host platform ${process.platform}`);
  if (!['arm64', 'x64'].includes(process.arch)) {
    throw new Error(`standalone prototypes do not support host architecture ${process.arch}`);
  }
  return {os: osName, arch: process.arch};
}

function assertEmbeddableNodeRuntime() {
  const shared = process.config?.variables?.node_shared;
  if (shared === true || shared === 'true') {
    throw new Error(
      'standalone prototype requires a self-contained Node executable; '
      + 'the active Node runtime is linked against a shared libnode'
    );
  }
  const stat = fs.statSync(process.execPath);
  if (!stat.isFile()) throw new Error(`active Node executable is not a regular file: ${process.execPath}`);
}

function bundleOptions(entryPoint, outputFile) {
  return {
    entryPoints: [entryPoint],
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    splitting: false,
    sourcemap: false,
    legalComments: 'eof',
    metafile: true,
    logLevel: 'warning',
    external: [
      'chartjs-node-canvas',
      'chartjs-node-canvas/*',
      'tiktoken',
      'tiktoken/*',
    ],
  };
}

function externalPackages(metafile) {
  const imports = Object.values(metafile.outputs).flatMap(output => output.imports || []);
  return [...new Set(imports
    .filter(entry => (
      entry.external
      && !entry.path.startsWith('node:')
      && !BUILTIN_MODULES.has(entry.path)
      && !BUILTIN_MODULES.has(entry.path.split('/').slice(0, 2).join('/'))
    ))
    .map(entry => entry.path.split('/').slice(0, entry.path.startsWith('@') ? 2 : 1).join('/')))]
    .sort();
}

function assertExternalAllowlist(metafile) {
  const packages = externalPackages(metafile);
  const unexpected = packages.filter(name => !OPTIONAL_EXTERNALS.includes(name));
  if (unexpected.length > 0) {
    throw new Error(`standalone bundle contains undeclared runtime packages: ${unexpected.join(', ')}`);
  }
  return packages;
}

function hashRegularFile(file, maxBytes, label) {
  const descriptor = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
      throw new Error(`${label} size is outside the supported range: ${file}`);
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < stat.size) {
      const bytes = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
      if (bytes === 0) throw new Error(`${label} ended before its declared size: ${file}`);
      hash.update(buffer.subarray(0, bytes));
      offset += bytes;
    }
    return {size: stat.size, sha256: hash.digest('hex')};
  } finally {
    fs.closeSync(descriptor);
  }
}

async function renameWithTransientRetry(source, destination, options = {}) {
  const rename = options.rename || fs.promises.rename;
  const wait = options.wait || (delay => new Promise(resolve => setTimeout(resolve, delay)));
  const delays = options.delays || RENAME_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (!TRANSIENT_RENAME_CODES.has(error?.code) || attempt >= delays.length) throw error;
      await wait(delays[attempt]);
    }
  }
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} ${args.join(' ')} exited ${result.status}: `
      + `${String(result.stderr || result.stdout || '').trim()}`
    );
  }
  return result;
}

function isolatedEnvironment(home) {
  const env = {
    HOME: home,
    USERPROFILE: home,
    GUARDSCAN_HOME: path.join(home, '.guardscan'),
    GUARDSCAN_NO_TELEMETRY: 'true',
    GUARDSCAN_OFFLINE: 'true',
    PATH: '',
    NO_PROXY: '*',
    LANG: 'C.UTF-8',
  };
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

function assertSuccessfulOutput(result, expected, label) {
  if (!result.stdout.split(/\r?\n/).map(line => line.trim()).includes(expected)) {
    throw new Error(`${label} output did not contain ${expected}`);
  }
}

function assertReducedCapabilityEvidence(evidence) {
  const tokenCounting = evidence?.tokenCounting;
  const chartRendering = evidence?.chartRendering;
  const valid = evidence?.schemaVersion === RUNTIME_CAPABILITY_SCHEMA
    && tokenCounting?.dependency === 'tiktoken'
    && tokenCounting.dependencyAvailable === false
    && tokenCounting.mode === 'estimated'
    && Number.isInteger(tokenCounting.sampleTokenCount)
    && tokenCounting.sampleTokenCount > 0
    && tokenCounting.safeFallbackObserved === true
    && chartRendering?.dependency === 'chartjs-node-canvas'
    && chartRendering.dependencyAvailable === false
    && chartRendering.mode === 'unavailable'
    && chartRendering.safeFallbackObserved === true;
  if (!valid) {
    throw new Error('standalone reduced-capability contract failed');
  }
  return evidence;
}

function smokeStandalone(executable, version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-standalone-smoke-'));
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  try {
    fs.mkdirSync(project, {recursive: true});
    fs.mkdirSync(home, {recursive: true});
    fs.writeFileSync(path.join(project, 'package.json'), `${JSON.stringify({
      name: 'guardscan-standalone-smoke',
      version: '1.0.0',
      private: true,
    }, null, 2)}\n`);
    fs.writeFileSync(path.join(project, 'index.js'), 'module.exports = () => 42;\n');
    const env = isolatedEnvironment(home);
    assertSuccessfulOutput(run(executable, ['--version'], project, env), version, 'standalone version');
    const help = run(executable, ['--help'], project, env);
    if (!help.stdout.includes('scan')) throw new Error('standalone help output is missing scan');

    const scanFile = path.join(project, 'scan.json');
    run(executable, [
      '--no-telemetry', 'scan', '--offline', '--no-cve', '--skip-tests', '--skip-ai',
      '--format', 'json', '--output', scanFile,
    ], project, env);
    const scan = JSON.parse(fs.readFileSync(scanFile, 'utf8'));
    if (scan.schemaVersion !== 'guardscan.scan.v1'
        || scan.run?.executionMode !== 'static-analysis'
        || scan.run?.offline !== true) {
      throw new Error('standalone offline scan contract failed');
    }

    const sbomFile = path.join(project, 'sbom.spdx.json');
    run(executable, [
      '--no-telemetry', 'sbom', '--offline', '--format', 'spdx', '--output', sbomFile,
    ], project, env);
    const sbom = JSON.parse(fs.readFileSync(sbomFile, 'utf8'));
    if (sbom.spdxVersion !== 'SPDX-2.3' || sbom.dataLicense !== 'CC0-1.0') {
      throw new Error('standalone SPDX contract failed');
    }

    const cycloneFile = path.join(project, 'sbom.cyclonedx.json');
    run(executable, [
      '--no-telemetry', 'sbom', '--offline', '--format', 'cyclonedx', '--output', cycloneFile,
    ], project, env);
    const cyclone = JSON.parse(fs.readFileSync(cycloneFile, 'utf8'));
    if (cyclone.bomFormat !== 'CycloneDX' || cyclone.specVersion !== '1.7') {
      throw new Error('standalone CycloneDX contract failed');
    }

    const telemetry = run(executable, ['--no-telemetry', 'telemetry', 'status'], project, env);
    if (!telemetry.stdout.includes('Consent: disabled')) {
      throw new Error('standalone telemetry opt-out contract failed');
    }
    const capabilityResult = run(
      executable,
      ['--no-telemetry', 'capabilities', '--json'],
      project,
      env
    );
    let optionalCapabilities;
    try {
      optionalCapabilities = assertReducedCapabilityEvidence(
        JSON.parse(capabilityResult.stdout.trim())
      );
    } catch (error) {
      throw new Error(
        `standalone capability evidence was invalid: ${error instanceof Error ? error.message : error}`
      );
    }
    const optionalCapabilitiesUnavailableSafely =
      optionalCapabilities.tokenCounting.safeFallbackObserved === true
      && optionalCapabilities.chartRendering.safeFallbackObserved === true;
    return {
      valid: true,
      nodeAbsentFromPath: true,
      packageManagersAbsentFromPath: true,
      optionalCapabilitiesUnavailableSafely,
      optionalCapabilities,
      spdx: true,
      cyclonedx: true,
    };
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

async function prepareExecutable(bundleFile, blobFile, executable) {
  const seaConfig = `${blobFile}.json`;
  fs.writeFileSync(seaConfig, `${JSON.stringify({
    main: bundleFile,
    output: blobFile,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  run(process.execPath, ['--experimental-sea-config', seaConfig], path.dirname(bundleFile), process.env);
  assertRuntimeArtifactClean(fs.readFileSync(blobFile), 'standalone SEA payload');
  fs.copyFileSync(process.execPath, executable);
  fs.chmodSync(executable, 0o755);
  if (process.platform === 'darwin') {
    run('codesign', ['--remove-signature', executable], path.dirname(executable), process.env);
  }
  await inject(executable, 'NODE_SEA_BLOB', fs.readFileSync(blobFile), {
    sentinelFuse: SEA_FUSE,
    ...(process.platform === 'darwin' ? {machoSegmentName: 'NODE_SEA'} : {}),
  });
  if (process.platform === 'darwin') {
    run('codesign', ['--sign', '-', '--force', executable], path.dirname(executable), process.env);
  }
  fs.rmSync(seaConfig, {force: true});
}

async function buildHostPrototype(source, outputDir) {
  assertEmbeddableNodeRuntime();
  const platform = hostPlatform();
  const resolved = path.resolve(outputDir);
  if (path.dirname(resolved) === resolved) throw new Error('refusing to use a filesystem root as prototype output');
  if (fs.existsSync(resolved)) throw new Error(`standalone prototype output already exists: ${resolved}`);
  const entryPoint = path.join(source.packageRoot, 'dist', 'index.js');
  if (!fs.existsSync(entryPoint)) throw new Error('standalone prototype requires a completed CLI build');

  const parent = path.dirname(resolved);
  fs.mkdirSync(parent, {recursive: true, mode: 0o700});
  const stage = path.join(parent, `.${path.basename(resolved)}.tmp-${process.pid}-${crypto.randomUUID()}`);
  const executableName = process.platform === 'win32' ? 'guardscan.exe' : 'guardscan';
  try {
    fs.mkdirSync(stage, {mode: 0o700});
    const bundleFile = path.join(stage, 'guardscan.bundle.cjs');
    const blobFile = path.join(stage, 'guardscan.blob');
    const executable = path.join(stage, executableName);
    const build = await esbuild.build(bundleOptions(entryPoint, bundleFile));
    const externals = assertExternalAllowlist(build.metafile);
    assertRuntimeArtifactClean(fs.readFileSync(bundleFile), 'standalone bundle');
    const bundle = hashRegularFile(bundleFile, MAX_BUNDLE_BYTES, 'standalone bundle');
    await prepareExecutable(bundleFile, blobFile, executable);
    const smoke = smokeStandalone(executable, source.version);
    const binary = hashRegularFile(executable, MAX_EXECUTABLE_BYTES, 'standalone executable');
    const metadata = {
      schemaVersion: PROTOTYPE_SCHEMA,
      productionReady: false,
      version: source.version,
      tag: source.tag,
      commit: source.commit,
      createdAt: new Date().toISOString(),
      platform,
      node: process.version.slice(1),
      toolchain: {
        esbuild: require('esbuild/package.json').version,
        postject: require('postject/package.json').version,
      },
      capabilities: {
        coreScan: true,
        sbom: true,
        chartRendering: smoke.optionalCapabilities.chartRendering.dependencyAvailable,
        accurateTokenCounting: smoke.optionalCapabilities.tokenCounting.mode === 'accurate',
      },
      optionalExternalPackages: externals,
      bundle,
      executable: {filename: executableName, ...binary},
      smoke,
      blockers: [
        'reproducible archive generation',
        'platform production signing and notarization',
        'artifact SBOM and provenance',
        'complete host-native target matrix',
      ],
    };
    fs.writeFileSync(path.join(stage, 'standalone-prototype.json'), `${JSON.stringify(metadata, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    fs.rmSync(bundleFile, {force: true});
    fs.rmSync(blobFile, {force: true});
    await renameWithTransientRetry(stage, resolved);
    return {outputDir: resolved, metadata};
  } finally {
    fs.rmSync(stage, {recursive: true, force: true});
  }
}

module.exports = {
  OPTIONAL_EXTERNALS,
  PROTOTYPE_SCHEMA,
  assertEmbeddableNodeRuntime,
  assertExternalAllowlist,
  assertReducedCapabilityEvidence,
  buildHostPrototype,
  bundleOptions,
  externalPackages,
  hostPlatform,
  renameWithTransientRetry,
  smokeStandalone,
};
