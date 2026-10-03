import {classifySbomInventoryErrors} from '../../src/commands/sbom';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {sbomCommand} from '../../src/commands/sbom';
import {configManager} from '../../src/core/config';
import {licenseScanner} from '../../src/core/license-scanner';
import {repositoryManager} from '../../src/core/repository';
import * as errorHandler from '../../src/utils/error-handler';
import * as privateState from '../../src/utils/private-state';

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

describe('SBOM output safety', () => {
  let repository: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    repository = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-sbom-')));
    process.chdir(repository);
    jest.spyOn(repositoryManager, 'getRepoInfo').mockReturnValue({name: 'fixture'} as ReturnType<typeof repositoryManager.getRepoInfo>);
    jest.spyOn(configManager, 'loadOrInit').mockReturnValue({offlineMode: true} as ReturnType<typeof configManager.loadOrInit>);
    jest.spyOn(licenseScanner, 'scan').mockResolvedValue({
      totalDependencies: 0,
      findings: [],
      compatibilityIssues: [],
      riskSummary: {critical: 0, high: 0, medium: 0, low: 0, info: 0},
      categorySummary: {permissive: 0, 'weak-copyleft': 0, 'strong-copyleft': 0, proprietary: 0, unknown: 0},
      inventoryErrors: [],
    });
    jest.spyOn(licenseScanner, 'generateSBOM').mockReturnValue({
      spdxVersion: 'SPDX-2.3',
      dataLicense: 'CC0-1.0',
      SPDXID: 'SPDXRef-DOCUMENT',
      name: 'fixture',
      documentNamespace: 'https://example.test/sbom',
      creationInfo: {created: '2026-10-03T00:00:00Z', creators: []},
      packages: [],
      relationships: [],
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.chdir(originalCwd);
    fs.rmSync(repository, {recursive: true, force: true});
  });

  it('replaces an output symlink without modifying its target', async () => {
    const external = path.join(os.tmpdir(), `guardscan-sbom-target-${process.pid}-${Date.now()}.json`);
    const output = path.join(repository, 'sbom-spdx.json');
    try {
      fs.writeFileSync(external, 'preserve me');
      fs.symlinkSync(external, output);

      await sbomCommand({});

      expect(fs.lstatSync(output).isSymbolicLink()).toBe(false);
      expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({spdxVersion: 'SPDX-2.3'});
      expect(fs.readFileSync(external, 'utf8')).toBe('preserve me');
    } finally {
      fs.rmSync(external, {force: true});
    }
  });

  it('rejects output through a repository symlink directory', async () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-sbom-directory-'));
    try {
      fs.symlinkSync(external, path.join(repository, 'reports'), process.platform === 'win32' ? 'junction' : 'dir');
      expect(process.cwd()).toBe(repository);
      expect(() => privateState.prepareAtomicOutputTarget(
        path.join(repository, 'reports', 'sbom.json'), process.cwd()
      )).toThrow(/symlink/i);
      jest.spyOn(errorHandler, 'handleCommandError').mockImplementation(error => {throw error;});
      const prepareTarget = jest.spyOn(privateState, 'prepareAtomicOutputTarget');

      await expect(sbomCommand({output: path.join(repository, 'reports', 'sbom.json')})).rejects.toThrow(/symlink/i);

      expect(prepareTarget).toHaveBeenCalledWith(path.join(repository, 'reports', 'sbom.json'), repository);
      expect(fs.lstatSync(path.join(repository, 'reports')).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(path.join(external, 'sbom.json'))).toBe(false);
    } finally {
      fs.rmSync(external, {recursive: true, force: true});
    }
  });
});
