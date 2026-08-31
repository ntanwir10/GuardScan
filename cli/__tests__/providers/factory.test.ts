import { ProviderFactory } from "../../src/providers/factory";
import { OpenAIProvider } from "../../src/providers/openai";
import { ClaudeProvider } from "../../src/providers/claude";
import { GeminiProvider } from "../../src/providers/gemini";
import { OllamaProvider } from "../../src/providers/ollama";
import { Config } from "../../src/core/config";
import { EmbeddingProviderFactory } from "../../src/providers/embedding-factory";
import { LMStudioEmbeddingProvider } from "../../src/providers/embedding-lmstudio";
import { ClaudeEmbeddingProvider } from "../../src/providers/embedding-claude";
import { OpenAIEmbeddingProvider } from "../../src/providers/embedding-openai";
import { validateOfflineLocalEndpoint } from "../../src/commands/init";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const CREDENTIAL_ENV_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

const originalCredentials = Object.fromEntries(
  CREDENTIAL_ENV_VARS.map((name) => [name, process.env[name]])
);
const originalOffline = process.env.GUARDSCAN_OFFLINE;
const originalOllamaEndpoint = process.env.OLLAMA_ENDPOINT;

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    clientId: "test-client",
    provider: "none",
    telemetryEnabled: false,
    offlineMode: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsed: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.GUARDSCAN_OFFLINE;
  delete process.env.OLLAMA_ENDPOINT;
});

afterEach(() => {
  for (const name of CREDENTIAL_ENV_VARS) {
    const original = originalCredentials[name];
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }
  if (originalOffline === undefined) {
    delete process.env.GUARDSCAN_OFFLINE;
  } else {
    process.env.GUARDSCAN_OFFLINE = originalOffline;
  }
  if (originalOllamaEndpoint === undefined) delete process.env.OLLAMA_ENDPOINT;
  else process.env.OLLAMA_ENDPOINT = originalOllamaEndpoint;
});

describe("ProviderFactory", () => {
  describe("create", () => {
    it("should create OpenAI provider", () => {
      const provider = ProviderFactory.create("openai", "test-key");
      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.getName()).toBe("OpenAI");
    });

    it("should create Claude provider", () => {
      const provider = ProviderFactory.create("claude", "test-key");
      expect(provider).toBeInstanceOf(ClaudeProvider);
      expect(provider.getName()).toBe("Claude");
    });

    it("should create Gemini provider", () => {
      const provider = ProviderFactory.create("gemini", "test-key");
      expect(provider).toBeInstanceOf(GeminiProvider);
      expect(provider.getName()).toBe("Gemini");
    });

    it("should create Ollama provider", () => {
      const provider = ProviderFactory.create(
        "ollama",
        undefined,
        "http://127.0.0.1:11434"
      );
      expect(provider).toBeInstanceOf(OllamaProvider);
      expect(provider.getName()).toBe("Ollama");
    });

    it("should create LM Studio provider (OpenAI-compatible)", () => {
      const provider = ProviderFactory.create(
        "lmstudio",
        undefined,
        "http://127.0.0.1:1234"
      );
      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.getName()).toBe("LM Studio");
      expect(provider.getCapabilities().supportsEmbeddings).toBe(false);
      expect(provider.getPricing().chat).toEqual({ input: 0, output: 0 });
    });

    it("should create OpenRouter provider (OpenAI-compatible)", () => {
      const provider = ProviderFactory.create("openrouter", "test-key");
      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.getName()).toBe("OpenRouter");
      expect(provider.getCapabilities().supportsEmbeddings).toBe(false);
      expect(provider.getPricing().chat).toEqual({ input: 0, output: 0 });
    });

    it("should throw error for unknown provider", () => {
      expect(() => {
        ProviderFactory.create("unknown" as any, "test-key");
      }).toThrow("Unknown provider: unknown");
    });
  });

  describe("getAvailableProviders", () => {
    it("should return all available providers", () => {
      const providers = ProviderFactory.getAvailableProviders();

      expect(providers).toContain("openai");
      expect(providers).toContain("claude");
      expect(providers).toContain("gemini");
      expect(providers).toContain("ollama");
      expect(providers).toContain("lmstudio");
      expect(providers).toContain("openrouter");
      expect(providers).toHaveLength(6);
    });
  });

  describe("configuration and credentials", () => {
    it.each([
      ["ollama", "http://127.0.0.1:11434"],
      ["lmstudio", "http://127.0.0.1:1234"],
    ] as Array<["ollama" | "lmstudio", string]>)("creates keyless local provider %s", (provider, endpoint) => {
      const created = ProviderFactory.createForCli(
        makeConfig({ provider, apiEndpoint: endpoint }),
        { raw: true }
      );

      expect(created.isAvailable()).toBe(true);
    });

    it.each([
      ["openai", "OPENAI_API_KEY"],
      ["claude", "ANTHROPIC_API_KEY"],
      ["gemini", "GEMINI_API_KEY"],
      ["openrouter", "OPENROUTER_API_KEY"],
    ] as Array<[
      "openai" | "claude" | "gemini" | "openrouter",
      (typeof CREDENTIAL_ENV_VARS)[number]
    ]>)("uses an environment-only credential for %s", (provider, envName) => {
      delete process.env.GOOGLE_API_KEY;
      process.env[envName] = "environment-test-key";

      const created = ProviderFactory.createForCli(
        makeConfig({ provider }),
        { raw: true }
      );

      expect(created.isAvailable()).toBe(true);
      expect(ProviderFactory.isConfigured(makeConfig({ provider }))).toBe(true);
    });

    it("prefers a persisted credential over the environment", () => {
      process.env.OPENAI_API_KEY = "environment-key";

      expect(
        ProviderFactory.resolveCredential(
          makeConfig({ provider: "openai", apiKey: "persisted-key" })
        )
      ).toBe("persisted-key");
    });

    it("reports a typed missing-credential error", () => {
      delete process.env.OPENAI_API_KEY;

      expect(() =>
        ProviderFactory.createForCli(makeConfig({ provider: "openai" }), {
          raw: true,
        })
      ).toThrow(
        expect.objectContaining({
          code: "MISSING_CREDENTIAL",
        })
      );
    });
  });

  describe("offline policy", () => {
    it.each(["openai", "claude", "gemini", "openrouter"] as const)(
      "blocks cloud provider %s before construction",
      (provider) => {
        expect(() =>
          ProviderFactory.createForCli(
            makeConfig({ provider, apiKey: "test-key", offlineMode: true }),
            { raw: true }
          )
        ).toThrow(
          expect.objectContaining({
            code: "OFFLINE_PROVIDER_BLOCKED",
          })
        );
      }
    );

    it.each(["ollama", "lmstudio"] as const)(
      "allows local provider type %s offline",
      (provider) => {
        expect(() =>
          ProviderFactory.createForCli(
            makeConfig({ provider, offlineMode: true }),
            { raw: true }
          )
        ).not.toThrow();
      }
    );

    it("honors the early GUARDSCAN_OFFLINE policy for connection tests", () => {
      process.env.GUARDSCAN_OFFLINE = "true";

      expect(() =>
        ProviderFactory.createForCli(
          makeConfig({ provider: "openai", apiKey: "test-key" }),
          { raw: true }
        )
      ).toThrow(expect.objectContaining({ code: "OFFLINE_PROVIDER_BLOCKED" }));
      expect(() => ProviderFactory.create("openai", "test-key")).toThrow(
        expect.objectContaining({ code: "OFFLINE_PROVIDER_BLOCKED" })
      );
    });

    it("honors offline mode when callers use the enhanced factory directly", () => {
      expect(() =>
        ProviderFactory.createEnhanced("openai", {
          apiKey: "test-key",
          config: makeConfig({
            provider: "openai",
            apiKey: "test-key",
            offlineMode: true,
          }),
        })
      ).toThrow(expect.objectContaining({ code: "OFFLINE_PROVIDER_BLOCKED" }));
    });

    it("blocks cloud embeddings offline", () => {
      expect(() =>
        EmbeddingProviderFactory.create(
          "openai",
          "test-key",
          undefined,
          undefined,
          true
        )
      ).toThrow(
        expect.objectContaining({
          code: "OFFLINE_PROVIDER_BLOCKED",
        })
      );
    });

    it("allows LM Studio embeddings offline", () => {
      const result = EmbeddingProviderFactory.create(
        "lmstudio",
        undefined,
        "http://127.0.0.1:1234",
        undefined,
        true
      );

      expect(result.provider).toBeInstanceOf(LMStudioEmbeddingProvider);
    });

    it("allows Claude's local embedding fallback offline", () => {
      const result = EmbeddingProviderFactory.create(
        "claude",
        undefined,
        undefined,
        undefined,
        true
      );

      expect(result.provider).toBeInstanceOf(ClaudeEmbeddingProvider);
      expect(result.fallbackProvider).toBe("ollama");
    });
  });

  describe("CLI embedding selection", () => {
    it("uses the override provider's environment credential", () => {
      process.env.OPENAI_API_KEY = "openai-environment-key";

      const result = EmbeddingProviderFactory.createForCli(
        makeConfig({
          provider: "claude",
          apiKey: "anthropic-persisted-key",
        }),
        { provider: "openai" }
      );

      expect(result.provider).toBeInstanceOf(OpenAIEmbeddingProvider);
      expect(result.provider.isAvailable()).toBe(true);
      expect(result.isFallback).toBe(false);
    });

    it("does not reuse another provider's persisted credential for an override", () => {
      delete process.env.OPENAI_API_KEY;

      expect(() =>
        EmbeddingProviderFactory.createForCli(
          makeConfig({
            provider: "claude",
            apiKey: "anthropic-persisted-key",
          }),
          { provider: "openai" }
        )
      ).toThrow("OpenAI API key required for OpenAI embeddings");
    });

    it("applies offline policy to an explicitly selected cloud embedding provider", () => {
      process.env.OPENAI_API_KEY = "openai-environment-key";

      expect(() =>
        EmbeddingProviderFactory.createForCli(
          makeConfig({ provider: "ollama", offlineMode: true }),
          { provider: "openai" }
        )
      ).toThrow(expect.objectContaining({ code: "OFFLINE_PROVIDER_BLOCKED" }));
    });
  });

  describe("endpoint policy", () => {
    it("returns prompt guidance for a malformed offline local endpoint", () => {
      expect(validateOfflineLocalEndpoint("ollama", "localhost:11434")).toMatch(
        /absolute HTTP or HTTPS URL/i
      );
    });

    it('returns TLS guidance for a cleartext remote local-provider endpoint', () => {
      expect(validateOfflineLocalEndpoint(
        'ollama',
        'http://models.example.test'
      )).toMatch(/remote.*HTTPS/i);
    });

    it.each([
      [undefined, "http://127.0.0.1:1234/v1"],
      ["http://127.0.0.1:1234", "http://127.0.0.1:1234/v1"],
      ["http://127.0.0.1:1234/", "http://127.0.0.1:1234/v1"],
      ["http://127.0.0.1:1234/v1", "http://127.0.0.1:1234/v1"],
      ["http://127.0.0.1:1234/v1/", "http://127.0.0.1:1234/v1"],
    ])("normalizes LM Studio endpoint %s", (endpoint, expected) => {
      expect(ProviderFactory.normalizeEndpoint("lmstudio", endpoint)).toBe(expected);
    });

    it.each([
      "localhost:1234",
      "ftp://localhost:1234",
      "http://user:pass@localhost:1234",
      "http://localhost:1234?token=value",
      "http://localhost:1234#fragment",
    ])("rejects unsafe endpoint %s", (endpoint) => {
      expect(() => ProviderFactory.normalizeEndpoint("lmstudio", endpoint)).toThrow(
        expect.objectContaining({
          code: "INVALID_ENDPOINT",
        })
      );
    });

    it("rejects a non-loopback local-provider endpoint in offline mode", () => {
      process.env.OLLAMA_ENDPOINT = "http://192.168.1.25:11434";

      expect(() => ProviderFactory.createForCli(
        makeConfig({ provider: "ollama", offlineMode: true }),
        { raw: true }
      )).toThrow(expect.objectContaining({ code: "INVALID_ENDPOINT" }));

      expect(() => ProviderFactory.normalizeEndpoint(
        "lmstudio",
        "https://models.example.test",
        true
      )).toThrow(expect.objectContaining({ code: "INVALID_ENDPOINT" }));
    });

    it("does not warn for a loopback local-provider endpoint", () => {
      const warnings: string[] = [];

      ProviderFactory.createForCli(
        makeConfig({
          provider: "ollama",
          offlineMode: true,
          apiEndpoint: "http://127.0.0.2:11434/",
        }),
        { raw: true, onWarning: (message) => warnings.push(message) }
      );

      expect(warnings).toEqual([]);
    });

    it.each(["127.0.0.2", "[::1]"])("accepts literal loopback host %s offline", (host) => {
      expect(() => ProviderFactory.normalizeEndpoint(
        "ollama",
        `http://${host}:11434`,
        true
      )).not.toThrow();
    });

    it('rejects hostname-based loopback claims offline', () => {
      expect(() => ProviderFactory.normalizeEndpoint(
        'ollama',
        'http://localhost:11434',
        true
      )).toThrow(expect.objectContaining({code: 'INVALID_ENDPOINT'}));
    });

    it('requires the named override for a remote self-hosted provider', () => {
      expect(() => ProviderFactory.normalizeEndpoint(
        'lmstudio',
        'https://models.example.test/base'
      )).toThrow(expect.objectContaining({code: 'REMOTE_SELF_HOSTED_NOT_APPROVED'}));
      expect(ProviderFactory.normalizeEndpoint(
        'lmstudio',
        'https://models.example.test/base',
        false,
        true
      )).toBe('https://models.example.test/base/v1');
    });

    it.each(['ollama', 'lmstudio'] as const)(
      'rejects cleartext remote %s endpoints even when remote use is approved',
      provider => {
        expect(() => ProviderFactory.normalizeEndpoint(
          provider,
          'http://models.example.test/base',
          false,
          true
        )).toThrow(expect.objectContaining({
          code: 'INVALID_ENDPOINT',
          message: expect.stringMatching(/remote.*HTTPS/i),
        }));
      }
    );

    it.each(['ollama', 'lmstudio', 'claude'] as const)(
      'enforces remote TLS through %s embedding construction',
      provider => {
        expect(() => EmbeddingProviderFactory.create(
          provider,
          undefined,
          'http://models.example.test/base',
          undefined,
          false,
          true
        )).toThrow(expect.objectContaining({ code: 'INVALID_ENDPOINT' }));
      }
    );

    it.each(["ollama", "lmstudio"] as const)(
      "preserves remote endpoint approval for %s embeddings",
      (provider) => {
        expect(() => EmbeddingProviderFactory.create(
          provider,
          undefined,
          "https://models.example.test/base",
          undefined,
          false,
          true
        )).not.toThrow();
      }
    );

    it("preserves remote endpoint approval through Claude's local fallback", () => {
      expect(() => EmbeddingProviderFactory.create(
        "claude",
        undefined,
        "https://models.example.test/base",
        undefined,
        false,
        true
      )).not.toThrow();
    });

    it("does not treat an invalid 127/8 hostname as loopback", () => {
      expect(() => ProviderFactory.normalizeEndpoint(
        "ollama",
        "http://127.999.999.999:11434",
        true
      )).toThrow(expect.objectContaining({ code: "INVALID_ENDPOINT" }));
    });
  });
});
