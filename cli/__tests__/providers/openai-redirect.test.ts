import OpenAI from 'openai';
import { OpenAIProvider } from '../../src/providers/openai';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
}));

describe('OpenAI-compatible transport redirect policy', () => {
  it('forces fetch redirects to error for local and cloud compatible endpoints', async () => {
    new OpenAIProvider('key', 'model', 'http://127.0.0.1:1234/v1', 'LM Studio');
    const options = (OpenAI as unknown as jest.Mock).mock.calls[0][0];
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({} as Response);

    await options.fetch('http://127.0.0.1:1234/v1/chat', {method: 'POST'});

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/v1/chat',
      expect.objectContaining({method: 'POST', redirect: 'error'})
    );
    fetchMock.mockRestore();
  });
});
