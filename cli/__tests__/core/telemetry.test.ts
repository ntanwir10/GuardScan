import axios from 'axios';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { TelemetryManager } from '../../src/core/telemetry';
import { Config } from '../../src/core/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const EVENT_KEYS = [
  'eventId', 'action', 'loc', 'durationMs', 'executionMode', 'occurredAt',
].sort();

function config(overrides: Partial<Config> = {}): Config {
  return {
    clientId: 'unused',
    provider: 'none',
    telemetryEnabled: true,
    offlineMode: false,
    createdAt: new Date(0).toISOString(),
    lastUsed: new Date(0).toISOString(),
    ...overrides,
  };
}

describe('TelemetryManager', () => {
  let stateDir: string;
  let legacyCacheDir: string;
  const oldUrl = process.env.GUARDSCAN_TELEMETRY_URL;
  const oldOffline = process.env.GUARDSCAN_OFFLINE;
  const oldNoTelemetry = process.env.GUARDSCAN_NO_TELEMETRY;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.isAxiosError.mockReturnValue(false);
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardscan-telemetry-'));
    legacyCacheDir = path.join(stateDir, 'cache');
    process.env.GUARDSCAN_TELEMETRY_URL = 'https://telemetry.example';
    delete process.env.GUARDSCAN_NO_TELEMETRY;
    delete process.env.GUARDSCAN_OFFLINE;
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    if (oldUrl === undefined) delete process.env.GUARDSCAN_TELEMETRY_URL;
    else process.env.GUARDSCAN_TELEMETRY_URL = oldUrl;
    if (oldOffline === undefined) delete process.env.GUARDSCAN_OFFLINE;
    else process.env.GUARDSCAN_OFFLINE = oldOffline;
    if (oldNoTelemetry === undefined) delete process.env.GUARDSCAN_NO_TELEMETRY;
    else process.env.GUARDSCAN_NO_TELEMETRY = oldNoTelemetry;
  });

  it('records nothing while disabled or offline', async () => {
    await new TelemetryManager(config({ telemetryEnabled: false }), stateDir).record({
      action: 'scan', loc: 10, durationMs: 20, model: 'sast',
    });
    await new TelemetryManager(config({ offlineMode: true }), stateDir).record({
      action: 'scan', loc: 10, durationMs: 20, model: 'sast',
    });
    expect(new TelemetryManager(config(), stateDir).getStats().pending).toBe(0);
  });

  it('persists only the strict allowlisted event shape', async () => {
    const manager = new TelemetryManager(config(), stateDir);
    await manager.record({ action: 'security', loc: 10, durationMs: 20, model: 'sast' });
    const eventDir = path.join(stateDir, 'telemetry', 'events');
    const files = fs.readdirSync(eventDir).filter(name => name.endsWith('.json'));
    const event = JSON.parse(fs.readFileSync(path.join(eventDir, files[0]), 'utf8'));
    expect(event).toEqual(expect.objectContaining({
      action: 'security', loc: 10, durationMs: 20, executionMode: 'static',
    }));
    expect(event).not.toHaveProperty('model');
    expect(event).not.toHaveProperty('metadata');
  });

  it('honors command-level offline and no-telemetry suppression', async () => {
    process.env.GUARDSCAN_OFFLINE = 'true';
    let manager = new TelemetryManager(config(), stateDir);
    await manager.record({ action: 'scan', loc: 1, durationMs: 2 });
    expect(manager.getStats()).toEqual(expect.objectContaining({ pending: 0, suppressed: true }));
    await expect(manager.sync()).rejects.toThrow('offline mode');

    delete process.env.GUARDSCAN_OFFLINE;
    process.env.GUARDSCAN_NO_TELEMETRY = 'true';
    manager = new TelemetryManager(config(), stateDir);
    await manager.record({ action: 'scan', loc: 1, durationMs: 2 });
    expect(manager.getStats()).toEqual(expect.objectContaining({ pending: 0, suppressed: true }));
    await expect(manager.sync()).rejects.toThrow('disabled for this command');
  });

  it('does not lose events recorded by concurrent managers', async () => {
    const managers = Array.from({ length: 25 }, () => new TelemetryManager(config(), stateDir));
    await Promise.all(managers.map((manager, index) => manager.record({
      action: 'scan', loc: index, durationMs: index,
    })));
    expect(new TelemetryManager(config(), stateDir).getStats().pending).toBe(25);
  });

  it('does not lose events recorded by concurrent Node processes', async () => {
    const telemetryModule = path.resolve(__dirname, '../../dist/core/telemetry.js');
    const script = [
      "const { TelemetryManager } = require(process.argv[1]);",
      "const stateDir = process.argv[2];",
      "const index = Number(process.argv[3]);",
      "const config = { provider: 'none', telemetryEnabled: true, offlineMode: false, createdAt: '', lastUsed: '' };",
      "new TelemetryManager(config, stateDir, stateDir).record({ action: 'scan', loc: index, durationMs: index })",
      ".then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });",
    ].join('');
    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      runChild(script, [telemetryModule, stateDir, String(index)])));
    expect(new TelemetryManager(config(), stateDir).getStats().pending).toBe(12);
  });

  it('migrates the cache batch and current outbox without duplicates', () => {
    fs.mkdirSync(legacyCacheDir, { recursive: true });
    const legacyEvent = {
      action: 'scan', loc: 4, durationMs: 5,
      model: 'sast', timestamp: Date.now(),
    };
    fs.writeFileSync(path.join(legacyCacheDir, 'telemetry.json'), JSON.stringify({ events: [legacyEvent] }));
    fs.writeFileSync(path.join(stateDir, 'telemetry.json'), JSON.stringify({ events: [legacyEvent] }));
    const telemetryDir = path.join(stateDir, 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.writeFileSync(path.join(telemetryDir, 'outbox.json'), JSON.stringify({
      schemaVersion: 'guardscan.telemetry.outbox.v1',
      events: [{
        eventId: 'outbox-event', action: 'test', loc: 1, durationMs: 2,
        executionMode: 'static', occurredAt: Date.now(),
      }],
    }));

    let manager = new TelemetryManager(config(), stateDir, legacyCacheDir);
    expect(manager.getStats().pending).toBe(2);
    manager = new TelemetryManager(config(), stateDir, legacyCacheDir);
    expect(manager.getStats().pending).toBe(2);
    expect(fs.existsSync(path.join(legacyCacheDir, 'telemetry.json.migrated'))).toBe(true);
    expect(fs.existsSync(path.join(stateDir, 'telemetry.json.migrated'))).toBe(true);
    expect(fs.existsSync(path.join(telemetryDir, 'outbox.json.migrated'))).toBe(true);
  });

  it('does not publish any telemetry events when migration metadata is invalid', () => {
    const telemetryDir = path.join(stateDir, 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.writeFileSync(path.join(telemetryDir, 'outbox.json'), JSON.stringify({
      schemaVersion: 'guardscan.telemetry.outbox.v1',
      lastSyncAt: 'not-a-timestamp',
      events: [
        { eventId: 'invalid-metadata-event', action: 'scan', loc: 1, durationMs: 2,
          executionMode: 'static', occurredAt: Date.now() },
      ],
    }));

    new TelemetryManager(config(), stateDir, legacyCacheDir);

    expect(fs.readdirSync(path.join(telemetryDir, 'events'))).toEqual([]);
    expect(fs.existsSync(path.join(telemetryDir, 'outbox.json.migrated'))).toBe(false);
    expect(findFileNames(telemetryDir)).toContainEqual(expect.stringMatching(/^outbox\.json\.corrupt-/));
  });

  it('does not publish any new telemetry events on an identity conflict', () => {
    const telemetryDir = path.join(stateDir, 'telemetry');
    const eventsDir = path.join(telemetryDir, 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    writePersistedEvent(eventsDir, 'conflict-event', { loc: 99 });
    fs.writeFileSync(path.join(telemetryDir, 'outbox.json'), JSON.stringify({
      schemaVersion: 'guardscan.telemetry.outbox.v1',
      events: [
        { eventId: 'new-event', action: 'scan', loc: 1, durationMs: 2,
          executionMode: 'static', occurredAt: Date.now() },
        { eventId: 'conflict-event', action: 'scan', loc: 2, durationMs: 2,
          executionMode: 'static', occurredAt: Date.now() },
      ],
    }));

    new TelemetryManager(config(), stateDir, legacyCacheDir);

    expect(fs.readdirSync(eventsDir)).toEqual(['conflict-event.json']);
    expect(fs.existsSync(path.join(telemetryDir, 'outbox.json.migrated'))).toBe(false);
    expect(findFileNames(telemetryDir)).toContainEqual(expect.stringMatching(/^outbox\.json\.corrupt-/));
  });

  it('rolls back a journaled partial migration before quarantining a failed source', () => {
    const telemetryDir = path.join(stateDir, 'telemetry');
    const eventsDir = path.join(telemetryDir, 'events');
    const source = path.join(telemetryDir, 'outbox.json');
    const event = {
      eventId: 'journal-event', action: 'scan', loc: 1, durationMs: 2,
      executionMode: 'static', occurredAt: Date.now(),
    };
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(source, JSON.stringify({schemaVersion: 'guardscan.telemetry.outbox.v1', events: 'invalid'}));
    fs.writeFileSync(path.join(eventsDir, `${event.eventId}.json`), JSON.stringify(event));
    fs.writeFileSync(path.join(telemetryDir, 'migration.journal.json'), JSON.stringify({
      schemaVersion: 'guardscan.telemetry.migration.v1',
      source,
      migrated: `${source}.migrated`,
      phase: 'committing',
      createdFiles: [{file: path.join(eventsDir, `${event.eventId}.json`), event}],
      metadataChanged: false,
    }));

    new TelemetryManager(config(), stateDir, legacyCacheDir);

    expect(fs.existsSync(path.join(eventsDir, `${event.eventId}.json`))).toBe(false);
    expect(fs.existsSync(path.join(telemetryDir, 'migration.journal.json'))).toBe(false);
    expect(findFileNames(telemetryDir)).toContainEqual(expect.stringMatching(/^outbox\.json\.corrupt-/));
  });

  it('rejects migration when the existing telemetry metadata is invalid', () => {
    const telemetryDir = path.join(stateDir, 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.writeFileSync(path.join(telemetryDir, 'metadata.json'), JSON.stringify({schemaVersion: 'wrong'}));
    fs.writeFileSync(path.join(telemetryDir, 'outbox.json'), JSON.stringify({
      schemaVersion: 'guardscan.telemetry.outbox.v1',
      events: [{eventId: 'metadata-event', action: 'scan', loc: 1, durationMs: 2,
        executionMode: 'static', occurredAt: Date.now()}],
    }));

    new TelemetryManager(config(), stateDir, legacyCacheDir);

    expect(fs.readdirSync(path.join(telemetryDir, 'events'))).toEqual([]);
    expect(fs.existsSync(path.join(telemetryDir, 'outbox.json.migrated'))).toBe(false);
    expect(findFileNames(telemetryDir)).toContainEqual(expect.stringMatching(/^outbox\.json\.corrupt-/));
  });

  it('retains and reports all valid events before applying the bounded retention limit', () => {
    const eventsDir = path.join(stateDir, 'telemetry', 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    const now = Date.now();
    for (let index = 0; index < 2105; index++) {
      writePersistedEvent(eventsDir, `event-${index}`, { occurredAt: now - 2105 + index });
    }

    const manager = new TelemetryManager(config(), stateDir, legacyCacheDir);

    expect(manager.getStats().pending).toBe(1000);
    expect(fs.readdirSync(eventsDir).filter(name => name.endsWith('.json'))).toHaveLength(1000);
  });

  it('clears every event file, including files beyond the maintenance window', () => {
    const eventsDir = path.join(stateDir, 'telemetry', 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    for (let index = 0; index < 2105; index++) {
      writePersistedEvent(eventsDir, `clear-event-${index}`);
    }
    const manager = new TelemetryManager(config(), stateDir, legacyCacheDir);

    manager.clear();

    expect(fs.readdirSync(eventsDir).filter(name => name.endsWith('.json'))).toEqual([]);
  });

  it.each(['../../../escaped', '..\\..\\escaped', '/absolute', 'a/b']) (
    'normalizes unsafe migrated event ID %s without escaping the spool',
    (eventId) => {
      const telemetryDir = path.join(stateDir, 'telemetry');
      fs.mkdirSync(telemetryDir, { recursive: true });
      fs.writeFileSync(path.join(telemetryDir, 'outbox.json'), JSON.stringify({
        schemaVersion: 'guardscan.telemetry.outbox.v1',
        events: [{
          eventId, action: 'test', loc: 1, durationMs: 2,
          executionMode: 'static', occurredAt: Date.now(),
        }],
      }));

      const manager = new TelemetryManager(config(), stateDir, legacyCacheDir);
      expect(manager.getStats().pending).toBe(1);
      expect(fs.existsSync(path.join(stateDir, 'escaped.json'))).toBe(false);
      const names = fs.readdirSync(path.join(telemetryDir, 'events'));
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    }
  );

  it('quarantines oversized event files before parsing them', () => {
    const eventsDir = path.join(stateDir, 'telemetry', 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(path.join(eventsDir, 'oversized.json'), 'x'.repeat(64 * 1024 + 1));
    const manager = new TelemetryManager(config(), stateDir);
    expect(manager.getStats().pending).toBe(0);
    expect(findFileNames(path.join(stateDir, 'telemetry')).some(name => name.startsWith('oversized.json.corrupt-')))
      .toBe(true);
  });

  it.each([
    ['negative timestamp', -1, 1, 2],
    ['unsafe timestamp', Number.MAX_SAFE_INTEGER + 1, 1, 2],
    ['timestamp beyond the Date range', 1e20, 1, 2],
    ['timestamp too far in the future', Date.now() + 10 * 60 * 1000, 1, 2],
    ['negative loc', Date.now(), -1, 2],
    ['loc above the supported maximum', Date.now(), 1_000_000_001, 2],
    ['negative duration', Date.now(), 1, -1],
    ['duration above the supported maximum', Date.now(), 1, 86_400_001],
  ])('quarantines a persisted event with %s', (_case, occurredAt, loc, durationMs) => {
    const eventsDir = path.join(stateDir, 'telemetry', 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    writePersistedEvent(eventsDir, 'invalid-event', { occurredAt, loc, durationMs });

    const manager = new TelemetryManager(config(), stateDir);

    expect(manager.getStats().pending).toBe(0);
    expect(findFileNames(path.join(stateDir, 'telemetry')))
      .toContainEqual(expect.stringMatching(/^invalid-event\.json\.corrupt-/));
  });

  it('quarantines unknown persisted telemetry keys before an event can be sent', async () => {
    const eventsDir = path.join(stateDir, 'telemetry', 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    writePersistedEvent(eventsDir, 'extra-key-event', {
      secret: 'must-not-leave-the-machine',
      metadata: { repository: '/private/workspace' },
    });
    const post = jest.fn().mockImplementation((_url, request) => Promise.resolve({
      status: 202,
      data: { status: 'accepted', batchId: request.batchId, accepted: request.events.length },
    }));
    mockedAxios.create.mockReturnValue({ post, get: jest.fn() } as any);

    await new TelemetryManager(config(), stateDir).sync();

    expect(post).not.toHaveBeenCalled();
    expect(findFileNames(path.join(stateDir, 'telemetry')))
      .toContainEqual(expect.stringMatching(/^extra-key-event\.json\.corrupt-/));
  });

  it('quarantines oversized metadata, outbox, and legacy migration files', () => {
    const telemetryDir = path.join(stateDir, 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.mkdirSync(legacyCacheDir, { recursive: true });
    fs.writeFileSync(path.join(telemetryDir, 'metadata.json'), JSON.stringify({
      schemaVersion: 'guardscan.telemetry.spool.v1',
      padding: 'x'.repeat(64 * 1024),
    }));
    fs.writeFileSync(path.join(telemetryDir, 'outbox.json'), JSON.stringify({
      schemaVersion: 'guardscan.telemetry.outbox.v1',
      events: [],
      padding: 'x'.repeat(8 * 1024 * 1024),
    }));
    fs.writeFileSync(path.join(legacyCacheDir, 'telemetry.json'), JSON.stringify({
      events: [],
      padding: 'x'.repeat(8 * 1024 * 1024),
    }));

    const manager = new TelemetryManager(config(), stateDir, legacyCacheDir);
    manager.getStats();

    const names = findFileNames(stateDir);
    expect(names).toContainEqual(expect.stringMatching(/^metadata\.json\.corrupt-/));
    expect(names).toContainEqual(expect.stringMatching(/^outbox\.json\.corrupt-/));
    expect(names).toContainEqual(expect.stringMatching(/^telemetry\.json\.corrupt-/));
    expect(names).not.toContain('outbox.json.migrated');
    expect(names).not.toContain('telemetry.json.migrated');
  });

  it('clears every queued event', async () => {
    const manager = new TelemetryManager(config(), stateDir);
    await manager.record({ action: 'scan', loc: 1, durationMs: 2 });
    await manager.record({ action: 'test', loc: 3, durationMs: 4 });
    expect(manager.clear()).toBe(2);
    expect(manager.getStats().pending).toBe(0);
  });

  it('keeps queued events after delivery failure', async () => {
    const post = jest.fn().mockRejectedValue({
      isAxiosError: true,
      response: { status: 503 },
    });
    mockedAxios.create.mockReturnValue({ post, get: jest.fn() } as any);
    mockedAxios.isAxiosError.mockReturnValue(true);
    const manager = new TelemetryManager(config(), stateDir);
    await manager.record({ action: 'test', loc: 1, durationMs: 2, model: 'sast' });
    await expect(manager.sync()).rejects.toThrow('HTTP 503');
    expect(manager.getStats().pending).toBe(1);
  });

  it('removes acknowledged events after explicit sync', async () => {
    const post = jest.fn().mockImplementation((_url, request) => Promise.resolve({
      status: 202,
      data: { status: 'accepted', batchId: request.batchId, accepted: request.events.length },
    }));
    mockedAxios.create.mockReturnValue({ post, get: jest.fn() } as any);
    const manager = new TelemetryManager(config(), stateDir);
    await manager.record({ action: 'review', loc: 1, durationMs: 2, model: 'ollama' });
    await expect(manager.sync()).resolves.toEqual({ sent: 1, remaining: 0 });
    expect(manager.getStats().pending).toBe(0);
  });

  it('rejects a second simultaneous sync while the first owns the spool', async () => {
    const requestStarted = deferred<void>();
    const firstResponse = deferred<any>();
    const post = jest.fn()
      .mockImplementationOnce((_url, request) => {
        requestStarted.resolve();
        return firstResponse.promise.then(() => ({
          status: 202,
          data: { status: 'accepted', batchId: request.batchId, accepted: request.events.length },
        }));
      })
      .mockImplementation((_url, request) => Promise.resolve({
        status: 202,
        data: { status: 'accepted', batchId: request.batchId, accepted: request.events.length },
      }));
    mockedAxios.create.mockReturnValue({ post, get: jest.fn() } as any);
    const firstManager = new TelemetryManager(config(), stateDir);
    const secondManager = new TelemetryManager(config(), stateDir);
    await firstManager.record({ action: 'scan', loc: 1, durationMs: 2 });

    const firstSync = firstManager.sync();
    await requestStarted.promise;
    await expect(secondManager.sync()).rejects.toThrow(/sync|lease|progress/i);
    expect(post).toHaveBeenCalledTimes(1);

    firstResponse.resolve(undefined);
    await expect(firstSync).resolves.toEqual({ sent: 1, remaining: 0 });
  });

  it('preserves an event recorded while a deferred sync acknowledges its snapshot', async () => {
    const requestStarted = deferred<any>();
    const responseAllowed = deferred<void>();
    const post = jest.fn().mockImplementation(async (_url, request) => {
      requestStarted.resolve(request);
      await responseAllowed.promise;
      return {
        status: 202,
        data: {
          status: 'accepted',
          batchId: request.batchId,
          accepted: request.events.length,
          acceptedEventIds: request.events.map((event: { eventId: string }) => event.eventId),
        },
      };
    });
    mockedAxios.create.mockReturnValue({ post, get: jest.fn() } as any);
    const syncingManager = new TelemetryManager(config(), stateDir);
    const recordingManager = new TelemetryManager(config(), stateDir);
    await syncingManager.record({ action: 'scan', loc: 1, durationMs: 2 });

    const sync = syncingManager.sync();
    const request = await requestStarted.promise;
    await recordingManager.record({ action: 'test', loc: 3, durationMs: 4 });
    responseAllowed.resolve();

    await expect(sync).resolves.toEqual({ sent: 1, remaining: 1 });
    expect(request.events).toHaveLength(1);
    expect(new TelemetryManager(config(), stateDir).getStats().pending).toBe(1);
  });

  it.each([
    ['a string', 'event-1', /acceptedEventIds must be an array/i],
    ['duplicate IDs', ['event-1', 'event-1'], /acceptedEventIds.*unique/i],
    ['an unrequested ID', ['not-requested'], /acceptedEventIds.*requested/i],
    ['a non-string ID', [123], /acceptedEventIds.*strings/i],
  ])('rejects acceptedEventIds containing %s and retains the spool', async (
    _case,
    acceptedEventIds,
    expectedError
  ) => {
    const post = jest.fn().mockImplementation((_url, request) => Promise.resolve({
      status: 202,
      data: {
        status: 'accepted',
        batchId: request.batchId,
        accepted: 1,
        acceptedEventIds,
      },
    }));
    mockedAxios.create.mockReturnValue({ post, get: jest.fn() } as any);
    const manager = new TelemetryManager(config(), stateDir);
    await manager.record({ action: 'scan', loc: 1, durationMs: 2 });

    await expect(manager.sync()).rejects.toThrow(expectedError);
    expect(manager.getStats().pending).toBe(1);
  });

  it('preserves the outbox when a partial acknowledgement omits event IDs', async () => {
    const post = jest.fn().mockImplementation((_url, request) => Promise.resolve({
      status: 202,
      data: { status: 'accepted', batchId: request.batchId, accepted: 0 },
    }));
    mockedAxios.create.mockReturnValue({ post, get: jest.fn() } as any);
    const manager = new TelemetryManager(config(), stateDir);
    await manager.record({ action: 'scan', loc: 1, durationMs: 2, model: 'sast' });

    await expect(manager.sync()).rejects.toThrow('partial telemetry acknowledgement');
    expect(manager.getStats().pending).toBe(1);
  });

  it('preserves events after an incomplete duplicate acknowledgement', async () => {
    const post = jest.fn().mockImplementation((_url, request) => Promise.resolve({
      status: 202,
      data: { status: 'duplicate', batchId: request.batchId, accepted: 0 },
    }));
    mockedAxios.create.mockReturnValue({ post, get: jest.fn() } as any);
    const manager = new TelemetryManager(config(), stateDir);
    await manager.record({ action: 'scan', loc: 1, durationMs: 2 });

    await expect(manager.sync()).rejects.toThrow('complete batch');
    expect(manager.getStats().pending).toBe(1);
  });
});

function runChild(script: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, ...args], {
      env: { ...process.env, GUARDSCAN_HOME: stateDirForEnvironment(args) },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr || `child exited ${code}`)));
  });
}

function stateDirForEnvironment(args: string[]): string {
  return args.find(value => path.isAbsolute(value) && !value.endsWith('.js')) || os.tmpdir();
}

function writePersistedEvent(
  eventsDir: string,
  eventId: string,
  overrides: Record<string, unknown> = {}
): void {
  fs.writeFileSync(path.join(eventsDir, `${eventId}.json`), JSON.stringify({
    eventId,
    action: 'scan',
    loc: 1,
    durationMs: 2,
    executionMode: 'static',
    occurredAt: Date.now(),
    ...overrides,
  }));
}

function findFileNames(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const names: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    names.push(entry.name);
    if (entry.isDirectory()) names.push(...findFileNames(path.join(root, entry.name)));
  }
  return names;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
