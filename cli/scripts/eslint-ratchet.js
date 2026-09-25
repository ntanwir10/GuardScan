#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { evaluateBaseline } = require('./eslint-ratchet-lib');

const BASELINE_FILE = path.join(__dirname, 'eslint-baseline.json');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  npx,
  ['--no-install', 'eslint', 'src', '--ext', '.ts', '--format', 'json'],
  {
    cwd: process.cwd(),
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  }
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout || '[]');
} catch {
  console.error('Failed to parse ESLint JSON output.');
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}

const current = Object.fromEntries(
  report
    .map(file => [
      path.relative(process.cwd(), file.filePath).split(path.sep).join('/'),
      { errors: file.errorCount || 0, warnings: file.warningCount || 0 },
    ])
    .filter(([, counts]) => counts.errors > 0 || counts.warnings > 0)
    .sort(([left], [right]) => left.localeCompare(right))
);

if (process.argv.includes('--write-baseline')) {
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(current, null, 2)}\n`, 'utf-8');
  console.log(`Wrote per-file ESLint baseline to ${path.relative(process.cwd(), BASELINE_FILE)}.`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_FILE)) {
  console.error('ESLint baseline is missing. Run npm run lint:ratchet:update after reviewing all violations.');
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
const {regressions, improvements} = evaluateBaseline(current, baseline, fs.existsSync);

if (improvements.length > 0) {
  console.log('ESLint improved in:');
  improvements.forEach(message => console.log(`  ${message}`));
  console.log('Review the improvements, then lower the baseline with npm run lint:ratchet:update.');
}

if (regressions.length > 0) {
  console.error('Per-file ESLint ratchet failed:');
  regressions.forEach(message => console.error(`  ${message}`));
  process.exit(1);
}

const totals = Object.values(current).reduce(
  (sum, counts) => ({
    errors: sum.errors + counts.errors,
    warnings: sum.warnings + counts.warnings,
  }),
  { errors: 0, warnings: 0 }
);
console.log(`Per-file ESLint ratchet passed (${totals.errors} errors, ${totals.warnings} warnings).`);
