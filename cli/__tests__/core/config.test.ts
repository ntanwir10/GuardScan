import { ConfigManager, Config } from '../../src/core/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let testConfigDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Create a temp directory for test configs
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = testConfigDir;

    configManager = new ConfigManager();
  });

  afterEach(() => {
    // Restore original HOME and clean up
    if (originalHome) {
      process.env.HOME = originalHome;
    }
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('init', () => {
    it('should create config directory', () => {
      configManager.init();

      const configDir = path.join(testConfigDir, '.guardscan');
      expect(fs.existsSync(configDir)).toBe(true);
    });

    it('should create cache directory', () => {
      configManager.init();

      const cacheDir = path.join(testConfigDir, '.guardscan', 'cache');
      expect(fs.existsSync(cacheDir)).toBe(true);
    });

    it('should generate a valid client ID', () => {
      const config = configManager.init();

      expect(config.clientId).toBeDefined();
      expect(config.clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should set default values', () => {
      const config = configManager.init();

      expect(config.provider).toBe('openai');
      expect(config.telemetryEnabled).toBe(true);
      expect(config.offlineMode).toBe(false);
      expect(config.createdAt).toBeDefined();
      expect(config.lastUsed).toBeDefined();
    });

    it('should not overwrite existing config', () => {
      const config1 = configManager.init();
      const clientId1 = config1.clientId;

      const config2 = configManager.init();
      const clientId2 = config2.clientId;

      expect(clientId1).toBe(clientId2);
    });
  });

  describe('load', () => {
    it('should load existing config', () => {
      const original = configManager.init();

      const loaded = configManager.load();

      expect(loaded.clientId).toBe(original.clientId);
      expect(loaded.provider).toBe(original.provider);
    });

    it('should throw error if config does not exist', () => {
      expect(() => configManager.load()).toThrow();
    });

    it('should update lastUsed on load', () => {
      configManager.init();

      const before = Date.now();
      const config = configManager.load();
      const after = Date.now();

      const lastUsed = new Date(config.lastUsed).getTime();
      expect(lastUsed).toBeGreaterThanOrEqual(before);
      expect(lastUsed).toBeLessThanOrEqual(after);
    });
  });

  describe('save', () => {
    it('should save config changes', () => {
      const config = configManager.init();

      config.provider = 'claude';
      config.apiKey = 'test-key';
      configManager.save(config);

      const loaded = configManager.load();
      expect(loaded.provider).toBe('claude');
      expect(loaded.apiKey).toBe('test-key');
    });

    it('should preserve other fields when saving', () => {
      const config = configManager.init();
      const originalClientId = config.clientId;

      config.provider = 'claude';
      configManager.save(config);

      const loaded = configManager.load();
      expect(loaded.clientId).toBe(originalClientId);
      expect(loaded.telemetryEnabled).toBe(true);
    });
  });

  describe('exists', () => {
    it('should return false when config does not exist', () => {
      expect(configManager.exists()).toBe(false);
    });

    it('should return true when config exists', () => {
      configManager.init();
      expect(configManager.exists()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should delete config file', () => {
      configManager.init();
      expect(configManager.exists()).toBe(true);

      configManager.reset();
      expect(configManager.exists()).toBe(false);
    });

    it('should delete cache directory', () => {
      configManager.init();
      const cacheDir = configManager.getCacheDir();

      configManager.reset();
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
