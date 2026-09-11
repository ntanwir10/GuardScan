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
    expect(inventory.errors).toEqual([
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/transitive|direct-only/i)}),
    ]);
  });

  it('handles cycles between Python requirement includes once', () => {
    fs.writeFileSync(path.join(repository, 'requirements.txt'), '-r requirements/base.txt\nroot==1.0.0\n');
    fs.mkdirSync(path.join(repository, 'requirements'));
    fs.writeFileSync(path.join(repository, 'requirements/base.txt'), '-r ../requirements.txt\nbase==2.0.0\n');

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates.map(coordinate => coordinate.name)).toEqual(['base', 'root']);
    expect(inventory.errors).toEqual([
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/transitive|direct-only/i)}),
    ]);
  });

  (process.platform === 'win32' ? it.skip : it)('rejects Python requirement symlinks that escape the repository', () => {
    fs.writeFileSync(path.join(repository, 'requirements.txt'), '-r requirements/external.txt\n');
    fs.mkdirSync(path.join(repository, 'requirements'));
    fs.symlinkSync('/etc/hosts', path.join(repository, 'requirements/external.txt'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([]);
    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'requirements.txt',
        code: 'UNSUPPORTED_FORMAT',
        message: expect.stringMatching(/cannot be resolved within the repository/i),
      }),
      expect.objectContaining({message: expect.stringMatching(/direct-only|transitive/i)}),
    ]));
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

  it('rejects non-registry npm lock sources while retaining registry tarballs', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: {registry: '1.0.0', tarball: '1.0.0', gitdep: '1.0.0'},
    }));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      name: 'fixture', lockfileVersion: 3,
      packages: {
        '': {dependencies: {registry: '1.0.0', tarball: '1.0.0', gitdep: '1.0.0'}},
        'node_modules/registry': {name: 'registry', version: '1.0.0', resolved: 'https://registry.npmjs.org/registry/-/registry-1.0.0.tgz'},
        'node_modules/tarball': {name: 'tarball', version: '1.0.0', resolved: 'https://downloads.example.test/tarball-1.0.0.tgz'},
        'node_modules/gitdep': {name: 'gitdep', version: '1.0.0', resolved: 'git+https://github.com/example/gitdep.git#abc'},
        'node_modules/filedep': {name: 'filedep', version: '1.0.0', resolved: 'file:../filedep'},
      },
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates.map(coordinate => coordinate.name)).toEqual(['registry']);
    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({file: 'package-lock.json', code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/tarball|non-registry|unsupported source/i)}),
      expect.objectContaining({file: 'package-lock.json', code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/gitdep|non-registry/i)}),
      expect.objectContaining({file: 'package-lock.json', code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/filedep|non-registry/i)}),
    ]));
  });

  it('rejects non-registry sources in npm lockfile v1 dependencies', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({dependencies: {gitdep: '1.0.0'}}));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      name: 'fixture', lockfileVersion: 1,
      dependencies: {
        gitdep: {version: '1.0.0', resolved: 'git+https://github.com/example/gitdep.git#abc'},
      },
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([]);
    expect(inventory.errors).toEqual([
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/gitdep|non-registry/i)}),
    ]);
  });

  it('retains exact lockless package coordinates but marks transitive coverage incomplete', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: {exact: '1.2.3'}, devDependencies: {devexact: '=2.3.4'},
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'exact', exactVersion: '1.2.3', direct: true, scope: 'runtime'}),
      expect.objectContaining({name: 'devexact', exactVersion: '2.3.4', direct: true, scope: 'development'}),
    ]));
    expect(inventory.errors).toEqual([
      expect.objectContaining({file: 'package.json', code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/transitive|lock/i)}),
    ]);
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

  it('uses the root Yarn lock for child workspaces without lockless errors or duplicate coordinates', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      name: 'root', workspaces: ['packages/*'], dependencies: {rootdep: '^1.0.0'},
    }));
    fs.mkdirSync(path.join(repository, 'packages/app'), {recursive: true});
    fs.writeFileSync(path.join(repository, 'packages/app/package.json'), JSON.stringify({
      name: 'app', dependencies: {workspaceDep: '^2.0.0'}, devDependencies: {workspaceTool: '^3.0.0'},
    }));
    fs.writeFileSync(path.join(repository, 'yarn.lock'), [
      'rootdep@^1.0.0:',
      '  version "1.2.0"',
      '  resolved "https://registry.yarnpkg.com/rootdep/-/rootdep-1.2.0.tgz#abc"',
      'workspaceDep@^2.0.0:',
      '  version "2.1.0"',
      '  resolved "https://registry.yarnpkg.com/workspaceDep/-/workspaceDep-2.1.0.tgz#def"',
      'workspaceTool@^3.0.0:',
      '  version "3.1.0"',
      '  resolved "https://registry.yarnpkg.com/workspaceTool/-/workspaceTool-3.1.0.tgz#ghi"',
      '"app@workspace:packages/app":',
      '  version: 0.0.0-use.local',
      '  resolution: "app@workspace:packages/app"',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'rootdep', exactVersion: '1.2.0', direct: true, scope: 'runtime', manifestPath: 'package.json'}),
      expect.objectContaining({name: 'workspaceDep', exactVersion: '2.1.0', direct: true, scope: 'runtime', manifestPath: 'packages/app/package.json'}),
      expect.objectContaining({name: 'workspaceTool', exactVersion: '3.1.0', direct: true, scope: 'development', manifestPath: 'packages/app/package.json'}),
    ]));
    expect(inventory.coordinates.some(coordinate => coordinate.name === 'app')).toBe(false);
    expect(inventory.coordinates.filter(coordinate => coordinate.name === 'workspaceDep')).toHaveLength(1);
    expect(inventory.errors).toEqual([]);
  });

  it('reports unsupported Yarn sources without emitting registry coordinates', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: {
        registry: '^1.0.0',
        gitdep: '^1.0.0',
        filedep: '^1.0.0',
        archivedep: '^1.0.0',
        berrygit: 'git+https://github.com/example/berrygit.git',
      },
    }));
    fs.writeFileSync(path.join(repository, 'yarn.lock'), [
      'registry@^1.0.0:',
      '  version "1.2.0"',
      '  resolved "https://registry.yarnpkg.com/registry/-/registry-1.2.0.tgz#abc"',
      'gitdep@^1.0.0:',
      '  version "1.2.0"',
      '  resolved "git+https://github.com/example/gitdep.git#abc"',
      'filedep@^1.0.0:',
      '  version "1.2.0"',
      '  resolved "file:../filedep"',
      'archivedep@^1.0.0:',
      '  version "1.2.0"',
      '  resolved "https://downloads.example.test/archivedep-1.2.0.tgz"',
      '"berrygit@git+https://github.com/example/berrygit.git":',
      '  version: 1.2.0',
      '  resolution: "berrygit@git+https://github.com/example/berrygit.git#commit=abc"',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates.map(coordinate => coordinate.name)).toEqual(['registry']);
    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/gitdep|unsupported source/i)}),
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/filedep|unsupported source/i)}),
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/archivedep|unsupported source/i)}),
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/berrygit|unsupported source/i)}),
    ]));
  });

  it('reports unsupported direct pnpm importer resolutions', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({name: 'root'}));
    fs.writeFileSync(path.join(repository, 'pnpm-lock.yaml'), [
      'lockfileVersion: 9.0',
      'importers:',
      '  .:',
      '    dependencies:',
      '      registry:',
      '        specifier: ^1.0.0',
      '        version: 1.2.0',
      '      gitdep:',
      '        specifier: git+https://github.com/example/gitdep.git',
      '        version: git+https://github.com/example/gitdep.git#abc',
      '      filedep:',
      '        specifier: file:../filedep',
      '        version: file:../filedep',
      '      urldep:',
      '        specifier: https://example.test/urldep.tgz',
      '        version: https://example.test/urldep.tgz',
      'packages:',
      '  registry@1.2.0: {}',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'registry', exactVersion: '1.2.0', direct: true}),
    ]));
    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/gitdep|unsupported/i)}),
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/filedep|unsupported/i)}),
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/urldep|unsupported/i)}),
    ]));
  });

  it('preserves deterministic transitive dependency paths for pnpm and Yarn cycles', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({dependencies: {parent: '^1.0.0'}}));
    fs.writeFileSync(path.join(repository, 'pnpm-lock.yaml'), [
      'lockfileVersion: 9.0',
      'importers:',
      '  .:',
      '    dependencies:',
      '      parent:',
      '        specifier: ^1.0.0',
      '        version: 1.0.0',
      'packages:',
      '  parent@1.0.0:',
      '    dependencies:',
      '      child: 2.0.0',
      '  child@2.0.0:',
      '    dependencies:',
      '      parent: 1.0.0',
      'snapshots:',
      '  parent@1.0.0:',
      '    dependencies:',
      '      child: 2.0.0',
      '  child@2.0.0:',
      '    dependencies:',
      '      parent: 1.0.0',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'parent', dependencyPaths: expect.arrayContaining([
        'parent@1.0.0',
        'parent@1.0.0 > child@2.0.0 > parent@1.0.0',
      ])}),
      expect.objectContaining({name: 'child', dependencyPaths: expect.arrayContaining([
        'parent@1.0.0 > child@2.0.0',
      ])}),
    ]));
    expect(inventory.coordinates.find(coordinate => coordinate.name === 'parent')?.dependencyPaths).toEqual([
      'parent@1.0.0', 'parent@1.0.0 > child@2.0.0 > parent@1.0.0',
    ]);
  });

  it('preserves Yarn classic dependency paths through transitive records', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({dependencies: {parent: '^1.0.0'}}));
    fs.writeFileSync(path.join(repository, 'yarn.lock'), [
      'parent@^1.0.0:',
      '  version "1.0.0"',
      '  resolved "https://registry.yarnpkg.com/parent/-/parent-1.0.0.tgz"',
      '  dependencies:',
      '    child "^2.0.0"',
      'child@^2.0.0:',
      '  version "2.0.0"',
      '  resolved "https://registry.yarnpkg.com/child/-/child-2.0.0.tgz"',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'parent', dependencyPaths: ['parent']}),
      expect.objectContaining({name: 'child', dependencyPaths: ['parent > child']}),
    ]));
  });

  it('matches quoted scoped Yarn Berry dependencies to the requested version', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({dependencies: {parent: '^1.0.0'}}));
    fs.writeFileSync(path.join(repository, 'yarn.lock'), [
      '__metadata:',
      '  version: 8',
      '"parent@npm:^1.0.0":',
      '  version: 1.0.0',
      '  resolution: "parent@npm:1.0.0"',
      '  dependencies:',
      '    "@scope/child": "npm:^2.0.0"',
      '"@scope/child@npm:^1.0.0":',
      '  version: 1.5.0',
      '  resolution: "@scope/child@npm:1.5.0"',
      '"@scope/child@npm:^2.0.0":',
      '  version: 2.5.0',
      '  resolution: "@scope/child@npm:2.5.0"',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates.find(coordinate => coordinate.name === '@scope/child' && coordinate.exactVersion === '1.5.0')?.dependencyPaths)
      .toEqual(['@scope/child']);
    expect(inventory.coordinates.find(coordinate => coordinate.name === '@scope/child' && coordinate.exactVersion === '2.5.0')?.dependencyPaths)
      .toEqual(['parent > @scope/child']);
  });

  it('uses the registry package identity for Yarn aliases', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: {foo: 'npm:lodash@^4.17.0'},
    }));
    fs.writeFileSync(path.join(repository, 'yarn.lock'), [
      '"foo@npm:lodash@^4.17.0":',
      '  version: 4.17.21',
      '  resolution: "foo@npm:lodash@4.17.21"',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([
      expect.objectContaining({name: 'lodash', exactVersion: '4.17.21', direct: true}),
    ]);
    expect(inventory.coordinates.some(coordinate => coordinate.name === 'foo')).toBe(false);
    expect(inventory.errors).toEqual([]);
  });

  it('keeps pnpm graph versions and propagates root scopes to transitives', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: {runtimeRoot: '1.0.0'},
      devDependencies: {devRoot: '1.0.0'},
    }));
    fs.writeFileSync(path.join(repository, 'pnpm-lock.yaml'), [
      'lockfileVersion: 9.0',
      'importers:',
      '  .:',
      '    dependencies:',
      '      runtimeRoot:',
      '        specifier: 1.0.0',
      '        version: 1.0.0',
      '    devDependencies:',
      '      devRoot:',
      '        specifier: 1.0.0',
      '        version: 1.0.0',
      'snapshots:',
      '  runtimeRoot@1.0.0:',
      '    dependencies:',
      '      parent: 1.0.0',
      '  devRoot@1.0.0:',
      '    dependencies:',
      '      parent: 2.0.0',
      '      devOnly: 3.0.0',
      '  parent@1.0.0:',
      '    dependencies:',
      '      shared: 4.0.0',
      '  parent@2.0.0:',
      '    dependencies:',
      '      shared: 4.0.0',
      '  devOnly@3.0.0: {}',
      '  shared@4.0.0: {}',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);
    const coordinate = (name: string, version: string) => inventory.coordinates.find(candidate =>
      candidate.name === name && candidate.exactVersion === version
    );

    expect(coordinate('parent', '1.0.0')).toMatchObject({
      scope: 'runtime', dependencyPaths: ['runtimeRoot@1.0.0 > parent@1.0.0'],
    });
    expect(coordinate('parent', '2.0.0')).toMatchObject({
      scope: 'development', dependencyPaths: ['devRoot@1.0.0 > parent@2.0.0'],
    });
    expect(coordinate('devOnly', '3.0.0')).toMatchObject({scope: 'development'});
    expect(coordinate('shared', '4.0.0')).toMatchObject({
      scope: 'runtime',
      dependencyPaths: [
        'devRoot@1.0.0 > parent@2.0.0 > shared@4.0.0',
        'runtimeRoot@1.0.0 > parent@1.0.0 > shared@4.0.0',
      ],
    });
  });

  it('marks plain pinned requirements as direct-only inventory', () => {
    fs.writeFileSync(path.join(repository, 'requirements.txt'), 'requests==2.31.0\n');

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([expect.objectContaining({name: 'requests', direct: true})]);
    expect(inventory.errors).toEqual([
      expect.objectContaining({file: 'requirements.txt', code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/transitive|direct-only/i)}),
    ]);
  });

  it('reports Cargo and Gemfile manifests without covering locks', () => {
    fs.writeFileSync(path.join(repository, 'Cargo.toml'), '[package]\nname = "fixture"\nversion = "1.0.0"\n');
    fs.writeFileSync(path.join(repository, 'Gemfile'), "source 'https://rubygems.org'\ngem 'rack'\n");

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([]);
    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({file: 'Cargo.toml', code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/lock/i)}),
      expect.objectContaining({file: 'Gemfile', code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/lock/i)}),
    ]));
  });

  it('does not let unrelated ancestor locks suppress nested Cargo or Bundler manifests', () => {
    fs.writeFileSync(path.join(repository, 'Cargo.toml'), '[package]\nname = "root"\nversion = "1.0.0"\n');
    fs.writeFileSync(path.join(repository, 'Cargo.lock'), 'version = 3\n');
    fs.writeFileSync(path.join(repository, 'Gemfile.lock'), 'GEM\n  specs:\n');
    fs.mkdirSync(path.join(repository, 'services/worker'), {recursive: true});
    fs.writeFileSync(path.join(repository, 'services/worker/Cargo.toml'), '[package]\nname = "worker"\nversion = "1.0.0"\n');
    fs.writeFileSync(path.join(repository, 'services/worker/Gemfile'), "source 'https://rubygems.org'\ngem 'rack'\n");

    const inventory = collectPackageInventory(repository);

    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({file: 'services/worker/Cargo.toml', message: expect.stringMatching(/lock|workspace/i)}),
      expect.objectContaining({file: 'services/worker/Gemfile', message: expect.stringMatching(/adjacent|lock/i)}),
    ]));
  });

  it('accepts an ancestor Cargo lock only for declared workspace members', () => {
    fs.writeFileSync(path.join(repository, 'Cargo.toml'), '[workspace]\nmembers = ["crates/*"]\n');
    fs.writeFileSync(path.join(repository, 'Cargo.lock'), 'version = 3\n');
    fs.mkdirSync(path.join(repository, 'crates/member'), {recursive: true});
    fs.writeFileSync(path.join(repository, 'crates/member/Cargo.toml'), '[package]\nname = "member"\nversion = "1.0.0"\n');

    const inventory = collectPackageInventory(repository);

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

  it('strips a declared Bundler platform suffix from gem versions', () => {
    fs.writeFileSync(path.join(repository, 'Gemfile.lock'), [
      'GEM',
      '  remote: https://rubygems.org/',
      '  specs:',
      '    nokogiri (1.18.10-x86_64-linux-gnu)',
      '',
      'PLATFORMS',
      '  x86_64-linux-gnu',
      '',
      'DEPENDENCIES',
      '  nokogiri',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([
      expect.objectContaining({name: 'nokogiri', exactVersion: '1.18.10'}),
    ]);
    expect(inventory.errors).toEqual([]);
  });

  it('marks Go module inventories before graph pruning as incomplete', () => {
    fs.writeFileSync(path.join(repository, 'go.mod'), [
      'module example.test/legacy',
      'go 1.16',
      'require example.test/direct v1.2.3',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([
      expect.objectContaining({name: 'example.test/direct', exactVersion: 'v1.2.3'}),
    ]);
    expect(inventory.errors).toEqual([
      expect.objectContaining({
        file: 'go.mod',
        code: 'UNSUPPORTED_FORMAT',
        message: expect.stringMatching(/1\.17|transitive|build list/i),
      }),
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
    expect(inventory.errors).toEqual([
      expect.objectContaining({code: 'UNSUPPORTED_FORMAT', message: expect.stringMatching(/transitive|lock/i)}),
    ]);
  });
});
