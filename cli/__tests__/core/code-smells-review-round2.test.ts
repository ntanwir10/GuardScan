/** Regression tests for the second round of review findings on the smell and metrics analyzers. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { codeSmellDetector, CodeSmell } from '../../src/core/code-smells';

const dirs: string[] = [];
function makeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-round2-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}
const smellsOf = (files: Record<string, string>): Promise<CodeSmell[]> => codeSmellDetector.detect(makeDir(files));
const ofType = (smells: CodeSmell[], type: string) => smells.filter(s => s.type === type);
const cycleNames = (s: CodeSmell) => s.details.cycle.map((f: string) => path.basename(f));

afterEach(() => {
  while (dirs.length > 0) {
    fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe('Python structure', () => {
  it('does not end a function at a multiline string closed at column 0', async () => {
    const q = '"'.repeat(3);
    const smells = await smellsOf({ 'a.py': `def f():\n    text = ${q}one\ntwo\n${q}\n    return text\n` });
    expect(ofType(smells, 'Unused Variable')).toEqual([]);
  });

  it('does not count / and bare * separators as parameters', async () => {
    const smells = await smellsOf({ 'a.py': 'def f(a, b, /, c, *, d, e):\n    return a\n' });
    expect(ofType(smells, 'Long Parameter List')).toEqual([]);
  });

  it('computes deeply nested def ends in linear time', async () => {
    const depth = 1500;
    const lines: string[] = [];
    for (let i = 0; i < depth; i++) {
      lines.push(`${' '.repeat(i)}def f${i}():`);
    }
    lines.push(`${' '.repeat(depth)}pass`, '\n'.repeat(200000));
    const dir = makeDir({ 'deep.py': lines.join('\n') });
    const start = Date.now();
    await codeSmellDetector.detect(dir);
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it('exempts an except handler whose pass is followed by an indented comment', async () => {
    const smells = await smellsOf({
      'a.py': 'try:\n    x = 1\nexcept ValueError:\n    pass\n    # expected, ignore\ny = 2\n',
      'b.py': 'try:\n    x = 1\nexcept ValueError:\n    pass\n# about the next statement\ny = 2\n',
    });
    const empty = ofType(smells, 'Empty Catch Block');
    expect(empty.map(s => path.basename(s.file))).toEqual(['b.py']);
  });

  it('keeps the sibling module in `from . import b` for the dependency graph', async () => {
    const smells = await smellsOf({
      'pkg/__init__.py': '',
      'pkg/a.py': 'from . import b\n\ndef fa():\n    return b\n',
      'pkg/b.py': 'from . import a\n\ndef fb():\n    return a\n',
    });
    const cycles = ofType(smells, 'Circular Dependency');
    expect(cycles).toHaveLength(1);
    expect(cycleNames(cycles[0])).toEqual(['a.py', 'b.py', 'a.py']);
  });
});

describe('TypeScript structure', () => {
  it('counts a class with many overload signatures as one method', async () => {
    const sigs = Array.from({ length: 16 }, (_, i) => `  run(a: ${i === 0 ? 'string' : `'k${i}'`}): void;`).join('\n');
    const smells = await smellsOf({ 'a.ts': `export class A {\n${sigs}\n  run(a: string): void { console.log(a); }\n}\n` });
    expect(ofType(smells, 'God Object')).toEqual([]);
  });

  it('counts a body-less method once', async () => {
    const methods = Array.from({ length: 16 }, (_, i) => `  abstract m${i}(): void;\n  abstract m${i}(a: number): void;`).join('\n');
    const smells = await smellsOf({ 'a.ts': `export abstract class A {\n${methods}\n}\n` });
    expect(ofType(smells, 'God Object')).toHaveLength(1);
    expect(ofType(smells, 'God Object')[0].details.methodCount).toBe(16);
  });

  it('flags classes and runtime enums after return, not const or declared ones', async () => {
    const smells = await smellsOf({
      'a.ts': 'export function a() {\n  return 1;\n  class C extends side() {}\n}\n',
      'b.ts': 'export function b() {\n  return 1;\n  enum E { X = 1 }\n}\n',
      'c.ts': 'export function c() {\n  return 1;\n  const enum E { X = 1 }\n  interface I {}\n}\n',
    });
    expect(ofType(smells, 'Unreachable Code').map(s => path.basename(s.file)).sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('ignores `import type X = require` in the runtime graph', async () => {
    const smells = await smellsOf({
      'a.ts': "import type B = require('./b');\nexport type A = B;\n",
      'b.ts': "import { v } from './a';\nexport const w = v;\n",
    });
    expect(ofType(smells, 'Circular Dependency')).toEqual([]);
  });
});

describe('cycle detection', () => {
  it('reports one cycle when another file only imports into it', async () => {
    const smells = await smellsOf({
      'a.js': "const b = require('./b');\nmodule.exports = () => b;\n",
      'b.js': "const a = require('./a');\nmodule.exports = () => a;\n",
      'c.js': "const a = require('./a');\nmodule.exports = () => a;\n",
    });
    const cycles = ofType(smells, 'Circular Dependency');
    expect(cycles).toHaveLength(1);
    expect(cycleNames(cycles[0])).toEqual(['a.js', 'b.js', 'a.js']);
  });

  it('finds cycles when the scan root is relative', async () => {
    const dir = makeDir({
      'a.js': "const b = require('./b');\nmodule.exports = () => b;\n",
      'b.js': "const a = require('./a');\nmodule.exports = () => a;\n",
    });
    const smells = await codeSmellDetector.detect(path.relative(process.cwd(), dir));
    expect(ofType(smells, 'Circular Dependency')).toHaveLength(1);
  });
});

describe('other languages', () => {
  it('does not treat a Go function-type parameter as a function body', async () => {
    const returns = Array.from({ length: 6 }, (_, i) => `\tif n == ${i} {\n\t\treturn ${i}\n\t}`).join('\n');
    const smells = await smellsOf({ 'a.go': `package main\n\nfunc f(n int, cb func() error) int {\n${returns}\n\treturn 7\n}\n` });
    expect(ofType(smells, 'Too Many Returns')).toHaveLength(1);
  });

  it('looks past a C# exception filter to find an empty catch body', async () => {
    const smells = await smellsOf({ 'C.cs': 'class C {\n  void M() {\n    try { Run(); }\n    catch (System.Exception e) when (e.Message != null) { }\n  }\n  void Run() {}\n}\n' });
    expect(ofType(smells, 'Empty Catch Block')).toHaveLength(1);
  });

  it('keeps multiline PHP strings out of the code view', async () => {
    const smells = await smellsOf({ 'a.php': '<?php\nfunction f($x) {\n  $s = "first\nif ($x) {}\nlast";\n  return $s;\n}\n' });
    expect(ofType(smells, 'Empty Catch Block')).toEqual([]);
    const { lexSource } = await import('../../src/utils/source-lexer');
    expect(lexSource('$s = "a\nif (x) {}\nb";', 'php').code).not.toContain('if');
  });
});

describe('review round 3 regressions', () => {
  it('analyzes Python files with absolute imports instead of blanking them', async () => {
    const { analyzeSource } = await import('../../src/core/source-analysis');
    const analysis = analyzeSource('import os\nfrom pathlib import Path\n\ndef f(a, b):\n    return a\n', 'a.py');
    expect(analysis?.imports).toEqual(['os', 'pathlib']);
    expect(analysis?.functions.map(fn => fn.name)).toEqual(['f']);
  });

  it('keeps a Python function open across an implicit bracket continuation', async () => {
    const { analyzeSource } = await import('../../src/core/source-analysis');
    const analysis = analyzeSource('def f():\n    text = (\n"a"\n)\n    return text\n', 'a.py');
    expect(analysis?.functions).toEqual([expect.objectContaining({ name: 'f', returnCount: 1 })]);
  });

  it('does not treat calls inside conditions as C-family function declarations', async () => {
    const { analyzeSource } = await import('../../src/core/source-analysis');
    const body = Array.from({ length: 6 }, (_, i) => `  if (check(x${i})) { return ${i}; }\n  if (a && probe(x${i})) { return 9; }`).join('\n');
    const analysis = analyzeSource(`int f(int x) {\n${body}\n  return 0;\n}\n`, 'a.c');
    expect(analysis?.functions.map(fn => fn.name)).toEqual(['f']);
    expect(analysis?.functions[0].returnCount).toBe(13);
  });
});

describe('review round 4 regressions', () => {
  it('resolves a Python absolute import from the import root first', async () => {
    const dir = makeDir({
      'b.py': 'VALUE = 1\n',
      'pkg/__init__.py': '',
      'pkg/a.py': 'import b\n',
      'pkg/b.py': 'import pkg.a\n',
    });
    const smells = await codeSmellDetector.detect(dir);
    expect(ofType(smells, 'Circular Dependency')).toEqual([]);
  });

  it('does not mistake a Ruby setter for an endless method definition', async () => {
    const { analyzeSource } = await import('../../src/core/source-analysis');
    const methods = Array.from({ length: 4 }, (_, i) => `  def m${i}\n    ${i}\n  end`).join('\n');
    const analysis = analyzeSource(`class A\n  def value=(v)\n    @v = v\n  end\n${methods}\nend\n`, 'a.rb');
    expect(analysis?.functions.map(fn => fn.name)).toEqual(['value=', 'm0', 'm1', 'm2', 'm3']);
    const endless = analyzeSource('class B\n  def two = 2\n  def three() = 3\nend\n', 'b.rb');
    expect(endless?.functions.map(fn => fn.name)).toEqual(['two', 'three']);
  });
});
