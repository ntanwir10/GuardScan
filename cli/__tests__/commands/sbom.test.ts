import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const scan = jest.fn<() => Promise<any>>();
const generateSBOM = jest.fn<() => any>();
const loadOrInit = jest.fn<() => any>();
const getRepoInfo = jest.fn<() => any>();

jest.mock('../../src/core/license-scanner', () => ({
  licenseScanner: { scan, generateSBOM },
}));
jest.mock('../../src/core/config', () => ({ configManager: { loadOrInit } }));
jest.mock('../../src/core/repository', () => ({ repositoryManager: { getRepoInfo } }));
jest.mock('../../src/utils/progress', () => ({
  createProgressBar: () => ({ update: jest.fn(), stop: jest.fn() }),
}));
jest.mock('../../src/utils/performance-tracker', () => ({
  createPerformanceTracker: () => ({ start: jest.fn(), end: jest.fn() }),
}));
jest.mock('../../src/utils/debug-logger', () => ({
  createDebugLogger: () => ({ debug: jest.fn() }),
}));
jest.mock('../../src/utils/error-handler', () => ({
  handleCommandError: (error: unknown) => { throw error; },
}));

import { sbomCommand } from '../../src/commands/sbom';

describe('sbom command', () => {
  let outputPath: string;
  const originalOffline = process.env.GUARDSCAN_OFFLINE;

  beforeEach(() => {
    outputPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-sbom-')), 'result.json');
    loadOrInit.mockReturnValue({ offlineMode: false });
    getRepoInfo.mockReturnValue({ name: 'fixture' });
    scan.mockResolvedValue({
      totalDependencies: 1,
      findings: [],
      categorySummary: { permissive: 1, 'weak-copyleft': 0, 'strong-copyleft': 0, unknown: 0 },
      riskSummary: { critical: 0, high: 0, medium: 0 },
      compatibilityIssues: [],
    });
    generateSBOM.mockReturnValue({
      $schema: 'https://cyclonedx.org/schema/bom-1.7.schema.json',
      bomFormat: 'CycloneDX',
      specVersion: '1.7',
      serialNumber: 'urn:uuid:test',
      version: 1,
      metadata: {
        timestamp: '2026-07-20T00:00:00.000Z',
        tools: { components: [{ type: 'application', name: 'GuardScan', version: '1.1.0' }] },
        component: { type: 'application', name: 'fixture', 'bom-ref': 'urn:test' },
      },
      components: [{
        type: 'library', 'bom-ref': 'pkg:npm/example@1.0.0', name: 'example', version: '1.0.0',
        purl: 'pkg:npm/example@1.0.0', scope: 'required', licenses: [],
      }],
      dependencies: [],
    });
  });

  afterEach(() => {
    if (originalOffline === undefined) delete process.env.GUARDSCAN_OFFLINE;
    else process.env.GUARDSCAN_OFFLINE = originalOffline;
    jest.clearAllMocks();
  });

  it('uses global offline policy and summarizes CycloneDX fields by their actual schema', async () => {
    process.env.GUARDSCAN_OFFLINE = '1';
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await sbomCommand({ format: 'cyclonedx', output: outputPath });

    expect(scan).toHaveBeenCalledWith(process.cwd(), 'proprietary', { offline: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Components: 1'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Format: CycloneDX (1.7)'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Timestamp: 2026-07-20T00:00:00.000Z'));
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8')).bomFormat).toBe('CycloneDX');
    log.mockRestore();
  });
});
