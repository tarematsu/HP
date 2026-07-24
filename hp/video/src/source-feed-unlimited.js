import { getCollectionContext } from './collection-context.js';
import { throwIfCollectionAborted } from './collection-abort.js';
import { PLAYBACK_FEED_LIMIT } from './feed-limits.js';
import {
  desiredFeedStatement,
  finalizeCollectionDatabase,
  planPlaybackFeedChanges,
  rebuildPlaybackFeed
} from './playback-feed-sync.js';
import {
  normalizeSourceFeedItems,
  selectUnseenItems,
  sourceMediaHost
} from './source-feed-normalization.js';
import {
  beginCollectionRun,
  duration,
  ensureCollectionTimingTable,
  finishCollectionRun,
  recordCollectionFailure
} from './source-feed-run-records.js';
import { saveSourceFeedItems } from './source-feed-storage.js';

export { PLAYBACK_FEED_LIMIT };
export {
  beginCollectionRun,
  desiredFeedStatement,
  ensureCollectionTimingTable,
  finalizeCollectionDatabase,
  planPlaybackFeedChanges,
  rebuildPlaybackFeed,
  recordCollectionFailure
};

function resolvePersistenceContext(env, options) {
  const shared = getCollectionContext(env);
  return {
    deferFeedMaintenance: options.deferFeedMaintenance === undefined
      ? Boolean(shared?.deferFeedMaintenance)
      : Boolean(options.deferFeedMaintenance),
    collectionSeenKeys: options.collectionSeenKeys || shared?.collectionSeenKeys
  };
}

export async function persistMergedFeed(env, options) {
  throwIfCollectionAborted(options.signal);
  const run = options.run || await beginCollectionRun(env, options);
  const dbStarted = Date.now();
  const capturedAt = new Date().toISOString();
  const collectionDurationMs = duration(options.collectionDurationMs, Date.now() - run.collectionStartedMs);
  const items = normalizeSourceFeedItems(options.urls || [], sourceMediaHost(env));
  const persistence = resolvePersistenceContext(env, options);
  let inserted = 0;
  if (!items.length) {
    const message = 'No valid video URLs were collected; previous combined feed retained.';
    const timings = await finishCollectionRun(env, run, {
      databaseStartedMs: dbStarted,
      collectionDurationMs,
      foundCount: 0,
      insertedCount: 0,
      error: message
    });
    const error = new Error(message);
    error.collectionRunRecorded = true;
    error.timings = timings;
    throw error;
  }
  try {
    throwIfCollectionAborted(options.signal);
    const writeItems = selectUnseenItems(items, persistence.collectionSeenKeys);
    const saved = writeItems.length
      ? await saveSourceFeedItems(env.DB, writeItems, capturedAt)
      : { inserted: 0, changed: 0, chunks: 0 };
    inserted = saved.inserted;
    throwIfCollectionAborted(options.signal);
    for (const item of writeItems) persistence.collectionSeenKeys?.add(item.key);
    const feedCount = persistence.deferFeedMaintenance
      ? null
      : await finalizeCollectionDatabase(env, capturedAt);
    throwIfCollectionAborted(options.signal);
    const timings = await finishCollectionRun(env, run, {
      databaseStartedMs: dbStarted,
      collectionDurationMs,
      foundCount: items.length,
      insertedCount: inserted,
      error: null
    }, options.signal);
    return {
      ok: true,
      imported: items.length,
      inserted,
      changed: saved.changed,
      duplicatesOrExisting: items.length - inserted,
      combinedFeedCount: feedCount,
      storageUrlLimit: null,
      playbackFeedLimit: PLAYBACK_FEED_LIMIT,
      d1Chunks: saved.chunks,
      capturedAt,
      ...timings,
      ...(options.details || {})
    };
  } catch (error) {
    const timings = error?.collectionRunRecorded
      ? error.timings || null
      : await finishCollectionRun(env, run, {
        databaseStartedMs: dbStarted,
        collectionDurationMs,
        foundCount: items.length,
        insertedCount: inserted,
        error: String(error?.message || error).slice(0, 1000)
      }).catch(() => null);
    if (error && typeof error === 'object') {
      error.collectionRunRecorded = true;
      if (timings) error.timings = timings;
    }
    throw error;
  }
}
