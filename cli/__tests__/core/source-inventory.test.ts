import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {LicenseFinding, LicenseScanner} from '../../src/core/license-scanner';
import {collectPackageInventory} from '../../src/core/package-inventory';

describe('source inventory review regressions', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-source-inventory-'));
  });

  afterEach(() => {
    fs.rmSync(repository, {recursive: true, force: true});
  });

  it('resolves local Maven properties and managed versions but reports unresolved versions', () => {
    fs.writeFileSync(path.join(repository, 'pom.xml'), `
      <project>
        <properties>
          <revision>2.3.4</revision>
          <managed.version>\${revision}</managed.version>
        </properties>
        <dependencyManagement><dependencies>
          <dependency><groupId>org.example</groupId><artifactId>managed</artifactId><version>\${managed.version}</version></dependency>
        </dependencies></dependencyManagement>
        <dependencies>
          <dependency><groupId>org.example</groupId><artifactId>managed</artifactId></dependency>
          <dependency><groupId>org.example</groupId><artifactId>local</artifactId><version>\${revision}</version></dependency>
          <dependency><groupId>org.example</groupId><artifactId>missing-property</artifactId><version>\${unknown.version}</version></dependency>
          <dependency><groupId>org.example</groupId><artifactId>missing-managed</artifactId></dependency>
        </dependencies>
      </project>
    `);

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'org.example:managed', exactVersion: '2.3.4'}),
      expect.objectContaining({name: 'org.example:local', exactVersion: '2.3.4'}),
    ]));
    expect(inventory.coordinates.map(coordinate => coordinate.name)).toHaveLength(2);
    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'UNRESOLVED_VERSION', message: expect.stringContaining('org.example:missing-property')}),
      expect.objectContaining({code: 'UNRESOLVED_VERSION', message: expect.stringContaining('org.example:missing-managed')}),
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/direct-POM-only/)}),
    ]));
  });

  it('keeps CycloneDX development components excluded and out of root dependencies', () => {
    const finding = (packageName: string, scope: LicenseFinding['scope'], direct: boolean): LicenseFinding => ({
      package: packageName,
      version: '1.0.0',
      scope,
      direct,
      license: 'MIT',
      category: 'permissive',
      risk: 'info',
      description: 'fixture',
      source: 'npm',
    });
    const document = new LicenseScanner().generateSBOM([
      finding('runtime', 'runtime', true),
      finding('optional', 'optional', true),
      finding('development', 'development', true),
      finding('transitive', 'runtime', false),
    ], 'cyclonedx', 'fixture');
    const component = (name: string) => document.components.find(value => value.name === name)!;
    const root = document.dependencies.find(value => value.ref === document.metadata.component['bom-ref'])!;

    expect(component('runtime').scope).toBe('required');
    expect(component('optional').scope).toBe('optional');
    expect(component('development').scope).toBe('excluded');
    expect(root.dependsOn).toEqual([component('optional')['bom-ref'], component('runtime')['bom-ref']]);
    expect(root.dependsOn).not.toContain(component('development')['bom-ref']);
    expect(root.dependsOn).not.toContain(component('transitive')['bom-ref']);
  });
});
