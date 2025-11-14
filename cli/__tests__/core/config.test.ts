import { ConfigManager, Config } from '../../src/core/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let backupConfig: Config | null = null;

  beforeEach(() => {
    configManager = new ConfigManager();

    // Backup existing config if it exists
    if (configManager.exists()) {
      backupConfig = configManager.load();
      // Always reset before each test (full reset to delete config)
      configManager.reset(true);
    }
  });

  afterEach(() => {
    // Clean up test config (full reset to delete config)
    if (configManager.exists()) {
      configManager.reset(true);
    }

    // Restore backup if it existed
    if (backupConfig) {
      // Need to create the directory first since reset(true) deleted it
      const configDir = configManager.getConfigDir();
      const cacheDir = configManager.getCacheDir();
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      configManager.save(backupConfig);
      backupConfig = null;
    }
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

    it('should generate a valid client ID', () => {
      const config = configManager.init();

      expect(config.clientId).toBeDefined();
      expect(config.clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
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
        clientId: 'test-client-id-12345',
        provider: 'openai',
        apiKey: 'test-api-key',
        telemetryEnabled: true,
        offlineMode: false,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      configManager.save(config);
      const loaded = configManager.load();

      expect(loaded.clientId).toBe(config.clientId);
      expect(loaded.provider).toBe(config.provider);
      expect(loaded.apiKey).toBe(config.apiKey);
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

    it('should update lastUsed on load', () => {
      configManager.init();
      const beforeLoad = new Date();

      const config = configManager.load();

      const lastUsed = new Date(config.lastUsed);
      expect(lastUsed >= beforeLoad).toBe(true);
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
      expect(configDir).toBe(path.join(os.homedir(), '.guardscan'));
    });
  });

  describe('getCacheDir', () => {
    it('should return correct cache directory path', () => {
      const cacheDir = configManager.getCacheDir();
      expect(cacheDir).toBe(path.join(os.homedir(), '.guardscan', 'cache'));
    });
  });
});
