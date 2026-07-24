import {
  isPlaybackFeedFinalizationBusy,
  readFeedState
} from './d1-compaction.js';
import { persistMergedFeed } from './source-feed.js';
import { finalizeCompactedFeed } from './source-feed-compacted.js';

export const MANUAL_IMPORT_CHUNK_SIZE = 20;
export const MANUAL_IMPORT_SYNC_LIMIT = MANUAL_IMPORT_CHUNK_SIZE;

const LOCK_TTL_MS = 5 * 60_000;
const MAX_FAILURES = 3;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortError(error) {
  return String(error?.message || error || 'Unknown error').slice(0, 500);
}

function isoNow(value) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : new Date().toISOString();
}

function jobFields() {
  return `job_id AS jobId,
          source_url AS sourceUrl,
          total_urls AS totalUrls,
          total_chunks AS totalChunks,
          next_chunk AS nextChunk,
          imported_count AS importedCount,
          inserted_count AS insertedCount,
          changed_count AS changedCount,
          failure_count AS failureCount,
          combined_feed_count AS combinedFeedCount,
          status,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt,
          last_error AS lastError,
          lock_token AS lockToken,
          lock_until AS lockUntil`;
}

function acquiredJobFields() {
  return `job_id AS jobId,
          source_url AS sourceUrl,
          next_chunk AS nextChunk,
          changed_count AS changedCount,
          status`;
}

function jobSnapshot(row) {
  if (!row) return null;
  const totalChunks = number(row.totalChunks);
  const nextChunk = number(row.nextChunk);
  return {
    jobId: String(row.jobId || ''),
    status: String(row.status || 'pending'),
    totalUrls: number(row.totalUrls),
    totalChunks,
    completedChunks: Math.min(totalChunks, nextChunk),
    imported: number(row.importedCount),
    inserted: number(row.insertedCount),
    changed: number(row.changedCount),
    failures: number(row.failureCount),
    combinedFeedCount: row.combinedFeedCount == null
      ? null
      : number(row.combinedFeedCount),
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    completedAt: row.completedAt || null,
    lastError: row.lastError || null
  };
}

function jobInsertStatement(db, values) {
  return db.prepare(
    `INSERT INTO manual_import_jobs (
       job_id, source_url, total_urls, total_chunks,
       status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(
    values.jobId,
    values.sourceUrl,
    values.totalUrls,
    values.totalChunks,
    values.createdAt,
    values.createdAt
  );
}

function chunkRowsInsertStatement(db, jobId, urls) {
  return db.prepare(
    `WITH input AS (
       SELECT CAST(key AS INTEGER) AS itemIndex, value AS url
         FROM json_each(?)
     ), grouped AS (
       SELECT CAST(itemIndex / ? AS INTEGER) AS chunkIndex,
              json_group_array(url) AS urlsJson,
              COUNT(*) AS urlCount
         FROM input
        GROUP BY CAST(itemIndex / ? AS INTEGER)
     )
     INSERT INTO manual_import_job_chunks (
       job_id, chunk_index, urls_json, url_count
     )
     SELECT ?, chunkIndex, urlsJson, urlCount
       FROM grouped
      ORDER BY chunkIndex`
  ).bind(
    JSON.stringify(urls),
    MANUAL_IMPORT_CHUNK_SIZE,
    MANUAL_IMPORT_CHUNK_SIZE,
    jobId
  );
}

export async function enqueueManualImportJob(db, options) {
  const urls = Array.isArray(options.urls) ? options.urls : [];
  if (urls.length <= MANUAL_IMPORT_SYNC_LIMIT) {
    throw new Error(`Queued imports require more than ${MANUAL_IMPORT_SYNC_LIMIT} URLs`);
  }

  const jobId = options.jobId || crypto.randomUUID();
  const createdAt = isoNow(options.createdAt);
  const totalChunks = Math.ceil(urls.length / MANUAL_IMPORT_CHUNK_SIZE);
  const values = {
    jobId,
    sourceUrl: options.sourceUrl,
    totalUrls: urls.length,
    totalChunks,
    createdAt
  };
  await db.batch([
    jobInsertStatement(db, values),
    chunkRowsInsertStatement(db, jobId, urls)
  ]);
  return {
    jobId,
    status: 'pending',
    totalUrls: urls.length,
    totalChunks,
    chunkSize: MANUAL_IMPORT_CHUNK_SIZE,
    statusPath: `/api/admin/import/jobs/${jobId}`
  };
}

export async function failManualImportJob(db, jobId, error, completedAt = new Date()) {
  const timestamp = isoNow(completedAt);
  await db.batch([
    db.prepare(
      `UPDATE manual_import_jobs
          SET status = 'failed',
              failure_count = MAX(failure_count, ?),
              updated_at = ?,
              completed_at = ?,
              last_error = ?,
              lock_token = NULL,
              lock_until = NULL
        WHERE job_id = ? AND status NOT IN ('completed', 'failed')`
    ).bind(MAX_FAILURES, timestamp, timestamp, shortError(error), jobId),
    db.prepare(
      `DELETE FROM manual_import_job_chunks WHERE job_id = ?`
    ).bind(jobId)
  ]);
}

export async function readManualImportJob(db, jobId) {
  const row = await db.prepare(
    `SELECT ${jobFields()}
       FROM manual_import_jobs
      WHERE job_id = ?`
  ).bind(jobId).first();
  return jobSnapshot(row);
}

async function acquireJob(db, options = {}) {
  const token = options.token || crypto.randomUUID();
  const acquiredAt = isoNow(options.acquiredAt);
  const acquiredMs = Date.parse(acquiredAt);
  if (!Number.isFinite(acquiredMs)) throw new Error('Invalid manual import acquisition time');
  const lockUntil = new Date(acquiredMs + LOCK_TTL_MS).toISOString();
  const targetJobId = String(options.jobId || '');
  const targetClause = targetJobId ? 'AND job_id = ?' : '';
  const statement = db.prepare(
    `UPDATE manual_import_jobs
        SET lock_token = ?,
            lock_until = ?,
            status = CASE
              WHEN status = 'finalizing' THEN 'finalizing'
              ELSE 'processing'
            END,
            updated_at = ?
      WHERE job_id = (
        SELECT job_id
          FROM manual_import_jobs
         WHERE status IN ('pending', 'processing', 'finalizing')
           ${targetClause}
           AND (lock_token IS NULL OR lock_until IS NULL OR lock_until < ?)
         ORDER BY CASE WHEN status = 'finalizing' THEN 0 ELSE 1 END,
                  created_at,
                  job_id
         LIMIT 1
      )
      RETURNING ${acquiredJobFields()}`
  );
  const row = targetJobId
    ? await statement.bind(token, lockUntil, acquiredAt, targetJobId, acquiredAt).first()
    : await statement.bind(token, lockUntil, acquiredAt, acquiredAt).first();
  return row ? { ...row, lockToken: token } : null;
}

async function readJobChunk(db, job) {
  const row = await db.prepare(
    `SELECT urls_json AS urlsJson, url_count AS urlCount
       FROM manual_import_job_chunks
      WHERE job_id = ? AND chunk_index = ?`
  ).bind(job.jobId, job.nextChunk).first();
  if (!row) throw new Error(`Missing manual import chunk ${job.nextChunk}`);
  const urls = JSON.parse(String(row.urlsJson || '[]'));
  if (!Array.isArray(urls) || urls.length !== number(row.urlCount)) {
    throw new Error(`Invalid manual import chunk ${job.nextChunk}`);
  }
  return urls;
}

async function advanceJob(db, job, result, updatedAt) {
  const imported = number(result.imported);
  const inserted = number(result.inserted);
  const changed = number(result.changed);
  const row = await db.prepare(
    `UPDATE manual_import_jobs
        SET next_chunk = next_chunk + 1,
            imported_count = imported_count + ?,
            inserted_count = inserted_count + ?,
            changed_count = changed_count + ?,
            failure_count = 0,
            status = CASE
              WHEN next_chunk + 1 >= total_chunks AND changed_count + ? = 0 THEN 'completed'
              WHEN next_chunk + 1 >= total_chunks THEN 'finalizing'
              ELSE 'pending'
            END,
            combined_feed_count = CASE
              WHEN next_chunk + 1 >= total_chunks AND changed_count + ? = 0
                THEN COALESCE((SELECT row_count FROM playback_feed_state WHERE id = 1), 0)
              ELSE combined_feed_count
            END,
            updated_at = ?,
            completed_at = CASE
              WHEN next_chunk + 1 >= total_chunks AND changed_count + ? = 0 THEN ?
              ELSE completed_at
            END,
            last_error = NULL,
            lock_token = NULL,
            lock_until = NULL
      WHERE job_id = ? AND lock_token = ?
      RETURNING ${jobFields()}`
  ).bind(
    imported,
    inserted,
    changed,
    changed,
    changed,
    updatedAt,
    changed,
    updatedAt,
    job.jobId,
    job.lockToken
  ).first();
  if (!row) throw new Error('Manual import job lock was lost while advancing');
  if (row.status === 'completed') {
    await db.prepare(
      `DELETE FROM manual_import_job_chunks WHERE job_id = ?`
    ).bind(job.jobId).run();
  }
  return row;
}

async function releaseForRetry(db, job, error, updatedAt) {
  const row = await db.prepare(
    `UPDATE manual_import_jobs
        SET failure_count = failure_count + 1,
            status = CASE
              WHEN failure_count + 1 >= ? THEN 'failed'
              WHEN status = 'finalizing' THEN 'finalizing'
              ELSE 'pending'
            END,
            updated_at = ?,
            completed_at = CASE
              WHEN failure_count + 1 >= ? THEN ?
              ELSE completed_at
            END,
            last_error = ?,
            lock_token = NULL,
            lock_until = NULL
      WHERE job_id = ? AND lock_token = ?
      RETURNING status`
  ).bind(
    MAX_FAILURES,
    updatedAt,
    MAX_FAILURES,
    updatedAt,
    shortError(error),
    job.jobId,
    job.lockToken
  ).first();
  if (row?.status === 'failed') {
    await db.prepare(
      `DELETE FROM manual_import_job_chunks WHERE job_id = ?`
    ).bind(job.jobId).run();
  }
}

async function releaseBusyFinalization(db, job, updatedAt) {
  const row = await db.prepare(
    `UPDATE manual_import_jobs
        SET updated_at = ?,
            last_error = NULL,
            lock_token = NULL,
            lock_until = NULL
      WHERE job_id = ? AND lock_token = ? AND status = 'finalizing'
      RETURNING ${jobFields()}`
  ).bind(updatedAt, job.jobId, job.lockToken).first();
  if (!row) throw new Error('Manual import job lock was lost while deferring finalization');
  return row;
}

async function processJobChunk(env, job, updatedAt) {
  const urls = await readJobChunk(env.DB, job);
  let result;
  try {
    result = await persistMergedFeed(env, {
      sourceUrl: job.sourceUrl,
      method: 'manual-browser-import-chunk',
      collectionDurationMs: 0,
      urls,
      deferFeedMaintenance: true,
      details: {
        clicks: 0,
        elapsedMs: 0,
        importJobId: job.jobId,
        importChunk: number(job.nextChunk)
      }
    });
  } catch (error) {
    if (!/No valid video URLs/i.test(String(error?.message || error))) throw error;
    result = { imported: 0, inserted: 0, changed: 0 };
  }

  const advanced = await advanceJob(env.DB, job, result, updatedAt);
  return {
    ok: true,
    idle: false,
    processed: true,
    completed: advanced.status === 'completed',
    chunkIndex: number(job.nextChunk),
    ...jobSnapshot(advanced)
  };
}

async function finalFeedCount(env, job) {
  if (number(job.changedCount) > 0) return finalizeCompactedFeed(env);
  const state = await readFeedState(env.DB);
  return number(state?.rowCount);
}

async function finalizeJob(env, job, completedAt) {
  const combinedFeedCount = await finalFeedCount(env, job);
  const row = await env.DB.prepare(
    `UPDATE manual_import_jobs
        SET status = 'completed',
            failure_count = 0,
            combined_feed_count = ?,
            updated_at = ?,
            completed_at = ?,
            last_error = NULL,
            lock_token = NULL,
            lock_until = NULL
      WHERE job_id = ? AND lock_token = ?
      RETURNING ${jobFields()}`
  ).bind(
    combinedFeedCount,
    completedAt,
    completedAt,
    job.jobId,
    job.lockToken
  ).first();
  if (!row) throw new Error('Manual import job lock was lost while finalizing');
  await env.DB.prepare(
    `DELETE FROM manual_import_job_chunks WHERE job_id = ?`
  ).bind(job.jobId).run();
  return {
    ok: true,
    idle: false,
    processed: false,
    completed: true,
    ...jobSnapshot(row)
  };
}

export async function runManualImportJobChunk(env, options = {}) {
  const acquiredAt = isoNow(options.now);
  const job = await acquireJob(env.DB, {
    token: options.token,
    jobId: options.jobId,
    acquiredAt
  });
  if (!job) return { ok: true, idle: true, processed: false, completed: false };

  try {
    if (job.status === 'finalizing') {
      return await finalizeJob(env, job, acquiredAt);
    }
    return await processJobChunk(env, job, acquiredAt);
  } catch (error) {
    if (job.status === 'finalizing' && isPlaybackFeedFinalizationBusy(error)) {
      const deferred = await releaseBusyFinalization(env.DB, job, acquiredAt);
      return {
        ok: true,
        idle: false,
        processed: false,
        completed: false,
        deferred: true,
        ...jobSnapshot(deferred)
      };
    }
    await releaseForRetry(env.DB, job, error, acquiredAt).catch(() => {});
    throw error;
  }
}
