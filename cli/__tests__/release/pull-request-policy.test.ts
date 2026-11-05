import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const {authorizePullRequest} = require('../../scripts/release/pull-request-policy');
const {main} = require('../../scripts/release/index');

const head = 'a'.repeat(40);

function gate(overrides: Record<string, any> = {}) {
  return {
    name: 'Release gate', head_sha: head, status: 'completed', conclusion: 'success',
    app: {id: 15368, slug: 'github-actions'},
    ...overrides,
  };
}

function review(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    state: 'APPROVED',
    commit_id: head,
    user: {login: 'independent-reviewer'},
    author_association: 'MEMBER',
    submitted_at: '2026-11-04T00:00:00Z',
    ...overrides,
  };
}

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
    checkRuns: overrides.checkRuns ?? [gate()],
    reviews: overrides.reviews ?? [{
      ...review(),
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
        gate(),
      ],
    }))).toMatchObject({head});
  });

  it.each([
    undefined, null, {}, {id: 15368}, {slug: 'github-actions'},
    {id: '15368', slug: 'github-actions'}, {id: 12345, slug: 'github-actions'},
    {id: 15368, slug: 'other-app'}, {id: 12345, slug: 'other-app'},
  ])('rejects Release gate evidence without the exact trusted App identity %j', app => {
    expect(() => authorizePullRequest(fixture({checkRuns: [gate({app})]})))
      .toThrow(/Release gate/);
  });

  it.each([
    {status: 'completed', conclusion: 'failure'},
    {status: 'in_progress', conclusion: null},
  ])('rejects a foreign App success while the trusted gate is %j', trusted => {
    expect(() => authorizePullRequest(fixture({checkRuns: [
      gate({app: {id: 12345, slug: 'other-app'}}), gate(trusted),
    ]}))).toThrow(/Release gate/);
  });

  it('ignores foreign producers and stale trusted runs when the current trusted gate succeeds', () => {
    expect(authorizePullRequest(fixture({checkRuns: [gate(),
      gate({app: {id: 12345, slug: 'other-app'}, conclusion: 'failure'}),
      gate({app: {id: 12345, slug: 'other-app'}, status: 'queued', conclusion: null}),
      gate({app: undefined}), gate({head_sha: 'b'.repeat(40)}),
    ]}))).toMatchObject({head});
  });

  it.each(['success', 'failure'])('rejects ambiguous trusted gate results including a second %s', conclusion => {
    const duplicate = gate({conclusion});
    for (const checkRuns of [[gate(), duplicate], [duplicate, gate()]]) {
      expect(() => authorizePullRequest(fixture({checkRuns}))).toThrow(/Release gate/);
    }
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
      checkRuns: [gate({conclusion: 'failure'})],
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
    ['incomplete check', {checkRuns: [gate({status: 'in_progress', conclusion: null})]}],
    ['neutral check', {checkRuns: [gate({conclusion: 'neutral'})]}],
    ['stale check', {checkRuns: [gate({head_sha: 'b'.repeat(40)})]}],
    ['self approval', {reviews: [review({user: {login: 'RELEASE-AUTHOR'}})]}],
    ['stale approval', {reviews: [review({commit_id: 'b'.repeat(40)})]}],
  ])('rejects %s', (_label, overrides) => {
    expect(() => authorizePullRequest(fixture(overrides))).toThrow();
  });

  it.each(['NONE', 'CONTRIBUTOR', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'MANNEQUIN'])(
    'rejects an exact-head approval from association %s', author_association => {
      expect(() => authorizePullRequest(fixture({reviews: [review({author_association})]})))
        .toThrow(/approval/);
    }
  );

  it.each(['OWNER', 'MEMBER', 'COLLABORATOR'])(
    'accepts an exact-head approval from association %s', author_association => {
      expect(authorizePullRequest(fixture({reviews: [review({author_association})]})))
        .toMatchObject({head});
    }
  );

  it.each(['CHANGES_REQUESTED', 'DISMISSED'])(
    'does not revive an approval superseded by %s regardless of array order', state => {
      const earlier = review();
      const later = review({id: 2, state, submitted_at: '2026-11-04T00:01:00Z'});
      for (const reviews of [[earlier, later], [later, earlier]]) {
        expect(() => authorizePullRequest(fixture({reviews}))).toThrow();
      }
    }
  );

  it('uses review IDs to order submissions sharing the same timestamp', () => {
    expect(() => authorizePullRequest(fixture({reviews: [
      review({id: 2, state: 'CHANGES_REQUESTED'}), review(),
    ]}))).toThrow(/changes requested/i);
    expect(authorizePullRequest(fixture({reviews: [
      review({id: 2}), review({state: 'CHANGES_REQUESTED'}),
    ]}))).toMatchObject({head});
  });

  it('orders review submission timestamps before IDs and input array order', () => {
    const earlier = review({id: 100});
    const later = review({id: 2, state: 'CHANGES_REQUESTED', submitted_at: '2026-11-04T00:01:00.000Z'});
    for (const reviews of [[earlier, later], [later, earlier]]) {
      expect(() => authorizePullRequest(fixture({reviews}))).toThrow(/changes requested/i);
    }
  });

  it('keeps outstanding changes requested by another reviewer blocking across heads and comments', () => {
    const requested = review({id: 2, state: 'CHANGES_REQUESTED', commit_id: 'b'.repeat(40),
      user: {login: 'Other-Reviewer'}});
    const comment = review({id: 3, state: 'COMMENTED', user: {login: 'other-reviewer'},
      submitted_at: '2026-11-04T00:01:00Z'});
    expect(() => authorizePullRequest(fixture({reviews: [review(), requested, comment]})))
      .toThrow(/changes requested/i);
    expect(authorizePullRequest(fixture({reviews: [review(), requested,
      review({id: 3, state: 'DISMISSED', user: {login: 'other-reviewer'},
        submitted_at: '2026-11-04T00:01:00Z'}),
    ]}))).toMatchObject({head});
  });

  it('does not let an outsider changes request block a trusted approval', () => {
    expect(authorizePullRequest(fixture({reviews: [review(), review({id: 2,
      state: 'CHANGES_REQUESTED', author_association: 'NONE', user: {login: 'outsider'}}),
    ]}))).toMatchObject({head});
  });

  it('ignores unsubmitted pending drafts without revoking or supplying approval', () => {
    const pending = review({id: 2, state: 'PENDING', submitted_at: null, commit_id: null});
    expect(authorizePullRequest(fixture({reviews: [review(), pending]}))).toMatchObject({head});
    expect(() => authorizePullRequest(fixture({reviews: [pending]}))).toThrow(/approval/);
  });

  it('requires the latest approval from a reviewer to bind the current head', () => {
    expect(() => authorizePullRequest(fixture({reviews: [review(),
      review({id: 2, commit_id: 'b'.repeat(40), submitted_at: '2026-11-04T00:01:00Z'}),
    ]}))).toThrow(/approval/);
    expect(authorizePullRequest(fixture({reviews: [review(),
      review({id: 2, state: 'COMMENTED', submitted_at: '2026-11-04T00:01:00Z'}),
    ]}))).toMatchObject({head});
  });

  it.each([
    {id: undefined}, {id: 0}, {id: 1.5}, {submitted_at: undefined},
    {submitted_at: 'invalid'}, {submitted_at: '2026-02-30T00:00:00Z'},
    {author_association: undefined}, {author_association: 'maintainer'}, {state: 'UNKNOWN'},
  ])('rejects malformed review metadata %j', overrides => {
    expect(() => authorizePullRequest(fixture({reviews: [review(overrides)]}))).toThrow();
  });

  it('rejects missing review evidence and conflicting duplicate review IDs', () => {
    expect(() => authorizePullRequest({...fixture(), reviews: undefined})).toThrow(/reviews/);
    expect(() => authorizePullRequest(fixture({reviews: [review(), review({state: 'DISMISSED'})]})))
      .toThrow(/review.*id/i);
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
