import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { v4 as uuidv4 } from "uuid";
import yaml from "js-yaml";
import { getSafeHomeDir, ensureDirectoryExists } from "../utils/path-helper";

export interface Config {
  clientId: string;
  provider: AIProvider;
  apiKey?: string;
  apiEndpoint?: string;
  model?: string; // AI model name (e.g., "gemini-2.5-flash", "gpt-4o", "claude-sonnet-4.5")
  embeddingFallback?: 'ollama' | 'lmstudio' | 'none';
  telemetryEnabled: boolean;
  offlineMode: boolean;
  createdAt: string;
  lastUsed: string;
}

export type AIProvider =
  | "openai"
  | "claude"
  | "gemini"
  | "ollama"
  | "lmstudio"
  | "openrouter"
  | "none";

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private cacheDir: string;
  private debug: boolean = process.env.GUARDSCAN_DEBUG === "true";

  constructor() {
    try {
      // Store config in ~/.guardscan (with safe home directory resolution)
      const homeDir = getSafeHomeDir();
      this.configDir = path.join(homeDir, ".guardscan");
      this.configPath = path.join(this.configDir, "config.yml");
      this.cacheDir = path.join(this.configDir, "cache");

      this.log(`Initialized ConfigManager with homeDir: ${homeDir}`);
      this.log(`configDir: ${this.configDir}`);

      // Defensive: ensure directories exist on construction
      this.ensureDirectoriesExist();
    } catch (error) {
      console.error("[ConfigManager] Failed to initialize:", error);
      throw new Error(`ConfigManager initialization failed: ${error}`);
    }
  }

  private log(message: string): void {
    if (this.debug) {
      console.error(`[ConfigManager] ${message}`);
    }
  }

  private ensureDirectoriesExist(): void {
    try {
      ensureDirectoryExists(this.configDir);
      ensureDirectoryExists(this.cacheDir);
      this.log("Directories ensured");
    } catch (error) {
      this.log(`Warning: Could not create directories: ${error}`);
      // Don't throw - will fail later with better context if needed
    }
  }

  /**
   * Initialize configuration directory and generate client_id
   */
  init(): Config {
    this.log("init() called");

    try {
      ensureDirectoryExists(this.configDir);
      ensureDirectoryExists(this.cacheDir);

      if (fs.existsSync(this.configPath)) {
        this.log("Config already exists, loading...");
        return this.load();
      }

      const config: Config = {
        clientId: uuidv4(),
        provider: "none",
        telemetryEnabled: false,
        offlineMode: true,
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      this.save(config);
      this.log("Config initialized successfully");
      return config;
    } catch (error) {
      this.log(`init() failed: ${error}`);
      throw new Error(`Failed to initialize configuration: ${error}`);
    }
  }

  /**
   * Load configuration from disk
   */
  load(): Config {
    this.log("load() called");

    if (!fs.existsSync(this.configPath)) {
      this.log(`Config file not found: ${this.configPath}`);
      throw new Error('Configuration not found. Run "guardscan init" first.');
    }

    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      this.log(`Config file read, length: ${content.length}`);

      const config = yaml.load(content) as Config | null | undefined;

      if (!config) {
        this.log("Config file is empty or invalid, reinitializing");
        // Config file exists but is empty/invalid, reinitialize
        return this.init();
      }

      this.log("Config parsed successfully");

      // Migration: Handle old configs without embeddingFallback field
      if (config.embeddingFallback === undefined) {
        config.embeddingFallback = undefined; // Default to undefined for backward compatibility
      }

      // Update last used
      config.lastUsed = new Date().toISOString();
      this.save(config);

      return config;
    } catch (error) {
      this.log(`load() failed: ${error}`);
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }

  /**
   * Save configuration to disk
   */
  save(config: Config): void {
    const content = yaml.dump(config, { indent: 2 });
    fs.writeFileSync(this.configPath, content, "utf-8");
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
    try {
      const exists = fs.existsSync(this.configPath);
      this.log(`exists() check: ${exists} for ${this.configPath}`);
      return exists;
    } catch (error) {
      this.log(`exists() check failed: ${error}`);
      return false;
    }
  }

  /**
   * Load configuration or auto-initialize if not found
   * This allows commands to work for first-time users without requiring init
   */
  loadOrInit(): Config {
    this.log("loadOrInit() called");

    if (this.exists()) {
      this.log("Config exists, loading...");
      return this.load();
    }

    this.log("Config does not exist, auto-initializing...");

    try {
      // Auto-initialize with minimal defaults for first-time users
      ensureDirectoryExists(this.configDir);
      ensureDirectoryExists(this.cacheDir);

      const config: Config = {
        clientId: uuidv4(),
        provider: "none", // Start with static analysis only
        telemetryEnabled: false, // Opt-in for telemetry
        offlineMode: true, // Default to offline for privacy
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      this.save(config);
      this.log("Auto-initialization completed");
      return config;
    } catch (error) {
      this.log(`loadOrInit() failed: ${error}`);
      throw new Error(`Failed to load or initialize configuration: ${error}`);
    }
  }

  /**
   * Reset configuration
   */
  reset(full: boolean = false): void {
    if (full) {
      // Delete entire config directory
      if (fs.existsSync(this.configDir)) {
        try {
          // Try to delete files first, then directory
          const files = fs.readdirSync(this.configDir);
          for (const file of files) {
            const filePath = path.join(this.configDir, file);
            try {
              const stat = fs.statSync(filePath);
              if (stat.isDirectory()) {
                fs.rmSync(filePath, { recursive: true, force: true });
              } else {
                fs.unlinkSync(filePath);
              }
            } catch (err) {
              // Ignore individual file errors, try to continue
            }
          }
          fs.rmSync(this.configDir, { recursive: true, force: true });
        } catch (error) {
          // If deletion fails, log but don't throw
          this.log(`Failed to delete config directory: ${error}`);
        }
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
