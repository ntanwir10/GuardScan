/**
 * Monitoring API contract tests.
 *
 * These tests pin the request paths and payload envelopes emitted by the CLI
 * clients that talk to the separate GuardScan-Monitoring service.
 */

import axios from 'axios';
import { APIClient, TelemetryRequest } from '../../src/utils/api-client';
import {
  ErrorSeverity,
  MonitoringManager,
} from '../../src/utils/monitoring';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Monitoring API contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Telemetry client', () => {
    it('posts telemetry batches to /api/telemetry', async () => {
      const post = jest.fn().mockResolvedValue({ status: 202 });
      mockedAxios.create.mockReturnValue({
        post,
        get: jest.fn(),
      } as any);

      const client = new APIClient('https://monitoring.example');
      const payload: TelemetryRequest = {
        clientId: 'test-client-123',
        repoId: 'test-repo-456',
        events: [
          {
            action: 'scan',
            loc: 1000,
            durationMs: 5000,
            model: 'sast',
            timestamp: 1700000000000,
            metadata: { source: 'contract-test' },
          },
        ],
        cliVersion: '1.0.0',
      };

      await client.sendTelemetry(payload);

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://monitoring.example',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      expect(post).toHaveBeenCalledWith('/api/telemetry', payload);
    });

    it('checks API health with GET /health', async () => {
      const get = jest.fn().mockResolvedValue({ status: 200 });
      mockedAxios.create.mockReturnValue({
        post: jest.fn(),
        get,
      } as any);

      const client = new APIClient('https://monitoring.example');
      await expect(client.ping()).resolves.toBe(true);

      expect(get).toHaveBeenCalledWith('/health', { timeout: 3000 });
    });
  });

  describe('Monitoring manager', () => {
    function createManager(): MonitoringManager {
      return new MonitoringManager({
        enabled: true,
        endpoint: 'https://monitoring.example',
        errorReportingEnabled: true,
        performanceMonitoringEnabled: true,
        usageAnalyticsEnabled: true,
        sampleRate: 1.0,
      });
    }

    it('posts monitoring events to /api/monitoring', async () => {
      mockedAxios.post.mockResolvedValue({ status: 202 });
      const manager = createManager();

      await manager.trackError(new Error('boom'), ErrorSeverity.HIGH, {
        command: 'security',
      });
      await manager.trackMetric('command.duration', 1234, 'ms', {
        command: 'security',
      });
      await manager.flush();
      await manager.shutdown();

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://monitoring.example/api/monitoring',
        expect.objectContaining({
          errors: [
            expect.objectContaining({
              severity: ErrorSeverity.HIGH,
              message: 'boom',
              context: { command: 'security' },
            }),
          ],
          metrics: [
            expect.objectContaining({
              name: 'command.duration',
              value: 1234,
              unit: 'ms',
              tags: { command: 'security' },
            }),
          ],
          usage: [],
          timestamp: expect.any(String),
        }),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ',
          },
          timeout: 5000,
        })
      );
    });

    it('checks monitoring health with GET /api/health', async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });
      const manager = createManager();

      const result = await manager.healthCheck();
      await manager.shutdown();

      expect(result.status).toBe('healthy');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://monitoring.example/api/health',
        { timeout: 5000 }
      );
    });
  });
});
