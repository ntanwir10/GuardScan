import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import yaml from 'js-yaml';

export interface Config {
  clientId: string;
  provider: AIProvider;
  apiKey?: string;
  apiEndpoint?: string;
  telemetryEnabled: boolean;
  offlineMode: boolean;
  createdAt: string;
  lastUsed: string;
}

export type AIProvider = 'openai' | 'claude' | 'gemini' | 'ollama' | 'lmstudio' | 'openrouter';

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private cacheDir: string;

  constructor() {
    // Store config in ~/.guardscan
    this.configDir = path.join(os.homedir(), '.guardscan');
    this.configPath = path.join(this.configDir, 'config.yml');
    this.cacheDir = path.join(this.configDir, 'cache');
  }

  /**
   * Initialize configuration directory and generate client_id
   */
  init(): Config {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    if (fs.existsSync(this.configPath)) {
      return this.load();
    }

    const config: Config = {
      clientId: uuidv4(),
      provider: 'openai',
      telemetryEnabled: true,
      offlineMode: false,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    };

    this.save(config);
    return config;
  }

  /**
   * Load configuration from disk
   */
  load(): Config {
    if (!fs.existsSync(this.configPath)) {
      throw new Error('Configuration not found. Run "guardscan init" first.');
    }

    const content = fs.readFileSync(this.configPath, 'utf-8');
    const config = yaml.load(content) as Config;

    // Update last used
    config.lastUsed = new Date().toISOString();
    this.save(config);

    return config;
  }

  /**
   * Save configuration to disk
   */
  save(config: Config): void {
    const content = yaml.dump(config, { indent: 2 });
    fs.writeFileSync(this.configPath, content, 'utf-8');
  }

  /**
   * Update specific config values
   */
  update(updates: Partial<Config>): Config {
    const config = this.load();
    const updated = { ...config, ...updates };
    this.save(updated);
    return updated;
  }

  /**
   * Check if config exists
   */
  exists(): boolean {
    return fs.existsSync(this.configPath);
  }

  /**
   * Reset configuration
   */
  reset(full: boolean = false): void {
    if (full) {
      // Delete entire config directory
      if (fs.existsSync(this.configDir)) {
        fs.rmSync(this.configDir, { recursive: true, force: true });
      }
    } else {
      // Just clear cache but keep config
      if (fs.existsSync(this.cacheDir)) {
        fs.rmSync(this.cacheDir, { recursive: true, force: true });
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    }
  }

  /**
   * Get cache directory path
   */
  getCacheDir(): string {
    return this.cacheDir;
  }

  /**
   * Get config directory path
   */
  getConfigDir(): string {
    return this.configDir;
  }
}

export const configManager = new ConfigManager();
