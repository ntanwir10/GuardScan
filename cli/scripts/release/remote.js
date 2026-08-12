'use strict';

function assertDigest(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error(`${label} SHA-256 is invalid`);
}

function classifyRemoteArtifact(local, remote) {
  if (!local || typeof local !== 'object') throw new Error('local artifact identity is required');
  assertDigest(local.sha256, 'local artifact');
  if (!remote) {
    return {
      state: 'missing',
      publishRequired: true,
      matching: false,
      integrityIncident: false,
    };
  }
  if (typeof remote !== 'object' || typeof remote.identity !== 'string' || remote.identity.length === 0) {
    throw new Error('remote artifact identity is invalid');
  }
  assertDigest(remote.sha256, 'remote artifact');
  if (remote.sha256 !== local.sha256) {
    return {
      state: 'conflict',
      publishRequired: false,
      matching: false,
      integrityIncident: true,
      remoteIdentity: remote.identity,
    };
  }
  return {
    state: 'identical',
    publishRequired: false,
    matching: true,
    integrityIncident: false,
    remoteIdentity: remote.identity,
  };
}

module.exports = {classifyRemoteArtifact};
