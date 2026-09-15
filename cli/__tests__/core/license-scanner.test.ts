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

  it('uses only exact installed npm metadata and resolves nested lockfile-v1 packages', async () => {
    fs.mkdirSync(path.join(repository, 'node_modules', 'child'), { recursive: true });
    fs.mkdirSync(path.join(repository, 'node_modules', 'parent', 'node_modules', 'child'), { recursive: true });
    fs.writeFileSync(path.join(repository, 'node_modules', 'child', 'package.json'), JSON.stringify({
      name: 'child', version: '2.0.0', license: 'GPL-3.0',
    }));
    fs.writeFileSync(path.join(repository, 'node_modules', 'parent', 'node_modules', 'child', 'package.json'), JSON.stringify({
      name: 'child', version: '2.0.0', license: 'Apache-2.0',
    }));

    const report = await new LicenseScanner().scan(repository, 'proprietary', {
      offline: true,
      inventory: inventory(repository, [
        coordinate({
          name: 'child', exactVersion: '2.0.0',
          dependencyPaths: ['parent@1.0.0 > child@2.0.0'],
        }),
        coordinate({ name: 'child', exactVersion: '1.0.0', dependencyPaths: ['node_modules/child'] }),
      ]),
    });

    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ package: 'child', version: '2.0.0', license: 'Apache-2.0' }),
      expect.objectContaining({ package: 'child', version: '1.0.0', license: 'Unknown' }),
    ]));
  });

  it('resolves installed npm metadata relative to an independent project lockfile', async () => {
    fs.mkdirSync(path.join(repository, 'node_modules', 'fixture'), { recursive: true });
    fs.mkdirSync(path.join(repository, 'packages', 'app', 'node_modules', 'fixture'), { recursive: true });
    fs.writeFileSync(path.join(repository, 'node_modules', 'fixture', 'package.json'), JSON.stringify({
      name: 'fixture', version: '1.0.0', license: 'GPL-3.0',
    }));
    fs.writeFileSync(path.join(repository, 'packages', 'app', 'node_modules', 'fixture', 'package.json'), JSON.stringify({
      name: 'fixture', version: '1.0.0', license: 'Apache-2.0',
    }));

    const report = await new LicenseScanner().scan(repository, 'proprietary', {
      offline: true,
      inventory: inventory(repository, [coordinate({
        lockfilePath: 'packages/app/package-lock.json',
        manifestPath: 'packages/app/package.json',
        dependencyPaths: ['node_modules/fixture'],
      })]),
    });

    expect(report.findings[0]).toMatchObject({ license: 'Apache-2.0' });
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

  it('uses versioned graph paths to disambiguate duplicate npm parent versions', () => {
    const scanner = new LicenseScanner();
    const findings = [
      finding({package: 'parent', version: '1.0.0', direct: true, scope: 'runtime', dependencyPaths: ['parent@1.0.0']}),
      finding({package: 'parent', version: '2.0.0', direct: true, scope: 'development', dependencyPaths: ['parent@2.0.0']}),
      finding({package: 'child', version: '3.0.0', dependencyPaths: ['parent@1.0.0 > child@3.0.0']}),
    ];

    const document = scanner.generateSBOM(findings, 'cyclonedx', 'fixture');
    const runtimeParent = document.components.find(component => component.name === 'parent' && component.version === '1.0.0')!['bom-ref'];
    const developmentParent = document.components.find(component => component.name === 'parent' && component.version === '2.0.0')!['bom-ref'];
    const child = document.components.find(component => component.name === 'child')!['bom-ref'];

    expect(document.dependencies).toEqual(expect.arrayContaining([
      {ref: runtimeParent, dependsOn: [child]},
    ]));
    expect(document.dependencies.find(entry => entry.ref === developmentParent)?.dependsOn || []).not.toContain(child);
  });

  it('emits Cargo parent-child edges from versioned inventory graph paths', () => {
    const scanner = new LicenseScanner();
    const findings = [
      finding({source: 'cargo', package: 'parent', version: '1.0.0', direct: true, scope: 'runtime', dependencyPaths: ['parent@1.0.0']}),
      finding({source: 'cargo', package: 'child', version: '2.0.0', direct: false, scope: 'runtime', dependencyPaths: ['parent@1.0.0 > child@2.0.0']}),
    ];

    const document = scanner.generateSBOM(findings, 'cyclonedx', 'fixture');
    const root = document.metadata.component['bom-ref'];
    const parent = document.components.find(component => component.name === 'parent')!['bom-ref'];
    const child = document.components.find(component => component.name === 'child')!['bom-ref'];

    expect(document.dependencies).toEqual(expect.arrayContaining([
      {ref: root, dependsOn: [parent]},
      {ref: parent, dependsOn: [child]},
    ]));
  });

  it('emits RubyGems parent-child edges from versioned inventory graph paths', () => {
    const scanner = new LicenseScanner();
    const findings = [
      finding({source: 'rubygems', package: 'rack', version: '3.1.0', direct: true, scope: 'runtime', dependencyPaths: ['rack@3.1.0']}),
      finding({source: 'rubygems', package: 'rack-session', version: '2.1.0', direct: false, scope: 'runtime', dependencyPaths: ['rack@3.1.0 > rack-session@2.1.0']}),
    ];

    const document = scanner.generateSBOM(findings, 'cyclonedx', 'fixture');
    const root = document.metadata.component['bom-ref'];
    const parent = document.components.find(component => component.name === 'rack')!['bom-ref'];
    const child = document.components.find(component => component.name === 'rack-session')!['bom-ref'];

    expect(document.dependencies).toEqual(expect.arrayContaining([
      {ref: root, dependsOn: [parent]},
      {ref: parent, dependsOn: [child]},
    ]));
  });

  it('retains RubyGems graph edges for non-semver version forms', () => {
    const scanner = new LicenseScanner();
    const findings = [
      finding({source: 'rubygems', package: 'parent', version: '1.0.0.1', direct: true, scope: 'runtime', dependencyPaths: ['parent@1.0.0.1']}),
      finding({source: 'rubygems', package: 'child', version: '2.0.0.pre', direct: false, scope: 'runtime', dependencyPaths: ['parent@1.0.0.1 > child@2.0.0.pre']}),
    ];

    const document = scanner.generateSBOM(findings, 'cyclonedx', 'fixture');
    const parent = document.components.find(component => component.name === 'parent')!['bom-ref'];
    const child = document.components.find(component => component.name === 'child')!['bom-ref'];

    expect(document.dependencies).toEqual(expect.arrayContaining([
      {ref: parent, dependsOn: [child]},
    ]));
  });

  it('emits SPDX project, direct, and transitive dependency relationships', () => {
    const document = new LicenseScanner().generateSBOM([
      finding({source: 'npm', package: 'parent', version: '1.0.0', direct: true, dependencyPaths: ['parent@1.0.0']}),
      finding({source: 'npm', package: 'child', version: '2.0.0', direct: false, dependencyPaths: ['parent@1.0.0 > child@2.0.0']}),
    ], 'spdx', 'fixture');
    const root = document.packages.find(value => value.name === 'fixture')!;
    const parent = document.packages.find(value => value.name === 'parent')!;
    const child = document.packages.find(value => value.name === 'child')!;

    expect(document.relationships).toEqual(expect.arrayContaining([
      {spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: root.SPDXID},
      {spdxElementId: root.SPDXID, relationshipType: 'DEPENDS_ON', relatedSpdxElement: parent.SPDXID},
      {spdxElementId: parent.SPDXID, relationshipType: 'DEPENDS_ON', relatedSpdxElement: child.SPDXID},
    ]));
  });

  it('emits every retained parent edge when dependency display paths are capped', () => {
    const parents = Array.from({length: 65}, (_, index) => `parent-${index.toString().padStart(2, '0')}@1.0.0`);
    const findings = [
      ...parents.map(parent => finding({
        package: parent.slice(0, parent.lastIndexOf('@')),
        version: '1.0.0',
        direct: true,
        dependencyPaths: [parent],
      })),
      finding({
        package: 'shared',
        version: '2.0.0',
        direct: false,
        dependencyPaths: parents.slice(0, 64).map(parent => `${parent} > shared@2.0.0`),
        dependencyParents: parents,
      }),
    ];

    const cycloneDx = new LicenseScanner().generateSBOM(findings, 'cyclonedx', 'fixture');
    const spdx = new LicenseScanner().generateSBOM(findings, 'spdx', 'fixture');
    const sharedRef = cycloneDx.components.find(component => component.name === 'shared')!['bom-ref'];
    const cycloneDxParentEdges = cycloneDx.dependencies.filter(dependency => dependency.dependsOn.includes(sharedRef));
    const sharedPackage = spdx.packages.find(value => value.name === 'shared')!;
    const spdxParentEdges = spdx.relationships.filter(relationship =>
      relationship.relationshipType === 'DEPENDS_ON' && relationship.relatedSpdxElement === sharedPackage.SPDXID
    );

    expect(cycloneDxParentEdges).toHaveLength(65);
    expect(spdxParentEdges).toHaveLength(65);
  });

  it('emits Maven package URLs with namespace and artifact segments', () => {
    const scanner = new LicenseScanner();
    const document = scanner.generateSBOM([
      finding({ source: 'maven', package: 'org.example:fixture-lib' }),
    ], 'cyclonedx', 'fixture');

    expect(document.components[0].purl).toBe('pkg:maven/org.example/fixture-lib@1.0.0');
    expect(document.components[0]['bom-ref']).toBe(document.components[0].purl);
  });

  it('uses registered PURL types for pip and Go components', () => {
    const findings = [
      finding({ source: 'pip', package: 'requests' }),
      finding({ source: 'go', package: 'example.com/module' }),
    ];
    const document = new LicenseScanner().generateSBOM(findings, 'cyclonedx', 'fixture');
    const spdx = new LicenseScanner().generateSBOM(findings, 'spdx', 'fixture');

    expect(document.components.map(component => component.purl)).toEqual([
      'pkg:golang/example.com/module@1.0.0',
      'pkg:pypi/requests@1.0.0',
    ]);
    expect(spdx.packages.filter(pkg => pkg.name !== 'fixture').map(pkg => pkg.externalRefs[0].referenceLocator)).toEqual([
      'pkg:golang/example.com/module@1.0.0',
      'pkg:pypi/requests@1.0.0',
    ]);
  });

  it('represents compound SPDX expressions as CycloneDX expressions', () => {
    const document = new LicenseScanner().generateSBOM([
      finding({ package: 'compound', license: '(MIT OR Apache-2.0)' }),
      finding({ package: 'custom', license: 'Custom License' }),
      finding({ package: 'simple', license: 'MIT' }),
    ], 'cyclonedx', 'fixture');

    const compound = document.components.find(component => component.name === 'compound')!;
    const custom = document.components.find(component => component.name === 'custom')!;
    const simple = document.components.find(component => component.name === 'simple')!;
    expect(compound.licenses).toEqual([{ expression: '(MIT OR Apache-2.0)' }]);
    expect(custom.licenses).toEqual([{ license: { name: 'Custom License' } }]);
    expect(simple.licenses).toEqual([{ license: { id: 'MIT' } }]);
  });

  it('uses a named CycloneDX license for non-SPDX simple identifiers', () => {
    const document = new LicenseScanner().generateSBOM([
      finding({ package: 'npm-pseudo-license', license: 'UNLICENSED' }),
      finding({ package: 'invalid-expression', license: 'UNLICENSED OR MIT' }),
      finding({ package: 'invalid-exception', license: 'MIT WITH Apache-2.0' }),
    ], 'cyclonedx', 'fixture');

    expect(document.components.find(component => component.name === 'npm-pseudo-license')?.licenses)
      .toEqual([{ license: { name: 'UNLICENSED' } }]);
    expect(document.components.find(component => component.name === 'invalid-expression')?.licenses)
      .toEqual([{ license: { name: 'UNLICENSED OR MIT' } }]);
    expect(document.components.find(component => component.name === 'invalid-exception')?.licenses)
      .toEqual([{ license: { name: 'MIT WITH Apache-2.0' } }]);
  });

  it('generates a unique SPDX document namespace for each document', () => {
    const scanner = new LicenseScanner();
    const findings = [finding({ package: 'namespace-fixture' })];

    const first = scanner.generateSBOM(findings, 'spdx', 'fixture');
    const second = scanner.generateSBOM(findings, 'spdx', 'fixture');

    expect(first.documentNamespace).not.toBe(second.documentNamespace);
  });

  it('generates a unique CycloneDX serial number for each BOM document', () => {
    const scanner = new LicenseScanner();
    const findings = [finding({ package: 'serial-fixture' })];

    const first = scanner.generateSBOM(findings, 'cyclonedx', 'fixture');
    const second = scanner.generateSBOM(findings, 'cyclonedx', 'fixture');

    expect(first.serialNumber).not.toBe(second.serialNumber);
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
    'UNLICENSED OR MIT',
    'MIT WITH Apache-2.0',
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
