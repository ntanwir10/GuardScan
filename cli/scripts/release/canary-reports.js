'use strict';

const EXPECTED_CANARY_TARGETS = Object.freeze([
  ['npm', 'npm'], ['pnpm', 'pnpm'], ['yarn', 'yarn-classic'], ['yarn', 'yarn-modern'], ['bun', 'bun'],
  ...['linux-x64-glibc', 'linux-arm64-glibc', 'darwin-arm64', 'darwin-x64', 'windows-x64']
    .flatMap(target => [['github', target], ['pypi', target]]),
  ['homebrew', 'homebrew-macos'], ['homebrew', 'homebrew-linux'], ['scoop', 'scoop'],
  ['winget', 'windows-x64'], ['chocolatey', 'windows-x64'],
].map(target => Object.freeze(target)));

function validateCanaryReports(reports, version, evidenceUrl) {
  const expected = new Set(EXPECTED_CANARY_TARGETS.map(target => target.join(':')));
  if (!Array.isArray(reports) || reports.length !== expected.size) {
    throw new Error('canary report coverage does not contain the complete expected matrix');
  }
  for (const report of reports) {
    const key = `${report.channel}:${report.target}`;
    if (!expected.delete(key) || report.version !== version
        || !['passed', 'failed', 'pending'].includes(report.status)
        || (report.status === 'pending' && !['winget', 'chocolatey'].includes(report.channel))
        || typeof report.checkedAt !== 'string'
        || !Number.isFinite(Date.parse(report.checkedAt))
        || new Date(report.checkedAt).toISOString() !== report.checkedAt
        || report.evidenceUrl !== evidenceUrl) {
      throw new Error(`canary report coverage or identity is invalid: ${key}`);
    }
  }
  if (expected.size) throw new Error('canary report coverage is incomplete');
}

module.exports = {EXPECTED_CANARY_TARGETS, validateCanaryReports};
