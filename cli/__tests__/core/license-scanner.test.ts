import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LicenseScanner } from '../../src/core/license-scanner';
import { DependencyCoordinate, PackageInventory } from '../../src/core/package-inventory';

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
});
