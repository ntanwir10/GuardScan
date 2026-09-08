import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectPackageInventory } from '../../src/core/package-inventory';

describe('collectPackageInventory', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-inventory-'));
  });

  afterEach(() => fs.rmSync(repository, {recursive: true, force: true}));

  it('follows relative Python requirement includes', () => {
    fs.writeFileSync(path.join(repository, 'requirements.txt'), '-r requirements/base.txt\n');
    fs.mkdirSync(path.join(repository, 'requirements'));
    fs.writeFileSync(path.join(repository, 'requirements/base.txt'), 'requests==2.31.0\n');

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([
      expect.objectContaining({ecosystem: 'pip', name: 'requests', exactVersion: '2.31.0'}),
    ]);
    expect(inventory.errors).toEqual([]);
  });

  it('handles cycles between Python requirement includes once', () => {
    fs.writeFileSync(path.join(repository, 'requirements.txt'), '-r requirements/base.txt\nroot==1.0.0\n');
    fs.mkdirSync(path.join(repository, 'requirements'));
    fs.writeFileSync(path.join(repository, 'requirements/base.txt'), '-r ../requirements.txt\nbase==2.0.0\n');

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates.map(coordinate => coordinate.name)).toEqual(['base', 'root']);
    expect(inventory.errors).toEqual([]);
  });

  (process.platform === 'win32' ? it.skip : it)('rejects Python requirement symlinks that escape the repository', () => {
    fs.writeFileSync(path.join(repository, 'requirements.txt'), '-r requirements/external.txt\n');
    fs.mkdirSync(path.join(repository, 'requirements'));
    fs.symlinkSync('/etc/hosts', path.join(repository, 'requirements/external.txt'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([]);
    expect(inventory.errors).toEqual([
      expect.objectContaining({
        file: 'requirements.txt',
        code: 'UNSUPPORTED_FORMAT',
        message: expect.stringMatching(/cannot be resolved within the repository/i),
      }),
    ]);
  });

  it('does not mark nested npm lock entries as direct', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: {foo: '^1.0.0'},
    }));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      name: 'fixture', lockfileVersion: 3,
      packages: {
        '': {dependencies: {foo: '^1.0.0'}},
        'node_modules/foo': {name: 'foo', version: '1.0.0'},
        'node_modules/bar': {name: 'bar', version: '1.0.0'},
        'node_modules/bar/node_modules/foo': {name: 'foo', version: '2.0.0'},
      },
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'foo', exactVersion: '1.0.0', direct: true}),
      expect.objectContaining({name: 'foo', exactVersion: '2.0.0', direct: false, scope: 'runtime'}),
    ]));
  });

  it('marks npm workspace dependencies direct whether hoisted or workspace-nested', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({name: 'root'}));
    fs.mkdirSync(path.join(repository, 'packages/app'), {recursive: true});
    fs.writeFileSync(path.join(repository, 'packages/app/package.json'), JSON.stringify({
      name: 'app', dependencies: {foo: '^1.0.0', hoisted: '^3.0.0'}, devDependencies: {devtool: '^2.0.0'},
    }));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      name: 'root', lockfileVersion: 3,
      packages: {
        '': {name: 'root', workspaces: ['packages/app']},
        'packages/app': {name: 'app', version: '1.0.0', dependencies: {foo: '^1.0.0', hoisted: '^3.0.0'}, devDependencies: {devtool: '^2.0.0'}},
        'node_modules/foo': {name: 'foo', version: '2.0.0'},
        'node_modules/hoisted': {name: 'hoisted', version: '3.0.0'},
        'packages/app/node_modules/foo': {name: 'foo', version: '1.0.0'},
        'packages/app/node_modules/devtool': {name: 'devtool', version: '2.0.0', dev: true},
      },
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'foo', exactVersion: '1.0.0', direct: true, scope: 'runtime', manifestPath: 'packages/app/package.json'}),
      expect.objectContaining({name: 'foo', exactVersion: '2.0.0', direct: false}),
      expect.objectContaining({name: 'hoisted', exactVersion: '3.0.0', direct: true, scope: 'runtime', manifestPath: 'packages/app/package.json'}),
      expect.objectContaining({name: 'devtool', exactVersion: '2.0.0', direct: true, scope: 'development', manifestPath: 'packages/app/package.json'}),
    ]));
    expect(inventory.coordinates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'app'}),
    ]));
    expect(inventory.errors).toEqual([]);
  });

  it('keeps only GEM specs and reports GIT and PATH coverage as incomplete', () => {
    fs.writeFileSync(path.join(repository, 'Gemfile.lock'), `
GIT
  remote: https://example.test/gitgem.git
  revision: abc
  specs:
    gitgem (1.0.0)

PATH
  remote: gems/localgem
  specs:
    localgem (2.0.0)

GEM
  remote: https://rubygems.org/
  specs:
    registrygem (3.0.0)
`);

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([
      expect.objectContaining({ecosystem: 'ruby', name: 'registrygem', exactVersion: '3.0.0'}),
    ]);
    expect(inventory.errors).toEqual([
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/GIT/i)}),
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/PATH/i)}),
    ]);
  });

  it('ignores Maven build plugins, profiles, and comments', () => {
    fs.writeFileSync(path.join(repository, 'pom.xml'), `
      <project>
        <dependencies>
          <dependency><groupId>org.example</groupId><artifactId>runtime</artifactId><version>1.0.0</version></dependency>
        </dependencies>
        <build><plugins><plugin><dependencies>
          <dependency><groupId>org.example</groupId><artifactId>plugin-only</artifactId><version>9.0.0</version></dependency>
        </dependencies></plugin></plugins></build>
        <profiles><profile><dependencies>
          <dependency><groupId>org.example</groupId><artifactId>profile-only</artifactId><version>8.0.0</version></dependency>
        </dependencies></profile></profiles>
        <!-- <dependency><groupId>org.example</groupId><artifactId>comment-only</artifactId><version>7.0.0</version></dependency> -->
      </project>
    `);

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates.map(coordinate => coordinate.name)).toEqual(['org.example:runtime']);
    expect(inventory.errors).toEqual([
      expect.objectContaining({
        file: 'pom.xml',
        ecosystem: 'maven',
        code: 'UNSUPPORTED_FORMAT',
        message: expect.stringMatching(/effective-model resolution/i),
      }),
      expect.objectContaining({
        file: 'pom.xml',
        ecosystem: 'maven',
        code: 'UNSUPPORTED_FORMAT',
        message: expect.stringMatching(/direct-POM-only/i),
      }),
    ]);
  });

  it('marks direct-only Maven inventory as transitively incomplete', () => {
    fs.writeFileSync(path.join(repository, 'pom.xml'), `
      <project><dependencies>
        <dependency><groupId>org.example</groupId><artifactId>runtime</artifactId><version>1.0.0</version></dependency>
      </dependencies></project>
    `);

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([
      expect.objectContaining({name: 'org.example:runtime', exactVersion: '1.0.0'}),
    ]);
    expect(inventory.errors).toEqual([
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/direct-POM-only/i)}),
    ]);
  });

  it('does not let an unrelated ancestor lockfile suppress a nested manifest', () => {
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      name: 'root', lockfileVersion: 3, packages: {'': {name: 'root'}},
    }));
    fs.mkdirSync(path.join(repository, 'examples/tool'), {recursive: true});
    fs.writeFileSync(path.join(repository, 'examples/tool/package.json'), JSON.stringify({
      name: 'tool', dependencies: {nested: '1.2.3'},
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([
      expect.objectContaining({name: 'nested', exactVersion: '1.2.3', manifestPath: 'examples/tool/package.json'}),
    ]);
    expect(inventory.errors).toEqual([]);
  });
});
