import {classifySbomInventoryErrors} from '../../src/commands/sbom';

describe('SBOM inventory error policy', () => {
  it('blocks malformed manifests but only warns for incomplete supported coverage', () => {
    const errors = [
      {file: 'package.json', code: 'INVALID_MANIFEST' as const, message: 'invalid JSON'},
      {file: 'requirements.txt', code: 'UNRESOLVED_VERSION' as const, message: 'unpinned'},
      {file: 'go.work', code: 'UNSUPPORTED_FORMAT' as const, message: 'workspace unsupported'},
    ];

    expect(classifySbomInventoryErrors(errors)).toEqual({
      fatal: [errors[0]],
      warnings: [errors[1], errors[2]],
    });
  });
});
