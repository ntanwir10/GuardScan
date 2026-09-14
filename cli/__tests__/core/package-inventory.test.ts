import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectPackageInventory, filterPackageInventory } from '../../src/core/package-inventory';

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

  it('resolves npm aliases by install name while retaining the registry identity', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: {foo: 'npm:lodash@^4.17.0'},
    }));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      name: 'fixture', lockfileVersion: 3,
      packages: {
        '': {dependencies: {foo: 'npm:lodash@^4.17.0'}},
        'node_modules/foo': {name: 'lodash', version: '4.17.21'},
      },
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([
      expect.objectContaining({
        name: 'lodash', exactVersion: '4.17.21', direct: true, scope: 'runtime',
        dependencyPaths: ['lodash@4.17.21'],
      }),
    ]);
    expect(inventory.errors).toEqual([]);
  });

  it('reconstructs hoisted npm dependency paths from package-lock dependency edges', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({dependencies: {parent: '1.0.0'}}));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      name: 'fixture', lockfileVersion: 3,
      packages: {
        '': {dependencies: {parent: '1.0.0'}},
        'node_modules/parent': {name: 'parent', version: '1.0.0', dependencies: {child: '^2.0.0'}},
        'node_modules/child': {name: 'child', version: '2.1.0'},
      },
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates.find(coordinate => coordinate.name === 'child')).toMatchObject({
      direct: false,
      scope: 'runtime',
      dependencyPaths: ['parent@1.0.0 > child@2.1.0'],
    });
    expect(inventory.errors).toEqual([]);
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

  it('skips first-party npm workspace links without accepting external links', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      name: 'root', workspaces: ['packages/*'],
    }));
    fs.mkdirSync(path.join(repository, 'packages/app'), {recursive: true});
    fs.writeFileSync(path.join(repository, 'packages/app/package.json'), JSON.stringify({
      name: '@fixture/app', dependencies: {registry: '^1.0.0'},
    }));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      name: 'root', lockfileVersion: 3,
      packages: {
        '': {name: 'root', workspaces: ['packages/*']},
        'packages/app': {name: '@fixture/app', version: '1.0.0', dependencies: {registry: '^1.0.0'}},
        'node_modules/@fixture/app': {resolved: 'packages/app', link: true},
        'node_modules/registry': {name: 'registry', version: '1.2.0'},
        'node_modules/external': {resolved: '../external', link: true},
      },
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([
      expect.objectContaining({name: 'registry', exactVersion: '1.2.0', direct: true}),
    ]);
    expect(inventory.errors).toEqual([
      expect.objectContaining({
        file: 'package-lock.json',
        code: 'UNSUPPORTED_FORMAT',
        message: expect.stringMatching(/external|link/i),
      }),
    ]);
  });

  it('reports npm lock entries with missing or malformed versions', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({name: 'root'}));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      name: 'root', lockfileVersion: 3,
      packages: {
        '': {name: 'root'},
        'node_modules/missing': {name: 'missing'},
        'node_modules/malformed': {name: 'malformed', version: 'not-semver'},
      },
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([]);
    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'UNRESOLVED_VERSION', message: expect.stringMatching(/missing/)}),
      expect.objectContaining({code: 'UNRESOLVED_VERSION', message: expect.stringMatching(/malformed/)}),
    ]));
  });

  it('reports malformed versions in npm v1 dependency trees', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({dependencies: {parent: '1.0.0'}}));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      name: 'root', lockfileVersion: 1,
      dependencies: {
        parent: {
          version: '1.0.0',
          dependencies: {child: {version: 'not-semver'}},
        },
      },
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([
      expect.objectContaining({name: 'parent', exactVersion: '1.0.0'}),
    ]);
    expect(inventory.errors).toEqual([
      expect.objectContaining({code: 'UNRESOLVED_VERSION', message: expect.stringMatching(/parent > child/)}),
    ]);
  });

  it('versions every npm v1 dependency path hop when package versions repeat', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: {left: '1.0.0', right: '1.0.0'},
    }));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      name: 'root', lockfileVersion: 1,
      dependencies: {
        left: {version: '1.0.0', dependencies: {
          parent: {version: '1.0.0', dependencies: {child: {version: '1.0.0'}}},
        }},
        right: {version: '1.0.0', dependencies: {
          parent: {version: '2.0.0', dependencies: {child: {version: '2.0.0'}}},
        }},
      },
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates.find(value => value.name === 'child' && value.exactVersion === '1.0.0')?.dependencyPaths)
      .toEqual(['left@1.0.0 > parent@1.0.0 > child@1.0.0']);
    expect(inventory.coordinates.find(value => value.name === 'child' && value.exactVersion === '2.0.0')?.dependencyPaths)
      .toEqual(['right@1.0.0 > parent@2.0.0 > child@2.0.0']);
    expect(inventory.errors).toEqual([]);
  });

  it('reports stale direct requirements covered by npm, Yarn, and pnpm locks', () => {
    const fixtures = ['npm', 'yarn', 'pnpm'];
    for (const fixture of fixtures) {
      const directory = path.join(repository, fixture);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({dependencies: {stale: '^2.0.0'}}));
    }
    fs.writeFileSync(path.join(repository, 'npm/package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {'': {dependencies: {stale: '^1.0.0'}}, 'node_modules/stale': {version: '1.0.0'}},
    }));
    fs.writeFileSync(path.join(repository, 'yarn/yarn.lock'), [
      'stale@^1.0.0:',
      '  version "1.0.0"',
    ].join('\n'));
    fs.writeFileSync(path.join(repository, 'pnpm/pnpm-lock.yaml'), [
      'lockfileVersion: 9.0',
      'importers:',
      '  .:',
      '    dependencies:',
      '      stale:',
      '        specifier: ^1.0.0',
      '        version: 1.0.0',
      'packages:',
      '  stale@1.0.0: {}',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.errors).toEqual(expect.arrayContaining(fixtures.map(fixture =>
      expect.objectContaining({
        file: `${fixture}/package.json`,
        code: 'UNRESOLVED_VERSION',
        message: expect.stringMatching(/stale|lock/i),
      })
    )));
  });

  it('accepts shared hoisted resolutions referenced by multiple npm and pnpm workspaces', () => {
    for (const manager of ['npm', 'pnpm']) {
      const managerRoot = path.join(repository, manager);
      fs.mkdirSync(path.join(managerRoot, 'packages/a'), {recursive: true});
      fs.mkdirSync(path.join(managerRoot, 'packages/b'), {recursive: true});
      fs.writeFileSync(path.join(managerRoot, 'package.json'), JSON.stringify({
        name: `${manager}-root`, workspaces: ['packages/*'],
      }));
      for (const workspace of ['a', 'b']) {
        fs.writeFileSync(path.join(managerRoot, `packages/${workspace}/package.json`), JSON.stringify({
          name: `${manager}-${workspace}`, dependencies: {shared: '^1.0.0'},
        }));
      }
    }
    fs.writeFileSync(path.join(repository, 'npm/package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {workspaces: ['packages/*']},
        'packages/a': {dependencies: {shared: '^1.0.0'}},
        'packages/b': {dependencies: {shared: '^1.0.0'}},
        'node_modules/shared': {version: '1.2.0'},
      },
    }));
    fs.writeFileSync(path.join(repository, 'pnpm/pnpm-lock.yaml'), [
      'lockfileVersion: 9.0',
      'importers:',
      '  .: {}',
      '  packages/a:',
      '    dependencies:',
      '      shared:',
      '        specifier: ^1.0.0',
      '        version: 1.2.0',
      '  packages/b:',
      '    dependencies:',
      '      shared:',
      '        specifier: ^1.0.0',
      '        version: 1.2.0',
      'packages:',
      '  shared@1.2.0: {}',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates.filter(value => value.name === 'shared')).toHaveLength(2);
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

  it('validates every workspace manifest sharing one Yarn resolution', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      name: 'root', workspaces: ['packages/*'],
    }));
    for (const workspace of ['app', 'worker']) {
      const directory = path.join(repository, 'packages', workspace);
      fs.mkdirSync(directory, {recursive: true});
      fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
        name: workspace,
        dependencies: {shared: '^1.0.0'},
      }));
    }
    fs.writeFileSync(path.join(repository, 'yarn.lock'), [
      'shared@^1.0.0:',
      '  version "1.2.0"',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([
      expect.objectContaining({name: 'shared', exactVersion: '1.2.0', direct: true}),
    ]);
    expect(inventory.errors).toEqual([]);
  });

  it('does not require registry coordinates for first-party workspace dependencies', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      name: 'root', workspaces: ['packages/*'],
    }));
    fs.mkdirSync(path.join(repository, 'packages/app'), {recursive: true});
    fs.mkdirSync(path.join(repository, 'packages/library'), {recursive: true});
    fs.writeFileSync(path.join(repository, 'packages/app/package.json'), JSON.stringify({
      name: 'app', dependencies: {'@fixture/library': 'workspace:*'},
    }));
    fs.writeFileSync(path.join(repository, 'packages/library/package.json'), JSON.stringify({
      name: '@fixture/library', version: '1.0.0',
    }));
    fs.writeFileSync(path.join(repository, 'yarn.lock'), [
      '"@fixture/library@workspace:packages/library":',
      '  version: 0.0.0-use.local',
      '  resolution: "@fixture/library@workspace:packages/library"',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([]);
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

  it('skips validated first-party pnpm workspace links but rejects external links', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      name: 'root', workspaces: ['packages/*'],
    }));
    fs.mkdirSync(path.join(repository, 'packages/app'), {recursive: true});
    fs.mkdirSync(path.join(repository, 'packages/library'), {recursive: true});
    fs.writeFileSync(path.join(repository, 'packages/app/package.json'), JSON.stringify({
      name: '@fixture/app',
      dependencies: {'@fixture/library': 'workspace:*', external: 'workspace:*'},
    }));
    fs.writeFileSync(path.join(repository, 'packages/library/package.json'), JSON.stringify({
      name: '@fixture/library', version: '1.0.0',
    }));
    fs.writeFileSync(path.join(repository, 'pnpm-lock.yaml'), [
      'lockfileVersion: 9.0',
      'importers:',
      '  .: {}',
      '  packages/app:',
      '    dependencies:',
      '      "@fixture/library":',
      '        specifier: workspace:*',
      '        version: link:../library',
      '      external:',
      '        specifier: workspace:*',
      '        version: link:../../../external',
      '  packages/library: {}',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([]);
    expect(inventory.errors).toEqual([
      expect.objectContaining({
        file: 'pnpm-lock.yaml',
        code: 'UNSUPPORTED_FORMAT',
        message: expect.stringMatching(/external|workspace|link/i),
      }),
    ]);
  });

  it('reports reachable pnpm dependencies whose package record is missing', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({dependencies: {parent: '1.0.0'}}));
    fs.writeFileSync(path.join(repository, 'pnpm-lock.yaml'), [
      'lockfileVersion: 9.0',
      'importers:',
      '  .:',
      '    dependencies:',
      '      parent:',
      '        specifier: 1.0.0',
      '        version: 1.0.0',
      'snapshots:',
      '  parent@1.0.0:',
      '    dependencies:',
      '      missing-child: 2.0.0',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([
      expect.objectContaining({name: 'parent', exactVersion: '1.0.0'}),
    ]);
    expect(inventory.errors).toEqual([
      expect.objectContaining({
        file: 'pnpm-lock.yaml',
        code: 'INVALID_MANIFEST',
        message: expect.stringMatching(/missing-child@2\.0\.0|missing.*record/i),
        scope: 'runtime',
      }),
    ]);
  });

  it('resolves pnpm registry aliases to their target package identity', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: {foo: 'npm:lodash@^4.17.0', parent: '1.0.0'},
    }));
    fs.writeFileSync(path.join(repository, 'pnpm-lock.yaml'), [
      'lockfileVersion: 9.0',
      'importers:',
      '  .:',
      '    dependencies:',
      '      foo:',
      '        specifier: npm:lodash@^4.17.0',
      '        version: lodash@4.17.21',
      '      parent:',
      '        specifier: 1.0.0',
      '        version: 1.0.0',
      'packages:',
      '  lodash@4.17.21: {}',
      '  parent@1.0.0: {}',
      'snapshots:',
      '  lodash@4.17.21: {}',
      '  parent@1.0.0:',
      '    dependencies:',
      '      transitiveAlias: lodash@4.17.21',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'lodash', exactVersion: '4.17.21', direct: true,
        dependencyPaths: ['lodash@4.17.21', 'parent@1.0.0 > lodash@4.17.21'],
      }),
      expect.objectContaining({name: 'parent', exactVersion: '1.0.0', direct: true}),
    ]));
    expect(inventory.errors).toEqual([]);
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
      expect.objectContaining({name: 'parent', dependencyPaths: ['parent@1.0.0']}),
      expect.objectContaining({name: 'child', dependencyPaths: ['parent@1.0.0 > child@2.0.0']}),
    ]));
  });

  it('preserves Yarn parent versions and propagates direct scopes through transitive records', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: {runtimeRoot: '1.0.0'},
      devDependencies: {devRoot: '1.0.0'},
    }));
    fs.writeFileSync(path.join(repository, 'yarn.lock'), [
      'runtimeRoot@1.0.0:',
      '  version "1.0.0"',
      '  dependencies:',
      '    parent "1.0.0"',
      'devRoot@1.0.0:',
      '  version "1.0.0"',
      '  dependencies:',
      '    parent "2.0.0"',
      'parent@1.0.0:',
      '  version "1.0.0"',
      '  dependencies:',
      '    shared "3.0.0"',
      'parent@2.0.0:',
      '  version "2.0.0"',
      '  dependencies:',
      '    shared "3.0.0"',
      'shared@3.0.0:',
      '  version "3.0.0"',
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
    expect(coordinate('shared', '3.0.0')).toMatchObject({
      scope: 'runtime',
      dependencyPaths: [
        'devRoot@1.0.0 > parent@2.0.0 > shared@3.0.0',
        'runtimeRoot@1.0.0 > parent@1.0.0 > shared@3.0.0',
      ],
    });
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
      .toEqual(['@scope/child@1.5.0']);
    expect(inventory.coordinates.find(coordinate => coordinate.name === '@scope/child' && coordinate.exactVersion === '2.5.0')?.dependencyPaths)
      .toEqual(['parent@1.0.0 > @scope/child@2.5.0']);
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

  it('rejects go.mod files without a Go directive because they default to the incomplete Go 1.16 graph', () => {
    fs.writeFileSync(path.join(repository, 'go.mod'), [
      'module example.test/fixture',
      'require example.test/dependency v1.2.3',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.errors).toEqual([
      expect.objectContaining({
        file: 'go.mod',
        code: 'UNSUPPORTED_FORMAT',
        message: expect.stringMatching(/Go directive|1\.16|1\.17/i),
      }),
    ]);
  });

  it('propagates Cargo runtime and development roots through the locked dependency graph', () => {
    fs.writeFileSync(path.join(repository, 'Cargo.toml'), [
      '[package]',
      'name = "fixture"',
      'version = "0.1.0"',
      '[dependencies]',
      'runtime-root = "1.0.0"',
      '[dev-dependencies]',
      'dev-root = "2.0.0"',
    ].join('\n'));
    fs.writeFileSync(path.join(repository, 'Cargo.lock'), [
      'version = 3',
      '[[package]]',
      'name = "fixture"',
      'version = "0.1.0"',
      'dependencies = [',
      ' "dev-root",',
      ' "runtime-root",',
      ']',
      '[[package]]',
      'name = "runtime-root"',
      'version = "1.0.0"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
      'dependencies = ["shared 3.0.0"]',
      '[[package]]',
      'name = "dev-root"',
      'version = "2.0.0"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
      'dependencies = ["dev-only 4.0.0", "shared 3.0.0"]',
      '[[package]]',
      'name = "shared"',
      'version = "3.0.0"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
      '[[package]]',
      'name = "dev-only"',
      'version = "4.0.0"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);
    const coordinate = (name: string) => inventory.coordinates.find(candidate => candidate.name === name);

    expect(coordinate('runtime-root')).toMatchObject({direct: true, scope: 'runtime'});
    expect(coordinate('dev-root')).toMatchObject({direct: true, scope: 'development'});
    expect(coordinate('dev-only')).toMatchObject({
      direct: false,
      scope: 'development',
      dependencyPaths: ['dev-root@2.0.0 > dev-only@4.0.0'],
    });
    expect(coordinate('shared')).toMatchObject({
      scope: 'runtime',
      dependencyPaths: [
        'dev-root@2.0.0 > shared@3.0.0',
        'runtime-root@1.0.0 > shared@3.0.0',
      ],
    });
    expect(filterPackageInventory(inventory, {scope: 'runtime'}).coordinates.map(value => value.name))
      .toEqual(['runtime-root', 'shared']);
    expect(inventory.errors).toEqual([]);
  });

  it('filters development-only inventory errors from runtime scope', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      devDependencies: {devtool: '^2.0.0'},
    }));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {devDependencies: {devtool: '^1.0.0'}},
        'node_modules/devtool': {version: '1.0.0', dev: true},
      },
    }));

    const inventory = collectPackageInventory(repository);

    expect(inventory.errors).toEqual([
      expect.objectContaining({
        file: 'package.json',
        code: 'UNRESOLVED_VERSION',
        scope: 'development',
      }),
    ]);
    expect(filterPackageInventory(inventory, {scope: 'runtime'}).errors).toEqual([]);
  });

  it('tags errors from recursively included Python requirement files', () => {
    fs.writeFileSync(path.join(repository, 'requirements.txt'), '-r requirements/base.txt\n');
    fs.mkdirSync(path.join(repository, 'requirements'));
    fs.writeFileSync(path.join(repository, 'requirements/base.txt'), 'requests>=2.31.0\n');

    const inventory = collectPackageInventory(repository);

    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'requirements/base.txt',
        code: 'UNRESOLVED_VERSION',
        ecosystem: 'pip',
      }),
    ]));
    expect(filterPackageInventory(inventory, {ecosystems: ['npm']}).errors).toEqual([]);
  });

  it('reports malformed Cargo package blocks instead of silently omitting them', () => {
    fs.writeFileSync(path.join(repository, 'Cargo.lock'), [
      'version = 3',
      '[[package]]',
      'version = "1.0.0"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
      '[[package]]',
      'name = "missing-version"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.errors).toEqual([
      expect.objectContaining({file: 'Cargo.lock', code: 'INVALID_MANIFEST', message: expect.stringMatching(/package block 1.*name/i)}),
      expect.objectContaining({file: 'Cargo.lock', code: 'INVALID_MANIFEST', message: expect.stringMatching(/package block 2.*version/i)}),
    ]);
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

  it('does not treat commented Cargo workspace members as active', () => {
    fs.writeFileSync(path.join(repository, 'Cargo.toml'), [
      '[workspace]',
      'members = [',
      '  "crates/member",',
      '  # "services/worker",',
      ']',
    ].join('\n'));
    fs.writeFileSync(path.join(repository, 'Cargo.lock'), 'version = 3\n');
    fs.mkdirSync(path.join(repository, 'crates/member'), {recursive: true});
    fs.writeFileSync(path.join(repository, 'crates/member/Cargo.toml'), '[package]\nname = "member"\nversion = "1.0.0"\n');
    fs.mkdirSync(path.join(repository, 'services/worker'), {recursive: true});
    fs.writeFileSync(path.join(repository, 'services/worker/Cargo.toml'), '[package]\nname = "worker"\nversion = "1.0.0"\n');

    const inventory = collectPackageInventory(repository);

    expect(inventory.errors).toEqual([
      expect.objectContaining({
        file: 'services/worker/Cargo.toml',
        code: 'UNSUPPORTED_FORMAT',
        message: expect.stringMatching(/lock|workspace/i),
      }),
    ]);
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

  it('derives Bundler direct dependencies, scopes, and transitive graph paths', () => {
    fs.writeFileSync(path.join(repository, 'Gemfile'), [
      "source 'https://rubygems.org'",
      "gem 'rack', '~> 3.0'",
      'group :development, :test do',
      "  gem 'rspec'",
      'end',
    ].join('\n'));
    fs.writeFileSync(path.join(repository, 'Gemfile.lock'), [
      'GEM',
      '  remote: https://rubygems.org/',
      '  specs:',
      '    rack (3.1.0)',
      '      rack-session (>= 2.0.0)',
      '    rack-session (2.1.0)',
      '    rspec (3.13.0)',
      '',
      'DEPENDENCIES',
      '  rack (~> 3.0)',
      '  rspec',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'rack', direct: true, scope: 'runtime', dependencyPaths: ['rack@3.1.0']}),
      expect.objectContaining({name: 'rack-session', direct: false, scope: 'runtime', dependencyPaths: ['rack@3.1.0 > rack-session@2.1.0']}),
      expect.objectContaining({name: 'rspec', direct: true, scope: 'development', dependencyPaths: ['rspec@3.13.0']}),
    ]));
    expect(inventory.errors).toEqual([]);
  });

  it('preserves a Bundler group scope across nested non-group blocks', () => {
    fs.writeFileSync(path.join(repository, 'Gemfile'), [
      "source 'https://rubygems.org'",
      'group :development, :test do',
      '  platforms :ruby do',
      "    gem 'inner-dev'",
      '  end',
      "  gem 'after-inner-dev'",
      'end',
    ].join('\n'));
    fs.writeFileSync(path.join(repository, 'Gemfile.lock'), [
      'GEM',
      '  remote: https://rubygems.org/',
      '  specs:',
      '    after-inner-dev (1.0.0)',
      '    inner-dev (1.0.0)',
      '',
      'DEPENDENCIES',
      '  after-inner-dev',
      '  inner-dev',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual(expect.arrayContaining([
      expect.objectContaining({name: 'inner-dev', scope: 'development'}),
      expect.objectContaining({name: 'after-inner-dev', scope: 'development'}),
    ]));
    expect(filterPackageInventory(inventory, {scope: 'runtime'}).coordinates).toEqual([]);
    expect(inventory.errors).toEqual([]);
  });

  it('preserves Maven optional and non-runtime scopes', () => {
    const dependency = (artifact: string, extra = '') => [
      '<dependency>',
      '  <groupId>org.example</groupId>',
      `  <artifactId>${artifact}</artifactId>`,
      '  <version>1.0.0</version>',
      extra,
      '</dependency>',
    ].filter(Boolean).join('\n');
    fs.writeFileSync(path.join(repository, 'pom.xml'), [
      '<project><dependencies>',
      dependency('required'),
      dependency('optional', '<optional>true</optional>'),
      dependency('provided', '<scope>provided</scope>'),
      dependency('system', '<scope>system</scope>'),
      dependency('test-only', '<scope>test</scope>'),
      '</dependencies></project>',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);
    const scope = (artifact: string) => inventory.coordinates.find(
      coordinate => coordinate.name === `org.example:${artifact}`
    )?.scope;

    expect(scope('required')).toBe('runtime');
    expect(scope('optional')).toBe('optional');
    expect(scope('provided')).toBe('development');
    expect(scope('system')).toBe('development');
    expect(scope('test-only')).toBe('development');
  });

  it('reports Gemfile requirements that are absent or stale in the adjacent lock', () => {
    fs.writeFileSync(path.join(repository, 'Gemfile'), [
      "source 'https://rubygems.org'",
      "gem 'rack', '~> 4.0'",
      "gem 'new-gem'",
    ].join('\n'));
    fs.writeFileSync(path.join(repository, 'Gemfile.lock'), [
      'GEM',
      '  remote: https://rubygems.org/',
      '  specs:',
      '    rack (3.1.0)',
      '',
      'DEPENDENCIES',
      '  rack (~> 3.0)',
    ].join('\n'));

    const inventory = collectPackageInventory(repository);

    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({file: 'Gemfile', code: 'UNRESOLVED_VERSION', message: expect.stringMatching(/rack.*~> 4\.0/i)}),
      expect.objectContaining({file: 'Gemfile', code: 'UNRESOLVED_VERSION', message: expect.stringMatching(/new-gem/i)}),
    ]));
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

  it('marks a Maven parent model incomplete even without local dependencies', () => {
    fs.writeFileSync(path.join(repository, 'pom.xml'), `
      <project>
        <parent>
          <groupId>org.example</groupId>
          <artifactId>shared-parent</artifactId>
          <version>1.0.0</version>
        </parent>
        <artifactId>child</artifactId>
      </project>
    `);

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates).toEqual([]);
    expect(inventory.errors).toEqual([
      expect.objectContaining({
        file: 'pom.xml',
        ecosystem: 'maven',
        code: 'UNSUPPORTED_FORMAT',
        message: expect.stringMatching(/parent|effective-model/i),
        scope: 'runtime',
      }),
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
