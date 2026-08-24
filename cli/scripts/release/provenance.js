'use strict';

const crypto = require('crypto');
const fs = require('fs');

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const RELEASE_BUILD_SIGNER = 'https://github.com/ntanwir10/GuardScan/.github/workflows/release-build.yml';
const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function createVerifiedAttestationEvidence({
  bundleFile,
  subjectFile,
  source,
  url,
  signerDigest,
  verification,
}) {
  if (!Array.isArray(verification) || verification.length < 1) {
    throw new Error('attestation verification returned no verified statement');
  }
  if (!COMMIT_PATTERN.test(signerDigest || '')) {
    throw new Error('attestation signer workflow digest is invalid');
  }
  return assertVerifiedAttestation({
    type: 'slsa',
    url,
    verified: true,
    sha256: sha256File(bundleFile),
    subjectSha256: sha256File(subjectFile),
    sourceVersion: source.version,
    sourceTag: source.tag,
    sourceCommit: source.commit,
    signerIdentity: RELEASE_BUILD_SIGNER,
    signerDigest,
    predicateType: SLSA_PROVENANCE_V1,
  }, {
    artifactSha256: sha256File(subjectFile),
    source,
    signerDigest,
  }, 'artifact provenance');
}

function assertVerifiedAttestation(provenance, binding, label) {
  if (!provenance || typeof provenance !== 'object'
      || provenance.type !== 'slsa'
      || provenance.verified !== true) {
    throw new Error(`${label} requires verified attestation bundle evidence`);
  }
  let parsed;
  try {
    parsed = new URL(provenance.url);
  } catch {
    throw new Error(`${label} attestation URL must be HTTPS`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`${label} attestation URL must be HTTPS`);
  }
  const expectedPrefix = `/ntanwir10/GuardScan/releases/download/${binding.source.tag}/`;
  if (parsed.origin !== 'https://github.com' || !parsed.pathname.startsWith(expectedPrefix)) {
    throw new Error(`${label} attestation URL must identify immutable GuardScan release bytes`);
  }
  if (!SHA256_PATTERN.test(provenance.sha256 || '')) {
    throw new Error(`${label} attestation bundle SHA-256 is required`);
  }
  if (provenance.subjectSha256 !== binding.artifactSha256) {
    throw new Error(`${label} attestation is not bound to the exact artifact digest`);
  }
  for (const [field, expected] of Object.entries({
    sourceVersion: binding.source.version,
    sourceTag: binding.source.tag,
    sourceCommit: binding.source.commit,
  })) {
    if (provenance[field] !== expected) {
      throw new Error(`${label} attestation is not bound to the exact source ${field}`);
    }
  }
  if (provenance.signerIdentity !== RELEASE_BUILD_SIGNER) {
    throw new Error(`${label} signer is not the protected release-build workflow`);
  }
  if (!COMMIT_PATTERN.test(provenance.signerDigest || '')
      || (binding.signerDigest && provenance.signerDigest !== binding.signerDigest)) {
    throw new Error(`${label} signer workflow digest is invalid`);
  }
  if (provenance.predicateType !== SLSA_PROVENANCE_V1) {
    throw new Error(`${label} predicate is not SLSA provenance v1`);
  }
  return provenance;
}

module.exports = {
  assertVerifiedAttestation,
  createVerifiedAttestationEvidence,
  RELEASE_BUILD_SIGNER,
  SLSA_PROVENANCE_V1,
};
