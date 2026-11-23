/**
 * Characterization tests for the CodeSmell and CodeMetrics output contract.
 *
 * Callers (scan, run, test) consume these shapes, and their own tests mock both
 * detectors, so this file is what pins field names, severities and type strings.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import { codeSmellDetector, CodeSmell } from '../../src/core/code-smells';
import { codeMetricsAnalyzer, CodeMetrics } from '../../src/core/code-metrics';

const SMELL_SEVERITY: Record<string, string[]> = {
  'Duplicate Code': ['medium', 'high'],
  'Unreachable Code': ['medium'],
  'Unused Variable': ['low'],
  'God Object': ['high'],
  'Long Parameter List': ['medium', 'high'],
  'Magic Number': ['low'],
  'Commented-Out Code': ['low'],
  'Empty Catch Block': ['high'],
  'Too Many Returns': ['medium'],
  'Circular Dependency': ['high'],
};

const ISSUE_SEVERITY: Record<string, string[]> = {
  'High Cyclomatic Complexity': ['critical'],
  'Moderate Cyclomatic Complexity': ['medium'],
  'High Cognitive Complexity': ['high'],
  'Poor Maintainability': ['critical'],
  'Low Maintainability': ['medium'],
  'Very Long Function': ['high'],
  'Long Function': ['medium'],
};

const DUP_BLOCK = `function process(items) {
  const out = [];
  for (const item of items) {
    if (item.active) {
      out.push(item.value * 2);
    } else {
      out.push(item.fallback);
    }
  }
  const total = out.reduce((a, b) => a + b, 0);
  return { out, total, count: out.length };
}
`;

function manyIfs(name: string, count: number): string {
  let src = `function ${name}(x) {\n`;
  for (let i = 0; i < count; i++) {
    src += `  if (x === ${i + 200}) { x++; }\n`;
  }
  return `${src}  return x;\n}\nmodule.exports = ${name};\n`;
}

describe('CodeSmell / CodeMetrics output contract', () => {
  let dir: string;
  let smells: CodeSmell[];
  let metrics: CodeMetrics[];

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-contract-'));
    const w = (name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);
    w('smelly.js', [
      '// if (x) { return 1; }',
      'function risky(a, b, c, d, e, f, g, h, i) {',
      '  const magic = compute(4242);',
      '  try { run(); } catch (e) {}',
      '  return a;',
      '  cleanup();',
      '}',
      'module.exports = risky;',
      '',
    ].join('\n'));
    w('medium-params.js', 'function six(a, b, c, d, e, f) { return a; }\nmodule.exports = six;\n');
    let big = 'class Big {\n';
    for (let i = 0; i < 16; i++) {
      big += `  method${i}() { return ${i}; }\n`;
    }
    w('big.js', `${big}}\nmodule.exports = Big;\n`);
    for (const n of [1, 2, 3, 4]) {
      w(`dup${n}.js`, DUP_BLOCK);
    }
    w('cyc_a.js', "const b = require('./cyc_b.js');\nmodule.exports = { a: () => b };\n");
    w('cyc_b.js', "const a = require('./cyc_a.js');\nmodule.exports = { b: () => a };\n");
    w('complex.js', manyIfs('complex', 25));
    w('huge.js', manyIfs('huge', 60));
    smells = await codeSmellDetector.detect(dir);
    metrics = await codeMetricsAnalyzer.analyze(dir);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const byType = (type: string) => smells.filter(s => s.type === type);

  it('every CodeSmell has exactly the documented fields and legal severities', () => {
    expect(smells.length).toBeGreaterThan(0);
    for (const s of smells) {
      expect(typeof s.type).toBe('string');
      expect(typeof s.file).toBe('string');
      expect(Number.isInteger(s.line)).toBe(true);
      expect(s.line).toBeGreaterThanOrEqual(1);
      expect(typeof s.description).toBe('string');
      expect(typeof s.recommendation).toBe('string');
      expect(Object.keys(s).every(k => ['type', 'file', 'line', 'severity', 'description', 'recommendation', 'details'].includes(k))).toBe(true);
      expect(SMELL_SEVERITY[s.type]).toBeDefined();
      expect(SMELL_SEVERITY[s.type]).toContain(s.severity);
    }
  });

  it('emits the stable type strings and severities for the core smells', () => {
    expect(byType('Empty Catch Block')[0]).toMatchObject({ severity: 'high', description: 'Empty catch block swallows errors silently' });
    expect(byType('Commented-Out Code')[0]).toMatchObject({ severity: 'low', description: 'Commented-out code should be removed' });
    expect(byType('Unreachable Code')[0]).toMatchObject({ severity: 'medium', description: 'Code after return/throw statement is unreachable' });
    expect(byType('Magic Number')[0]).toMatchObject({ severity: 'low' });
    expect(byType('Magic Number')[0].description).toMatch(/^Magic number ".+" should be extracted to a named constant$/);
    expect(byType('Unused Variable')[0]).toMatchObject({ severity: 'low' });
    expect(byType('Unused Variable')[0].description).toMatch(/^Variable ".+" is declared but never used$/);
  });

  it('Long Parameter List is medium up to 8 parameters and high above, with details.parameterCount', () => {
    const six = byType('Long Parameter List').find(s => s.file.endsWith('medium-params.js'));
    const nine = byType('Long Parameter List').find(s => s.file.endsWith('smelly.js'));
    expect(six).toMatchObject({ severity: 'medium', description: 'Function has 6 parameters', details: { parameterCount: 6 } });
    expect(nine).toMatchObject({ severity: 'high', description: 'Function has 9 parameters', details: { parameterCount: 9 } });
  });

  it('God Object is high severity with details.methodCount and details.fieldCount', () => {
    const god = byType('God Object').find(s => s.file.endsWith('big.js'));
    expect(god).toBeDefined();
    expect(god?.severity).toBe('high');
    expect(god?.description).toMatch(/^Class "Big" has too many responsibilities \(\d+ methods, \d+ fields\)$/);
    expect(Object.keys(god?.details ?? {}).sort()).toEqual(['fieldCount', 'methodCount']);
  });

  it('Duplicate Code is high at 4+ copies and lists the other locations', () => {
    const dups = byType('Duplicate Code').filter(s => /dup\d\.js$/.test(s.file));
    expect(dups.length).toBeGreaterThan(0);
    for (const d of dups) {
      expect(d.severity).toBe('high');
      expect(d.recommendation).toBe('Extract common logic into a shared function');
      expect(Object.keys(d.details ?? {}).sort()).toEqual(['duplicateCount', 'otherLocations']);
      expect(d.details.duplicateCount).toBeGreaterThanOrEqual(4);
      expect(Array.isArray(d.details.otherLocations)).toBe(true);
    }
  });

  it('Circular Dependency is high with details.cycle', () => {
    const cyc = byType('Circular Dependency');
    expect(cyc.length).toBeGreaterThan(0);
    expect(cyc[0]).toMatchObject({ severity: 'high', line: 1, description: 'Circular dependency detected' });
    expect(Array.isArray(cyc[0].details.cycle)).toBe(true);
  });

  it('every CodeMetrics has the documented fields', () => {
    expect(metrics.length).toBeGreaterThan(0);
    for (const m of metrics) {
      expect(Object.keys(m).sort()).toEqual(['file', 'issues', 'language', 'metrics']);
      expect(Object.keys(m.metrics).sort()).toEqual([
        'averageFunctionLength',
        'cognitiveComplexity',
        'cyclomaticComplexity',
        'functionCount',
        'linesOfCode',
        'maintainabilityIndex',
        'maxFunctionLength',
        'technicalDebt',
      ]);
      expect(typeof m.metrics.technicalDebt).toBe('string');
      expect(m.metrics.technicalDebt).toMatch(/^\d+(\.\d+)? (minutes|hours|days)$/);
      expect(m.metrics.maintainabilityIndex).toBeGreaterThanOrEqual(0);
      expect(m.metrics.maintainabilityIndex).toBeLessThanOrEqual(100);
      expect(m.language).toBe('javascript');
      for (const issue of m.issues) {
        expect(Object.keys(issue).sort()).toEqual(['description', 'line', 'recommendation', 'severity', 'threshold', 'type', 'value']);
        expect(ISSUE_SEVERITY[issue.type]).toBeDefined();
        expect(ISSUE_SEVERITY[issue.type]).toContain(issue.severity);
      }
    }
  });

  it('keeps the complexity thresholds: >20 moderate (medium), >50 high (critical), file-level totals', () => {
    const complex = metrics.find(m => m.file.endsWith('complex.js'));
    const huge = metrics.find(m => m.file.endsWith('huge.js'));
    expect(complex?.metrics.cyclomaticComplexity).toBeGreaterThan(20);
    expect(complex?.issues.find(i => i.type === 'Moderate Cyclomatic Complexity')).toMatchObject({ severity: 'medium', threshold: 20, line: 1 });
    expect(huge?.metrics.cyclomaticComplexity).toBeGreaterThan(50);
    expect(huge?.issues.find(i => i.type === 'High Cyclomatic Complexity')).toMatchObject({ severity: 'critical', threshold: 50, line: 1 });
    expect(huge?.issues.find(i => i.type === 'High Cyclomatic Complexity')?.value).toBe(huge?.metrics.cyclomaticComplexity);
  });
});
