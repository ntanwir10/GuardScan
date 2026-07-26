const {
  execArgs,
  installArgs,
  parseManager,
  parseTarball,
  scanArgsFor,
} = require('../../scripts/package-manager-smoke') as {
  execArgs: (manager: string, args: string[]) => string[];
  installArgs: (manager: string, tarball: string) => string[];
  parseManager: (args: string[]) => string;
  parseTarball: (args: string[]) => string | undefined;
  scanArgsFor: (manager: string, output: string) => string[];
};

describe('package-manager smoke command contracts', () => {
  it.each([
    ['npm', ['exec', '--', 'guardscan', '--version']],
    ['pnpm', ['exec', 'guardscan', '--version']],
    ['yarn', ['guardscan', '--version']],
    ['bun', ['run', 'guardscan', '--version']],
  ])('executes the installed GuardScan binary through %s', (manager, expected) => {
    expect(execArgs(manager, ['--version'])).toEqual(expected);
  });

  it.each(['npm', 'pnpm', 'bun'])('disables lifecycle scripts during %s installation', manager => {
    expect(installArgs(manager, '/tmp/guardscan.tgz')).toContain('--ignore-scripts');
  });

  it('uses Yarn configuration rather than an unsupported install flag', () => {
    expect(installArgs('yarn', '/tmp/guardscan.tgz')).toEqual(['add', '/tmp/guardscan.tgz']);
  });

  it('makes Bun partial SBOM inventory explicit without weakening other canaries', () => {
    expect(scanArgsFor('bun', '/tmp/scan.json')).toContain('--allow-partial');
    expect(scanArgsFor('npm', '/tmp/scan.json')).not.toContain('--allow-partial');
  });

  it('rejects omitted and unknown managers', () => {
    expect(() => parseManager([])).toThrow(/--manager must be one of/);
    expect(() => parseManager(['--manager', 'pip'])).toThrow(/--manager must be one of/);
  });

  it('accepts an exact local tarball handoff and rejects missing files', () => {
    const tarball = require.resolve('../../package.json').replace(/package\.json$/, 'fixture.tgz');
    expect(() => parseTarball(['--tarball', tarball])).toThrow();
    expect(parseTarball([])).toBeUndefined();
  });
});
