import axios from 'axios';
import { APIClient } from '../../src/utils/api-client';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({post: jest.fn()})),
    isAxiosError: jest.fn(() => false),
  },
}));

describe('telemetry API transport policy', () => {
  it('disables HTTP redirects so telemetry cannot be forwarded to another origin', () => {
    new APIClient('https://telemetry.example.test');

    expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({maxRedirects: 0}));
  });
});
