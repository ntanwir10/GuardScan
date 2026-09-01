import {
  applyEarlyEnvironmentFlags,
  resolveExecutionPolicy,
} from '../../src/utils/execution-policy';

describe('early CLI environment policy', () => {
  const originalDebug = process.env.GUARDSCAN_DEBUG;

  afterEach(() => {
    if (originalDebug === undefined) {delete process.env.GUARDSCAN_DEBUG;}
    else {process.env.GUARDSCAN_DEBUG = originalDebug;}
  });

  it('applies the security debug flag before command modules load', () => {
    delete process.env.GUARDSCAN_DEBUG;

    applyEarlyEnvironmentFlags(['security', '--debug']);

    expect(process.env.GUARDSCAN_DEBUG).toBe('true');
  });

  it('disables project-code execution for an offline test command', () => {
    const originalOffline = process.env.GUARDSCAN_OFFLINE;
    process.env.GUARDSCAN_OFFLINE = 'true';
    try {
      expect(resolveExecutionPolicy({ runProjectCode: true })).toMatchObject({
        offline: true,
        runProjectCode: false,
      });
    } finally {
      if (originalOffline === undefined) {delete process.env.GUARDSCAN_OFFLINE;}
      else {process.env.GUARDSCAN_OFFLINE = originalOffline;}
    }
  });
});
