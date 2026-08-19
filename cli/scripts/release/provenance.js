'use strict';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RELEASE_BUILD_SIGNER = 'https://github.com/ntanwir10/GuardScan/.github/workflows/release-build.yml';
const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';

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
  if (provenance.predicateType !== SLSA_PROVENANCE_V1) {
    throw new Error(`${label} predicate is not SLSA provenance v1`);
  }
  return provenance;
}

module.exports = {
  assertVerifiedAttestation,
  RELEASE_BUILD_SIGNER,
  SLSA_PROVENANCE_V1,
};
