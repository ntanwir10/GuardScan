const {evaluateBaseline} = require('../../scripts/eslint-ratchet-lib') as {
  evaluateBaseline: (
    current: Record<string, {errors: number; warnings: number}>,
    baseline: Record<string, {errors: number; warnings: number}>,
    fileExists: (file: string) => boolean
  ) => {regressions: string[]; improvements: string[]};
};

describe('ESLint ratchet baseline integrity', () => {
  it('fails when a baseline source file is deleted without baseline review', () => {
    const result = evaluateBaseline(
      {},
      {'src/deleted.ts': {errors: 4, warnings: 2}},
      () => false
    );

    expect(result.regressions).toEqual([
      'src/deleted.ts: baseline source file is missing; regenerate the reviewed baseline',
    ]);
    expect(result.improvements).toEqual([]);
  });

  it('continues to report a cleaned existing file as an improvement', () => {
    const result = evaluateBaseline(
      {},
      {'src/clean.ts': {errors: 1, warnings: 0}},
      () => true
    );

    expect(result.regressions).toEqual([]);
    expect(result.improvements).toEqual(['src/clean.ts: clean']);
  });
});
