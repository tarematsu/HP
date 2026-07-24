import { getCollectionContext } from './collection-context.js';
import { collectionAbortError, throwIfCollectionAborted } from './collection-abort.js';
import { PLAYBACK_FEED_LIMIT } from './source-feed-unlimited.js';

export function shouldDeferFeedMaintenance(env, options) {
  if (options.deferFeedMaintenance !== undefined) {
    return Boolean(options.deferFeedMaintenance);
  }
  return Boolean(getCollectionContext(env)?.deferFeedMaintenance);
}

export async function finishExcludedOnlyRun(env, run, options, blockedCount, deathCount, lowResolutionCount = 0) {
  const databaseStartedMs = Date.now();
  const completedAt = new Date().toISOString();
  const collectionMs = Number.isFinite(Number(options.collectionDurationMs))
    ? Math.max(0, Math.round(Number(options.collectionDurationMs)))
    : Math.max(0, Date.now() - run.collectionStartedMs);
  const databaseDurationMs = Math.max(
    0,
    Math.round(run.initialDatabaseDurationMs + (Date.now() - databaseStartedMs))
  );
  const totalDurationMs = Math.max(0, Math.round(Date.now() - run.startedMs));

  throwIfCollectionAborted(options.signal);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE collection_runs
         SET completed_at = ?, found_count = 0, inserted_count = 0, error = NULL
       WHERE id = ?`
    ).bind(completedAt, run.runId),
    env.DB.prepare(
      `INSERT INTO collection_run_timings (
         run_id, collection_duration_ms, database_duration_ms, total_duration_ms
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         collection_duration_ms = excluded.collection_duration_ms,
         database_duration_ms = excluded.database_duration_ms,
         total_duration_ms = excluded.total_duration_ms`
    ).bind(run.runId, collectionMs, databaseDurationMs, totalDurationMs)
  ]);

  const abortError = collectionAbortError(options.signal);
  if (abortError) {
    await env.DB.prepare(
      `UPDATE collection_runs SET error = ? WHERE id = ?`
    ).bind(String(abortError?.message || abortError).slice(0, 1000), run.runId).run();
    abortError.collectionRunRecorded = true;
    abortError.timings = {
      collectionDurationMs: collectionMs,
      databaseDurationMs,
      totalDurationMs
    };
    throw abortError;
  }

  const feed = shouldDeferFeedMaintenance(env, options)
    ? null
    : await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM ranking_entries WHERE period = '24h'`
    ).first();

  return {
    ok: true,
    imported: 0,
    inserted: 0,
    duplicatesOrExisting: 0,
    blockedSkipped: blockedCount,
    deathSkipped: deathCount,
    lowResolutionSkipped: lowResolutionCount,
    combinedFeedCount: feed ? Number(feed.count || 0) : null,
    storageUrlLimit: null,
    playbackFeedLimit: PLAYBACK_FEED_LIMIT,
    d1Chunks: 0,
    capturedAt: completedAt,
    collectionDurationMs: collectionMs,
    databaseDurationMs,
    totalDurationMs,
    ...(options.details || {})
  };
}
