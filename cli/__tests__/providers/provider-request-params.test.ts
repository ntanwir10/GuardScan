/**
 * Request parameters sent for current-generation models (Claude 5, GPT-6).
 */

import { ClaudeProvider } from '../../src/providers/claude';
import { OpenAIProvider } from '../../src/providers/openai';
import { DEFAULT_MODELS } from '../../src/providers/model-registry';

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
    expect(mockAnthropicCreate.mock.calls[0][0]).toMatchObject({ max_tokens: 16000 });
    expect(result.content).toBe('hello world');
  });

  it('never sends temperature to older Claude models and keeps their 4000-token default', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage,
      model: 'claude-sonnet-4-5-20250929',
      stop_reason: 'end_turn',
    });

    await new ClaudeProvider('key', 'claude-sonnet-4-5-20250929').chat(
      [{ role: 'user', content: 'hi' }],
      { temperature: 0.2 }
    );

    expect(mockAnthropicCreate.mock.calls[0][0]).not.toHaveProperty('temperature');
    expect(mockAnthropicCreate.mock.calls[0][0]).toMatchObject({ max_tokens: 4000 });
  });

  it('turns saved dotted ids into Anthropic ids and defaults to the registry model', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage,
      model: 'm',
      stop_reason: 'end_turn',
    });

    await new ClaudeProvider('key', 'claude-sonnet-4.5').chat([{ role: 'user', content: 'hi' }]);
    await new ClaudeProvider('key').chat([{ role: 'user', content: 'hi' }]);

    expect(mockAnthropicCreate.mock.calls[0][0]).toMatchObject({ model: 'claude-sonnet-4-5' });
    expect(mockAnthropicCreate.mock.calls[1][0]).toMatchObject({ model: DEFAULT_MODELS.claude });
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

  it('sizes the connection probe for Claude 5 thinking only', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage,
      model: 'm',
      stop_reason: 'end_turn',
    });

    await expect(new ClaudeProvider('key', 'claude-haiku-5-5').testConnection()).resolves.toBe(true);
    await expect(new ClaudeProvider('key', 'claude-sonnet-4-5-20250929').testConnection()).resolves.toBe(true);

    expect(mockAnthropicCreate.mock.calls[0][0]).toMatchObject({ max_tokens: 1024 });
    expect(mockAnthropicCreate.mock.calls[1][0]).toMatchObject({ max_tokens: 10 });
  });
});

describe('OpenAIProvider request parameters', () => {
  const completion = { choices: [{ message: { content: 'ok' } }], model: 'm' };

  // gpt-5.1 was the 1.1.0 picker's recommended model, so saved configs still send it.
  it.each(['gpt-6-luna', 'gpt-5.1'])('sends max_completion_tokens and no temperature for %s', async (model) => {
    mockOpenAICreate.mockResolvedValue(completion);

    await new OpenAIProvider('key', model).chat([{ role: 'user', content: 'hi' }], { temperature: 0.2 });

    const request = mockOpenAICreate.mock.calls[0][0];
    expect(request).toMatchObject({ model, max_completion_tokens: 16000 });
    expect(request).not.toHaveProperty('temperature');
    expect(request).not.toHaveProperty('max_tokens');
  });

  it('keeps temperature and max_tokens for other models', async () => {
    mockOpenAICreate.mockResolvedValue(completion);

    await new OpenAIProvider('key', 'gpt-4o').chat([{ role: 'user', content: 'hi' }]);
    await new OpenAIProvider('key', 'gpt-4o').chat([{ role: 'user', content: 'hi' }], { temperature: 0 });

    const request = mockOpenAICreate.mock.calls[0][0];
    expect(request).toMatchObject({ temperature: 0.7, max_tokens: 4000 });
    expect(request).not.toHaveProperty('max_completion_tokens');
    expect(mockOpenAICreate.mock.calls[1][0]).toMatchObject({ temperature: 0 });
  });

  it('defaults to the registry model', async () => {
    mockOpenAICreate.mockResolvedValue(completion);

    await new OpenAIProvider('key').chat([{ role: 'user', content: 'hi' }]);

    expect(mockOpenAICreate.mock.calls[0][0]).toMatchObject({ model: DEFAULT_MODELS.openai });
  });

  it('applies the GPT-6 parameters when streaming', async () => {
    mockOpenAICreate.mockResolvedValue(chunks([{ choices: [{ delta: { content: 'a' } }] }]));

    const output: string[] = [];
    for await (const text of new OpenAIProvider('key', 'gpt-6.1-sol').stream([{ role: 'user', content: 'hi' }])) {
      output.push(text);
    }

    const request = mockOpenAICreate.mock.calls[0][0];
    expect(request).not.toHaveProperty('temperature');
    expect(request).toMatchObject({ max_completion_tokens: 16000 });
    expect(output).toEqual(['a']);
  });

  it('sizes the connection probe for GPT-6 reasoning only', async () => {
    mockOpenAICreate.mockResolvedValue(completion);

    await expect(new OpenAIProvider('key', 'gpt-6-luna').testConnection()).resolves.toBe(true);
    await expect(new OpenAIProvider('key', 'gpt-4o').testConnection()).resolves.toBe(true);

    expect(mockOpenAICreate.mock.calls[0][0]).toMatchObject({ max_completion_tokens: 1024 });
    expect(mockOpenAICreate.mock.calls[1][0]).toMatchObject({ max_tokens: 10 });
  });
});
