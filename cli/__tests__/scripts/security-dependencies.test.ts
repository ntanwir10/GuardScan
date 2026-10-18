import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';

const cliRoot = path.resolve(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8')) as {
  overrides: Record<string, unknown>;
};
const lock = JSON.parse(fs.readFileSync(path.join(cliRoot, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, {
    version?: string;
    dependencies?: Record<string, string>;
  }>;
};

function resolveLockedDependency(from: string, dependency: string): string | undefined {
  let directory = from;
  while (directory) {
    const candidate = path.posix.join(directory, 'node_modules', dependency);
    if (lock.packages[candidate]) {return candidate;}
    const parent = path.posix.dirname(directory);
    if (parent === directory) {break;}
    directory = parent;
  }
  const rootCandidate = path.posix.join('node_modules', dependency);
  return lock.packages[rootCandidate] ? rootCandidate : undefined;
}

describe('security-sensitive development dependency graph', () => {
  it('keeps Handlebars patched and removes the vulnerable nested sprintf-js chain', () => {
    expect(manifest.overrides['@istanbuljs/load-nyc-config@1.1.0']).toEqual({
      'js-yaml': '4.3.2',
    });
    expect(lock.packages['node_modules/handlebars']?.version).toBe('4.7.10');

    const loaderPath = 'node_modules/@istanbuljs/load-nyc-config';
    const yamlPath = resolveLockedDependency(loaderPath, 'js-yaml');
    expect(yamlPath).toBe('node_modules/js-yaml');
    expect(lock.packages[yamlPath!]?.version).toBe('4.3.2');
    const loaderRequire = createRequire(require.resolve('@istanbuljs/load-nyc-config'));
    const installedYaml = loaderRequire('js-yaml/package.json') as {version: string};
    expect(installedYaml.version).toBe('4.3.2');
    expect(path.relative(cliRoot, loaderRequire.resolve('js-yaml/package.json'))
      .split(path.sep).join('/')).toBe(`${yamlPath}/package.json`);
    const argparsePath = resolveLockedDependency(yamlPath!, 'argparse');
    expect(argparsePath).toBeDefined();
    expect(lock.packages[argparsePath!]?.version).toBe('2.0.1');
    expect(Object.keys(lock.packages).some(packagePath =>
      packagePath === 'node_modules/sprintf-js' || packagePath.endsWith('/node_modules/sprintf-js')
    )).toBe(false);
  });

  it('loads real NYC YAML configuration with anchors, aliases, booleans, globs, and extends', async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-nyc-config-'));
    try {
      fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({name: 'fixture', version: '1.0.0'}));
      fs.writeFileSync(path.join(fixture, 'base.yml'), [
        'defaults: &defaults',
        '  all: false',
        'include:',
        '  - "lib/**/*.ts"',
        'exclude:',
        '  - "lib/generated/**/*.ts"',
        'reporter: [text, json]',
        '<<: *defaults',
      ].join('\n'));
      fs.writeFileSync(path.join(fixture, 'nyc.yml'), [
        'extends: ./base.yml',
      ].join('\n'));

      const {loadNycConfig} = require('@istanbuljs/load-nyc-config') as {
        loadNycConfig: (options: {cwd: string; nycrcPath: string}) => Promise<Record<string, unknown>>;
      };
      const config = await loadNycConfig({cwd: fixture, nycrcPath: 'nyc.yml'});

      expect(config.all).toBe(false);
      expect(config.include).toEqual(['lib/**/*.ts']);
      expect(config.exclude).toEqual(['lib/generated/**/*.ts']);
      expect(config.reporter).toEqual(['text', 'json']);
    } finally {
      fs.rmSync(fixture, {recursive: true, force: true});
    }
  });

  it('rejects malformed YAML through the real NYC configuration loader', async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-invalid-nyc-config-'));
    try {
      fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({name: 'fixture', version: '1.0.0'}));
      fs.writeFileSync(path.join(fixture, 'nyc.yml'), 'include: [unterminated\n');
      const {loadNycConfig} = require('@istanbuljs/load-nyc-config') as {
        loadNycConfig: (options: {cwd: string; nycrcPath: string}) => Promise<Record<string, unknown>>;
      };
      await expect(loadNycConfig({cwd: fixture, nycrcPath: 'nyc.yml'})).rejects.toThrow();
    } finally {
      fs.rmSync(fixture, {recursive: true, force: true});
    }
  });

  it('runs the installed js-yaml CLI help, version, and YAML-to-JSON commands', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-yaml-cli-'));
    try {
      const input = path.join(fixture, 'input.yml');
      fs.writeFileSync(input, 'include:\n  - "src/**"\nexclude:\n  - "src/generated/**"\n');
      const yamlPath = resolveLockedDependency('node_modules/@istanbuljs/load-nyc-config', 'js-yaml');
      expect(yamlPath).toBeDefined();
      const cli = path.join(cliRoot, yamlPath!, 'bin/js-yaml.js');

      const help = spawnSync(process.execPath, [cli, '--help'], {
        cwd: cliRoot, encoding: 'utf8',
      });
      expect(help.status).toBe(0);
      expect(help.stdout).toMatch(/usage: js-yaml/i);
      expect(help.stdout).toMatch(/--help/i);

      const version = spawnSync(process.execPath, [cli, '--version'], {
        cwd: cliRoot, encoding: 'utf8',
      });
      expect(version.status).toBe(0);
      expect(version.stdout.trim()).toBe('4.3.2');

      const parsed = spawnSync(process.execPath, [cli, '--to-json', input], {
        cwd: cliRoot, encoding: 'utf8',
      });
      expect(parsed.status).toBe(0);
      expect(JSON.parse(parsed.stdout)).toEqual({include: ['src/**'], exclude: ['src/generated/**']});
    } finally {
      fs.rmSync(fixture, {recursive: true, force: true});
    }
  });
});
