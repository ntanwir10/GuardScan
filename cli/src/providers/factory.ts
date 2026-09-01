import { AIProvider } from './base';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';
import { GeminiProvider } from './gemini';
import { OllamaProvider } from './ollama';
import {
  AIProvider as ProviderType,
  Config,
  DEFAULT_ENHANCED_CONFIG,
  mergeConfigWithEnhancedDefaults,
} from '../core/config';
import { repositoryManager } from '../core/repository';
import { ModelRouter, TaskType } from './model-router';
import { RetryProvider } from './decorators/retry-provider';
import { CachedProvider } from './decorators/cached-provider';
import { CircuitBreakerProvider } from './decorators/circuit-breaker-provider';
import { RateLimitedProvider } from './decorators/rate-limited-provider';
import { ObservableProvider } from './decorators/observable-provider';
import { MetricsCollector } from '../core/metrics-collector';
import { resolveExecutionPolicy } from '../utils/execution-policy';

export interface ProviderOptions {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  config?: Config;
  repoId?: string;
  enableRetry?: boolean;
  enableCache?: boolean;
  enableCircuitBreaker?: boolean;
  enableRateLimit?: boolean;
  enableObservability?: boolean;
  /** Effective network policy for this provider instance. */
  offline?: boolean;
}

export interface CreateForCliOptions {
  /** Task type for optional model routing (when modelRouting.enabled in config). */
  task?: TaskType;
  model?: string;
  endpoint?: string;
  /** Use plain provider without decorator stack (e.g. connection tests). */
  raw?: boolean;
  /** Command-level offline policy. Persistent offline mode can only tighten this. */
  offline?: boolean;
  /** Receives privacy warnings, primarily for non-loopback local-provider endpoints. */
  onWarning?: (message: string) => void;
}

export type ProviderConfigurationErrorCode =
  | 'NOT_CONFIGURED'
  | 'MISSING_CREDENTIAL'
  | 'OFFLINE_PROVIDER_BLOCKED'
  | 'REMOTE_SELF_HOSTED_NOT_APPROVED'
  | 'INVALID_ENDPOINT';

export class ProviderConfigurationError extends Error {
  constructor(
    public readonly code: ProviderConfigurationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}

const CLOUD_PROVIDERS = new Set<ProviderType>([
  'openai',
  'claude',
  'gemini',
  'openrouter',
]);

const LOCAL_PROVIDERS = new Set<ProviderType>(['ollama', 'lmstudio']);

const CREDENTIAL_ENV_VARS: Partial<Record<ProviderType, string[]>> = {
  openai: ['OPENAI_API_KEY'],
  claude: ['ANTHROPIC_API_KEY'],
  // Google documents both variables and gives GOOGLE_API_KEY precedence.
  gemini: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
};

export class ProviderFactory {
  static resolveCredential(
    config: Pick<Config, 'provider' | 'apiKey'>
  ): string | undefined {
    if (config.apiKey?.trim()) {
      return config.apiKey;
    }

    for (const envName of CREDENTIAL_ENV_VARS[config.provider] || []) {
      const value = process.env[envName];
      if (value?.trim()) {
        return value;
      }
    }

    return undefined;
  }

  static isConfigured(config: Pick<Config, 'provider' | 'apiKey'>): boolean {
    if (!config.provider || config.provider === 'none') {
      return false;
    }

    return LOCAL_PROVIDERS.has(config.provider) || !!this.resolveCredential(config);
  }

  static assertNetworkPolicy(provider: ProviderType, offline: boolean): void {
    if (resolveExecutionPolicy({ offline }).offline && CLOUD_PROVIDERS.has(provider)) {
      throw new ProviderConfigurationError(
        'OFFLINE_PROVIDER_BLOCKED',
        `Offline mode blocks the configured cloud AI provider "${provider}". ` +
        'Use static analysis, or configure Ollama or LM Studio.'
      );
    }
  }

  static normalizeEndpoint(
    provider: ProviderType,
    configuredEndpoint?: string,
    offline = false,
    allowRemoteSelfHosted = false
  ): string | undefined {
    let endpoint = configuredEndpoint?.trim();

    if (!endpoint) {
      if (provider === 'lmstudio') {
        endpoint = 'http://127.0.0.1:1234/v1';
      } else if (provider === 'ollama') {
        endpoint = process.env.OLLAMA_ENDPOINT?.trim() || 'http://127.0.0.1:11434';
      } else if (provider === 'openrouter') {
        endpoint = 'https://openrouter.ai/api/v1';
      } else {
        return undefined;
      }
    }

    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new ProviderConfigurationError(
        'INVALID_ENDPOINT',
        `Invalid ${provider} endpoint. Configure an absolute HTTP or HTTPS URL.`
      );
    }

    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new ProviderConfigurationError(
        'INVALID_ENDPOINT',
        `Invalid ${provider} endpoint. Configure an absolute HTTP or HTTPS URL without credentials, a query, or a fragment.`
      );
    }

    if (CLOUD_PROVIDERS.has(provider) && parsed.protocol !== 'https:') {
      throw new ProviderConfigurationError(
        'INVALID_ENDPOINT',
        `Credentialed ${provider} endpoints must use HTTPS.`
      );
    }

    if (LOCAL_PROVIDERS.has(provider) && !this.isLoopbackHostname(parsed.hostname)) {
      const effectiveOffline = offline ||
        ['true', '1'].includes(process.env.GUARDSCAN_OFFLINE?.trim().toLowerCase() || '');
      if (effectiveOffline) {
        throw new ProviderConfigurationError(
          'INVALID_ENDPOINT',
          `Offline mode only permits ${provider} endpoints at literal loopback IP addresses.`
        );
      }
      if (parsed.protocol !== 'https:') {
        throw new ProviderConfigurationError(
          'INVALID_ENDPOINT',
          `Remote ${provider} endpoints must use HTTPS to protect repository-derived content in transit.`
        );
      }
      if (!allowRemoteSelfHosted) {
        throw new ProviderConfigurationError(
          'REMOTE_SELF_HOSTED_NOT_APPROVED',
          `The non-loopback ${provider} endpoint requires allowRemoteSelfHosted: true.`
        );
      }
    }

    let pathname = parsed.pathname.replace(/\/+$/, '');
    if (provider === 'lmstudio' && !pathname.toLowerCase().endsWith('/v1')) {
      pathname = `${pathname}/v1`;
    }

    return `${parsed.origin}${pathname}`;
  }

  static getEndpointTrustWarning(
    provider: ProviderType,
    endpoint?: string
  ): string | undefined {
    if (!LOCAL_PROVIDERS.has(provider)) {
      return undefined;
    }

    const normalized = this.normalizeEndpoint(provider, endpoint, false, true);
    if (!normalized) {
      return undefined;
    }

    const hostname = new URL(normalized).hostname.toLowerCase();
    const loopback = this.isLoopbackHostname(hostname);

    if (loopback) {
      return undefined;
    }

    return (
      `${provider === 'lmstudio' ? 'LM Studio' : 'Ollama'} is configured at the ` +
      `non-loopback endpoint ${normalized}. Repository-derived content may leave ` +
      'this machine; continue only if you trust that endpoint.'
    );
  }

  private static isLoopbackHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    const ipv4 = normalized.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
    const isLoopbackIpv4 = ipv4 !== null && normalized.split('.').every(part => Number(part) <= 255) &&
      normalized.split('.')[0] === '127';
    return normalized === '::1' ||
      normalized === '[::1]' ||
      isLoopbackIpv4;
  }

  static create(
    provider: ProviderType,
    apiKey?: string,
    endpoint?: string,
    model?: string,
    offline = false,
    allowRemoteSelfHosted = false
  ): AIProvider {
    // Low-level callers still honor command-wide early network policy.
    const effectiveOffline = resolveExecutionPolicy({ offline }).offline;
    this.assertNetworkPolicy(provider, effectiveOffline);
    const resolvedEndpoint = this.normalizeEndpoint(
      provider,
      endpoint,
      effectiveOffline,
      allowRemoteSelfHosted
    );
    const resolvedCredential = this.resolveCredential({ provider, apiKey });

    if (CLOUD_PROVIDERS.has(provider) && !resolvedCredential) {
      const envVars = (CREDENTIAL_ENV_VARS[provider] || []).join(' or ');
      throw new ProviderConfigurationError(
        'MISSING_CREDENTIAL',
        `No credential is configured for ${provider}. Save an API key or set ${envVars}.`
      );
    }

    switch (provider) {
      case 'openai':
        return new OpenAIProvider(resolvedCredential, model, resolvedEndpoint);
      case 'claude':
        return new ClaudeProvider(resolvedCredential, model);
      case 'gemini':
        return new GeminiProvider(resolvedCredential, model);
      case 'ollama':
        return new OllamaProvider(resolvedEndpoint);
      case 'lmstudio':
        return new OpenAIProvider(
          resolvedCredential || 'lm-studio',
          model,
          resolvedEndpoint,
          'LM Studio',
          {
            providerName: 'LM Studio',
            defaultModel: model,
            capabilities: {
              supportsChat: true,
              supportsEmbeddings: false,
              supportsStreaming: true,
              maxContextTokens: 0,
            },
            pricing: undefined,
            modelPricing: {},
          }
        );
      case 'openrouter':
        return new OpenAIProvider(
          resolvedCredential,
          model,
          resolvedEndpoint,
          'OpenRouter',
          {
            providerName: 'OpenRouter',
            defaultModel: model,
            capabilities: {
              supportsChat: true,
              supportsEmbeddings: false,
              supportsStreaming: true,
              maxContextTokens: 0,
            },
            pricing: undefined,
            modelPricing: {},
          }
        );
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Create enhanced provider with decorator stack
   */
  static createEnhanced(
    provider: ProviderType,
    options: ProviderOptions
  ): AIProvider {
    this.assertNetworkPolicy(
      provider,
      options.offline === true || options.config?.offlineMode === true
    );

    // 1. Create base provider
    const effectiveOffline = resolveExecutionPolicy({
      offline: options.offline,
      configOffline: options.config?.offlineMode,
    }).offline;
    const base = this.create(
      provider,
      options.apiKey,
      options.endpoint,
      options.model,
      effectiveOffline,
      options.config?.allowRemoteSelfHosted === true
    );

    // 2. Get configuration (use defaults if not provided)
    const config = options.config || {} as Config;
    const repoId = options.repoId || 'default';

    // Merge with defaults
    const retryConfig = { ...DEFAULT_ENHANCED_CONFIG.retry, ...config.retry };
    const cacheConfig = { ...DEFAULT_ENHANCED_CONFIG.cache, ...config.cache };
    const circuitBreakerConfig = { ...DEFAULT_ENHANCED_CONFIG.circuitBreaker, ...config.circuitBreaker };
    const rateLimitConfig = { ...DEFAULT_ENHANCED_CONFIG.rateLimit, ...config.rateLimit };
    const observabilityConfig = { ...DEFAULT_ENHANCED_CONFIG.observability, ...config.observability };

    // 3. Stack decorators based on configuration
    let enhanced: AIProvider = base;

    // Apply decorators from innermost to outermost
    // Order matters: Retry → RateLimit → CircuitBreaker → Cache → Observable

    // Retry (innermost - should retry actual provider calls)
    if (options.enableRetry !== false && retryConfig?.enabled) {
      enhanced = new RetryProvider(enhanced, retryConfig);
    }

    // Rate Limiting (before circuit breaker to limit request rate)
    if (options.enableRateLimit && rateLimitConfig?.enabled) {
      enhanced = new RateLimitedProvider(enhanced, rateLimitConfig);
    }

    // Circuit Breaker (after rate limit to protect provider)
    if (options.enableCircuitBreaker !== false && circuitBreakerConfig?.enabled) {
      enhanced = new CircuitBreakerProvider(enhanced, circuitBreakerConfig);
    }

    // Cache (before observability to track cache hits)
    const cacheDisabledByEnvironment = ['true', '1'].includes(
      process.env.GUARDSCAN_NO_CACHE?.toLowerCase() || ''
    );
    if (
      options.enableCache !== false &&
      cacheConfig?.enabled &&
      !cacheDisabledByEnvironment
    ) {
      // Use enhanced provider for embeddings so they benefit from decorators
      enhanced = new CachedProvider(enhanced, repoId, enhanced, cacheConfig);
    }

    // Observability (outermost - tracks everything including cache hits)
    if (options.enableObservability !== false && observabilityConfig?.enabled) {
      const metrics = new MetricsCollector(repoId);
      enhanced = new ObservableProvider(enhanced, metrics, observabilityConfig);
    }

    return enhanced;
  }

  /**
   * Preferred entry point for CLI commands: merges enhanced defaults, optional
   * model routing, and decorator stack (retry, cache, observability, etc.).
   */
  static createForCli(config: Config, options: CreateForCliOptions = {}): AIProvider {
    if (!config.provider || config.provider === 'none') {
      throw new ProviderConfigurationError(
        'NOT_CONFIGURED',
        'AI provider is not configured'
      );
    }

    const merged = mergeConfigWithEnhancedDefaults(config);
    const provider = config.provider;
    const offline = resolveExecutionPolicy({
      configOffline: config.offlineMode,
      offline: options.offline,
    }).offline;
    this.assertNetworkPolicy(provider, offline);

    const credential = this.resolveCredential(config);
    if (CLOUD_PROVIDERS.has(provider) && !credential) {
      const envVars = (CREDENTIAL_ENV_VARS[provider] || []).join(' or ');
      throw new ProviderConfigurationError(
        'MISSING_CREDENTIAL',
        `No credential is configured for ${provider}. Save an API key or set ${envVars}.`
      );
    }

    let model = options.model ?? config.model;
    const endpoint = this.normalizeEndpoint(
      provider,
      options.endpoint ?? config.apiEndpoint,
      offline,
      config.allowRemoteSelfHosted === true
    );

    const warning = this.getEndpointTrustWarning(provider, endpoint);
    if (warning) {
      (options.onWarning || console.warn)(`Warning: ${warning}`);
    }

    if (options.task && merged.modelRouting?.enabled) {
      const router = new ModelRouter(merged);
      const selection = router.selectOptimalModel(options.task);
      if (selection.provider === config.provider) {
        model = selection.modelId;
      }
    }

    if (options.raw) {
      return this.create(
        provider,
        credential,
        endpoint,
        model,
        offline,
        config.allowRemoteSelfHosted === true
      );
    }

    const repoId = repositoryManager.getRepoInfo().repoId;

    return this.createEnhanced(provider, {
      apiKey: credential,
      endpoint,
      model,
      config: merged,
      repoId,
      offline,
      enableRateLimit: merged.rateLimit?.enabled === true,
    });
  }

  static getAvailableProviders(): ProviderType[] {
    return ['openai', 'claude', 'gemini', 'ollama', 'lmstudio', 'openrouter'];
  }
}
