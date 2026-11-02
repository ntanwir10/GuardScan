import {execFileSync} from 'child_process';
import * as path from 'path';

describe('ESLint source guards', () => {
  it('checks typed source and ignores generated JavaScript', () => {
    const packageRoot = path.resolve(__dirname, '../..');
    const {rules, ignored} = JSON.parse(execFileSync(process.execPath, ['-e', `
      const {ESLint} = require('eslint');
      (async () => {
        const eslint = new ESLint({overrideConfigFile: true, overrideConfig: require('./eslint.config')});
        const [result] = await eslint.lintText(
          'export const unsafe: any = 1;\\nPromise.resolve(unsafe);\\n',
          {filePath: 'src/index.ts'}
        );
        process.stdout.write(JSON.stringify({
          rules: result.messages.map(message => message.ruleId),
          ignored: await eslint.isPathIgnored('dist/index.js'),
        }));
      })().catch(error => {console.error(error); process.exitCode = 1;});
    `], {cwd: packageRoot, encoding: 'utf8'})) as {rules: string[]; ignored: boolean};

    expect(rules).toEqual(
      expect.arrayContaining([
        '@typescript-eslint/no-explicit-any',
        '@typescript-eslint/no-floating-promises',
      ])
    );
    expect(ignored).toBe(true);
  });
});
