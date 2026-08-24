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
  'catalog/homebrew-tap/.github/workflows/verify.yml',
  'docs/RELEASE_AUTOMATION.md',
  'docs/RELEASE_ONBOARDING.md',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function computeProviderOnboardingAttestation(repositoryRoot, repository = EXPECTED_REPOSITORY) {
  assert.equal(repository, EXPECTED_REPOSITORY, 'provider onboarding repository identity drifted');
  const records = [`repository\0${repository}\n`];
  for (const file of ATTESTED_PATHS) {
    const absolute = path.join(repositoryRoot, file);
    const stat = fs.lstatSync(absolute);
    assert.equal(stat.isSymbolicLink(), false, `${file} must not be a symlink`);
    assert.equal(stat.isFile(), true, `${file} must be a regular file`);
    records.push(`${file}\0${sha256(fs.readFileSync(absolute))}\n`);
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
