#!/usr/bin/env node
'use strict';

// Runs `npm audit` with the given arguments and fails on every advisory at or above
// --audit-level, except a short, dated list of reviewed advisories that have no fix yet.
const {spawnSync} = require('child_process');

const EXCEPTIONS = {
  // picomatch ReDoS: no patched release exists. GuardScan only globs its own or the local
  // user's patterns (scanned repos' .gitignore goes to `ignore`), so the worst case is a
  // self-inflicted hang. Approved by the maintainer on 2026-11-17 for 30 days.
  'GHSA-fc5q-39xc-vjpf': '2026-12-17',
};
const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];

function blockingAdvisories(report, level, now = new Date()) {
  const minimum = LEVELS.indexOf(level);
  if (minimum < 0) throw new Error(`unknown audit level: ${level}`);
  const blocking = new Set();
  for (const vulnerability of Object.values(report.vulnerabilities || {})) {
    // String entries are transitive references; the advisory objects they point to are checked.
    for (const advisory of vulnerability.via.filter(via => typeof via === 'object')) {
      if (LEVELS.indexOf(advisory.severity) < minimum) continue;
      const id = String(advisory.url || '').split('/').pop();
      const until = EXCEPTIONS[id];
      if (!until || now > new Date(`${until}T23:59:59Z`)) blocking.add(`${id} ${advisory.severity} ${advisory.name}`);
    }
  }
  return [...blocking].sort();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const level = (args.find(arg => arg.startsWith('--audit-level=')) || '--audit-level=low').split('=')[1];
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--json', ...args],
    {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32'});
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error(`npm audit returned no JSON report: ${(result.stderr || '').trim()}`);
    process.exit(1);
  }
  if (report.error) {
    console.error(`npm audit failed: ${JSON.stringify(report.error)}`);
    process.exit(1);
  }
  const blocking = blockingAdvisories(report, level);
  for (const [id, until] of Object.entries(EXCEPTIONS)) console.log(`Reviewed exception: ${id} until ${until}`);
  if (blocking.length > 0) {
    console.error(`Blocking advisories at or above ${level}:\n${blocking.join('\n')}`);
    process.exit(1);
  }
  console.log(`No blocking advisories at or above ${level}.`);
}

module.exports = {EXCEPTIONS, blockingAdvisories};
