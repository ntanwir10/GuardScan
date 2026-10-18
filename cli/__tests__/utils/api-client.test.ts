import axios, {AxiosInstance} from 'axios';
import {APIClient, TelemetryRequest} from '../../src/utils/api-client';

jest.mock('axios');

describe('telemetry acknowledgement boundary', () => {
  const post = jest.fn();
  const request: TelemetryRequest = {
    schemaVersion: 'guardscan.telemetry.v1',
    batchId: 'test-batch',
    sentAt: 1,
    cliVersion: '1.1.0',
    events: ['first', 'second'].map(eventId => ({
      eventId, action: 'scan', loc: 1, durationMs: 1,
      executionMode: 'static', occurredAt: 1,
    })),
  };

  beforeEach(() => {
    post.mockReset();
    jest.mocked(axios.create).mockReturnValue({post} as unknown as AxiosInstance);
  });

  it.each([
    [{accepted: 1, acceptedEventIds: ['outside-batch']}, 'reference requested events'],
    [{accepted: 2, acceptedEventIds: ['first', 'first']}, 'must be unique'],
    [{accepted: 1}, 'partial telemetry acknowledgement'],
  ])('rejects invalid acknowledgement %j before sync can delete events', async (fields, message) => {
    post.mockResolvedValue({status: 200, data: {
      status: 'accepted', batchId: request.batchId, ...fields,
    }});

    await expect(new APIClient('https://collector.example.test').sendTelemetry(request))
      .rejects.toThrow(message);
  });

  it.each([
    {status: 'accepted', accepted: 1, acceptedEventIds: ['first']},
    {status: 'duplicate', accepted: 2, acceptedEventIds: ['first', 'second']},
    {status: 'accepted', accepted: 2},
  ])('preserves valid subset, duplicate, and full-batch acknowledgement %j', async fields => {
    const response = {batchId: request.batchId, ...fields};
    post.mockResolvedValue({status: 200, data: response});

    await expect(new APIClient('https://collector.example.test').sendTelemetry(request))
      .resolves.toEqual(response);
  });
});
