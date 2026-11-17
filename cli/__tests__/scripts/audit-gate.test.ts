const {blockingAdvisories} = require('../../scripts/release/audit-gate') as {
  blockingAdvisories: (report: unknown, level: string, now?: Date) => string[];
};

const advisory = (id: string, severity: string) => ({url: `https://github.com/advisories/${id}`, severity, name: 'pkg'});
const report = (...via: unknown[]) => ({vulnerabilities: {pkg: {via}, parent: {via: ['pkg']}}});

describe('audit gate', () => {
  it('allows only the reviewed advisory, and only until it expires', () => {
    const picomatch = report(advisory('GHSA-fc5q-39xc-vjpf', 'high'));
    expect(blockingAdvisories(picomatch, 'moderate', new Date('2026-12-17T12:00:00Z'))).toEqual([]);
    expect(blockingAdvisories(picomatch, 'moderate', new Date('2026-12-18T00:00:01Z'))).toHaveLength(1);
  });

  it('blocks any other advisory at or above the level and ignores lower ones', () => {
    expect(blockingAdvisories(report(advisory('GHSA-new', 'high')), 'high')).toEqual(['GHSA-new high pkg']);
    expect(blockingAdvisories(report(advisory('GHSA-low', 'low')), 'moderate')).toEqual([]);
    expect(() => blockingAdvisories(report(), 'severe')).toThrow(/unknown audit level/);
  });
});
