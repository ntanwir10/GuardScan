'use strict';

// Committed and attested on purpose: changing the policy needs a reviewed PR and a new onboarding attestation.
const RELEASE_SIGNING_POLICY = 'community';

const SIGNING_POLICIES = Object.freeze({
  community: Object.freeze({
    providers: Object.freeze([]),
    signatures: Object.freeze({
      darwin: Object.freeze(['sigstore']),
      linux: Object.freeze(['sigstore']),
      windows: Object.freeze(['sigstore']),
    }),
  }),
  platform: Object.freeze({
    providers: Object.freeze(['apple-signing-notary', 'azure-artifact-signing']),
    signatures: Object.freeze({
      darwin: Object.freeze(['sigstore', 'apple-code-signing', 'apple-notarization']),
      linux: Object.freeze(['sigstore']),
      windows: Object.freeze(['sigstore', 'authenticode']),
    }),
  }),
});

function policyFor(policy) {
  if (!Object.prototype.hasOwnProperty.call(SIGNING_POLICIES, policy)) {
    throw new Error(`unknown release signing policy: ${policy}`);
  }
  return SIGNING_POLICIES[policy];
}

function requiredSignatures(policy, os) {
  const {signatures} = policyFor(policy);
  if (!Object.prototype.hasOwnProperty.call(signatures, os)) {
    throw new Error(`unknown release signing platform: ${os}`);
  }
  return [...signatures[os]];
}

function signingProviders(policy) {
  return [...policyFor(policy).providers];
}

function workflowOutputs(policy = RELEASE_SIGNING_POLICY) {
  return [
    `policy=${policy}`,
    `providers=${JSON.stringify(signingProviders(policy))}`,
    ...['darwin', 'linux', 'windows'].map(os => `${os}=${JSON.stringify(requiredSignatures(policy, os))}`),
  ].join('\n');
}

if (require.main === module) {
  const [policy, os] = process.argv.slice(2);
  // No arguments: the committed policy as GITHUB_OUTPUT lines. With policy and OS: `required=,a,b,` for exact contains() checks.
  process.stdout.write(policy === undefined
    ? `${workflowOutputs()}\n`
    : `required=,${requiredSignatures(policy, os).join(',')},\n`);
}

module.exports = {
  RELEASE_SIGNING_POLICY,
  SIGNING_POLICIES,
  requiredSignatures,
  signingProviders,
  workflowOutputs,
};
