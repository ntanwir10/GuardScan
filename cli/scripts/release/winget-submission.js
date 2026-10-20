'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const yaml = require('js-yaml');
const REPOSITORY = 'microsoft/winget-pkgs';
const PACKAGE = 'NaumanTanwir.GuardScan';
const LIMIT = 1024 * 1024;
const shaPattern = /^[a-f0-9]{40}$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function document(bytes, version) {
  if (bytes.length > LIMIT) throw new Error('WinGet manifest exceeds its limit');
  const value = yaml.load(bytes.toString('utf8'));
  if (!value || value.PackageIdentifier !== PACKAGE || value.PackageVersion !== version) {
    throw new Error('WinGet manifest identity does not match the exact package/version');
  }
  return canonical(value);
}

function githubApi(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', endpoint], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 8 * LIMIT, windowsHide: true,
  }));
}

function findSubmission(directory, tag, {api = githubApi} = {}) {
  const version = tag.replace(/^v/, '');
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
    throw new Error('WinGet submission requires an exact stable version');
  }
  const names = [`${PACKAGE}.yaml`, `${PACKAGE}.installer.yaml`, `${PACKAGE}.locale.en-US.yaml`].sort();
  if (fs.readdirSync(directory).sort().join('\n') !== names.join('\n')) {
    throw new Error('WinGet local manifest file set is not exact');
  }
  const local = Object.fromEntries(names.map(name => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > LIMIT) throw new Error('WinGet local manifest is not a bounded regular file');
    return [name, document(fs.readFileSync(file), version)];
  }));
  const digest = crypto.createHash('sha256').update(JSON.stringify(local)).digest('hex');
  const q = encodeURIComponent(`repo:${REPOSITORY} is:pr "${PACKAGE}" "${version}" in:title`);
  const search = api(`search/issues?q=${q}&per_page=100`);
  if (search.incomplete_results || !Number.isSafeInteger(search.total_count)
      || search.total_count > 100 || search.items?.length !== search.total_count) {
    throw new Error('WinGet submission search is incomplete');
  }
  const prefix = `manifests/n/NaumanTanwir/GuardScan/${version}/`;
  const matches = [];
  for (const item of search.items) {
    if (!Number.isSafeInteger(item.number) || item.number < 1) throw new Error('Invalid WinGet PR identity');
    const endpoint = `repos/${REPOSITORY}/pulls/${item.number}`;
    const pr = api(endpoint);
    if (pr.state !== 'open' && !pr.merged) continue;
    if (pr.number !== item.number || pr.base?.ref !== 'master' || pr.base?.repo?.full_name !== REPOSITORY
        || !shaPattern.test(pr.head?.sha || '')) throw new Error('WinGet PR repository/head identity mismatch');
    const files = api(`${endpoint}/files?per_page=100`);
    if (!Array.isArray(files) || files.length !== pr.changed_files) throw new Error('Incomplete WinGet PR file set');
    if (!files.some(file => file.filename.startsWith(prefix))) continue;
    if (files.map(file => file.filename).sort().join('\n') !== names.map(name => prefix + name).join('\n')) {
      throw new Error('Existing WinGet PR has conflicting manifest file set');
    }
    const remote = Object.fromEntries(files.map(file => {
      if (!['added', 'modified'].includes(file.status) || !shaPattern.test(file.sha || '')) {
        throw new Error('WinGet PR has an unexpected file operation');
      }
      const blob = api(`repos/${REPOSITORY}/git/blobs/${file.sha}`);
      if (blob.encoding !== 'base64' || blob.sha !== file.sha || !Number.isSafeInteger(blob.size)
          || blob.size > LIMIT || typeof blob.content !== 'string' || blob.content.length > 2 * LIMIT) {
        throw new Error('WinGet manifest blob identity/size mismatch');
      }
      const bytes = Buffer.from(blob.content, 'base64');
      const actual = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (bytes.length !== blob.size || actual !== file.sha) throw new Error('WinGet manifest blob digest mismatch');
      return [file.filename.slice(prefix.length), document(bytes, version)];
    }));
    // Sort by the same code-point order used for the local file set.
    const ordered = Object.fromEntries(names.map(name => [name, remote[name]]));
    if (JSON.stringify(ordered) !== JSON.stringify(local)) throw new Error('Existing WinGet PR has conflicting manifest payloads');
    const after = api(endpoint);
    if (after.head?.sha !== pr.head.sha || (after.state !== 'open' && !after.merged)) {
      throw new Error('WinGet PR head/state changed during verification');
    }
    matches.push({schemaVersion: 'guardscan.winget-submission.v1', tag: `v${version}`,
      repository: REPOSITORY, pullRequest: item.number, headCommit: pr.head.sha,
      state: after.merged ? 'MERGED' : 'OPEN', manifestSha256: digest,
      url: `https://github.com/${REPOSITORY}/pull/${item.number}`});
  }
  if (matches.length > 1) throw new Error('Multiple matching WinGet submissions are ambiguous');
  return matches.length ? {submitRequired: false, submission: matches[0]} : {submitRequired: true};
}

if (require.main === module) {
  const [directory, tag, evidence] = process.argv.slice(2);
  const result = findSubmission(directory, tag);
  if (!result.submitRequired && evidence) {
    fs.writeFileSync(evidence, JSON.stringify(result.submission, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify(result) + '\n');
}

module.exports = {findSubmission};
