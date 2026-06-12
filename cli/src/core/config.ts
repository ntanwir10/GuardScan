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
  
  // Reliability features
  retry?: {
    enabled: boolean;
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  
  circuitBreaker?: {
    enabled: boolean;
    failureThreshold: number;
    resetTimeoutMs: number;
    halfOpenSuccessThreshold: number;
  };
  
  rateLimit?: {
    enabled: boolean;
    maxTokens: number;
    refillRate: number;
  };
  
  cache?: {
    enabled: boolean;
    semanticThreshold: number;
    maxSizeMB: number;
    ttlSeconds: number;
  };
  
  observability?: {
    enabled: boolean;
    exportPath?: string;
    logSpans?: boolean;
  };
  
  budget?: {
    dailyLimit: number;
    monthlyLimit: number;
    perRequestLimit: number;
    warningThreshold: number;
  };
  
  modelRouting?: {
    enabled: boolean;
    strategy: 'cost' | 'quality' | 'speed' | 'balanced';
    taskOverrides?: {
      'code-review'?: {
        model?: string;
        priority?: 'cost' | 'quality' | 'speed' | 'balanced';
      };
      'code-generation'?: {
        model?: string;
        priority?: 'cost' | 'quality' | 'speed' | 'balanced';
      };
      'chat'?: {
        model?: string;
        priority?: 'cost' | 'quality' | 'speed' | 'balanced';
      };
      'explanation'?: {
        model?: string;
        priority?: 'cost' | 'quality' | 'speed' | 'balanced';
      };
      'refactoring'?: {
        model?: string;
        priority?: 'cost' | 'quality' | 'speed' | 'balanced';
      };
      'test-generation'?: {
        model?: string;
        priority?: 'cost' | 'quality' | 'speed' | 'balanced';
      };
    };
  };
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

/** Default configuration for enhanced AI features (retry, cache, routing, etc.). */
export const DEFAULT_ENHANCED_CONFIG: Partial<Config> = {
  retry: {
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    resetTimeoutMs: 60000,
    halfOpenSuccessThreshold: 2,
  },
  rateLimit: {
    enabled: false, // Opt-in
    maxTokens: 100000,
    refillRate: 1000,
  },
  cache: {
    enabled: true,
    semanticThreshold: 0.95,
    maxSizeMB: 100,
    ttlSeconds: 3600,
  },
  observability: {
    enabled: true,
    logSpans: false,
  },
  budget: {
    dailyLimit: 10,
    monthlyLimit: 100,
    perRequestLimit: 1,
    warningThreshold: 0.8,
  },
  modelRouting: {
    enabled: false, // Opt-in
    strategy: 'balanced',
    taskOverrides: {},
  },
};

/** Merge user config with enhanced-feature defaults (retry, cache, observability, etc.). */
export function mergeConfigWithEnhancedDefaults(config: Config): Config {
  return {
    ...config,
    retry: { ...DEFAULT_ENHANCED_CONFIG.retry, ...config.retry },
    circuitBreaker: {
      ...DEFAULT_ENHANCED_CONFIG.circuitBreaker,
      ...config.circuitBreaker,
    },
    rateLimit: { ...DEFAULT_ENHANCED_CONFIG.rateLimit, ...config.rateLimit },
    cache: { ...DEFAULT_ENHANCED_CONFIG.cache, ...config.cache },
    observability: {
      ...DEFAULT_ENHANCED_CONFIG.observability,
      ...config.observability,
    },
    budget: { ...DEFAULT_ENHANCED_CONFIG.budget, ...config.budget },
    modelRouting: {
      ...DEFAULT_ENHANCED_CONFIG.modelRouting,
      ...config.modelRouting,
    },
  } as Config;
}
