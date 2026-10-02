import path from 'path';

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
