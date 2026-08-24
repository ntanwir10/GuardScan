import {
  collectRuntimeCapabilities,
  RUNTIME_CAPABILITY_SCHEMA,
} from '../../src/utils/runtime-capabilities';

function tokenCounter(available: boolean, mode: 'accurate' | 'estimated') {
  return {
    countTokens: jest.fn().mockReturnValue({count: 7, method: mode, model: 'gpt-4o'}),
    getStatus: jest.fn().mockReturnValue({
      tiktokenAvailable: available,
      claudeTokenizerAvailable: false,
      recommendedDependencies: [],
    }),
    cleanup: jest.fn(),
  };
}

describe('runtime capability evidence', () => {
  it.each([
    ['MODULE_NOT_FOUND', "Cannot find module 'chartjs-node-canvas'"],
    ['ERR_MODULE_NOT_FOUND', "Cannot find package 'chartjs-node-canvas'"],
    ['ERR_UNKNOWN_BUILTIN_MODULE', 'No such built-in module: chartjs-node-canvas'],
    ['ERR_UNKNOWN_BUILTIN_MODULE', 'No such built-in module: node:chartjs-node-canvas'],
  ])(
    'records the safe reduced-capability path when the chart module fails with %s',
    async (code, message) => {
      const counter = tokenCounter(false, 'estimated');
      const missingChart = Object.assign(
        new Error(message),
        {code}
      );

      const evidence = await collectRuntimeCapabilities({
        createTokenCounter: () => counter,
        loadChartRenderer: async () => { throw missingChart; },
      });

      expect(evidence).toEqual({
        schemaVersion: RUNTIME_CAPABILITY_SCHEMA,
        tokenCounting: {
          dependency: 'tiktoken',
          dependencyAvailable: false,
          mode: 'estimated',
          sampleTokenCount: 7,
          safeFallbackObserved: true,
        },
        chartRendering: {
          dependency: 'chartjs-node-canvas',
          dependencyAvailable: false,
          mode: 'unavailable',
          safeFallbackObserved: true,
        },
      });
      expect(counter.cleanup).toHaveBeenCalledTimes(1);
    }
  );

  it('fails closed for a similarly named unknown builtin module', async () => {
    const unexpectedBuiltin = Object.assign(
      new Error('No such built-in module: chartjs-node-canvas-helper'),
      {code: 'ERR_UNKNOWN_BUILTIN_MODULE'}
    );

    await expect(collectRuntimeCapabilities({
      createTokenCounter: () => tokenCounter(false, 'estimated'),
      loadChartRenderer: async () => { throw unexpectedBuiltin; },
    })).rejects.toBe(unexpectedBuiltin);
  });

  it('preserves native optional capabilities when the modules are installed', async () => {
    const counter = tokenCounter(true, 'accurate');

    const evidence = await collectRuntimeCapabilities({
      createTokenCounter: () => counter,
      loadChartRenderer: async () => ({chartGenerator: {}}),
    });

    expect(evidence.tokenCounting).toMatchObject({
      dependencyAvailable: true,
      mode: 'accurate',
      safeFallbackObserved: false,
    });
    expect(evidence.chartRendering).toEqual({
      dependency: 'chartjs-node-canvas',
      dependencyAvailable: true,
      mode: 'native',
      safeFallbackObserved: false,
    });
  });

  it('fails closed when chart loading fails for an unexpected reason', async () => {
    await expect(collectRuntimeCapabilities({
      createTokenCounter: () => tokenCounter(false, 'estimated'),
      loadChartRenderer: async () => { throw new Error('chart initialization corrupted'); },
    })).rejects.toThrow('chart initialization corrupted');
  });
});
