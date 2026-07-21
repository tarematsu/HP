import {
  beginCollectionRun,
  ensureCollectionTimingTable,
  persistMergedFeed as persistUnfilteredFeed,
  PLAYBACK_FEED_LIMIT,
  recordCollectionFailure
} from './source-feed-unlimited.js';
import { getCollectionContext } from './collection-context.js';
import { throwIfCollectionAborted } from './collection-abort.js';
import {
  normalizeCollectionCandidates,
  splitKnownCollectionItems
} from './collection-candidates.js';
import { filterExcludedItems } from './collection-exclusions.js';
import { finishExcludedOnlyRun } from './filtered-feed-completion.js';
import { resolveMediaHost } from './media-host.js';

function resolveCollectionSeenKeys(env, options) {
  const shared = getCollectionContext(env);
  const value = options.collectionSeenKeys || shared?.collectionSeenKeys;
  return value instanceof Set ? value : null;
}

export async function persistMergedFeed(env, options) {
  throwIfCollectionAborted(options.signal);
  const run = options.run || await beginCollectionRun(env, options);
  const normalized = normalizeCollectionCandidates(options.urls, resolveMediaHost(env));
  const candidates = normalized.items;
  const seenKeys = resolveCollectionSeenKeys(env, options);
  const { knownItems, uncheckedItems } = splitKnownCollectionItems(candidates, seenKeys);
  const filtered = await filterExcludedItems(env.DB, uncheckedItems);
  throwIfCollectionAborted(options.signal);
  const eligibleKeys = new Set([
    ...knownItems.map((item) => item.key),
    ...filtered.items.map((item) => item.key)
  ]);
  const eligibleItems = candidates.filter((item) => eligibleKeys.has(item.key));

  if ((candidates.length || normalized.lowResolutionCount) && !eligibleItems.length) {
    return finishExcludedOnlyRun(
      env,
      run,
      options,
      filtered.blockedCount,
      filtered.deathCount,
      normalized.lowResolutionCount
    );
  }

  const result = await persistUnfilteredFeed(env, {
    ...options,
    run,
    urls: eligibleItems.map((item) => item.url)
  });
  return {
    ...result,
    blockedSkipped: filtered.blockedCount,
    deathSkipped: filtered.deathCount,
    lowResolutionSkipped: normalized.lowResolutionCount,
    reusedCollectionItems: knownItems.length
  };
}

export {
  beginCollectionRun,
  ensureCollectionTimingTable,
  filterExcludedItems,
  PLAYBACK_FEED_LIMIT,
  recordCollectionFailure,
  splitKnownCollectionItems
};
