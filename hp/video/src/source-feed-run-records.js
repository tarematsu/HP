import { collectionAbortError } from './collection-abort.js';

export const PERIOD = '24h';

export function duration(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

export function ensureCollectionTimingTable() {
  return undefined;
}

export async function insertCollectionRun(db, { startedAt, method = null, sourceUrl = null }) {
  const result = await db.prepare(
    `INSERT INTO collection_runs (period, started_at, source_method, source_url)
     VALUES (?, ?, ?, ?)`
  ).bind(PERIOD, startedAt, method, sourceUrl).run();
  return result.meta.last_row_id;
}

export function collectionRunUpdateStatement(db, runId, values) {
  return db.prepare(
    `UPDATE collection_runs
       SET completed_at = ?,
           found_count = ?,
           inserted_count = ?,
           error = ?
     WHERE id = ?`
  ).bind(
    values.completedAt || new Date().toISOString(),
    values.foundCount ?? 0,
    values.insertedCount ?? 0,
    values.error || null,
    runId
  );
}

export async function finishCollectionRunRecord(db, runId, values) {
  await collectionRunUpdateStatement(db, runId, values).run();
}

export async function beginCollectionRun(env, options) {
  const startedMs = Date.now();
  const dbStarted = Date.now();
  const runId = await insertCollectionRun(env.DB, {
    startedAt: new Date(startedMs).toISOString(),
    method: options.method,
    sourceUrl: options.sourceUrl
  });
  return {
    runId,
    startedMs,
    collectionStartedMs: Date.now(),
    initialDatabaseDurationMs: Date.now() - dbStarted
  };
}

export async function finishCollectionRun(env, run, values, signal) {
  const dbStarted = values.databaseStartedMs ?? Date.now();
  const completedAt = new Date().toISOString();
  const timing = {
    collectionDurationMs: duration(values.collectionDurationMs),
    databaseDurationMs: duration(run.initialDatabaseDurationMs + (Date.now() - dbStarted)),
    totalDurationMs: duration(Date.now() - run.startedMs)
  };
  await env.DB.batch([
    collectionRunUpdateStatement(env.DB, run.runId, {
      ...values,
      completedAt
    }),
    env.DB.prepare(
      `INSERT INTO collection_run_timings (
         run_id, collection_duration_ms, database_duration_ms, total_duration_ms
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         collection_duration_ms = excluded.collection_duration_ms,
         database_duration_ms = excluded.database_duration_ms,
         total_duration_ms = excluded.total_duration_ms`
    ).bind(run.runId, timing.collectionDurationMs, timing.databaseDurationMs, timing.totalDurationMs)
  ]);

  const abortError = !values.error && collectionAbortError(signal);
  if (abortError) {
    await env.DB.prepare(
      `UPDATE collection_runs SET error = ? WHERE id = ?`
    ).bind(String(abortError?.message || abortError).slice(0, 1000), run.runId).run();
    abortError.collectionRunRecorded = true;
    abortError.timings = timing;
    throw abortError;
  }

  return timing;
}

export async function recordCollectionFailure(env, options, error) {
  const run = options.run || await beginCollectionRun(env, options);
  return finishCollectionRun(env, run, {
    databaseStartedMs: Date.now(),
    collectionDurationMs: duration(options.collectionDurationMs, Date.now() - run.collectionStartedMs),
    foundCount: 0,
    insertedCount: 0,
    error: String(error?.message || error).slice(0, 1000)
  });
}
