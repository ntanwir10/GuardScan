const {createPromotionDecision} = require('../../scripts/release/promotion');

const publishedAt = '2026-11-01T00:00:00.000Z';
const channels = ['npm', 'pnpm', 'yarn', 'bun', 'github', 'homebrew', 'scoop', 'pypi'];
const timestamp = (minute: number) => new Date(Date.parse(publishedAt) + minute * 60_000).toISOString();
const hourly = (first: number) => Array.from({length: 24}, (_, index) => first + index * 60);

function input(minutes = hourly(60), evaluatedMinute = Math.max(1440, ...minutes)) {
  return {
    rc: {version: '1.2.3-rc.1', publishedAt, sourcePrHead: 'a'.repeat(40), sourcePrBase: 'b'.repeat(40)},
    currentSourcePrHead: 'a'.repeat(40), currentSourcePrBase: 'b'.repeat(40),
    evaluatedAt: timestamp(evaluatedMinute), incidents: [] as any[],
    canaries: channels.flatMap(channel => minutes.map(minute => ({channel, status: 'passed', checkedAt: timestamp(minute)}))),
  };
}

describe('continuous release promotion soak coverage', () => {
  it.each([75, 90])('permits an initial %i-minute scheduler delay with continuous hourly evidence', first => {
    const decision = createPromotionDecision(input(hourly(first)));
    expect(decision).toMatchObject({eligible: true, result: 'permitted', reasons: []});
    expect(decision.canaries.npm).toMatchObject({sampleCount: 24, coversSoak: true});
  });

  it('allows exactly 90 minutes between samples', () => {
    const minutes = hourly(60).map((minute, index) => minute + (index >= 2 ? 30 : 0));
    expect(createPromotionDecision(input(minutes)).eligible).toBe(true);
  });

  it('rejects a first sample after 90 minutes or an internal gap exceeding 90 minutes', () => {
    expect(createPromotionDecision(input(hourly(91))).reasons).toContain('canary_start_late:npm');
    const minutes = hourly(60).map((minute, index) => minute + (index >= 2 ? 31 : 0));
    expect(createPromotionDecision(input(minutes)).reasons).toContain('canary_soak_coverage_incomplete:npm');
    expect(createPromotionDecision(input([...minutes, 3000], 3000)).eligible).toBe(false);
  });

  it('does not count duplicate timestamps toward the 24-sample floor', () => {
    const minutes = Array.from({length: 23}, (_, index) => 60 + index * 1380 / 22);
    const decision = createPromotionDecision(input([...minutes, ...minutes]));
    expect(decision.canaries.npm.sampleCount).toBe(23);
    expect(decision.reasons).toContain('canary_samples_insufficient:npm');
  });

  it('does not count prepublication or future samples toward the floor', () => {
    const minutes = hourly(60).slice(1);
    const decision = createPromotionDecision(input([-1, ...minutes, 1500], 1440));
    expect(decision.canaries.npm.sampleCount).toBe(23);
    expect(decision.reasons).toEqual(expect.arrayContaining([
      'canary_samples_insufficient:npm', 'canary_predates_publication:npm', 'canary_stale:npm',
    ]));
  });

  it('rejects concentrated distinct samples despite reaching the sample floor', () => {
    const minutes = Array.from({length: 24}, (_, index) => 1417 + index);
    expect(createPromotionDecision(input(minutes)).reasons).toContain('canary_soak_coverage_incomplete:npm');
  });

  it('keeps failures blocking even outside the valid counting window', () => {
    for (const minute of [-1, 1441]) {
      const fixture = input();
      fixture.canaries.push({channel: 'npm', status: 'failed', checkedAt: timestamp(minute)});
      expect(createPromotionDecision(fixture).reasons).toContain('canary_failed:npm');
    }
  });

  it('preserves wall-clock soak, freshness, identity, incident, and channel requirements', () => {
    const beforeSoak = input(hourly(0), 1439);
    expect(createPromotionDecision(beforeSoak).reasons).toContain('soak_window_incomplete');
    expect(createPromotionDecision(input(hourly(60), 1531)).reasons).toContain('canary_stale:npm');
    const changed = input();
    changed.currentSourcePrHead = 'c'.repeat(40);
    changed.currentSourcePrBase = 'd'.repeat(40);
    changed.incidents = [{status: 'open', incidentId: 'incident-1', kind: 'availability'}];
    changed.canaries = changed.canaries.filter(sample => sample.channel !== 'scoop');
    expect(createPromotionDecision(changed).reasons).toEqual(expect.arrayContaining([
      'source_pr_head_changed', 'source_pr_base_changed', 'active_release_incident', 'canary_missing:scoop',
    ]));
    expect(() => createPromotionDecision({...input(), minimumSamples: 23})).toThrow(/24/);
    expect(() => createPromotionDecision({...input(), requiredChannels: ['npm']})).toThrow(/floor/);
  });
});
