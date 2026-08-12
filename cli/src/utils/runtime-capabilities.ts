import { AccurateTokenCounter, TokenCountResult } from '../providers/token-counter';

export const RUNTIME_CAPABILITY_SCHEMA = 'guardscan.runtime-capabilities.v1';
const TOKEN_PROBE_TEXT = 'GuardScan standalone optional capability probe';
const TOKEN_PROBE_MODEL = 'gpt-4o';

interface TokenCounterProbe {
  countTokens(text: string, model: string): TokenCountResult;
  getStatus(): {tiktokenAvailable: boolean};
  cleanup(): void;
}

export interface RuntimeCapabilityProbeOptions {
  createTokenCounter?: () => TokenCounterProbe;
  loadChartRenderer?: () => Promise<unknown>;
}

export interface RuntimeCapabilityEvidence {
  schemaVersion: typeof RUNTIME_CAPABILITY_SCHEMA;
  tokenCounting: {
    dependency: 'tiktoken';
    dependencyAvailable: boolean;
    mode: TokenCountResult['method'];
    sampleTokenCount: number;
    safeFallbackObserved: boolean;
  };
  chartRendering: {
    dependency: 'chartjs-node-canvas';
    dependencyAvailable: boolean;
    mode: 'native' | 'unavailable';
    safeFallbackObserved: boolean;
  };
}

function isMissingChartDependency(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ERR_UNKNOWN_BUILTIN_MODULE') {
    return /^No such built-in module: (?:node:)?chartjs-node-canvas$/.test(error.message);
  }
  return (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND')
    && error.message.includes('chartjs-node-canvas');
}

/**
 * Exercise optional runtime boundaries and report what this exact executable can do.
 * Unexpected initialization failures are not relabeled as a supported reduced mode.
 */
export async function collectRuntimeCapabilities(
  options: RuntimeCapabilityProbeOptions = {}
): Promise<RuntimeCapabilityEvidence> {
  const counter = options.createTokenCounter?.() ?? new AccurateTokenCounter();
  let tokenResult: TokenCountResult;
  let tiktokenAvailable: boolean;
  try {
    tokenResult = counter.countTokens(TOKEN_PROBE_TEXT, TOKEN_PROBE_MODEL);
    tiktokenAvailable = counter.getStatus().tiktokenAvailable;
  } finally {
    counter.cleanup();
  }

  let chartRendering: RuntimeCapabilityEvidence['chartRendering'];
  try {
    const loadChartRenderer = options.loadChartRenderer
      ?? (() => import('./chart-generator'));
    await loadChartRenderer();
    chartRendering = {
      dependency: 'chartjs-node-canvas',
      dependencyAvailable: true,
      mode: 'native',
      safeFallbackObserved: false,
    };
  } catch (error) {
    if (!isMissingChartDependency(error)) {
      throw error;
    }
    chartRendering = {
      dependency: 'chartjs-node-canvas',
      dependencyAvailable: false,
      mode: 'unavailable',
      safeFallbackObserved: true,
    };
  }

  return {
    schemaVersion: RUNTIME_CAPABILITY_SCHEMA,
    tokenCounting: {
      dependency: 'tiktoken',
      dependencyAvailable: tiktokenAvailable,
      mode: tokenResult.method,
      sampleTokenCount: tokenResult.count,
      safeFallbackObserved: tokenResult.method === 'estimated',
    },
    chartRendering,
  };
}
