/**
 * embedding-factory.ts - Factory for creating embedding providers based on AI provider configuration
 *
 * Maps AI providers to their corresponding embedding providers.
 * Handles direct mapping and configurable fallbacks for providers without native embedding support.
 */

import { EmbeddingProvider } from "../core/embeddings";
import { OpenAIEmbeddingProvider } from "./embedding-openai";
import { GeminiEmbeddingProvider } from "./embedding-gemini";
import { ClaudeEmbeddingProvider } from "./embedding-claude";
import { OllamaEmbeddingProvider } from "./embedding-ollama";
import { LMStudioEmbeddingProvider } from "./embedding-lmstudio";
import { AIProvider, Config } from "../core/config";
import { ProviderFactory } from "./factory";

export type EmbeddingFallbackProvider = "ollama" | "lmstudio" | "none";

export interface EmbeddingProviderResult {
  provider: EmbeddingProvider;
  isFallback: boolean;
  fallbackReason?: string;
  dimensions: number;
  fallbackProvider?: "ollama" | "lmstudio";
}

export interface CreateEmbeddingForCliOptions {
  provider?: Exclude<AIProvider, "none">;
  endpoint?: string;
  fallback?: EmbeddingFallbackProvider;
  offline?: boolean;
}

export class EmbeddingProviderFactory {
  static createForCli(
    config: Pick<
      Config,
      "provider" | "apiKey" | "apiEndpoint" | "embeddingFallback" | "offlineMode" |
      "allowRemoteSelfHosted"
    >,
    options: CreateEmbeddingForCliOptions = {}
  ): EmbeddingProviderResult {
    const provider = options.provider || config.provider;
    const usesConfiguredProvider = provider === config.provider;
    const fallback =
      options.fallback !== undefined
        ? options.fallback
        : usesConfiguredProvider || provider === 'claude'
          ? config.embeddingFallback
          : undefined;

    return this.create(
      provider,
      usesConfiguredProvider ? config.apiKey : undefined,
      options.endpoint ?? (usesConfiguredProvider ? config.apiEndpoint : undefined),
      fallback,
      config.offlineMode || options.offline === true,
      config.allowRemoteSelfHosted === true
    );
  }

  /**
   * Create embedding provider based on AI provider and fallback preference
   */
  static create(
    aiProvider: AIProvider,
    apiKey?: string,
    apiEndpoint?: string,
    embeddingFallback?: EmbeddingFallbackProvider,
    offline: boolean = false,
    allowRemoteSelfHosted: boolean = false
  ): EmbeddingProviderResult {
    let provider: EmbeddingProvider;
    let isFallback = false;
    let fallbackReason: string | undefined;
    let dimensions: number;
    let fallbackProvider: "ollama" | "lmstudio" | undefined;

    // Handle fallback override first (if user explicitly chose fallback)
    if (embeddingFallback === "ollama" || embeddingFallback === "lmstudio") {
      ProviderFactory.assertNetworkPolicy(embeddingFallback, offline);
      const endpoint = ProviderFactory.normalizeEndpoint(
        embeddingFallback,
        apiEndpoint,
        offline,
        allowRemoteSelfHosted
      );
      // User wants to use local provider regardless of AI provider
      if (embeddingFallback === "lmstudio") {
        provider = new LMStudioEmbeddingProvider(endpoint, offline, allowRemoteSelfHosted);
        dimensions = 768;
        fallbackProvider = "lmstudio";
      } else {
        provider = new OllamaEmbeddingProvider(endpoint, offline, allowRemoteSelfHosted);
        dimensions = 768;
        fallbackProvider = "ollama";
      }
      isFallback = true;
      fallbackReason = `Using ${embeddingFallback} for embeddings (configured fallback)`;
      return {
        provider,
        isFallback,
        fallbackReason,
        dimensions,
        fallbackProvider,
      };
    }

    // Handle native providers or default fallbacks. Apply policy to the actual
    // embedding transport, which may be local even when chat uses Claude.
    const credential = ProviderFactory.resolveCredential({
      provider: aiProvider,
      apiKey,
    });

    switch (aiProvider) {
      case "openai":
        ProviderFactory.assertNetworkPolicy('openai', offline);
        if (embeddingFallback === "none" || embeddingFallback === undefined) {
          // Use native OpenAI embeddings
          if (!credential) {
            throw new Error("OpenAI API key required for OpenAI embeddings");
          }
          provider = new OpenAIEmbeddingProvider(
            credential,
            ProviderFactory.normalizeEndpoint('openai', apiEndpoint, offline)
          );
          dimensions = 1536;
        } else {
          // Should not reach here due to earlier check, but handle gracefully
          throw new Error(
            `Invalid fallback option for OpenAI: ${embeddingFallback}`
          );
        }
        break;

      case "gemini":
        ProviderFactory.assertNetworkPolicy('gemini', offline);
        if (embeddingFallback === "none" || embeddingFallback === undefined) {
          // Use native Gemini embeddings
          if (!credential) {
            throw new Error("Google API key required for Gemini embeddings");
          }
          provider = new GeminiEmbeddingProvider(credential);
          dimensions = 768;
        } else {
          // Should not reach here due to earlier check, but handle gracefully
          throw new Error(
            `Invalid fallback option for Gemini: ${embeddingFallback}`
          );
        }
        break;

      case "claude":
        // Claude doesn't support embeddings - use configurable fallback
        // Note: 'ollama' and 'lmstudio' are already handled at the top
        // Here we only handle 'none' or undefined, both default to Ollama
        isFallback = true;
        fallbackProvider = "ollama"; // Default to Ollama for Claude
        provider = new ClaudeEmbeddingProvider(
          fallbackProvider,
          ProviderFactory.normalizeEndpoint(
            fallbackProvider,
            apiEndpoint,
            offline,
            allowRemoteSelfHosted
          ),
          offline,
          allowRemoteSelfHosted
        );
        dimensions = 768;
        fallbackReason = `Claude does not support embeddings natively. Using ${fallbackProvider} (local, free) for embeddings.`;
        break;

      case "ollama":
        // Ollama is already local, no fallback needed
        provider = new OllamaEmbeddingProvider(
          ProviderFactory.normalizeEndpoint('ollama', apiEndpoint, offline, allowRemoteSelfHosted),
          offline,
          allowRemoteSelfHosted
        );
        dimensions = 768;
        break;

      case "lmstudio":
        // LM Studio is already local, no fallback needed
        provider = new LMStudioEmbeddingProvider(
          ProviderFactory.normalizeEndpoint('lmstudio', apiEndpoint, offline, allowRemoteSelfHosted),
          offline,
          allowRemoteSelfHosted
        );
        dimensions = 768;
        break;

      case "openrouter":
        ProviderFactory.assertNetworkPolicy('openrouter', offline);
        if (embeddingFallback === "none" || embeddingFallback === undefined) {
          // Use OpenAI-compatible embeddings via OpenRouter
          if (!credential) {
            throw new Error("OpenRouter API key required for embeddings");
          }
          provider = new OpenAIEmbeddingProvider(
            credential,
            ProviderFactory.normalizeEndpoint('openrouter', apiEndpoint, offline)
          );
          dimensions = 1536;
        } else {
          // Should not reach here due to earlier check, but handle gracefully
          throw new Error(
            `Invalid fallback option for OpenRouter: ${embeddingFallback}`
          );
        }
        break;

      case "none":
      default:
        // Default to Ollama if no AI provider configured or unknown
        isFallback = true;
        fallbackReason = `No AI provider configured or unknown provider "${aiProvider}". Using Ollama (local, free) for embeddings.`;
        provider = new OllamaEmbeddingProvider(
          ProviderFactory.normalizeEndpoint('ollama', apiEndpoint, offline, allowRemoteSelfHosted),
          offline,
          allowRemoteSelfHosted
        );
        dimensions = 768;
        fallbackProvider = "ollama";
        break;
    }

    return {
      provider,
      isFallback,
      fallbackReason,
      dimensions,
      fallbackProvider,
    };
  }

  /**
   * Check if provider natively supports embeddings
   */
  static providerSupportsEmbeddings(aiProvider: AIProvider): boolean {
    return ["openai", "gemini", "ollama", "lmstudio", "openrouter"].includes(
      aiProvider
    );
  }

  /**
   * Get dimensions for a provider
   */
  static getProviderDimensions(
    aiProvider: AIProvider,
    embeddingFallback?: EmbeddingFallbackProvider
  ): number {
    // If using fallback, return fallback dimensions
    if (embeddingFallback === "ollama" || embeddingFallback === "lmstudio") {
      return 768;
    }

    switch (aiProvider) {
      case "openai":
      case "openrouter":
        return 1536;
      case "gemini":
      case "ollama":
      case "lmstudio":
      case "claude": // Claude uses fallback, which is 768
        return 768;
      default:
        return 768; // Default for 'none' or unknown
    }
  }

  /**
   * Get available fallback options
   */
  static getFallbackOptions(): ("ollama" | "lmstudio")[] {
    return ["ollama", "lmstudio"];
  }
}
