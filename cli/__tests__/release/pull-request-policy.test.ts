import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const {authorizePullRequest} = require('../../scripts/release/pull-request-policy');
const {main} = require('../../scripts/release/index');

const head = 'a'.repeat(40);

function fixture(overrides: Record<string, any> = {}) {
  const pullRequestOverrides = overrides.pullRequest || {};
  return {
    expectedHead: overrides.expectedHead ?? head,
    expectedNumber: overrides.expectedNumber,
    expectedBase: overrides.expectedBase,
    allowMerged: overrides.allowMerged ?? false,
    readinessPreflight: overrides.readinessPreflight ?? false,
    pullRequest: {
      number: 123,
      state: 'open',
      draft: false,
      user: {login: 'release-author'},
      ...pullRequestOverrides,
      base: {
        ref: 'main',
        sha: 'b'.repeat(40),
        repo: {full_name: 'ntanwir10/GuardScan', ...pullRequestOverrides.base?.repo},
        ...pullRequestOverrides.base,
      },
      head: {
        sha: head,
        ...pullRequestOverrides.head,
        repo: {full_name: 'ntanwir10/GuardScan', ...pullRequestOverrides.head?.repo},
      },
    },
    checkRuns: overrides.checkRuns ?? [{
      name: 'Release gate',
      head_sha: head,
      status: 'completed',
      conclusion: 'success',
    }],
    reviews: overrides.reviews ?? [{
      state: 'APPROVED',
      commit_id: head,
      user: {login: 'independent-reviewer'},
    }],
  };
}

describe('pull request release authorization policy', () => {
  it('returns only the validated repository, PR, base, and exact head identity', () => {
    expect(authorizePullRequest(fixture())).toEqual({
      repository: 'ntanwir10/GuardScan',
      number: 123,
      base: 'main',
      head: head,
    });
  });

  it('ignores unrelated queued checks when the exact Release gate succeeded', () => {
    expect(authorizePullRequest(fixture({
      checkRuns: [
        {name: 'lint', head_sha: head, status: 'in_progress', conclusion: null},
        {name: 'Release gate', head_sha: head, status: 'completed', conclusion: 'success'},
      ],
    }))).toMatchObject({head});
  });

  it('allows only an explicitly permitted, valid merged PR for promotion recovery', () => {
    expect(authorizePullRequest(fixture({
      allowMerged: true,
      pullRequest: {
        state: 'closed',
        merged: true,
        merge_commit_sha: 'c'.repeat(40),
      },
    }))).toMatchObject({head});
    expect(() => authorizePullRequest(fixture({
      allowMerged: true,
      pullRequest: {state: 'closed', merged: false, merge_commit_sha: 'c'.repeat(40)},
    }))).toThrow(/OPEN or an explicitly allowed merged release/);
    expect(() => authorizePullRequest(fixture({
      allowMerged: true,
      pullRequest: {state: 'closed', merged: true, merge_commit_sha: 'not-a-sha'},
    }))).toThrow(/OPEN or an explicitly allowed merged release/);
  });

  it('allows a draft only for an exact, fully gated readiness preflight', () => {
    expect(authorizePullRequest(fixture({
      readinessPreflight: true,
      expectedNumber: 123,
      expectedBase: 'b'.repeat(40),
      pullRequest: {draft: true},
    }))).toMatchObject({number: 123, head});
    expect(() => authorizePullRequest(fixture({
      readinessPreflight: true,
      allowMerged: true,
      pullRequest: {draft: true},
    }))).toThrow(/cannot be combined/i);
    expect(() => authorizePullRequest(fixture({
      readinessPreflight: true,
      expectedNumber: 124,
      expectedBase: 'b'.repeat(40),
      pullRequest: {draft: true},
    }))).toThrow(/number does not match/i);
    expect(() => authorizePullRequest(fixture({
      readinessPreflight: true,
      expectedNumber: 123,
      expectedBase: 'c'.repeat(40),
      pullRequest: {draft: true},
    }))).toThrow(/base SHA does not match/i);
    expect(() => authorizePullRequest(fixture({
      readinessPreflight: true,
      expectedNumber: 123,
      expectedBase: 'b'.repeat(40),
      pullRequest: {draft: true},
      reviews: [],
    }))).toThrow(/non-author approval/i);
    expect(() => authorizePullRequest(fixture({
      readinessPreflight: true,
      expectedNumber: 123,
      expectedBase: 'b'.repeat(40),
      pullRequest: {draft: true},
      checkRuns: [{name: 'Release gate', head_sha: head, status: 'completed', conclusion: 'failure'}],
    }))).toThrow(/Release gate has not succeeded/i);
    expect(() => authorizePullRequest(fixture({
      readinessPreflight: true,
      expectedNumber: 123,
      expectedBase: 'b'.repeat(40),
      expectedHead: 'c'.repeat(40),
      pullRequest: {draft: true},
    }))).toThrow(/head does not match expected head/i);
    expect(() => authorizePullRequest(fixture({
      readinessPreflight: true,
      expectedNumber: 123,
      expectedBase: 'b'.repeat(40),
      pullRequest: {draft: true, head: {repo: {full_name: 'attacker/GuardScan'}}},
    }))).toThrow(/head must originate from the GuardScan repository/i);
    expect(() => authorizePullRequest(fixture({
      readinessPreflight: true,
      expectedNumber: 123,
      expectedBase: 'b'.repeat(40),
      allowMerged: true,
      pullRequest: {
        state: 'closed',
        draft: false,
        merged: true,
        merge_commit_sha: 'c'.repeat(40),
      },
    }))).toThrow(/cannot be combined/i);
    expect(() => authorizePullRequest(fixture({
      readinessPreflight: true,
      expectedNumber: 123,
      expectedBase: 'b'.repeat(40),
    })))
      .toThrow(/draft PR/i);
  });

  it.each([
    ['wrong repository', {pullRequest: {head: {repo: {full_name: 'attacker/GuardScan'}}}}],
    ['fork head', {pullRequest: {head: {repo: {full_name: 'ntanwir10/GuardScan-fork'}}}}],
    ['wrong base repository', {pullRequest: {base: {repo: {full_name: 'attacker/GuardScan'}}}}],
    ['wrong base', {pullRequest: {base: {ref: 'release/1.1.0'}}}],
    ['closed PR', {pullRequest: {state: 'closed'}}],
    ['draft PR', {pullRequest: {draft: true}}],
    ['changed head', {pullRequest: {head: {sha: 'b'.repeat(40)}}}],
    ['wrong expected head', {expectedHead: 'b'.repeat(40)}],
    ['incomplete check', {checkRuns: [{name: 'Release gate', head_sha: head, status: 'in_progress', conclusion: null}]}],
    ['neutral check', {checkRuns: [{name: 'Release gate', head_sha: head, status: 'completed', conclusion: 'neutral'}]}],
    ['stale check', {checkRuns: [{name: 'Release gate', head_sha: 'b'.repeat(40), status: 'completed', conclusion: 'success'}]}],
    ['self approval', {reviews: [{state: 'APPROVED', commit_id: head, user: {login: 'release-author'}}]}],
    ['stale approval', {reviews: [{state: 'APPROVED', commit_id: 'b'.repeat(40), user: {login: 'independent-reviewer'}}]}],
  ])('rejects %s', (_label, overrides) => {
    expect(() => authorizePullRequest(fixture(overrides))).toThrow();
  });

  it('rejects malformed and oversized GitHub fixtures before authorization', () => {
    expect(() => authorizePullRequest(null)).toThrow(/object/);
    expect(() => authorizePullRequest(fixture({pullRequest: {head: {sha: 'not-a-sha'}}})))
      .toThrow(/head SHA/);
    expect(() => authorizePullRequest(fixture({reviews: 'not-an-array'} as any))).toThrow(/reviews/);
    expect(() => authorizePullRequest(fixture({pullRequest: {title: 'x'.repeat(140_000)}})))
      .toThrow(/too large/);
  });

  it('authorizes the same bounded fixtures through the release CLI', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-pr-policy-'));
    const input = fixture();
    const files = {
      pullRequest: path.join(root, 'pull-request.json'),
      checkRuns: path.join(root, 'check-runs.json'),
      reviews: path.join(root, 'reviews.json'),
    };
    fs.writeFileSync(files.pullRequest, JSON.stringify(input.pullRequest));
    fs.writeFileSync(files.checkRuns, JSON.stringify(input.checkRuns));
    fs.writeFileSync(files.reviews, JSON.stringify(input.reviews));
    const output: string[] = [];
    const write = jest.spyOn(process.stdout, 'write').mockImplementation((value: any) => {
      output.push(String(value));
      return true;
    });
    try {
      await main([
        'validate-pr',
        '--pull-request', files.pullRequest,
        '--check-runs', files.checkRuns,
        '--reviews', files.reviews,
        '--expected-head', head,
      ]);
      expect(JSON.parse(output.join(''))).toEqual({
        repository: 'ntanwir10/GuardScan',
        number: 123,
        base: 'main',
        head,
      });
    } finally {
      write.mockRestore();
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('exposes draft preflight only through the private release validation command', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-pr-readiness-'));
    const base = 'b'.repeat(40);
    const input = fixture({
      readinessPreflight: true,
      expectedNumber: 123,
      expectedBase: base,
      pullRequest: {draft: true},
    });
    const files = {
      pullRequest: path.join(root, 'pull-request.json'),
      checkRuns: path.join(root, 'check-runs.json'),
      reviews: path.join(root, 'reviews.json'),
    };
    fs.writeFileSync(files.pullRequest, JSON.stringify(input.pullRequest));
    fs.writeFileSync(files.checkRuns, JSON.stringify(input.checkRuns));
    fs.writeFileSync(files.reviews, JSON.stringify(input.reviews));
    const output: string[] = [];
    const write = jest.spyOn(process.stdout, 'write').mockImplementation((value: any) => {
      output.push(String(value));
      return true;
    });
    try {
      await main([
        'validate-pr',
        '--pull-request', files.pullRequest,
        '--check-runs', files.checkRuns,
        '--reviews', files.reviews,
        '--expected-head', head,
        '--expected-number', '123',
        '--expected-base', base,
        '--readiness-preflight',
      ]);
      expect(JSON.parse(output.join(''))).toEqual({
        repository: 'ntanwir10/GuardScan',
        number: 123,
        base: 'main',
        baseSha: base,
        head,
      });
    } finally {
      write.mockRestore();
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});
