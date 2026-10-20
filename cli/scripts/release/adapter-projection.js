'use strict';

const fs = require('fs');
const {execFileSync} = require('child_process');
const MAX_BYTES = 1024 * 1024;

function verifyAdapterProjection(repository, renderedFile, target, head, base) {
  if (!['Formula/guardscan.rb', 'bucket/guardscan.json'].includes(target)
      || !/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9]{40}$/.test(base)) {
    throw new Error('Invalid adapter projection identity');
  }
  const git = (...args) => execFileSync('git', args, {cwd: repository, maxBuffer: MAX_BYTES,
    timeout: 30000, windowsHide: true});
  const changed = git('diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--')
    .toString('utf8').split('\0').filter(Boolean);
  if (changed.length !== 1 || changed[0] !== target) {
    throw new Error('Complete adapter projection diff must contain only the rendered target');
  }
  const mode = git('ls-tree', head, '--', target).toString('utf8').split(/\s+/)[0];
  if (mode !== '100644') throw new Error('Adapter projection must be a regular non-executable file');
  const stat = fs.lstatSync(renderedFile);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Rendered adapter is not a bounded regular file');
  if (!git('show', `${head}:${target}`).equals(fs.readFileSync(renderedFile))) {
    throw new Error('Adapter projection bytes differ from the immutable rendered target');
  }
}

if (require.main === module) verifyAdapterProjection(process.cwd(), ...process.argv.slice(2));
module.exports = {verifyAdapterProjection};
