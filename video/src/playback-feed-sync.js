import { ensureDbIndexes } from './db-indexes.js';
import {
  ensureD1Compaction,
  feedContentHash,
  maybeCleanupCollectionRuns,
  withPlaybackFeedFinalization
} from './d1-compaction.js';
import { PLAYBACK_FEED_LIMIT } from './feed-limits.js';
import {
  currentRankingEntriesStatement,
  deleteRankingEntriesByVideoIdsStatement,
  parkRankingEntriesByVideoIdsStatement,
  rankingEntryPayloads,
  upsertRankingEntriesByVideoIdsStatement
} from './ranking-entry-statements.js';
import { recentFeedCutoff } from './source-feed-time.js';

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

export function desiredFeedStatement(db, capturedAt) {
  const cutoffAt = recentFeedCutoff(capturedAt);
  return db.prepare(
    `SELECT video.id AS videoId
       FROM videos AS video
      WHERE video.status = 'active'
        AND video.last_seen_at >= ?
        AND NOT EXISTS (
          SELECT 1 FROM video_blocklist AS bad
           WHERE bad.canonical_key = video.canonical_key
        )
        AND NOT EXISTS (
          SELECT 1 FROM video_death_list AS death
           WHERE death.canonical_key = video.canonical_key
        )
      ORDER BY video.last_seen_at DESC, video.id DESC
      LIMIT ?`
  ).bind(cutoffAt, PLAYBACK_FEED_LIMIT);
}

async function syncPlaybackFeed(db, capturedAt) {
  const [desiredResult, currentResult] = await db.batch([
    desiredFeedStatement(db, capturedAt),
    currentRankingEntriesStatement(db)
  ]);
  const desiredRows = desiredResult?.results || [];
  const plan = planPlaybackFeedChanges(
    desiredRows,
    currentResult?.results || []
  );
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

export async function rebuildPlaybackFeed(db, capturedAt = new Date().toISOString()) {
  await Promise.all([ensureDbIndexes(db), ensureD1Compaction(db)]);
  return withPlaybackFeedFinalization(db, async () => {
    const { count, rows } = await syncPlaybackFeed(db, capturedAt);
    const hash = await feedContentHash(rows);
    return {
      value: count,
      contentHash: hash,
      rowCount: count,
      updatedAt: capturedAt
    };
  });
}

export async function finalizeCollectionDatabase(env, capturedAt = new Date().toISOString()) {
  const db = env.DB || env;
  const count = await rebuildPlaybackFeed(db, capturedAt);
  await maybeCleanupCollectionRuns(db);
  return count;
}
