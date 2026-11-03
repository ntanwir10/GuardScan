'use strict';

const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const MAX_BYTES = 1024 * 1024;

function validateCatalogPullRequest(pr, expectedHead, requireMerged = false) {
  if (!/^[a-f0-9]{40}$/.test(expectedHead || '')
      || pr?.baseRefName !== 'main'
      || pr.headRepository?.nameWithOwner?.toLowerCase() !== 'ntanwir10/homebrew-tap'
      || pr.headRefOid !== expectedHead
      || !['OPEN', 'MERGED'].includes(pr.state)
      || (requireMerged && pr.state !== 'MERGED')
      || (pr.state === 'MERGED' && !/^[a-f0-9]{40}$/.test(pr.mergeCommit?.oid || ''))) {
    throw new Error('Catalog pull request is not bound to the expected repository, base, head, and merge');
  }
  return pr;
}

function verifyAdapterProjection(repository, renderedFile, target, head, base) {
  if (!['Formula/guardscan.rb', 'bucket/guardscan.json'].includes(target)
      || !/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9]{40}$/.test(base)) {
    throw new Error('Invalid adapter projection identity');
  }
  verifyProjection(repository, {[target]: renderedFile}, head, base, 'Adapter');
}

function verifyCatalogProjection(repository, renderedRoot, workflowFile, head, base) {
  if (!/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9]{40}$/.test(base)) {
    throw new Error('Invalid catalog projection identity');
  }
  verifyProjection(repository, {
    'Formula/guardscan.rb': path.join(renderedRoot, 'Formula/guardscan.rb'),
    'bucket/guardscan.json': path.join(renderedRoot, 'bucket/guardscan.json'),
    'channel-lock.json': path.join(renderedRoot, 'channel-lock.json'),
    '.github/workflows/verify.yml': workflowFile,
  }, head, base, 'Catalog');
}

function verifyProjection(repository, renderedFiles, head, base, label) {
  const git = (...args) => execFileSync('git', args, {cwd: repository, maxBuffer: MAX_BYTES,
    timeout: 30000, windowsHide: true});
  const changed = git('diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--')
    .toString('utf8').split('\0').filter(Boolean);
  const targets = Object.keys(renderedFiles);
  if (changed.length === 0 || changed.some(target => !targets.includes(target))) {
    throw new Error(`Complete ${label.toLowerCase()} projection diff must contain only the rendered targets`);
  }
  for (const target of targets) {
    const mode = git('ls-tree', head, '--', target).toString('utf8').split(/\s+/)[0];
    if (mode !== '100644') throw new Error(`${label} projection must be a regular non-executable file`);
    const stat = fs.lstatSync(renderedFiles[target]);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Rendered adapter is not a bounded regular file');
    if (!git('show', `${head}:${target}`).equals(fs.readFileSync(renderedFiles[target]))) {
      throw new Error(`${label} projection bytes differ from the immutable rendered target`);
    }
  }
}

if (require.main === module) verifyAdapterProjection(process.cwd(), ...process.argv.slice(2));
module.exports = {verifyAdapterProjection, verifyCatalogProjection, validateCatalogPullRequest};
