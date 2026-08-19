import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  OPTIONAL_EXTERNALS,
  PROTOTYPE_SCHEMA,
  assertExternalAllowlist,
  assertReducedCapabilityEvidence,
  bundleOptions,
  externalPackages,
  hostPlatform,
  releaseToolchainVersions,
  renameWithTransientRetry,
} = require('../../scripts/release/standalone') as {
  OPTIONAL_EXTERNALS: string[];
  PROTOTYPE_SCHEMA: string;
  assertExternalAllowlist: (metafile: Record<string, any>) => string[];
  assertReducedCapabilityEvidence: (evidence: Record<string, any>) => Record<string, any>;
  bundleOptions: (entryPoint: string, outputFile: string) => Record<string, any>;
  externalPackages: (metafile: Record<string, any>) => string[];
  hostPlatform: () => {os: string; arch: string};
  releaseToolchainVersions: () => {esbuild: string; postject: string};
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

const {
  FORBIDDEN_RUNTIME_LITERALS,
  assertCompiledRuntimeFilesClean,
  assertRuntimeArtifactClean,
} = require('../../scripts/release/runtime-artifact-policy') as {
  FORBIDDEN_RUNTIME_LITERALS: readonly string[];
  assertCompiledRuntimeFilesClean: (root: string, files: Iterable<string>, label?: string) => string[];
  assertRuntimeArtifactClean: (content: Buffer | string, label: string) => void;
};

function metafile(imports: Array<{path: string; external?: boolean}>): Record<string, any> {
  return {
    outputs: {
      'guardscan.bundle.cjs': {imports},
    },
  };
}

describe('standalone executable builder contract', () => {
  it('fails closed on retired API literals in runtime bytes', () => {
    expect(FORBIDDEN_RUNTIME_LITERALS).toEqual([
      'api.guardscancli.com',
      'GUARDSCAN_API_URL',
      'DEFAULT_API_BASE_URL',
    ]);
    expect(() => assertRuntimeArtifactClean(Buffer.from('clean runtime'), 'SEA payload')).not.toThrow();
    for (const literal of FORBIDDEN_RUNTIME_LITERALS) {
      expect(() => assertRuntimeArtifactClean(
        Buffer.from(`runtime contains ${literal}`),
        'SEA payload'
      )).toThrow(`SEA payload contains forbidden retired runtime literals: ${literal}`);
    }
  });

  it('scans packed compiled JavaScript without rejecting packaged historical documentation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-runtime-policy-'));
    try {
      fs.mkdirSync(path.join(root, 'dist'));
      fs.writeFileSync(path.join(root, 'dist', 'index.js'), 'module.exports = true;\n');
      fs.writeFileSync(path.join(root, 'README.md'), FORBIDDEN_RUNTIME_LITERALS.join('\n'));
      fs.writeFileSync(path.join(root, 'CHANGELOG.md'), FORBIDDEN_RUNTIME_LITERALS.join('\n'));
      const files = ['README.md', 'CHANGELOG.md', 'dist/index.js'];

      expect(() => assertCompiledRuntimeFilesClean(root, files.slice(0, 2), 'npm packed runtime'))
        .toThrow('npm packed runtime contains no compiled JavaScript under dist/');
      expect(assertCompiledRuntimeFilesClean(root, files, 'npm packed runtime'))
        .toEqual(['dist/index.js']);

      fs.writeFileSync(path.join(root, 'dist', 'index.js'), 'const url = "api.guardscancli.com";\n');
      expect(() => assertCompiledRuntimeFilesClean(root, files, 'npm packed runtime'))
        .toThrow(/npm packed runtime dist\/index\.js contains forbidden retired runtime literals/);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
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

  it('reports the pinned standalone toolchain through supported package interfaces', () => {
    expect(releaseToolchainVersions()).toEqual({
      esbuild: '0.28.1',
      postject: '1.0.0-alpha.6',
    });
  });

  it('accepts observed reduced-capability evidence from the standalone executable', () => {
    const evidence = {
      schemaVersion: 'guardscan.runtime-capabilities.v1',
      tokenCounting: {
        dependency: 'tiktoken',
        dependencyAvailable: false,
        mode: 'estimated',
        sampleTokenCount: 7,
        safeFallbackObserved: true,
      },
      chartRendering: {
        dependency: 'chartjs-node-canvas',
        dependencyAvailable: false,
        mode: 'unavailable',
        safeFallbackObserved: true,
      },
    };

    expect(assertReducedCapabilityEvidence(evidence)).toBe(evidence);
  });

  it.each([
    ['tiktoken was unexpectedly available', {
      schemaVersion: 'guardscan.runtime-capabilities.v1',
      tokenCounting: {
        dependency: 'tiktoken', dependencyAvailable: true, mode: 'accurate',
        sampleTokenCount: 7, safeFallbackObserved: false,
      },
      chartRendering: {
        dependency: 'chartjs-node-canvas', dependencyAvailable: false,
        mode: 'unavailable', safeFallbackObserved: true,
      },
    }],
    ['chart fallback was not observed', {
      schemaVersion: 'guardscan.runtime-capabilities.v1',
      tokenCounting: {
        dependency: 'tiktoken', dependencyAvailable: false, mode: 'estimated',
        sampleTokenCount: 7, safeFallbackObserved: true,
      },
      chartRendering: {
        dependency: 'chartjs-node-canvas', dependencyAvailable: false,
        mode: 'unavailable', safeFallbackObserved: false,
      },
    }],
  ])('rejects standalone evidence when %s', (_label, evidence) => {
    expect(() => assertReducedCapabilityEvidence(evidence)).toThrow(
      /standalone reduced-capability contract failed/
    );
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
