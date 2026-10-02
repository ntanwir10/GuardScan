'use strict';

const TERMINAL_CHANNEL_STATUSES = new Set(['verified', 'failed', 'withdrawn', 'superseded']);
const CATALOG_CHANNELS = ['homebrew', 'scoop'];
const MODERATED_CHANNELS = new Set(['winget', 'chocolatey']);

function canaryChannelEventType(state, channel, passed, complete) {
  const status = state.channels?.[channel]?.status;
  if (!status || TERMINAL_CHANNEL_STATUSES.has(status)) return null;
  if (!passed) {
    return ['planned', 'published', 'submitted', 'accepted', 'resubmitted'].includes(status)
      ? 'channel_failed'
      : null;
  }
  if (!complete) return null;
  if (MODERATED_CHANNELS.has(channel)) return status === 'accepted' ? 'channel_verified' : null;
  return ['planned', 'published', 'accepted'].includes(status) ? 'channel_verified' : null;
}

function catalogReconciliationAllowed(state) {
  return CATALOG_CHANNELS.every(channel => {
    const status = state.channels?.[channel]?.status;
    return status && !TERMINAL_CHANNEL_STATUSES.has(status);
  });
}

function shouldPublishCatalogChannel(state, channel) {
  if (!CATALOG_CHANNELS.includes(channel)) return false;
  return ['planned', 'submitted'].includes(state.channels?.[channel]?.status);
}

module.exports = {canaryChannelEventType, catalogReconciliationAllowed, shouldPublishCatalogChannel};
