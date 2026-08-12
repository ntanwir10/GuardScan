'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const semver = require('semver');

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
    files: [...FILES],
    digests: Object.fromEntries(FILES.map(relative => [relative, sha256(outputs[relative])])),
  };
}

module.exports = {prepareForwardFixSource};
