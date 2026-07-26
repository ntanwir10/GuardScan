import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import semver from 'semver';

export type PackageEcosystem = 'npm' | 'pip' | 'go' | 'ruby' | 'cargo' | 'maven';
export type DependencyScope = 'runtime' | 'development' | 'optional' | 'unknown';

export interface DependencyCoordinate {
  ecosystem: PackageEcosystem;
  osvEcosystem: 'npm' | 'PyPI' | 'Go' | 'RubyGems' | 'crates.io' | 'Maven';
  name: string;
  exactVersion: string;
  scope: DependencyScope;
  direct: boolean;
  manifestPath: string;
  lockfilePath: string;
  dependencyPaths: string[];
}

export interface PackageInventoryError {
  file: string;
  code: 'INVALID_MANIFEST' | 'UNRESOLVED_VERSION' | 'UNSUPPORTED_FORMAT';
  message: string;
}

export interface PackageInventory {
  repository: string;
  coordinates: DependencyCoordinate[];
  manifests: string[];
  errors: PackageInventoryError[];
  digest: string;
}

export interface PackageInventoryFilter {
  ecosystems?: PackageEcosystem[];
  scope?: 'all' | 'runtime';
}

const TARGET_FILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'requirements.txt',
  'go.mod',
  'Cargo.lock',
  'Gemfile.lock',
  'pom.xml',
]);

const IGNORED_DIRS = new Set([
  '.git', '.guardscan', 'node_modules', 'vendor', 'dist', 'build', 'coverage',
  '.venv', 'venv', 'target',
]);

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/') || '.';
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function findInventoryFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED_DIRS.has(entry.name)) {continue;}
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {continue;}
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && TARGET_FILES.has(entry.name)) {
        files.push(absolute);
      }
    }
  };
  visit(root);
  return files.sort();
}

function addCoordinate(target: DependencyCoordinate[], coordinate: DependencyCoordinate): void {
  if (!coordinate.name || !coordinate.exactVersion) {return;}
  target.push({
    ...coordinate,
    name: coordinate.ecosystem === 'pip' ? coordinate.name.toLowerCase().replace(/[-_.]+/g, '-') : coordinate.name,
    dependencyPaths: [...new Set(coordinate.dependencyPaths)].sort(),
  });
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function npmDirectDependencies(directory: string): Map<string, DependencyScope> {
  const result = new Map<string, DependencyScope>();
  const manifest = path.join(directory, 'package.json');
  if (!fs.existsSync(manifest)) {return result;}
  try {
    const data = readJson(manifest);
    for (const name of Object.keys(data.dependencies || {})) {result.set(name, 'runtime');}
    for (const name of Object.keys(data.devDependencies || {})) {result.set(name, 'development');}
    for (const name of Object.keys(data.optionalDependencies || {})) {result.set(name, 'optional');}
  } catch {
    // The lockfile parser reports the actionable error when it is malformed.
  }
  return result;
}

function packageNameFromNodeModulesPath(packagePath: string): string | undefined {
  const match = packagePath.replace(/\\/g, '/').match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/);
  return match?.[1];
}

function parseNpmLock(
  root: string,
  file: string,
  coordinates: DependencyCoordinate[],
  errors: PackageInventoryError[]
): void {
  const rel = relative(root, file);
  const manifest = relative(root, path.join(path.dirname(file), 'package.json'));
  try {
    const data = readJson(file);
    const direct = npmDirectDependencies(path.dirname(file));
    if (data.packages && typeof data.packages === 'object') {
      for (const [packagePath, value] of Object.entries<any>(data.packages)) {
        if (!packagePath) {continue;}
        const name = value?.name || packageNameFromNodeModulesPath(packagePath);
        const version = typeof value?.version === 'string' ? value.version : '';
        if (!name || !semver.valid(version, { loose: true })) {continue;}
        const directScope = direct.get(name);
        addCoordinate(coordinates, {
          ecosystem: 'npm', osvEcosystem: 'npm', name, exactVersion: version,
          scope: value.optional ? 'optional' : value.dev ? 'development' : directScope || 'runtime',
          direct: directScope !== undefined,
          manifestPath: manifest, lockfilePath: rel, dependencyPaths: [packagePath.replace(/\\/g, '/')],
        });
      }
      return;
    }

    if (!data.dependencies || typeof data.dependencies !== 'object') {
      errors.push({ file: rel, code: 'UNSUPPORTED_FORMAT', message: 'npm lockfile does not contain packages or dependencies' });
      return;
    }
    const walk = (dependencies: Record<string, any>, chain: string[]): void => {
      for (const [name, value] of Object.entries<any>(dependencies)) {
        const version = typeof value?.version === 'string' ? value.version : '';
        const directScope = chain.length === 0 ? direct.get(name) : undefined;
        if (semver.valid(version, { loose: true })) {
          addCoordinate(coordinates, {
            ecosystem: 'npm', osvEcosystem: 'npm', name, exactVersion: version,
            scope: value.optional ? 'optional' : value.dev ? 'development' : directScope || 'runtime',
            direct: chain.length === 0,
            manifestPath: manifest, lockfilePath: rel, dependencyPaths: [[...chain, name].join(' > ')],
          });
        }
        if (value?.dependencies && typeof value.dependencies === 'object') {
          walk(value.dependencies, [...chain, name]);
        }
      }
    };
    walk(data.dependencies, []);
  } catch (error: any) {
    errors.push({ file: rel, code: 'INVALID_MANIFEST', message: `Unable to parse npm lockfile: ${error?.message || error}` });
  }
}

function parseExactPackageJson(
  root: string,
  file: string,
  coordinates: DependencyCoordinate[],
  errors: PackageInventoryError[]
): void {
  const directory = path.dirname(file);
  let lockDirectory = directory;
  while (isWithinRoot(root, lockDirectory)) {
    if (fs.existsSync(path.join(lockDirectory, 'package-lock.json')) ||
        fs.existsSync(path.join(lockDirectory, 'npm-shrinkwrap.json')) ||
        fs.existsSync(path.join(lockDirectory, 'pnpm-lock.yaml')) ||
        fs.existsSync(path.join(lockDirectory, 'yarn.lock'))) {return;}
    if (lockDirectory === root) {break;}
    lockDirectory = path.dirname(lockDirectory);
  }
  const rel = relative(root, file);
  try {
    const data = readJson(file);
    const groups: Array<[Record<string, string>, DependencyScope]> = [
      [data.dependencies || {}, 'runtime'],
      [data.devDependencies || {}, 'development'],
      [data.optionalDependencies || {}, 'optional'],
    ];
    for (const [dependencies, scope] of groups) {
      for (const [name, requested] of Object.entries(dependencies)) {
        const version = semver.valid(String(requested).replace(/^=/, ''), { loose: true });
        if (!version) {
          errors.push({ file: rel, code: 'UNRESOLVED_VERSION', message: `${name} is not pinned to an exact npm version` });
          continue;
        }
        addCoordinate(coordinates, {
          ecosystem: 'npm', osvEcosystem: 'npm', name, exactVersion: version,
          scope, direct: true, manifestPath: rel, lockfilePath: rel, dependencyPaths: [name],
        });
      }
    }
  } catch (error: any) {
    errors.push({ file: rel, code: 'INVALID_MANIFEST', message: `Unable to parse package.json: ${error?.message || error}` });
  }
}

function parsePnpmLock(root: string, file: string, coordinates: DependencyCoordinate[], errors: PackageInventoryError[]): void {
  const rel = relative(root, file);
  try {
    const data = yaml.load(fs.readFileSync(file, 'utf8')) as any;
    const records = { ...(data?.packages || {}), ...(data?.snapshots || {}) };
    for (const rawKey of Object.keys(records)) {
      const key = rawKey.replace(/^\//, '').split('(')[0];
      let match = key.match(/^(@[^/]+\/[^@/]+)@([^/]+)$/) || key.match(/^(@[^/]+\/[^/]+)\/([^/]+)$/);
      if (!match) {match = key.match(/^([^@/][^@]*?)@([^/]+)$/) || key.match(/^([^@/][^/]*)\/([^/]+)$/);}
      if (!match || !semver.valid(match[2], { loose: true })) {continue;}
      addCoordinate(coordinates, {
        ecosystem: 'npm', osvEcosystem: 'npm', name: match[1], exactVersion: match[2],
        scope: 'unknown', direct: false, manifestPath: relative(root, path.join(path.dirname(file), 'package.json')),
        lockfilePath: rel, dependencyPaths: [rawKey],
      });
    }
  } catch (error: any) {
    errors.push({ file: rel, code: 'INVALID_MANIFEST', message: `Unable to parse pnpm lockfile: ${error?.message || error}` });
  }
}

function parseYarnLock(root: string, file: string, coordinates: DependencyCoordinate[], errors: PackageInventoryError[]): void {
  const rel = relative(root, file);
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let packageName: string | undefined;
    for (const line of lines) {
      if (line && !/^\s/.test(line) && line.endsWith(':')) {
        const descriptor = line.slice(0, -1).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
        const scoped = descriptor.match(/^(@[^/]+\/[^@]+)@/);
        const plain = descriptor.match(/^([^@]+)@/);
        packageName = scoped?.[1] || plain?.[1];
      } else if (packageName) {
        const versionMatch = line.match(/^\s+version\s+["']?([^"'\s]+)["']?/);
        if (versionMatch && semver.valid(versionMatch[1], { loose: true })) {
          addCoordinate(coordinates, {
            ecosystem: 'npm', osvEcosystem: 'npm', name: packageName, exactVersion: versionMatch[1],
            scope: 'unknown', direct: false, manifestPath: relative(root, path.join(path.dirname(file), 'package.json')),
            lockfilePath: rel, dependencyPaths: [packageName],
          });
          packageName = undefined;
        }
      }
    }
  } catch (error: any) {
    errors.push({ file: rel, code: 'INVALID_MANIFEST', message: `Unable to parse yarn lockfile: ${error?.message || error}` });
  }
}

function parseRequirements(root: string, file: string, coordinates: DependencyCoordinate[], errors: PackageInventoryError[]): void {
  const rel = relative(root, file);
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) {continue;}
    const match = line.match(/^([A-Za-z0-9_.-]+)==([^;\s\\]+)(?:\s|;|$)/);
    if (!match) {
      errors.push({ file: rel, code: 'UNRESOLVED_VERSION', message: `Python requirement is not pinned: ${line.slice(0, 120)}` });
      continue;
    }
    addCoordinate(coordinates, {
      ecosystem: 'pip', osvEcosystem: 'PyPI', name: match[1], exactVersion: match[2],
      scope: 'runtime', direct: true, manifestPath: rel, lockfilePath: rel, dependencyPaths: [match[1]],
    });
  }
}

function parseGoMod(root: string, file: string, coordinates: DependencyCoordinate[]): void {
  const rel = relative(root, file);
  let inRequire = false;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === 'require (') {inRequire = true; continue;}
    if (inRequire && line === ')') {inRequire = false; continue;}
    const content = line.replace(/^require\s+/, '');
    if (!inRequire && content === line) {continue;}
    const match = content.match(/^([^\s]+)\s+(v[^\s]+)(?:\s+\/\/\s+indirect)?$/);
    if (!match) {continue;}
    addCoordinate(coordinates, {
      ecosystem: 'go', osvEcosystem: 'Go', name: match[1], exactVersion: match[2],
      scope: 'runtime', direct: !line.includes('// indirect'), manifestPath: rel, lockfilePath: rel,
      dependencyPaths: [match[1]],
    });
  }
}

function parseCargoLock(root: string, file: string, coordinates: DependencyCoordinate[], errors: PackageInventoryError[]): void {
  const rel = relative(root, file);
  try {
    const blocks = fs.readFileSync(file, 'utf8').split(/\[\[package\]\]/).slice(1);
    for (const block of blocks) {
      const name = block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
      const version = block.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
      if (!name || !version) {continue;}
      addCoordinate(coordinates, {
        ecosystem: 'cargo', osvEcosystem: 'crates.io', name, exactVersion: version,
        scope: 'unknown', direct: false, manifestPath: relative(root, path.join(path.dirname(file), 'Cargo.toml')),
        lockfilePath: rel, dependencyPaths: [name],
      });
    }
  } catch (error: any) {
    errors.push({ file: rel, code: 'INVALID_MANIFEST', message: `Unable to parse Cargo.lock: ${error?.message || error}` });
  }
}

function parseGemfileLock(root: string, file: string, coordinates: DependencyCoordinate[]): void {
  const rel = relative(root, file);
  let inSpecs = false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s{2}specs:$/.test(line)) {inSpecs = true; continue;}
    if (inSpecs && line && !/^\s/.test(line)) {inSpecs = false;}
    if (!inSpecs) {continue;}
    const match = line.match(/^\s{4}([A-Za-z0-9_.-]+) \(([^ )]+)\)/);
    if (!match) {continue;}
    addCoordinate(coordinates, {
      ecosystem: 'ruby', osvEcosystem: 'RubyGems', name: match[1], exactVersion: match[2],
      scope: 'unknown', direct: false, manifestPath: relative(root, path.join(path.dirname(file), 'Gemfile')),
      lockfilePath: rel, dependencyPaths: [match[1]],
    });
  }
}

function parsePom(root: string, file: string, coordinates: DependencyCoordinate[], errors: PackageInventoryError[]): void {
  const rel = relative(root, file);
  try {
    const xml = fs.readFileSync(file, 'utf8');
    for (const block of xml.match(/<dependency>[\s\S]*?<\/dependency>/g) || []) {
      const group = block.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/)?.[1];
      const artifact = block.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/)?.[1];
      const version = block.match(/<version>\s*([^<\s]+)\s*<\/version>/)?.[1];
      if (!group || !artifact || !version || version.includes('${')) {continue;}
      const name = `${group}:${artifact}`;
      addCoordinate(coordinates, {
        ecosystem: 'maven', osvEcosystem: 'Maven', name, exactVersion: version,
        scope: block.includes('<scope>test</scope>') ? 'development' : 'runtime', direct: true,
        manifestPath: rel, lockfilePath: rel, dependencyPaths: [name],
      });
    }
  } catch (error: any) {
    errors.push({ file: rel, code: 'INVALID_MANIFEST', message: `Unable to parse Maven POM: ${error?.message || error}` });
  }
}

function mergeCoordinates(coordinates: DependencyCoordinate[]): DependencyCoordinate[] {
  const merged = new Map<string, DependencyCoordinate>();
  const scopeRank: Record<DependencyScope, number> = { unknown: 0, development: 1, optional: 2, runtime: 3 };
  for (const coordinate of coordinates) {
    const key = [coordinate.ecosystem, coordinate.name, coordinate.exactVersion].join('\0');
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...coordinate });
    } else {
      existing.direct ||= coordinate.direct;
      if (scopeRank[coordinate.scope] > scopeRank[existing.scope]) {existing.scope = coordinate.scope;}
      existing.dependencyPaths = [...new Set([...existing.dependencyPaths, ...coordinate.dependencyPaths])].sort();
      if (coordinate.manifestPath < existing.manifestPath) {existing.manifestPath = coordinate.manifestPath;}
      if (coordinate.lockfilePath < existing.lockfilePath) {existing.lockfilePath = coordinate.lockfilePath;}
    }
  }
  return [...merged.values()].sort((a, b) =>
    `${a.osvEcosystem}\0${a.name}\0${a.exactVersion}\0${a.scope}`.localeCompare(
      `${b.osvEcosystem}\0${b.name}\0${b.exactVersion}\0${b.scope}`
    )
  );
}

function inventoryDigest(coordinates: DependencyCoordinate[]): string {
  return createHash('sha256').update(JSON.stringify(coordinates.map(coordinate => ({
    ecosystem: coordinate.osvEcosystem,
    name: coordinate.name,
    version: coordinate.exactVersion,
    scope: coordinate.scope,
  })))).digest('hex');
}

export function filterPackageInventory(inventory: PackageInventory, filter: PackageInventoryFilter): PackageInventory {
  const coordinates = inventory.coordinates.filter(coordinate =>
    (!filter.ecosystems || filter.ecosystems.includes(coordinate.ecosystem)) &&
    (filter.scope !== 'runtime' || coordinate.scope !== 'development')
  );
  return { ...inventory, coordinates, digest: inventoryDigest(coordinates) };
}

export function collectPackageInventory(repoPath: string = process.cwd()): PackageInventory {
  const root = fs.realpathSync(repoPath);
  if (!fs.statSync(root).isDirectory()) {throw new Error(`Repository path is not a directory: ${repoPath}`);}
  const coordinates: DependencyCoordinate[] = [];
  const errors: PackageInventoryError[] = [];
  const files = findInventoryFiles(root).filter(file => isWithinRoot(root, fs.realpathSync(file)));
  const names = new Set(files.map(file => relative(root, file)));

  for (const file of files) {
    const name = path.basename(file);
    if (name === 'package-lock.json' || name === 'npm-shrinkwrap.json') {parseNpmLock(root, file, coordinates, errors);}
    else if (name === 'pnpm-lock.yaml') {parsePnpmLock(root, file, coordinates, errors);}
    else if (name === 'yarn.lock') {parseYarnLock(root, file, coordinates, errors);}
    else if (name === 'requirements.txt') {parseRequirements(root, file, coordinates, errors);}
    else if (name === 'go.mod') {parseGoMod(root, file, coordinates);}
    else if (name === 'Cargo.lock') {parseCargoLock(root, file, coordinates, errors);}
    else if (name === 'Gemfile.lock') {parseGemfileLock(root, file, coordinates);}
    else if (name === 'pom.xml') {parsePom(root, file, coordinates, errors);}
  }
  for (const file of files.filter(file => path.basename(file) === 'package.json')) {
    parseExactPackageJson(root, file, coordinates, errors);
  }

  const normalized = mergeCoordinates(coordinates);
  const digest = inventoryDigest(normalized);

  return {
    repository: root,
    coordinates: normalized,
    manifests: [...names].sort(),
    errors,
    digest,
  };
}
