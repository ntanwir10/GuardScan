import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Config } from '../../src/core/config';
import { createTelemetryManager, createTelemetryRecorder, TelemetryManager } from '../../src/core/telemetry';

describe('TelemetryManager consent erasure', () => {
  let root: string;
  let stateDir: string;
  let legacyCacheDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-telemetry-'));
    stateDir = path.join(root, 'state');
    legacyCacheDir = path.join(root, 'cache');
    fs.mkdirSync(legacyCacheDir, { recursive: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('deletes migrated telemetry backups when queued data is cleared', () => {
    const legacyFile = path.join(legacyCacheDir, 'telemetry.json');
    fs.writeFileSync(legacyFile, JSON.stringify({
      events: [{
        eventId: 'legacy-event',
        action: 'scan',
        loc: 10,
        durationMs: 20,
        model: 'sast',
        timestamp: Date.now(),
      }],
    }));
    const config: Config = {
      provider: 'none',
      telemetryEnabled: false,
      offlineMode: true,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    };
    const manager = new TelemetryManager(config, stateDir, legacyCacheDir);
    const migratedFile = `${legacyFile}.migrated`;
    expect(fs.existsSync(migratedFile)).toBe(true);
    fs.writeFileSync(path.join(stateDir, 'telemetry', 'events', 'malformed.json'), '{');
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(manager.clear()).toBe(1);

    expect(fs.existsSync(migratedFile)).toBe(false);
    expect(fs.readdirSync(path.join(stateDir, 'telemetry', 'quarantine'))).toEqual([]);
    expect(manager.getStats().pending).toBe(0);
  });

  it('does not let suppressed telemetry spool failures abort a command', async () => {
    fs.mkdirSync(stateDir, {recursive: true});
    fs.writeFileSync(path.join(stateDir, 'telemetry'), 'not a directory');
    const config: Config = {
      provider: 'none',
      telemetryEnabled: false,
      offlineMode: true,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    };

    const manager = new TelemetryManager(config, stateDir, legacyCacheDir);

    await expect(manager.record({action: 'scan', loc: 1, durationMs: 1})).resolves.toBeUndefined();
  });

  it('keeps recording initialization best-effort while management remains strict', async () => {
    fs.mkdirSync(stateDir, {recursive: true});
    fs.writeFileSync(path.join(stateDir, 'telemetry'), 'not a directory');
    const config: Config = {
      provider: 'none',
      telemetryEnabled: true,
      offlineMode: false,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    };
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => createTelemetryManager(config, stateDir, legacyCacheDir)).toThrow();
    const recorder = createTelemetryRecorder(config, stateDir, legacyCacheDir);

    await expect(recorder.record({action: 'scan', loc: 1, durationMs: 1})).resolves.toBeUndefined();
  });
});
