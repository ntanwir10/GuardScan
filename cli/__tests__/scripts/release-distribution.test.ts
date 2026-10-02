const {
  canaryChannelEventType,
  catalogReconciliationAllowed,
  shouldPublishCatalogChannel,
} = require('../../scripts/release/distribution-guards') as {
  canaryChannelEventType: (state: Record<string, any>, channel: string, passed: boolean, complete: boolean) => string | null;
  catalogReconciliationAllowed: (state: Record<string, any>) => boolean;
  shouldPublishCatalogChannel: (state: Record<string, any>, channel: string) => boolean;
};
const {planRollback} = require('../../scripts/release/reconcile') as {
  planRollback: (state: Record<string, any>, version: string, commit: string) => Record<string, any>;
};
const {createEvent, materializeReleaseState} = require('../../scripts/release/events') as {
  createEvent: (input: Record<string, any>, previous?: Record<string, any>) => Record<string, any>;
  materializeReleaseState: (events: Array<Record<string, any>>) => Record<string, any>;
};

describe('distribution state guards', () => {
  it.each(['verified', 'failed', 'withdrawn', 'superseded'])(
    'suppresses repeated canary channel transitions after %s', status => {
      const state = {channels: {npm: {status}}};
      expect(canaryChannelEventType(state, 'npm', false, false)).toBeNull();
      expect(canaryChannelEventType(state, 'npm', true, true)).toBeNull();
    }
  );

  it('verifies moderated channels only after provider evidenced acceptance', () => {
    expect(canaryChannelEventType({channels: {winget: {status: 'submitted'}}}, 'winget', true, true))
      .toBeNull();
    expect(canaryChannelEventType({channels: {winget: {status: 'accepted'}}}, 'winget', true, true))
      .toBe('channel_verified');
    expect(canaryChannelEventType({channels: {npm: {status: 'published'}}}, 'npm', true, true))
      .toBe('channel_verified');
  });

  it('requires artifact and provider submission evidence for moderated acceptance', () => {
    const base = {version: '1.2.3', tag: 'v1.2.3', commit: 'a'.repeat(40)};
    const remoteIdentity = 'chocolatey:guardscan@1.2.3';
    const remoteDigest = 'd'.repeat(64);
    const submission = (state: string) => ({
      schemaVersion: 'guardscan.moderated-submission.v1', channel: 'chocolatey',
      version: base.version, tag: base.tag, state,
      packageIdentity: 'guardscan@1.2.3', remoteIdentity, remoteDigest,
      packageFilename: 'guardscan.1.2.3.nupkg',
      provider: {
        url: 'https://community.chocolatey.org/api/v2/package/guardscan/1.2.3',
        publicBytesVerified: false, pendingStateQuery: 'moderation accepted',
      },
    });
    const first = createEvent({...base, type: 'train_started',
      timestamp: '2026-07-20T00:00:00.000Z', idempotencyKey: 'train',
      payload: {channels: ['chocolatey']}});
    const submitted = createEvent({...base, type: 'channel_submitted', channel: 'chocolatey',
      timestamp: '2026-07-20T00:01:00.000Z', idempotencyKey: 'submitted',
      payload: {artifactIds: ['standalone:windows-x64'], remoteIdentity, remoteDigest,
        submission: submission('submitted')}}, first);
    const acceptedInput = {...base, type: 'channel_accepted', channel: 'chocolatey',
      timestamp: '2026-07-20T00:02:00.000Z', idempotencyKey: 'accepted',
      payload: {artifactIds: ['standalone:windows-x64'], remoteIdentity, remoteDigest,
        submission: submission('accepted')}};
    const accepted = createEvent(acceptedInput, submitted);
    expect(materializeReleaseState([first, submitted, accepted]).channels.chocolatey.status)
      .toBe('accepted');
    for (const field of ['artifactIds', 'remoteIdentity', 'remoteDigest', 'submission']) {
      const payload = {...acceptedInput.payload};
      delete (payload as Record<string, unknown>)[field];
      expect(() => createEvent({...acceptedInput, payload}, submitted))
        .toThrow(/requires canonical moderated provider evidence/);
    }
  });

  it.each(['verified', 'failed', 'withdrawn', 'superseded'])(
    'does not reconcile or republish a %s catalog channel', status => {
      const state = {channels: {homebrew: {status}, scoop: {status: 'submitted'}}};
      expect(catalogReconciliationAllowed(state)).toBe(false);
      expect(shouldPublishCatalogChannel(state, 'homebrew')).toBe(false);
    }
  );

  it('permits exact catalog evidence to publish submitted Scoop after Homebrew verification', () => {
    const state = {channels: {homebrew: {status: 'verified'}, scoop: {status: 'submitted'}}};
    expect(catalogReconciliationAllowed(state)).toBe(false);
    expect(shouldPublishCatalogChannel(state, 'homebrew')).toBe(false);
    expect(shouldPublishCatalogChannel(state, 'scoop')).toBe(true);
  });

  it('supersedes failed repository owned channels during known good rollback', () => {
    const plan = planRollback({
      version: '1.2.0', tag: 'v1.2.0', commit: 'a'.repeat(40),
      channels: {github: {status: 'failed'}, homebrew: {status: 'failed'},
        scoop: {status: 'failed'}, npm: {status: 'failed'}},
    }, '1.1.9', 'b'.repeat(40));
    expect(plan.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({channel: 'github', currentStatus: 'failed', automation: 'repository-automated'}),
      expect.objectContaining({channel: 'homebrew', currentStatus: 'failed', automation: 'repository-automated'}),
      expect.objectContaining({channel: 'scoop', currentStatus: 'failed', automation: 'repository-automated'}),
    ]));
    expect(plan.actions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({channel: 'npm', currentStatus: 'failed'}),
    ]));
  });
});
