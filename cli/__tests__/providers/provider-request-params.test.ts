/**
 * Request parameters sent for current-generation models (Claude 5, GPT-6).
 */

import { ClaudeProvider } from '../../src/providers/claude';
import { OpenAIProvider } from '../../src/providers/openai';

const mockAnthropicCreate = jest.fn();
const mockOpenAICreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn(() => ({ messages: { create: mockAnthropicCreate } })),
}));

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(() => ({ chat: { completions: { create: mockOpenAICreate } } })),
}));

const usage = { input_tokens: 1, output_tokens: 2 };

async function* chunks(items: unknown[]) {
  yield* items;
}

beforeEach(() => {
  mockAnthropicCreate.mockReset();
  mockOpenAICreate.mockReset();
});

describe('ClaudeProvider request parameters', () => {
  it('omits temperature for Claude 5 models and skips leading thinking blocks', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' },
      ],
      usage,
      model: 'claude-sonnet-5-5',
      stop_reason: 'end_turn',
    });

    const result = await new ClaudeProvider('key', 'claude-sonnet-5-5').chat(
      [{ role: 'user', content: 'hi' }],
      { temperature: 0.2 }
    );

    expect(mockAnthropicCreate.mock.calls[0][0]).not.toHaveProperty('temperature');
    expect(result.content).toBe('hello world');
  });

  it('keeps the default temperature for older Claude models', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage,
      model: 'claude-sonnet-4-5-20250929',
      stop_reason: 'end_turn',
    });

    await new ClaudeProvider('key', 'claude-sonnet-4-5-20250929').chat([{ role: 'user', content: 'hi' }]);

    expect(mockAnthropicCreate.mock.calls[0][0]).toMatchObject({ temperature: 0.7 });
  });

  it('reports the stop reason when a response has no text block', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
      usage,
      model: 'claude-haiku-5-5',
      stop_reason: 'max_tokens',
    });

    await expect(
      new ClaudeProvider('key', 'claude-haiku-5-5').chat([{ role: 'user', content: 'hi' }])
    ).rejects.toThrow('stop_reason: max_tokens');
  });

  it('omits temperature when streaming from Claude 5 models and yields only text', async () => {
    mockAnthropicCreate.mockResolvedValue(chunks([
      { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'streamed' } },
    ]));

    const output: string[] = [];
    for await (const text of new ClaudeProvider('key', 'claude-opus-5-5').stream([{ role: 'user', content: 'hi' }])) {
      output.push(text);
    }

    expect(mockAnthropicCreate.mock.calls[0][0]).not.toHaveProperty('temperature');
    expect(output).toEqual(['streamed']);
  });
});

describe('OpenAIProvider request parameters', () => {
  const completion = { choices: [{ message: { content: 'ok' } }], model: 'm' };

  it('sends max_completion_tokens and no temperature for GPT-6 models', async () => {
    mockOpenAICreate.mockResolvedValue(completion);

    await new OpenAIProvider('key', 'gpt-6-luna').chat([{ role: 'user', content: 'hi' }], { temperature: 0.2 });

    const request = mockOpenAICreate.mock.calls[0][0];
    expect(request).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 4000 });
    expect(request).not.toHaveProperty('temperature');
    expect(request).not.toHaveProperty('max_tokens');
  });

  it('keeps temperature and max_tokens for other models', async () => {
    mockOpenAICreate.mockResolvedValue(completion);

    await new OpenAIProvider('key', 'gpt-4o').chat([{ role: 'user', content: 'hi' }]);

    const request = mockOpenAICreate.mock.calls[0][0];
    expect(request).toMatchObject({ temperature: 0.7, max_tokens: 4000 });
    expect(request).not.toHaveProperty('max_completion_tokens');
  });

  it('applies the GPT-6 parameters when streaming', async () => {
    mockOpenAICreate.mockResolvedValue(chunks([{ choices: [{ delta: { content: 'a' } }] }]));

    const output: string[] = [];
    for await (const text of new OpenAIProvider('key', 'gpt-6.1-sol').stream([{ role: 'user', content: 'hi' }])) {
      output.push(text);
    }

    const request = mockOpenAICreate.mock.calls[0][0];
    expect(request).not.toHaveProperty('temperature');
    expect(request).toMatchObject({ max_completion_tokens: 4000 });
    expect(output).toEqual(['a']);
  });
});
