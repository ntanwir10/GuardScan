/**
 * Accuracy tests for code smell detection and complexity metrics:
 * false positives (smell-like text in comments and strings), false negatives
 * (real smells per language) and availability on hostile input.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, afterEach } from '@jest/globals';
import { codeSmellDetector, CodeSmell } from '../../src/core/code-smells';
import { codeMetricsAnalyzer, CodeMetrics } from '../../src/core/code-metrics';
import { lexSource } from '../../src/utils/source-lexer';

const dirs: string[] = [];

// Windows runners without symlink privilege cannot create the links these tests need.
function canSymlink(): boolean {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-symlink-probe-'));
  try {
    fs.symlinkSync(probe, path.join(probe, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
}
const itSymlink = canSymlink() ? it : it.skip;

function makeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-smells-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

async function smellsOf(files: Record<string, string>): Promise<CodeSmell[]> {
  return codeSmellDetector.detect(makeDir(files));
}

async function metricsOf(name: string, body: string): Promise<CodeMetrics> {
  const result = await codeMetricsAnalyzer.analyze(makeDir({ [name]: body }));
  return result[0];
}

const types = (smells: CodeSmell[]) => smells.map(s => s.type);
const ofType = (smells: CodeSmell[], type: string) => smells.filter(s => s.type === type);

afterEach(() => {
  while (dirs.length > 0) {
    fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe('source lexer', () => {
  it('preserves length and newlines while blanking comments and string interiors', () => {
    const src = 'a = "x // y"  # c "q"\nb = \'z\'\n';
    const lexed = lexSource(src, 'python');
    expect(lexed.code).toHaveLength(src.length);
    expect(lexed.comments).toHaveLength(src.length);
    expect(lexed.noComments).toHaveLength(src.length);
    expect(lexed.code.split('\n')).toHaveLength(3);
    expect(lexed.code.startsWith('a = "      "')).toBe(true);
    expect(lexed.code).not.toContain('c "q"');
    expect(lexed.comments).toContain('# c "q"');
    expect(lexed.noComments).toContain('"x // y"');
  });

  it('ends an unterminated single-line string at the line end', () => {
    const lexed = lexSource("x = 'oops\ny = 1\n", 'ruby');
    expect(lexed.code.split('\n')[1]).toBe('y = 1');
  });

  it('handles multi-line constructs: Python triple quotes, Go raw strings, Ruby =begin, C block comments', () => {
    expect(lexSource('"""a\nreturn\n"""\nx = 1\n', 'python').code).not.toContain('return');
    expect(lexSource('s := `a\ncatch (e) {}\n`\n', 'go').code).not.toContain('catch');
    expect(lexSource('=begin\nreturn\n=end\nx = 1\n', 'ruby').code).not.toContain('return');
    expect(lexSource('int a; /* if (x) {\n} */ int b;', 'c').code).not.toContain('if');
  });

  it('keeps interpolated expressions visible so identifiers inside them count as uses', () => {
    expect(lexSource('print(f"{total} items")', 'python').code).toContain('total');
    expect(lexSource('puts "#{total} items"', 'ruby').code).toContain('total');
    expect(lexSource('echo "sum $total";', 'php').code).toContain('$total');
  });
});

describe('JavaScript / TypeScript smells (AST based)', () => {
  it('ignores smell-like text inside comments and strings', async () => {
    const smells = await smellsOf({
      'decoy.js': [
        'function ok() {',
        '  const a = "function foo(a, b, c, d, e, f, g) { return 1; } catch (e) {}";',
        '  const b = `',
        '    catch (e) {}',
        '    return 1; return 2;',
        '  `;',
        '  return a + b;',
        '}',
        'module.exports = ok;',
        '',
      ].join('\n'),
    });
    expect(types(smells)).toEqual([]);
  });

  it('reports commented-out code but not prose comments or doc tags', async () => {
    const smells = await smellsOf({
      'c.js': [
        '// if (x) { return 1; }',
        '// This function returns the total (see docs) when ready',
        '/**',
        ' * @param {string} name',
        ' */',
        '// const old = require("./old");',
        'module.exports = 1;',
        '',
      ].join('\n'),
    });
    expect(ofType(smells, 'Commented-Out Code').map(s => s.line)).toEqual([1, 6]);
  });

  it('flags a genuinely unused local and not used, exported or underscore names', async () => {
    const smells = await smellsOf({
      'u.ts': [
        'export const exported = 1234;',
        'const topUnused = 5;',
        'const used = 2;',
        'function f(): number {',
        '  const local = used + 1;',
        '  const dead = local;',
        '  const _ignored = 7;',
        '  const obj = { dead2: 1 };',
        '  return obj.dead2;',
        '}',
        'f();',
        '',
      ].join('\n'),
    });
    const unused = ofType(smells, 'Unused Variable').map(s => s.description);
    expect(unused).toEqual(expect.arrayContaining(['Variable "topUnused" is declared but never used', 'Variable "dead" is declared but never used']));
    expect(unused.join()).not.toMatch(/"(exported|used|local|_ignored|obj)"/);
  });

  it('flags a real empty catch but not a catch holding a comment or a catch inside a string', async () => {
    const smells = await smellsOf({
      'e.js': [
        'try { a(); } catch (e) {}',
        'try { a(); } catch (e) { /* deliberately ignored */ }',
        'try { a(); } catch (e) { console.error(e); }',
        'const s = "catch (e) {}";',
        'module.exports = s;',
        '',
      ].join('\n'),
    });
    expect(ofType(smells, 'Empty Catch Block').map(s => s.line)).toEqual([1]);
  });

  it('does not treat multi-line return arguments or switch cases as unreachable, but flags real dead code', async () => {
    const smells = await smellsOf({
      'r.js': [
        'function f(x) {',
        '  switch (x) {',
        '    case 1:',
        '      return foo(',
        '        1,',
        '        2',
        '      );',
        '    case 2:',
        '      return 2;',
        '    default:',
        '      throw new Error("no");',
        '  }',
        '}',
        'function g() {',
        '  return 1;',
        '  cleanup();',
        '}',
        'module.exports = { f, g };',
        '',
      ].join('\n'),
    });
    expect(ofType(smells, 'Unreachable Code').map(s => s.line)).toEqual([16]);
  });

  it('counts parameters and returns per function from the AST', async () => {
    const smells = await smellsOf({
      'p.js': [
        'const many = (a, b = [1, 2, 3], c, d, e, f, g) => a;',
        'function six(x) {',
        '  if (x === 1) { return "a"; }',
        '  if (x === 2) { return "b"; }',
        '  if (x === 3) { return "c"; }',
        '  if (x === 4) { return "d"; }',
        '  if (x === 5) { return "e"; }',
        '  return "f";',
        '}',
        'function five(x) {',
        '  if (x) { return 1; }',
        '  if (x > 2) { return 2; }',
        '  if (x > 3) { return 3; }',
        '  if (x > 4) { return 4; }',
        '  return () => { return 5; };',
        '}',
        'module.exports = { many, six, five };',
        '',
      ].join('\n'),
    });
    expect(ofType(smells, 'Long Parameter List')).toHaveLength(1);
    expect(ofType(smells, 'Long Parameter List')[0].details).toEqual({ parameterCount: 7 });
    const returns = ofType(smells, 'Too Many Returns');
    expect(returns).toHaveLength(1);
    expect(returns[0]).toMatchObject({ severity: 'medium', line: 2, details: { returnCount: 6 } });
  });

  it('counts class methods and distinct constructor fields for God Object', async () => {
    let fields = '';
    for (let i = 0; i < 11; i++) {
      fields += `    this.f${i} = ${i};\n`;
    }
    const smells = await smellsOf({
      'g.js': `class Wide {\n  constructor() {\n${fields}  }\n  run() { return this.f0; }\n}\nmodule.exports = Wide;\n`,
    });
    const god = ofType(smells, 'God Object');
    expect(god).toHaveLength(1);
    expect(god[0].details).toEqual({ methodCount: 2, fieldCount: 11 });
  });

  it('finds circular imports across files with and without extensions, and ignores commented-out imports', async () => {
    const smells = await smellsOf({
      'a.js': "const b = require('./b');\nmodule.exports = () => b;\n",
      'b.js': "const a = require('./a.js');\nmodule.exports = () => a;\n",
      'c.js': "// const d = require('./d');\nmodule.exports = 1;\n",
      'd.js': "const c = require('./c');\nmodule.exports = () => c;\n",
    });
    const cycles = ofType(smells, 'Circular Dependency');
    expect(cycles).toHaveLength(1);
    expect(cycles[0].details.cycle.map((f: string) => path.basename(f))).toEqual(['a.js', 'b.js', 'a.js']);
  });

  it('survives syntax errors and pathological nesting without throwing', async () => {
    const smells = await smellsOf({
      'broken.js': 'function ( { if ((( }}}\n',
      'deep.js': `var x = ${'['.repeat(30000)}${']'.repeat(30000)};\n`,
    });
    expect(Array.isArray(smells)).toBe(true);
  });
});

describe('uses hidden by string syntax and type-only imports', () => {
  it('counts identifiers inside triple-quoted f-strings and Ruby #{} outside plain strings as uses', async () => {
    const q3 = '"'.repeat(3);
    const smells = await smellsOf({
      'a.py': `def f():\n    shown = 1\n    return f${q3}{shown}${q3}\n`,
      'a.rb': 'def f\n  name = "x"\n  re = /#{name}/\n  re\nend\n',
      'C.cs': `class C {\n    string M() {\n        var shown = 1;\n        return $${q3}{shown}${q3};\n    }\n}\n`,
    });
    expect(ofType(smells, 'Unused Variable')).toEqual([]);
  });

  it('does not report cycles that exist only through type-only imports', async () => {
    const smells = await smellsOf({
      'a.ts': "import type { B } from './b';\nexport interface A { b: B }\n",
      'b.ts': "import { type A } from './a';\nexport interface B { a: A }\n",
      'c.ts': "import { d } from './d';\nexport const c = d;\n",
      'd.ts': "import { c } from './c';\nexport const d = () => c;\n",
    });
    const cycles = ofType(smells, 'Circular Dependency');
    expect(cycles).toHaveLength(1);
    expect(cycles[0].details.cycle.map((f: string) => path.basename(f))).toEqual(['c.ts', 'd.ts', 'c.ts']);
  });
});

describe('other-language smells (lexed)', () => {
  it('Python: ignores strings/comments, finds unused locals, pass-only except, dead code; f-strings count as use', async () => {
    const smells = await smellsOf({
      'a.py': [
        '# def fake(a, b, c, d, e, f, g): return 1',
        'def many(a, b, c, d, e, f, g):',
        '    s = "def inner(): return 1  # while True:"',
        '    unused_local = 5',
        '    used = a + b',
        '    shown = 3',
        '    print(f"value {shown}")',
        '    try:',
        '        risky()',
        '    except Exception:',
        '        pass',
        '    if a:',
        '        return foo(',
        '            1,',
        '            2,',
        '        )',
        '    return used',
        '    print("dead")',
        '',
      ].join('\n'),
    });
    expect(ofType(smells, 'Unused Variable').map(s => s.description).sort()).toEqual([
      'Variable "s" is declared but never used',
      'Variable "unused_local" is declared but never used',
    ]);
    expect(ofType(smells, 'Empty Catch Block').map(s => s.line)).toEqual([10]);
    expect(ofType(smells, 'Unreachable Code').map(s => s.line)).toEqual([18]);
    expect(ofType(smells, 'Long Parameter List')).toHaveLength(1);
    expect(ofType(smells, 'Commented-Out Code').map(s => s.line)).toEqual([1]);
  });

  it('Go: keyword text in strings/comments is ignored, grouped params counted, case labels are not dead code', async () => {
    const smells = await smellsOf({
      'a.go': [
        'package main',
        '',
        '// if err != nil { return }',
        'func many(a, b, c, d, e, f, g int) int {',
        '\ts := "func fake() { return 1 }"',
        '\tunused := 77',
        '\tswitch a {',
        '\tcase 1:',
        '\t\treturn 1',
        '\tcase 2:',
        '\t\treturn 2',
        '\t}',
        '\t_ = s',
        '\treturn 3',
        '\tprintln("dead")',
        '}',
        '',
      ].join('\n'),
    });
    expect(ofType(smells, 'Long Parameter List')[0]).toMatchObject({ line: 4, details: { parameterCount: 7 } });
    expect(ofType(smells, 'Unused Variable').map(s => s.description)).toEqual(['Variable "unused" is declared but never used']);
    expect(ofType(smells, 'Unreachable Code').map(s => s.line)).toEqual([15]);
  });

  it('Java: ignores fake methods in strings, counts generic parameters, finds empty catch and unused locals', async () => {
    const smells = await smellsOf({
      'App.java': [
        'public class App {',
        '    // if (x) { return; }',
        '    private String s = "public void fake(int a, int b, int c, int d, int e, int f) { return; }";',
        '    public int many(Map<String, Integer> m, int b, int c, int d, int e, int f) {',
        '        int unused = 4242;',
        '        try { run(); } catch (Exception e2) { }',
        '        try { run(); } catch (Exception e3) { /* ok */ }',
        '        return b;',
        '    }',
        '}',
        '',
      ].join('\n'),
    });
    expect(ofType(smells, 'Long Parameter List')).toHaveLength(1);
    expect(ofType(smells, 'Long Parameter List')[0].line).toBe(4);
    expect(ofType(smells, 'Empty Catch Block').map(s => s.line)).toEqual([6]);
    expect(ofType(smells, 'Unused Variable').map(s => s.description)).toEqual(['Variable "unused" is declared but never used']);
    expect(ofType(smells, 'Commented-Out Code').map(s => s.line)).toEqual([2]);
  });

  it('Ruby: modifier return is not dead-code trigger, rescue-only body is empty, interpolation counts as use', async () => {
    const smells = await smellsOf({
      'a.rb': [
        '# def fake; return 1; end',
        'def many(a, b, c, d, e, f, g)',
        '  s = "def inner; return 1; end"',
        '  name = "x"',
        '  puts "hi #{name}"',
        '  return 0 if a',
        '  b = 1',
        '  begin',
        '    risky',
        '  rescue',
        '  end',
        '  return s',
        '  puts "dead"',
        'end',
        '',
      ].join('\n'),
    });
    expect(ofType(smells, 'Unreachable Code').map(s => s.line)).toEqual([13]);
    expect(ofType(smells, 'Empty Catch Block').map(s => s.line)).toEqual([10]);
    expect(ofType(smells, 'Unused Variable').map(s => s.description)).toEqual(['Variable "b" is declared but never used']);
    expect(ofType(smells, 'Long Parameter List')).toHaveLength(1);
  });

  it('PHP: finds unused $variables and empty catch, ignores strings and # comments', async () => {
    const smells = await smellsOf({
      'a.php': [
        '<?php',
        '# function fake($a, $b, $c, $d, $e, $f, $g) { return 1; }',
        'function many($a, $b, $c, $d, $e, $f, $g) {',
        '    $s = "function inner() { return 1; }";',
        '    $unused = 4242;',
        '    $shown = 1;',
        '    echo "v $shown";',
        '    try { risky(); } catch (Exception $e) { }',
        '    return $s;',
        '}',
        '',
      ].join('\n'),
    });
    expect(ofType(smells, 'Unused Variable').map(s => s.description)).toEqual(['Variable "$unused" is declared but never used']);
    expect(ofType(smells, 'Empty Catch Block').map(s => s.line)).toEqual([8]);
    expect(ofType(smells, 'Long Parameter List')).toHaveLength(1);
  });

  it('C, C++ and C#: smells now apply (long params, unused locals, empty catch) and decoys are ignored', async () => {
    const smells = await smellsOf({
      'a.c': '// if (x) { return 1; }\nint many(int a, int b, int c, int d, int e, int f) {\n    const char *s = "while (1) { return 2; }";\n    int unused = 5;\n    return a;\n}\n',
      'b.cpp': 'int g(int a) {\n    std::string s = "catch (e) {}";\n    try { f(); } catch (...) { }\n    return a;\n}\n',
      'C.cs': 'class C {\n    int M(int a, int b, int c, int d, int e, int f, int g) {\n        string s = "if (a) { while (true) {} }";\n        return a;\n    }\n}\n',
    });
    const by = (file: string) => smells.filter(s => s.file.endsWith(file));
    expect(types(by('a.c'))).toEqual(expect.arrayContaining(['Commented-Out Code', 'Long Parameter List', 'Unused Variable']));
    expect(ofType(by('a.c'), 'Empty Catch Block')).toHaveLength(0);
    expect(ofType(by('b.cpp'), 'Empty Catch Block').map(s => s.line)).toEqual([3]);
    expect(ofType(by('C.cs'), 'Long Parameter List')).toHaveLength(1);
    expect(ofType(by('C.cs'), 'Commented-Out Code')).toHaveLength(0);
  });
});

describe('metrics accuracy', () => {
  it('counts Python decision points (elif, and/or, except) and ignores keywords in strings and comments', async () => {
    const m = await metricsOf('a.py', [
      '# if while for',
      'def f(a, b):',
      '    s = "if while for and or"',
      '    if a and b:',
      '        return 1',
      '    elif a or b:',
      '        return 2',
      '    try:',
      '        pass',
      '    except ValueError:',
      '        pass',
      '    return 3',
      '',
    ].join('\n'));
    // 1 + if + and + elif + or + except
    expect(m.metrics.cyclomaticComplexity).toBe(6);
    expect(m.metrics.functionCount).toBe(1);
    expect(m.metrics.maxFunctionLength).toBe(10);
    expect(m.language).toBe('python');
  });

  it('counts else-if once in JS and gives nesting-aware cognitive complexity', async () => {
    const m = await metricsOf('a.js', [
      'function f(a, b) {',
      '  if (a) {',          // +1
      '    if (b) { x(); }', // +2 (nested)
      '  } else if (b) {',   // +1
      '    x();',
      '  } else {',          // +1
      '    y();',
      '  }',
      '  return a && b;',    // +1
      '}',
      '',
    ].join('\n'));
    expect(m.metrics.cyclomaticComplexity).toBe(1 + 3 + 1); // if, nested if, else-if, &&
    expect(m.metrics.cognitiveComplexity).toBe(6);
  });

  it('does not count operators, ternaries or keywords inside strings, comments or regex literals', async () => {
    const m = await metricsOf('a.js', [
      '// if (a && b || c) { }',
      '/* while (x) {} */',
      'const re = /a||b&&c?d:e/;',
      'const s = "if (a) && ? :";',
      'const t = `${1 + 1} && ||`;',
      'module.exports = { re, s, t };',
      '',
    ].join('\n'));
    expect(m.metrics.cyclomaticComplexity).toBe(1);
    expect(m.metrics.cognitiveComplexity).toBe(0);
  });

  it('finds functions with correct lengths in C, C++, C# and Go (previously zero or wrong)', async () => {
    const c = await metricsOf('a.c', 'int add(int a, int b) {\n    return a + b;\n}\nint sub(int a, int b) {\n    return a - b;\n}\n');
    expect(c.metrics.functionCount).toBe(2);
    expect(c.metrics.maxFunctionLength).toBe(2);
    const go = await metricsOf('a.go', 'package main\n\nfunc a() int {\n\treturn 1\n}\n\nfunc (s *S) b(x int) int {\n\treturn x\n}\n');
    expect(go.metrics.functionCount).toBe(2);
    const cs = await metricsOf('a.cs', 'class C {\n    public int M(int a) {\n        return a;\n    }\n}\n');
    expect(cs.metrics.functionCount).toBe(1);
  });

  it('computes lines of code without multi-line comments or blank lines', async () => {
    const m = await metricsOf('a.js', '/*\n * a\n * b\n */\n\nconst x = 1; // trailing\n// only comment\nmodule.exports = x;\n');
    expect(m.metrics.linesOfCode).toBe(2);
  });

  it('measures long functions from real function bodies and reports the existing issue types', async () => {
    let body = 'function long(x) {\n';
    for (let i = 0; i < 120; i++) {
      body += `  x = x + ${i % 7};\n`;
    }
    body += '  return x;\n}\nmodule.exports = long;\n';
    const m = await metricsOf('long.js', body);
    expect(m.metrics.functionCount).toBe(1);
    expect(m.metrics.maxFunctionLength).toBe(122);
    expect(m.issues.find(i => i.type === 'Long Function')).toMatchObject({ severity: 'medium', value: 122, threshold: 100 });
  });
});

describe('availability on hostile input', () => {
  const GO_TAIL = '\nfunc main() { fmt.Println(1) }\n';

  it('finishes quickly on one 2.2 MB single-line Go comment (coordinator repro)', async () => {
    const dir = makeDir({ 'main.go': `package main\n\nimport "fmt"\n\n// ${'x'.repeat(2_200_000)}${GO_TAIL}` });
    const started = Date.now();
    await codeSmellDetector.detect(dir);
    await codeMetricsAnalyzer.analyze(dir);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it.each([
    ['Go word run in code position', 'go', `package main\nvar x = ${'y'.repeat(2_000_000)}\n`],
    ['Go string literal', 'go', `package main\nvar s = "${'(a,'.repeat(600_000)}"\n`],
    ['Python call-shaped run', 'py', `x = ${'f('.repeat(1_000_000)}\n`],
    ['Java call and catch run', 'java', `class A { ${'catch ( x ('.repeat(200_000)} }\n`],
    ['Ruby ternary-shaped run', 'rb', `x = ${'a ? '.repeat(500_000)}\n`],
    ['JS import-shaped run', 'js', `${'import '.repeat(300_000)}\n`],
    ['JS word run', 'js', `var ${'z'.repeat(2_000_000)} = 1;\n`],
    ['PHP unterminated quotes', 'php', `<?php ${'"x '.repeat(500_000)}\n`],
    ['Java pointer-star run at line start', 'java', `${'*'.repeat(1_000_000)}\n`],
    ['C ampersand run at line start', 'c', `${'&'.repeat(1_000_000)} x = 1;\n`],
    ['Python deeply nested defs', 'py', Array.from({ length: 1400 }, (_, i) => `${' '.repeat(i)}def f():\n${' '.repeat(i + 1)}v = 1\n`).join('')],
    ['Ruby unterminated defs', 'rb', 'def a\n'.repeat(150_000)],
    ['Ruby unterminated classes', 'rb', 'class A\n'.repeat(120_000)],
    ['Java many classes with methods', 'java', 'class A{void f(){}}\n'.repeat(50_000)],
    ['Go unclosed nested bodies', 'go', 'func f(){\nv := 1\n'.repeat(60_000)],
    ['JS many same-name declarations', 'js', 'var x = 1;\n'.repeat(100_000)],
    ['JS many functions with same-name locals', 'js', 'function f(){var x=1;}\n'.repeat(40_000)],
    ['JS thousands of identical lines', 'js', 'const aaaaaaaaaaaaaaaa = bbbbbbbbbbbbbbbbbbbbbb + cccccccccccccccc;\n'.repeat(30_000)],
    ['Go unterminated generic brackets', 'go', 'func f['.repeat(200_000)],
    ['C operator run', 'c', `int a = ${'a && '.repeat(500_000)} 1;\n`],
  ])('stays linear: %s', async (_name, ext, source) => {
    const dir = makeDir({ [`hostile.${ext}`]: source });
    const started = Date.now();
    await codeSmellDetector.detect(dir);
    await codeMetricsAnalyzer.analyze(dir);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('does not overflow the stack when a file produces hundreds of thousands of findings', async () => {
    const smells = await smellsOf({ 'flood.js': 'module.exports = [\n' + '  12345,\n'.repeat(250_000) + '];\n' });
    expect(ofType(smells, 'Magic Number').length).toBe(250_000);
  });

  it('still reports real smells in a file that also contains a very long line', async () => {
    const smells = await smellsOf({
      'big.go': `package main\n\n// ${'x'.repeat(2_200_000)}\nfunc main() {\n\tunused := 77\n\treturn\n\tprintln("dead")\n}\n`,
    });
    expect(ofType(smells, 'Unused Variable').map(s => s.line)).toEqual([5]);
    expect(ofType(smells, 'Unreachable Code').map(s => s.line)).toEqual([7]);
  });

  itSymlink('skips symlinks and files over the size cap', async () => {
    const outside = makeDir({ 'secret.js': 'try { a(); } catch (e) {}\n' });
    const dir = makeDir({ 'ok.js': 'module.exports = 1;\n' });
    fs.symlinkSync(path.join(outside, 'secret.js'), path.join(dir, 'link.js'));
    fs.symlinkSync(outside, path.join(dir, 'linkdir'));
    fs.writeFileSync(path.join(dir, 'huge.js'), `// ${'x'.repeat(6 * 1024 * 1024)}\ntry { a(); } catch (e) {}\n`);
    const smells = await codeSmellDetector.detect(dir);
    const metrics = await codeMetricsAnalyzer.analyze(dir);
    expect(smells).toEqual([]);
    expect(metrics.map(m => path.basename(m.file))).toEqual(['ok.js']);
  });

  itSymlink('one unreadable entry does not hide its siblings', async () => {
    const dir = makeDir({ 'a.js': 'try { a(); } catch (e) {}\n' });
    fs.symlinkSync(path.join(dir, 'does-not-exist'), path.join(dir, 'broken'));
    const smells = await codeSmellDetector.detect(dir);
    expect(ofType(smells, 'Empty Catch Block')).toHaveLength(1);
  });
});

describe('review round 1 regressions', () => {
  it('ignores Python imports that only appear inside strings', async () => {
    const smells = await smellsOf({
      'a.py': '"""\nfrom b import f\n"""\n\ndef f():\n    return 1\n',
      'b.py': 'from a import f\n\ndef g():\n    return f()\n',
    });
    expect(ofType(smells, 'Circular Dependency')).toHaveLength(0);
  });

  it('counts compact and spaced ternaries alike and ignores null-safe operators', async () => {
    const spaced = await metricsOf('a.c', 'int f(int a, int b, int c) {\n  return a ? b : c;\n}\n');
    const compact = await metricsOf('b.c', 'int f(int a, int b, int c) {\n  return a?b:c;\n}\n');
    expect(spaced.metrics.cyclomaticComplexity).toBe(2);
    expect(compact.metrics.cyclomaticComplexity).toBe(2);
    const nested = await metricsOf('c.java', 'class A { int f(int a, int b) { return a?b?1:2:3; } }\n');
    expect(nested.metrics.cyclomaticComplexity).toBe(3);
    const cs = await metricsOf('d.cs', 'class A {\n  void F(string a, string b) {\n    int? x = null;\n    var y = a?.Length;\n    var z = a ?? b;\n    z ??= b;\n    var w = a?[0];\n  }\n}\n');
    expect(cs.metrics.cyclomaticComplexity).toBe(1);
    const csMixed = await metricsOf('e.cs', 'class A {\n  void F(bool c) {\n    int? x = c ? 1 : 2;\n  }\n}\n');
    expect(csMixed.metrics.cyclomaticComplexity).toBe(2);
    const php = await metricsOf('f.php', '<?php\nfunction f(?int $a, $b) {\n  return $a?->x ?: $b;\n}\n');
    expect(php.metrics.cyclomaticComplexity).toBe(2);
    const java = await metricsOf('g.java', 'import java.util.*;\nclass A { Map<String, ?> m; List<? extends A> l; }\n');
    expect(java.metrics.cyclomaticComplexity).toBe(1);
  });

  it('does not charge returns inside PHP closures or Go function literals to the enclosing function', async () => {
    const callbacks = Array.from({ length: 6 }, () => '  $f[] = function() { return 1; };').join('\n');
    const goCallbacks = Array.from({ length: 6 }, () => '\tf = func() int { return 1 }').join('\n');
    const smells = await smellsOf({
      'a.php': `<?php\nfunction outer() {\n${callbacks}\n  return 1;\n}\n`,
      'a.go': `package main\n\nvar f func() int\n\nfunc outer() int {\n${goCallbacks}\n\treturn 1\n}\n`,
    });
    expect(ofType(smells, 'Too Many Returns')).toHaveLength(0);
    const php = await metricsOf('b.php', `<?php\nfunction outer() {\n${callbacks}\n  return 1;\n}\n`);
    expect(php.metrics.functionCount).toBe(1);
  });

  it('still counts real returns of a named function that contains closures', async () => {
    const body = Array.from({ length: 6 }, (_, i) => `  if ($a === ${i}) { return ${i}; }`).join('\n');
    const smells = await smellsOf({ 'a.php': `<?php\nfunction outer($a) {\n  $f = function() { return 1; };\n${body}\n  return 9;\n}\n` });
    expect(ofType(smells, 'Too Many Returns')[0]?.details).toMatchObject({ returnCount: 7 });
  });

  it('honours the comment exemption for inline Python handlers', async () => {
    const smells = await smellsOf({
      'a.py': [
        'try:', '    x()', 'except ValueError: pass  # deliberately ignored',
        'try:', '    x()', 'except ValueError:', '    pass  # deliberately ignored',
        'try:', '    x()', 'except ValueError: pass', '',
      ].join('\n'),
    });
    expect(ofType(smells, 'Empty Catch Block').map(s => s.line)).toEqual([10]);
  });

  it('takes JS regex literals from the parser, including after a control-condition paren', async () => {
    const src = 'if (x) /[/*]/.test(x);\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconsole.log(a, b, c, d);\n';
    const m = await metricsOf('a.js', src);
    expect(m.metrics.linesOfCode).toBe(6);
    const smells = await smellsOf({ 'a.js': src });
    expect(ofType(smells, 'Commented-Out Code')).toHaveLength(0);
  });
});
