import axios from 'axios';
import { TelemetryClient } from '../../src/utils/telemetry-client';

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
