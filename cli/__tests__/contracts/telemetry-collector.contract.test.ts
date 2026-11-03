/**
 * Telemetry collector contract tests.
 *
 * These tests pin the request paths and payload envelopes emitted by the CLI
 * telemetry client.
 */

import axios from 'axios';
import { TelemetryClient, TelemetryRequest } from '../../src/utils/telemetry-client';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Telemetry collector contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Telemetry client', () => {
    it('posts telemetry batches to /api/telemetry', async () => {
      const post = jest.fn().mockResolvedValue({ status: 202 });
      mockedAxios.create.mockReturnValue({
        post,
      } as any);

      const client = new TelemetryClient('https://telemetry.example');
      const payload: TelemetryRequest = {
        schemaVersion: 'guardscan.telemetry.v1',
        batchId: '00000000-0000-4000-8000-000000000001',
        sentAt: 1700000001000,
        events: [
          {
            eventId: '00000000-0000-4000-8000-000000000002',
            action: 'scan',
            loc: 1000,
            durationMs: 5000,
            executionMode: 'static',
            occurredAt: 1700000000000,
          },
        ],
        cliVersion: '1.0.0',
      };

      post.mockResolvedValue({
        status: 202,
        data: {
          status: 'accepted',
          batchId: payload.batchId,
          accepted: 1,
        },
      });

      await client.sendTelemetry(payload);

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://telemetry.example',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      expect(post).toHaveBeenCalledWith('/api/telemetry', payload);
    });
  });
});
