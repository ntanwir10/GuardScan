'use strict';

const fs = require('fs');
const path = require('path');
const {compareUtf8} = require('./deterministic');

const FORBIDDEN_RUNTIME_LITERALS = Object.freeze([
  'api.guardscancli.com',
  'GUARDSCAN_API_URL',
  'DEFAULT_API_BASE_URL',
]);

function findForbiddenRuntimeLiterals(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  return FORBIDDEN_RUNTIME_LITERALS.filter(literal => bytes.includes(Buffer.from(literal, 'utf8')));
}

function assertRuntimeArtifactClean(content, label) {
  const matches = findForbiddenRuntimeLiterals(content);
  if (matches.length > 0) {
    throw new Error(`${label} contains forbidden retired runtime literals: ${matches.join(', ')}`);
  }
}

function assertCompiledRuntimeFilesClean(root, files, label = 'compiled runtime') {
  const resolvedRoot = path.resolve(root);
  const runtimeFiles = [...files]
    .map(file => String(file).replace(/\\/g, '/'))
    .filter(file => file.startsWith('dist/') && /\.(?:c|m)?js$/i.test(file))
    .sort(compareUtf8);
  if (runtimeFiles.length === 0) {
    throw new Error(`${label} contains no compiled JavaScript under dist/`);
  }
  for (const file of runtimeFiles) {
    const absolute = path.resolve(resolvedRoot, file);
    const relative = path.relative(resolvedRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${label} contains an unsafe runtime path: ${file}`);
    }
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${file}`);
    assertRuntimeArtifactClean(fs.readFileSync(absolute), `${label} ${file}`);
  }
  return runtimeFiles;
}

module.exports = {
  FORBIDDEN_RUNTIME_LITERALS,
  assertCompiledRuntimeFilesClean,
  assertRuntimeArtifactClean,
  findForbiddenRuntimeLiterals,
};
