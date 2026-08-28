import {
  ConfigManager,
  Config,
  DEFAULT_ENHANCED_CONFIG,
  parseConfig,
} from '../../src/core/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChildProcess, spawn } from 'child_process';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let originalEnv: NodeJS.ProcessEnv;
  let testConfigDir: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    testConfigDir = path.join(os.tmpdir(), `guardscan-config-test-${Date.now()}`);
    process.env.GUARDSCAN_HOME = testConfigDir;
    process.env.HOME = testConfigDir;
    configManager = new ConfigManager();

    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
    process.env = originalEnv;
  });

  describe('init', () => {
    it('should create config directory', () => {
      configManager.init();

      const configDir = configManager.getConfigDir();
      expect(fs.existsSync(configDir)).toBe(true);
    });

    it('should create cache directory', () => {
      configManager.init();

      const cacheDir = configManager.getCacheDir();
      expect(fs.existsSync(cacheDir)).toBe(true);
    });

    it('should not generate a client ID', () => {
      const config = configManager.init();

      expect(config.clientId).toBeUndefined();
    });

    it('should create config file', () => {
      configManager.init();

      expect(configManager.exists()).toBe(true);
    });

    it('should not overwrite existing config', () => {
      const firstConfig = configManager.init();
      const secondConfig = configManager.init();

      expect(firstConfig.clientId).toBe(secondConfig.clientId);
    });
  });

  describe('save and load', () => {
    it('should save and load config', () => {
      // Create the directory first
      configManager.init();

      const config: Config = {
        clientId: 'legacy-client-id',
        provider: 'openai',
        apiKey: 'test-api-key',
        telemetryEnabled: true,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      configManager.save(config);
      const loaded = configManager.load();

      expect(loaded.clientId).toBeUndefined();
      expect(loaded.provider).toBe(config.provider);
      expect(loaded.apiKey).toBe(config.apiKey);
      expect(fs.readFileSync(path.join(configManager.getConfigDir(), 'config.yml'), 'utf8'))
        .not.toContain('clientId');
    });

    it('uses restrictive permissions for configuration secrets', () => {
      configManager.init();
      if (process.platform === 'win32') return;

      const directoryMode = fs.statSync(configManager.getConfigDir()).mode & 0o777;
      const fileMode = fs.statSync(path.join(configManager.getConfigDir(), 'config.yml')).mode & 0o777;
      expect(directoryMode).toBe(0o700);
      expect(fileMode).toBe(0o600);
    });

    it('preserves the previous config when atomic replacement fails', () => {
      const original = configManager.init();
      const configPath = path.join(configManager.getConfigDir(), 'config.yml');
      const before = fs.readFileSync(configPath, 'utf8');
      const rename = jest.spyOn(configManager as any, 'replaceConfigFile').mockImplementation(() => {
        throw new Error('simulated rename failure');
      });

      expect(() => configManager.save({ ...original, provider: 'openai' })).toThrow(
        'simulated rename failure'
      );
      rename.mockRestore();
      expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
      expect(fs.readdirSync(configManager.getConfigDir()).some(name => name.endsWith('.tmp')))
        .toBe(false);
    });
  });

  describe('load', () => {
    it('should throw error if config does not exist', () => {
      // Ensure config doesn't exist
      if (configManager.exists()) {
        configManager.reset(true);
      }
      expect(() => configManager.load()).toThrow();
    });

    it('should not update lastUsed on default load', () => {
      configManager.init();
      const beforeLoad = configManager.load().lastUsed;

      const config = configManager.load();

      expect(config.lastUsed).toBe(beforeLoad);
    });

    it('should update lastUsed when explicitly requested', () => {
      configManager.init();
      const beforeLoad = new Date();

      const config = configManager.load({ touchLastUsed: true });

      const lastUsed = new Date(config.lastUsed);
      expect(lastUsed >= beforeLoad).toBe(true);
    });

    it.each([false, true])('gives recovery guidance for an empty config (touchLastUsed=%s)', (touchLastUsed) => {
      configManager.init();
      const configPath = path.join(configManager.getConfigDir(), 'config.yml');
      fs.writeFileSync(configPath, '');

      expect(() => configManager.load({ touchLastUsed })).toThrow(
        /configuration must be an object.*Back up or remove the invalid configuration file, then run "guardscan init" to recreate it/
      );
    });

    it.each([false, true])('gives recovery guidance for an unparsable config (touchLastUsed=%s)', (touchLastUsed) => {
      configManager.init();
      const configPath = path.join(configManager.getConfigDir(), 'config.yml');
      fs.writeFileSync(configPath, 'provider: [unterminated\n');

      expect(() => configManager.load({ touchLastUsed })).toThrow(
        /unexpected end of the stream[\s\S]*Back up or remove the invalid configuration file, then run "guardscan init" to recreate it/
      );
    });

    it.each([
      ['telemetryEnabled', '"false"'],
      ['telemetryEnabled', '1'],
      ['telemetryEnabled', 'null'],
      ['offlineMode', '"false"'],
      ['offlineMode', '1'],
      ['offlineMode', 'null'],
    ])('rejects malformed privacy boolean %s=%s', (field, yamlValue) => {
      configManager.init();
      const configPath = path.join(configManager.getConfigDir(), 'config.yml');
      const values: Record<string, string> = {
        telemetryEnabled: 'false',
        offlineMode: 'true',
      };
      values[field] = yamlValue;
      fs.writeFileSync(configPath, [
        'provider: none',
        `telemetryEnabled: ${values.telemetryEnabled}`,
        `offlineMode: ${values.offlineMode}`,
      ].join('\n'));

      expect(() => configManager.load()).toThrow(`configuration.${field} must be a boolean`);
    });

    it('rejects invalid provider and nested configuration values', () => {
      configManager.init();
      const configPath = path.join(configManager.getConfigDir(), 'config.yml');
      fs.writeFileSync(configPath, 'provider: arbitrary\ntelemetryEnabled: false\nofflineMode: true\n');
      expect(() => configManager.load()).toThrow('configuration.provider');

      fs.writeFileSync(configPath, [
        'provider: none',
        'telemetryEnabled: false',
        'offlineMode: true',
        'retry:',
        '  enabled: yes',
      ].join('\n'));
      expect(() => configManager.load()).toThrow('configuration.retry.enabled');
    });

    it('rejects configuration files larger than the bounded read limit', () => {
      configManager.init();
      const configPath = path.join(configManager.getConfigDir(), 'config.yml');
      fs.writeFileSync(configPath, `provider: none\napiKey: "${'x'.repeat(1024 * 1024)}"\n`);

      expect(() => configManager.load()).toThrow('exceeds size limit');
    });

    it('rejects YAML aliases and excessively deep object graphs', () => {
      configManager.init();
      const configPath = path.join(configManager.getConfigDir(), 'config.yml');
      fs.writeFileSync(configPath, [
        'provider: none',
        'retry: &shared',
        '  enabled: true',
        'cache: *shared',
      ].join('\n'));
      expect(() => configManager.load()).toThrow('aliases are not supported');

      const deep = ['provider: none', 'unknown:'];
      for (let depth = 0; depth < 22; depth++) {
        deep.push(`${'  '.repeat(depth + 1)}nested:`);
      }
      fs.writeFileSync(configPath, deep.join('\n'));
      expect(() => configManager.load()).toThrow('exceeds depth limit');
    });
  });

  describe('update', () => {
    it('should update existing config', () => {
      configManager.init();

      const updates = {
        provider: 'claude' as const,
        apiKey: 'new-api-key',
      };

      configManager.update(updates);
      const config = configManager.load();

      expect(config.provider).toBe('claude');
      expect(config.apiKey).toBe('new-api-key');
    });

    it('returns the same normalized configuration that it persists', () => {
      configManager.init();

      const updated = configManager.update({ retry: { enabled: false } as Config['retry'] });

      expect(updated.retry).toEqual({
        ...DEFAULT_ENHANCED_CONFIG.retry,
        enabled: false,
      });
      expect(configManager.load()).toEqual(updated);
    });

    it('preserves independent updates from coordinated Node processes', async () => {
      configManager.init();
      const configModule = path.resolve(__dirname, '../../dist/core/config.js');
      const gate = path.join(testConfigDir, 'release-first-update');
      const childScript = [
        "const fs = require('fs');",
        "const { ConfigManager } = require(process.argv[1]);",
        "const role = process.argv[2]; const gate = process.argv[3];",
        "const manager = new ConfigManager();",
        "if (role === 'first') {",
        " const original = manager.persistConfig.bind(manager);",
        " manager.persistConfig = config => { process.send('read');",
        "  const wait = new Int32Array(new SharedArrayBuffer(4));",
        "  while (!fs.existsSync(gate)) Atomics.wait(wait, 0, 0, 10);",
        "  original(config); };",
        " manager.update({ apiKey: 'alpha' });",
        "} else { process.send('started'); manager.update({ model: 'beta' }); }",
      ].join('');

      const first = spawnConfigChild(childScript, [configModule, 'first', gate], testConfigDir);
      await waitForChildMessage(first, 'read');
      const second = spawnConfigChild(childScript, [configModule, 'second', gate], testConfigDir);
      await waitForChildMessage(second, 'started');
      fs.writeFileSync(gate, 'release');
      await Promise.all([waitForChildExit(first), waitForChildExit(second)]);

      expect(configManager.load()).toMatchObject({apiKey: 'alpha', model: 'beta'});
    }, 15_000);
  });

  describe('exists', () => {
    it('should return false when config does not exist', () => {
      // Ensure config doesn't exist
      if (configManager.exists()) {
        configManager.reset(true);
      }
      expect(configManager.exists()).toBe(false);
    });

    it('should return true when config exists', () => {
      configManager.init();
      expect(configManager.exists()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should delete config file with full reset', () => {
      configManager.init();
      expect(configManager.exists()).toBe(true);

      configManager.reset(true);
      expect(configManager.exists()).toBe(false);
    });

    it('should delete cache directory with full reset', () => {
      configManager.init();
      const cacheDir = configManager.getCacheDir();

      expect(fs.existsSync(cacheDir)).toBe(true);

      configManager.reset(true);
      expect(fs.existsSync(cacheDir)).toBe(false);
    });
  });

  describe('getConfigDir', () => {
    it('should return correct config directory path', () => {
      const configDir = configManager.getConfigDir();
      expect(configDir).toBe(path.join(testConfigDir, '.guardscan'));
    });
  });

  describe('getCacheDir', () => {
    it('should return correct cache directory path', () => {
      const cacheDir = configManager.getCacheDir();
      expect(cacheDir).toBe(path.join(testConfigDir, '.guardscan', 'cache'));
    });
  });
});

function spawnConfigChild(script: string, args: string[], home: string): ChildProcess {
  return spawn(process.execPath, ['-e', script, ...args], {
    env: {...process.env, GUARDSCAN_HOME: home, HOME: home},
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
}

function waitForChildMessage(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.on('message', message => {
      if (message === expected) {resolve();}
    });
    child.once('exit', code => {
      if (code !== null && code !== 0) {reject(new Error(`config child exited early with ${code}`));}
    });
  });
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr?.on('data', chunk => {stderr += String(chunk);});
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`config child exited with ${code}: ${stderr}`));
    });
  });
}

describe('parseConfig', () => {
  it('merges present partial sections with defaults while leaving absent optional sections absent', () => {
    const config = parseConfig({
      provider: 'none',
      retry: { enabled: false },
      cache: { ttlSeconds: 60 },
      vulnerabilities: { scope: 'runtime' },
    });

    expect(config.retry).toEqual({
      ...DEFAULT_ENHANCED_CONFIG.retry,
      enabled: false,
    });
    expect(config.cache).toEqual({
      ...DEFAULT_ENHANCED_CONFIG.cache,
      ttlSeconds: 60,
    });
    expect(config.vulnerabilities).toEqual({
      ...DEFAULT_ENHANCED_CONFIG.vulnerabilities,
      scope: 'runtime',
    });
    expect(config.circuitBreaker).toBeUndefined();
    expect(config.rateLimit).toBeUndefined();
    expect(config.observability).toBeUndefined();
    expect(config.budget).toBeUndefined();
    expect(config.modelRouting).toBeUndefined();
  });

  it('always supplies vulnerability defaults and accepts then drops legacy clientId', () => {
    const config = parseConfig({ clientId: 'legacy', provider: 'none' });

    expect(config.clientId).toBeUndefined();
    expect(config.vulnerabilities).toEqual(DEFAULT_ENHANCED_CONFIG.vulnerabilities);
  });

  it.each([
    [{ unknown: true }, 'configuration.unknown'],
    [{ retry: { enabled: true, typo: 1 } }, 'configuration.retry.typo'],
    [{ modelRouting: { enabled: true, typo: true } }, 'configuration.modelRouting.typo'],
    [{ modelRouting: { taskOverrides: { deploy: {} } } }, 'taskOverrides.deploy'],
    [{ modelRouting: { taskOverrides: { chat: { model: 'x', typo: true } } } }, 'chat.typo'],
  ])('rejects unknown configuration keys in %j', (extra, expectedPath) => {
    expect(() => parseConfig({ provider: 'none', ...extra })).toThrow(expectedPath);
  });

  it.each([
    [{ cache: { semanticThreshold: -0.01 } }, 'configuration.cache.semanticThreshold'],
    [{ cache: { semanticThreshold: 1.01 } }, 'configuration.cache.semanticThreshold'],
    [{ budget: { warningThreshold: -0.01 } }, 'configuration.budget.warningThreshold'],
    [{ budget: { warningThreshold: 1.01 } }, 'configuration.budget.warningThreshold'],
  ])('rejects thresholds outside the inclusive unit interval', (extra, expectedPath) => {
    expect(() => parseConfig({ provider: 'none', ...extra })).toThrow(expectedPath);
  });

  it('accepts threshold boundary values', () => {
    expect(parseConfig({ provider: 'none', cache: { semanticThreshold: 0 } }).cache)
      .toMatchObject({ semanticThreshold: 0 });
    expect(parseConfig({ provider: 'none', budget: { warningThreshold: 1 } }).budget)
      .toMatchObject({ warningThreshold: 1 });
  });

  it.each([
    [{ vulnerabilities: { snapshotMaxAgeDays: 1.5 } }, 'snapshotMaxAgeDays'],
    [{ retry: { maxRetries: 1.5 } }, 'maxRetries'],
    [{ circuitBreaker: { failureThreshold: 1.5 } }, 'failureThreshold'],
    [{ rateLimit: { maxTokens: 1.5 } }, 'maxTokens'],
    [{ cache: { ttlSeconds: 1.5 } }, 'ttlSeconds'],
  ])('rejects fractional count and TTL values', (extra, expectedPath) => {
    expect(() => parseConfig({ provider: 'none', ...extra })).toThrow(expectedPath);
  });

  it.each([
    ['createdAt', 'not-a-date'],
    ['createdAt', '2025-02-30T00:00:00.000Z'],
    ['lastUsed', 'not-a-date'],
  ])('rejects invalid %s timestamps', (field, timestamp) => {
    expect(() => parseConfig({ provider: 'none', [field]: timestamp })).toThrow(
      `configuration.${field}`
    );
  });

  it('accepts valid timestamps with timezone offsets', () => {
    const timestamp = '2025-01-31T23:30:00-05:00';
    expect(parseConfig({ provider: 'none', createdAt: timestamp }).createdAt).toBe(timestamp);
  });

  it.each([
    'https://api.example.test/v1',
    'http://localhost:11434',
    'http://127.0.0.2:11434/',
    'http://[::1]:1234',
  ])('accepts a secure or loopback API endpoint: %s', apiEndpoint => {
    expect(parseConfig({ provider: 'none', apiEndpoint }).apiEndpoint).toBe(apiEndpoint);
  });

  it.each([
    'http://example.test',
    'https://user:pass@example.test',
    'https://example.test/path?token=secret',
    'https://example.test/path#fragment',
    'not-a-url',
  ])('rejects an unsafe API endpoint: %s', apiEndpoint => {
    expect(() => parseConfig({ provider: 'none', apiEndpoint })).toThrow(
      'configuration.apiEndpoint'
    );
  });

  it('applies the endpoint policy to vulnerability endpoints', () => {
    expect(parseConfig({
      provider: 'none',
      vulnerabilities: { endpoint: 'http://localhost:8000' },
    }).vulnerabilities?.endpoint).toBe('http://localhost:8000');

    expect(() => parseConfig({
      provider: 'none',
      vulnerabilities: { endpoint: 'http://api.osv.dev' },
    })).toThrow('configuration.vulnerabilities.endpoint');
  });

  it('rejects malformed privacy controls instead of coercing them', () => {
    expect(() => parseConfig({
      provider: 'none',
      telemetryEnabled: 'true',
      offlineMode: 'false',
    })).toThrow('configuration.telemetryEnabled must be a boolean');
  });
});
