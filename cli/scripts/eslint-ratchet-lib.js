'use strict';

function evaluateBaseline(current, baseline, fileExists) {
  const regressions = [];
  const improvements = [];

  for (const [file, counts] of Object.entries(current)) {
    const allowed = baseline[file] || { errors: 0, warnings: 0 };
    if (counts.errors > allowed.errors || counts.warnings > allowed.warnings) {
      regressions.push(
        `${file}: ${counts.errors} errors/${counts.warnings} warnings ` +
        `(baseline ${allowed.errors}/${allowed.warnings})`
      );
    } else if (counts.errors < allowed.errors || counts.warnings < allowed.warnings) {
      improvements.push(`${file}: ${counts.errors} errors/${counts.warnings} warnings`);
    }
  }

  for (const [file, allowed] of Object.entries(baseline)) {
    if (!fileExists(file)) {
      regressions.push(`${file}: baseline source file is missing; regenerate the reviewed baseline`);
    } else if (!current[file] && (allowed.errors > 0 || allowed.warnings > 0)) {
      improvements.push(`${file}: clean`);
    }
  }

  return {regressions, improvements};
}

function parseEslintReport(result) {
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || `ESLint exited with status ${String(result.status)}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('Failed to parse ESLint JSON output.');
  }
}

module.exports = {evaluateBaseline, parseEslintReport};
