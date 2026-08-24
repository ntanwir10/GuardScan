import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { LicenseScanner } from '../../src/core/license-scanner';
import * as processRunner from '../../src/utils/process-runner';

function loadSchema(filename: string): object {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../schemas', filename), 'utf8')) as object;
}

describe('LicenseScanner offline inventory', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-license-'));
    fs.mkdirSync(path.join(repository, 'node_modules', 'left-pad'), { recursive: true });
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      dependencies: { 'left-pad': '1.3.0' },
    }));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      name: 'fixture',
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '1.0.0', dependencies: { 'left-pad': '1.3.0' } },
        'node_modules/left-pad': { version: '1.3.0' },
      },
    }));
    fs.writeFileSync(path.join(repository, 'node_modules', 'left-pad', 'package.json'), JSON.stringify({
      name: 'left-pad',
      version: '1.3.0',
      license: 'WTFPL',
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(repository, { recursive: true, force: true });
  });

  it('builds a non-empty SBOM from local lockfiles without running network-backed tools', async () => {
    const scanner = new LicenseScanner();
    const report = await scanner.scan(repository, 'proprietary', { offline: true });
    const sbom = scanner.generateSBOM(report.findings, 'spdx', 'fixture');

    expect(report.totalDependencies).toBe(1);
    expect(report.findings[0]).toMatchObject({
      package: 'left-pad',
      version: '1.3.0',
      license: 'WTFPL',
      source: 'npm',
    });
    expect(sbom).toMatchObject({
      spdxVersion: 'SPDX-2.3',
      dataLicense: 'CC0-1.0',
      SPDXID: 'SPDXRef-DOCUMENT',
      name: 'fixture',
    });
    expect(sbom.packages).toEqual([
      expect.objectContaining({
        name: 'left-pad',
        versionInfo: '1.3.0',
        licenseDeclared: 'WTFPL',
      }),
    ]);
    expect(sbom.relationships).toEqual([
      expect.objectContaining({
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
      }),
    ]);
  });

  it('does not execute ecosystem tools merely because GuardScan is online', async () => {
    const run = jest.spyOn(processRunner, 'runProcess');

    await new LicenseScanner().scan(repository, 'proprietary', {offline: false});

    expect(run).not.toHaveBeenCalled();
  });

  it('uses installed-only npx behavior after explicit project-code approval', async () => {
    const run = jest.spyOn(processRunner, 'runProcess').mockReturnValue({
      command: 'npx',
      args: [],
      status: 0,
      stdout: JSON.stringify({'left-pad@1.3.0': {licenses: 'WTFPL'}}),
      stderr: '',
      signal: null,
      timedOut: false,
    });

    await new LicenseScanner().scan(repository, 'proprietary', {
      offline: false,
      runProjectCode: true,
      networkIsolation: true,
    });

    expect(run).toHaveBeenCalledWith(
      'npx',
      ['--no-install', 'license-checker', '--json'],
      expect.objectContaining({networkIsolation: true})
    );
  });

  it('emits distinct SPDX 2.3 and CycloneDX 1.7 document contracts', () => {
    const scanner = new LicenseScanner();
    const findings = [{
      package: '@scope/example',
      version: '1.2.3',
      license: 'MIT',
      category: 'permissive' as const,
      risk: 'low' as const,
      description: 'fixture',
      source: 'npm' as const,
    }];

    const spdx = scanner.generateSBOM(findings, 'spdx', 'fixture');
    const cyclonedx = scanner.generateSBOM(findings, 'cyclonedx', 'fixture');

    expect(spdx).toMatchObject({
      spdxVersion: 'SPDX-2.3',
      documentNamespace: expect.stringMatching(/^https:\/\/guardscancli\.com\/spdx\/fixture\//),
      creationInfo: { creators: [expect.stringMatching(/^Tool: GuardScan-/)] },
    });
    expect(spdx.packages[0].externalRefs[0]).toMatchObject({
      referenceType: 'purl',
      referenceLocator: 'pkg:npm/%40scope/example@1.2.3',
    });

    expect(cyclonedx).toMatchObject({
      $schema: 'https://cyclonedx.org/schema/bom-1.7.schema.json',
      bomFormat: 'CycloneDX',
      specVersion: '1.7',
      version: 1,
      serialNumber: expect.stringMatching(/^urn:uuid:/),
      metadata: {
        component: { type: 'application', name: 'fixture' },
      },
    });
    expect(cyclonedx.components[0]).toMatchObject({
      type: 'library',
      name: '@scope/example',
      version: '1.2.3',
      purl: 'pkg:npm/%40scope/example@1.2.3',
    });
    expect(cyclonedx.dependencies[0].dependsOn).toEqual([
      cyclonedx.components[0]['bom-ref'],
    ]);
  });

  it('validates generated documents against the official SPDX and CycloneDX schemas', () => {
    const scanner = new LicenseScanner();
    const findings = [{
      package: '@scope/example',
      version: '1.2.3',
      license: 'MIT',
      category: 'permissive' as const,
      risk: 'low' as const,
      description: 'fixture',
      source: 'npm' as const,
    }];
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    ajv.addFormat('iri-reference', true);
    ajv.addFormat('idn-email', true);
    ajv.addSchema(loadSchema('spdx.schema.json'), 'spdx.schema.json');
    ajv.addSchema(loadSchema('jsf-0.82.schema.json'), 'jsf-0.82.schema.json');
    ajv.addSchema(loadSchema('cryptography-defs.schema.json'), 'cryptography-defs.schema.json');
    const validateSpdx = ajv.compile(loadSchema('spdx-2.3.schema.json'));
    const validateCycloneDx = ajv.compile(loadSchema('cyclonedx-1.7.schema.json'));

    const spdx = scanner.generateSBOM(findings, 'spdx', 'fixture');
    const cyclonedx = scanner.generateSBOM(findings, 'cyclonedx', 'fixture');

    expect(validateSpdx(spdx)).toBe(true);
    expect(validateSpdx.errors).toBeNull();
    expect(validateCycloneDx(cyclonedx)).toBe(true);
    expect(validateCycloneDx.errors).toBeNull();
  });
});
