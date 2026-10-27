import axios, {AxiosInstance} from 'axios';
import { TelemetryClient, TelemetryRequest } from '../../src/utils/telemetry-client';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({post: jest.fn()})),
    isAxiosError: jest.fn(() => false),
  },
}));

describe('telemetry transport policy', () => {
  const originalTelemetryUrl = process.env.GUARDSCAN_TELEMETRY_URL;
  const originalLegacyApiUrl = process.env.GUARDSCAN_API_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GUARDSCAN_TELEMETRY_URL;
    delete process.env.GUARDSCAN_API_URL;
  });

  afterAll(() => {
    if (originalTelemetryUrl === undefined) delete process.env.GUARDSCAN_TELEMETRY_URL;
    else process.env.GUARDSCAN_TELEMETRY_URL = originalTelemetryUrl;
    if (originalLegacyApiUrl === undefined) delete process.env.GUARDSCAN_API_URL;
    else process.env.GUARDSCAN_API_URL = originalLegacyApiUrl;
  });

  it('disables HTTP redirects so telemetry cannot be forwarded to another origin', () => {
    new TelemetryClient('https://telemetry.example.test');

    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({maxRedirects: 0}));
  });

  it('does not create a transport from the removed GUARDSCAN_API_URL alias', () => {
    process.env.GUARDSCAN_API_URL = 'https://legacy.example.test';

    const client = new TelemetryClient('');

    expect(client.getBaseUrl()).toBe('');
    expect(axios.create).not.toHaveBeenCalled();
  });

  it('uses the caller-provided endpoint regardless of legacy process state', () => {
    process.env.GUARDSCAN_TELEMETRY_URL = 'https://telemetry.example.test';
    process.env.GUARDSCAN_API_URL = 'https://legacy.example.test';

    const client = new TelemetryClient('https://telemetry.example.test');

    expect(client.getBaseUrl()).toBe('https://telemetry.example.test');
    expect(axios.create).toHaveBeenCalledTimes(1);
    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://telemetry.example.test',
    }));
  });
});

describe('telemetry acknowledgement boundary', () => {
  const post = jest.fn();
  const request: TelemetryRequest = {
    schemaVersion: 'guardscan.telemetry.v1',
    batchId: 'test-batch',
    sentAt: 1,
    cliVersion: '1.1.0',
    events: ['first', 'second'].map(eventId => ({
      eventId,
      action: 'scan',
      loc: 1,
      durationMs: 1,
      executionMode: 'static',
      occurredAt: 1,
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

    await expect(new TelemetryClient('https://collector.example.test').sendTelemetry(request))
      .rejects.toThrow(message);
  });

  it.each([
    {status: 'accepted', accepted: 1, acceptedEventIds: ['first']},
    {status: 'duplicate', accepted: 2, acceptedEventIds: ['first', 'second']},
    {status: 'accepted', accepted: 2},
  ])('preserves valid subset, duplicate, and full-batch acknowledgement %j', async fields => {
    const response = {batchId: request.batchId, ...fields};
    post.mockResolvedValue({status: 200, data: response});

    await expect(new TelemetryClient('https://collector.example.test').sendTelemetry(request))
      .resolves.toEqual(response);
  });
});
