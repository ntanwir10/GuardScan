/**
 * token-counter.test.ts - Unit tests for AccurateTokenCounter
 */

import { describe, expect, it } from '@jest/globals';
import { AccurateTokenCounter } from '../../src/providers/token-counter';

describe('AccurateTokenCounter', () => {
  describe('token counting', () => {
    it('should count tokens with estimation fallback', () => {
      const counter = new AccurateTokenCounter();
      
      const result = counter.countTokens('Hello, world!', 'gpt-4o');
      
      expect(result.count).toBeGreaterThan(0);
      expect(result.model).toBe('gpt-4o');
      // Method depends on tiktoken availability
      expect(['accurate', 'estimated']).toContain(result.method);
    });

    it('should handle empty text', () => {
      const counter = new AccurateTokenCounter();
      
      const result = counter.countTokens('', 'gpt-4o');
      
      expect(result.count).toBe(0);
    });

    it('should count tokens for different model types', () => {
      const counter = new AccurateTokenCounter();
      const text = 'This is a test message for token counting';
      
      const gptResult = counter.countTokens(text, 'gpt-4o');
      const claudeResult = counter.countTokens(text, 'claude-sonnet-4.5');
      const geminiResult = counter.countTokens(text, 'gemini-2.5-flash');
      
      // All should return positive counts
      expect(gptResult.count).toBeGreaterThan(0);
      expect(claudeResult.count).toBeGreaterThan(0);
      expect(geminiResult.count).toBeGreaterThan(0);
    });

    it('should count tokens in messages', () => {
      const counter = new AccurateTokenCounter();
      
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];
      
      const result = counter.countMessagesTokens(messages, 'gpt-4o');
      
      // Should include content tokens + overhead per message
      expect(result.count).toBeGreaterThan(messages.length * 4); // At least 4 tokens overhead per message
    });
  });

  describe('accuracy detection', () => {
    it('should report availability status', () => {
      const counter = new AccurateTokenCounter();
      const status = counter.getStatus();
      
      expect(status).toHaveProperty('tiktokenAvailable');
      expect(status).toHaveProperty('claudeTokenizerAvailable');
      expect(status).toHaveProperty('recommendedDependencies');
      
      expect(typeof status.tiktokenAvailable).toBe('boolean');
      expect(typeof status.claudeTokenizerAvailable).toBe('boolean');
      expect(Array.isArray(status.recommendedDependencies)).toBe(true);
    });

    it('should check if accurate counting is available for model', () => {
      const counter = new AccurateTokenCounter();
      
      // These checks depend on whether optional dependencies are installed
      const gptAvailable = counter.isAccurateCountingAvailable('gpt-4o');
      const claudeAvailable = counter.isAccurateCountingAvailable('claude-sonnet-4.5');
      
      expect(typeof gptAvailable).toBe('boolean');
      expect(typeof claudeAvailable).toBe('boolean');
    });
  });

  describe('estimation fallback', () => {
    it('should estimate tokens when accurate counting unavailable', () => {
      const counter = new AccurateTokenCounter();
      
      // Force estimation by using unknown model
      const result = counter.countTokens('Hello world', 'unknown-model');
      
      expect(result.count).toBeGreaterThan(0);
      expect(result.method).toBe('estimated');
    });

    it('should provide reasonable estimates', () => {
      const counter = new AccurateTokenCounter();
      
      // Test with known text
      const shortText = 'Hello';
      const longText = 'This is a much longer piece of text with many more words';
      
      const shortResult = counter.countTokens(shortText, 'unknown-model');
      const longResult = counter.countTokens(longText, 'unknown-model');
      
      // Long text should have more tokens
      expect(longResult.count).toBeGreaterThan(shortResult.count);
    });
  });
});
