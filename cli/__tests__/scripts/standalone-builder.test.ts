import path from 'path';

const {
  OPTIONAL_EXTERNALS,
  PROTOTYPE_SCHEMA,
  assertExternalAllowlist,
  bundleOptions,
  externalPackages,
  hostPlatform,
  renameWithTransientRetry,
} = require('../../scripts/release/standalone') as {
  OPTIONAL_EXTERNALS: string[];
  PROTOTYPE_SCHEMA: string;
  assertExternalAllowlist: (metafile: Record<string, any>) => string[];
  bundleOptions: (entryPoint: string, outputFile: string) => Record<string, any>;
  externalPackages: (metafile: Record<string, any>) => string[];
  hostPlatform: () => {os: string; arch: string};
  renameWithTransientRetry: (
    source: string,
    destination: string,
    options?: {
      rename?: (source: string, destination: string) => Promise<void>;
      wait?: (delay: number) => Promise<void>;
      delays?: number[];
    }
  ) => Promise<void>;
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

  it('maps the current host to a supported immutable platform identity', () => {
    const platform = hostPlatform();
    expect(['darwin', 'linux', 'windows']).toContain(platform.os);
    expect(['arm64', 'x64']).toContain(platform.arch);
    expect(path.isAbsolute(process.execPath)).toBe(true);
  });

  it.each(['EACCES', 'EBUSY', 'EPERM'])('retries a transient %s atomic publish failure', async code => {
    const transient = Object.assign(new Error('temporarily locked'), {code});
    const rename = jest.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(undefined);
    const wait = jest.fn().mockResolvedValue(undefined);

    await renameWithTransientRetry('/stage', '/release', {
      rename,
      wait,
      delays: [25],
    });

    expect(rename).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(25);
  });

  it('does not retry a non-transient atomic publish failure', async () => {
    const permanent = Object.assign(new Error('invalid target'), {code: 'EINVAL'});
    const rename = jest.fn().mockRejectedValue(permanent);
    const wait = jest.fn().mockResolvedValue(undefined);

    await expect(renameWithTransientRetry('/stage', '/release', {
      rename,
      wait,
      delays: [25],
    })).rejects.toBe(permanent);

    expect(rename).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
