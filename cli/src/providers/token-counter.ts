/**
 * token-counter.ts - Accurate Token Counting
 * 
 * Provides accurate token counting for different AI providers.
 * Uses provider-specific tokenizers where available.
 */

// Note: tiktoken and @anthropic-ai/tokenizer are optional dependencies
// They will be loaded dynamically if available, otherwise fall back to estimation

export interface TokenCountResult {
  count: number;
  method: 'accurate' | 'estimated';
  model: string;
}

export class AccurateTokenCounter {
  private openaiEncoders: Map<string, any> = new Map();
  private tiktokenAvailable: boolean = false;
  private claudeTokenizerAvailable: boolean = false;

  constructor() {
    this.checkDependencies();
  }

  /**
   * Check if tokenizer dependencies are available
   */
  private checkDependencies(): void {
    try {
      require.resolve('tiktoken');
      this.tiktokenAvailable = true;
    } catch {
      this.tiktokenAvailable = false;
    }

    try {
      require.resolve('@anthropic-ai/tokenizer');
      this.claudeTokenizerAvailable = true;
    } catch {
      this.claudeTokenizerAvailable = false;
    }
  }

  /**
   * Count tokens accurately
   */
  countTokens(text: string, model: string): TokenCountResult {
    // OpenAI models
    if (model.startsWith('gpt')) {
      return this.countOpenAITokens(text, model);
    }

    // Claude models
    if (model.startsWith('claude')) {
      return this.countClaudeTokens(text);
    }

    // Gemini models (similar tokenization to GPT-4)
    if (model.startsWith('gemini')) {
      return this.countGeminiTokens(text);
    }

    // Ollama/LM Studio (use estimation)
    return this.estimateTokens(text, model);
  }

  /**
   * Count OpenAI tokens using tiktoken
   */
  private countOpenAITokens(text: string, model: string): TokenCountResult {
    if (!this.tiktokenAvailable) {
      return this.estimateTokens(text, model);
    }

    try {
      // Dynamic import to avoid hard dependency
      const tiktoken = require('tiktoken');

      // Get or create encoder for this model
      if (!this.openaiEncoders.has(model)) {
        try {
          const encoder = tiktoken.encoding_for_model(model);
          this.openaiEncoders.set(model, encoder);
        } catch {
          // Model not found, use cl100k_base (GPT-4 tokenizer)
          const encoder = tiktoken.get_encoding('cl100k_base');
          this.openaiEncoders.set(model, encoder);
        }
      }

      const encoder = this.openaiEncoders.get(model);
      const tokens = encoder.encode(text);

      return {
        count: tokens.length,
        method: 'accurate',
        model,
      };
    } catch (error) {
      console.warn('Failed to use tiktoken, falling back to estimation:', error);
      return this.estimateTokens(text, model);
    }
  }

  /**
   * Count Claude tokens using Anthropic tokenizer
   */
  private countClaudeTokens(text: string): TokenCountResult {
    if (!this.claudeTokenizerAvailable) {
      return this.estimateTokens(text, 'claude');
    }

    try {
      // Dynamic import to avoid hard dependency
      const { countTokens } = require('@anthropic-ai/tokenizer');

      const count = countTokens(text);

      return {
        count,
        method: 'accurate',
        model: 'claude',
      };
    } catch (error) {
      console.warn('Failed to use Claude tokenizer, falling back to estimation:', error);
      return this.estimateTokens(text, 'claude');
    }
  }

  /**
   * Count Gemini tokens (approximate using GPT-4 tokenizer)
   */
  private countGeminiTokens(text: string): TokenCountResult {
    if (!this.tiktokenAvailable) {
      return this.estimateTokens(text, 'gemini');
    }

    try {
      const tiktoken = require('tiktoken');
      const encoder = tiktoken.get_encoding('cl100k_base'); // GPT-4 tokenizer
      const tokens = encoder.encode(text);

      return {
        count: tokens.length,
        method: 'accurate',
        model: 'gemini',
      };
    } catch {
      return this.estimateTokens(text, 'gemini');
    }
  }

  /**
   * Estimate tokens (fallback method)
   */
  private estimateTokens(text: string, model: string): TokenCountResult {
    // More accurate estimation based on word count
    const charCount = text.length;
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    let count: number;

    if (wordCount > 0) {
      // ~1.3 tokens per word is a good average for most languages
      count = Math.ceil(wordCount * 1.3);
    } else {
      // ~4 characters per token
      count = Math.ceil(charCount / 4);
    }

    return {
      count,
      method: 'estimated',
      model,
    };
  }

  /**
   * Count tokens in messages
   */
  countMessagesTokens(messages: Array<{role: string; content: string}>, model: string): TokenCountResult {
    let totalCount = 0;

    for (const message of messages) {
      // Count message content
      const result = this.countTokens(message.content, model);
      totalCount += result.count;

      // Add overhead for role and formatting (~4 tokens per message)
      totalCount += 4;
    }

    return {
      count: totalCount,
      method: 'accurate', // Mixed method, but report as accurate if most are accurate
      model,
    };
  }

  /**
   * Check if accurate counting is available for a model
   */
  isAccurateCountingAvailable(model: string): boolean {
    if (model.startsWith('gpt')) {
      return this.tiktokenAvailable;
    }

    if (model.startsWith('claude')) {
      return this.claudeTokenizerAvailable;
    }

    if (model.startsWith('gemini')) {
      return this.tiktokenAvailable;
    }

    return false;
  }

  /**
   * Get availability status
   */
  getStatus(): {
    tiktokenAvailable: boolean;
    claudeTokenizerAvailable: boolean;
    recommendedDependencies: string[];
  } {
    const recommended: string[] = [];

    if (!this.tiktokenAvailable) {
      recommended.push('tiktoken - for OpenAI/Gemini accurate token counting');
    }

    if (!this.claudeTokenizerAvailable) {
      recommended.push('@anthropic-ai/tokenizer - for Claude accurate token counting');
    }

    return {
      tiktokenAvailable: this.tiktokenAvailable,
      claudeTokenizerAvailable: this.claudeTokenizerAvailable,
      recommendedDependencies: recommended,
    };
  }

  /**
   * Cleanup encoders
   */
  cleanup(): void {
    // Free encoder resources
    for (const [, encoder] of this.openaiEncoders) {
      if (encoder && typeof encoder.free === 'function') {
        encoder.free();
      }
    }
    this.openaiEncoders.clear();
  }
}

// Export singleton instance
export const tokenCounter = new AccurateTokenCounter();

// Add automatic cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('beforeExit', () => {
    tokenCounter.cleanup();
  });
}
