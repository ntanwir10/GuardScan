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

  it.each(['true', 'false'])('does not treat config --offline %s as a process-wide boolean flag', value => {
    const original = process.env.GUARDSCAN_OFFLINE;
    delete process.env.GUARDSCAN_OFFLINE;
    try {
      applyEarlyEnvironmentFlags(['config', '--offline', value]);
      expect(process.env.GUARDSCAN_OFFLINE).toBeUndefined();
    } finally {
      if (original === undefined) {delete process.env.GUARDSCAN_OFFLINE;}
      else {process.env.GUARDSCAN_OFFLINE = original;}
    }
  });

  it('keeps an explicit global offline flag before config authoritative', () => {
    const original = process.env.GUARDSCAN_OFFLINE;
    delete process.env.GUARDSCAN_OFFLINE;
    try {
      applyEarlyEnvironmentFlags(['--offline', 'config', '--offline', 'false']);
      expect(process.env.GUARDSCAN_OFFLINE).toBe('true');
    } finally {
      if (original === undefined) {delete process.env.GUARDSCAN_OFFLINE;}
      else {process.env.GUARDSCAN_OFFLINE = original;}
    }
  });

  it('does not treat config option values or operands after -- as debug flags', () => {
    delete process.env.GUARDSCAN_DEBUG;
    applyEarlyEnvironmentFlags(['config', '--key', '--debug']);
    expect(process.env.GUARDSCAN_DEBUG).toBeUndefined();
    applyEarlyEnvironmentFlags(['security', '--', '--debug']);
    expect(process.env.GUARDSCAN_DEBUG).toBeUndefined();
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

  it('allows explicit local quality execution offline only with network isolation', () => {
    const originalOffline = process.env.GUARDSCAN_OFFLINE;
    process.env.GUARDSCAN_OFFLINE = 'true';
    try {
      expect(resolveExecutionPolicy({
        runProjectCode: true,
        allowProjectCodeOffline: true,
      })).toMatchObject({
        offline: true,
        runProjectCode: true,
        isolateProjectNetwork: true,
      });
    } finally {
      if (originalOffline === undefined) {delete process.env.GUARDSCAN_OFFLINE;}
      else {process.env.GUARDSCAN_OFFLINE = originalOffline;}
    }
  });
});
