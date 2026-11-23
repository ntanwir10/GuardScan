import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  analyzeDependencyInsights,
  DependencyInsightsReport,
  HYGIENE_RULES,
  scanGoImports,
  scanPythonSource,
} from '../../src/core/dependency-insights';
import { collectPackageInventory } from '../../src/core/package-inventory';
import { evaluateComprehensivePolicy } from '../../src/commands/scan';
import { createScanEnvelope, ScanEngine } from '../../src/core/scan-engine';
import { detectServices } from '../../src/core/service-catalog';

const Ajv = require('ajv');

const roots: string[] = [];

function fixture(files: Record<string, string | object>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-dependency-insights-'));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

async function analyze(root: string): Promise<DependencyInsightsReport> {
  return analyzeDependencyInsights(collectPackageInventory(root));
}

function names(report: DependencyInsightsReport, ruleId: string, file?: string): string[] {
  return report.findings
    .filter(finding => finding.ruleId === ruleId && (file === undefined || finding.file === file))
    .map(finding => String(finding.metadata.package))
    .sort();
}

function uncertainNames(report: DependencyInsightsReport, file: string): string[] {
  const finding = report.findings.find(item => item.ruleId === HYGIENE_RULES.uncertain && item.file === file);
  return ((finding?.metadata.items as Array<{name: string}> | undefined) || []).map(item => item.name).sort();
}

afterEach(() => {
  for (const root of roots.splice(0)) {fs.rmSync(root, {recursive: true, force: true});}
});

describe('JavaScript and TypeScript dependency hygiene', () => {
  const monorepo = (): string => fixture({
    'package.json': {
      name: 'acme-root', private: true, workspaces: ['packages/*'],
      scripts: {build: 'tsc -b', compile: 'babel src -d lib', lint: 'eslint .'},
      devDependencies: {typescript: '^5.0.0', '@babel/cli': '^7.0.0', eslint: '^8.0.0', 'eslint-plugin-react': '^7.0.0'},
    },
    '.eslintrc.json': {plugins: ['react']},
    'tsconfig.json': {compilerOptions: {strict: true, types: []}},
    'packages/a/package.json': {
      name: '@acme/a',
      dependencies: {
        lodash: '^4.0.0', '@scope/util': '^1.0.0', chalk: '^5.0.0', express: '^4.0.0', 'left-pad': '^1.0.0',
      },
      devDependencies: {'@types/express': '^4.0.0', '@types/never-used': '^1.0.0'},
      peerDependencies: {react: '^18.0.0'},
      optionalDependencies: {fsevents: '^2.0.0'},
    },
    'packages/a/src/index.ts': [
      'import map from "lodash/map";',
      'import { helper } from "@scope/util/sub/path";',
      'import type { Request } from "express";',
      'import fs from "node:fs";',
      'import path from "path";',
      'export * from "./local";',
      '// import "commented-out";',
      'const banner = "import \'in-a-string\'";',
      'const chalk = require("chalk");',
      'export const later = () => import("dayjs");',
      'export const used = [map, helper, fs, path, chalk, banner] as unknown as Request;',
    ].join('\n'),
    'packages/a/src/local.ts': 'export const local = 1;\n',
    'packages/b/package.json': {name: '@acme/b', dependencies: {zod: '^3.0.0'}},
    'packages/b/index.js': 'const z = require("zod");\nconst a = require("@acme/a");\nmodule.exports = {z, a};\n',
  });

  it('attributes imports to the package.json that owns each source file', async () => {
    const report = await analyze(monorepo());

    expect(names(report, HYGIENE_RULES.missing)).toEqual(['dayjs']);
    expect(report.findings.find(finding => finding.ruleId === HYGIENE_RULES.missing)).toMatchObject({
      severity: 'low', category: 'Dependency hygiene', file: 'packages/a/package.json',
      metadata: {importedBy: ['packages/a/src/index.ts']},
    });
    expect(names(report, HYGIENE_RULES.unused, 'packages/a/package.json')).toEqual(['@types/never-used', 'left-pad']);
    expect(report.findings.find(finding => finding.ruleId === HYGIENE_RULES.unused)?.severity).toBe('info');
    expect(names(report, HYGIENE_RULES.unused, 'packages/b/package.json')).toEqual([]);
    expect(uncertainNames(report, 'packages/b/package.json')).toEqual(['@acme/a']);
    expect(report.coverage.manifestsAnalyzed.npm).toBe(3);
  });

  it('counts config plugins, script binaries and type-only @types packages as used', async () => {
    const report = await analyze(monorepo());

    // eslint-plugin-react is only named in .eslintrc.json; @babel/cli and eslint only run from scripts.
    expect(names(report, HYGIENE_RULES.unused, 'package.json')).toEqual([]);
    const unused = names(report, HYGIENE_RULES.unused);
    expect(unused).not.toEqual(expect.arrayContaining(['@types/express']));
    expect(unused).not.toEqual(expect.arrayContaining(['react', 'fsevents']));
  });

  it('ignores Node built-ins, relative paths, comments and strings', async () => {
    const report = await analyze(monorepo());
    const reported = report.findings.flatMap(finding => [String(finding.metadata.package), JSON.stringify(finding.metadata)]);

    for (const name of ['fs', 'path', 'node:fs', 'commented-out', 'in-a-string', './local']) {
      expect(names(report, HYGIENE_RULES.missing)).not.toContain(name);
    }
    expect(reported.join(' ')).not.toContain('commented-out');
  });

  it('treats tsconfig path aliases as local and unknown aliases as uncertain', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {}},
      'tsconfig.json': {compilerOptions: {baseUrl: '.', paths: {'@app/*': ['src/*']}}},
      'src/index.ts': 'import {a} from "@app/a";\nimport {b} from "~/b";\nimport {c} from "components/c";\n',
      'src/a.ts': 'export const a = 1;\n',
      'components/c.ts': 'export const c = 1;\n',
    }));

    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
    expect(uncertainNames(report, 'package.json')).toEqual(['~/b']);
  });

  it('reads path aliases from the projects a solution-style tsconfig references', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {}},
      'tsconfig.json': {files: [], references: [{path: './tsconfig.app.json'}, {path: './tsconfig.node.json'}]},
      'tsconfig.app.json': {compilerOptions: {baseUrl: '.', paths: {'@app/*': ['src/*']}}, include: ['src']},
      'tsconfig.node.json': {compilerOptions: {types: ['node']}},
      'src/main.ts': 'import {local} from "@app/local";\nimport {sdk} from "@vendor/sdk";\nexport {local, sdk};\n',
      'src/local.ts': 'export const local = 1;\n',
    }));

    expect(names(report, HYGIENE_RULES.missing)).toEqual(['@vendor/sdk']);
  });

  it('lets a child tsconfig paths, even an empty one, replace the inherited aliases', async () => {
    for (const childPaths of [{'@app/*': ['src/*']}, {}]) {
      const report = await analyze(fixture({
        'package.json': {name: 'app', dependencies: {}},
        'tsconfig.base.json': {compilerOptions: {paths: {'@vendor/*': ['vendor/*']}}},
        'tsconfig.json': {extends: './tsconfig.base.json', compilerOptions: {paths: childPaths}},
        'src/index.ts': 'import {sdk} from "@vendor/sdk";\nexport {sdk};\n',
      }));

      expect(names(report, HYGIENE_RULES.missing)).toEqual(['@vendor/sdk']);
    }
  });

  it('reports declared packages as uncertain, not unused, after a non-literal require', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {lodash: '^4.0.0'}},
      'index.js': 'const name = "lodash";\nmodule.exports = require(name);\n',
    }));

    expect(names(report, HYGIENE_RULES.unused)).toEqual([]);
    expect(uncertainNames(report, 'package.json')).toEqual(['index.js', 'lodash']);
  });

  it('counts the automatic JSX runtime import source as used', async () => {
    for (const [options, used, unused] of [
      [{jsx: 'react-jsx'}, 'react', 'preact'],
      [{jsx: 'react-jsx', jsxImportSource: 'preact'}, 'preact', 'react'],
    ] as const) {
      const report = await analyze(fixture({
        'package.json': {name: 'app', dependencies: {react: '^18.0.0', preact: '^10.0.0'}},
        'tsconfig.json': {compilerOptions: options},
        'App.tsx': 'export const App = () => <div/>;\n',
      }));

      expect(names(report, HYGIENE_RULES.unused)).toEqual([unused]);
      expect(names(report, HYGIENE_RULES.unused)).not.toContain(used);
    }
  });

  it('records incomplete workspace evidence on every manifest in the resolution chain', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'root', private: true, workspaces: ['child'], dependencies: {lodash: '^4.0.0', sharp: '^0.33.0'}},
      'child/package.json': {name: 'child', dependencies: {}},
      'child/App.vue': '<template/>\n',
    }));
    expect(names(report, HYGIENE_RULES.unused)).toEqual([]);
    expect(uncertainNames(report, 'package.json')).toEqual(['lodash', 'sharp']);

    const dynamic = await analyze(fixture({
      'package.json': {name: 'root', private: true, workspaces: ['child'], dependencies: {sharp: '^0.33.0'}},
      'child/package.json': {name: 'child', dependencies: {}},
      'child/index.js': 'const driver = process.env.D;\nmodule.exports = require(driver);\n',
    }));
    expect(names(dynamic, HYGIENE_RULES.unused)).toEqual([]);
    expect(uncertainNames(dynamic, 'package.json')).toEqual(['sharp']);
  });

  it('resolves the complete specifier under baseUrl', async () => {
    const files = {
      'package.json': {name: 'app', dependencies: {}},
      'tsconfig.json': {compilerOptions: {baseUrl: './src'}},
      'src/@vendor/local.ts': 'export const local = 1;\n',
    };
    const missing = await analyze(fixture({...files, 'src/index.ts': 'import "@vendor/sdk";\n'}));
    expect(names(missing, HYGIENE_RULES.missing)).toEqual(['@vendor/sdk']);
    const local = await analyze(fixture({...files, 'src/index.ts': 'import "@vendor/local";\n'}));
    expect(names(local, HYGIENE_RULES.missing)).toEqual([]);
  });

  it('only trusts a paths pattern when a target file exists', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {}},
      'tsconfig.json': {compilerOptions: {paths: {'*': ['./src/*']}}},
      'src/index.ts': 'import "lodash";\nimport "./local";\n',
      'src/local.ts': 'export const local = 1;\n',
    }));

    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
    expect(uncertainNames(report, 'package.json')).toEqual(['lodash']);
  });

  it('skips files excluded by the root .gitignore', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {}},
      '.gitignore': 'generated/\n',
      'generated/bundle.js': 'require("ghostpkg");\n',
      'index.js': 'require("realpkg");\n',
    }));

    expect(names(report, HYGIENE_RULES.missing)).toEqual(['realpkg']);
  });
});

describe('JavaScript review follow-ups', () => {
  it('reports an unmatched @types package as uncertain unless tsconfig types is set', async () => {
    const files = {
      'package.json': {name: 'app', devDependencies: {'@types/webpack-env': '^1.0.0', '@types/lodash': '^4.0.0'}},
      'src/index.ts': 'const ctx = require.context("./a", true);\nexport default ctx;\n',
    };
    const unset = await analyze(fixture({...files, 'tsconfig.json': {compilerOptions: {strict: true}}}));
    expect(names(unset, HYGIENE_RULES.unused)).toEqual([]);
    expect(uncertainNames(unset, 'package.json')).toEqual(['@types/lodash', '@types/webpack-env']);

    const listed = await analyze(fixture({
      ...files,
      'tsconfig.base.json': {compilerOptions: {types: []}},
      'tsconfig.json': {extends: './tsconfig.base.json', compilerOptions: {types: ['webpack-env']}},
    }));
    expect(names(listed, HYGIENE_RULES.unused)).toEqual(['@types/lodash']);
  });

  it('counts stylesheet package imports as used and never reports them missing', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {tailwindcss: '^4.0.0', bootstrap: '^5.0.0', 'left-pad': '1.0.0'}},
      'src/app.css': '@import "tailwindcss";\n@import url("https://x.test/a.css");\n@import "./local.css";\n@import "nope-pkg";\n',
      'src/theme.scss': '@use "~bootstrap/scss/bootstrap";\n@use "sass:math";\n@import "/abs";\n',
    }));
    expect(names(report, HYGIENE_RULES.unused)).toEqual(['left-pad']);
    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
  });

  it('prefers recorded bin entries over name-based guesses, whatever the declaration order', async () => {
    const report = await analyze(fixture({
      'package.json': {
        name: 'app', scripts: {build: 'vite build'},
        devDependencies: {'@tailwindcss/vite': '^4.0.0', vite: '^6.0.0'},
      },
      'node_modules/vite/package.json': {name: 'vite', version: '6.0.0', bin: {vite: 'bin/vite.js'}},
      'node_modules/@tailwindcss/vite/package.json': {name: '@tailwindcss/vite', version: '4.0.0'},
    }));
    expect(names(report, HYGIENE_RULES.unused)).toEqual(['@tailwindcss/vite']);
  });

  it('counts package.json imports targets, including conditional ones, as used', async () => {
    const report = await analyze(fixture({
      'package.json': {
        name: 'app', dependencies: {pg: '^8.0.0', 'pg-native': '^3.0.0', node: '^1.0.0'},
        imports: {'#db': 'pg', '#fast': {node: 'pg-native', default: './x.js'}},
      },
    }));
    expect(names(report, HYGIENE_RULES.unused)).toEqual(['node']);
  });

  it('lets a declared @types package satisfy a type-only import', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', devDependencies: {'@types/lodash': '^4.0.0', '@types/dayjs': '^1.0.0'}},
      'src/index.ts': [
        'import type {A} from "lodash";',
        'import {type B} from "dayjs";',
        'export type {C} from "lodash";',
        'import {value} from "undeclared";',
        'import {type D, e} from "mixed";',
        'export const x = [value, e] as unknown as [A, B, D];',
      ].join('\n'),
    }));
    expect(names(report, HYGIENE_RULES.missing)).toEqual(['mixed', 'undeclared']);
    expect(names(report, HYGIENE_RULES.unused)).toEqual([]);
  });
});

describe('Python dependency hygiene', () => {
  it('maps import names to distributions and marks unmapped names uncertain', async () => {
    const report = await analyze(fixture({
      'requirements.txt': 'PyYAML==6.0.1\nrequests>=2.31  # unpinned is still declared\nleftpad==1.0\nmystery-dist==1.0\n',
      'app.py': [
        'import os, sys',
        'import yaml',
        'from requests import get  # import commentedpkg',
        '"""',
        'import docstringpkg',
        '"""',
        'value = "import stringpkg"',
        'import unknownmodule',
        'from . import sibling',
        'from PIL import Image',
        'import localmod',
      ].join('\n'),
      'localmod.py': 'VALUE = 1\n',
    }));

    expect(names(report, HYGIENE_RULES.unused)).toEqual(['leftpad']);
    expect(names(report, HYGIENE_RULES.missing)).toEqual(['PIL']);
    expect(report.findings.find(finding => finding.ruleId === HYGIENE_RULES.missing)?.metadata)
      .toMatchObject({distribution: 'Pillow', manifest: 'requirements.txt'});
    expect(uncertainNames(report, 'requirements.txt')).toEqual(['mystery-dist', 'unknownmodule']);
    const everything = JSON.stringify(report.findings);
    for (const name of ['commentedpkg', 'docstringpkg', 'stringpkg', 'localmod', 'sibling', '"os"', 'pyyaml']) {
      expect(everything).not.toContain(name);
    }
    expect(report.coverage.manifestsAnalyzed.pip).toBe(1);
  });

  it('does not follow a requirements include that resolves outside the repository', async () => {
    const outside = fixture({'secret.txt': 'outside-only-name==1.0\n'});
    const root = fixture({'requirements.txt': '-r linked.txt\nleftpad==1.0\n', 'app.py': 'import leftpad\n'});
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'linked.txt'));

    const report = await analyze(root);

    expect(JSON.stringify(report)).not.toContain('outside-only-name');
    expect(names(report, HYGIENE_RULES.unused)).toEqual([]);
  });

  it('does not let an unrelated nested module hide a missing distribution', async () => {
    const report = await analyze(fixture({
      'requirements.txt': '',
      'app.py': 'import yaml\nimport helpers\n',
      'helpers.py': 'VALUE = 1\n',
      'tests/yaml.py': 'VALUE = 1\n',
    }));

    expect(names(report, HYGIENE_RULES.missing)).toEqual(['yaml']);
    expect(JSON.stringify(report.findings)).not.toContain('helpers');
  });

  it('treats bare URL, archive and path requirements as incomplete declarations', async () => {
    for (const requirement of [
      'https://files.example.test/PyYAML-6.0.1-py3-none-any.whl',
      'PyYAML-6.0.1.tar.gz',
      'vendor/PyYAML-6.0.1-py3-none-any.whl',
      '.[cli]',
    ]) {
      const report = await analyze(fixture({'requirements.txt': `${requirement}\n`, 'app.py': 'import yaml\n'}));
      expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
      expect(uncertainNames(report, 'requirements.txt')).toEqual(['yaml']);
    }
    // A named direct reference still declares its distribution.
    const named = await analyze(fixture({
      'requirements.txt': 'PyYAML @ https://files.example.test/PyYAML-6.0.1-py3-none-any.whl\n',
      'app.py': 'import yaml\n',
    }));
    expect(named.findings).toEqual([]);
  });

  it('checks an included requirements file against the project that includes it', async () => {
    const report = await analyze(fixture({
      'requirements.txt': '-r config/requirements.txt\n',
      'config/requirements.txt': 'PyYAML==6.0.1\nleftpad==1.0\n',
      'app.py': 'import yaml\n',
    }));

    expect(names(report, HYGIENE_RULES.unused)).toEqual(['leftpad']);
    expect(report.findings.find(finding => finding.ruleId === HYGIENE_RULES.unused)?.file).toBe('config/requirements.txt');
    expect(report.coverage.manifestsAnalyzed.pip).toBe(1);
  });

  it('keeps an included requirements file in its own project when that directory has other requirement files', async () => {
    const report = await analyze(fixture({
      'requirements.txt': '-r config/requirements.txt\n',
      'config/requirements.txt': 'PyYAML==6.0.1\n',
      'config/requirements-dev.txt': 'leftpad==1.0\n',
      'config/tool.py': 'import yaml\n',
    }));

    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
    expect(names(report, HYGIENE_RULES.unused)).toEqual(['leftpad']);
    expect(report.coverage.manifestsAnalyzed.pip).toBe(2);
  });

  it('recognizes imports after a compound header or a semicolon', () => {
    const plain = scanPythonSource('if True:\n    import yaml\n').imports;
    expect(scanPythonSource('if True: import yaml\n').imports).toEqual(plain);
    expect(scanPythonSource('if TYPE_CHECKING: import yaml\n').imports).toEqual(['yaml']);
    expect(scanPythonSource('import os; import yaml\ntry: from a.b import c\nexcept ImportError: import d\n').imports)
      .toEqual(['os', 'yaml', 'a.b', 'd']);
    // Colons inside brackets, strings, walrus and lambda bodies are not the suite colon.
    expect(scanPythonSource([
      'if data[1:2]: import a',
      'if {"k": 1}.get("k"): import b',
      'while (n := next(it)): import c',
      'if (lambda x: x)(1): import d',
      'if lambda: 0: import e',
      'if "x:y": import f',
      'if x: y = 1',
    ].join('\n')).imports).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(scanPythonSource([
      'def f(x: int) -> Dict[str, int]: import a',
      'class A(B): import b',
      'async def g(): import c',
    ].join('\n')).imports).toEqual(['a', 'b', 'c']);
  });

  it('does not throw on import names that match Object.prototype members', async () => {
    const report = await analyze(fixture({
      'requirements.txt': 'PyYAML==6.0.1\n',
      'app.py': 'import yaml\nimport constructor\nimport toString\n',
    }));

    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
    expect(uncertainNames(report, 'requirements.txt')).toEqual(['constructor', 'toString']);
  });

  it('reports a missing import as uncertain when a requirements include cannot be read', async () => {
    const report = await analyze(fixture({
      'requirements.txt': '-r deps.txt\n',
      'app.py': 'import yaml\n',
    }));

    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
    expect(uncertainNames(report, 'requirements.txt')).toEqual(['yaml']);
  });

  it('reports a missing import as uncertain when the top-level requirements file is oversized', async () => {
    const report = await analyze(fixture({
      'requirements.txt': `PyYAML==6.0.1\n# ${'x'.repeat(2 * 1024 * 1024 + 10)}\n`,
      'app.py': 'import yaml\n',
    }));

    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
    expect(uncertainNames(report, 'requirements.txt')).toEqual(['yaml']);
  });

  it('reports one missing finding per expected distribution', async () => {
    const report = await analyze(fixture({
      'requirements.txt': 'requests==2.0\n',
      'a.py': 'import google.protobuf\n',
      'b.py': 'import google.genai\nimport google.protobuf\n',
    }));

    const missing = report.findings.filter(finding => finding.ruleId === HYGIENE_RULES.missing);
    expect(missing.map(finding => finding.metadata.distribution).sort()).toEqual(['google-genai', 'protobuf']);
    expect(missing.find(finding => finding.metadata.distribution === 'protobuf')?.metadata.importedBy)
      .toEqual(['a.py', 'b.py']);
  });

  it('skips comments and strings in the tokenizer', () => {
    expect(scanPythonSource('x = 1  # import a\ny = \'\'\'\nimport b\n\'\'\'\nimport c.d as e, f\nfrom g.h import (i)\n').imports)
      .toEqual(['c.d', 'f', 'g.h']);
  });
});

describe('review follow-ups for pip and Go', () => {
  it('reports unmatched imports as uncertain when requirements use an editable install', async () => {
    const report = await analyze(fixture({
      'requirements.txt': '-e .\n',
      'pyproject.toml': '[project]\nname = "x"\ndependencies = ["PyYAML"]\n',
      'app.py': 'import yaml\n',
    }));
    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
    expect(uncertainNames(report, 'requirements.txt')).toEqual(['yaml']);
  });

  it('treats imports of go.work modules as local', async () => {
    const files = {
      'go.work': 'go 1.22\n\nuse (\n\t./app\n\t./lib // shared\n)\n',
      'app/go.mod': 'module example.com/app\n\ngo 1.22\n',
      'app/main.go': 'package main\n\nimport "example.com/lib/x"\n\nfunc main() { x.Do() }\n',
      'lib/go.mod': 'module example.com/lib\n\ngo 1.22\n',
      'lib/x/x.go': 'package x\n\nfunc Do() {}\n',
    };
    expect(names(await analyze(fixture(files)), HYGIENE_RULES.missing)).toEqual([]);
    const without = await analyze(fixture({...files, 'go.work': 'go 1.22\n'}));
    expect(names(without, HYGIENE_RULES.missing)).toEqual(['example.com/lib/x']);
  });
});

describe('Go dependency hygiene', () => {

  it('counts a go.mod tool directive as use of the module that provides it', async () => {
    const report = await analyze(fixture({
      'go.mod': 'module example.com/app\n\ngo 1.24\n\nrequire golang.org/x/tools v0.1.0\n\ntool golang.org/x/tools/cmd/stringer\n',
      'main.go': 'package main\n',
    }));

    expect(names(report, HYGIENE_RULES.unused)).toEqual([]);
  });

  it('marks coverage as skipped when go.mod is over the size cap', async () => {
    const report = await analyze(fixture({
      'go.mod': `module example.com/app\n// ${'x'.repeat(2 * 1024 * 1024 + 10)}\n`,
      'main.go': 'package main\n',
    }));

    expect(report.coverage.sourceFilesSkipped).toBeGreaterThan(0);
    expect(report.coverage.manifestsAnalyzed.go).toBe(0);
  });
  it('matches imports to go.mod requires by longest prefix and ignores the standard library', async () => {
    const report = await analyze(fixture({
      'go.mod': [
        'module example.com/app',
        '',
        'go 1.22',
        '',
        'require (',
        '\tgithub.com/stripe/stripe-go/v76 v76.0.0',
        '\tgithub.com/unused/mod v1.0.0',
        '\tgolang.org/x/text v0.14.0 // indirect',
        ')',
      ].join('\n'),
      'main.go': [
        'package main',
        '',
        'import (',
        '\t"fmt"',
        '\t"net/http"',
        '\tcustomer "github.com/stripe/stripe-go/v76/customer"',
        '\t"example.com/app/internal/x"',
        '\t"github.com/missing/thing/pkg"',
        '\t// "github.com/commented/out"',
        ')',
        '',
        'func main() { fmt.Println("import \\"github.com/in/string\\"", http.MethodGet, customer.New, x.Y) }',
      ].join('\n'),
    }));

    expect(names(report, HYGIENE_RULES.unused)).toEqual(['github.com/unused/mod']);
    expect(names(report, HYGIENE_RULES.missing)).toEqual(['github.com/missing/thing/pkg']);
    expect(report.coverage.manifestsAnalyzed.go).toBe(1);
  });

  it('credits a required module nested under the main module path', async () => {
    const report = await analyze(fixture({
      'go.mod': 'module example.com/project\n\ngo 1.22\n\nrequire example.com/project/sdk v0.0.0\n\nreplace example.com/project/sdk => ./sdk\n',
      'main.go': 'package main\n\nimport (\n\t"example.com/project/sdk"\n\t"example.com/project/internal/x"\n)\n\nfunc main() { sdk.Run(); x.Y() }\n',
    }));

    expect(names(report, HYGIENE_RULES.unused)).toEqual([]);
    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
  });

  it('ignores Go files whose names start with a dot or an underscore', async () => {
    const report = await analyze(fixture({
      'go.mod': 'module example.com/app\n\ngo 1.22\n',
      'main.go': 'package main\n\nfunc main() {}\n',
      '_scratch.go': 'package main\n\nimport "github.com/undeclared/mod"\n',
      '.scratch.go': 'package main\n\nimport "github.com/hidden/mod"\n',
    }));

    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
    expect(report.coverage.sourceFilesAnalyzed).toBe(1);
  });

  it('reports requires as uncertain when a Go source is too large to read', async () => {
    const report = await analyze(fixture({
      'go.mod': 'module example.com/app\n\ngo 1.22\n\nrequire github.com/needed/mod v1.0.0\n',
      'main.go': `package main\n\nimport "github.com/needed/mod"\n\n// ${'x'.repeat(2 * 1024 * 1024)}\n`,
    }));

    expect(names(report, HYGIENE_RULES.unused)).toEqual([]);
    expect(uncertainNames(report, 'go.mod')).toEqual(['github.com/needed/mod']);
    expect(report.coverage.sourceFilesTooLarge).toBe(1);
  });

  it('reads single and grouped imports from the file header only', () => {
    expect(scanGoImports('package a\n/* import "x" */\nimport _ "a/b"\nimport (\n\t. "c/d"\n)\nfunc f() { _ = "import \\"e\\"" }\n'))
      .toEqual(['c/d', 'a/b']);
  });
});

describe('install scripts', () => {

  it('words pnpm requiresBuild as a build requirement, not an install script', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {sharp: '0.33.0'}},
      'pnpm-lock.yaml': [
        "lockfileVersion: '6.0'", 'dependencies:', '  sharp:', '    specifier: 0.33.0', '    version: 0.33.0',
        'packages:', '  /sharp@0.33.0:', '    resolution: {integrity: sha512-fixture}', '    requiresBuild: true', '    dev: false', '',
      ].join('\n'),
    }));

    expect(report.findings.find(finding => finding.ruleId === HYGIENE_RULES.installScript)?.description)
      .toBe('sharp@0.33.0 is marked by pnpm as requiring a build');
  });

  it('counts only the active npm lockfile as checked', async () => {
    const packages = {'': {name: 'app', version: '1.0.0'}};
    const report = await analyze(fixture({
      'package.json': {name: 'app', version: '1.0.0'},
      'package-lock.json': {name: 'app', version: '1.0.0', lockfileVersion: 1, dependencies: {}},
      'npm-shrinkwrap.json': {name: 'app', version: '1.0.0', lockfileVersion: 3, packages},
    }));

    expect(report.coverage.installScripts).toEqual({lockfilesChecked: 1, notDeterminable: []});
  });
  it('ignores package-lock.json beside a malformed npm-shrinkwrap.json, as npm does', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', version: '1.0.0', dependencies: {esbuild: '0.20.0'}},
      'npm-shrinkwrap.json': '{ not json',
      'package-lock.json': {
        name: 'app', version: '1.0.0', lockfileVersion: 3,
        packages: {'': {name: 'app'}, 'node_modules/esbuild': {version: '0.20.0', hasInstallScript: true}},
      },
      'index.js': 'require("esbuild");\n',
    }));

    expect(report.findings.filter(finding => finding.ruleId === HYGIENE_RULES.installScript)).toEqual([]);
  });

  it('marks inline type-only imports uncertain when verbatimModuleSyntax may come from a package base', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', devDependencies: {'@types/lodash': '^4.0.0', '@tsconfig/strictest': '^2.0.0'}},
      'tsconfig.json': {extends: '@tsconfig/strictest/tsconfig.json'},
      'src/a.ts': 'import { type LoDashStatic } from "lodash";\nimport type { Dictionary } from "lodash";\nexport type T = [LoDashStatic, Dictionary<string>];\n',
    }));

    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
    expect(uncertainNames(report, 'package.json')).toEqual(['lodash']);
  });

  it('reports package-lock v3 hasInstallScript with its dependency path', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', version: '1.0.0', dependencies: {esbuild: '0.20.0'}},
      'package-lock.json': {
        name: 'app', version: '1.0.0', lockfileVersion: 3, requires: true,
        packages: {
          '': {name: 'app', version: '1.0.0', dependencies: {esbuild: '0.20.0'}},
          'node_modules/esbuild': {
            version: '0.20.0', resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.20.0.tgz',
            integrity: 'sha512-fixture', hasInstallScript: true,
          },
        },
      },
      'index.js': 'require("esbuild");\n',
    }));

    expect(report.findings.filter(finding => finding.ruleId === HYGIENE_RULES.installScript)).toEqual([
      expect.objectContaining({
        severity: 'low', file: 'package-lock.json',
        description: 'esbuild@0.20.0 runs an install script when installed',
        metadata: expect.objectContaining({dependencyPaths: ['esbuild@0.20.0'], direct: true}),
      }),
    ]);
    expect(report.coverage.installScripts).toEqual({lockfilesChecked: 1, notDeterminable: []});
  });

  it('reports pnpm requiresBuild', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {sharp: '0.33.0'}},
      'pnpm-lock.yaml': [
        "lockfileVersion: '6.0'",
        'dependencies:',
        '  sharp:',
        '    specifier: 0.33.0',
        '    version: 0.33.0',
        'packages:',
        '  /sharp@0.33.0:',
        '    resolution: {integrity: sha512-fixture}',
        '    requiresBuild: true',
        '    dev: false',
        '',
      ].join('\n'),
      'index.js': 'require("sharp");\n',
    }));

    expect(names(report, HYGIENE_RULES.installScript)).toEqual(['sharp']);
    expect(report.findings.find(finding => finding.ruleId === HYGIENE_RULES.installScript)?.file).toBe('pnpm-lock.yaml');
  });

  it('reports Yarn lockfiles as not determinable', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {'left-pad': '^1.3.0'}},
      'yarn.lock': [
        '# yarn lockfile v1',
        '',
        'left-pad@^1.3.0:',
        '  version "1.3.0"',
        '  resolved "https://registry.yarnpkg.com/left-pad/-/left-pad-1.3.0.tgz"',
        '  integrity sha512-fixture',
        '',
      ].join('\n'),
      'index.js': 'require("left-pad");\n',
    }));

    expect(report.findings.filter(finding => finding.ruleId === HYGIENE_RULES.installScriptUndetermined)).toEqual([
      expect.objectContaining({severity: 'info', file: 'yarn.lock'}),
    ]);
    expect(report.coverage.installScripts.notDeterminable).toEqual(['yarn.lock']);
  });
});

describe('dependency-insights scanner', () => {
  it('runs as an optional engine task and its envelope validates against the v1 schema', async () => {
    const root = fixture({
      'package.json': {name: 'app', dependencies: {stripe: '14.0.0'}},
      'package-lock.json': {
        name: 'app', lockfileVersion: 3, requires: true,
        packages: {
          '': {name: 'app', dependencies: {stripe: '14.0.0'}},
          'node_modules/stripe': {version: '14.0.0', resolved: 'https://registry.npmjs.org/stripe/-/stripe-14.0.0.tgz'},
        },
      },
      'index.js': 'const Stripe = require("stripe");\nconst pad = require("left-pad");\nmodule.exports = {Stripe, pad};\n',
    });
    const inventory = collectPackageInventory(root);
    const engine = new ScanEngine();
    const options = {repoPath: root, offline: true, includeVulnerabilities: false, includeGitHistory: false, packageInventory: inventory};

    const result = await engine.runSecurityScan({...options, includeDependencyInsights: true});
    const scanner = result.scannerResults.find(item => item.scanner === 'dependency-insights');
    expect(scanner).toMatchObject({required: false, status: 'succeeded'});
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ruleId: HYGIENE_RULES.missing, scanners: ['dependency-insights'], file: 'package.json'}),
    ]));

    const report = await analyzeDependencyInsights(inventory);
    const envelope = createScanEnvelope(result, {
      command: 'scan',
      sbom: {
        status: 'succeeded',
        services: detectServices(inventory.coordinates),
        dependencyInsights: {status: 'succeeded', coverage: report.coverage},
      },
    });
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../schemas/guardscan.scan.v1.schema.json'), 'utf8'));
    const validate = new Ajv({allErrors: true}).compile(schema);
    expect(validate(JSON.parse(JSON.stringify(envelope)))).toBe(true);
    expect(envelope.sbom.services).toEqual([expect.objectContaining({service: 'Stripe', package: 'stripe', version: '14.0.0'})]);

    const disabled = await engine.runSecurityScan({...options, includeDependencyInsights: false});
    expect(disabled.scannerResults.find(item => item.scanner === 'dependency-insights'))
      .toMatchObject({status: 'skipped', skipReason: 'disabled'});
    const omitted = await engine.runSecurityScan(options);
    expect(omitted.scannerResults.map(item => item.scanner)).not.toContain('dependency-insights');
  });

  it('reports heuristic findings without failing the default policy or --fail-on medium', async () => {
    const root = fixture({
      'package.json': {name: 'app', dependencies: {'left-pad': '1.0.0'}},
      'index.js': 'const dayjs = require("dayjs");\nmodule.exports = dayjs;\n',
    });
    const result = await new ScanEngine().runSecurityScan({
      repoPath: root, offline: true, includeVulnerabilities: false, includeGitHistory: false,
      packageInventory: collectPackageInventory(root), includeDependencyInsights: true,
    });
    expect(result.findings.map(finding => [finding.ruleId, finding.severity]).sort()).toEqual([
      [HYGIENE_RULES.missing, 'low'], [HYGIENE_RULES.unused, 'info'],
    ]);
    const done = {status: 'succeeded' as const, durationMs: 1, data: []};
    const quality = {status: 'complete' as const, checks: {
      tests: done, metrics: done, smells: done, lint: done, performance: done, mutation: done,
    }};
    const outcome = (failOn?: 'high' | 'medium' | 'low'): string => evaluateComprehensivePolicy(
      result, quality, {status: 'succeeded', document: {}}, {failOn, allowPartial: false}
    ).result.outcome;
    expect(outcome()).toBe('passed');
    expect(outcome('high')).toBe('passed');
    expect(outcome('medium')).toBe('passed');
    expect(outcome('low')).toBe('policy-failed');
  });
});

describe('PR 74 review round 5', () => {
  it('uses only the nearest go.work', async () => {
    const report = await analyze(fixture({
      'go.work': 'go 1.22\n\nuse (\n\t./lib\n\t./nested/app\n)\n',
      'lib/go.mod': 'module example.com/lib\n\ngo 1.22\n',
      'nested/go.work': 'go 1.22\n\nuse ./app\n',
      'nested/app/go.mod': 'module example.com/app\n\ngo 1.22\n',
      'nested/app/main.go': 'package main\n\nimport "example.com/lib/x"\n\nfunc main() { x.Do() }\n',
    }));
    expect(names(report, HYGIENE_RULES.missing)).toEqual(['example.com/lib/x']);
  });

  it('takes install scripts only from the active npm lock', async () => {
    const lock = (name: string) => ({
      lockfileVersion: 3,
      packages: {'': {name: 'app'}, [`node_modules/${name}`]: {version: '1.0.0', hasInstallScript: true}},
    });
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {esbuild: '1.0.0', lodash: '1.0.0'}},
      'npm-shrinkwrap.json': lock('lodash'),
      'package-lock.json': lock('esbuild'),
    }));
    expect(names(report, HYGIENE_RULES.installScript)).toEqual(['lodash']);
  });

  it('applies .gitignore to names that start with two dots', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {}},
      '.gitignore': '..cache/\n',
      '..cache/gen.js': 'require("ghostpkg");\n',
      'index.js': 'require("realpkg");\n',
    }));
    expect(names(report, HYGIENE_RULES.missing)).toEqual(['realpkg']);
  });

  it('treats a non-editable local requirement as incomplete', async () => {
    const report = await analyze(fixture({
      'requirements.txt': '.\n',
      'pyproject.toml': '[project]\nname = "x"\ndependencies = ["PyYAML"]\n',
      'app.py': 'import yaml\n',
    }));
    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
  });

  it('selects the exact paths key before a wildcard', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {}},
      'tsconfig.json': {compilerOptions: {paths: {'@app/*': ['./src/*'], '@app/widgets': ['./missing.ts']}}},
      'src/widgets.ts': 'export const w = 1;\n',
      'src/index.ts': 'import "@app/widgets";\n',
    }));
    expect(uncertainNames(report, 'package.json')).toEqual(['@app/widgets']);
  });

  it('keeps inline type imports at runtime under verbatimModuleSyntax', async () => {
    const files = {
      'package.json': {name: 'app', devDependencies: {'@types/lodash': '^4.0.0'}},
      'src/index.ts': 'import {type LoDashStatic} from "lodash";\nexport type T = LoDashStatic;\n',
    };
    const off = await analyze(fixture({...files, 'tsconfig.json': {compilerOptions: {}}}));
    expect(names(off, HYGIENE_RULES.missing)).toEqual([]);
    const on = await analyze(fixture({...files, 'tsconfig.json': {compilerOptions: {verbatimModuleSyntax: true}}}));
    expect(names(on, HYGIENE_RULES.missing)).toEqual(['lodash']);
  });

  it('substitutes .js specifiers with TypeScript sources', async () => {
    const report = await analyze(fixture({
      'package.json': {name: 'app', dependencies: {}},
      'tsconfig.json': {compilerOptions: {baseUrl: './src'}},
      'src/@app/widgets.ts': 'export const w = 1;\n',
      'src/index.ts': 'import "@app/widgets.js";\n',
    }));
    expect(names(report, HYGIENE_RULES.missing)).toEqual([]);
  });
});
