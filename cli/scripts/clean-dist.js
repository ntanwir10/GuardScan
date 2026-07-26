#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.resolve(projectRoot, 'dist');
if (distDir !== path.join(projectRoot, 'dist') || path.dirname(distDir) !== projectRoot) {
  throw new Error(`Refusing to clean unexpected output directory: ${distDir}`);
}

fs.rmSync(distDir, { recursive: true, force: true });
