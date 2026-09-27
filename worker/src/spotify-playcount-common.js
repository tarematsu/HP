export const SPOTIFY_TARGET_ARTISTS = Object.freeze([
  Object.freeze({ artist_key: 'nogizaka46', artist_name: '乃木坂46', spotify_artist_id: '08lN7bm4Etec8ETFxaTUmq' }),
  Object.freeze({ artist_key: 'sakurazaka46', artist_name: '櫻坂46', spotify_artist_id: '0Ti7MfCiVVQAK8zLSiqlto' }),
  Object.freeze({ artist_key: 'hinatazaka46', artist_name: '日向坂46', spotify_artist_id: '0eQSoTI7sQENREQM8Klp2j' }),
]);

export const FIRST_CHECK_HOUR_JST = 5;
export const STUCK_ATTEMPT_MS = 50 * 60 * 1000;
export const D1_BATCH_SIZE = 75;
export const QUEUE_BATCH_SIZE = 100;

export function enabled(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

export function integer(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function safeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function truncateError(error, maxLength = 1000) {
  const text = error instanceof Error ? error.message : String(error ?? 'unknown error');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function resultsOf(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

export function logEvent(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

export function jstDateKey(timestamp = Date.now()) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) throw new TypeError('timestamp must be finite');
  return new Date(value + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function jstHour(timestamp = Date.now()) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) throw new TypeError('timestamp must be finite');
  return new Date(value + 9 * 60 * 60 * 1000).getUTCHours();
}

export function previousDateKey(snapshotDate) {
  const date = new Date(`${snapshotDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new TypeError('snapshotDate must be YYYY-MM-DD');
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function batchStatements(db, statements, size = D1_BATCH_SIZE) {
  if (!statements.length) return;
  for (let offset = 0; offset < statements.length; offset += size) {
    await db.batch(statements.slice(offset, offset + size));
  }
}

export async function readRun(db, snapshotDate) {
  return db.prepare(`SELECT
      snapshot_date,status,attempt_no,run_token,albums_queued,albums_completed,
      tracks_collected,errors,started_at,attempt_started_at,completed_at,updated_at,last_error
    FROM sh_spotify_collection_runs
    WHERE snapshot_date=?`)
    .bind(snapshotDate)
    .first();
}

export function shouldRetryRun(run, now = Date.now()) {
  if (!run) return true;
  if (run.status === 'complete') return false;
  if (!['catalog', 'queued'].includes(String(run.status))) return true;
  const updatedAt = Number(run.updated_at);
  return !Number.isFinite(updatedAt) || now - updatedAt >= STUCK_ATTEMPT_MS;
}

export async function activeRunMatches(db, message) {
  const row = await db.prepare(`SELECT run_token,status
    FROM sh_spotify_collection_runs WHERE snapshot_date=?`)
    .bind(message.snapshot_date)
    .first();
  return row?.run_token === message.run_token && row?.status !== 'complete';
}
