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
  ecosystem?: PackageEcosystem;
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
  'Cargo.toml',
  'Gemfile',
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function findInventoryFiles(root: string, errors: PackageInventoryError[]): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error: unknown) {
      errors.push({
        file: relative(root, directory),
        code: 'INVALID_MANIFEST',
        message: `Unable to read inventory directory: ${errorMessage(error)}`,
      });
      return;
    }
    for (const entry of entries) {
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

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

function npmDirectDependencyRequirements(
  directory: string
): Map<string, {scope: DependencyScope; requested: string}> {
  const result = new Map<string, {scope: DependencyScope; requested: string}>();
  const manifest = path.join(directory, 'package.json');
  if (!fs.existsSync(manifest)) {return result;}
  try {
    const data = asRecord(readJson(manifest));
    if (!data) {return result;}
    const groups: Array<[Record<string, unknown>, DependencyScope]> = [
      [asRecord(data.dependencies) || {}, 'runtime'],
      [asRecord(data.devDependencies) || {}, 'development'],
      [asRecord(data.optionalDependencies) || {}, 'optional'],
    ];
    for (const [dependencies, scope] of groups) {
      for (const [name, requested] of Object.entries(dependencies)) {
        if (typeof requested === 'string') {result.set(name, {scope, requested});}
      }
    }
  } catch {
    // The lockfile parser reports the actionable error when it is malformed.
  }
  return result;
}

function npmAliasTarget(requested: string): {name: string; range: string} | undefined {
  const match = requested.match(/^npm:((?:@[^/]+\/)?[^@]+)@(.+)$/);
  return match ? {name: match[1], range: match[2]} : undefined;
}

function npmRequestMatchesVersion(requested: string, exactVersion: string): boolean {
  const registryRange = npmAliasTarget(requested)?.range || requested.replace(/^npm:/, '');
  const range = semver.validRange(registryRange, { loose: true });
  return range !== null && semver.satisfies(exactVersion, range, { includePrerelease: true, loose: true });
}

function npmRequestedPackageName(installName: string, requested: string): string {
  return npmAliasTarget(requested)?.name || installName;
}

function yarnDescriptorMatchesRequest(
  descriptor: string,
  packageName: string,
  requested: string
): boolean {
  if (!descriptor.startsWith(`${packageName}@`)) {return false;}
  const selector = descriptor.slice(packageName.length + 1);
  return selector === requested || selector === `npm:${requested}`;
}

function unsupportedYarnDescriptor(descriptors: string[], packageName: string): string | undefined {
  const unsupportedProtocol = /^(?:git(?:\+[^:]+)?|github|gitlab|bitbucket|https?|file|link|portal|patch):/i;
  for (const descriptor of descriptors) {
    if (!descriptor.startsWith(`${packageName}@`)) {continue;}
    const selector = descriptor.slice(packageName.length + 1);
    if (unsupportedProtocol.test(selector)) {return selector;}
  }
  return undefined;
}

function isYarnWorkspaceDescriptor(descriptor: string, packageName: string): boolean {
  return descriptor.startsWith(`${packageName}@`) &&
    /^workspace:/i.test(descriptor.slice(packageName.length + 1));
}

function isYarnWorkspaceResolution(value: string): boolean {
  return /^(?:@[^/\s]+\/[^@\s]+|[^@\s]+)@workspace:/i.test(value.trim());
}

function unsupportedYarnResolution(value: string): string | undefined {
  const resolution = value.trim();
  const registryLocator = /^(?:@[^/\s]+\/[^@\s]+|[^@\s]+)@(?:npm:|virtual:[^#\s]+#npm:)/i;
  if (registryLocator.test(resolution) || /^npm:/i.test(resolution)) {return undefined;}
  return unsupportedNpmSource({resolved: resolution});
}

function yarnWorkspacePatterns(data: Record<string, unknown>): string[] {
  const workspaces = Array.isArray(data.workspaces)
    ? data.workspaces
    : asRecord(data.workspaces)?.packages;
  return Array.isArray(workspaces) ? workspaces.filter((value): value is string => typeof value === 'string') : [];
}

function yarnWorkspacePatternMatches(pattern: string, directory: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  const normalizedDirectory = directory.replace(/\\/g, '/').replace(/\/$/, '');
  const expression = normalizedPattern
    .split('**').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*');
  return new RegExp(`^${expression}$`).test(normalizedDirectory);
}

function yarnWorkspaceManifestDirectories(root: string, lockDirectory: string): Set<string> {
  const manifest = path.join(lockDirectory, 'package.json');
  if (!fs.existsSync(manifest)) {return new Set();}
  try {
    const data = asRecord(readJson(manifest));
    if (!data) {return new Set();}
    const patterns = yarnWorkspacePatterns(data);
    const directories = new Set<string>();
    for (const file of findInventoryFiles(root, []).filter(candidate => path.basename(candidate) === 'package.json')) {
      const directory = path.relative(lockDirectory, path.dirname(file)).split(path.sep).join('/');
      if (directory && !directory.startsWith('../') && patterns.some(pattern => yarnWorkspacePatternMatches(pattern, directory))) {
        directories.add(directory);
      }
    }
    return directories;
  } catch {
    return new Set();
  }
}

function yarnWorkspaceDirectDependencies(
  root: string,
  lockDirectory: string
): Array<{name: string; scope: DependencyScope; requested: string; manifestPath: string}> {
  const workspaceDirectories = yarnWorkspaceManifestDirectories(root, lockDirectory);
  const result: Array<{name: string; scope: DependencyScope; requested: string; manifestPath: string}> = [];
  for (const directory of workspaceDirectories) {
    const manifest = path.join(lockDirectory, directory, 'package.json');
    const direct = npmDirectDependencyRequirements(path.dirname(manifest));
    for (const [name, value] of direct) {
      result.push({name, ...value, manifestPath: relative(root, manifest)});
    }
  }
  return result;
}

function splitYarnDescriptors(header: string): string[] {
  const descriptors: string[] = [];
  let start = 0;
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (let index = 0; index <= header.length; index++) {
    const character = header[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote) {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? undefined : quote || character;
      continue;
    }
    if ((character === ',' && !quote) || index === header.length) {
      descriptors.push(header.slice(start, index).trim().replace(/^['"]|['"]$/g, ''));
      start = index + 1;
    }
  }
  return descriptors.filter(Boolean);
}

function packageNameFromNodeModulesPath(packagePath: string): string | undefined {
  const match = packagePath.replace(/\\/g, '/').match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/);
  return match?.[1];
}

function isRootNpmInstallPath(packagePath: string, name: string): boolean {
  return packagePath.replace(/\\/g, '/') === `node_modules/${name}`;
}

function unsupportedNpmSource(value: Record<string, unknown>): string | undefined {
  if (value.link === true) {return 'link';}
  if (typeof value.resolved !== 'string' || !value.resolved.trim()) {return undefined;}
  const resolved = value.resolved.trim();
  if (/^npm:/i.test(resolved)) {return undefined;}
  if (/^https?:\/\//i.test(resolved)) {
    try {
      const url = new URL(resolved);
      if (/\/-\/[^/]+\.tgz$/i.test(url.pathname)) {return undefined;}
    } catch {
      // The unsupported source is reported below.
    }
  }
  return resolved;
}

function npmWorkspacePackagePaths(
  lockDirectory: string,
  lockPackages: Record<string, unknown>
): Set<string> {
  let patterns = yarnWorkspacePatterns(asRecord(lockPackages['']) || {});
  if (patterns.length === 0) {
    try {
      patterns = yarnWorkspacePatterns(asRecord(readJson(path.join(lockDirectory, 'package.json'))) || {});
    } catch {
      return new Set();
    }
  }
  return new Set(Object.keys(lockPackages).filter(packagePath =>
    packagePath !== '' &&
    !packagePath.startsWith('node_modules/') &&
    !packagePath.includes('/node_modules/') &&
    patterns.some(pattern => yarnWorkspacePatternMatches(pattern, packagePath.replace(/\\/g, '/')))
  ));
}

function isNpmWorkspaceLink(
  value: Record<string, unknown>,
  workspacePackagePaths: ReadonlySet<string>,
  lockPackages: Record<string, unknown>
): boolean {
  if (value.link !== true || typeof value.resolved !== 'string') {return false;}
  const target = path.posix.normalize(value.resolved.trim().replace(/\\/g, '/').replace(/^\.\//, ''));
  return target !== '' && target !== '.' && !target.startsWith('../') && !path.posix.isAbsolute(target) &&
    workspacePackagePaths.has(target) && asRecord(lockPackages[target]) !== undefined;
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
    const data = asRecord(readJson(file));
    if (!data) {throw new Error('npm lockfile root must be a JSON object');}
    const direct = npmDirectDependencyRequirements(path.dirname(file));
    const rootManifest = relative(root, path.join(path.dirname(file), 'package.json'));
    type DirectDependency = {scope: DependencyScope; manifestPath: string; requested: string};
    const directByWorkspace = new Map<string, Map<string, DirectDependency>>();
    const workspaceDirect: Array<DirectDependency & {name: string}> = [];
    const scopeGroups: Array<[string, DependencyScope]> = [
      ['dependencies', 'runtime'],
      ['devDependencies', 'development'],
      ['optionalDependencies', 'optional'],
    ];
    const lockPackages = asRecord(data.packages);
    const workspacePackagePaths = lockPackages
      ? npmWorkspacePackagePaths(path.dirname(file), lockPackages)
      : new Set<string>();
    for (const [packagePath, packageValue] of Object.entries(lockPackages || {})) {
      if (!packagePath || packagePath.startsWith('node_modules/') || packagePath.includes('/node_modules/')) {continue;}
      const packageRecord = asRecord(packageValue);
      if (!packageRecord) {continue;}
      const manifestPath = relative(root, path.join(path.dirname(file), packagePath, 'package.json'));
      const workspace = new Map<string, DirectDependency>();
      for (const [group, scope] of scopeGroups) {
        const dependencies = asRecord(packageRecord[group]);
        for (const [name, requested] of Object.entries(dependencies || {})) {
          if (typeof requested !== 'string') {continue;}
          const value = {scope, manifestPath, requested};
          workspace.set(name, value);
          workspaceDirect.push({name, ...value});
        }
      }
      if (workspace.size > 0) {directByWorkspace.set(packagePath, workspace);}
    }
    const scopeRank: Record<DependencyScope, number> = {unknown: 0, development: 1, optional: 2, runtime: 3};
    const workspaceDirectFor = (
      packagePath: string,
      installName: string,
      resolvedName: string,
      version: string
    ): DirectDependency[] => {
      const normalizedPath = packagePath.replace(/\\/g, '/');
      const candidates = [...directByWorkspace.entries()]
        .filter(([workspacePath]) => normalizedPath === `${workspacePath}/node_modules/${installName}`)
        .map(([, values]) => values.get(installName))
        .filter((value): value is DirectDependency =>
          value !== undefined &&
          npmRequestedPackageName(installName, value.requested) === resolvedName &&
          npmRequestMatchesVersion(value.requested, version)
        );
      return candidates.sort((left, right) =>
        scopeRank[right.scope] - scopeRank[left.scope] || left.manifestPath.localeCompare(right.manifestPath)
      );
    };
    const rootDirectFor = (installName: string, resolvedName: string, version: string): DirectDependency[] => {
      const rootDependency = direct.get(installName);
      const candidates: DirectDependency[] = workspaceDirect.filter(value =>
        value.name === installName &&
        npmRequestedPackageName(installName, value.requested) === resolvedName &&
        npmRequestMatchesVersion(value.requested, version)
      );
      if (rootDependency &&
        npmRequestedPackageName(installName, rootDependency.requested) === resolvedName &&
        npmRequestMatchesVersion(rootDependency.requested, version)) {
        candidates.push({...rootDependency, manifestPath: rootManifest});
      }
      return candidates.sort((left, right) =>
        scopeRank[right.scope] - scopeRank[left.scope] || left.manifestPath.localeCompare(right.manifestPath)
      );
    };
    if (lockPackages) {
      type NpmNode = {
        packagePath: string;
        installName: string;
        name: string;
        version: string;
        value: Record<string, unknown>;
        directInfos: DirectDependency[];
      };
      const nodes = new Map<string, NpmNode>();
      for (const [packagePath, packageValue] of Object.entries(lockPackages)) {
        if (!packagePath) {continue;}
        const normalizedPackagePath = packagePath.replace(/\\/g, '/');
        if (!/(?:^|\/)node_modules\//.test(normalizedPackagePath)) {continue;}
        const value = asRecord(packageValue);
        if (!value) {continue;}
        if (isNpmWorkspaceLink(value, workspacePackagePaths, lockPackages)) {continue;}
        const unsupportedSource = unsupportedNpmSource(value);
        if (unsupportedSource) {
          errors.push({
            file: rel,
            code: 'UNSUPPORTED_FORMAT',
            message: `npm package ${packagePath} uses unsupported source: ${unsupportedSource.slice(0, 120)}`,
          });
          continue;
        }
        const installName = packageNameFromNodeModulesPath(packagePath);
        const rawName = value.name;
        const name = typeof rawName === 'string' ? rawName : installName;
        const version = typeof value.version === 'string' ? value.version : '';
        if (!name || !installName) {
          errors.push({
            file: rel,
            code: 'UNSUPPORTED_FORMAT',
            message: `npm package ${packagePath} has no resolvable package name`,
          });
          continue;
        }
        if (!semver.valid(version, { loose: true })) {
          errors.push({
            file: rel,
            code: 'UNRESOLVED_VERSION',
            message: `npm package ${packagePath} has no valid exact version${version ? `: ${version.slice(0, 120)}` : ''}`,
          });
          continue;
        }
        const directInfos = isRootNpmInstallPath(packagePath, installName)
          ? rootDirectFor(installName, name, version)
          : workspaceDirectFor(packagePath, installName, name, version);
        nodes.set(normalizedPackagePath, {
          packagePath: normalizedPackagePath,
          installName,
          name,
          version,
          value,
          directInfos,
        });
      }

      const resolveInstalledNode = (parentPath: string, installName: string): NpmNode | undefined => {
        let directory: string | undefined = parentPath;
        while (directory !== undefined) {
          const candidate = directory
            ? `${directory}/node_modules/${installName}`
            : `node_modules/${installName}`;
          const resolved = nodes.get(path.posix.normalize(candidate));
          if (resolved) {return resolved;}
          if (!directory) {return undefined;}
          const parent = path.posix.dirname(directory);
          directory = parent === '.' || parent === directory ? '' : parent;
        }
        return undefined;
      };
      const pathsByNode = new Map<string, Set<string>>();
      const scopeByNode = new Map<string, DependencyScope>();
      const identity = (node: NpmNode): string => `${node.name}@${node.version}`;
      const visit = (node: NpmNode, currentPath: string, stack: Set<string>, rootScope: DependencyScope): void => {
        const paths = pathsByNode.get(node.packagePath) || new Set<string>();
        if (paths.has(currentPath)) {return;}
        paths.add(currentPath);
        pathsByNode.set(node.packagePath, paths);
        const existingScope = scopeByNode.get(node.packagePath) || 'unknown';
        if (scopeRank[rootScope] > scopeRank[existingScope]) {scopeByNode.set(node.packagePath, rootScope);}
        if (stack.has(node.packagePath)) {return;}
        const nextStack = new Set(stack).add(node.packagePath);
        const dependencies = [
          ...Object.keys(asRecord(node.value.dependencies) || {}),
          ...Object.keys(asRecord(node.value.optionalDependencies) || {}),
        ];
        for (const dependencyName of [...new Set(dependencies)].sort()) {
          const child = resolveInstalledNode(node.packagePath, dependencyName);
          if (child) {visit(child, `${currentPath} > ${identity(child)}`, nextStack, rootScope);}
        }
      };
      for (const node of nodes.values()) {
        for (const direct of node.directInfos) {
          visit(node, identity(node), new Set(), direct.scope);
        }
      }
      for (const node of nodes.values()) {
        const directInfos: Array<DirectDependency | undefined> = node.directInfos.length > 0
          ? node.directInfos
          : [undefined];
        for (const directInfo of directInfos) {
          addCoordinate(coordinates, {
            ecosystem: 'npm', osvEcosystem: 'npm', name: node.name, exactVersion: node.version,
            scope: directInfo?.scope || scopeByNode.get(node.packagePath) ||
              (node.value.optional === true ? 'optional' : node.value.dev === true ? 'development' : 'runtime'),
            direct: directInfo !== undefined,
            manifestPath: directInfo?.manifestPath || manifest,
            lockfilePath: rel,
            dependencyPaths: pathsByNode.get(node.packagePath)
              ? [...pathsByNode.get(node.packagePath)!].sort()
              : [node.packagePath],
          });
        }
      }
      return;
    }

    const rootDependencies = asRecord(data.dependencies);
    if (!rootDependencies) {
      errors.push({ file: rel, code: 'UNSUPPORTED_FORMAT', message: 'npm lockfile does not contain packages or dependencies' });
      return;
    }
    const walk = (dependencies: Record<string, unknown>, chain: string[]): void => {
      for (const [name, dependencyValue] of Object.entries(dependencies)) {
        const value = asRecord(dependencyValue);
        if (!value) {continue;}
        const unsupportedSource = unsupportedNpmSource(value);
        if (unsupportedSource) {
          errors.push({
            file: rel,
            code: 'UNSUPPORTED_FORMAT',
            message: `npm package ${[...chain, name].join(' > ')} uses unsupported source: ${unsupportedSource.slice(0, 120)}`,
          });
        }
        const version = typeof value.version === 'string' ? value.version : '';
        const directDependency = chain.length === 0 ? direct.get(name) : undefined;
        const directScope = directDependency && npmRequestMatchesVersion(directDependency.requested, version)
          ? directDependency.scope
          : undefined;
        if (!unsupportedSource && !semver.valid(version, {loose: true})) {
          errors.push({
            file: rel,
            code: 'UNRESOLVED_VERSION',
            message: `npm package ${[...chain, name].join(' > ')} has no valid exact version${version ? `: ${version.slice(0, 120)}` : ''}`,
          });
        }
        if (!unsupportedSource && semver.valid(version, { loose: true })) {
          addCoordinate(coordinates, {
            ecosystem: 'npm', osvEcosystem: 'npm', name, exactVersion: version,
            scope: value.optional === true ? 'optional' : value.dev === true ? 'development' : directScope || 'runtime',
            direct: directScope !== undefined,
            manifestPath: manifest, lockfilePath: rel, dependencyPaths: [[...chain, name].join(' > ')],
          });
        }
        const nestedDependencies = asRecord(value.dependencies);
        if (nestedDependencies) {walk(nestedDependencies, [...chain, name]);}
      }
    };
    walk(rootDependencies, []);
  } catch (error: unknown) {
    errors.push({ file: rel, code: 'INVALID_MANIFEST', message: `Unable to parse npm lockfile: ${errorMessage(error)}` });
  }
}

function firstPartyWorkspacePackages(root: string, lockPath: string): Map<string, string | undefined> {
  const lockDirectory = path.dirname(lockPath);
  const lockName = path.basename(lockPath);
  const manifestDirectories = new Set<string>();
  try {
    if (lockName === 'yarn.lock') {
      for (const directory of yarnWorkspaceManifestDirectories(root, lockDirectory)) {
        manifestDirectories.add(directory);
      }
    } else {
      const data = lockName === 'pnpm-lock.yaml'
        ? asRecord(yaml.load(fs.readFileSync(lockPath, 'utf8')))
        : asRecord(readJson(lockPath));
      if (lockName === 'pnpm-lock.yaml') {
        for (const importer of Object.keys(asRecord(data?.importers) || {})) {
          manifestDirectories.add(importer === '.' ? '' : importer);
        }
      } else {
        for (const packagePath of Object.keys(asRecord(data?.packages) || {})) {
          if (!packagePath.includes('node_modules')) {manifestDirectories.add(packagePath);}
        }
      }
    }
  } catch {
    return new Map();
  }
  const packages = new Map<string, string | undefined>();
  for (const directory of manifestDirectories) {
    const manifest = path.resolve(lockDirectory, directory, 'package.json');
    if (!isWithinRoot(root, manifest) || !fs.existsSync(manifest)) {continue;}
    try {
      const data = asRecord(readJson(manifest));
      const name = data?.name;
      const version = data?.version;
      if (typeof name === 'string' && name) {
        packages.set(name, typeof version === 'string' ? version : undefined);
      }
    } catch {
      // The package manifest validation path reports malformed JSON.
    }
  }
  return packages;
}

function parseExactPackageJson(
  root: string,
  file: string,
  coordinates: DependencyCoordinate[],
  errors: PackageInventoryError[],
  workspacePackagesByLock: Map<string, Map<string, string | undefined>>
): void {
  const directory = path.dirname(file);
  let lockDirectory = directory;
  let coveringLock: string | undefined;
  while (isWithinRoot(root, lockDirectory)) {
    const lockNames = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'];
    const lockName = lockNames.find(name => isManifestCoveredByLock(directory, lockDirectory, name));
    if (lockName) {
      coveringLock = path.join(lockDirectory, lockName);
      break;
    }
    if (lockDirectory === root) {break;}
    lockDirectory = path.dirname(lockDirectory);
  }
  const rel = relative(root, file);
  try {
    const data = asRecord(readJson(file));
    if (!data) {throw new Error('package.json root must be a JSON object');}
    const groups: Array<[Record<string, unknown>, DependencyScope]> = [
      [asRecord(data.dependencies) || {}, 'runtime'],
      [asRecord(data.devDependencies) || {}, 'development'],
      [asRecord(data.optionalDependencies) || {}, 'optional'],
    ];
    if (coveringLock) {
      const lockfilePath = relative(root, coveringLock);
      let workspacePackages = workspacePackagesByLock.get(coveringLock);
      if (!workspacePackages) {
        workspacePackages = firstPartyWorkspacePackages(root, coveringLock);
        workspacePackagesByLock.set(coveringLock, workspacePackages);
      }
      for (const [dependencies] of groups) {
        for (const [installName, requestedValue] of Object.entries(dependencies)) {
          const requested = typeof requestedValue === 'string' ? requestedValue : '';
          const packageName = npmRequestedPackageName(installName, requested);
          const workspaceVersion = workspacePackages.get(installName);
          const firstPartyWorkspace = !npmAliasTarget(requested) && workspacePackages.has(installName) &&
            (requested.startsWith('workspace:') ||
              (workspaceVersion !== undefined && npmRequestMatchesVersion(requested, workspaceVersion)));
          const covered = requested !== '' && (
            firstPartyWorkspace ||
            coordinates.some(coordinate =>
              coordinate.ecosystem === 'npm' &&
              coordinate.lockfilePath === lockfilePath &&
              coordinate.manifestPath === rel &&
              coordinate.direct &&
              coordinate.name === packageName &&
              npmRequestMatchesVersion(requested, coordinate.exactVersion)
            )
          );
          const lockAlreadyReported = errors.some(error =>
            error.file === lockfilePath && error.message.includes(installName)
          );
          if (!covered && !lockAlreadyReported) {
            errors.push({
              file: rel,
              code: 'UNRESOLVED_VERSION',
              message: `${installName} requirement ${requested || '<invalid>'} is not satisfied by ${path.basename(coveringLock)}`,
            });
          }
        }
      }
      return;
    }
    let hasDependencies = false;
    for (const [dependencies, scope] of groups) {
      for (const [name, requested] of Object.entries(dependencies)) {
        hasDependencies = true;
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
    if (hasDependencies) {
      errors.push({
        file: rel,
        code: 'UNSUPPORTED_FORMAT',
        message: 'npm dependency inventory is lockless; transitive coverage is incomplete',
      });
    }
  } catch (error: unknown) {
    errors.push({ file: rel, code: 'INVALID_MANIFEST', message: `Unable to parse package.json: ${errorMessage(error)}` });
  }
}

function isManifestCoveredByLock(
  manifestDirectory: string,
  lockDirectory: string,
  lockName: string
): boolean {
  const lockPath = path.join(lockDirectory, lockName);
  if (!fs.existsSync(lockPath)) {return false;}
  if (manifestDirectory === lockDirectory) {return true;}
  const relativeDirectory = relative(lockDirectory, manifestDirectory);
  if (!relativeDirectory || relativeDirectory.startsWith('..')) {return false;}
  if (lockName === 'yarn.lock') {
    return yarnWorkspaceManifestDirectories(lockDirectory, lockDirectory).has(relativeDirectory);
  }
  try {
    const data: Record<string, unknown> | undefined = lockName === 'pnpm-lock.yaml'
      ? asRecord(yaml.load(fs.readFileSync(lockPath, 'utf8')))
      : asRecord(readJson(lockPath));
    const importers = asRecord(data?.importers);
    if (importers && Object.prototype.hasOwnProperty.call(importers, relativeDirectory)) {return true;}
    const packages = asRecord(data?.packages);
    return packages !== undefined && Object.prototype.hasOwnProperty.call(packages, relativeDirectory);
  } catch {
    return false;
  }
}

function parsePnpmLock(root: string, file: string, coordinates: DependencyCoordinate[], errors: PackageInventoryError[]): void {
  const rel = relative(root, file);
  try {
    const data = asRecord(yaml.load(fs.readFileSync(file, 'utf8')));
    const parseNodeKey = (rawKey: string): {name: string; version: string} | undefined => {
      const key = rawKey.replace(/^\//, '').split('(')[0];
      const match = key.match(/^(@[^/]+\/[^@/]+)@([^/]+)$/) || key.match(/^(@[^/]+\/[^/]+)\/([^/]+)$/)
        || key.match(/^([^@/][^@]*?)@([^/]+)$/) || key.match(/^([^@/][^/]*)\/([^/]+)$/);
      if (!match || !semver.valid(match[2], {loose: true})) {return undefined;}
      return {name: match[1], version: semver.valid(match[2], {loose: true})!};
    };
    type PnpmDirectDependency = {
      scope: DependencyScope;
      manifestPath: string;
      dependencyPaths: string[];
    };
    const directDependencies = new Map<string, PnpmDirectDependency[]>();
    const scopeRank: Record<DependencyScope, number> = {
      unknown: 0,
      development: 1,
      optional: 2,
      runtime: 3,
    };
    const dependencyGroups: Array<[string, DependencyScope]> = [
      ['dependencies', 'runtime'],
      ['devDependencies', 'development'],
      ['optionalDependencies', 'optional'],
    ];
    for (const [rawImporterPath, importer] of Object.entries(asRecord(data?.importers) || {})) {
      const importerPath = rawImporterPath === '.' ? '' : rawImporterPath;
      const manifest = path.resolve(path.dirname(file), importerPath, 'package.json');
      if (!isWithinRoot(root, manifest)) {continue;}
      const importerRecord = asRecord(importer);
      for (const [group, scope] of dependencyGroups) {
        const dependencies = asRecord(importerRecord?.[group]);
        if (!dependencies) {continue;}
        for (const [name, resolution] of Object.entries(dependencies)) {
          const resolutionRecord = asRecord(resolution);
          const specifier = typeof resolutionRecord?.specifier === 'string' ? resolutionRecord.specifier : '';
          const aliasTarget = npmAliasTarget(specifier);
          const rawVersion = typeof resolution === 'string'
            ? resolution
            : typeof resolutionRecord?.version === 'string'
              ? resolutionRecord.version
              : '';
          const normalizedVersion = rawVersion.replace(/^\//, '').split('(')[0];
          const parsedLocator = parseNodeKey(normalizedVersion);
          const dependencyName = aliasTarget?.name || name;
          const version = aliasTarget
            ? parsedLocator?.name === dependencyName
              ? parsedLocator.version
              : semver.valid(normalizedVersion, {loose: true}) || undefined
            : semver.valid(normalizedVersion, {loose: true}) || undefined;
          if (!version || (aliasTarget && parsedLocator && parsedLocator.name !== dependencyName)) {
            if (rawVersion) {
              errors.push({file: rel, code: 'UNSUPPORTED_FORMAT', message: `pnpm direct dependency ${name} uses unsupported resolution: ${rawVersion.slice(0, 120)}`});
            }
            continue;
          }
          const key = `${dependencyName}\0${version}`;
          const values = directDependencies.get(key) || [];
          const manifestPath = relative(root, manifest);
          const existing = values.find(value => value.manifestPath === manifestPath);
          const dependencyPath = rawImporterPath === '.' ? dependencyName : `${rawImporterPath}:${dependencyName}`;
          if (!existing) {
            values.push({
              scope,
              manifestPath,
              dependencyPaths: [dependencyPath],
            });
            directDependencies.set(key, values);
          } else {
            if (scopeRank[scope] > scopeRank[existing.scope]) {existing.scope = scope;}
            existing.dependencyPaths = [...new Set([...existing.dependencyPaths, dependencyPath])].sort();
          }
        }
      }
    }
    const records = {
      ...(asRecord(data?.packages) || {}),
      ...(asRecord(data?.snapshots) || {}),
    };
    type PnpmNode = {name: string; version: string; rawKey: string; dependencies: Array<{name: string; version: string}>};
    const nodes = new Map<string, PnpmNode>();
    const parseDependency = (name: string, value: unknown): {name: string; version: string} | undefined => {
      const record = asRecord(value);
      const raw = typeof value === 'string' ? value : typeof record?.version === 'string' ? record.version : undefined;
      if (!raw) {return undefined;}
      const normalized = raw.replace(/^\//, '').split('(')[0];
      const version = semver.valid(normalized, {loose: true});
      if (version) {return {name, version};}
      return parseNodeKey(normalized);
    };
    for (const [rawKey, rawValue] of Object.entries(records)) {
      const parsed = parseNodeKey(rawKey);
      const record = asRecord(rawValue);
      if (!parsed || !record) {continue;}
      const dependencies: Array<{name: string; version: string}> = [];
      for (const group of ['dependencies', 'optionalDependencies']) {
        for (const [name, value] of Object.entries(asRecord(record[group]) || {})) {
          const dependency = parseDependency(name, value);
          if (dependency) {dependencies.push(dependency);}
        }
      }
      nodes.set(`${parsed.name}\0${parsed.version}`, { ...parsed, rawKey, dependencies });
    }
    const pathsByNode = new Map<string, Set<string>>();
    const scopeByNode = new Map<string, DependencyScope>();
    const versionedIdentity = (name: string, version: string): string => `${name}@${version}`;
    const visit = (
      nodeKey: string,
      currentPath: string,
      stack: Set<string>,
      rootScope: DependencyScope
    ): void => {
      const paths = pathsByNode.get(nodeKey) || new Set<string>();
      if (paths.has(currentPath)) {return;}
      paths.add(currentPath);
      pathsByNode.set(nodeKey, paths);
      const existingScope = scopeByNode.get(nodeKey) || 'unknown';
      if (scopeRank[rootScope] > scopeRank[existingScope]) {scopeByNode.set(nodeKey, rootScope);}
      if (stack.has(nodeKey)) {return;}
      const node = nodes.get(nodeKey);
      if (!node) {return;}
      const nextStack = new Set(stack).add(nodeKey);
      for (const dependency of [...node.dependencies].sort((left, right) =>
        `${left.name}\0${left.version}`.localeCompare(`${right.name}\0${right.version}`)
      )) {
        const childKey = `${dependency.name}\0${dependency.version}`;
        visit(
          childKey,
          `${currentPath} > ${versionedIdentity(dependency.name, dependency.version)}`,
          nextStack,
          rootScope
        );
      }
    };
    for (const [nodeKey, directValues] of directDependencies) {
      const node = nodes.get(nodeKey);
      if (!node) {continue;}
      for (const direct of directValues) {
        visit(nodeKey, versionedIdentity(node.name, node.version), new Set(), direct.scope);
      }
    }
    for (const rawKey of Object.keys(records)) {
      const parsed = parseNodeKey(rawKey);
      if (!parsed) {continue;}
      const nodeKey = `${parsed.name}\0${parsed.version}`;
      const directValues = directDependencies.get(nodeKey) || [];
      const dependencyPaths = pathsByNode.get(nodeKey);
      const outputs: Array<PnpmDirectDependency | undefined> = directValues.length > 0 ? directValues : [undefined];
      for (const direct of outputs) {
        addCoordinate(coordinates, {
          ecosystem: 'npm', osvEcosystem: 'npm', name: parsed.name, exactVersion: parsed.version,
          scope: direct?.scope || scopeByNode.get(nodeKey) || 'unknown', direct: direct !== undefined,
          manifestPath: direct?.manifestPath || relative(root, path.join(path.dirname(file), 'package.json')),
          lockfilePath: rel,
          dependencyPaths: dependencyPaths
            ? [...dependencyPaths].sort()
            : [versionedIdentity(parsed.name, parsed.version)],
        });
      }
    }
  } catch (error: unknown) {
    errors.push({ file: rel, code: 'INVALID_MANIFEST', message: `Unable to parse pnpm lockfile: ${errorMessage(error)}` });
  }
}

function parseYarnLock(root: string, file: string, coordinates: DependencyCoordinate[], errors: PackageInventoryError[]): void {
  const rel = relative(root, file);
  try {
    const directDependencies = npmDirectDependencyRequirements(path.dirname(file));
    const workspaceDependencies = yarnWorkspaceDirectDependencies(root, path.dirname(file));
    const scopeRank: Record<DependencyScope, number> = {unknown: 0, development: 1, optional: 2, runtime: 3};
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let descriptor: string | undefined;
    let descriptors: string[] = [];
    let packageName: string | undefined;
    let resolved = false;
    let unsupportedSource: string | undefined;
    let exactVersion: string | undefined;
    let localWorkspace = false;
    let inDependencies = false;
    let dependencies: Array<{name: string; requested: string}> = [];
    const records: Array<{name: string; version: string; descriptors: string[]; dependencies: Array<{name: string; requested: string}>}> = [];
    const finishRecord = (): void => {
      if (localWorkspace) {
        // Workspace packages are first-party project code, not registry dependencies.
      } else if (descriptor && descriptor !== '__metadata' && exactVersion && packageName) {
        if (unsupportedSource) {
          errors.push({file: rel, code: 'UNSUPPORTED_FORMAT', message: `Yarn package ${packageName} uses unsupported source: ${unsupportedSource.slice(0, 120)}`});
        } else {
          const descriptorPackageName = packageName;
          const registryName = descriptors
            .map(candidate => candidate.startsWith(`${descriptorPackageName}@`) ? candidate.slice(descriptorPackageName.length + 1) : '')
            .map(npmAliasTarget)
            .find((candidate): candidate is {name: string; range: string} => candidate !== undefined)
            ?.name;
          records.push({name: registryName || packageName, version: exactVersion, descriptors: [...descriptors], dependencies: [...dependencies]});
        }
      } else if (descriptor && descriptor !== '__metadata' && !resolved) {
        errors.push({
          file: rel,
          code: 'UNSUPPORTED_FORMAT',
          message: `Yarn record is missing a supported exact version: ${descriptor.slice(0, 120)}`,
        });
      }
      descriptor = undefined;
      descriptors = [];
      packageName = undefined;
      resolved = false;
      unsupportedSource = undefined;
      exactVersion = undefined;
      localWorkspace = false;
      inDependencies = false;
      dependencies = [];
    };
    for (const line of lines) {
      if (line && !/^\s/.test(line) && line.endsWith(':')) {
        finishRecord();
        descriptors = splitYarnDescriptors(line.slice(0, -1));
        descriptor = descriptors[0];
        if (!descriptor) {continue;}
        const scoped = descriptor.match(/^(@[^/]+\/[^@]+)@/);
        const plain = descriptor.match(/^([^@]+)@/);
        packageName = scoped?.[1] || plain?.[1];
        if (packageName) {
          localWorkspace = descriptors.some(candidate => isYarnWorkspaceDescriptor(candidate, packageName!));
          unsupportedSource = unsupportedYarnDescriptor(descriptors, packageName);
        }
      } else if (packageName) {
        if (/^\s{2}dependencies\s*:\s*$/.test(line)) {inDependencies = true; continue;}
        if (inDependencies) {
          const dependencyMatch = line.match(/^\s{4}(?:"([^"]+)"|'([^']+)'|([^:\s]+))(?::|\s+)\s*["']?([^"'\s]+)["']?/);
          if (dependencyMatch) {
            dependencies.push({
              name: dependencyMatch[1] || dependencyMatch[2] || dependencyMatch[3],
              requested: dependencyMatch[4],
            });
          }
        }
        const resolutionMatch = line.match(/^\s+(?:resolved|resolution)(?::\s*|\s+)["']?([^"'\s]+)["']?/);
        if (resolutionMatch) {
          if (isYarnWorkspaceResolution(resolutionMatch[1])) {
            localWorkspace = true;
            unsupportedSource = undefined;
          } else {
            const source = unsupportedYarnResolution(resolutionMatch[1]);
            if (source) {unsupportedSource = source;}
          }
        }
        const versionMatch = line.match(/^\s+version(?::\s*|\s+)["']?([^"'\s]+)["']?/);
        if (versionMatch && semver.valid(versionMatch[1], { loose: true })) {
          exactVersion = versionMatch[1];
          resolved = true;
        }
      }
    }
    finishRecord();
    const directsForRecord = (record: typeof records[number]): Array<{scope: DependencyScope; manifestPath: string}> => {
      const candidates = workspaceDependencies.filter(candidate =>
        npmRequestMatchesVersion(candidate.requested, record.version) && record.descriptors.some(candidateDescriptor =>
          yarnDescriptorMatchesRequest(candidateDescriptor, candidate.name, candidate.requested)
        )
      );
      for (const [name, direct] of directDependencies) {
        if (npmRequestMatchesVersion(direct.requested, record.version) &&
          record.descriptors.some(candidate => yarnDescriptorMatchesRequest(candidate, name, direct.requested))) {
          candidates.push({...direct, name, manifestPath: relative(root, path.join(path.dirname(file), 'package.json'))});
        }
      }
      return candidates.sort((left, right) =>
        scopeRank[right.scope] - scopeRank[left.scope] || left.manifestPath.localeCompare(right.manifestPath)
      );
    };
    const pathsByRecord = new Map<typeof records[number], Set<string>>();
    const scopeByRecord = new Map<typeof records[number], DependencyScope>();
    const versionedIdentity = (record: typeof records[number]): string => `${record.name}@${record.version}`;
    const visit = (
      record: typeof records[number],
      currentPath: string,
      stack: Set<typeof records[number]>,
      rootScope: DependencyScope
    ): void => {
      const paths = pathsByRecord.get(record) || new Set<string>();
      if (paths.has(currentPath)) {return;}
      paths.add(currentPath);
      pathsByRecord.set(record, paths);
      const existingScope = scopeByRecord.get(record) || 'unknown';
      if (scopeRank[rootScope] > scopeRank[existingScope]) {scopeByRecord.set(record, rootScope);}
      if (stack.has(record)) {return;}
      const nextStack = new Set(stack).add(record);
      for (const dependency of [...record.dependencies].sort((left, right) => `${left.name}\0${left.requested}`.localeCompare(`${right.name}\0${right.requested}`))) {
        const child = records.find(candidate =>
          npmRequestMatchesVersion(dependency.requested, candidate.version) &&
          candidate.descriptors.some(descriptor => yarnDescriptorMatchesRequest(descriptor, dependency.name, dependency.requested))
        );
        if (child) {visit(child, `${currentPath} > ${versionedIdentity(child)}`, nextStack, rootScope);}
      }
    };
    for (const record of records) {
      for (const direct of directsForRecord(record)) {
        visit(record, versionedIdentity(record), new Set(), direct.scope);
      }
    }
    for (const record of records) {
      const directValues = directsForRecord(record);
      const outputs: Array<{scope: DependencyScope; manifestPath: string} | undefined> = directValues.length > 0
        ? directValues
        : [undefined];
      for (const direct of outputs) {
        addCoordinate(coordinates, {
          ecosystem: 'npm', osvEcosystem: 'npm', name: record.name, exactVersion: record.version,
          scope: direct?.scope || scopeByRecord.get(record) || 'unknown', direct: direct !== undefined,
          manifestPath: direct?.manifestPath || relative(root, path.join(path.dirname(file), 'package.json')),
          lockfilePath: rel,
          dependencyPaths: pathsByRecord.get(record) ? [...pathsByRecord.get(record)!].sort() : [versionedIdentity(record)],
        });
      }
    }
  } catch (error: unknown) {
    errors.push({ file: rel, code: 'INVALID_MANIFEST', message: `Unable to parse yarn lockfile: ${errorMessage(error)}` });
  }
}

function parseRequirements(
  root: string,
  file: string,
  coordinates: DependencyCoordinate[],
  errors: PackageInventoryError[],
  visited: Set<string> = new Set()
): void {
  const rel = relative(root, file);
  const rootRequirementsFile = visited.size === 0;
  let canonicalFile: string;
  try {
    canonicalFile = fs.realpathSync(file);
  } catch (error: unknown) {
    errors.push({
      file: rel,
      code: 'INVALID_MANIFEST',
      message: `Unable to resolve requirements file: ${errorMessage(error)}`,
    });
    return;
  }
  if (!isWithinRoot(root, canonicalFile)) {
    errors.push({
      file: rel,
      code: 'UNSUPPORTED_FORMAT',
      message: 'Python requirement include resolves outside the repository',
    });
    return;
  }
  if (visited.has(canonicalFile)) {return;}
  visited.add(canonicalFile);
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) {continue;}
      const include = line.match(/^(?:-r|--requirement)(?:=|\s+)(.+)$/);
      if (include) {
        const requested = include[1].trim();
        const included = path.resolve(path.dirname(canonicalFile), requested);
        let resolved: string | undefined;
        try {
          resolved = fs.realpathSync(included);
        } catch {
          // Report the same incomplete-coverage error as an out-of-root include.
        }
        if (!resolved || !isWithinRoot(root, resolved)) {
          errors.push({
            file: rel,
            code: 'UNSUPPORTED_FORMAT',
            message: `Python requirement include cannot be resolved within the repository: ${requested}`,
          });
        } else {
          parseRequirements(root, resolved, coordinates, errors, visited);
        }
        continue;
      }
      if (/^(?:-e(?:\s|$)|--editable(?:=|\s))/.test(line)) {
        errors.push({
          file: rel,
          code: 'UNSUPPORTED_FORMAT',
          message: `Python requirement directive is not followed automatically: ${line.slice(0, 120)}`,
        });
        continue;
      }
      if (line.startsWith('-')) {continue;}
      const match = line.match(
        /^([A-Za-z0-9_.-]+)(?:\s*\[\s*[A-Za-z0-9_.-]+(?:\s*,\s*[A-Za-z0-9_.-]+)*\s*\])?\s*==\s*([A-Za-z0-9][A-Za-z0-9._!+-]*)(?:\s|;|$)/
      );
      if (!match) {
        errors.push({ file: rel, code: 'UNRESOLVED_VERSION', message: `Python requirement is not pinned: ${line.slice(0, 120)}` });
        continue;
      }
      addCoordinate(coordinates, {
        ecosystem: 'pip', osvEcosystem: 'PyPI', name: match[1], exactVersion: match[2],
        scope: 'runtime', direct: true, manifestPath: rel, lockfilePath: rel, dependencyPaths: [match[1]],
      });
    }
  } catch (error: unknown) {
    errors.push({
      file: rel,
      code: 'INVALID_MANIFEST',
      message: `Unable to parse requirements.txt: ${errorMessage(error)}`,
    });
  }
  if (rootRequirementsFile) {
    errors.push({
      file: rel,
      code: 'UNSUPPORTED_FORMAT',
      message: 'requirements.txt inventory is direct-only; transitive coverage is incomplete without a lock export',
    });
  }
}

function parseGoMod(
  root: string,
  file: string,
  coordinates: DependencyCoordinate[],
  errors: PackageInventoryError[]
): void {
  const rel = relative(root, file);
  try {
    type GoRequirement = {
      name: string;
      version: string;
      direct: boolean;
    };
    type GoReplacement = {
      oldName: string;
      oldVersion?: string;
      newName?: string;
      newVersion?: string;
      localPath?: string;
    };

    const requirements: GoRequirement[] = [];
    const replacements: GoReplacement[] = [];
    let declaredGoVersion: string | undefined;
    let inRequire = false;
    let inReplace = false;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      const goDirective = line.match(/^go\s+(\d+)\.(\d+)(?:\.\d+)?$/);
      if (goDirective) {
        declaredGoVersion = `${goDirective[1]}.${goDirective[2]}`;
        continue;
      }
      if (line === 'require (') {inRequire = true; continue;}
      if (inRequire && line === ')') {inRequire = false; continue;}
      if (line === 'replace (') {inReplace = true; continue;}
      if (inReplace && line === ')') {inReplace = false; continue;}

      const isReplaceLine = inReplace || /^replace\s+/.test(line);
      if (isReplaceLine) {
        const content = line.replace(/^replace\s+/, '').replace(/\s+\/\/.*$/, '').trim();
        const [left, right, ...extra] = content.split(/\s*=>\s*/);
        const oldParts = left?.trim().split(/\s+/).filter(Boolean) || [];
        const newParts = right?.trim().split(/\s+/).filter(Boolean) || [];
        const validOld = oldParts.length === 1 || (oldParts.length === 2 && /^v\S+$/.test(oldParts[1]));
        const localPath = newParts.length === 1 && /^(?:\.{1,2}(?:\/|$)|\/)/.test(newParts[0]);
        const validRemote = newParts.length === 2 && /^v\S+$/.test(newParts[1]);
        if (extra.length > 0 || !validOld || (!localPath && !validRemote)) {
          errors.push({
            file: rel,
            code: 'UNSUPPORTED_FORMAT',
            message: `Go replacement is not supported: ${line.slice(0, 120)}`,
          });
          continue;
        }
        replacements.push({
          oldName: oldParts[0],
          oldVersion: oldParts[1],
          newName: validRemote ? newParts[0] : undefined,
          newVersion: validRemote ? newParts[1] : undefined,
          localPath: localPath ? newParts[0] : undefined,
        });
        continue;
      }

      const isRequireLine = inRequire || /^require\s+/.test(line);
      if (!isRequireLine) {continue;}
      const content = line.replace(/^require\s+/, '');
      const withoutComment = content.replace(/\s+\/\/.*$/, '').trim();
      if (!withoutComment) {continue;}
      const match = withoutComment.match(/^([^\s]+)\s+(v[^\s]+)$/);
      if (!match) {
        errors.push({
          file: rel,
          code: 'UNRESOLVED_VERSION',
          message: `Go requirement is not pinned to an exact version: ${line.slice(0, 120)}`,
        });
        continue;
      }
      requirements.push({
        name: match[1],
        version: match[2],
        direct: !line.includes('// indirect'),
      });
    }

    for (const requirement of requirements) {
      const matchingReplacements = [...replacements].reverse().filter(candidate =>
        candidate.oldName === requirement.name
      );
      const replacement = matchingReplacements.find(candidate =>
        candidate.oldVersion === requirement.version
      ) || matchingReplacements.find(candidate => candidate.oldVersion === undefined);
      if (replacement?.localPath) {
        errors.push({
          file: rel,
          code: 'UNSUPPORTED_FORMAT',
          message: `Go requirement ${requirement.name} is replaced by local path ${replacement.localPath}`,
        });
        continue;
      }
      const name = replacement?.newName || requirement.name;
      const version = replacement?.newVersion || requirement.version;
      addCoordinate(coordinates, {
        ecosystem: 'go', osvEcosystem: 'Go', name, exactVersion: version,
        scope: 'runtime', direct: requirement.direct, manifestPath: rel, lockfilePath: rel,
        dependencyPaths: [replacement ? `${requirement.name} => ${name}` : name],
      });
    }
    if (!declaredGoVersion) {
      errors.push({
        file: rel,
        code: 'UNSUPPORTED_FORMAT',
        message: 'go.mod has no Go directive and therefore defaults to Go 1.16, which does not guarantee a complete transitive build list',
      });
    } else {
      const [major, minor] = declaredGoVersion.split('.').map(Number);
      if (major < 1 || (major === 1 && minor < 17)) {
        errors.push({
          file: rel,
          code: 'UNSUPPORTED_FORMAT',
          message: `go.mod declares Go ${declaredGoVersion}; versions before 1.17 do not guarantee a complete transitive build list`,
        });
      }
    }
  } catch (error: unknown) {
    errors.push({
      file: rel,
      code: 'INVALID_MANIFEST',
      message: `Unable to parse go.mod: ${errorMessage(error)}`,
    });
  }
}

function parseCargoLock(root: string, file: string, coordinates: DependencyCoordinate[], errors: PackageInventoryError[]): void {
  const rel = relative(root, file);
  const lockDirectory = path.dirname(file);
  type CargoDependency = {name: string; version?: string; source?: string};
  type CargoNode = {
    key: string;
    name: string;
    version: string;
    source?: string;
    dependencies: CargoDependency[];
  };
  type CargoDirect = {scope: DependencyScope; manifestPath: string; requested?: string};
  const registrySource = /^(?:registry\+https:\/\/(?:github\.com\/rust-lang\/crates\.io-index|index\.crates\.io\/?)|sparse\+https:\/\/index\.crates\.io\/?)$/;
  const scopeRank: Record<DependencyScope, number> = {unknown: 0, development: 1, optional: 2, runtime: 3};
  try {
    const blocks = fs.readFileSync(file, 'utf8').split(/\[\[package\]\]/).slice(1);
    const nodes: CargoNode[] = [];
    for (const block of blocks) {
      const name = block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
      const version = block.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
      const source = block.match(/^\s*source\s*=\s*"([^"]+)"/m)?.[1];
      if (!name || !version) {continue;}
      const dependencies = [...(block.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m)?.[1] || '')
        .matchAll(/"([^"]+)"|'([^']+)'/g)]
        .map(match => match[1] || match[2])
        .map((value): CargoDependency | undefined => {
          const parsed = value.match(/^(\S+?)(?:\s+(\S+?))?(?:\s+\((.+)\))?$/);
          return parsed ? {name: parsed[1], version: parsed[2], source: parsed[3]} : undefined;
        })
        .filter((dependency): dependency is CargoDependency => dependency !== undefined);
      nodes.push({key: `${name}\0${version}\0${source || ''}`, name, version, source, dependencies});
    }

    const rootManifest = path.join(lockDirectory, 'Cargo.toml');
    const workspaceDefinitions = new Map<string, {name: string; requested?: string; local: boolean}>();
    const parseDependencyValue = (installName: string, rawValue: string) => {
      const packageName = rawValue.match(/\bpackage\s*=\s*["']([^"']+)["']/)?.[1] || installName;
      const directVersion = rawValue.match(/^\s*["']([^"']+)["']\s*$/)?.[1];
      const tableVersion = rawValue.match(/\bversion\s*=\s*["']([^"']+)["']/)?.[1];
      const workspace = /\bworkspace\s*=\s*true\b/.test(rawValue);
      const inherited = workspaceDefinitions.get(installName);
      return {
        name: workspace ? inherited?.name || packageName : packageName,
        requested: workspace ? inherited?.requested : directVersion || tableVersion,
        local: workspace ? inherited?.local === true : /\b(?:path|git)\s*=/.test(rawValue),
      };
    };
    const manifestLines = (manifest: string): Array<{section: string; name: string; value: string}> => {
      const records: Array<{section: string; name: string; value: string}> = [];
      let section = '';
      for (const rawLine of stripTomlComments(fs.readFileSync(manifest, 'utf8')).split(/\r?\n/)) {
        const sectionMatch = rawLine.trim().match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {section = sectionMatch[1].trim(); continue;}
        const dependency = rawLine.match(/^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\s*=\s*(.+)$/);
        if (dependency) {
          records.push({section, name: dependency[1] || dependency[2] || dependency[3], value: dependency[4].trim()});
        }
      }
      return records;
    };
    const manifestDependencies = (manifest: string): Array<{section: string; name: string; value: string}> => {
      const records = manifestLines(manifest);
      const dependencies = records.filter(record =>
        record.section === 'workspace.dependencies' ||
        record.section === 'dependencies' ||
        record.section === 'dev-dependencies' ||
        record.section === 'build-dependencies' ||
        record.section.endsWith('.dependencies') ||
        record.section.endsWith('.dev-dependencies') ||
        record.section.endsWith('.build-dependencies')
      );
      const tableValues = new Map<string, typeof records>();
      for (const record of records) {
        const match = record.section.match(/^(?:(.*)\.)?(dependencies|dev-dependencies|build-dependencies)\.([^.]+)$/);
        if (!match) {continue;}
        const values = tableValues.get(record.section) || [];
        values.push(record);
        tableValues.set(record.section, values);
      }
      for (const [section, values] of tableValues) {
        const match = section.match(/^(?:(.*)\.)?(dependencies|dev-dependencies|build-dependencies)\.([^.]+)$/)!;
        const prefix = match[1] ? `${match[1]}.` : '';
        dependencies.push({
          section: `${prefix}${match[2]}`,
          name: match[3].replace(/^["']|["']$/g, ''),
          value: `{ ${values.map(value => `${value.name} = ${value.value}`).join(', ')} }`,
        });
      }
      return dependencies;
    };
    if (fs.existsSync(rootManifest)) {
      for (const record of manifestDependencies(rootManifest).filter(record => record.section === 'workspace.dependencies')) {
        workspaceDefinitions.set(record.name, parseDependencyValue(record.name, record.value));
      }
    }

    const manifests = new Set<string>();
    if (fs.existsSync(rootManifest)) {manifests.add(rootManifest);}
    const members = fs.existsSync(rootManifest) ? cargoWorkspacePatterns(rootManifest, 'members') : [];
    const excluded = fs.existsSync(rootManifest) ? cargoWorkspacePatterns(rootManifest, 'exclude') : [];
    if (members.length > 0) {
      const visitManifests = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
          if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) {continue;}
          const child = path.join(directory, entry.name);
          const candidate = path.join(child, 'Cargo.toml');
          const relativeDirectory = relative(lockDirectory, child);
          if (fs.existsSync(candidate) &&
            members.some(pattern => yarnWorkspacePatternMatches(pattern, relativeDirectory)) &&
            !excluded.some(pattern => yarnWorkspacePatternMatches(pattern, relativeDirectory))) {
            manifests.add(candidate);
          }
          visitManifests(child);
        }
      };
      visitManifests(lockDirectory);
    }

    const requirementMatches = (requested: string | undefined, version: string): boolean => {
      if (!requested || requested === '*') {return true;}
      const normalized = requested.replace(/,/g, ' ').trim();
      const range = semver.valid(normalized, {loose: true})
        ? `^${normalized}`
        : normalized.startsWith('=')
          ? normalized.slice(1)
          : normalized;
      return semver.satisfies(version, range, {includePrerelease: true, loose: true});
    };
    const directByNode = new Map<string, CargoDirect>();
    for (const manifest of manifests) {
      const records = manifestLines(manifest);
      const packageName = records.find(record => record.section === 'package' && record.name === 'name')
        ?.value.match(/^["']([^"']+)["']$/)?.[1];
      const packageVersion = records.find(record => record.section === 'package' && record.name === 'version')
        ?.value.match(/^["']([^"']+)["']$/)?.[1];
      const manifestRoots = nodes.filter(node => !node.source && node.name === packageName &&
        (!packageVersion || node.version === packageVersion));
      for (const record of manifestDependencies(manifest)) {
        const development = record.section === 'dev-dependencies' || record.section.endsWith('.dev-dependencies');
        const runtime = record.section === 'dependencies' || record.section === 'build-dependencies' ||
          record.section.endsWith('.dependencies') || record.section.endsWith('.build-dependencies');
        if ((!development && !runtime) || record.section.startsWith('workspace.')) {continue;}
        const parsed = parseDependencyValue(record.name, record.value);
        if (parsed.local) {continue;}
        const lockedRoots = manifestRoots.flatMap(node => node.dependencies)
          .filter(dependency => dependency.name === parsed.name)
          .map(lockedDependency => nodes.filter(node => node.name === lockedDependency.name &&
            (!lockedDependency.version || node.version === lockedDependency.version) &&
            (!lockedDependency.source || node.source === lockedDependency.source)))
          .flat();
        const pool = manifestRoots.length > 0 ? lockedRoots : nodes;
        const candidates = pool.filter(node => node.source && registrySource.test(node.source) &&
          node.name === parsed.name && requirementMatches(parsed.requested, node.version));
        if (candidates.length === 0) {
          errors.push({
            file: relative(root, manifest),
            code: 'UNRESOLVED_VERSION',
            message: `Cargo dependency ${record.name}${parsed.requested ? ` ${parsed.requested}` : ''} is not satisfied by Cargo.lock`,
          });
          continue;
        }
        for (const candidate of candidates) {
          const next = {scope: development ? 'development' as const : 'runtime' as const,
            manifestPath: relative(root, manifest), requested: parsed.requested};
          const existing = directByNode.get(candidate.key);
          if (!existing || scopeRank[next.scope] > scopeRank[existing.scope]) {directByNode.set(candidate.key, next);}
        }
      }
    }

    const resolveDependency = (dependency: CargoDependency): CargoNode | undefined => {
      const candidates = nodes.filter(node => node.name === dependency.name &&
        (!dependency.version || node.version === dependency.version) &&
        (!dependency.source || node.source === dependency.source));
      return candidates.length === 1 ? candidates[0] : undefined;
    };
    const pathsByNode = new Map<string, Set<string>>();
    const scopeByNode = new Map<string, DependencyScope>();
    const identity = (node: CargoNode): string => `${node.name}@${node.version}`;
    const visit = (node: CargoNode, currentPath: string, stack: Set<string>, rootScope: DependencyScope): void => {
      const paths = pathsByNode.get(node.key) || new Set<string>();
      if (paths.has(currentPath)) {return;}
      paths.add(currentPath);
      pathsByNode.set(node.key, paths);
      const existingScope = scopeByNode.get(node.key) || 'unknown';
      if (scopeRank[rootScope] > scopeRank[existingScope]) {scopeByNode.set(node.key, rootScope);}
      if (stack.has(node.key)) {return;}
      const nextStack = new Set(stack).add(node.key);
      for (const dependency of [...node.dependencies].sort((left, right) =>
        `${left.name}\0${left.version || ''}`.localeCompare(`${right.name}\0${right.version || ''}`))) {
        const child = resolveDependency(dependency);
        if (child) {visit(child, `${currentPath} > ${identity(child)}`, nextStack, rootScope);}
      }
    };
    for (const node of nodes) {
      const direct = directByNode.get(node.key);
      if (direct) {visit(node, identity(node), new Set(), direct.scope);}
    }

    for (const node of nodes) {
      if (!node.source) {continue;}
      if (!registrySource.test(node.source)) {
        errors.push({
          file: rel,
          code: 'UNSUPPORTED_FORMAT',
          message: `Cargo package ${node.name} uses a non-crates.io source: ${node.source.slice(0, 120)}`,
        });
        continue;
      }
      const direct = directByNode.get(node.key);
      addCoordinate(coordinates, {
        ecosystem: 'cargo', osvEcosystem: 'crates.io', name: node.name, exactVersion: node.version,
        scope: direct?.scope || scopeByNode.get(node.key) || 'unknown', direct: direct !== undefined,
        manifestPath: direct?.manifestPath || relative(root, rootManifest), lockfilePath: rel,
        dependencyPaths: pathsByNode.get(node.key) ? [...pathsByNode.get(node.key)!].sort() : [identity(node)],
      });
    }
  } catch (error: unknown) {
    errors.push({ file: rel, code: 'INVALID_MANIFEST', message: `Unable to parse Cargo.lock: ${errorMessage(error)}` });
  }
}

function parseGemfileLock(
  root: string,
  file: string,
  coordinates: DependencyCoordinate[],
  errors: PackageInventoryError[]
): void {
  const rel = relative(root, file);
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const manifest = path.join(path.dirname(file), 'Gemfile');
    const manifestPath = relative(root, manifest);
    type GemRequirement = {name: string; requested?: string; scope: DependencyScope; local: boolean};
    type GemNode = {key: string; name: string; version: string; dependencies: Array<{name: string; requested?: string}>};
    const scopeRank: Record<DependencyScope, number> = {unknown: 0, development: 1, optional: 2, runtime: 3};
    const requirements = new Map<string, GemRequirement>();
    if (fs.existsSync(manifest)) {
      const blocks: Array<{groups: string[]}> = [];
      for (const rawLine of fs.readFileSync(manifest, 'utf8').split(/\r?\n/)) {
        const line = rawLine.replace(/\s+#.*$/, '').trim();
        const group = line.match(/^group\s+(.+?)\s+do\s*$/);
        if (group) {
          blocks.push({groups: [...group[1].matchAll(/:([A-Za-z0-9_]+)/g)].map(match => match[1])});
          continue;
        }
        if (/^end\b/.test(line)) {blocks.pop(); continue;}
        const gem = line.match(/^gem\s*(?:\(\s*)?['"]([^'"]+)['"](.*)$/);
        if (!gem) {continue;}
        const tail = gem[2];
        const requested = tail.match(/^\s*,\s*['"]([^'"]+)['"]/)?.[1];
        const inlineGroups = [...tail.matchAll(/(?:groups?|:group)\s*(?:=>|:)\s*(?:\[([^\]]+)\]|:([A-Za-z0-9_]+)|['"]([^'"]+)['"])/g)]
          .flatMap(match => match[1]
            ? [...match[1].matchAll(/:?([A-Za-z0-9_]+)/g)].map(value => value[1])
            : [match[2] || match[3]])
          .filter(Boolean);
        const groups = [...blocks.flatMap(block => block.groups), ...inlineGroups];
        const scope: DependencyScope = groups.length > 0 && groups.every(value => ['development', 'test'].includes(value))
          ? 'development'
          : 'runtime';
        const next: GemRequirement = {
          name: gem[1], requested, scope,
          local: /(?:^|,)\s*(?:git|github|path)\s*(?:=>|:)/.test(tail),
        };
        const existing = requirements.get(next.name);
        if (!existing || scopeRank[next.scope] > scopeRank[existing.scope]) {requirements.set(next.name, next);}
      }
    }
    const platforms: string[] = [];
    let inPlatforms = false;
    for (const line of lines) {
      if (line === 'PLATFORMS') {inPlatforms = true; continue;}
      if (inPlatforms && line && !/^\s/.test(line)) {inPlatforms = false;}
      const platform = inPlatforms ? line.match(/^\s{2}(\S+)\s*$/)?.[1] : undefined;
      if (platform && platform !== 'ruby') {platforms.push(platform);}
    }
    let inSpecs = false;
    let source: 'GEM' | 'GIT' | 'PATH' | undefined;
    const reportedUnsupported = new Set<'GIT' | 'PATH'>();
    const nodes: GemNode[] = [];
    let currentNode: GemNode | undefined;
    for (const line of lines) {
      const section = line.match(/^(GEM|GIT|PATH)\s*$/)?.[1] as 'GEM' | 'GIT' | 'PATH' | undefined;
      if (section) {source = section; inSpecs = false; continue;}
      if (/^\s{2}specs:$/.test(line)) {
        inSpecs = true;
        if (source === 'GIT' || source === 'PATH') {
          if (!reportedUnsupported.has(source)) {
            errors.push({
              file: rel,
              code: 'UNSUPPORTED_FORMAT',
              message: `Gemfile.lock ${source} dependency source is not a RubyGems registry coordinate`,
            });
            reportedUnsupported.add(source);
          }
        }
        continue;
      }
      if (inSpecs && line && !/^\s/.test(line)) {inSpecs = false; currentNode = undefined;}
      if (!inSpecs || source !== 'GEM') {continue;}
      const match = line.match(/^\s{4}([A-Za-z0-9_.-]+) \(([^ )]+)\)/);
      if (match) {
        const platform = [...platforms].sort((left, right) => right.length - left.length)
          .find(candidate => match[2].endsWith(`-${candidate}`));
        const version = platform ? match[2].slice(0, -(platform.length + 1)) : match[2];
        currentNode = {key: `${match[1]}\0${version}`, name: match[1], version, dependencies: []};
        nodes.push(currentNode);
        continue;
      }
      const dependency = line.match(/^\s{6}([A-Za-z0-9_.-]+)(?: \(([^)]+)\))?/);
      if (dependency && currentNode) {
        currentNode.dependencies.push({name: dependency[1], requested: dependency[2]});
      }
    }

    const rubyRequirementMatches = (requested: string | undefined, version: string): boolean => {
      if (!requested) {return true;}
      const candidate = semver.valid(version, {loose: true});
      if (!candidate) {return requested.trim().replace(/^=+\s*/, '') === version;}
      return requested.split(',').every(raw => {
        const requirement = raw.trim();
        const pessimistic = requirement.match(/^~>\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
        if (pessimistic) {
          const parts = pessimistic.slice(1).filter(value => value !== undefined).map(Number);
          const lower = `${parts[0]}.${parts[1] || 0}.${parts[2] || 0}`;
          const upper = parts.length >= 3
            ? `${parts[0]}.${(parts[1] || 0) + 1}.0`
            : `${parts[0] + 1}.0.0`;
          return semver.gte(candidate, lower) && semver.lt(candidate, upper);
        }
        const normalized = requirement.replace(/^=\s*/, '');
        return semver.satisfies(candidate, normalized, {includePrerelease: true, loose: true});
      });
    };
    const dependencyRoots = new Map<string, string | undefined>();
    let inDependencies = false;
    for (const line of lines) {
      if (line === 'DEPENDENCIES') {inDependencies = true; continue;}
      if (inDependencies && line && !/^\s/.test(line)) {inDependencies = false;}
      if (!inDependencies) {continue;}
      const match = line.match(/^\s{2}([A-Za-z0-9_.-]+)(?: \(([^)]+)\))?(!)?\s*$/);
      if (match && !match[3]) {dependencyRoots.set(match[1], match[2]);}
    }
    for (const requirement of requirements.values()) {
      if (requirement.local) {continue;}
      const locked = nodes.some(node => node.name === requirement.name &&
        rubyRequirementMatches(requirement.requested, node.version));
      if (!dependencyRoots.has(requirement.name) || !locked) {
        errors.push({
          file: manifestPath,
          code: 'UNRESOLVED_VERSION',
          message: `Gem dependency ${requirement.name}${requirement.requested ? ` ${requirement.requested}` : ''} is not satisfied by Gemfile.lock`,
        });
      }
    }
    const directByNode = new Map<string, DependencyScope>();
    for (const [name, requested] of dependencyRoots) {
      for (const node of nodes.filter(candidate => candidate.name === name && rubyRequirementMatches(requested, candidate.version))) {
        directByNode.set(node.key, requirements.get(name)?.scope || 'unknown');
      }
    }
    const resolveDependency = (dependency: {name: string; requested?: string}): GemNode | undefined => {
      const candidates = nodes.filter(node => node.name === dependency.name &&
        rubyRequirementMatches(dependency.requested, node.version));
      return candidates.length === 1 ? candidates[0] : undefined;
    };
    const pathsByNode = new Map<string, Set<string>>();
    const scopesByNode = new Map<string, DependencyScope>();
    const identity = (node: GemNode): string => `${node.name}@${node.version}`;
    const visit = (node: GemNode, currentPath: string, stack: Set<string>, scope: DependencyScope): void => {
      const paths = pathsByNode.get(node.key) || new Set<string>();
      if (paths.has(currentPath)) {return;}
      paths.add(currentPath);
      pathsByNode.set(node.key, paths);
      const existing = scopesByNode.get(node.key) || 'unknown';
      if (scopeRank[scope] > scopeRank[existing]) {scopesByNode.set(node.key, scope);}
      if (stack.has(node.key)) {return;}
      const nextStack = new Set(stack).add(node.key);
      for (const dependency of node.dependencies) {
        const child = resolveDependency(dependency);
        if (child) {visit(child, `${currentPath} > ${identity(child)}`, nextStack, scope);}
      }
    };
    for (const node of nodes) {
      const directScope = directByNode.get(node.key);
      if (directScope) {visit(node, identity(node), new Set(), directScope);}
    }
    for (const node of nodes) {
      const directScope = directByNode.get(node.key);
      addCoordinate(coordinates, {
        ecosystem: 'ruby', osvEcosystem: 'RubyGems', name: node.name, exactVersion: node.version,
        scope: directScope || scopesByNode.get(node.key) || 'unknown', direct: directScope !== undefined,
        manifestPath, lockfilePath: rel,
        dependencyPaths: pathsByNode.get(node.key) ? [...pathsByNode.get(node.key)!].sort() : [identity(node)],
      });
    }
  } catch (error: unknown) {
    errors.push({
      file: rel,
      code: 'INVALID_MANIFEST',
      message: `Unable to parse Gemfile.lock: ${errorMessage(error)}`,
    });
  }
}

function parsePom(root: string, file: string, coordinates: DependencyCoordinate[], errors: PackageInventoryError[]): void {
  const rel = relative(root, file);
  try {
    let xml = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    // Dependency declarations in comments, build plugins, and inactive profiles
    // are not application dependencies of the effective project model.
    const profileSections = xml.match(/<profiles(?:\s[^>]*)?>[\s\S]*?<\/profiles>/gi) || [];
    const hasProfileDependencies = profileSections.some(section => /<dependency(?:\s[^>]*)?>/i.test(section));
    if (hasProfileDependencies) {
      errors.push({
        file: rel,
        code: 'UNSUPPORTED_FORMAT',
        message: 'Maven profile dependencies require effective-model resolution',
      });
    }
    xml = xml
      .replace(/<build(?:\s[^>]*)?>[\s\S]*?<\/build>/gi, '')
      .replace(/<profiles(?:\s[^>]*)?>[\s\S]*?<\/profiles>/gi, '')
      .replace(/<reporting(?:\s[^>]*)?>[\s\S]*?<\/reporting>/gi, '');
    const properties = new Map<string, string>();
    const propertiesBlock = xml.match(/<properties(?:\s[^>]*)?>([\s\S]*?)<\/properties>/)?.[1] || '';
    const propertyPattern = /<([A-Za-z_][A-Za-z0-9_.-]*)>\s*([^<]+?)\s*<\/\1>/g;
    for (const match of propertiesBlock.matchAll(propertyPattern)) {
      properties.set(match[1], match[2].trim());
    }
    const exactVersion = (value: string): string | undefined => {
      const normalized = value.trim();
      if (!normalized || normalized.includes('${') || normalized.includes('[') || normalized.includes(']') || /[(),]/.test(normalized) || /&[^;]+;/.test(normalized)) {return undefined;}
      if (/^(?:LATEST|RELEASE)$/i.test(normalized)) {return undefined;}
      return normalized;
    };
    const resolveVersion = (raw: string | undefined): string | undefined => {
      let value = raw?.trim();
      const visited = new Set<string>();
      while (value) {
        const property = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_.-]*)\}$/)?.[1];
        if (!property) {return exactVersion(value);}
        if (visited.has(property)) {return undefined;}
        visited.add(property);
        value = properties.get(property)?.trim();
      }
      return undefined;
    };
    const dependencyName = (block: string): { group?: string; artifact?: string; name?: string } => {
      const group = block.match(/<groupId>\s*([^<\s]+)\s*<\/groupId>/)?.[1];
      const artifact = block.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/)?.[1];
      return { group, artifact, name: group && artifact ? `${group}:${artifact}` : undefined };
    };
    const managedVersions = new Map<string, string | undefined>();
    const dependencyManagementPattern = /<dependencyManagement(?:\s[^>]*)?>[\s\S]*?<\/dependencyManagement>/g;
    const dependencyManagement = xml.match(dependencyManagementPattern) || [];
    for (const section of dependencyManagement) {
      for (const block of section.match(/<dependency(?:\s[^>]*)?>[\s\S]*?<\/dependency>/g) || []) {
        const { name } = dependencyName(block);
        const version = resolveVersion(block.match(/<version>\s*([^<]+?)\s*<\/version>/)?.[1]);
        if (name) {managedVersions.set(name, version);}
      }
    }
    const dependencies = xml.replace(dependencyManagementPattern, '');
    const dependencyBlocks = dependencies.match(/<dependency(?:\s[^>]*)?>[\s\S]*?<\/dependency>/g) || [];
    for (const block of dependencyBlocks) {
      const { group, artifact, name } = dependencyName(block);
      const declaredVersion = block.match(/<version>\s*([^<]+?)\s*<\/version>/)?.[1];
      const version = declaredVersion ? resolveVersion(declaredVersion) : name ? managedVersions.get(name) : undefined;
      if (!group || !artifact || !name) {continue;}
      if (!version) {
        errors.push({
          file: rel,
          code: 'UNRESOLVED_VERSION',
          message: `Maven dependency version is unresolved for ${name}`,
        });
        continue;
      }
      addCoordinate(coordinates, {
        ecosystem: 'maven', osvEcosystem: 'Maven', name, exactVersion: version,
        scope: /<scope>\s*test\s*<\/scope>/.test(block) ? 'development' : 'runtime', direct: true,
        manifestPath: rel, lockfilePath: rel, dependencyPaths: [name],
      });
    }
    if (dependencyBlocks.length > 0) {
      errors.push({
        file: rel,
        code: 'UNSUPPORTED_FORMAT',
        message: 'Maven dependency inventory is direct-POM-only; transitive coverage requires effective-model resolution',
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
    const key = [
      coordinate.ecosystem,
      coordinate.name,
      coordinate.exactVersion,
      coordinate.lockfilePath,
    ].join('\0');
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
    `${a.osvEcosystem}\0${a.name}\0${a.exactVersion}\0${a.lockfilePath}\0${a.scope}`.localeCompare(
      `${b.osvEcosystem}\0${b.name}\0${b.exactVersion}\0${b.lockfilePath}\0${b.scope}`
    )
  );
}

function inventoryDigest(coordinates: DependencyCoordinate[]): string {
  return createHash('sha256').update(JSON.stringify(coordinates.map(coordinate => ({
    ecosystem: coordinate.osvEcosystem,
    name: coordinate.name,
    version: coordinate.exactVersion,
    lockfilePath: coordinate.lockfilePath,
    scope: coordinate.scope,
  })))).digest('hex');
}

function ecosystemForInventoryFile(file: string): PackageEcosystem | undefined {
  switch (path.basename(file)) {
    case 'package-lock.json':
    case 'npm-shrinkwrap.json':
    case 'package.json':
    case 'pnpm-lock.yaml':
    case 'yarn.lock':
      return 'npm';
    case 'requirements.txt':
      return 'pip';
    case 'go.mod':
      return 'go';
    case 'Gemfile.lock':
    case 'Gemfile':
      return 'ruby';
    case 'Cargo.lock':
    case 'Cargo.toml':
      return 'cargo';
    case 'pom.xml':
      return 'maven';
    default:
      return undefined;
  }
}

function stripTomlComments(content: string): string {
  let result = '';
  let quote: '"' | "'" | undefined;
  let multiline = false;
  let escaped = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (quote) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (quote === '"' && character === '\\') {
        escaped = true;
      } else if (multiline && content.slice(index, index + 3) === quote.repeat(3)) {
        result += content.slice(index + 1, index + 3);
        index += 2;
        quote = undefined;
        multiline = false;
      } else if (!multiline && character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      multiline = content.slice(index, index + 3) === character.repeat(3);
      result += multiline ? content.slice(index, index + 3) : character;
      if (multiline) {index += 2;}
      continue;
    }
    if (character === '#') {
      while (index < content.length && content[index] !== '\n') {index++;}
      if (index < content.length) {result += '\n';}
      continue;
    }
    result += character;
  }
  return result;
}

function cargoWorkspacePatterns(manifest: string, key: 'members' | 'exclude'): string[] {
  try {
    const content = stripTomlComments(fs.readFileSync(manifest, 'utf8'));
    const section = content.match(/(?:^|\n)\s*\[workspace\]\s*\n([\s\S]*?)(?=\n\s*\[[^\]]+\]|$)/)?.[1];
    const array = section?.match(new RegExp(`(?:^|\\n)\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`))?.[1];
    if (!array) {return [];}
    return [...array.matchAll(/"([^"]+)"|'([^']+)'/g)].map(match => match[1] || match[2]);
  } catch {
    return [];
  }
}

function hasCoveringCargoLock(root: string, manifest: string, inventoryFiles: ReadonlySet<string>): boolean {
  const manifestDirectory = path.dirname(manifest);
  let directory = path.dirname(manifest);
  while (isWithinRoot(root, directory)) {
    if (inventoryFiles.has(path.join(directory, 'Cargo.lock'))) {
      if (directory === manifestDirectory) {return true;}
      const workspaceManifest = path.join(directory, 'Cargo.toml');
      const relativeDirectory = relative(directory, manifestDirectory);
      const members = cargoWorkspacePatterns(workspaceManifest, 'members');
      const excluded = cargoWorkspacePatterns(workspaceManifest, 'exclude');
      if (members.some(pattern => yarnWorkspacePatternMatches(pattern, relativeDirectory)) &&
        !excluded.some(pattern => yarnWorkspacePatternMatches(pattern, relativeDirectory))) {
        return true;
      }
    }
    if (directory === root) {break;}
    directory = path.dirname(directory);
  }
  return false;
}

export function filterPackageInventory(inventory: PackageInventory, filter: PackageInventoryFilter): PackageInventory {
  const coordinates = inventory.coordinates.filter(coordinate =>
    (!filter.ecosystems || filter.ecosystems.includes(coordinate.ecosystem)) &&
    (filter.scope !== 'runtime' || coordinate.scope !== 'development')
  );
  const errors = inventory.errors.filter(error => {
    if (!filter.ecosystems) {return true;}
    const ecosystem = error.ecosystem || ecosystemForInventoryFile(error.file);
    return ecosystem === undefined || filter.ecosystems.includes(ecosystem);
  });
  return { ...inventory, coordinates, errors, digest: inventoryDigest(coordinates) };
}

export function collectPackageInventory(repoPath: string = process.cwd()): PackageInventory {
  const root = fs.realpathSync(repoPath);
  if (!fs.statSync(root).isDirectory()) {throw new Error(`Repository path is not a directory: ${repoPath}`);}
  const coordinates: DependencyCoordinate[] = [];
  const errors: PackageInventoryError[] = [];
  const files = findInventoryFiles(root, errors).filter(file => {
    try {
      return isWithinRoot(root, fs.realpathSync(file));
    } catch (error: unknown) {
      errors.push({
        file: relative(root, file),
        code: 'INVALID_MANIFEST',
        message: `Unable to resolve inventory file: ${errorMessage(error)}`,
      });
      return false;
    }
  });
  const names = new Set(files.map(file => relative(root, file)));
  const inventoryFiles = new Set(files);
  const workspacePackagesByLock = new Map<string, Map<string, string | undefined>>();

  for (const file of files) {
    const name = path.basename(file);
    if (name === 'package-lock.json' || name === 'npm-shrinkwrap.json') {parseNpmLock(root, file, coordinates, errors);}
    else if (name === 'pnpm-lock.yaml') {parsePnpmLock(root, file, coordinates, errors);}
    else if (name === 'yarn.lock') {parseYarnLock(root, file, coordinates, errors);}
    else if (name === 'requirements.txt') {parseRequirements(root, file, coordinates, errors);}
    else if (name === 'go.mod') {parseGoMod(root, file, coordinates, errors);}
    else if (name === 'Cargo.lock') {parseCargoLock(root, file, coordinates, errors);}
    else if (name === 'Gemfile.lock') {parseGemfileLock(root, file, coordinates, errors);}
    else if (name === 'Cargo.toml' && !hasCoveringCargoLock(root, file, inventoryFiles)) {
      errors.push({file: relative(root, file), code: 'UNSUPPORTED_FORMAT', message: 'Cargo.toml has no adjacent Cargo.lock or ancestor workspace lock; dependency coverage is incomplete'});
    }
    else if (name === 'Gemfile' && !inventoryFiles.has(path.join(path.dirname(file), 'Gemfile.lock'))) {
      errors.push({file: relative(root, file), code: 'UNSUPPORTED_FORMAT', message: 'Gemfile has no adjacent Gemfile.lock; dependency coverage is incomplete'});
    }
    else if (name === 'pom.xml') {parsePom(root, file, coordinates, errors);}
  }
  for (const file of files.filter(file => path.basename(file) === 'package.json')) {
    parseExactPackageJson(root, file, coordinates, errors, workspacePackagesByLock);
  }

  const normalized = mergeCoordinates(coordinates);
  const digest = inventoryDigest(normalized);

  return {
    repository: root,
    coordinates: normalized,
    manifests: [...names].sort(),
    errors: errors.map(error => ({
      ...error,
      ecosystem: error.ecosystem || ecosystemForInventoryFile(error.file),
    })),
    digest,
  };
}
