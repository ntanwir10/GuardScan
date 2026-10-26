'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const {execFileSync} = require('child_process');

// Keep the release document schemas consumed by the current protected control plane.
const CONTROL_SCHEMAS = ['release-approval.v1', 'channel-catalog.v1', 'promotion-decision.v1',
  'release-event.v1', 'release-manifest.v1', 'release-state.v1', 'release-state.v2']
  .map(name => `cli/schemas/guardscan.${name}.schema.json`);
function productPath(file) {
  return file.startsWith('cli/src/')
    || (file.startsWith('cli/schemas/') && !CONTROL_SCHEMAS.includes(file))
    || [...FILES, 'cli/README.md', 'cli/LICENSE'].includes(file);
}

function selectForwardFixBase(root, {mainCommit, remoteHead, pullRequests, repository}) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8'}).trim();
  if (!/^[a-f0-9]{40}$/.test(mainCommit || '')) throw new Error('invalid forward-fix main commit');
  if (!remoteHead) return mainCommit;
  if (!/^[a-f0-9]{40}$/.test(remoteHead)) throw new Error('invalid forward-fix remote head');
  const parent = git('rev-parse', `${remoteHead}^`);
  const merged = pullRequests.some(pr => pr.state === 'MERGED' && pr.mergedAt
    && pr.baseRefName === 'main' && pr.headRefOid === remoteHead
    && pr.headRepository?.nameWithOwner?.toLowerCase() === repository.toLowerCase());
  git('merge-base', '--is-ancestor', parent, mainCommit);
  return merged ? parent : mainCommit;
}

function restoreProductSource(root, input) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8'});
  for (const key of ['knownGoodCommit', 'baseCommit']) {
    if (!/^[a-f0-9]{40}$/.test(input[key] || '')) throw new Error(`invalid forward-fix ${key}`);
  }
  if (git('rev-parse', 'HEAD').trim() !== input.baseCommit
      || git('status', '--porcelain').trim()) throw new Error('forward-fix requires its clean pinned main base');
  const files = ref => git('ls-tree', '-rz', '--full-tree', ref).split('\0').filter(Boolean)
    .map(row => {
      const [entry, file] = row.split('\t');
      if (productPath(file) && !/^100(644|755) blob /.test(entry)) {
        throw new Error(`forward-fix product source is not a regular file: ${file}`);
      }
      return file;
    }).filter(productPath);
  const known = files(input.knownGoodCommit);
  const current = files(input.baseCommit);
  const basePackage = JSON.parse(git('show', `${input.baseCommit}:cli/package.json`));
  if (basePackage.version !== input.defectiveVersion) {
    throw new Error('forward-fix base package version does not match the defective release');
  }
  const scripts = basePackage.scripts;
  for (const file of current.filter(file => !known.includes(file))) {
    fs.unlinkSync(path.join(root, file));
  }
  for (const file of known) git('restore', '--source', input.knownGoodCommit, '--staged', '--worktree', '--', file);
  return {scripts, files: [...new Set([...known, ...current])].sort()};
}

const FILES = Object.freeze([
  'cli/CHANGELOG.md',
  'cli/package-lock.json',
  'cli/package.json',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readRegularFile(repositoryRoot, relative) {
  const file = path.join(repositoryRoot, ...relative.split('/'));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`forward-fix source is not a regular file: ${relative}`);
  }
  if (stat.size > 10 * 1024 * 1024) {
    throw new Error(`forward-fix source exceeds its size limit: ${relative}`);
  }
  return {file, contents: fs.readFileSync(file, 'utf8')};
}

function recoverySection(input) {
  return [
    `## [${input.forwardFixVersion}]`,
    '',
    '### Fixed',
    '',
    `- Restore verified v${input.knownGoodVersion} source as a forward fix for defective v${input.defectiveVersion} without replacing immutable release artifacts.`,
  ].join('\n');
}

function updateChangelog(contents, input) {
  const section = recoverySection(input);
  if (contents.includes(`${section}\n`) || contents.endsWith(section)) return contents;
  const headingPattern = new RegExp(`^## \\[${input.forwardFixVersion.replace(/\./g, '\\.')}\\](?:\\s|$)`, 'm');
  if (headingPattern.test(contents)) {
    throw new Error(`CHANGELOG already has conflicting notes for ${input.forwardFixVersion}`);
  }
  const unreleased = /^## \[Unreleased\][^\n]*$/m.exec(contents);
  if (!unreleased) throw new Error('CHANGELOG has no Unreleased section');
  const headingEnd = unreleased.index + unreleased[0].length;
  const nextHeading = contents.indexOf('\n## [', headingEnd);
  const boundary = nextHeading === -1 ? contents.length : nextHeading;
  if (contents.slice(headingEnd, boundary).trim().length > 0) {
    throw new Error('known-good CHANGELOG Unreleased section must be empty');
  }
  return `${contents.slice(0, headingEnd)}\n\n${section}${contents.slice(boundary)}`;
}

function prepareForwardFixSource(repositoryRoot, input) {
  const root = path.resolve(repositoryRoot);
  if (path.dirname(root) === root) throw new Error('refusing to prepare a filesystem root');
  const {knownGoodVersion, defectiveVersion, forwardFixVersion} = input;
  if (!semver.valid(knownGoodVersion) || semver.prerelease(knownGoodVersion) !== null) {
    throw new Error('forward-fix known-good version is invalid');
  }
  if (!semver.valid(defectiveVersion) || semver.prerelease(defectiveVersion) !== null) {
    throw new Error('forward-fix defective version is invalid');
  }
  if (forwardFixVersion !== semver.inc(defectiveVersion, 'patch')) {
    throw new Error('forward-fix version must be the next patch after the defective release');
  }
  const projection = input.knownGoodCommit || input.baseCommit ? restoreProductSource(root, input) : null;
  const packageSource = readRegularFile(root, 'cli/package.json');
  const lockSource = readRegularFile(root, 'cli/package-lock.json');
  const changelogSource = readRegularFile(root, 'cli/CHANGELOG.md');
  const packageJson = JSON.parse(packageSource.contents);
  const packageLock = JSON.parse(lockSource.contents);
  for (const [label, version] of [
    ['package.json', packageJson.version],
    ['package-lock.json', packageLock.version],
    ['package-lock.json root package', packageLock.packages?.['']?.version],
  ]) {
    if (![knownGoodVersion, forwardFixVersion].includes(version)) {
      throw new Error(`${label} does not match the known-good or forward-fix version`);
    }
  }
  packageJson.version = forwardFixVersion;
  if (projection) packageJson.scripts = projection.scripts;
  packageLock.version = forwardFixVersion;
  packageLock.packages[''].version = forwardFixVersion;
  const outputs = {
    'cli/package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
    'cli/package-lock.json': `${JSON.stringify(packageLock, null, 2)}\n`,
    'cli/CHANGELOG.md': updateChangelog(changelogSource.contents, input),
  };
  let changed = false;
  for (const relative of FILES) {
    const target = path.join(root, ...relative.split('/'));
    if (fs.readFileSync(target, 'utf8') === outputs[relative]) continue;
    fs.writeFileSync(target, outputs[relative], {encoding: 'utf8', mode: 0o600});
    changed = true;
  }
  return {
    schemaVersion: 'guardscan.forward-fix-source.v1',
    changed,
    version: forwardFixVersion,
    files: projection ? projection.files : [...FILES],
    digests: Object.fromEntries((projection ? projection.files : FILES).map(relative => {
      const file = path.join(root, relative);
      return [relative, fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null];
    })),
  };
}

module.exports = {prepareForwardFixSource, selectForwardFixBase};
