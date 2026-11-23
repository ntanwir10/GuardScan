import * as fs from 'fs';
import {builtinModules} from 'module';
import * as path from 'path';
import ignore from 'ignore';
import yaml from 'js-yaml';
import type * as TypeScript from 'typescript';
import type {Finding} from '../utils/reporter';
import {isRequirementsInventoryFile, isWithinRoot, PackageInventory, readInventoryText} from './package-inventory';

/**
 * Dependency hygiene (unused/missing declarations) and install-script checks.
 * Everything here reads files only: no package manager runs and no project code is loaded.
 */

export const HYGIENE_CATEGORY = 'Dependency hygiene';
export const INSTALL_SCRIPT_CATEGORY = 'Dependency install script';
export const HYGIENE_RULES = {
  missing: 'guardscan.dependency-hygiene.missing',
  unused: 'guardscan.dependency-hygiene.unused',
  uncertain: 'guardscan.dependency-hygiene.uncertain',
  installScript: 'guardscan.dependency.install-script',
  installScriptUndetermined: 'guardscan.dependency.install-script-undetermined',
} as const;

type Ecosystem = 'npm' | 'pip' | 'go';

export interface DependencyInsightFinding extends Finding {
  ruleId: string;
  metadata: Record<string, unknown>;
}

export interface DependencyInsightsCoverage {
  manifestsAnalyzed: Record<Ecosystem, number>;
  /** Declaration manifests the inventory found that these checks do not read. */
  manifestsNotAnalyzed: string[];
  sourceFilesAnalyzed: number;
  /** Unreadable inputs. Any of these make the scanner output partial. */
  sourceFilesSkipped: number;
  /** Inputs above the size cap; their manifests' unused results become uncertain. */
  sourceFilesTooLarge: number;
  uncertain: number;
  installScripts: {lockfilesChecked: number; notDeterminable: string[]};
}

export interface DependencyInsightsReport {
  findings: DependencyInsightFinding[];
  coverage: DependencyInsightsCoverage;
}

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_LISTED = 100;
const IGNORED_DIRS = new Set([
  '.git', '.guardscan', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.venv', 'venv', 'target',
  '__pycache__', '.tox', '.nox', '.mypy_cache', '.pytest_cache', '.eggs', 'site-packages',
]);
const NOT_ANALYZED_MANIFESTS = new Set([
  'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg', 'go.work', 'Cargo.toml', 'Gemfile', 'pom.xml',
]);

interface Run {
  root: string;
  ignored: ReturnType<typeof ignore>;
  coverage: DependencyInsightsCoverage;
  findings: DependencyInsightFinding[];
}

interface UncertainItem {name: string; reason: string}

function rel(run: Run, file: string): string {
  return path.relative(run.root, file).split(path.sep).join('/') || '.';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Resolves symlinks; undefined when the target is missing or outside the scanned repository. */
function insideRoot(run: Run, file: string): string | undefined {
  try {
    const real = fs.realpathSync(file);
    return isWithinRoot(run.root, real) ? real : undefined;
  } catch {
    return undefined;
  }
}

/** Returns undefined (and records why) when a file cannot be analyzed. */
function readSource(run: Run, file: string, limit = MAX_SOURCE_BYTES, declaration = false): string | undefined {
  try {
    if (fs.statSync(file).size > limit) {
      run.coverage.sourceFilesTooLarge += 1;
      // A skipped declaration drops its whole project, so the scanner output is partial.
      if (declaration) {run.coverage.sourceFilesSkipped += 1;}
      return undefined;
    }
    return readInventoryText(file);
  } catch {
    run.coverage.sourceFilesSkipped += 1;
    return undefined;
  }
}

/** Visits files under `start`, skipping symlinks, ignored directories and other projects' roots. */
function walkOwned(
  run: Run,
  start: string,
  skipDirectory: (directory: string, name: string) => boolean,
  visit: (file: string, name: string) => void
): void {
  const stack = [start];
  for (let directory = stack.pop(); directory !== undefined; directory = stack.pop()) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, {withFileTypes: true});
    } catch {
      run.coverage.sourceFilesSkipped += 1;
      continue;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(run.root, absolute).split(path.sep).join('/');
      if (relative && !relative.startsWith('..') && run.ignored.ignores(entry.isDirectory() ? `${relative}/` : relative)) {continue;}
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !skipDirectory(absolute, entry.name)) {stack.push(absolute);}
      } else if (entry.isFile()) {
        visit(absolute, entry.name);
      }
    }
  }
}

function hygieneFinding(
  kind: 'missing' | 'unused',
  ecosystem: Ecosystem,
  manifest: string,
  name: string,
  suggestion: string,
  metadata: Record<string, unknown>
): DependencyInsightFinding {
  return {
    severity: kind === 'missing' ? 'medium' : 'low',
    category: HYGIENE_CATEGORY,
    file: manifest,
    description: kind === 'missing'
      ? `${name} is imported but not declared in ${manifest}`
      : `${name} is declared in ${manifest} but not used`,
    suggestion,
    ruleId: HYGIENE_RULES[kind],
    metadata: {ecosystem, package: name, manifest, ...metadata},
  };
}

function addUncertain(run: Run, ecosystem: Ecosystem, manifest: string, items: UncertainItem[]): void {
  const unique = [...new Map(items.map(item => [`${item.name}\0${item.reason}`, item])).values()]
    .sort((left, right) => left.name.localeCompare(right.name) || left.reason.localeCompare(right.reason));
  if (unique.length === 0) {return;}
  run.coverage.uncertain += unique.length;
  run.findings.push({
    severity: 'info',
    category: HYGIENE_CATEGORY,
    file: manifest,
    description: `Dependency usage in ${manifest} could not be fully determined`,
    suggestion: 'Review the listed names; they were not reported as unused or missing because the evidence is incomplete.',
    ruleId: HYGIENE_RULES.uncertain,
    metadata: {ecosystem, manifest, count: unique.length, items: unique.slice(0, MAX_LISTED)},
  });
}

function listFiles(files: Iterable<string>): string[] {
  return [...new Set(files)].sort().slice(0, 5);
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript

const JS_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);
const UNPARSED_SOURCE_EXTENSIONS = new Set(['.vue', '.svelte', '.astro', '.mdx']);
const NODE_BUILTINS = new Set(
  builtinModules.filter(name => !name.startsWith('node:')).map(name => name.split('/')[0])
);
const DEPENDENCY_GROUPS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'] as const;
type DependencyGroup = typeof DEPENDENCY_GROUPS[number];
const CONFIG_FILE = new RegExp(
  '^(?:\\.eslintrc(?:\\.(?:json|js|cjs|yaml|yml))?|eslint\\.config\\.[cm]?[jt]s|' +
  '\\.babelrc(?:\\.(?:json|js|cjs))?|babel\\.config\\.(?:json|[cm]?[jt]s)|jest\\.config\\.(?:json|[cm]?[jt]s)|' +
  '\\.prettierrc(?:\\.(?:json|json5|yaml|yml|js|cjs|mjs))?|prettier\\.config\\.[cm]?[jt]s|' +
  'postcss\\.config\\.[cm]?[jt]s|\\.postcssrc(?:\\.(?:json|yaml|yml|js|cjs))?|tailwind\\.config\\.[cm]?[jt]s|' +
  'tsconfig(?:\\.[\\w-]+)?\\.json|jsconfig\\.json)$'
);
const PACKAGE_JSON_CONFIG_FIELDS = ['eslintConfig', 'babel', 'jest', 'prettier', 'postcss'];
/** Short config names expand to these package-name prefixes (`react` -> `eslint-plugin-react`). */
const CONFIG_NAME_PREFIXES = [
  'eslint-plugin-', 'eslint-config-', 'babel-plugin-', 'babel-preset-', 'plugin-', 'preset-',
  'prettier-plugin-', 'jest-environment-', 'postcss-',
];
/** Binaries whose name differs from the package that ships them, for repos without lockfile bin data. */
const KNOWN_BINARIES: Readonly<Record<string, string>> = {
  tsc: 'typescript', tsserver: 'typescript', babel: '@babel/cli', ng: '@angular/cli',
  'vue-cli-service': '@vue/cli-service', postcss: 'postcss-cli', playwright: '@playwright/test',
  changeset: '@changesets/cli', commitlint: '@commitlint/cli', swc: '@swc/cli', webpack: 'webpack-cli',
  sequelize: 'sequelize-cli', sb: '@storybook/cli', 'ts-node-esm': 'ts-node',
};

interface TsConfigInfo {
  paths: Array<{pattern: string; targets: string[]}>;
  /** Directory of the config that set `paths`; targets resolve here when no baseUrl is set. */
  pathsDir: string;
  baseUrl?: string;
  importHelpers: boolean;
  jsx?: string;
  jsxImportSource?: string;
}

interface NpmManifest {
  dir: string;
  rel: string;
  name?: string;
  data: Record<string, unknown>;
  declared: Map<string, DependencyGroup>;
  neverUnused: Set<string>;
  chain: NpmManifest[];
  used: Set<string>;
  missing: Map<string, string[]>;
  uncertain: UncertainItem[];
  incomplete: string[];
}

/** Incomplete evidence in a workspace also makes every ancestor manifest it resolves through uncertain. */
function recordIncomplete(manifest: NpmManifest, what: string): void {
  for (const owner of manifest.chain) {owner.incomplete.push(what);}
}

function npmPackageName(specifier: string): string | undefined {
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return /^(?:@[a-z0-9~][\w.~-]*\/)?[a-z0-9~][\w.~-]*$/i.test(name) && !name.startsWith('~') ? name : undefined;
}

function configCandidates(value: string): string[] {
  const text = value.trim().replace(/^plugin:/, '');
  if (!text || text.length > 214 || !/^[@\w.:/~-]+$/.test(text)) {return [];}
  const candidates = new Set<string>();
  const name = npmPackageName(text);
  if (name) {candidates.add(name);}
  if (text.startsWith('@')) {
    const [scope, short] = text.split('/');
    candidates.add(`${scope}/eslint-plugin`).add(`${scope}/eslint-config`);
    if (short) {for (const prefix of CONFIG_NAME_PREFIXES) {candidates.add(`${scope}/${prefix}${short}`);}}
  } else {
    const short = text.split('/')[0];
    for (const prefix of CONFIG_NAME_PREFIXES) {candidates.add(`${prefix}${short}`);}
    candidates.add(`@types/${short}`);
  }
  return [...candidates];
}

function collectJsonStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 20) {return;}
  if (typeof value === 'string') {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {collectJsonStrings(item, output, depth + 1);}
  } else {
    const record = asRecord(value);
    for (const [key, item] of Object.entries(record || {})) {
      output.push(key);
      collectJsonStrings(item, output, depth + 1);
    }
  }
}

function scriptKind(ts: typeof TypeScript, file: string): TypeScript.ScriptKind {
  const extension = path.extname(file);
  if (extension === '.tsx') {return ts.ScriptKind.TSX;}
  if (extension === '.jsx') {return ts.ScriptKind.JSX;}
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') {return ts.ScriptKind.TS;}
  return ts.ScriptKind.JS;
}

interface ParsedJs {specifiers: string[]; dynamic: number; typeReferences: string[]; strings: string[]; jsx: boolean}

/** Reads module references with the TypeScript parser: imports, re-exports, require(), import(). */
function parseJs(ts: typeof TypeScript, file: string, text: string, collectStrings: boolean): ParsedJs {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, scriptKind(ts, file));
  const result: ParsedJs = {
    specifiers: [], dynamic: 0, typeReferences: source.typeReferenceDirectives.map(reference => reference.fileName),
    strings: [], jsx: false,
  };
  const visit = (node: TypeScript.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {result.jsx = true;}
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      result.specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)) {
      result.specifiers.push(node.moduleReference.expression.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)) {
      result.specifiers.push(node.argument.literal.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const loadsModule = callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === 'require') ||
        (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'require' && callee.name.text === 'resolve');
      const argument = node.arguments[0];
      if (loadsModule && argument) {
        if (ts.isStringLiteralLike(argument)) {result.specifiers.push(argument.text);}
        else {result.dynamic += 1;}
      }
    } else if (collectStrings && ts.isStringLiteralLike(node)) {
      result.strings.push(node.text);
    } else if (collectStrings && (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
      result.strings.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

function parseJsonc(ts: typeof TypeScript, file: string, text: string): unknown {
  const parsed = ts.parseConfigFileTextToJson(file, text);
  if (parsed.error) {throw new Error(`Unable to parse ${path.basename(file)}`);}
  const config: unknown = parsed.config;
  return config;
}

function readTsConfig(run: Run, ts: typeof TypeScript, directory: string): TsConfigInfo | undefined {
  const start = ['tsconfig.json', 'jsconfig.json'].map(name => insideRoot(run, path.join(directory, name))).find(Boolean);
  if (!start) {return undefined;}
  const info: TsConfigInfo = {paths: [], pathsDir: path.dirname(start), importHelpers: false};
  const seen = new Set<string>();
  // Child settings win, so walk the extends chain from the starting file and keep the first value seen.
  let baseUrlSet = false;
  let importHelpersSet = false;
  let pathsSet = false;
  for (let file: string | undefined = start; file && !seen.has(file) && seen.size < 5;) {
    seen.add(file);
    const text = readSource(run, file);
    if (text === undefined) {break;}
    let config: Record<string, unknown> | undefined;
    try {
      config = asRecord(parseJsonc(ts, file, text));
    } catch {
      break;
    }
    const options = asRecord(config?.compilerOptions) || {};
    // TypeScript replaces, not merges, an inherited `paths`; an explicit empty object still wins.
    if (!pathsSet && 'paths' in options) {
      info.paths = Object.entries(asRecord(options.paths) || {}).map(([pattern, targets]) => ({
        pattern,
        targets: Array.isArray(targets) ? targets.filter((target): target is string => typeof target === 'string') : [],
      }));
      info.pathsDir = path.dirname(file);
      pathsSet = true;
    }
    if (!baseUrlSet && typeof options.baseUrl === 'string') {
      const baseUrl = insideRoot(run, path.resolve(path.dirname(file), options.baseUrl));
      info.baseUrl = baseUrl;
      baseUrlSet = true;
    }
    if (info.jsx === undefined && typeof options.jsx === 'string') {info.jsx = options.jsx;}
    if (info.jsxImportSource === undefined && typeof options.jsxImportSource === 'string') {
      info.jsxImportSource = options.jsxImportSource;
    }
    if (!importHelpersSet && typeof options.importHelpers === 'boolean') {
      info.importHelpers = options.importHelpers;
      importHelpersSet = true;
    }
    // Only relative `extends` is followed; a package base is read as a config string instead.
    const parent: string | undefined = typeof config?.extends === 'string' && config.extends.startsWith('.')
      ? path.resolve(path.dirname(file), config.extends)
      : undefined;
    file = parent === undefined
      ? undefined
      : [parent, `${parent}.json`].map(candidate => insideRoot(run, candidate)).find(Boolean);
  }
  return info;
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

/** True when `base` is a file (as written or with a source extension) or a directory with an index or package.json. */
function resolvesLocally(run: Run, base: string): boolean {
  const isFile = (candidate: string): boolean => {
    const real = insideRoot(run, candidate);
    try {
      return real !== undefined && fs.statSync(real).isFile();
    } catch {
      return false;
    }
  };
  return ['', ...RESOLVE_EXTENSIONS].some(extension => isFile(`${base}${extension}`)) ||
    ['package.json', ...RESOLVE_EXTENSIONS.map(extension => `index${extension}`)]
      .some(name => isFile(path.join(base, name)));
}

/** 'resolved' when a matching `paths` pattern has a target file, 'unresolved' when patterns match but none does. */
function matchPathAlias(run: Run, config: TsConfigInfo | undefined, specifier: string): 'resolved' | 'unresolved' | undefined {
  let result: 'resolved' | 'unresolved' | undefined;
  for (const {pattern, targets} of config?.paths || []) {
    const star = pattern.indexOf('*');
    const prefix = star < 0 ? pattern : pattern.slice(0, star);
    const suffix = star < 0 ? '' : pattern.slice(star + 1);
    const matches = star < 0
      ? pattern === specifier
      : specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix);
    if (!matches) {continue;}
    const captured = star < 0 ? '' : specifier.slice(prefix.length, specifier.length - suffix.length);
    const base = config?.baseUrl || config?.pathsDir || run.root;
    if (targets.some(target => resolvesLocally(run, path.resolve(base, target.replace('*', captured))))) {return 'resolved';}
    result = 'unresolved';
  }
  return result;
}

function resolvesUnderBaseUrl(run: Run, config: TsConfigInfo | undefined, specifier: string): boolean {
  return Boolean(config?.baseUrl) && resolvesLocally(run, path.join(config?.baseUrl || '', specifier));
}

interface NpmLock {dir: string; file: string; version: number; packages: Record<string, unknown>}

function loadNpmLocks(run: Run, inventory: PackageInventory): Map<string, NpmLock> {
  const locks = new Map<string, NpmLock>();
  for (const manifest of inventory.manifests) {
    const basename = path.posix.basename(manifest);
    if (basename !== 'package-lock.json' && basename !== 'npm-shrinkwrap.json') {continue;}
    const file = path.join(run.root, manifest);
    const directory = path.dirname(file);
    // npm prefers npm-shrinkwrap.json when both exist.
    if (locks.has(directory) && basename === 'package-lock.json') {continue;}
    try {
      const data = asRecord(JSON.parse(readInventoryText(file)) as unknown);
      if (!data) {continue;}
      locks.set(directory, {
        dir: directory,
        file: basename,
        version: typeof data.lockfileVersion === 'number' ? data.lockfileVersion : 1,
        packages: asRecord(data.packages) || {},
      });
    } catch {
      // The inventory reports malformed lockfiles; bin and peer evidence falls back to node_modules.
    }
  }
  return locks;
}

/** Package metadata from the npm lockfile, else an installed copy under node_modules. Never executed. */
function installedPackageMetadata(
  run: Run,
  manifest: NpmManifest,
  locks: Map<string, NpmLock>,
  name: string
): Record<string, unknown> | undefined {
  for (const owner of manifest.chain) {
    const lock = locks.get(owner.dir);
    const fromManifest = path.relative(owner.dir, manifest.dir).split(path.sep).join('/');
    const keys = fromManifest ? [`${fromManifest}/node_modules/${name}`, `node_modules/${name}`] : [`node_modules/${name}`];
    for (const key of lock ? keys : []) {
      const entry = asRecord(lock?.packages[key]);
      if (entry) {return entry;}
    }
  }
  // Declared names are repository-controlled; only real package names may form a path.
  if (npmPackageName(name) !== name) {return undefined;}
  for (const owner of manifest.chain) {
    const file = insideRoot(run, path.join(owner.dir, 'node_modules', name, 'package.json'));
    if (!file) {continue;}
    try {
      return fs.statSync(file).size > 1024 * 1024 ? undefined : asRecord(JSON.parse(readInventoryText(file)) as unknown);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function binariesOf(metadata: Record<string, unknown> | undefined, name: string): string[] {
  const bin = metadata?.bin;
  const unscoped = name.split('/').pop() || name;
  if (typeof bin === 'string') {return [unscoped];}
  return [unscoped, ...Object.keys(asRecord(bin) || {})];
}

async function analyzeNpm(run: Run, inventory: PackageInventory, locks: Map<string, NpmLock>): Promise<void> {
  const manifestFiles = inventory.manifests.filter(manifest => path.posix.basename(manifest) === 'package.json');
  if (manifestFiles.length === 0) {return;}
  const ts = await import('typescript');
  const manifests = new Map<string, NpmManifest>();
  for (const manifest of manifestFiles) {
    const file = path.join(run.root, manifest);
    const text = readSource(run, file, MAX_SOURCE_BYTES, true);
    let data: Record<string, unknown> | undefined;
    try {
      data = text === undefined ? undefined : asRecord(JSON.parse(text) as unknown);
    } catch {
      data = undefined;
    }
    if (!data) {
      if (text !== undefined) {run.coverage.sourceFilesSkipped += 1;}
      continue;
    }
    const declared = new Map<string, DependencyGroup>();
    const neverUnused = new Set<string>();
    for (const group of DEPENDENCY_GROUPS) {
      for (const name of Object.keys(asRecord(data[group]) || {})) {
        if (!declared.has(name)) {declared.set(name, group);}
        if (group === 'peerDependencies' || group === 'optionalDependencies') {neverUnused.add(name);}
      }
    }
    manifests.set(path.dirname(file), {
      dir: path.dirname(file), rel: manifest, name: typeof data.name === 'string' ? data.name : undefined, data,
      declared, neverUnused, chain: [], used: new Set(), missing: new Map(), uncertain: [], incomplete: [],
    });
  }
  const workspaceNames = new Set([...manifests.values()].flatMap(manifest => manifest.name ? [manifest.name] : []));
  for (const manifest of manifests.values()) {
    // Node resolves a bare import through every ancestor node_modules, so ancestor declarations count.
    let directory = manifest.dir;
    while (!path.relative(run.root, directory).startsWith('..')) {
      const owner = manifests.get(directory);
      if (owner) {manifest.chain.push(owner);}
      if (directory === run.root) {break;}
      directory = path.dirname(directory);
    }
  }
  const markUsed = (manifest: NpmManifest, name: string): boolean => {
    const owner = manifest.chain.find(candidate => candidate.declared.has(name));
    owner?.used.add(name);
    return owner !== undefined;
  };
  const importedNames = new Set<string>();
  const metadataCache = new Map<string, Record<string, unknown> | undefined>();
  const metadataOf = (manifest: NpmManifest, name: string): Record<string, unknown> | undefined => {
    const key = `${manifest.dir}\0${name}`;
    if (!metadataCache.has(key)) {metadataCache.set(key, installedPackageMetadata(run, manifest, locks, name));}
    return metadataCache.get(key);
  };

  for (const manifest of manifests.values()) {
    run.coverage.manifestsAnalyzed.npm += 1;
    const tsconfig = manifest.chain.map(owner => readTsConfig(run, ts, owner.dir)).find(Boolean);
    const configStrings: string[] = [];
    let typescriptSources = Boolean(tsconfig);
    let styleSources = false;
    let jsxSources = false;
    const before = run.coverage.sourceFilesSkipped + run.coverage.sourceFilesTooLarge;
    walkOwned(run, manifest.dir, directory => manifests.has(directory), (file, name) => {
      const extension = path.extname(name);
      if (UNPARSED_SOURCE_EXTENSIONS.has(extension)) {
        recordIncomplete(manifest, rel(run, file));
        return;
      }
      if (extension === '.scss' || extension === '.sass') {styleSources = true;}
      const isConfig = path.dirname(file) === manifest.dir && CONFIG_FILE.test(name);
      if (!JS_EXTENSIONS.has(extension) && !isConfig) {return;}
      const text = readSource(run, file);
      if (text === undefined) {return;}
      if (!JS_EXTENSIONS.has(extension)) {
        try {
          collectJsonStrings(/\.ya?ml$/.test(name) ? yaml.load(text) : parseJsonc(ts, file, text), configStrings);
        } catch {
          try {
            collectJsonStrings(yaml.load(text), configStrings);
          } catch {
            manifest.uncertain.push({name: rel(run, file), reason: 'config file could not be parsed'});
          }
        }
        return;
      }
      run.coverage.sourceFilesAnalyzed += 1;
      if (/\.[cm]?tsx?$/.test(name)) {typescriptSources = true;}
      const parsed = parseJs(ts, file, text, isConfig);
      if (parsed.jsx || extension === '.jsx' || extension === '.tsx') {jsxSources = true;}
      configStrings.push(...parsed.strings);
      for (const reference of parsed.typeReferences) {
        markUsed(manifest, reference);
        markUsed(manifest, `@types/${reference}`);
      }
      if (parsed.dynamic > 0) {
        manifest.uncertain.push({name: rel(run, file), reason: 'require() or import() with a non-literal argument'});
        // The loaded name is unknown, so no declared package can be called unused with confidence.
        recordIncomplete(manifest, rel(run, file));
      }
      for (const specifier of parsed.specifiers) {
        if (!specifier || /^[./#]/.test(specifier) || /^[a-z][a-z0-9+.-]*:/i.test(specifier)) {continue;}
        const name = npmPackageName(specifier);
        if (name) {importedNames.add(name);}
        if (name && markUsed(manifest, name)) {continue;}
        const alias = matchPathAlias(run, tsconfig, specifier);
        if (alias === 'resolved') {continue;}
        if (name && (manifest.chain.some(owner => owner.name === name) || NODE_BUILTINS.has(name) ||
          resolvesUnderBaseUrl(run, tsconfig, specifier))) {
          continue;
        } else if (alias === 'unresolved') {
          manifest.uncertain.push({name: specifier, reason: 'path alias matched but no target file was found'});
        } else if (!name) {
          manifest.uncertain.push({name: specifier, reason: 'not a package name; possibly an unresolved path alias'});
        } else if (workspaceNames.has(name)) {
          manifest.uncertain.push({name, reason: 'local workspace package imported without a declaration'});
        } else {
          const importers = manifest.missing.get(name);
          if (importers) {importers.push(rel(run, file));} else {manifest.missing.set(name, [rel(run, file)]);}
        }
      }
    });
    if (run.coverage.sourceFilesSkipped + run.coverage.sourceFilesTooLarge > before) {
      recordIncomplete(manifest, 'unreadable or oversized source files');
    }

    for (const field of PACKAGE_JSON_CONFIG_FIELDS) {collectJsonStrings(manifest.data[field], configStrings);}
    for (const value of configStrings) {
      for (const candidate of configCandidates(value)) {markUsed(manifest, candidate);}
    }
    for (const key of Object.keys(manifest.data)) {
      if (manifest.declared.has(key)) {manifest.used.add(key);}
    }
    const binaries = new Map<string, string>();
    for (const owner of manifest.chain) {
      for (const name of owner.declared.keys()) {
        for (const binary of binariesOf(metadataOf(manifest, name), name)) {
          if (!binaries.has(binary)) {binaries.set(binary, name);}
        }
      }
    }
    for (const [binary, owner] of Object.entries(KNOWN_BINARIES)) {
      if (!binaries.has(binary) && manifest.chain.some(candidate => candidate.declared.has(owner))) {
        binaries.set(binary, owner);
      }
    }
    for (const script of Object.values(asRecord(manifest.data.scripts) || {})) {
      if (typeof script !== 'string') {continue;}
      for (const token of script.split(/[\s;&|()<>'"`=]+/)) {
        const owner = binaries.get(token);
        if (owner) {markUsed(manifest, owner);}
        const name = token.includes('/') ? npmPackageName(token) : undefined;
        if (name) {markUsed(manifest, name);}
      }
    }
    markUsed(manifest, '@types/node');
    if (typescriptSources) {markUsed(manifest, 'typescript');}
    if (tsconfig?.importHelpers) {markUsed(manifest, 'tslib');}
    if (jsxSources) {
      // The automatic JSX runtime imports from jsxImportSource (default react) without an import statement.
      const source = tsconfig?.jsxImportSource;
      if (source) {
        const jsxPackage = npmPackageName(source);
        if (jsxPackage) {markUsed(manifest, jsxPackage);}
      } else if (!tsconfig?.jsx || tsconfig.jsx === 'react-jsx' || tsconfig.jsx === 'react-jsxdev') {
        markUsed(manifest, 'react');
      }
    }
    if (styleSources) {
      for (const name of ['sass', 'sass-embedded', 'node-sass']) {markUsed(manifest, name);}
    }
  }

  // A used package's peer dependencies are used implicitly (next -> react-dom, ts-jest -> typescript).
  for (let changed = true, rounds = 0; changed && rounds < 5; rounds += 1) {
    changed = false;
    for (const manifest of manifests.values()) {
      for (const name of [...manifest.used]) {
        const peers = asRecord(metadataOf(manifest, name)?.peerDependencies);
        for (const peer of Object.keys(peers || {})) {
          const owner = manifest.chain.find(candidate => candidate.declared.has(peer));
          if (owner && !owner.used.has(peer)) {
            owner.used.add(peer);
            changed = true;
          }
        }
      }
    }
  }
  const usedAnywhere = new Set([...importedNames, ...[...manifests.values()].flatMap(manifest => [...manifest.used])]);

  for (const manifest of manifests.values()) {
    for (const [name, files] of manifest.missing) {
      run.findings.push(hygieneFinding('missing', 'npm', manifest.rel, name,
        `Declare ${name} in ${manifest.rel}; it currently resolves only through a hoisted or transitive install.`,
        {importedBy: listFiles(files)}));
    }
    const unusedUncertain: UncertainItem[] = [];
    for (const [name, group] of manifest.declared) {
      if (manifest.neverUnused.has(name) || manifest.used.has(name)) {continue;}
      if (name.startsWith('@types/')) {
        const target = name.slice('@types/'.length);
        const typed = target.includes('__') ? `@${target.replace('__', '/')}` : target;
        if (usedAnywhere.has(typed)) {continue;}
      }
      if (manifest.incomplete.length > 0) {
        unusedUncertain.push({name, reason: `not imported, but usage evidence is incomplete (${listFiles(manifest.incomplete).join(', ')})`});
        continue;
      }
      run.findings.push(hygieneFinding('unused', 'npm', manifest.rel, name,
        `Remove ${name} from ${group} if nothing loads it; a CLI, plugin or config this check cannot read may still use it.`,
        {group}));
    }
    addUncertain(run, 'npm', manifest.rel, [...manifest.uncertain, ...unusedUncertain]);
  }
}

// ---------------------------------------------------------------------------
// Python

/** Import names whose distribution name differs. `*` entries are distribution-name prefixes. */
const PYTHON_IMPORT_DISTRIBUTIONS: Readonly<Record<string, readonly string[]>> = {
  yaml: ['PyYAML'], PIL: ['Pillow'], sklearn: ['scikit-learn'], skimage: ['scikit-image'],
  cv2: ['opencv-python', 'opencv-python-headless', 'opencv-contrib-python', 'opencv-contrib-python-headless'],
  bs4: ['beautifulsoup4'], dateutil: ['python-dateutil'], dotenv: ['python-dotenv'], jwt: ['PyJWT'],
  jose: ['python-jose'], Crypto: ['pycryptodome', 'pycrypto'], Cryptodome: ['pycryptodomex'], OpenSSL: ['pyOpenSSL'],
  attr: ['attrs'], magic: ['python-magic'], docx: ['python-docx'], pptx: ['python-pptx'], serial: ['pyserial'],
  usb: ['pyusb'], git: ['GitPython'], MySQLdb: ['mysqlclient'], psycopg2: ['psycopg2', 'psycopg2-binary'],
  zmq: ['pyzmq'], Levenshtein: ['python-Levenshtein', 'Levenshtein'], multipart: ['python-multipart'],
  slugify: ['python-slugify'], telegram: ['python-telegram-bot'], win32api: ['pywin32'], win32con: ['pywin32'],
  pywintypes: ['pywin32'], gi: ['PyGObject'], fitz: ['PyMuPDF'], mpl_toolkits: ['matplotlib'],
  pkg_resources: ['setuptools'], faiss: ['faiss-cpu', 'faiss-gpu'], kafka: ['kafka-python'], ldap: ['python-ldap'],
  nacl: ['PyNaCl'], socks: ['PySocks'], websocket: ['websocket-client'], dns: ['dnspython'], grpc: ['grpcio'],
  ruamel: ['ruamel.yaml'], googleapiclient: ['google-api-python-client'], rest_framework: ['djangorestframework'],
  corsheaders: ['django-cors-headers'], debug_toolbar: ['django-debug-toolbar'], django_filters: ['django-filter'],
  environ: ['django-environ'], storages: ['django-storages'], crispy_forms: ['django-crispy-forms'],
  allauth: ['django-allauth'], 'google.protobuf': ['protobuf'], 'google.cloud': ['google-cloud-*'],
  'google.auth': ['google-auth'], 'google.oauth2': ['google-auth'], 'google.generativeai': ['google-generativeai'],
  'google.genai': ['google-genai'], google: ['google-*', 'protobuf'], azure: ['azure-*'],
};
/** Distributions normally run as tools or plugins rather than imported. */
const PYTHON_TOOL_DISTRIBUTION = /^(?:types-.+|.+-stubs|pytest.*|flake8.*|sphinx.*|mkdocs.*|black|mypy|ruff|isort|pylint|coverage|tox|nox|pre-commit|wheel|setuptools|pip|pip-tools|twine|build|gunicorn|uvicorn|hypercorn|waitress|ipython|jupyter.*|notebook|bandit|safety|autopep8|yapf|pyright)$/;
// Module names from CPython's sys.stdlib_module_names plus modules removed in recent releases.
const PYTHON_STDLIB = new Set((
  '__future__ abc aifc antigravity argparse array ast asynchat asyncio asyncore atexit audioop base64 bdb binascii ' +
  'bisect builtins bz2 cProfile calendar cgi cgitb chunk cmath cmd code codecs codeop collections colorsys compileall ' +
  'concurrent configparser contextlib contextvars copy copyreg crypt csv ctypes curses dataclasses datetime dbm ' +
  'decimal difflib dis distutils doctest email encodings ensurepip enum errno faulthandler fcntl filecmp fileinput ' +
  'fnmatch fractions ftplib functools gc genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac ' +
  'html http idlelib imaplib imghdr imp importlib inspect io ipaddress itertools json keyword lib2to3 linecache ' +
  'locale logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt multiprocessing netrc ' +
  'nis nntplib nt ntpath nturl2path numbers opcode operator optparse os ossaudiodev pathlib pdb pickle pickletools ' +
  'pipes pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc ' +
  'pydoc_data pyexpat queue quopri random re readline reprlib resource rlcompleter runpy sched secrets select ' +
  'selectors shelve shlex shutil signal site smtpd smtplib sndhdr socket socketserver spwd sqlite3 sre_compile ' +
  'sre_constants sre_parse ssl stat statistics string stringprep struct subprocess sunau symtable sys sysconfig ' +
  'syslog tabnanny tarfile telnetlib tempfile termios textwrap this threading time timeit tkinter token tokenize ' +
  'tomllib trace traceback tracemalloc tty turtle turtledemo types typing unicodedata unittest urllib uu uuid venv ' +
  'warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo'
).split(' '));

function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** Blanks comments and string literals, then reads `import x` / `from x import y` statements. */
/**
 * Offset just past a compound header's suite colon (0 when the statement is not a header). Strings are already
 * blanked, so only colons inside brackets (slices, dicts), `:=` and `lambda` bodies must be skipped.
 */
function pythonSuiteStart(statement: string): number {
  if (!/^(?:async\s+)?(?:if|elif|else|try|except|finally|with|for|while)\b/.test(statement)) {return 0;}
  let depth = 0;
  let lambdas = 0;
  for (let index = 0; index < statement.length; index += 1) {
    const character = statement[index];
    if ('([{'.includes(character)) {
      depth += 1;
    } else if (')]}'.includes(character)) {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && character === ':' && statement[index + 1] !== '=') {
      if (lambdas === 0) {return index + 1;}
      lambdas -= 1;
    } else if (depth === 0 && statement.startsWith('lambda', index) &&
      !/\w/.test(statement[index - 1] || '') && !/\w/.test(statement[index + 6] || '')) {
      lambdas += 1;
    }
  }
  return 0;
}

export function scanPythonSource(text: string): {imports: string[]; strings: string[]} {
  let code = '';
  const strings: string[] = [];
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (character === '#') {
      while (index < text.length && text[index] !== '\n') {index += 1;}
      continue;
    }
    if (character !== '"' && character !== '\'') {
      code += character;
      index += 1;
      continue;
    }
    const quote = text.startsWith(character.repeat(3), index) ? character.repeat(3) : character;
    let cursor = index + quote.length;
    let content = '';
    while (cursor < text.length && !text.startsWith(quote, cursor) && (quote.length === 3 || text[cursor] !== '\n')) {
      const width = text[cursor] === '\\' ? 2 : 1;
      content += text.slice(cursor, cursor + width);
      cursor += width;
    }
    if (content.length <= 500) {strings.push(content);}
    code += ` ${content.replace(/[^\n]/g, '')} `;
    index = cursor + quote.length;
  }
  const imports: string[] = [];
  for (const line of code.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    for (const part of line.split(';')) {
      // A compound header may carry its body on the same line: `if x: import y`.
      const trimmed = part.trim();
      const statement = trimmed.slice(pythonSuiteStart(trimmed)).trim();
      const plain = statement.match(/^import\s+(.+)$/);
      if (plain) {
        for (const part of plain[1].split(',')) {
          const name = part.trim().split(/\s+/)[0];
          if (/^[A-Za-z_][\w.]*$/.test(name)) {imports.push(name);}
        }
        continue;
      }
      const from = statement.match(/^from\s+([A-Za-z_][\w.]*)\s+import\b/);
      if (from) {imports.push(from[1]);}
    }
  }
  return {imports, strings};
}

function pythonTableEntry(module: string): {key: string; entry: readonly string[]} | undefined {
  const parts = module.split('.');
  for (let length = parts.length; length > 0; length -= 1) {
    const key = parts.slice(0, length).join('.');
    // Own properties only: `import constructor` must not reach Object.prototype members.
    if (Object.prototype.hasOwnProperty.call(PYTHON_IMPORT_DISTRIBUTIONS, key)) {
      return {key, entry: PYTHON_IMPORT_DISTRIBUTIONS[key]};
    }
  }
  return undefined;
}

function pythonDistributionMatches(candidate: string, declared: string): boolean {
  return candidate.endsWith('*')
    ? declared.startsWith(normalizePythonName(candidate.slice(0, -1)))
    : normalizePythonName(candidate) === declared;
}

const REQUIREMENT_INCLUDE = /^(?:-r|--requirement)(?:=|\s+)(\S+)$/;

/** Requirement files reached from `start` through `-r` includes. Reads here leave coverage counters alone. */
function requirementIncludes(run: Run, start: string): Set<string> {
  const reached = new Set<string>();
  const pending = [start];
  for (let file = pending.pop(); file !== undefined && reached.size <= 50; file = pending.pop()) {
    let text = '';
    try {
      if (fs.statSync(file).size <= MAX_SOURCE_BYTES) {text = readInventoryText(file);}
    } catch {
      // readRequirementNames records the unreadable file when its project is analyzed.
    }
    for (const raw of text.split(/\r?\n/)) {
      const include = raw.replace(/(^|\s)#.*$/, '').trim().match(REQUIREMENT_INCLUDE);
      const target = include ? insideRoot(run, path.resolve(path.dirname(file), include[1])) : undefined;
      if (target && !reached.has(target)) {
        reached.add(target);
        pending.push(target);
      }
    }
  }
  return reached;
}

/** Collects declared names; returns false when an include was missing, unreadable, oversized or outside the repository. */
function readRequirementNames(run: Run, requested: string, declared: Map<string, string>, seen: Set<string>): boolean {
  const file = insideRoot(run, requested);
  if (!file || seen.size > 50) {return false;}
  if (seen.has(file)) {return true;}
  seen.add(file);
  const text = readSource(run, file, MAX_SOURCE_BYTES, true);
  let complete = text !== undefined;
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    const include = line.match(REQUIREMENT_INCLUDE);
    if (include) {
      complete = readRequirementNames(run, path.resolve(path.dirname(file), include[1]), declared, seen) && complete;
      continue;
    }
    if (!line || line.startsWith('-') || /^[a-z+]+:\/\//i.test(line)) {continue;}
    const name = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1];
    if (name && !declared.has(normalizePythonName(name))) {declared.set(normalizePythonName(name), rel(run, file));}
  }
  return complete;
}

function analyzePython(run: Run, inventory: PackageInventory): void {
  const projects = new Map<string, string[]>();
  const projectOf = (file: string): string => path.basename(path.dirname(file)).toLowerCase() === 'requirements'
    ? path.dirname(path.dirname(file))
    : path.dirname(file);
  const files = inventory.manifests.filter(isRequirementsInventoryFile).map(manifest => path.join(run.root, manifest));
  const reached = new Map(files.map(file => [file, requirementIncludes(run, file)]));
  const real = (file: string): string => insideRoot(run, file) || file;
  for (const file of files) {
    projects.set(projectOf(file), [...(projects.get(projectOf(file)) || []), file]);
  }
  // A directory whose requirement files are all included by other projects is not a project of its own:
  // those files are checked through the including project's sources. Mutual includes keep both projects.
  const ownedElsewhere = (file: string): boolean => files.some(other => projectOf(other) !== projectOf(file) &&
    reached.get(other)?.has(real(file)) && !reached.get(file)?.has(real(other)));
  for (const [directory, members] of [...projects]) {
    if (members.every(ownedElsewhere)) {projects.delete(directory);}
  }
  for (const [directory, files] of projects) {
    run.coverage.manifestsAnalyzed.pip += 1;
    const declared = new Map<string, string>();
    const seen = new Set<string>();
    let declarationsComplete = true;
    for (const file of files.sort()) {
      declarationsComplete = readRequirementNames(run, file, declared, seen) && declarationsComplete;
    }
    const primary = rel(run, files.find(file => path.basename(file) === 'requirements.txt') || files[0]);
    const imports = new Map<string, string[]>();
    const stringNames = new Set<string>();
    const localNames = new Set<string>();
    const before = run.coverage.sourceFilesSkipped + run.coverage.sourceFilesTooLarge;
    walkOwned(run, directory, candidate => projects.has(candidate), (file, name) => {
      if (!name.endsWith('.py')) {return;}
      localNames.add(name.slice(0, -3));
      localNames.add(path.basename(path.dirname(file)));
      const text = readSource(run, file);
      if (text === undefined) {return;}
      run.coverage.sourceFilesAnalyzed += 1;
      const scanned = scanPythonSource(text);
      for (const module of scanned.imports) {
        const importers = imports.get(module);
        if (importers) {importers.push(rel(run, file));} else {imports.set(module, [rel(run, file)]);}
      }
      for (const value of scanned.strings) {
        for (const token of value.split(/[^A-Za-z0-9_.]+/)) {
          if (token) {stringNames.add(token.split('.')[0]);}
        }
      }
    });
    const incomplete = run.coverage.sourceFilesSkipped + run.coverage.sourceFilesTooLarge > before;
    const used = new Set<string>();
    const uncertain: UncertainItem[] = [];
    const missing = new Map<string, {name: string; files: string[]}>();
    for (const [module, importers] of imports) {
      const top = module.split('.')[0];
      if (PYTHON_STDLIB.has(top)) {continue;}
      const found = pythonTableEntry(module);
      const table = found?.entry;
      const candidates = [...(table || []), top];
      const matched = [...declared.keys()].filter(name => candidates.some(candidate => pythonDistributionMatches(candidate, name)));
      if (matched.length > 0) {
        for (const name of matched) {used.add(name);}
      } else if (localNames.has(top)) {
        continue;
      } else if (found && table && !table.some(candidate => candidate.endsWith('*')) && declarationsComplete) {
        // One finding per expected distribution, so google.protobuf and google.genai stay separate.
        const group = missing.get(table[0]);
        if (group) {group.files.push(...importers);} else {missing.set(table[0], {name: found.key, files: [...importers]});}
      } else if (!declarationsComplete && table && !table.some(candidate => candidate.endsWith('*'))) {
        uncertain.push({name: top, reason: 'a requirements include could not be read, so the declaration may be elsewhere'});
      } else {
        uncertain.push({
          name: top,
          reason: table ? 'namespace import maps to several distributions' : 'no known distribution for this import name',
        });
      }
    }
    for (const [expected, value] of missing) {
      run.findings.push(hygieneFinding('missing', 'pip', primary, value.name,
        `Declare ${expected} in ${primary}; the import resolves only if it is installed some other way.`,
        {distribution: expected, importedBy: listFiles(value.files)}));
    }
    const reverse = new Map<string, string>();
    for (const [module, distributions] of Object.entries(PYTHON_IMPORT_DISTRIBUTIONS)) {
      for (const distribution of distributions) {reverse.set(normalizePythonName(distribution), module.split('.')[0]);}
    }
    for (const [name, manifest] of declared) {
      if (used.has(name) || PYTHON_TOOL_DISTRIBUTION.test(name)) {continue;}
      // An included file that is still part of its own project is judged there, against that project's sources.
      const owner = projectOf(path.join(run.root, manifest));
      if (owner !== directory && projects.has(owner)) {continue;}
      const importName = reverse.get(name) || name.replace(/-/g, '_');
      if (stringNames.has(importName)) {continue;}
      if (incomplete) {
        uncertain.push({name, reason: 'not imported, but some sources were unreadable or oversized'});
      } else if (reverse.has(name) || !name.includes('-')) {
        run.findings.push(hygieneFinding('unused', 'pip', manifest, name,
          `Remove ${name} from ${manifest} if nothing imports it; tools and plugins can still need it.`, {}));
      } else {
        uncertain.push({name, reason: 'import name for this distribution is unknown'});
      }
    }
    addUncertain(run, 'pip', primary, uncertain);
  }
}

// ---------------------------------------------------------------------------
// Go

/** Blanks Go comments (keeping string literals) and returns the import paths in the file header. */
export function scanGoImports(text: string): string[] {
  let code = '';
  for (let index = 0; index < text.length;) {
    if (text.startsWith('//', index)) {
      while (index < text.length && text[index] !== '\n') {index += 1;}
    } else if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 2;
      code += ' ';
    } else if (text[index] === '"' || text[index] === '`' || text[index] === '\'') {
      const quote = text[index];
      let cursor = index + 1;
      while (cursor < text.length && text[cursor] !== quote && (quote === '`' || text[cursor] !== '\n')) {
        cursor += quote !== '`' && text[cursor] === '\\' ? 2 : 1;
      }
      code += text.slice(index, cursor + 1);
      index = cursor + 1;
    } else {
      code += text[index];
      index += 1;
    }
  }
  const header = code.split(/^\s*(?:func|type|var|const)\b/m)[0];
  const imports: string[] = [];
  for (const block of header.matchAll(/\bimport\s*\(([^)]*)\)/g)) {
    for (const literal of block[1].matchAll(/"([^"\n]*)"|`([^`]*)`/g)) {imports.push(literal[1] ?? literal[2]);}
  }
  for (const single of header.matchAll(/\bimport\s+(?:[\w.]+\s+)?(?:"([^"\n]*)"|`([^`]*)`)/g)) {
    imports.push(single[1] ?? single[2]);
  }
  return imports;
}

function parseGoModule(text: string): {module?: string; requires: Map<string, boolean>; tools: Set<string>} {
  const requires = new Map<string, boolean>();
  const tools = new Set<string>();
  let module: string | undefined;
  let block: string | undefined;
  const directive = (kind: string, body: string, comment: string): void => {
    const target = body.split(/\s+/)[0].replace(/^"|"$/g, '');
    if (kind === 'require') {requires.set(target, /\bindirect\b/.test(comment));}
    if (kind === 'tool') {tools.add(target);}
  };
  for (const raw of text.split(/\r?\n/)) {
    const commentAt = raw.indexOf('//');
    const comment = commentAt < 0 ? '' : raw.slice(commentAt);
    const body = (commentAt < 0 ? raw : raw.slice(0, commentAt)).trim();
    if (!body) {continue;}
    if (block !== undefined) {
      if (body === ')') {block = undefined;} else {directive(block, body, comment);}
      continue;
    }
    const opened = body.match(/^(\w+)\s*\($/);
    if (opened) {
      block = opened[1];
      continue;
    }
    const line = body.match(/^(module|require|tool)\s+(.+)$/);
    if (line?.[1] === 'module') {module = line[2].trim().replace(/^"|"$/g, '');}
    else if (line) {directive(line[1], line[2].trim(), comment);}
  }
  return {module, requires, tools};
}

function analyzeGo(run: Run, inventory: PackageInventory): void {
  const modules = new Set(inventory.manifests
    .filter(manifest => path.posix.basename(manifest) === 'go.mod')
    .map(manifest => path.dirname(path.join(run.root, manifest))));
  for (const directory of modules) {
    const manifest = rel(run, path.join(directory, 'go.mod'));
    const text = readSource(run, path.join(directory, 'go.mod'), MAX_SOURCE_BYTES, true);
    if (text === undefined) {continue;}
    run.coverage.manifestsAnalyzed.go += 1;
    const {module, requires, tools} = parseGoModule(text);
    const used = new Set<string>();
    const missing = new Map<string, string[]>();
    const ownerOf = (importPath: string): string | undefined => [...requires.keys()]
      .filter(required => importPath === required || importPath.startsWith(`${required}/`))
      .sort((left, right) => right.length - left.length)[0];
    for (const tool of tools) {
      const owner = ownerOf(tool);
      if (owner) {used.add(owner);}
    }
    const before = run.coverage.sourceFilesSkipped + run.coverage.sourceFilesTooLarge;
    // The go tool ignores directory and file names that begin with "." or "_".
    walkOwned(run, directory, (candidate, name) =>
      modules.has(candidate) || name === 'testdata' || name.startsWith('.') || name.startsWith('_'), (file, name) => {
      if (!name.endsWith('.go') || name.startsWith('.') || name.startsWith('_')) {return;}
      const source = readSource(run, file);
      if (source === undefined) {return;}
      run.coverage.sourceFilesAnalyzed += 1;
      for (const importPath of scanGoImports(source)) {
        if (importPath === 'C' || (module && (importPath === module || importPath.startsWith(`${module}/`)))) {continue;}
        if (!importPath.split('/')[0].includes('.')) {continue;}
        const owner = ownerOf(importPath);
        const importers = missing.get(importPath);
        if (owner) {used.add(owner);} else if (importers) {importers.push(rel(run, file));} else {missing.set(importPath, [rel(run, file)]);}
      }
    });
    for (const [importPath, files] of missing) {
      run.findings.push(hygieneFinding('missing', 'go', manifest, importPath,
        `Add the module that provides ${importPath} to ${manifest} (go get or go mod tidy).`,
        {importedBy: listFiles(files)}));
    }
    const incomplete = run.coverage.sourceFilesSkipped + run.coverage.sourceFilesTooLarge > before;
    const uncertain: UncertainItem[] = [];
    for (const [required, indirect] of requires) {
      if (indirect || used.has(required)) {continue;}
      if (incomplete) {
        uncertain.push({name: required, reason: 'not imported, but some sources were unreadable or oversized'});
        continue;
      }
      run.findings.push(hygieneFinding('unused', 'go', manifest, required,
        `Remove ${required} from ${manifest} if no package imports it (go mod tidy).`, {}));
    }
    addUncertain(run, 'go', manifest, uncertain);
  }
}

// ---------------------------------------------------------------------------
// Install scripts

function analyzeInstallScripts(run: Run, inventory: PackageInventory, locks: Map<string, NpmLock>): void {
  const withScripts = inventory.coordinates.filter(coordinate => coordinate.installScript);
  for (const coordinate of withScripts) {
    const pnpm = path.posix.basename(coordinate.lockfilePath) === 'pnpm-lock.yaml';
    run.findings.push({
      severity: 'low',
      category: INSTALL_SCRIPT_CATEGORY,
      file: coordinate.lockfilePath,
      description: pnpm
        ? `${coordinate.name}@${coordinate.exactVersion} is marked by pnpm as requiring a build`
        : `${coordinate.name}@${coordinate.exactVersion} runs an install script when installed`,
      suggestion: pnpm
        ? 'Review what the package builds on install; install with --ignore-scripts or allow only trusted packages to build.'
        : 'Review the package\'s preinstall/install/postinstall script; install with --ignore-scripts or allow only trusted packages to run scripts.',
      ruleId: HYGIENE_RULES.installScript,
      metadata: {
        ecosystem: coordinate.ecosystem, package: coordinate.name, version: coordinate.exactVersion,
        lockfile: coordinate.lockfilePath, direct: coordinate.direct, scope: coordinate.scope,
        dependencyPaths: coordinate.dependencyPaths.slice(0, 5),
      },
    });
  }
  const undetermined = (lockfile: string, reason: string): void => {
    run.coverage.installScripts.notDeterminable.push(lockfile);
    run.findings.push({
      severity: 'info',
      category: INSTALL_SCRIPT_CATEGORY,
      file: lockfile,
      description: `Install scripts cannot be determined from ${lockfile}`,
      suggestion: `${reason}; review dependencies with lifecycle scripts another way.`,
      ruleId: HYGIENE_RULES.installScriptUndetermined,
      metadata: {lockfile, reason},
    });
  };
  for (const manifest of inventory.manifests) {
    const basename = path.posix.basename(manifest);
    const file = path.join(run.root, manifest);
    if (basename === 'yarn.lock') {
      undetermined(manifest, 'yarn.lock does not record which packages have install scripts');
    } else if (basename === 'package-lock.json' || basename === 'npm-shrinkwrap.json') {
      const lock = locks.get(path.dirname(file));
      // Only the lockfile npm reads counts; package-lock.json is inactive beside npm-shrinkwrap.json.
      if (!lock || lock.file !== basename) {continue;}
      if (lock.version < 2) {
        undetermined(manifest, 'npm lockfile v1 does not record hasInstallScript');
      } else {
        run.coverage.installScripts.lockfilesChecked += 1;
      }
    } else if (basename === 'pnpm-lock.yaml') {
      const head = readSource(run, file, 32 * 1024 * 1024)?.slice(0, 4096);
      if (head === undefined) {continue;}
      const major = Number(head.match(/^lockfileVersion:\s*['"]?(\d+)/m)?.[1] || 0);
      if (major >= 9 && !withScripts.some(coordinate => coordinate.lockfilePath === manifest)) {
        undetermined(manifest, `pnpm lockfile v${major} does not record requiresBuild`);
      } else {
        run.coverage.installScripts.lockfilesChecked += 1;
      }
    }
  }
}

// shortcut: only the root .gitignore is honored, not nested ones; load nested files if repos need them.
function rootGitignore(root: string): ReturnType<typeof ignore> {
  const matcher = ignore();
  try {
    // Like every other input here, a .gitignore that resolves outside the repository or is oversized is not read.
    const file = fs.realpathSync(path.join(root, '.gitignore'));
    if (isWithinRoot(root, file) && fs.statSync(file).size <= MAX_SOURCE_BYTES) {matcher.add(readInventoryText(file));}
  } catch {
    // No readable .gitignore: nothing extra is excluded.
  }
  return matcher;
}

/** Runs every dependency insight over manifests the inventory already found. */
export async function analyzeDependencyInsights(inventory: PackageInventory): Promise<DependencyInsightsReport> {
  const run: Run = {
    root: inventory.repository,
    ignored: rootGitignore(inventory.repository),
    findings: [],
    coverage: {
      manifestsAnalyzed: {npm: 0, pip: 0, go: 0},
      manifestsNotAnalyzed: inventory.manifests
        .filter(manifest => NOT_ANALYZED_MANIFESTS.has(path.posix.basename(manifest)))
        .slice(0, MAX_LISTED),
      sourceFilesAnalyzed: 0,
      sourceFilesSkipped: 0,
      sourceFilesTooLarge: 0,
      uncertain: 0,
      installScripts: {lockfilesChecked: 0, notDeterminable: []},
    },
  };
  const locks = loadNpmLocks(run, inventory);
  await analyzeNpm(run, inventory, locks);
  analyzePython(run, inventory);
  analyzeGo(run, inventory);
  analyzeInstallScripts(run, inventory, locks);
  return run;
}
