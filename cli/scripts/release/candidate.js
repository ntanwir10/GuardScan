'use strict';

const fs = require('fs');
const path = require('path');
const semver = require('semver');
const {readBounded, readJson} = require('./lib');

function assertCandidateVersion(stableVersion, candidateVersion) {
  const stable = semver.parse(stableVersion);
  const candidate = semver.parse(candidateVersion);
  if (!stable || stable.prerelease.length > 0) throw new Error('candidate source must use a stable version');
  if (!candidate || candidate.prerelease[0] !== 'rc'
      || !Number.isInteger(candidate.prerelease[1])
      || candidate.major !== stable.major
      || candidate.minor !== stable.minor
      || candidate.patch !== stable.patch) {
    throw new Error(`candidate version must be ${stableVersion}-rc.N`);
  }
}

function writeJson(file, document) {
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function createReleaseCandidate(
  source,
  candidateVersion,
  sourcePr,
  sourcePrHead,
  sourcePrBase,
  sourcePrTree,
  timestamp
) {
  assertCandidateVersion(source.version, candidateVersion);
  if (!Number.isSafeInteger(Number(sourcePr)) || Number(sourcePr) < 1) {
    throw new Error('release candidate source PR is invalid');
  }
  if (!/^[a-f0-9]{40}$/.test(sourcePrHead || '')) {
    throw new Error('release candidate source PR head is invalid');
  }
  if (!/^[a-f0-9]{40}$/.test(sourcePrBase || '')) {
    throw new Error('release candidate source PR base is invalid');
  }
  if (!/^[a-f0-9]{40}$/.test(sourcePrTree || '')) {
    throw new Error('release candidate source PR tree is invalid');
  }
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== timestamp) {
    throw new Error('release candidate timestamp must be canonical');
  }
  const packageFile = path.join(source.packageRoot, 'package.json');
  const lockFile = path.join(source.packageRoot, 'package-lock.json');
  const changelogFile = path.join(source.packageRoot, 'CHANGELOG.md');
  const packageJson = readJson(packageFile, 'package.json');
  const packageLock = readJson(lockFile, 'package-lock.json');
  packageJson.version = candidateVersion;
  packageLock.version = candidateVersion;
  if (!packageLock.packages?.['']) throw new Error('package-lock.json has no root package');
  packageLock.packages[''].version = candidateVersion;
  const changelog = readBounded(changelogFile, 'CHANGELOG.md');
  const header = `## [${candidateVersion}] - ${timestamp.slice(0, 10)}`;
  if (!changelog.includes(header)) {
    const marker = /^# Changelog\s*$/m;
    if (!marker.test(changelog)) throw new Error('CHANGELOG.md has no top-level Changelog heading');
    const updated = changelog.replace(marker, match => (
      `${match}\n\n${header}\n\n`
      + `Release candidate derived from stable release PR #${sourcePr} at ${sourcePrHead}.\n`
    ));
    fs.writeFileSync(changelogFile, updated, 'utf8');
  }
  writeJson(packageFile, packageJson);
  writeJson(lockFile, packageLock);
  const metadata = {
    schemaVersion: 'guardscan.release-candidate.v1',
    stableVersion: source.version,
    candidateVersion,
    sourcePr: Number(sourcePr),
    sourcePrHead,
    sourcePrBase,
    sourcePrTree,
    createdAt: timestamp,
  };
  writeJson(path.join(source.repositoryRoot, '.release-candidate.json'), metadata);
  return metadata;
}

module.exports = {assertCandidateVersion, createReleaseCandidate};
