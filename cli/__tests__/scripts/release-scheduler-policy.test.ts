import fs from 'fs';
import path from 'path';
import vm from 'vm';
import yaml from 'js-yaml';

const workflowPath = path.resolve(__dirname, '../../../.github/workflows/release-train.yml');
const workflow = yaml.load(fs.readFileSync(workflowPath, 'utf8')) as any;
const step = workflow.jobs.reconcile.steps.find((candidate: any) => (
  candidate.name === 'Trigger promotion when the machine policy is eligible'
));
const scriptMatch = (step?.run as string | undefined)?.match(/ELIGIBLE="\$\(CURRENT_HEAD="\$CURRENT_HEAD" node - <<'NODE'\n([\s\S]*?)\nNODE\n\s*\)"/);

if (!scriptMatch) throw new Error('scheduler promotion policy Node block was not found');

const policyScript = scriptMatch[1];
const publishedAt = '2026-01-01T00:00:00.000Z';
const evaluatedAt = '2026-01-02T02:00:00.000Z';
const sourcePrHead = 'a'.repeat(40);
const channels = ['npm', 'pnpm', 'yarn', 'bun', 'github', 'homebrew', 'scoop', 'pypi'];

function fixture(overrides: {
  firstAt?: string;
  latestAt?: string;
  currentHead?: string;
  candidateHead?: string;
  startedHead?: string;
  releasePr?: number;
  candidatePr?: number;
  startedPr?: number;
} = {}) {
  const checkedAts = [overrides.firstAt || publishedAt,
    ...Array.from({length: 23}, () => overrides.latestAt || evaluatedAt)];
  const candidateHead = overrides.candidateHead || sourcePrHead;
  const candidatePr = overrides.candidatePr || 42;
  const events = [
    {
      type: 'train_started',
      payload: {
        releasePr: overrides.startedPr || candidatePr,
        sourcePrHead: overrides.startedHead || candidateHead,
      },
    },
    {
      type: 'channel_published', channel: 'github', timestamp: publishedAt,
    },
  ];
  const state = {
    version: '1.2.3-rc.1',
    tag: 'v1.2.3-rc.1',
    commit: 'b'.repeat(40),
    manifestSha256: 'c'.repeat(64),
    canaries: Object.fromEntries(channels.map(channel => [channel,
      checkedAts.map(sampleTime => ({status: 'passed', checkedAt: sampleTime})),
    ])),
    incidents: {},
  };
  return {
    events,
    state,
    candidate: {sourcePr: candidatePr, sourcePrHead: candidateHead},
    currentHead: overrides.currentHead || candidateHead,
    releasePr: overrides.releasePr || candidatePr,
  };
}

function evaluate(input: ReturnType<typeof fixture>): string {
  let output = '';
  class FixedDate extends Date {
    constructor(value?: string | number | Date) {
      super(value === undefined ? evaluatedAt : value instanceof Date ? value.getTime() : value);
    }
    static now() { return new Date(evaluatedAt).getTime(); }
  }
  vm.runInNewContext(policyScript, {
    Date: FixedDate,
    process: {
      env: {
        CURRENT_HEAD: input.currentHead,
        RELEASE_PR: String(input.releasePr),
      },
      stdout: {write: (value: string) => { output += value; }},
    },
    require: (name: string) => {
      if (name === 'fs') return {readFileSync: () => JSON.stringify(input.candidate)};
      if (name === './cli/scripts/release/events') return {
        readEvents: () => input.events,
        materializeReleaseState: () => input.state,
      };
      if (name === './cli/scripts/release/promotion') {
        return require('../../scripts/release/promotion');
      }
      throw new Error(`unexpected require: ${name}`);
    },
  });
  return output;
}

describe('release scheduler promotion policy', () => {
  it('uses the same complete machine decision as prepare for eligible evidence', () => {
    expect(evaluate(fixture())).toBe('true');
  });

  it('denies promotion when the first canary evidence starts late', () => {
    expect(evaluate(fixture({firstAt: '2026-01-01T02:00:00.000Z'}))).toBe('false');
  });

  it('denies promotion when the latest canary evidence is stale', () => {
    expect(evaluate(fixture({latestAt: '2026-01-02T00:00:00.000Z'}))).toBe('false');
  });

  it('denies promotion when the current source PR head has changed', () => {
    expect(evaluate(fixture({currentHead: 'd'.repeat(40)}))).toBe('false');
  });

  it('fails closed when the candidate and immutable train binding disagree', () => {
    expect(() => evaluate(fixture({startedHead: 'd'.repeat(40)})))
      .toThrow('Promotion source PR does not match the immutable candidate and recorded train head');
  });

  it('fetches the current source PR head with quoted GH CLI arguments before evaluating policy', () => {
    expect(step.run).toContain('CURRENT_HEAD="$(gh pr view "$RELEASE_PR"');
    expect(step.run).toContain('--json headRefOid --jq .headRefOid)"');
    expect(step.run.indexOf('CURRENT_HEAD="$(gh pr view'))
      .toBeLessThan(step.run.indexOf('ELIGIBLE="$(CURRENT_HEAD="$CURRENT_HEAD" node'));
  });
});
