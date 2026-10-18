import axios from 'axios';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { OllamaProvider } from '../../src/providers/ollama';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

async function* streamChunks(chunks: string[]): AsyncGenerator<Buffer> {
  for (const chunk of chunks) {
    yield Buffer.from(chunk);
  }
}

describe('OllamaProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('stream', () => {
    it('should buffer JSON lines split across response chunks', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: streamChunks([
          '{"message":{"content":"hel',
          'lo"}}\n{"message":{"content":"!"}}\n{"message":{"content":"tail"}}',
        ]),
      });
      const provider = new OllamaProvider('http://localhost:11434');
      const chunks: string[] = [];

      for await (const chunk of provider.stream([{ role: 'user', content: 'test' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['hello', '!', 'tail']);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.objectContaining({ stream: true }),
        { responseType: 'stream', maxRedirects: 0 }
      );
    });
  });
});
