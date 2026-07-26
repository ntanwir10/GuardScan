import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";
import { getSafeHomeDir, ensureDirectoryExists } from "../utils/path-helper";
import {
  acquireFileLease,
  atomicReplaceText,
  bestEffortChmod,
  readTextFileBounded,
} from "../utils/private-state";

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_CONFIG_DEPTH = 20;
const MAX_CONFIG_NODES = 5000;
const MAX_CONFIG_KEYS = 2000;
const MAX_CONFIG_SCALAR_BYTES = 64 * 1024;
const CONFIG_LEASE_STALE_MS = 30_000;
const CONFIG_LEASE_WAIT_MS = 5000;

export interface Config {
  /** Legacy installation identifier. Accepted when loading, never used or re-emitted. */
  clientId?: string;
  provider: AIProvider;
  apiKey?: string;
  apiEndpoint?: string;
  /** Explicit approval for non-loopback Ollama/LM Studio endpoints when online. */
  allowRemoteSelfHosted?: boolean;
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

  vulnerabilities?: {
    enabled: boolean;
    source: 'osv';
    endpoint: string;
    scope: 'all' | 'runtime';
    snapshotMaxAgeDays: number;
    enrichKnownExploited: boolean;
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

export interface LoadConfigOptions {
  touchLastUsed?: boolean;
}

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private configLeasePath: string;
  private cacheDir: string;
  private debug: boolean = process.env.GUARDSCAN_DEBUG === "true";

  constructor() {
    try {
      // Store config in ~/.guardscan (with safe home directory resolution)
      const homeDir = getSafeHomeDir();
      this.configDir = path.join(homeDir, ".guardscan");
      this.configPath = path.join(this.configDir, "config.yml");
      this.configLeasePath = path.join(this.configDir, "config.lock");
      this.cacheDir = path.join(this.configDir, "cache");

      this.log(`Initialized ConfigManager with homeDir: ${homeDir}`);
      this.log(`configDir: ${this.configDir}`);
    } catch (error) {
      console.error("[ConfigManager] Failed to initialize:", error);
      throw new Error(`ConfigManager initialization failed: ${errorMessage(error)}`);
    }
  }

  private log(message: string): void {
    if (this.debug) {
      console.error(`[ConfigManager] ${message}`);
    }
  }

  private ensureDirectoriesExist(): void {
    if (!ensureDirectoryExists(this.configDir) || !ensureDirectoryExists(this.cacheDir)) {
      throw new Error(
        `Could not create private GuardScan state beneath ${this.configDir}. ` +
        'Check ownership and permissions or set GUARDSCAN_HOME.'
      );
    }
    bestEffortChmod(this.configDir, 0o700);
    bestEffortChmod(this.cacheDir, 0o700);
    this.log("Directories ensured");
  }

  /**
   * Initialize the local configuration directory.
   */
  init(): Config {
    this.log("init() called");

    try {
      this.ensureDirectoriesExist();

      if (fs.existsSync(this.configPath)) {
        this.log("Config already exists, loading...");
        return this.load({ touchLastUsed: false });
      }

      const config: Config = {
        provider: "none",
        telemetryEnabled: false,
        offlineMode: true,
        vulnerabilities: defaultVulnerabilityConfig(),
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      this.save(config);
      this.log("Config initialized successfully");
      return config;
    } catch (error) {
      this.log(`init() failed: ${errorMessage(error)}`);
      throw new Error(`Failed to initialize configuration: ${errorMessage(error)}`);
    }
  }

  /**
   * Load configuration from disk
   */
  load(options: LoadConfigOptions = {}): Config {
    this.log("load() called");

    this.ensureDirectoriesExist();

    if (!fs.existsSync(this.configPath)) {
      this.log(`Config file not found: ${this.configPath}`);
      throw new Error('Configuration not found. Run "guardscan init" first.');
    }

    try {
      if (options.touchLastUsed === true) {
        return this.withConfigLease(() => {
          const config = this.readConfigFile();
          config.lastUsed = new Date().toISOString();
          this.persistConfig(config);
          return config;
        });
      }
      return this.readConfigFile();
    } catch (error) {
      this.log(`load() failed: ${errorMessage(error)}`);
      throw new Error(`Failed to load configuration: ${errorMessage(error)}`);
    }
  }

  /**
   * Save configuration to disk
   */
  save(config: Config): void {
    this.ensureDirectoriesExist();
    this.withConfigLease(() => this.persistConfig(config));
  }

  /**
   * Update specific config values
   */
  update(updates: Partial<Config>): Config {
    this.ensureDirectoriesExist();
    return this.withConfigLease(() => {
      const config = this.readConfigFile();
      const updated = parseConfig({ ...config, ...updates });
      this.persistConfig(updated);
      return updated;
    });
  }

  private readConfigFile(): Config {
    const content = readTextFileBounded(this.configPath, MAX_CONFIG_BYTES);
    this.log(`Config file read, length: ${content.length}`);
    const parsed = yaml.load(content, {schema: yaml.JSON_SCHEMA});
    assertConfigDocumentBounds(parsed);
    const config = parseConfig(parsed);
    this.log("Config parsed successfully");
    bestEffortChmod(this.configPath, 0o600);
    return config;
  }

  private persistConfig(config: Config): void {
    const persisted = { ...parseConfig(config) };
    delete persisted.clientId;
    const content = yaml.dump(persisted, { indent: 2, schema: yaml.JSON_SCHEMA });
    if (Buffer.byteLength(content, 'utf8') > MAX_CONFIG_BYTES) {
      throw new Error('configuration exceeds size limit');
    }
    this.replaceConfigFile(content);
  }

  private withConfigLease<T>(operation: () => T): T {
    const deadline = Date.now() + CONFIG_LEASE_WAIT_MS;
    for (;;) {
      try {
        const lease = acquireFileLease(this.configLeasePath, CONFIG_LEASE_STALE_MS);
        try {return operation();} finally {lease.release();}
      } catch (error) {
        if (errorMessage(error) !== 'operation is already in progress' || Date.now() >= deadline) {
          throw error;
        }
        sleepSynchronously(10);
      }
    }
  }

  private replaceConfigFile(content: string): void {
    atomicReplaceText(this.configPath, content);
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
      this.log(`exists() check failed: ${errorMessage(error)}`);
      return false;
    }
  }

  /**
   * Load configuration or auto-initialize if not found
   * This allows commands to work for first-time users without requiring init
   */
  loadOrInit(options: LoadConfigOptions = { touchLastUsed: true }): Config {
    this.log("loadOrInit() called");

    if (this.exists()) {
      this.log("Config exists, loading...");
      return this.load(options);
    }

    this.log("Config does not exist, auto-initializing...");

    try {
      // Auto-initialize with minimal defaults for first-time users
      this.ensureDirectoriesExist();

      const config: Config = {
        provider: "none", // Start with static analysis only
        telemetryEnabled: false, // Opt-in for telemetry
        offlineMode: true, // Default to offline for privacy
        vulnerabilities: defaultVulnerabilityConfig(),
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      };

      this.save(config);
      this.log("Auto-initialization completed");
      return config;
    } catch (error) {
      this.log(`loadOrInit() failed: ${errorMessage(error)}`);
      throw new Error(`Failed to load or initialize configuration: ${errorMessage(error)}`);
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
            } catch {
              // Ignore individual file errors, try to continue
            }
          }
          fs.rmSync(this.configDir, { recursive: true, force: true });
        } catch (error) {
          // If deletion fails, log but don't throw
          this.log(`Failed to delete config directory: ${errorMessage(error)}`);
        }
      }
    } else {
      // Just clear cache but keep config
      if (fs.existsSync(this.cacheDir)) {
        fs.rmSync(this.cacheDir, { recursive: true, force: true });
        fs.mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
        bestEffortChmod(this.cacheDir, 0o700);
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
  vulnerabilities: defaultVulnerabilityConfig(),
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

function defaultVulnerabilityConfig(): NonNullable<Config['vulnerabilities']> {
  return {
    enabled: true,
    source: 'osv',
    endpoint: 'https://api.osv.dev',
    scope: 'all',
    snapshotMaxAgeDays: 7,
    enrichKnownExploited: true,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleepSynchronously(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function assertConfigDocumentBounds(value: unknown): void {
  const pending: Array<{value: unknown; depth: number}> = [{value, depth: 0}];
  const visited = new WeakSet<object>();
  let nodes = 0;
  let keys = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_CONFIG_NODES) {throw new Error('configuration exceeds node limit');}
    if (current.depth > MAX_CONFIG_DEPTH) {throw new Error('configuration exceeds depth limit');}
    if (typeof current.value === 'string' &&
        Buffer.byteLength(current.value, 'utf8') > MAX_CONFIG_SCALAR_BYTES) {
      throw new Error('configuration scalar exceeds size limit');
    }
    if (!current.value || typeof current.value !== 'object') {continue;}
    if (visited.has(current.value)) {
      throw new Error('configuration YAML aliases are not supported');
    }
    visited.add(current.value);
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        pending.push({value: item, depth: current.depth + 1});
      }
      continue;
    }
    const entries = Object.entries(current.value as Record<string, unknown>);
    keys += entries.length;
    if (keys > MAX_CONFIG_KEYS) {throw new Error('configuration exceeds key limit');}
    for (const [key, item] of entries) {
      if (Buffer.byteLength(key, 'utf8') > MAX_CONFIG_SCALAR_BYTES) {
        throw new Error('configuration key exceeds size limit');
      }
      pending.push({value: item, depth: current.depth + 1});
    }
  }
}

type UnknownRecord = Record<string, unknown>;

const PROVIDERS: readonly AIProvider[] = [
  'openai', 'claude', 'gemini', 'ollama', 'lmstudio', 'openrouter', 'none',
];
const ROUTING_STRATEGIES = ['cost', 'quality', 'speed', 'balanced'] as const;
const ROUTING_TASKS = [
  'code-review', 'code-generation', 'chat', 'explanation', 'refactoring', 'test-generation',
] as const;
const TOP_LEVEL_KEYS = [
  'clientId', 'provider', 'apiKey', 'apiEndpoint', 'allowRemoteSelfHosted', 'model', 'embeddingFallback',
  'telemetryEnabled', 'offlineMode', 'createdAt', 'lastUsed', 'retry', 'circuitBreaker',
  'rateLimit', 'cache', 'vulnerabilities', 'observability', 'budget', 'modelRouting',
] as const;

/** Validate persisted YAML before it can influence privacy or network behavior. */
export function parseConfig(value: unknown): Config {
  const input = requireRecord(value, 'configuration');
  rejectUnknownKeys(input, TOP_LEVEL_KEYS, 'configuration');
  const now = new Date().toISOString();
  const provider = input.provider === undefined ? 'none' : input.provider;
  if (!isOneOf(provider, PROVIDERS)) {
    throw new Error('configuration.provider must be a supported provider');
  }

  validateOptionalString(input, 'apiKey');
  validateOptionalString(input, 'model');
  validateOptionalEnum(input, 'embeddingFallback', ['ollama', 'lmstudio', 'none']);
  validateOptionalEndpoint(input, 'apiEndpoint', 'configuration.apiEndpoint');
  validateOptionalTimestamp(input, 'createdAt');
  validateOptionalTimestamp(input, 'lastUsed');

  const config: Config = {
    provider,
    telemetryEnabled: input.telemetryEnabled === true,
    offlineMode: input.offlineMode === false ? false : true,
    allowRemoteSelfHosted: input.allowRemoteSelfHosted === true,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    lastUsed: typeof input.lastUsed === 'string' ? input.lastUsed : now,
    vulnerabilities: normalizeVulnerabilities(input.vulnerabilities),
  };
  if (typeof input.apiKey === 'string') {config.apiKey = input.apiKey;}
  if (typeof input.apiEndpoint === 'string') {config.apiEndpoint = input.apiEndpoint;}
  if (typeof input.model === 'string') {config.model = input.model;}
  if (isOneOf(input.embeddingFallback, ['ollama', 'lmstudio', 'none'])) {
    config.embeddingFallback = input.embeddingFallback;
  }
  if (input.retry !== undefined) {config.retry = normalizeRetry(input.retry);}
  if (input.circuitBreaker !== undefined) {
    config.circuitBreaker = normalizeCircuitBreaker(input.circuitBreaker);
  }
  if (input.rateLimit !== undefined) {config.rateLimit = normalizeRateLimit(input.rateLimit);}
  if (input.cache !== undefined) {config.cache = normalizeCache(input.cache);}
  if (input.observability !== undefined) {
    config.observability = normalizeObservability(input.observability);
  }
  if (input.budget !== undefined) {config.budget = normalizeBudget(input.budget);}
  if (input.modelRouting !== undefined) {
    config.modelRouting = normalizeModelRouting(input.modelRouting);
  }
  return config;
}

function requireRecord(value: unknown, name: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as UnknownRecord;
}

function normalizeRetry(value: unknown): NonNullable<Config['retry']> {
  const section = sectionRecord(value, 'retry', ['enabled', 'maxRetries', 'baseDelayMs', 'maxDelayMs']);
  const defaults = requireDefaults(DEFAULT_ENHANCED_CONFIG.retry, 'retry');
  return {
    enabled: optionalValue(section, 'enabled', isBoolean, defaults.enabled, 'configuration.retry'),
    maxRetries: optionalValue(section, 'maxRetries', isNonNegativeInteger, defaults.maxRetries, 'configuration.retry'),
    baseDelayMs: optionalValue(section, 'baseDelayMs', isNonNegativeInteger, defaults.baseDelayMs, 'configuration.retry'),
    maxDelayMs: optionalValue(section, 'maxDelayMs', isNonNegativeInteger, defaults.maxDelayMs, 'configuration.retry'),
  };
}

function normalizeCircuitBreaker(value: unknown): NonNullable<Config['circuitBreaker']> {
  const section = sectionRecord(value, 'circuitBreaker', [
    'enabled', 'failureThreshold', 'resetTimeoutMs', 'halfOpenSuccessThreshold',
  ]);
  const defaults = requireDefaults(DEFAULT_ENHANCED_CONFIG.circuitBreaker, 'circuitBreaker');
  return {
    enabled: optionalValue(section, 'enabled', isBoolean, defaults.enabled, 'configuration.circuitBreaker'),
    failureThreshold: optionalValue(section, 'failureThreshold', isNonNegativeInteger, defaults.failureThreshold, 'configuration.circuitBreaker'),
    resetTimeoutMs: optionalValue(section, 'resetTimeoutMs', isNonNegativeInteger, defaults.resetTimeoutMs, 'configuration.circuitBreaker'),
    halfOpenSuccessThreshold: optionalValue(section, 'halfOpenSuccessThreshold', isNonNegativeInteger, defaults.halfOpenSuccessThreshold, 'configuration.circuitBreaker'),
  };
}

function normalizeRateLimit(value: unknown): NonNullable<Config['rateLimit']> {
  const section = sectionRecord(value, 'rateLimit', ['enabled', 'maxTokens', 'refillRate']);
  const defaults = requireDefaults(DEFAULT_ENHANCED_CONFIG.rateLimit, 'rateLimit');
  return {
    enabled: optionalValue(section, 'enabled', isBoolean, defaults.enabled, 'configuration.rateLimit'),
    maxTokens: optionalValue(section, 'maxTokens', isNonNegativeInteger, defaults.maxTokens, 'configuration.rateLimit'),
    refillRate: optionalValue(section, 'refillRate', isNonNegativeInteger, defaults.refillRate, 'configuration.rateLimit'),
  };
}

function normalizeCache(value: unknown): NonNullable<Config['cache']> {
  const section = sectionRecord(value, 'cache', [
    'enabled', 'semanticThreshold', 'maxSizeMB', 'ttlSeconds',
  ]);
  const defaults = requireDefaults(DEFAULT_ENHANCED_CONFIG.cache, 'cache');
  return {
    enabled: optionalValue(section, 'enabled', isBoolean, defaults.enabled, 'configuration.cache'),
    semanticThreshold: optionalValue(section, 'semanticThreshold', isUnitInterval, defaults.semanticThreshold, 'configuration.cache'),
    maxSizeMB: optionalValue(section, 'maxSizeMB', isNonNegativeInteger, defaults.maxSizeMB, 'configuration.cache'),
    ttlSeconds: optionalValue(section, 'ttlSeconds', isNonNegativeInteger, defaults.ttlSeconds, 'configuration.cache'),
  };
}

function normalizeVulnerabilities(value: unknown): NonNullable<Config['vulnerabilities']> {
  const defaults = defaultVulnerabilityConfig();
  if (value === undefined) {return defaults;}
  const section = sectionRecord(value, 'vulnerabilities', [
    'enabled', 'source', 'endpoint', 'scope', 'snapshotMaxAgeDays', 'enrichKnownExploited',
  ]);
  const endpoint = optionalValue(section, 'endpoint', isAllowedEndpoint, defaults.endpoint, 'configuration.vulnerabilities');
  return {
    enabled: optionalValue(section, 'enabled', isBoolean, defaults.enabled, 'configuration.vulnerabilities'),
    source: optionalValue(section, 'source', (candidate): candidate is 'osv' => candidate === 'osv', defaults.source, 'configuration.vulnerabilities'),
    endpoint,
    scope: optionalValue(section, 'scope', (candidate): candidate is 'all' | 'runtime' => candidate === 'all' || candidate === 'runtime', defaults.scope, 'configuration.vulnerabilities'),
    snapshotMaxAgeDays: optionalValue(section, 'snapshotMaxAgeDays', isNonNegativeInteger, defaults.snapshotMaxAgeDays, 'configuration.vulnerabilities'),
    enrichKnownExploited: optionalValue(section, 'enrichKnownExploited', isBoolean, defaults.enrichKnownExploited, 'configuration.vulnerabilities'),
  };
}

function normalizeObservability(value: unknown): NonNullable<Config['observability']> {
  const section = sectionRecord(value, 'observability', ['enabled', 'exportPath', 'logSpans']);
  const defaults = requireDefaults(DEFAULT_ENHANCED_CONFIG.observability, 'observability');
  const normalized: NonNullable<Config['observability']> = {
    enabled: optionalValue(section, 'enabled', isBoolean, defaults.enabled, 'configuration.observability'),
    logSpans: optionalValue(section, 'logSpans', isBoolean, defaults.logSpans ?? false, 'configuration.observability'),
  };
  if (section.exportPath !== undefined) {
    normalized.exportPath = requiredValue(section, 'exportPath', isString, 'configuration.observability');
  } else if (defaults.exportPath !== undefined) {
    normalized.exportPath = defaults.exportPath;
  }
  return normalized;
}

function normalizeBudget(value: unknown): NonNullable<Config['budget']> {
  const section = sectionRecord(value, 'budget', [
    'dailyLimit', 'monthlyLimit', 'perRequestLimit', 'warningThreshold',
  ]);
  const defaults = requireDefaults(DEFAULT_ENHANCED_CONFIG.budget, 'budget');
  return {
    dailyLimit: optionalValue(section, 'dailyLimit', isNonNegativeNumber, defaults.dailyLimit, 'configuration.budget'),
    monthlyLimit: optionalValue(section, 'monthlyLimit', isNonNegativeNumber, defaults.monthlyLimit, 'configuration.budget'),
    perRequestLimit: optionalValue(section, 'perRequestLimit', isNonNegativeNumber, defaults.perRequestLimit, 'configuration.budget'),
    warningThreshold: optionalValue(section, 'warningThreshold', isUnitInterval, defaults.warningThreshold, 'configuration.budget'),
  };
}

function normalizeModelRouting(value: unknown): NonNullable<Config['modelRouting']> {
  const routing = requireRecord(value, 'configuration.modelRouting');
  rejectUnknownKeys(routing, ['enabled', 'strategy', 'taskOverrides'], 'configuration.modelRouting');
  const defaults = requireDefaults(DEFAULT_ENHANCED_CONFIG.modelRouting, 'modelRouting');
  const normalized: NonNullable<Config['modelRouting']> = {
    enabled: optionalValue(routing, 'enabled', isBoolean, defaults.enabled, 'configuration.modelRouting'),
    strategy: optionalValue(routing, 'strategy', isRoutingStrategy, defaults.strategy, 'configuration.modelRouting'),
    taskOverrides: {},
  };
  if (routing.taskOverrides === undefined) {return normalized;}
  const overrides = requireRecord(routing.taskOverrides, 'configuration.modelRouting.taskOverrides');
  rejectUnknownKeys(overrides, ROUTING_TASKS, 'configuration.modelRouting.taskOverrides');
  for (const task of ROUTING_TASKS) {
    if (overrides[task] === undefined) {continue;}
    const override = requireRecord(overrides[task], `configuration.modelRouting.taskOverrides.${task}`);
    rejectUnknownKeys(override, ['model', 'priority'], `configuration.modelRouting.taskOverrides.${task}`);
    validateOptionalStringAt(override, 'model', `configuration.modelRouting.taskOverrides.${task}`);
    validateOptionalEnumAt(override, 'priority', ROUTING_STRATEGIES, `configuration.modelRouting.taskOverrides.${task}`);
    const normalizedOverride: { model?: string; priority?: typeof ROUTING_STRATEGIES[number] } = {};
    if (typeof override.model === 'string') {normalizedOverride.model = override.model;}
    if (isRoutingStrategy(override.priority)) {normalizedOverride.priority = override.priority;}
    normalized.taskOverrides![task] = normalizedOverride;
  }
  return normalized;
}

function sectionRecord(value: unknown, key: string, allowed: readonly string[]): UnknownRecord {
  const section = requireRecord(value, `configuration.${key}`);
  rejectUnknownKeys(section, allowed, `configuration.${key}`);
  return section;
}

function rejectUnknownKeys(input: UnknownRecord, allowed: readonly string[], pathName: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {throw new Error(`${pathName}.${key} is not supported`);}
  }
}

function requireDefaults<T>(value: T | undefined, name: string): T {
  if (value === undefined) {throw new Error(`Missing internal defaults for ${name}`);}
  return value;
}

function optionalValue<T>(
  input: UnknownRecord,
  key: string,
  validator: (value: unknown) => value is T,
  defaultValue: T,
  pathName: string
): T {
  return input[key] === undefined
    ? defaultValue
    : requiredValue(input, key, validator, pathName);
}

function requiredValue<T>(
  input: UnknownRecord,
  key: string,
  validator: (value: unknown) => value is T,
  pathName: string
): T {
  const value = input[key];
  if (!validator(value)) {throw new Error(`${pathName}.${key} has an invalid value`);}
  return value;
}

function validateOptionalString(input: UnknownRecord, key: string): void {
  if (input[key] !== undefined && !isString(input[key])) {
    throw new Error(`configuration.${key} must be a string`);
  }
}

function validateOptionalStringAt(input: UnknownRecord, key: string, pathName: string): void {
  if (input[key] !== undefined && !isString(input[key])) {
    throw new Error(`${pathName}.${key} must be a string`);
  }
}

function validateOptionalEnum(
  input: UnknownRecord,
  key: string,
  values: readonly string[]
): void {
  if (input[key] !== undefined && !isOneOf(input[key], values)) {
    throw new Error(`configuration.${key} has an invalid value`);
  }
}

function validateOptionalEnumAt(
  input: UnknownRecord,
  key: string,
  values: readonly string[],
  pathName: string
): void {
  if (input[key] !== undefined && !isOneOf(input[key], values)) {
    throw new Error(`${pathName}.${key} has an invalid value`);
  }
}

function validateOptionalEndpoint(input: UnknownRecord, key: string, pathName: string): void {
  if (input[key] !== undefined && !isAllowedEndpoint(input[key])) {
    throw new Error(`${pathName} has an invalid value`);
  }
}

function validateOptionalTimestamp(input: UnknownRecord, key: string): void {
  if (input[key] !== undefined && !isValidTimestamp(input[key])) {
    throw new Error(`configuration.${key} must be a valid timestamp`);
  }
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function isString(value: unknown): value is string { return typeof value === 'string'; }
function isBoolean(value: unknown): value is boolean { return typeof value === 'boolean'; }
function isRoutingStrategy(value: unknown): value is typeof ROUTING_STRATEGIES[number] {
  return isOneOf(value, ROUTING_STRATEGIES);
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}
function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeNumber(value) && Number.isInteger(value);
}
function isUnitInterval(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {return false;}
  const calendarDate = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!calendarDate) {return true;}
  const year = Number(calendarDate[1]);
  const month = Number(calendarDate[2]);
  const day = Number(calendarDate[3]);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  return calendarCheck.getUTCFullYear() === year
    && calendarCheck.getUTCMonth() + 1 === month
    && calendarCheck.getUTCDate() === day;
}

function isAllowedEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') {return false;}
  try {
    const endpoint = new URL(value);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {return false;}
    if (endpoint.protocol === 'https:') {return true;}
    if (endpoint.protocol !== 'http:') {return false;}
    const hostname = endpoint.hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname === '::1'
      || hostname === '[::1]'
      || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  } catch {
    return false;
  }
}

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
    vulnerabilities: {
      ...DEFAULT_ENHANCED_CONFIG.vulnerabilities,
      ...config.vulnerabilities,
    } as NonNullable<Config['vulnerabilities']>,
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
