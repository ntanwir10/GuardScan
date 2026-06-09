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
}

export interface CreateForCliOptions {
  /** Task type for optional model routing (when modelRouting.enabled in config). */
  task?: TaskType;
  model?: string;
  endpoint?: string;
  /** Use plain provider without decorator stack (e.g. connection tests). */
  raw?: boolean;
}

export class ProviderFactory {
  static create(provider: ProviderType, apiKey?: string, endpoint?: string, model?: string): AIProvider {
    switch (provider) {
      case 'openai':
        return new OpenAIProvider(apiKey, model);
      case 'claude':
        return new ClaudeProvider(apiKey, model);
      case 'gemini':
        return new GeminiProvider(apiKey, model);
      case 'ollama':
        return new OllamaProvider(endpoint);
      case 'lmstudio':
        return new OllamaProvider(endpoint || 'http://localhost:1234');
      case 'openrouter':
        return new OpenAIProvider(apiKey, model); // OpenRouter uses OpenAI-compatible API
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
    // 1. Create base provider
    const base = this.create(provider, options.apiKey, options.endpoint, options.model);

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
    if (options.enableCache !== false && cacheConfig?.enabled) {
      // Use enhanced provider for embeddings so they benefit from decorators
      enhanced = new CachedProvider(enhanced, repoId, enhanced, cacheConfig);
    }

    // Observability (outermost - tracks everything including cache hits)
    if (options.enableObservability !== false && observabilityConfig?.enabled) {
      const metrics = new MetricsCollector(repoId, config.telemetryEnabled || false);
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
      throw new Error('AI provider is not configured');
    }

    const merged = mergeConfigWithEnhancedDefaults(config);
    let provider = config.provider;
    let model = options.model ?? config.model;
    const endpoint = options.endpoint ?? config.apiEndpoint;

    if (options.task && merged.modelRouting?.enabled) {
      const router = new ModelRouter(merged);
      const selection = router.selectOptimalModel(options.task);
      if (selection.provider === config.provider) {
        model = selection.modelId;
      }
    }

    if (options.raw) {
      return this.create(provider, config.apiKey, endpoint, model);
    }

    const repoId = repositoryManager.getRepoInfo().repoId;

    return this.createEnhanced(provider, {
      apiKey: config.apiKey,
      endpoint,
      model,
      config: merged,
      repoId,
      enableRateLimit: merged.rateLimit?.enabled === true,
    });
  }

  static getAvailableProviders(): ProviderType[] {
    return ['openai', 'claude', 'gemini', 'ollama', 'lmstudio', 'openrouter'];
  }
}
