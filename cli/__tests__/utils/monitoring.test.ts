import axios from 'axios';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MonitoringManager } from '../../src/utils/monitoring';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MonitoringManager', () => {
  const originalGuardscanHome = process.env.GUARDSCAN_HOME;
  let tempHome: string;

  beforeEach(() => {
    jest.clearAllMocks();
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-monitoring-'));
    process.env.GUARDSCAN_HOME = tempHome;
  });

  afterEach(() => {
    if (originalGuardscanHome === undefined) {
      delete process.env.GUARDSCAN_HOME;
    } else {
      process.env.GUARDSCAN_HOME = originalGuardscanHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('skips usage tracking when the local config has not been initialized', async () => {
    const manager = new MonitoringManager({
      enabled: true,
      endpoint: 'https://monitoring.example',
      errorReportingEnabled: true,
      performanceMonitoringEnabled: true,
      usageAnalyticsEnabled: true,
      sampleRate: 1.0,
    });

    await expect(
      manager.trackUsage('security', 250, true, { source: 'test' })
    ).resolves.toBeUndefined();
    await manager.flush();
    await manager.shutdown();

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
