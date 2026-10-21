import path from 'path';
import fs from 'fs';
import os from 'os';
import vm from 'vm';
import {build} from 'esbuild';

const {
  OPTIONAL_EXTERNALS,
  PROTOTYPE_SCHEMA,
  assertExternalAllowlist,
  bundleOptions,
  bundledComponents,
  externalPackages,
  hostPlatform,
} = require('../../scripts/release/standalone') as {
  OPTIONAL_EXTERNALS: string[];
  PROTOTYPE_SCHEMA: string;
  assertExternalAllowlist: (metafile: Record<string, any>) => string[];
  bundleOptions: (entryPoint: string, outputFile: string) => Record<string, any>;
  bundledComponents: (metafile: Record<string, any>, lock: Record<string, any>) => Array<Record<string, string>>;
  externalPackages: (metafile: Record<string, any>) => string[];
  hostPlatform: () => {os: string; arch: string};
};

function metafile(imports: Array<{path: string; external?: boolean}>): Record<string, any> {
  return {
    outputs: {
      'guardscan.bundle.cjs': {imports},
    },
  };
}

describe('standalone executable builder contract', () => {
  it('bundles dependency probes without filesystem package lookups or extra runtime externals', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-sea-probes-'));
    try {
      const modules: Record<string, string> = {
        'fdir/dist/index.cjs': 'let pm; try { require.resolve("picomatch"); pm = require("picomatch"); } catch {}\nmodule.exports = value => pm(value);',
        'fdir/package.json': JSON.stringify({name: 'fdir', main: 'dist/index.cjs'}),
        'picomatch/index.js': 'module.exports = value => value === "matched";',
        'typescript/lib/typescript.js': 'let missing = false; try { require("source-map-support").install(); } catch { missing = true; } module.exports = missing;',
        'typescript/package.json': JSON.stringify({name: 'typescript', main: 'lib/typescript.js'}),
      };
      for (const [file, contents] of Object.entries(modules)) {
        const target = path.join(root, 'node_modules', file);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, contents);
      }
      const entry = path.join(root, 'index.js');
      fs.writeFileSync(entry, 'module.exports = {matched: require("fdir")("matched"), sourceMapsUnavailable: require("typescript")};');
      const result = await build({...bundleOptions(entry, path.join(root, 'bundle.cjs')), write: false});
      expect(assertExternalAllowlist(result.metafile!)).toEqual([]);
      const module = {exports: {}};
      vm.runInNewContext(result.outputFiles![0].text, {
        module, require: (name: string) => { throw new Error('Unbundled dependency: ' + name); },
      });
      expect(module.exports).toEqual({matched: true, sourceMapsUnavailable: true});
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });

  it('keeps the real CLI bundle inside the unchanged optional-external allowlist', async () => {
    const result = await build({...bundleOptions(
      path.resolve(__dirname, '../../src/index.ts'), path.join(os.tmpdir(), 'guardscan-sea-regression.cjs')
    ), write: false});
    expect(() => assertExternalAllowlist(result.metafile!)).not.toThrow();
    const components = bundledComponents(result.metafile!, require('../../package-lock.json'));
    expect(components.some(component => component.name === 'picomatch')).toBe(true);
    expect(components.some(component => component.name === 'typescript')).toBe(true);
  });

  it('creates a single CommonJS Node 22 bundle and externalizes only optional native capabilities', () => {
    const options = bundleOptions('/source/dist/index.js', '/output/guardscan.bundle.cjs');
    expect(options).toMatchObject({
      entryPoints: ['/source/dist/index.js'],
      outfile: '/output/guardscan.bundle.cjs',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: ['node22'],
      splitting: false,
      sourcemap: false,
      metafile: true,
    });
    expect(options.external).toEqual(expect.arrayContaining([
      'chartjs-node-canvas',
      'tiktoken',
    ]));
    expect(OPTIONAL_EXTERNALS).toEqual(['chartjs-node-canvas', 'tiktoken']);
    expect(PROTOTYPE_SCHEMA).toBe('guardscan.standalone-prototype.v1');
  });

  it('ignores Node built-ins and rejects undeclared runtime package dependencies', () => {
    const allowed = metafile([
      {path: 'node:fs', external: true},
      {path: 'fs/promises', external: true},
      {path: 'chartjs-node-canvas', external: true},
      {path: 'tiktoken/lite', external: true},
      {path: './bundled-module.js'},
    ]);
    expect(externalPackages(allowed)).toEqual(['chartjs-node-canvas', 'tiktoken']);
    expect(assertExternalAllowlist(allowed)).toEqual(['chartjs-node-canvas', 'tiktoken']);

    expect(() => assertExternalAllowlist(metafile([
      {path: 'unexpected-runtime-package', external: true},
    ]))).toThrow(/undeclared runtime packages: unexpected-runtime-package/);
  });

  it('records the locked identities of packages present in the standalone bundle', () => {
    const components = bundledComponents({
      inputs: {
        'node_modules/axios/index.js': {},
        'node_modules/@scope/pkg/index.js': {},
        'node_modules/axios/lib/extra.js': {},
      },
    }, {
      packages: {
        'node_modules/axios': {version: '1.2.3'},
        'node_modules/@scope/pkg': {version: '4.5.6'},
      },
    });

    expect(components).toEqual([
      {name: '@scope/pkg', version: '4.5.6', type: 'library', purl: 'pkg:npm/%40scope/pkg@4.5.6'},
      {name: 'axios', version: '1.2.3', type: 'library', purl: 'pkg:npm/axios@1.2.3'},
    ]);
  });

  it('rejects bundled packages that cannot be matched to locked versions', () => {
    expect(() => bundledComponents({inputs: {'node_modules/unknown/index.js': {}}}, {
      packages: {'node_modules/axios': {version: '1.2.3'}},
    })).toThrow(/missing from package-lock/);
  });

  it('maps the current host to a supported immutable platform identity', () => {
    const platform = hostPlatform();
    expect(['darwin', 'linux', 'windows']).toContain(platform.os);
    expect(['arm64', 'x64']).toContain(platform.arch);
    expect(path.isAbsolute(process.execPath)).toBe(true);
  });
});
