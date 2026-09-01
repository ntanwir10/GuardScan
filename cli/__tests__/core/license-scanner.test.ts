import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LicenseFinding, LicenseScanner } from '../../src/core/license-scanner';
import { DependencyCoordinate, PackageInventory } from '../../src/core/package-inventory';
import {
  ScanEngine,
  ScanEngineOptions,
  ScannerTask,
  ScannerTaskOutput,
} from '../../src/core/scan-engine';

function coordinate(overrides: Partial<DependencyCoordinate>): DependencyCoordinate {
  return {
    ecosystem: 'npm',
    osvEcosystem: 'npm',
    name: 'fixture',
    exactVersion: '1.0.0',
    scope: 'unknown',
    direct: false,
    manifestPath: 'package.json',
    lockfilePath: 'package-lock.json',
    dependencyPaths: ['node_modules/fixture'],
    ...overrides,
  };
}

function inventory(repository: string, coordinates: DependencyCoordinate[]): PackageInventory {
  return {
    repository,
    coordinates,
    manifests: ['package-lock.json', 'package.json'],
    errors: [],
    digest: 'fixture-digest',
  };
}

function finding(overrides: Partial<LicenseFinding>): LicenseFinding {
  return {
    package: 'fixture',
    version: '1.0.0',
    license: 'MIT',
    category: 'permissive',
    risk: 'info',
    description: 'fixture',
    source: 'npm',
    ...overrides,
  };
}

describe('LicenseScanner inventory and SBOM contracts', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-license-'));
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
  });

  it('surfaces package inventory errors in the license report', async () => {
    const packageInventory = inventory(repository, []);
    packageInventory.errors.push({
      file: 'requirements.txt',
      code: 'UNRESOLVED_VERSION',
      message: 'dependency is not pinned',
    });

    const report = await new LicenseScanner().scan(repository, 'proprietary', {
      offline: true,
      inventory: packageInventory,
    });

    expect(report.inventoryErrors).toEqual(packageInventory.errors);
  });

  it('promotes merged duplicate coordinates to runtime and direct', async () => {
    const report = await new LicenseScanner().scan(repository, 'proprietary', {
      offline: true,
      inventory: inventory(repository, [
        coordinate({ scope: 'development', direct: false }),
        coordinate({ scope: 'runtime', direct: true }),
      ]),
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ scope: 'runtime', direct: true });
  });

  it('emits known npm parent-child edges without promoting transitives to root dependencies', async () => {
    const scanner = new LicenseScanner();
    const report = await scanner.scan(repository, 'proprietary', {
      offline: true,
      inventory: inventory(repository, [
        coordinate({
          name: 'parent',
          direct: true,
          scope: 'runtime',
          dependencyPaths: ['node_modules/parent'],
        }),
        coordinate({
          name: 'child',
          exactVersion: '2.0.0',
          dependencyPaths: ['node_modules/parent/node_modules/child'],
        }),
      ]),
    });

    const document = scanner.generateSBOM(report.findings, 'cyclonedx', 'fixture');
    const rootRef = document.metadata.component['bom-ref'];
    const parentRef = document.components.find(component => component.name === 'parent')!['bom-ref'];
    const childRef = document.components.find(component => component.name === 'child')!['bom-ref'];

    expect(document.dependencies).toEqual(expect.arrayContaining([
      { ref: rootRef, dependsOn: [parentRef] },
      { ref: parentRef, dependsOn: [childRef] },
    ]));
    expect(document.dependencies.find(entry => entry.ref === rootRef)?.dependsOn).not.toContain(childRef);
  });

  it('emits Maven package URLs with namespace and artifact segments', () => {
    const scanner = new LicenseScanner();
    const document = scanner.generateSBOM([
      finding({ source: 'maven', package: 'org.example:fixture-lib' }),
    ], 'cyclonedx', 'fixture');

    expect(document.components[0].purl).toBe('pkg:maven/org.example/fixture-lib@1.0.0');
    expect(document.components[0]['bom-ref']).toBe(document.components[0].purl);
  });

  it.each([
    '(MIT OR Apache-2.0)',
    'GPL-2.0-only WITH Classpath-exception-2.0',
  ])('preserves valid SPDX expression %s', expression => {
    const document = new LicenseScanner().generateSBOM([
      finding({ license: expression }),
    ], 'spdx', 'fixture');

    expect(document.packages[0].licenseDeclared).toBe(expression);
    expect(document.packages[0].licenseConcluded).toBe(expression);
  });

  it.each([
    'MIT OR',
    '(MIT OR Apache-2.0',
    'MIT WITH',
    'MIT / Apache-2.0',
  ])('rejects malformed SPDX expression %s', expression => {
    const document = new LicenseScanner().generateSBOM([
      finding({ license: expression }),
    ], 'spdx', 'fixture');

    expect(document.packages[0].licenseDeclared).toBe('NOASSERTION');
    expect(document.packages[0].licenseConcluded).toBe('NOASSERTION');
  });

  it('marks license scanner coverage incomplete when package inventory has errors', async () => {
    const scanner = new LicenseScanner();
    const packageInventory = inventory(repository, []);
    packageInventory.errors.push({
      file: 'requirements.txt',
      code: 'UNRESOLVED_VERSION',
      message: 'dependency is not pinned',
    });
    const report = await scanner.scan(repository, 'proprietary', {
      offline: true,
      inventory: packageInventory,
    });
    type BuiltInTaskFactory = {
      createBuiltInTasks(
        options: ScanEngineOptions,
        repoPath: string,
        files: Array<{path: string}>,
        offline: boolean
      ): ScannerTask[];
    };
    const tasks = (new ScanEngine() as unknown as BuiltInTaskFactory).createBuiltInTasks(
      {
        includeLicenses: true,
        includeVulnerabilities: false,
        licenseReport: report,
      },
      repository,
      [],
      true
    );

    const output = await tasks.find(task => task.scanner === 'licenses')!.run() as ScannerTaskOutput;

    expect(output.error).toMatchObject({ code: 'LICENSE_INVENTORY_PARTIAL' });
  });
});
