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
  it('records both safe reduced-capability paths when optional modules are unavailable', async () => {
    const counter = tokenCounter(false, 'estimated');
    const missingChart = Object.assign(
      new Error("Cannot find module 'chartjs-node-canvas'"),
      {code: 'MODULE_NOT_FOUND'}
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
