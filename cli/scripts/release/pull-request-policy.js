'use strict';

const REPOSITORY = 'ntanwir10/GuardScan';
const BASE = 'main';
const RELEASE_GATE = 'Release gate';
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const MAX_INPUT_BYTES = 128 * 1024;
const MAX_COLLECTION_ITEMS = 1000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(value || '')) throw new Error(`${label} SHA is invalid`);
  return value;
}

function requireCollection(value, label) {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`${label} must be an array with at most ${MAX_COLLECTION_ITEMS} items`);
  }
  return value;
}

function authorizePullRequest(input) {
  requireObject(input, 'pull request authorization input');
  let encoded;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw new Error('pull request authorization input is not serializable');
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_INPUT_BYTES) {
    throw new Error(`pull request authorization input is too large (maximum ${MAX_INPUT_BYTES} bytes)`);
  }

  const expectedHead = requireSha(input.expectedHead, 'expected head');
  const pullRequest = requireObject(input.pullRequest, 'pull request');
  if (!Number.isSafeInteger(pullRequest.number) || pullRequest.number < 1) {
    throw new Error('pull request number is invalid');
  }
  if (pullRequest.state !== 'open') throw new Error('pull request must be OPEN');
  if (pullRequest.draft !== false) throw new Error('pull request must not be draft');
  if (pullRequest.base?.ref !== BASE) throw new Error('pull request must target main');
  if (pullRequest.base?.repo?.full_name !== REPOSITORY) {
    throw new Error('pull request base repository is not the GuardScan repository');
  }
  if (pullRequest.head?.repo?.full_name !== REPOSITORY) {
    throw new Error('pull request head must originate from the GuardScan repository');
  }
  const head = requireSha(pullRequest.head?.sha, 'pull request head');
  if (head !== expectedHead) throw new Error('pull request head does not match expected head');
  const author = requireString(pullRequest.user?.login, 'pull request author').toLowerCase();

  const checkRuns = requireCollection(input.checkRuns, 'check runs');
  for (const check of checkRuns) {
    requireObject(check, 'check run');
    requireString(check.name, 'check run name');
    requireSha(check.head_sha, 'check run head');
    requireString(check.status, 'check run status');
    if (check.conclusion !== null) requireString(check.conclusion, 'check run conclusion');
  }
  if (!checkRuns.some(check => (
    check.name === RELEASE_GATE
    && check.head_sha === head
    && check.status === 'completed'
    && check.conclusion === 'success'
  ))) {
    throw new Error('Release gate has not succeeded for the expected pull request head');
  }

  const reviews = requireCollection(input.reviews, 'reviews');
  for (const review of reviews) {
    requireObject(review, 'review');
    requireString(review.state, 'review state');
    requireSha(review.commit_id, 'review commit');
    requireString(review.user?.login, 'review author');
  }
  if (!reviews.some(review => (
    review.state === 'APPROVED'
    && review.commit_id === head
    && review.user.login.toLowerCase() !== author
  ))) {
    throw new Error('expected a non-author approval bound to the exact pull request head');
  }

  return {
    repository: REPOSITORY,
    number: pullRequest.number,
    base: BASE,
    head,
  };
}

module.exports = {
  authorizePullRequest,
  BASE,
  REPOSITORY,
};
