'use strict';

const crypto = require('crypto');
const {execFileSync} = require('child_process');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const {MAX_LEDGER_BYTES, materializeReleaseState, parseLedgerText} = require('./events');
const {stableVersion} = require('./promotion');

const ajv = new Ajv({allErrors: true, strict: false});
addFormats(ajv);
const validateDecision = ajv.compile(require('../../schemas/guardscan.promotion-decision.v1.schema.json'));
const LEDGER = 'origin/release-ledger';
const MAX_APPROVAL_BYTES = 1024 * 1024;
const TERMINAL = new Set(['rollback_started', 'withdrawn', 'superseded']);

function assertNotTerminal(events) {
  if (events.some(event => TERMINAL.has(event.type))) {
    throw new Error('Promotion recovery cannot revive a rollback or terminal release');
  }
}

// Only an authenticated merged PR (and matching stable tag when present) may reuse approval.
// Fresh promotions always evaluate the complete, current machine policy.
function recoverPromotionApproval(input, git = (...args) => execFileSync('git', args, {
  cwd: input.repository, maxBuffer: args[0] === 'show' ? MAX_LEDGER_BYTES : MAX_APPROVAL_BYTES,
  timeout: 30000, windowsHide: true,
})) {
  const {events, candidate, currentHead, sourcePr, mergeCommit} = input;
  const state = materializeReleaseState(events);
  const started = events[0];
  if (candidate?.sourcePr !== sourcePr || candidate.sourcePrHead !== currentHead
      || started.payload.releasePr !== sourcePr || started.payload.sourcePrHead !== currentHead
      || ['sourcePrBase', 'sourcePrTree'].some(field => (
        !/^[a-f0-9]{40}$/.test(candidate[field] || '')
        || candidate[field] !== started.payload[field]
      ))) {
    throw new Error('Promotion recovery source identity does not match the immutable train');
  }
  assertNotTerminal(events);
  const version = stableVersion(state.version);
  const tag = `v${version}`;
  const ref = `refs/tags/${tag}`;
  let remote;
  try { remote = git('ls-remote', '--exit-code', 'origin', ref, `${ref}^{}`).toString('utf8'); }
  catch (error) {
    if (error.status !== 2) throw error;
    if (mergeCommit === '' || mergeCommit === undefined) return undefined;
  }
  let tagCommit = mergeCommit;
  if (remote !== undefined) {
    const entries = remote.trim().split('\n').map(line => line.split(/\s+/));
    if (entries.length > 2 || entries.some(([sha, name, extra]) => (
      !/^[a-f0-9]{40}$/.test(sha) || ![ref, `${ref}^{}`].includes(name) || extra !== undefined
    )) || entries.filter(([, name]) => name === ref).length !== 1
        || entries.filter(([, name]) => name === `${ref}^{}`).length > 1) {
      throw new Error('Stable tag identity response is malformed');
    }
    tagCommit = (entries.find(([, name]) => name === `${ref}^{}`) || entries[0])[0];
  }
  if (!/^[a-f0-9]{40}$/.test(mergeCommit || '') || tagCommit !== mergeCommit) {
    throw new Error('Stable tag is not bound to the exact merged source PR commit');
  }

  const paths = git('ls-tree', '-r', '-z', LEDGER, '--', 'decisions', `events/${tag}.jsonl`)
    .toString('utf8').split('\0').filter(Boolean).map(entry => {
      const match = entry.match(/^([0-7]{6}) blob ([a-f0-9]{40})\t(.+)$/);
      if (!match) throw new Error('Protected approval tree entry is malformed');
      return {mode: match[1], blob: match[2], path: match[3]};
    });
  const readBlob = (entry, limit) => {
    const size = git('cat-file', '-s', entry.blob).toString('utf8').trim();
    if (!/^(0|[1-9][0-9]*)$/.test(size) || !Number.isSafeInteger(Number(size))
        || Number(size) > limit) throw new Error('Protected approval or ledger exceeds its byte limit');
    const bytes = git('show', entry.blob);
    if (bytes.length !== Number(size)) throw new Error('Protected approval or ledger blob size mismatch');
    return bytes.toString('utf8');
  };
  const stableLedger = paths.find(entry => entry.path === `events/${tag}.jsonl`);
  if (stableLedger) {
    if (stableLedger.mode !== '100644') throw new Error('Stable ledger is not a regular file');
    const stableEvents = parseLedgerText(readBlob(stableLedger, MAX_LEDGER_BYTES));
    const stable = materializeReleaseState(stableEvents);
    if (stable.tag !== tag || stable.commit !== mergeCommit) throw new Error('Stable ledger identity conflict');
    assertNotTerminal(stableEvents);
  }
  const prefix = `decisions/${state.tag}-`;
  const files = paths.filter(entry => entry.path.startsWith(prefix)
    && /^[1-9][0-9]*-[1-9][0-9]*\.json$/.test(entry.path.slice(prefix.length)));
  if (files.length > 1000) throw new Error('Protected promotion approval inventory is too large');
  const byDigest = new Map();
  for (const entry of files) {
    if (entry.mode !== '100644') throw new Error('Protected promotion approval is not a regular file');
    const text = readBlob(entry, MAX_APPROVAL_BYTES);
    byDigest.set(crypto.createHash('sha256').update(text).digest('hex'), text);
  }
  const published = events.find(event => event.type === 'channel_published' && event.channel === 'github');
  for (const event of events.filter(value => value.type === 'promotion_decided'
      && value.payload.result === 'permitted' && value.payload.eligible === true)) {
    const text = byDigest.get(event.payload.decisionSha256);
    if (text === undefined) continue;
    const decision = JSON.parse(text);
    if (!validateDecision(decision) || decision.result !== 'permitted' || decision.eligible !== true
        || decision.reasons.length !== 0 || decision.activeIncidents.length !== 0
        || decision.rc.version !== state.version || decision.rc.tag !== state.tag
        || decision.rc.commit !== state.commit || decision.rc.manifestSha256 !== state.manifestSha256
        || decision.rc.publishedAt !== published?.timestamp
        || decision.rc.sourcePr !== sourcePr || decision.rc.sourcePrHead !== currentHead
        || decision.rc.sourcePrBase !== candidate.sourcePrBase
        || decision.rc.sourcePrTree !== candidate.sourcePrTree
        || decision.stable.version !== version || decision.stable.tag !== tag
        || decision.stable.sourcePr !== sourcePr || decision.stable.sourcePrHead !== currentHead
        || decision.stable.sourcePrBase !== candidate.sourcePrBase
        || decision.stable.sourcePrTree !== candidate.sourcePrTree) {
      throw new Error('Protected promotion approval identity or permitted decision is invalid');
    }
    return {text, decision};
  }
  throw new Error('Existing stable tag has no authenticated original permitted promotion approval');
}

module.exports = {recoverPromotionApproval};
