const {createArtifactSboms} = require('../../scripts/release/artifact-sbom') as {
  createArtifactSboms: (input: Record<string, any>) => Record<string, any>;
};

const input = {
  version: '1.2.0-rc.1',
  tag: 'v1.2.0-rc.1',
  commit: 'a'.repeat(40),
  createdAt: '2026-07-20T00:00:00.000Z',
  platformId: 'linux-x64-glibc',
  nodeVersion: '22.12.0',
  executable: {filename: 'guardscan', sha256: 'b'.repeat(64)},
  components: [{
    name: 'axios',
    version: '1.2.3',
    type: 'library',
    purl: 'pkg:npm/axios@1.2.3',
  }],
};

describe('standalone artifact SBOM', () => {
  it('lists bundled runtime dependencies in SPDX and CycloneDX', () => {
    const result = createArtifactSboms(input);

    expect(result.spdx.packages.map((component: any) => component.name)).toContain('axios');
    expect(result.cyclonedx.components).toContainEqual(expect.objectContaining({
      name: 'axios',
      version: '1.2.3',
      purl: 'pkg:npm/axios@1.2.3',
      scope: 'required',
    }));
  });

  it('rejects an empty or invalid bundled component inventory', () => {
    expect(() => createArtifactSboms({...input, components: []}))
      .toThrow(/requires the bundled third-party component inventory/);
    expect(() => createArtifactSboms({...input, components: [{...input.components[0], version: '9.9.9'}]}))
      .toThrow(/bundled component inventory is invalid/);
  });
});
