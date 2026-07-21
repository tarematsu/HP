const DAY_MS = 86400000;
const RUN_RETENTION_MS = 30 * DAY_MS;
const FEED_FINALIZATION_LOCK_PREFIX = 'finalizing:';
const PLAYBACK_FEED_BUSY_CODE = 'PLAYBACK_FEED_BUSY';
const DEFAULT_FEED_LOCK_TTL_MS = 10 * 60_000;

function positiveDuration(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function playbackFeedBusyError() {
  const error = new Error('Playback feed finalization is busy');
  error.code = PLAYBACK_FEED_BUSY_CODE;
  return error;
}

export function isPlaybackFeedFinalizationBusy(error) {
  return error?.code === PLAYBACK_FEED_BUSY_CODE;
}

export function ensureD1Compaction() {
  return undefined;
}

export async function maybeCleanupCollectionRuns(db, now = Date.now()) {
  const result = await db.prepare(
    `UPDATE d1_maintenance_state SET last_cleanup_at=?
      WHERE id=1 AND last_cleanup_at<=?`
  ).bind(now, now - DAY_MS).run();
  if (!Number(result?.meta?.changes || 0)) return false;
  await db.prepare('DELETE FROM collection_runs WHERE started_at<?')
    .bind(new Date(now - RUN_RETENTION_MS).toISOString()).run();
  return true;
}

export function prepareFeedStateRead(db) {
  return db.prepare(
    `SELECT content_hash AS contentHash,
            row_count AS rowCount,
            version,
            updated_at AS updatedAt
       FROM playback_feed_state
      WHERE id=1`
  );
}

export async function readFeedState(db) {
  return prepareFeedStateRead(db).first();
}

export async function writeFeedState(db, contentHash, rowCount, updatedAt) {
  const result = await db.prepare(
    `UPDATE playback_feed_state
        SET content_hash=?,row_count=?,version=version+1,updated_at=?
      WHERE id=1
        AND (content_hash IS NOT ? OR row_count <> ?)`
  ).bind(contentHash, rowCount, updatedAt, contentHash, rowCount).run();
  return Number(result?.meta?.changes || 0) > 0;
}

async function acquirePlaybackFeedFinalization(db, options = {}) {
  const ttlMs = positiveDuration(options.ttlMs, DEFAULT_FEED_LOCK_TTL_MS);
  const token = `${FEED_FINALIZATION_LOCK_PREFIX}${crypto.randomUUID()}`;
  const now = Date.now();
  const lockedAt = new Date(now).toISOString();
  const staleBefore = new Date(now - ttlMs).toISOString();
  const row = await db.prepare(
    `UPDATE playback_feed_state
        SET content_hash=?, version=version+1, updated_at=?
      WHERE id=1
        AND (
          content_hash IS NULL
          OR content_hash NOT LIKE ?
          OR updated_at IS NULL
          OR updated_at<=?
        )
      RETURNING content_hash AS contentHash`
  ).bind(
    token,
    lockedAt,
    `${FEED_FINALIZATION_LOCK_PREFIX}%`,
    staleBefore
  ).first();

  if (row?.contentHash !== token) throw playbackFeedBusyError();
  return token;
}

async function commitPlaybackFeedFinalization(db, token, outcome) {
  const rowCount = Math.max(0, Number(outcome?.rowCount || 0));
  const contentHash = String(outcome?.contentHash || '');
  const updatedAt = String(outcome?.updatedAt || new Date().toISOString());
  const result = await db.prepare(
    `UPDATE playback_feed_state
        SET content_hash=?, row_count=?, version=version+1, updated_at=?
      WHERE id=1 AND content_hash=?`
  ).bind(contentHash, rowCount, updatedAt, token).run();
  if (Number(result?.meta?.changes || 0) === 0) {
    throw new Error('Playback feed finalization lock was lost');
  }
  return outcome?.value ?? rowCount;
}

async function abandonPlaybackFeedFinalization(db, token) {
  await db.prepare(
    `UPDATE playback_feed_state
        SET content_hash=NULL, version=version+1, updated_at=?
      WHERE id=1 AND content_hash=?`
  ).bind(new Date().toISOString(), token).run();
}

export async function withPlaybackFeedFinalization(db, task, options = {}) {
  const token = await acquirePlaybackFeedFinalization(db, options);
  try {
    const outcome = await task();
    return await commitPlaybackFeedFinalization(db, token, outcome);
  } catch (error) {
    await abandonPlaybackFeedFinalization(db, token).catch((releaseError) => {
      console.error('playback-feed-finalization-lock-release-failed', {
        error: String(releaseError?.message || releaseError)
      });
    });
    throw error;
  }
}

function feedIdValue(row) {
  const value = row?.videoId ?? row?.id;
  return value == null ? '' : String(value);
}

export async function feedContentHash(rows) {
  const value = JSON.stringify((rows || []).map(feedIdValue));
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
}
