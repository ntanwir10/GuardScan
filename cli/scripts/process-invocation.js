'use strict';

const fs = require('fs');
const path = require('path');

function resolveToolInvocation(
  tool,
  args,
  environment = process.env,
  platform = process.platform,
  nodeExecutable = process.execPath
) {
  if (platform !== 'win32') return {command: tool, args: [...args]};
  if (tool === 'bun') return {command: 'bun.exe', args: [...args]};

  const pathValue = Object.entries(environment)
    .find(([name]) => name.toUpperCase() === 'PATH')?.[1] || '';
  for (const rawDirectory of pathValue.split(';')) {
    const directory = rawDirectory.trim().replace(/^"|"$/g, '');
    if (!directory) continue;
    const shim = path.join(directory, `${tool}.cmd`);
    if (!isFile(shim)) continue;
    for (const entryPoint of entryPointCandidates(directory, tool)) {
      if (isFile(entryPoint)) {
        return {command: nodeExecutable, args: [entryPoint, ...args]};
      }
    }
  }
  throw new Error(`Required ${tool} Node CLI entry point not found on PATH`);
}

function entryPointCandidates(directory, tool) {
  if (tool === 'npm' || tool === 'npx') {
    return [path.join(directory, 'node_modules', 'npm', 'bin', `${tool}-cli.js`)];
  }
  if (tool === 'pnpm') {
    return [
      path.join(directory, 'node_modules', 'corepack', 'dist', 'pnpm.js'),
      path.join(directory, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
      path.join(directory, 'node_modules', 'pnpm', 'bin', 'pnpm.js'),
    ];
  }
  if (tool === 'yarn') {
    return [
      path.join(directory, 'node_modules', 'corepack', 'dist', 'yarn.js'),
      path.join(directory, 'node_modules', 'yarn', 'bin', 'yarn.js'),
    ];
  }
  throw new Error(`Unsupported Node CLI tool: ${tool}`);
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

module.exports = {resolveToolInvocation};
