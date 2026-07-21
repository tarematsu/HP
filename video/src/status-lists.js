import {
  buildLivenessStatus,
  prepareLivenessStateRead
} from './liveness-monitor.js';
import {
  emptyStatusCounts,
  prepareStatusCountsRead,
  refreshStatusCounts
} from './status-counts.js';

export const STATUS_LIST_DEFAULT_LIMIT = 100;
export const STATUS_LIST_MAX_LIMIT = 500;

export function parseStatusListLimit(value) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return STATUS_LIST_DEFAULT_LIMIT;
  return Math.min(STATUS_LIST_MAX_LIMIT, Math.max(1, parsed));
}

export function preparePlaybackExclusionListRead(db, limit) {
  return db.prepare(
    `SELECT canonical_key AS canonicalKey,
            media_url AS mediaUrl,
            video_id AS videoId,
            blocked_at AS blockedAt,
            reason
       FROM video_blocklist
      ORDER BY blocked_at DESC, canonical_key
      LIMIT ?`
  ).bind(limit);
}

export function unpackStatusItems(result) {
  return result?.results || [];
}

function unpackStatusCounts(result) {
  return result?.results?.[0] || emptyStatusCounts();
}

function needsStatusCountRefresh(row) {
  return !row?.countsUpdatedAt || Number(row.countsDirty || 0) > 0;
}

async function refreshPersistedStatusCounts(db, row) {
  if (!needsStatusCountRefresh(row)) return row;
  try {
    return await refreshStatusCounts(db);
  } catch (error) {
    console.error('status-list-count-refresh-failed', {
      error: String(error?.message || error)
    });
    return row;
  }
}

async function readPersistedStatusCounts(db) {
  const row = (await prepareStatusCountsRead(db).first()) || emptyStatusCounts();
  return refreshPersistedStatusCounts(db, row);
}

export function attachListItems(summary, items, limit) {
  return {
    ...summary,
    limit,
    returnedCount: items.length,
    truncated: Number(summary.count || 0) > items.length,
    items
  };
}

export async function readPlaybackExclusionSummary(db) {
  const counts = await readPersistedStatusCounts(db);
  return {
    ok: true,
    count: Number(counts.blockedVideos || 0),
    type: 'manual-playback-exclusion-list',
    behavior: 'hidden-from-playback-and-skipped-during-persistence',
    detailsProtected: true
  };
}

export async function readPlaybackExclusionStatus(db, limit) {
  const itemsResult = await preparePlaybackExclusionListRead(db, limit).all();
  const items = unpackStatusItems(itemsResult);
  let count = items.length;
  if (items.length >= limit) {
    const counts = await readPersistedStatusCounts(db);
    count = Math.max(items.length, Number(counts.blockedVideos || 0));
  }
  return attachListItems({
    ok: true,
    count,
    type: 'manual-playback-exclusion-list',
    behavior: 'hidden-from-playback-and-skipped-during-persistence'
  }, items, limit);
}

export const readBlocklistStatus = readPlaybackExclusionStatus;

export async function readStatusLists(db, limit) {
  const [excluded, countResult] = await db.batch([
    preparePlaybackExclusionListRead(db, limit),
    prepareStatusCountsRead(db)
  ]);
  const counts = await refreshPersistedStatusCounts(db, unpackStatusCounts(countResult));
  return {
    excludedCount: Number(counts.blockedVideos || 0),
    excludedItems: unpackStatusItems(excluded),
    deathCount: Number(counts.deathVideos || 0),
    deathItems: []
  };
}

export async function readStatusSnapshot(db, limit) {
  const [state, excluded, countResult] = await db.batch([
    prepareLivenessStateRead(db),
    preparePlaybackExclusionListRead(db, limit),
    prepareStatusCountsRead(db)
  ]);
  const counts = await refreshPersistedStatusCounts(db, unpackStatusCounts(countResult));
  const currentDeathCount = Number(counts.deathVideos || 0);
  const excludedItems = unpackStatusItems(excluded);
  const excludedTotal = Number(counts.blockedVideos || 0);
  return {
    excludedCount: excludedTotal,
    excludedItems,
    deathCount: currentDeathCount,
    deathItems: [],
    liveness: buildLivenessStatus(state?.results?.[0] || null, currentDeathCount)
  };
}
