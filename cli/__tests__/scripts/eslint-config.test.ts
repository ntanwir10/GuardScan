const {ESLint} = require('eslint');

describe('ESLint source guards', () => {
  it('checks typed source and ignores generated JavaScript', async () => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: require('../../eslint.config'),
    });
    const [result] = await eslint.lintText(
      'export const unsafe: any = 1;\nPromise.resolve(unsafe);\n',
      {filePath: 'src/index.ts'}
    );

    expect(result.messages.map((message: {ruleId: string}) => message.ruleId)).toEqual(
      expect.arrayContaining([
        '@typescript-eslint/no-explicit-any',
        '@typescript-eslint/no-floating-promises',
      ])
    );
    expect(await eslint.isPathIgnored('dist/index.js')).toBe(true);
  });
});
