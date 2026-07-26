import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectPackageInventory } from '../../src/core/package-inventory';

describe('package inventory', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-inventory-'));
  });

  afterEach(() => {
    fs.rmSync(repository, { recursive: true, force: true });
  });

  it('collects exact versions across supported lock and manifest formats', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({
      dependencies: { lodash: '^4.17.0' },
      devDependencies: { jest: '^29.0.0' },
    }));
    fs.writeFileSync(path.join(repository, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { lodash: '^4.17.0' } },
        'node_modules/lodash': { version: '4.17.21' },
        'node_modules/jest': { version: '29.7.0', dev: true },
      },
    }));
    fs.writeFileSync(path.join(repository, 'requirements.txt'), 'Requests==2.31.0\n# comment\n');
    fs.writeFileSync(path.join(repository, 'go.mod'), 'module example.test/app\n\nrequire (\n example.test/lib v1.2.3\n)\n');
    fs.writeFileSync(path.join(repository, 'Cargo.lock'), '[[package]]\nname = "serde"\nversion = "1.0.203"\n');
    fs.writeFileSync(path.join(repository, 'Gemfile.lock'), 'GEM\n  specs:\n    rack (2.2.8)\n\nPLATFORMS\n');
    fs.writeFileSync(path.join(repository, 'pom.xml'), '<project><dependencies><dependency><groupId>org.example</groupId><artifactId>demo</artifactId><version>1.4.0</version></dependency></dependencies></project>');

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates.map(item => `${item.osvEcosystem}:${item.name}@${item.exactVersion}`)).toEqual(expect.arrayContaining([
      'npm:lodash@4.17.21',
      'npm:jest@29.7.0',
      'PyPI:requests@2.31.0',
      'Go:example.test/lib@v1.2.3',
      'crates.io:serde@1.0.203',
      'RubyGems:rack@2.2.8',
      'Maven:org.example:demo@1.4.0',
    ]));
    expect(inventory.coordinates.find(item => item.name === 'lodash')).toMatchObject({ direct: true, scope: 'runtime' });
    expect(inventory.coordinates.find(item => item.name === 'jest')).toMatchObject({ direct: true, scope: 'development' });
    expect(inventory.errors).toEqual([]);
    expect(inventory.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('parses best-effort pnpm and Yarn resolutions without accepting ranges', () => {
    fs.mkdirSync(path.join(repository, 'pnpm'));
    fs.writeFileSync(path.join(repository, 'pnpm', 'package.json'), '{}');
    fs.writeFileSync(path.join(repository, 'pnpm', 'pnpm-lock.yaml'), 'lockfileVersion: 9\npackages:\n  lodash@4.17.21: {}\n  "@scope/pkg@1.2.3": {}\n');
    fs.mkdirSync(path.join(repository, 'yarn'));
    fs.writeFileSync(path.join(repository, 'yarn', 'package.json'), '{}');
    fs.writeFileSync(path.join(repository, 'yarn', 'yarn.lock'), 'left-pad@^1.0.0:\n  version "1.3.0"\n');

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates.map(item => `${item.name}@${item.exactVersion}`)).toEqual(expect.arrayContaining([
      'lodash@4.17.21', '@scope/pkg@1.2.3', 'left-pad@1.3.0',
    ]));
  });

  it('reports unpinned manifest dependencies instead of querying ranges', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.17.0', chalk: '4.1.2' } }));
    fs.writeFileSync(path.join(repository, 'requirements.txt'), 'requests>=2\nflask==3.0.0\n');

    const inventory = collectPackageInventory(repository);

    expect(inventory.coordinates.map(item => item.name)).toEqual(['chalk', 'flask']);
    expect(inventory.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNRESOLVED_VERSION', message: expect.stringContaining('lodash') }),
      expect.objectContaining({ code: 'UNRESOLVED_VERSION', message: expect.stringContaining('requests') }),
    ]));
  });

  it('ignores symlinks and produces a checkout-path-independent digest', () => {
    fs.writeFileSync(path.join(repository, 'package.json'), JSON.stringify({ dependencies: { chalk: '4.1.2' } }));
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-inventory-copy-'));
    fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({ dependencies: { chalk: '4.1.2' } }));
    try {
      fs.symlinkSync(other, path.join(repository, 'external'));
      expect(collectPackageInventory(repository).digest).toBe(collectPackageInventory(other).digest);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
