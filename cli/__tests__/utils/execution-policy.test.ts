import { resolveExecutionPolicy } from '../../src/utils/execution-policy';

describe('execution policy', () => {
  const originalOffline = process.env.GUARDSCAN_OFFLINE;

  afterEach(() => {
    if (originalOffline === undefined) delete process.env.GUARDSCAN_OFFLINE;
    else process.env.GUARDSCAN_OFFLINE = originalOffline;
  });

  it('makes offline mode override project-code execution', () => {
    process.env.GUARDSCAN_OFFLINE = '1';

    expect(resolveExecutionPolicy({ runProjectCode: true, cve: true, allowPartial: true })).toEqual({
      offline: true,
      runProjectCode: false,
      isolateProjectNetwork: false,
      includeCve: true,
      allowPartial: true,
    });
  });

  it('only enables project-code execution and partial coverage when explicitly requested', () => {
    delete process.env.GUARDSCAN_OFFLINE;

    expect(resolveExecutionPolicy({
      runProjectCode: true,
      isolateProjectNetwork: true,
      allowPartial: true,
    })).toEqual({
      offline: false,
      runProjectCode: true,
      isolateProjectNetwork: true,
      includeCve: false,
      allowPartial: false,
    });
  });
});
