#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  assertDocumentMatchesSource,
  assertStateReferencesManifest,
  createPlan,
  prepareRelease,
  summarizeState,
  validateDocument,
  validateSource,
} = require('./lib');
const {
  classifyChannelCatalog,
  renderAdapters,
  renderChannelCatalog,
  writeChannelCatalogOutput,
  writeRenderedOutput,
} = require('./renderers');
const {
  buildNpmArtifact,
  queryNpmRemote,
  verifyNpmArtifact,
} = require('./npm-artifact');
const {
  manifestDigest,
  transitionState,
  writeStateTransition,
} = require('./ledger');
const {validateAdapters} = require('./validators');
const {buildHostPrototype} = require('./standalone');
const {
  appendEvent,
  materializeReleaseState,
  readEvents,
} = require('./events');
const {createPromotionDecision} = require('./promotion');
const {classifyRemoteArtifact} = require('./remote');
const {planRollback, reconcileRelease} = require('./reconcile');
const {
  verifyManifestFiles,
  writeReleaseManifest,
} = require('./manifest');
const {buildWheel, finalizeWheelArtifact} = require('./python-wheel');
const {writeArtifactSboms} = require('./artifact-sbom');
const {buildStandaloneArtifact} = require('./standalone-artifact');
const {createReleaseCandidate} = require('./candidate');

const BOOLEAN_OPTIONS = new Set(['accepted', 'check', 'native', 'requireNative']);
const COMMANDS = new Set([
  'validate',
  'candidate',
  'build',
  'manifest',
  'publish',
  'verify',
  'reconcile',
  'promote',
  'rollback',
  'plan',
  'prepare',
  'dry-run',
  'render',
  'catalog',
  'catalog-status',
  'validate-adapters',
  'standalone-prototype',
  'package',
  'verify-npm-artifact',
  'npm-preflight',
  'advance',
]);

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (BOOLEAN_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    'GuardScan release automation',
    '',
    'Usage: node scripts/release/index.js <command> [options]',
    '',
    'Release train commands:',
    '  build       Build an unsigned host SEA, artifact SBOM, or platform Python wheel',
    '  candidate   Derive an rc.N source commit from an unchanged stable release PR head',
    '  manifest    Aggregate verified builder evidence into release-manifest.json',
    '  publish     Record an idempotent remote publication result in the append-only ledger',
    '  verify      Verify local/remote identities and record acceptance or public verification',
    '  reconcile   Materialize the ledger and plan only incomplete remote operations',
    '  promote     Generate the machine 24-hour promotion decision',
    '  rollback    Append rollback_started and produce a forward-fix recovery plan',
    '  status      Materialize and summarize release state',
    '  catalog     Render or check the authoritative shared channel catalog',
    '  catalog-status  Classify shared catalog drift against the exact release source',
    '',
    'Foundation and compatibility commands:',
    '  validate, plan, prepare, dry-run, render, validate-adapters',
    '  package, verify-npm-artifact, npm-preflight, standalone-prototype',
    '  advance (legacy mutable-state compatibility only), resume',
    '',
    'Common options:',
    '  --package-root PATH      CLI package directory',
    '  --repository-root PATH   Git repository directory',
    '  --commit SHA             Exact 40-character source commit',
    '  --tag TAG                Expected v-prefixed package version',
    '  --profile PROFILE        node, native, or full',
    '  --output-dir PATH        Output directory',
    '  --output PATH            Output document path',
    '  --timestamp ISO          Canonical reproducible timestamp',
    '  --manifest PATH          Release manifest',
    '  --ledger PATH            Append-only JSONL release ledger',
    '  --idempotency-key KEY    Stable retry identity for one event',
    '  --channel CHANNEL        Distribution channel',
    '  --artifact-id ID         Manifest artifact identity',
    '  --remote-identity ID     Immutable public identity',
    '  --remote-digest SHA256   Observed public SHA-256',
    '  --manifest-url URL       Immutable GitHub release-manifest.json URL',
    '  --manifest-sha256 SHA    Exact release-manifest.json SHA-256',
    '  --generator-repository R Repository containing the catalog renderer',
    '  --generator-commit SHA   Exact renderer source commit',
    '',
  ].join('\n'));
}

function requireOptions(command, options, names) {
  for (const name of names) {
    if (!options[name]) {
      const option = name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      throw new Error(`${command} requires --${option}`);
    }
  }
}

function eventIdentity(source, options, type, payload, channel) {
  return {
    version: source.version,
    tag: source.tag,
    commit: source.commit,
    timestamp: options.timestamp,
    type,
    idempotencyKey: options.idempotencyKey,
    ...(channel ? {channel} : {}),
    payload,
  };
}

function readState(options, packageRoot) {
  if (options.ledger) return materializeReleaseState(readEvents(options.ledger));
  if (options.state) return validateDocument('state', options.state, packageRoot);
  throw new Error('status requires --ledger or --state');
}

function manifestArtifact(manifest, artifactId) {
  const artifact = manifest.artifacts.find(candidate => candidate.id === artifactId);
  if (!artifact) throw new Error(`manifest does not contain artifact ${artifactId}`);
  return artifact;
}

function platformFromOptions(options) {
  requireOptions('platform', options, ['platformOs', 'platformArch']);
  return {
    os: options.platformOs,
    arch: options.platformArch,
    ...(options.platformLibc ? {libc: options.platformLibc} : {}),
  };
}

function catalogEvidence(options, manifestFile) {
  if (!['homebrew', 'scoop'].includes(options.channel)) return undefined;
  requireOptions('catalog publication', options, [
    'catalogRepository',
    'catalogCommit',
    'catalogPullRequest',
    'catalogLockDigest',
    'catalogManifestDigest',
    'catalogPath',
    'catalogFileDigest',
  ]);
  const pullRequest = Number(options.catalogPullRequest);
  if (!Number.isSafeInteger(pullRequest) || pullRequest < 1) {
    throw new Error('catalog publication requires a positive --catalog-pull-request');
  }
  const evidence = {
    repository: options.catalogRepository,
    commit: options.catalogCommit,
    pullRequest,
    lockDigest: options.catalogLockDigest,
    manifestDigest: options.catalogManifestDigest,
    path: options.catalogPath,
    fileDigest: options.catalogFileDigest,
  };
  if (evidence.manifestDigest !== manifestDigest(manifestFile)) {
    throw new Error('catalog manifest digest does not match the exact release manifest');
  }
  return evidence;
}

function hashExecutable(file) {
  const buffer = fs.readFileSync(path.resolve(file));
  if (buffer.length <= 0) throw new Error('standalone executable is empty');
  return {
    filename: path.basename(file),
    size: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

function renderCatalogFromOptions(manifest, options) {
  requireOptions('catalog', options, [
    'manifest',
    'manifestUrl',
    'manifestSha256',
    'generatorRepository',
    'generatorCommit',
  ]);
  const manifestBytes = fs.readFileSync(path.resolve(options.manifest));
  const actualManifestSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');
  if (actualManifestSha256 !== options.manifestSha256) {
    throw new Error('catalog manifestSha256 does not match the exact manifest file');
  }
  return renderChannelCatalog(manifest, {
    manifestUrl: options.manifestUrl,
    manifestSha256: options.manifestSha256,
    generatorRepository: options.generatorRepository,
    generatorCommit: options.generatorCommit,
  });
}

async function handleBuild(source, options) {
  requireOptions('build', options, ['kind']);
  if (options.kind !== 'python-wheel-artifact') requireOptions('build', options, ['outputDir']);
  if (options.kind === 'standalone') {
    const result = await buildHostPrototype(source, options.outputDir);
    return {
      stage: 'unsigned-standalone',
      outputDir: result.outputDir,
      platform: result.metadata.platform,
      executable: result.metadata.executable,
      requiresPlatformSigning: true,
    };
  }
  if (options.kind === 'python-wheel-artifact') {
    requireOptions('build', options, [
      'wheelMetadata',
      'standaloneMetadata',
      'provenanceUrl',
      'output',
    ]);
    return finalizeWheelArtifact(
      source,
      options.wheelMetadata,
      options.standaloneMetadata,
      options.provenanceUrl,
      options.output
    ).metadata;
  }
  requireOptions('build', options, ['executable', 'platformOs', 'platformArch', 'timestamp']);
  const platform = platformFromOptions(options);
  if (options.kind === 'archive') {
    requireOptions('build', options, ['evidence']);
    return buildStandaloneArtifact(
      source,
      options.executable,
      platform,
      options.outputDir,
      options.timestamp,
      options.evidence
    ).metadata;
  }
  if (options.kind === 'python-wheel') {
    return buildWheel(
      source,
      options.executable,
      platform,
      options.outputDir,
      options.timestamp
    ).metadata;
  }
  if (options.kind === 'artifact-sbom') {
    const executable = hashExecutable(options.executable);
    return writeArtifactSboms({
      version: source.version,
      tag: source.tag,
      commit: source.commit,
      createdAt: options.timestamp,
      platformId: [platform.os, platform.arch, platform.libc].filter(Boolean).join('-'),
      nodeVersion: process.version.slice(1),
      executable,
    }, options.outputDir).metadata;
  }
  throw new Error(`unsupported build kind: ${options.kind}`);
}

function handlePublication(command, source, manifest, options) {
  requireOptions(command, options, [
    'manifest',
    'ledger',
    'channel',
    'artifactId',
    'remoteIdentity',
    'remoteDigest',
    'timestamp',
    'idempotencyKey',
  ]);
  const artifact = manifestArtifact(manifest, options.artifactId);
  if (options.artifactRoot) verifyManifestFiles(manifest, options.artifactRoot);
  const catalog = catalogEvidence(options, options.manifest);
  const classification = classifyRemoteArtifact(
    {sha256: catalog?.fileDigest || artifact.sha256},
    {identity: options.remoteIdentity, sha256: options.remoteDigest}
  );
  if (classification.integrityIncident) {
    appendEvent(options.ledger, eventIdentity(source, {
      ...options,
      idempotencyKey: `${options.idempotencyKey}:integrity-incident`,
    }, 'incident_opened', {
      incidentId: `digest-conflict:${options.channel}:${options.artifactId}`,
      kind: 'integrity',
      summary: `Remote digest conflict for ${options.artifactId}`,
    }));
    throw new Error(`remote artifact digest conflicts with ${options.artifactId}`);
  }
  const moderated = ['winget', 'chocolatey'].includes(options.channel);
  const type = command === 'publish'
    ? moderated ? 'channel_submitted' : 'channel_published'
    : options.accepted ? 'channel_accepted' : 'channel_verified';
  const result = appendEvent(options.ledger, eventIdentity(source, options, type, {
    artifactIds: [artifact.id],
    remoteIdentity: options.remoteIdentity,
    remoteDigest: options.remoteDigest,
    ...(catalog ? {catalog} : {}),
  }, options.channel));
  return {changed: result.changed, classification, event: result.event};
}

function writePromotionDecision(source, options, packageRoot) {
  requireOptions('promote', options, [
    'promotionInput',
    'output',
    'ledger',
    'idempotencyKey',
  ]);
  const input = JSON.parse(fs.readFileSync(path.resolve(options.promotionInput), 'utf8'));
  const decision = createPromotionDecision(input);
  if (decision.rc.version !== source.version || decision.rc.tag !== source.tag
      || decision.rc.commit !== source.commit) {
    throw new Error('promotion input RC identity does not match release source');
  }
  const text = `${JSON.stringify(decision, null, 2)}\n`;
  const output = path.resolve(options.output);
  if (fs.existsSync(output)) {
    if (fs.readFileSync(output, 'utf8') !== text) {
      throw new Error(`promotion decision conflicts with existing output: ${output}`);
    }
  } else {
    fs.mkdirSync(path.dirname(output), {recursive: true, mode: 0o700});
    fs.writeFileSync(output, text, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  }
  validateDocument('decision', output, packageRoot);
  const result = appendEvent(options.ledger, {
    version: source.version,
    tag: source.tag,
    commit: source.commit,
    timestamp: decision.evaluatedAt,
    type: 'promotion_decided',
    idempotencyKey: options.idempotencyKey,
    payload: {
      result: decision.result,
      eligible: decision.eligible,
      reasons: decision.reasons,
      decisionSha256: crypto.createHash('sha256').update(text).digest('hex'),
    },
  });
  return {changed: result.changed, decision};
}

async function main(argv) {
  const [command, ...rawOptions] = argv;
  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }
  const options = parseOptions(rawOptions);
  const packageRoot = path.resolve(options.packageRoot || path.resolve(__dirname, '..', '..'));

  if (command === 'status' || command === 'resume') {
    const state = readState(options, packageRoot);
    const summary = summarizeState(state);
    const output = command === 'resume'
      ? {...summary, resumable: summary.failedChannels.length === 0, nextChannels: summary.remainingChannels}
      : summary;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (!COMMANDS.has(command)) throw new Error(`Unknown command: ${command}`);
  const source = validateSource({...options, packageRoot});
  const manifest = options.manifest
    ? validateDocument('manifest', options.manifest, packageRoot)
    : undefined;
  const state = options.state ? validateDocument('state', options.state, packageRoot) : undefined;
  const approval = options.approval
    ? validateDocument('approval', options.approval, packageRoot)
    : undefined;
  if (manifest) assertDocumentMatchesSource('manifest', manifest, source);
  if (state) assertDocumentMatchesSource('state', state, source);
  if (approval) assertDocumentMatchesSource('approval', approval, source);
  if (manifest && state) assertStateReferencesManifest(state, manifest);

  if (command === 'candidate') {
    requireOptions('candidate', options, [
      'candidateVersion',
      'sourcePr',
      'sourcePrHead',
      'timestamp',
    ]);
    process.stdout.write(`${JSON.stringify(createReleaseCandidate(
      source,
      options.candidateVersion,
      options.sourcePr,
      options.sourcePrHead,
      options.timestamp
    ), null, 2)}\n`);
    return;
  }

  if (command === 'build') {
    process.stdout.write(`${JSON.stringify(await handleBuild(source, options), null, 2)}\n`);
    return;
  }

  if (command === 'manifest') {
    requireOptions('manifest', options, ['descriptor', 'output']);
    const result = writeReleaseManifest(source, options.descriptor, options.output);
    if (options.ledger) {
      requireOptions('manifest', options, ['timestamp', 'idempotencyKey']);
      appendEvent(options.ledger, eventIdentity(source, options, 'manifest_created', {
        manifestSha256: result.sha256,
        artifactIds: result.manifest.artifacts.map(artifact => artifact.id),
      }));
    }
    process.stdout.write(`${JSON.stringify({
      created: result.created,
      output: result.outputFile,
      sha256: result.sha256,
      artifacts: result.manifest.artifacts.map(artifact => artifact.id),
    }, null, 2)}\n`);
    return;
  }

  if (command === 'publish' || command === 'verify') {
    if (!manifest) throw new Error(`${command} requires --manifest`);
    process.stdout.write(`${JSON.stringify(
      handlePublication(command, source, manifest, options),
      null,
      2
    )}\n`);
    return;
  }

  if (command === 'reconcile') {
    requireOptions('reconcile', options, ['ledger']);
    const materialized = materializeReleaseState(readEvents(options.ledger));
    process.stdout.write(`${JSON.stringify({
      state: materialized,
      reconciliation: reconcileRelease(materialized),
    }, null, 2)}\n`);
    return;
  }

  if (command === 'promote') {
    const result = writePromotionDecision(source, options, packageRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.decision.eligible) process.exitCode = 2;
    return;
  }

  if (command === 'rollback') {
    requireOptions('rollback', options, ['ledger', 'timestamp', 'idempotencyKey']);
    const materialized = materializeReleaseState(readEvents(options.ledger));
    const plan = planRollback(materialized, options.knownGood);
    const result = appendEvent(options.ledger, eventIdentity(source, options, 'rollback_started', {
      knownGoodVersion: options.knownGood || null,
      forwardFixVersion: plan.forwardFixVersion,
    }));
    process.stdout.write(`${JSON.stringify({changed: result.changed, plan}, null, 2)}\n`);
    return;
  }

  if (command === 'advance') {
    requireOptions('advance', options, ['manifest', 'state', 'channel', 'expect', 'to', 'timestamp']);
    const digest = manifestDigest(options.manifest);
    const artifactIds = options.artifactIds === undefined
      ? undefined
      : options.artifactIds.split(',').map(value => value.trim()).filter(Boolean);
    const result = transitionState(state, {
      channel: options.channel,
      expectedStatus: options.expect,
      targetStatus: options.to,
      timestamp: options.timestamp,
      manifestSha256: digest,
      artifactIds,
      remoteIdentity: options.remoteIdentity,
      error: options.error,
      approval,
    });
    if (result.changed) {
      assertStateReferencesManifest(result.state, manifest);
      writeStateTransition(options.state, state, result.state);
      validateDocument('state', options.state, packageRoot);
    }
    process.stdout.write(`${JSON.stringify({
      changed: result.changed,
      channel: options.channel,
      status: result.state.channels[options.channel].status,
      manifestSha256: result.state.manifestSha256,
    }, null, 2)}\n`);
    return;
  }

  if (command === 'package') {
    requireOptions('package', options, ['outputDir']);
    const artifact = buildNpmArtifact(source, options.outputDir);
    process.stdout.write(`${JSON.stringify({
      created: artifact.created,
      filename: artifact.filename,
      size: artifact.size,
      sha256: artifact.sha256,
      integrity: artifact.integrity,
    }, null, 2)}\n`);
    return;
  }

  if (command === 'standalone-prototype') {
    requireOptions('standalone-prototype', options, ['outputDir']);
    const result = await buildHostPrototype(source, options.outputDir);
    process.stdout.write(`${JSON.stringify({
      outputDir: result.outputDir,
      version: result.metadata.version,
      platform: result.metadata.platform,
      executable: result.metadata.executable,
      productionReady: false,
    }, null, 2)}\n`);
    return;
  }

  if (command === 'verify-npm-artifact' || command === 'npm-preflight') {
    requireOptions(command, options, ['artifactDir']);
    const artifact = verifyNpmArtifact(source, options.artifactDir);
    const remote = command === 'npm-preflight' ? queryNpmRemote(artifact) : undefined;
    const output = {
      valid: true,
      filename: artifact.filename,
      size: artifact.size,
      sha256: artifact.sha256,
      integrity: artifact.integrity,
      ...(remote || {}),
    };
    if (options.githubOutput) {
      fs.appendFileSync(path.resolve(options.githubOutput), [
        `filename=${artifact.filename}`,
        `publish-required=${remote?.publishRequired === true}`,
        `matching=${remote?.matching === true}`,
        '',
      ].join('\n'), {encoding: 'utf8'});
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  if (command === 'render') {
    if (!manifest) throw new Error('render requires --manifest');
    requireOptions('render', options, ['outputDir']);
    const rendered = renderAdapters(manifest, options.channels);
    const result = writeRenderedOutput(manifest, rendered, options.outputDir, options.check === true);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === 'catalog') {
    if (!manifest) throw new Error('catalog requires --manifest');
    requireOptions('catalog', options, ['outputDir']);
    const rendered = renderCatalogFromOptions(manifest, options);
    const result = writeChannelCatalogOutput(
      rendered,
      options.outputDir,
      options.check === true
    );
    validateDocument('catalog', path.join(result.outputDir, 'channel-lock.json'), packageRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === 'catalog-status') {
    if (!manifest) throw new Error('catalog-status requires --manifest');
    requireOptions('catalog-status', options, ['catalogRoot']);
    const rendered = renderCatalogFromOptions(manifest, options);
    const result = classifyChannelCatalog(rendered, options.catalogRoot);
    if (result.classification === 'exact') {
      validateDocument(
        'catalog',
        path.join(path.resolve(options.catalogRoot), 'channel-lock.json'),
        packageRoot
      );
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === 'validate-adapters') {
    if (!manifest) throw new Error('validate-adapters requires --manifest');
    requireOptions('validate-adapters', options, ['outputDir']);
    const result = validateAdapters(manifest, options.outputDir, options.channels, {
      native: options.native === true || options.requireNative === true,
      requireNative: options.requireNative === true,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === 'prepare') {
    requireOptions('prepare', options, ['outputDir']);
    const prepared = prepareRelease(source, {
      outputDir: options.outputDir,
      profile: options.profile || 'node',
      timestamp: options.timestamp,
    });
    if (options.ledger) {
      requireOptions('prepare', options, ['timestamp', 'idempotencyKey']);
      appendEvent(options.ledger, eventIdentity(source, options, 'train_started', {
        profile: options.profile || 'node',
        channels: createPlan(source, options.profile || 'node').channels
          .filter(channel => channel.status === 'planned')
          .map(channel => channel.id),
      }));
    }
    process.stdout.write(`${JSON.stringify({
      created: prepared.created,
      outputDir: prepared.outputDir,
      version: source.version,
      tag: source.tag,
      commit: source.commit,
    }, null, 2)}\n`);
    return;
  }

  if (command === 'validate') {
    process.stdout.write(`${JSON.stringify({
      valid: true,
      version: source.version,
      tag: source.tag,
      commit: source.commit,
    })}\n`);
    return;
  }

  const plan = createPlan(source, options.profile || 'node');
  const output = command === 'dry-run'
    ? {...plan, mode: 'dry-run', mutationsPerformed: false}
    : plan;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Release automation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  COMMANDS,
  handleBuild,
  handlePublication,
  main,
  parseOptions,
  writePromotionDecision,
};
