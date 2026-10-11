import { LOCCounter, normalizeGlobPatternForPlatform, normalizeRelativePathForPlatform } from '../../src/core/loc-counter';
import * as fs from 'fs';
import * as path from 'path';
import * as braceExpansion from '@isaacs/brace-expansion';
import tinyglobby = require('tinyglobby');

describe('LOCCounter', () => {
  let counter: LOCCounter;
  let testDir: string;

  beforeEach(() => {
    counter = new LOCCounter();
    testDir = path.join(__dirname, '../fixtures/loc-test');

    // Create test directory structure
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('cross-platform glob path normalization', () => {
    it.each([
      ['drive-rooted mixed separators', 'C:\\repo\\src/**/*.ts', 'C:/repo/src/**/*.ts'],
      ['UNC-rooted mixed separators', '\\\\server\\share\\repo\\src/**/*.ts', '//server/share/repo/src/**/*.ts'],
      ['directory alternatives', 'C:\\repo/{src,tests}/**/*.ts', 'C:/repo/{src,tests}/**/*.ts'],
      ['escaped literal brackets', 'C:\\repo\\src/\\[fixture\\]/**/*.ts', 'C:/repo/src/\\[fixture\\]/**/*.ts'],
      ['escaped literal braces', 'C:\\repo\\src/\\{fixture,source\\}/**/*.ts', 'C:/repo/src/\\{fixture,source\\}/**/*.ts'],
    ])('normalizes Windows separators for %s without changing glob escapes', (_name, input, expected) => {
      expect(normalizeGlobPatternForPlatform(input, 'win32')).toBe(expected);
    });

    it('leaves POSIX paths and their escaped glob metacharacters unchanged', () => {
      const pattern = '/repo/src/\\[fixture\\]/**/*.ts';

      expect(normalizeGlobPatternForPlatform(pattern, 'linux')).toBe(pattern);
    });

    it('uses forward slashes for Windows relative results without altering POSIX literal backslashes', () => {
      expect(normalizeRelativePathForPlatform('src\\nested\\file.ts', 'win32'))
        .toBe('src/nested/file.ts');
      expect(normalizeRelativePathForPlatform('src\\literal\\file.ts', 'linux'))
        .toBe('src\\literal\\file.ts');
    });
  });

  describe('countFile', () => {
    it('should count lines correctly for JavaScript files', () => {
      const testFile = path.join(testDir, 'test.js');
      const content = `// Comment
function test() {
  return true;
}

// Another comment
const x = 1;`;

      fs.writeFileSync(testFile, content);

      const result = (counter as any).countFile(testFile);

      expect(result).toBeDefined();
      expect(result.codeLines).toBe(4); // function, return, }, const
      expect(result.commentLines).toBe(2);
      expect(result.blankLines).toBe(1);
    });

    it('should count lines correctly for Python files', () => {
      const testFile = path.join(testDir, 'test.py');
      const content = `# Comment
def test():
    return True

# Another comment
x = 1`;

      fs.writeFileSync(testFile, content);

      const result = (counter as any).countFile(testFile);

      expect(result).toBeDefined();
      expect(result.codeLines).toBe(3); // def test(), return True, x = 1
      expect(result.commentLines).toBe(2);
      expect(result.blankLines).toBe(1);
      expect(result.language).toBe('Python');
    });

    it('should handle block comments in C-style languages', () => {
      const testFile = path.join(testDir, 'test.ts');
      const content = `/*
 * Multi-line comment
 * Block comment
 */
const x = 1;
/* inline */ const y = 2;`;

      fs.writeFileSync(testFile, content);

      const result = (counter as any).countFile(testFile);

      expect(result).toBeDefined();
      expect(result.commentLines).toBeGreaterThan(0);
      expect(result.codeLines).toBeGreaterThan(0);
    });

    it('should ignore blank lines', () => {
      const testFile = path.join(testDir, 'test.js');
      const content = `const x = 1;


const y = 2;`;

      fs.writeFileSync(testFile, content);

      const result = (counter as any).countFile(testFile);

      expect(result.blankLines).toBe(2);
      expect(result.codeLines).toBe(2);
    });
  });

  describe('detectLanguage', () => {
    it('should detect JavaScript files', () => {
      const lang = (counter as any).detectLanguage('test.js');
      expect(lang).toBe('JavaScript');
    });

    it('should detect TypeScript files', () => {
      const lang = (counter as any).detectLanguage('test.ts');
      expect(lang).toBe('TypeScript');
    });

    it('should detect Python files', () => {
      const lang = (counter as any).detectLanguage('test.py');
      expect(lang).toBe('Python');
    });

    it('should return Unknown for unsupported extensions', () => {
      const lang = (counter as any).detectLanguage('test.xyz');
      expect(lang).toBe('Unknown');
    });
  });

  describe('count', () => {
    it('should count multiple files', async () => {
      // Create test files
      fs.writeFileSync(path.join(testDir, 'file1.js'), 'const x = 1;\nconst y = 2;');
      fs.writeFileSync(path.join(testDir, 'file2.js'), 'const z = 3;');

      const result = await counter.count([`${testDir}/**/*.js`]);

      expect(result.fileCount).toBe(2);
      expect(result.codeLines).toBe(3);
      expect(result.fileBreakdown).toHaveLength(2);
    });

    it('discovers source files inside dot-directories', async () => {
      const actionDirectory = path.join(testDir, '.github', 'actions', 'fixture');
      const virtualEnvironment = path.join(testDir, 'packages', 'api', '.venv');
      const dependencyDirectory = path.join(virtualEnvironment, 'lib', 'site-packages');
      const firstPartyDirectory = path.join(testDir, 'src', 'venv');
      fs.mkdirSync(actionDirectory, { recursive: true });
      fs.mkdirSync(dependencyDirectory, { recursive: true });
      fs.mkdirSync(firstPartyDirectory, { recursive: true });
      fs.writeFileSync(path.join(actionDirectory, 'index.js'), 'module.exports = true;');
      fs.writeFileSync(path.join(virtualEnvironment, 'pyvenv.cfg'), 'home = /usr/bin');
      fs.writeFileSync(path.join(dependencyDirectory, 'dependency.py'), 'installed = True');
      fs.writeFileSync(path.join(firstPartyDirectory, 'security.py'), 'first_party = True');

      const result = await counter.count([`${testDir}/**/*.{js,py}`]);

      expect(result.fileBreakdown).toEqual(expect.arrayContaining([
        expect.objectContaining({path: expect.stringContaining('.github/actions/fixture/index.js')}),
        expect.objectContaining({path: expect.stringContaining('src/venv/security.py')}),
      ]));
      expect(result.fileBreakdown).not.toEqual(expect.arrayContaining([
        expect.objectContaining({path: expect.stringContaining('.venv/lib/site-packages/dependency.py')}),
      ]));
    });

    it('keeps brace-expanded directory roots bounded while excluding virtual environments', async () => {
      const dependencyEnvironment = path.join(testDir, 'src', '.venv');
      const dependencyFile = path.join(dependencyEnvironment, 'lib', 'dependency.py');
      const firstPartyFile = path.join(testDir, 'src', 'venv', 'security.py');
      const testFile = path.join(testDir, 'tests', 'security.py');
      fs.mkdirSync(path.dirname(dependencyFile), {recursive: true});
      fs.mkdirSync(path.dirname(firstPartyFile), {recursive: true});
      fs.mkdirSync(path.dirname(testFile), {recursive: true});
      fs.writeFileSync(path.join(dependencyEnvironment, 'pyvenv.cfg'), 'home = /usr/bin');
      fs.writeFileSync(dependencyFile, 'installed = True');
      fs.writeFileSync(firstPartyFile, 'first_party = True');
      fs.writeFileSync(testFile, 'test_source = True');

      const result = await counter.count([
        `${testDir}/{src,tests}/**/*.py`,
        `!${testDir}/tests/**`,
      ]);

      expect(result.fileBreakdown.map(file => file.path)).toEqual([
        expect.stringContaining('src/venv/security.py'),
      ]);
    });

    it('rejects brace patterns that exceed the bounded expansion limit', async () => {
      const oversizedPattern = `${testDir}/${'{a,b}'.repeat(14)}/**/*.py`;

      await expect(counter.count([oversizedPattern])).rejects.toThrow(/expansion/i);
    });

    it('rejects excessively nested braces before recursive expansion', async () => {
      const deeplyNestedPattern = `${testDir}/${'{'.repeat(65)}source${'}'.repeat(65)}/**/*.py`;

      await expect(counter.count([deeplyNestedPattern])).rejects.toThrow(/nesting depth/i);
    });

    it.each([
      ['zero numeric step', '{1..10..0}', /sequence step/i],
      ['zero alphabetic step', '{a..z..0}', /sequence step/i],
      ['unbounded numeric range', '{1..1000000000}', /range expansion/i],
      ['unsafe numeric endpoint', '{9007199254740992..9007199254740993}', /safe integer/i],
      ['recursive sibling braces', '{a}'.repeat(65), /brace count/i],
      ['overlong pattern', 'a'.repeat(16_385), /pattern length/i],
      ['negative zero-step pattern', '!{1..10..0}', /sequence step/i],
    ])('rejects %s before invoking third-party parsers', async (_name, pattern, expectedError) => {
      // Avoid hanging the RED run in a parser whose range loop is unbounded.
      const expandSpy = jest.spyOn(braceExpansion, 'expand').mockImplementation(value => [value]);
      const globSpy = jest.spyOn(tinyglobby, 'glob').mockResolvedValue([]);
      try {
        await expect(counter.count([pattern as string])).rejects.toThrow(expectedError as RegExp);
        expect(expandSpy).not.toHaveBeenCalled();
        expect(globSpy).not.toHaveBeenCalled();
      } finally {
        expandSpy.mockRestore();
        globSpy.mockRestore();
      }
    });

    it('preserves bounded forward, reverse and padded sequence patterns', async () => {
      for (const name of ['file01.py', 'file03.py', 'file05.py']) {
        fs.writeFileSync(path.join(testDir, name), 'safe = True');
      }
      const forward = await counter.count([`${testDir}/file{01..05..2}.py`]);
      const reverse = await counter.count([`${testDir}/file{05..01..-2}.py`]);
      expect(forward.fileBreakdown.map(file => file.path).sort()).toEqual(
        reverse.fileBreakdown.map(file => file.path).sort()
      );
      expect(forward.fileCount).toBe(3);
    });

    it('preserves literal escaped braces alongside sequence exclusions', async () => {
      const literalDirectory = path.join(testDir, '{fixture,source}');
      fs.mkdirSync(literalDirectory, {recursive: true});
      for (const name of ['file01.py', 'file03.py', 'file05.py']) {
        fs.writeFileSync(path.join(literalDirectory, name), 'safe = True');
      }
      const prefix = `${testDir}/\\{fixture,source\\}`;
      const result = await counter.count([
        `${prefix}/file{01..05..2}.py`,
        `!${prefix}/file{03..05..2}.py`,
      ]);
      expect(result.fileBreakdown.map(file => file.path)).toEqual([
        expect.stringContaining('{fixture,source}/file01.py'),
      ]);
    });

    it('matches escaped literal metacharacters in targeted paths', async () => {
      const literalDirectory = path.join(testDir, '[fixture]');
      const sourceFile = path.join(literalDirectory, 'security.py');
      fs.mkdirSync(literalDirectory, {recursive: true});
      fs.writeFileSync(sourceFile, 'safe = True');

      const result = await counter.count([`${testDir}/\\[fixture\\]/**/*.py`]);

      expect(result.fileBreakdown.map(file => file.path)).toEqual([
        expect.stringContaining('[fixture]/security.py'),
      ]);
    });

    it('should respect ignore patterns', async () => {
      // Create files including ones that should be ignored
      fs.mkdirSync(path.join(testDir, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'file1.js'), 'const x = 1;');
      fs.writeFileSync(path.join(testDir, 'node_modules', 'file2.js'), 'const y = 2;');

      const result = await counter.count([`${testDir}/**/*.js`]);

      // Should find both files since fastGlob also ignores node_modules by default
      // but our test pattern includes the full path which bypasses the ignore
      expect(result.fileCount).toBeGreaterThanOrEqual(1);
      expect(result.fileBreakdown.some(f => f.path.includes('file1.js'))).toBe(true);
    });

    it('reports files that were discovered but could not be read', async () => {
      const unreadable = path.join(testDir, 'unreadable.rs');
      fs.writeFileSync(unreadable, 'fn main() {}');
      const countFile = jest.spyOn(counter as any, 'countFile').mockReturnValue(null);

      const result = await counter.count([unreadable]);

      expect(result.fileBreakdown).toEqual([]);
      expect(result.skippedFiles).toEqual([expect.stringContaining('unreadable.rs')]);
      countFile.mockRestore();
    });

    it('excludes a targeted file inside a confirmed virtual environment', async () => {
      const virtualEnvironment = path.join(testDir, 'targeted-venv');
      const target = path.join(virtualEnvironment, 'lib', 'target.py');
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(path.join(virtualEnvironment, 'pyvenv.cfg'), 'home = /usr/bin');
      fs.writeFileSync(target, 'installed = True');

      const result = await counter.count([target]);

      expect(result.fileBreakdown).toEqual([]);
    });
  });

  describe('isComment', () => {
    it('should detect single-line comments', () => {
      const result = (counter as any).isComment('// This is a comment', 'JavaScript', false);
      expect(result.isComment).toBe(true);
    });

    it('should detect Python comments', () => {
      const result = (counter as any).isComment('# This is a comment', 'Python', false);
      expect(result.isComment).toBe(true);
    });

    it('should not detect regular code as comments', () => {
      const result = (counter as any).isComment('const x = 1;', 'JavaScript', false);
      expect(result.isComment).toBe(false);
    });
  });
});
