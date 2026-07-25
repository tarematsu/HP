import * as core from './source-feed-unlimited.js';
import { getCollectionContext } from './collection-context.js';
import { finalizeCompactedFeed } from './source-feed-compacted.js';

export const PLAYBACK_FEED_LIMIT = core.PLAYBACK_FEED_LIMIT;
export const ensureCollectionTimingTable = core.ensureCollectionTimingTable;
export const beginCollectionRun = core.beginCollectionRun;
export const planPlaybackFeedChanges = core.planPlaybackFeedChanges;
export const desiredFeedStatement = core.desiredFeedStatement;
export const rebuildPlaybackFeed = core.rebuildPlaybackFeed;
export const finalizeCollectionDatabase = core.finalizeCollectionDatabase;
export const recordCollectionFailure = core.recordCollectionFailure;

export async function persistMergedFeed(env, options) {
  const deferFeedMaintenance = options.deferFeedMaintenance === undefined
    ? Boolean(getCollectionContext(env)?.deferFeedMaintenance)
    : Boolean(options.deferFeedMaintenance);
  const result = await core.persistMergedFeed(env, {
    ...options,
    deferFeedMaintenance: true
  });
  if (deferFeedMaintenance) return result;
  const combinedFeedCount = await finalizeCompactedFeed(env, result.capturedAt);
  return { ...result, combinedFeedCount };
}
