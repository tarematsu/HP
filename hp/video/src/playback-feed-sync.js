import { ensureDbIndexes } from './db-indexes.js';
import {
  ensureD1Compaction,
  feedContentHash,
  maybeCleanupCollectionRuns,
  withPlaybackFeedFinalization,
  writeFeedState
} from './d1-compaction.js';
import { PLAYBACK_FEED_LIMIT } from './feed-limits.js';
import {
  deleteRankingEntriesByVideoIdsStatement,
  parkRankingEntriesByVideoIdsStatement,
  rankingEntryPayloads,
  upsertRankingEntriesByVideoIdsStatement
} from './ranking-entry-statements.js';

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function planPlaybackFeedChanges(desiredRows, currentRows) {
  const desired = [];
  const desiredIds = new Set();
  for (const row of desiredRows || []) {
    const videoId = positiveInteger(row?.videoId ?? row?.id);
    if (!videoId || desiredIds.has(videoId)) continue;
    desiredIds.add(videoId);
    desired.push({ videoId, rank: desired.length + 1 });
  }
  const currentById = new Map();
  for (const row of currentRows || []) {
    const videoId = positiveInteger(row?.videoId ?? row?.id);
    const rank = positiveInteger(row?.rank);
    if (videoId && rank && !currentById.has(videoId)) currentById.set(videoId, rank);
  }
  const stale = [];
  for (const videoId of currentById.keys()) {
    if (!desiredIds.has(videoId)) stale.push({ videoId });
  }
  const moved = [];
  const upserts = [];
  for (const row of desired) {
    const currentRank = currentById.get(row.videoId);
    if (currentRank === row.rank) continue;
    if (currentRank !== undefined) moved.push({ videoId: row.videoId });
    upserts.push(row);
  }
  return { desiredCount: desired.length, stale, moved, upserts };
}

function stablePlaybackFeedRows(desiredRows, currentRows) {
  const desiredById = new Map();
  for (const row of desiredRows || []) {
    const videoId = positiveInteger(row?.videoId ?? row?.id);
    if (videoId && !desiredById.has(videoId)) desiredById.set(videoId, row);
  }

  const rows = [];
  const added = new Set();
  for (const current of currentRows || []) {
    const videoId = positiveInteger(current?.videoId ?? current?.id);
    const desired = desiredById.get(videoId);
    if (!desired || added.has(videoId)) continue;
    added.add(videoId);
    rows.push(desired);
  }
  for (const desired of desiredRows || []) {
    const videoId = positiveInteger(desired?.videoId ?? desired?.id);
    if (!videoId || added.has(videoId)) continue;
    added.add(videoId);
    rows.push(desired);
  }
  return rows;
}

export function currentFeedRowsStatement(db) {
  return db.prepare(
    `SELECT ranking.video_id AS videoId,
            ranking.rank,
            video.canonical_key AS canonicalKey,
            video.media_url AS mediaUrl
       FROM ranking_entries AS ranking
       INNER JOIN videos AS video ON video.id = ranking.video_id
      WHERE ranking.period = '24h'
        AND video.status = 'active'
      ORDER BY ranking.rank, ranking.video_id
      LIMIT ?`
  ).bind(PLAYBACK_FEED_LIMIT);
}

export function desiredFeedStatement(db) {
  return currentFeedRowsStatement(db);
}

function itemPayload(items) {
  const rows = [];
  const seen = new Set();
  for (const item of items || []) {
    const key = String(item?.key || item?.canonicalKey || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, rank: rows.length + 1 });
    if (rows.length >= PLAYBACK_FEED_LIMIT) break;
  }
  return JSON.stringify(rows);
}

export function desiredFeedItemsStatement(db, items) {
  return db.prepare(
    `SELECT video.id AS videoId,
            CAST(json_extract(input.value, '$.rank') AS INTEGER) AS rank,
            video.canonical_key AS canonicalKey,
            video.media_url AS mediaUrl
       FROM json_each(?) AS input
       INNER JOIN videos AS video
               ON video.canonical_key = json_extract(input.value, '$.key')
      WHERE video.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM video_blocklist AS blocked
           WHERE blocked.canonical_key = video.canonical_key
        )
        AND NOT EXISTS (
          SELECT 1 FROM video_death_list AS dead
           WHERE dead.canonical_key = video.canonical_key
        )
      ORDER BY rank
      LIMIT ?`
  ).bind(itemPayload(items), PLAYBACK_FEED_LIMIT);
}

function mergedDesiredRows(currentRows, incomingRows) {
  const rows = [];
  const indexByKey = new Map();
  for (const row of currentRows || []) {
    const key = String(row?.canonicalKey || '');
    if (!key || indexByKey.has(key)) continue;
    indexByKey.set(key, rows.length);
    rows.push({ ...row });
  }
  for (const row of incomingRows || []) {
    const key = String(row?.canonicalKey || '');
    if (!key) continue;
    const index = indexByKey.get(key);
    if (index === undefined) {
      if (rows.length >= PLAYBACK_FEED_LIMIT) break;
      indexByKey.set(key, rows.length);
      rows.push({ ...row });
    } else {
      rows[index] = { ...rows[index], ...row };
    }
  }
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

async function syncPlaybackFeed(db, capturedAt, options = {}) {
  const replaceItems = Array.isArray(options.replaceItems)
    ? options.replaceItems
    : Array.isArray(options.desiredItems)
      ? options.desiredItems
      : null;
  const mergeItems = Array.isArray(options.mergeItems) ? options.mergeItems : null;
  const currentStatement = currentFeedRowsStatement(db);

  let currentRows;
  let desiredRows;
  if (replaceItems) {
    const [desiredResult, currentResult] = await db.batch([
      desiredFeedItemsStatement(db, replaceItems),
      currentStatement
    ]);
    desiredRows = desiredResult?.results || [];
    currentRows = currentResult?.results || [];
  } else if (mergeItems) {
    const [incomingResult, currentResult] = await db.batch([
      desiredFeedItemsStatement(db, mergeItems),
      currentStatement
    ]);
    currentRows = currentResult?.results || [];
    desiredRows = mergedDesiredRows(currentRows, incomingResult?.results || []);
  } else {
    const currentResult = await currentStatement.all();
    currentRows = currentResult?.results || [];
    desiredRows = currentRows;
  }

  desiredRows = stablePlaybackFeedRows(desiredRows, currentRows);
  const plan = planPlaybackFeedChanges(desiredRows, currentRows);
  const statements = [];
  for (const payload of rankingEntryPayloads(plan.stale)) {
    statements.push(deleteRankingEntriesByVideoIdsStatement(db, payload));
  }
  for (const payload of rankingEntryPayloads(plan.moved)) {
    statements.push(parkRankingEntriesByVideoIdsStatement(db, payload));
  }
  for (const payload of rankingEntryPayloads(plan.upserts)) {
    statements.push(upsertRankingEntriesByVideoIdsStatement(db, payload, capturedAt));
  }
  if (statements.length) await db.batch(statements);
  return { count: plan.desiredCount, rows: desiredRows };
}

export async function rebuildPlaybackFeed(
  db,
  capturedAt = new Date().toISOString(),
  options = {}
) {
  await Promise.all([ensureDbIndexes(db), ensureD1Compaction(db)]);
  const task = async () => {
    const { count, rows } = await syncPlaybackFeed(db, capturedAt, options);
    const hash = await feedContentHash(rows);
    if (typeof options.publishSnapshot === 'function') {
      await options.publishSnapshot(rows, hash, capturedAt);
    }
    return {
      value: count,
      contentHash: hash,
      rowCount: count,
      updatedAt: capturedAt
    };
  };

  if (options.lock === false) {
    const outcome = await task();
    await writeFeedState(db, outcome.contentHash, outcome.rowCount, outcome.updatedAt);
    return outcome.value;
  }
  return withPlaybackFeedFinalization(db, task);
}

export async function finalizeCollectionDatabase(env, capturedAt = new Date().toISOString()) {
  const db = env.DB || env;
  const count = await rebuildPlaybackFeed(db, capturedAt);
  await maybeCleanupCollectionRuns(db);
  return count;
}
