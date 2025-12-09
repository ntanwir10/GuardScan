import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  AIProvider,
  AIMessage,
  AIResponse,
  ChatOptions,
  ProviderCapabilities,
  CostEstimate,
} from "./base";

export class GeminiProvider extends AIProvider {
  private client: GoogleGenerativeAI;
  private defaultModel = "gemini-2.5-flash";

  constructor(apiKey?: string, model?: string) {
    super(apiKey);
    const key = apiKey || process.env.GOOGLE_API_KEY;
    if (!key) {
      throw new Error("Google API key is required");
    }
    this.client = new GoogleGenerativeAI(key);
    if (model) {
      this.defaultModel = model;
    }
  }

  async chat(
    messages: AIMessage[],
    options?: ChatOptions
  ): Promise<AIResponse> {
    const model = this.client.getGenerativeModel({
      model: options?.model || this.defaultModel,
    });

    // Convert messages to Gemini format
    const history = messages.slice(0, -1).map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const lastMessage = messages[messages.length - 1];

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response;

    // Extract usage information from Gemini API response
    // The usage metadata is available on the result object
    const usageInfo = (result as any).usageMetadata || (response as any).usageMetadata;
    const usage = usageInfo ? {
      promptTokens: usageInfo.promptTokenCount || 0,
      completionTokens: usageInfo.candidatesTokenCount || 0,
      totalTokens: usageInfo.totalTokenCount || 0,
    } : undefined;

    // Get the actual model name used (from options or default)
    const modelUsed = options?.model || this.defaultModel;

    return {
      content: response.text(),
      usage,
      model: modelUsed, // Return actual model name used
    };
  }

  isAvailable(): boolean {
    return !!(this.apiKey || process.env.GOOGLE_API_KEY);
  }

  getName(): string {
    return "Gemini";
  }

  async testConnection(): Promise<boolean> {
    console.error(`[Gemini] Starting connection test with model: ${this.defaultModel}...`);
    
    try {
      console.error(`[Gemini] Trying model: ${this.defaultModel}...`);
      const model = this.client.getGenerativeModel({ model: this.defaultModel });
      const result = await model.generateContent("test");
      if (result.response) {
        console.error(`[Gemini] Connection successful with ${this.defaultModel}`);
        return true;
      }
      throw new Error('No response from Gemini API.');
    } catch (error: any) {
      // Log the full error for debugging (always log, not just in debug mode)
      console.error('[Gemini Connection Error] Full error object:', {
        error,
        message: error?.message,
        code: error?.code,
        status: error?.status,
        statusCode: error?.statusCode,
        errorMessage: error?.error?.message,
        errorCode: error?.error?.code,
        stack: error?.stack,
        stringified: JSON.stringify(error, null, 2)
      });
      
      // Extract error information from various possible structures
      const errorMessage =
        error?.message || error?.error?.message || String(error) || "";
      const errorCode =
        error?.code ||
        error?.status ||
        error?.statusCode ||
        error?.error?.code ||
        "";
      const errorString = JSON.stringify(error);

      // Check for specific error types and throw with clear messages
      if (
        errorMessage?.includes("API_KEY") ||
        errorMessage?.includes("API key") ||
        errorMessage?.includes("API key not valid") ||
        errorMessage?.includes("API_KEY_INVALID") ||
        errorCode === 400 || // Google returns 400 for invalid API key
        errorCode === 401 ||
        errorString?.includes("API_KEY") ||
        errorString?.includes("API_KEY_INVALID") ||
        errorMessage?.includes("401") ||
        errorMessage?.includes("UNAUTHENTICATED")
      ) {
        throw new Error(
          "Invalid Google API key. Please check your API key in guardscan config."
        );
      }
      if (
        errorMessage?.includes("quota") ||
        errorMessage?.includes("QUOTA") ||
        errorCode === 429 ||
        errorString?.includes("quota") ||
        errorMessage?.includes("RESOURCE_EXHAUSTED")
      ) {
        throw new Error(
          "API quota exceeded. Please check your Google Cloud billing."
        );
      }
      if (
        errorMessage?.includes("PERMISSION") ||
        errorMessage?.includes("permission") ||
        errorCode === 403 ||
        errorString?.includes("permission") ||
        errorMessage?.includes("PERMISSION_DENIED")
      ) {
        throw new Error("API key doesn't have required permissions.");
      }
      if (
        errorMessage?.includes("not found") ||
        errorMessage?.includes("404") ||
        errorCode === 404 ||
        errorMessage?.includes("NOT_FOUND")
      ) {
        throw new Error(`Model not found. Error: ${errorMessage}`);
      }
      // For other errors, throw with the actual error message so user can see it
      const displayMessage = errorMessage || errorString || "Unknown error";
      throw new Error(`Connection failed: ${displayMessage}`);
    }
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsChat: true,
      supportsEmbeddings: true, // Gemini embeddings now implemented
      embeddingDimensions: 768,
      supportsStreaming: true,
      maxContextTokens: 32000, // Gemini Pro context window
    };
  }

  /**
   * Estimate chat API cost
   */
  estimateChatCost(messages: AIMessage[], options?: ChatOptions): CostEstimate {
    const model = options?.model || this.defaultModel;
    const pricing = this.getModelPricing(model);

    const promptTokens = this.countMessagesTokens(messages);
    const completionTokens = options?.maxTokens || 1000; // Estimate

    const promptCost = (promptTokens / 1000000) * pricing.input;
    const completionCost = (completionTokens / 1000000) * pricing.output;

    return {
      promptCost,
      completionCost,
      totalCost: promptCost + completionCost,
      currency: "USD",
    };
  }

  /**
   * Get pricing for current default model
   */
  getPricing() {
    return {
      chat: {
        input: 0.075, // $0.075 per 1M tokens for Gemini 2.5 Flash input
        output: 0.3, // $0.30 per 1M tokens for Gemini 2.5 Flash output
      },
    };
  }

  /**
   * Get pricing for specific model
   */
  private getModelPricing(model: string): { input: number; output: number } {
    const pricing: Record<string, { input: number; output: number }> = {
      "gemini-3-pro": { input: 1.25, output: 5.0 }, // Most capable (estimated)
      "gemini-2.5-pro": { input: 1.25, output: 5.0 }, // Complex reasoning, 1M context
      "gemini-2.5-flash": { input: 0.075, output: 0.3 }, // Balanced, 1M context
      "gemini-2.5-flash-lite": { input: 0.0375, output: 0.15 }, // Fast and cost-efficient
    };

    return pricing[model] || pricing["gemini-2.5-flash"];
  }
}
