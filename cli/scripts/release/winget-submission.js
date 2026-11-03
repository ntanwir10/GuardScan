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

class VerificationUnavailable extends Error {}

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

function githubApi(endpoint, execute = execFileSync) {
  let output;
  try {
    output = execute('gh', ['api', endpoint], {
      encoding: 'utf8', timeout: 60000, maxBuffer: 8 * LIMIT, windowsHide: true,
    });
  } catch (error) {
    const detail = String(error.stderr || error.message || '');
    const status = /HTTP (\d{3})/.exec(detail)?.[1];
    const transient = status
      ? status === '429' || /^5\d\d$/.test(status)
        || (status === '403' && /API rate limit exceeded|secondary rate limit/i.test(detail))
      : error.code === 'ETIMEDOUT'
        || /error connecting to api\.github\.com|connection reset|TLS handshake timeout|i\/o timeout/i.test(detail);
    if (transient) throw new VerificationUnavailable('WinGet API temporarily unavailable');
    throw Object.assign(new Error('WinGet API request failed'), {status: Number(status)});
  }
  return JSON.parse(output);
}

function findSubmission(directory, tag, {api = githubApi, pullRequest} = {}) {
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
  if (pullRequest !== undefined && (!Number.isSafeInteger(pullRequest) || pullRequest < 1)) {
    throw new Error('Invalid recorded WinGet PR identity');
  }
  const search = pullRequest === undefined ? api(`search/issues?q=${q}&per_page=100`)
    : {incomplete_results: false, total_count: 1, items: [{number: pullRequest}]};
  if (search.incomplete_results === true) throw new VerificationUnavailable('WinGet submission search temporarily incomplete');
  if (search.incomplete_results !== false || !Number.isSafeInteger(search.total_count)
      || search.total_count > 100 || search.items?.length !== search.total_count) {
    throw new Error('WinGet submission search is incomplete');
  }
  const prefix = `manifests/n/NaumanTanwir/GuardScan/${version}/`;
  const matches = [];
  for (const item of search.items) {
    if (!Number.isSafeInteger(item.number) || item.number < 1) throw new Error('Invalid WinGet PR identity');
    const endpoint = `repos/${REPOSITORY}/pulls/${item.number}`;
    const pr = api(endpoint);
    if (!['open', 'closed'].includes(pr.state) || typeof pr.merged !== 'boolean') {
      throw new Error('WinGet PR state is invalid');
    }
    if (pr.state !== 'open' && !pr.merged && pullRequest === undefined) continue;
    if (pr.number !== item.number || pr.base?.ref !== 'master' || pr.base?.repo?.full_name !== REPOSITORY
        || !shaPattern.test(pr.head?.sha || '')) throw new Error('WinGet PR repository/head identity mismatch');
    const files = api(`${endpoint}/files?per_page=100`);
    if (!Array.isArray(files) || files.length !== pr.changed_files) throw new Error('Incomplete WinGet PR file set');
    if (!files.some(file => file.filename.startsWith(prefix))) continue;
    if (files.map(file => file.filename).sort().join('\n') !== names.map(name => prefix + name).join('\n')) {
      throw new Error('Existing WinGet PR has conflicting manifest file set');
    }
    const remoteFiles = {};
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
      remoteFiles[file.filename.slice(prefix.length)] = crypto.createHash('sha256').update(bytes).digest('hex');
      return [file.filename.slice(prefix.length), document(bytes, version)];
    }));
    // Sort by the same code-point order used for the local file set.
    const ordered = Object.fromEntries(names.map(name => [name, remote[name]]));
    if (JSON.stringify(ordered) !== JSON.stringify(local)) throw new Error('Existing WinGet PR has conflicting manifest payloads');
    const after = api(endpoint);
    if (after.head?.sha !== pr.head.sha || after.state !== pr.state || after.merged !== pr.merged) {
      throw new VerificationUnavailable('WinGet PR head/state changed during verification');
    }
    matches.push({schemaVersion: 'guardscan.winget-submission.v1', tag: `v${version}`,
      repository: REPOSITORY, pullRequest: item.number, headCommit: pr.head.sha,
      state: after.merged ? 'MERGED' : after.state === 'open' ? 'OPEN' : 'CLOSED', manifestSha256: digest,
      files: Object.fromEntries(names.map(name => [name, remoteFiles[name]])),
      remoteDigest: crypto.createHash('sha256').update(names.map(name => `${name}\0${remoteFiles[name]}\n`).join('')).digest('hex'),
      url: `https://github.com/${REPOSITORY}/pull/${item.number}`});
  }
  if (matches.length > 1) throw new Error('Multiple matching WinGet submissions are ambiguous');
  return matches.length ? {submitRequired: false, submission: matches[0]} : {submitRequired: true};
}

function findPublicSubmission(directory, tag, {api = githubApi} = {}) {
  const version = tag.replace(/^v/, '');
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
    throw new Error('WinGet submission requires an exact stable version');
  }
  const prefix = `manifests/n/NaumanTanwir/GuardScan/${version}/`;
  const commit = api(`repos/${REPOSITORY}/commits/master`).sha;
  if (!shaPattern.test(commit || '')) throw new Error('WinGet public commit identity is invalid');
  let entries;
  try { entries = api(`repos/${REPOSITORY}/contents/${prefix.slice(0, -1)}?ref=${commit}`); }
  catch (error) { if (error.status === 404) return {submitRequired: true}; throw error; }
  if (!Array.isArray(entries) || entries.some(entry => entry.type !== 'file')) {
    throw new Error('WinGet public manifest file set is invalid');
  }
  const pr = {number: 1, state: 'closed', merged: true, changed_files: entries.length,
    base: {ref: 'master', repo: {full_name: REPOSITORY}}, head: {sha: commit}};
  const result = findSubmission(directory, tag, {pullRequest: 1, api: endpoint => {
    if (endpoint === `repos/${REPOSITORY}/pulls/1`) return pr;
    if (endpoint === `repos/${REPOSITORY}/pulls/1/files?per_page=100`) {
      return entries.map(entry => ({filename: entry.path, sha: entry.sha, status: 'added'}));
    }
    return api(endpoint);
  }});
  if (result.submitRequired) throw new Error('WinGet public manifest file set is not exact');
  // Reuse PR file verification internally; the public receipt represents a catalog
  // commit and carries no invented pull request identity.
  const {headCommit, files, remoteDigest} = result.submission;
  return {submitRequired: false, publicExact: true, publication: {headCommit, files, remoteDigest}};
}

if (require.main === module) {
  const [directory, tag, evidence, mode] = process.argv.slice(2);
  try {
    const result = mode === '--public' ? findPublicSubmission(directory, tag)
      : findSubmission(directory, tag, mode ? {pullRequest: Number(mode)} : {});
    if (!result.submitRequired && evidence) {
      fs.writeFileSync(evidence, JSON.stringify(result.publication || result.submission, null, 2) + '\n');
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    if (!(error instanceof VerificationUnavailable)) throw error;
    process.stderr.write('WinGet verification temporarily unavailable\n');
    process.exitCode = 75;
  }
}

module.exports = {findSubmission, findPublicSubmission, githubApi, VerificationUnavailable};
