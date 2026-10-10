#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_REPOSITORY = 'ntanwir10/GuardScan';
const MAX_ATTESTATION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ATTESTED_PATHS = Object.freeze([
  '.github/CODEOWNERS',
  '.github/scripts/provider-onboarding-attestation.js',
  '.github/scripts/verify-release-workflow-security.test.js',
  '.github/workflows/ci.yml',
  '.github/workflows/release-build.yml',
  '.github/workflows/release-canary.yml',
  '.github/workflows/release-credential-health.yml',
  '.github/workflows/release-first-withdrawal.yml',
  '.github/workflows/release-please.yml',
  '.github/workflows/release-provider-rehearsal.yml',
  '.github/workflows/release-publish.yml',
  '.github/workflows/release-train.yml',
  'cli/scripts/release',
  'cli/schemas',
  'cli/package.json',
  'cli/package-lock.json',
  'catalog/homebrew-tap/.github/workflows/verify.yml',
  'docs/RELEASE_AUTOMATION.md',
  'docs/RELEASE_ONBOARDING.md',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function relativeFiles(repositoryRoot, entry) {
  const files = [];
  const walk = relative => {
    const absolute = path.join(repositoryRoot, relative);
    const stat = fs.lstatSync(absolute);
    assert.equal(stat.isSymbolicLink(), false, `${relative} must not be a symlink`);
    if (stat.isFile()) {
      files.push(relative);
      return;
    }
    assert.equal(stat.isDirectory(), true, `${relative} must be a regular file or directory`);
    for (const name of fs.readdirSync(absolute).sort()) {
      walk(path.posix.join(relative, name));
    }
  };
  walk(entry);
  assert(files.length > 0, `${entry} must not be empty`);
  return files;
}

function computeProviderOnboardingAttestation(repositoryRoot, repository = EXPECTED_REPOSITORY) {
  assert.equal(repository, EXPECTED_REPOSITORY, 'provider onboarding repository identity drifted');
  const records = [`repository\0${repository}\n`];
  const files = ATTESTED_PATHS.flatMap(entry => relativeFiles(repositoryRoot, entry));
  assert.equal(new Set(files).size, files.length, 'provider onboarding paths overlap');
  for (const file of files) {
    records.push(`${file}\0${sha256(fs.readFileSync(path.join(repositoryRoot, file)))}\n`);
  }
  return `sha256:${sha256(records.join(''))}`;
}

function createProviderOnboardingAttestation(subject, issuedAt = new Date(), validDays = 30) {
  assert.match(subject, /^sha256:[a-f0-9]{64}$/, 'provider onboarding subject is malformed');
  assert(issuedAt instanceof Date && Number.isFinite(issuedAt.getTime()), 'issuedAt is invalid');
  assert(
    Number.isInteger(validDays) && validDays >= 1 && validDays <= MAX_ATTESTATION_DAYS,
    `validDays must be between 1 and ${MAX_ATTESTATION_DAYS}`
  );
  const expiresAt = new Date(issuedAt.getTime() + validDays * DAY_MS);
  return [
    'guardscan.provider-onboarding.v1',
    subject,
    `issued=${issuedAt.toISOString()}`,
    `expires=${expiresAt.toISOString()}`,
  ].join('|');
}

function validateProviderOnboardingAttestation(value, expectedSubject, now = new Date()) {
  const invalid = reason => ({valid: false, reason});
  if (typeof value !== 'string') return invalid('missing');
  const match = value.match(
    /^guardscan\.provider-onboarding\.v1\|(sha256:[a-f0-9]{64})\|issued=([^|]+)\|expires=([^|]+)$/
  );
  if (!match) return invalid('malformed');
  if (match[1] !== expectedSubject) return invalid('subject-mismatch');
  const issuedAt = new Date(match[2]);
  const expiresAt = new Date(match[3]);
  if (!Number.isFinite(issuedAt.getTime()) || issuedAt.toISOString() !== match[2]
      || !Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== match[3]) {
    return invalid('invalid-timestamp');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return invalid('invalid-clock');
  const validityMs = expiresAt.getTime() - issuedAt.getTime();
  if (validityMs <= 0 || validityMs > MAX_ATTESTATION_DAYS * DAY_MS) {
    return invalid('invalid-validity-window');
  }
  if (now.getTime() < issuedAt.getTime()) return invalid('not-yet-valid');
  if (now.getTime() >= expiresAt.getTime()) return invalid('expired');
  return {
    valid: true,
    reason: 'matched',
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

if (require.main === module) {
  const repositoryRoot = path.resolve(__dirname, '..', '..');
  const subject = computeProviderOnboardingAttestation(
    repositoryRoot,
    process.env.GITHUB_REPOSITORY || EXPECTED_REPOSITORY
  );
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `subject=${subject}\n`);
  } else if (process.argv.includes('--attestation')) {
    process.stdout.write(`${createProviderOnboardingAttestation(subject)}\n`);
  } else process.stdout.write(`${subject}\n`);
}

module.exports = {
  ATTESTED_PATHS,
  EXPECTED_REPOSITORY,
  computeProviderOnboardingAttestation,
  createProviderOnboardingAttestation,
  validateProviderOnboardingAttestation,
};
