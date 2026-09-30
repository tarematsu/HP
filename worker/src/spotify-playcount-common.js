export const SPOTIFY_TOP20_RANKING_DATE = '2026-09-23';

export const SPOTIFY_CURRENT_TOP20_ARTISTS = Object.freeze([
  Object.freeze({ rank: 1, artist_key: 'equal-love', artist_name: '＝LOVE', spotify_artist_id: '1j2WhcTW00Zd2SjFYsJVc6' }),
  Object.freeze({ rank: 2, artist_key: 'akb48', artist_name: 'AKB48', spotify_artist_id: '01wau5CL3Z1vfJJWkzBkqg' }),
  Object.freeze({ rank: 3, artist_key: 'cutie-street', artist_name: 'CUTIE STREET', spotify_artist_id: '3PLCOySHJ9zwED5yZvDtPZ' }),
  Object.freeze({ rank: 4, artist_key: 'fruits-zipper', artist_name: 'FRUITS ZIPPER', spotify_artist_id: '4v5IVXt3oH0iNuxW9O36BV' }),
  Object.freeze({ rank: 5, artist_key: 'nogizaka46', artist_name: '乃木坂46', spotify_artist_id: '08lN7bm4Etec8ETFxaTUmq' }),
  Object.freeze({ rank: 6, artist_key: 'candy-tune', artist_name: 'CANDY TUNE', spotify_artist_id: '4Yq4M6kdQTjkPBOp7aPJrA' }),
  Object.freeze({ rank: 7, artist_key: 'ilife', artist_name: 'iLiFE!', spotify_artist_id: '539GTPlYhFLCL6eh4jnbYy' }),
  Object.freeze({ rank: 8, artist_key: 'niziu', artist_name: 'NiziU', spotify_artist_id: '3z8diLlUCkN1j9N9ZdnfBJ' }),
  Object.freeze({ rank: 9, artist_key: 'momoiro-clover-z', artist_name: 'ももいろクローバーZ', spotify_artist_id: '3Zl0EsuYV23OgNw6WqGelN' }),
  Object.freeze({ rank: 10, artist_key: 'phantom-siita', artist_name: 'ファントムシータ', spotify_artist_id: '6JO3HrRYUfSMbe71R7RUF2' }),
  Object.freeze({ rank: 11, artist_key: 'morning-musume', artist_name: 'モーニング娘。', spotify_artist_id: '4cDFYGC0CtsN86zvpCXsi4' }),
  Object.freeze({ rank: 12, artist_key: 'mei', artist_name: 'ME:I', spotify_artist_id: '0wsE3L0l083t6bxC8jJefC' }),
  Object.freeze({ rank: 13, artist_key: 'cho-tokimeki-sendenbu', artist_name: '超ときめき♡宣伝部', spotify_artist_id: '02hwDSWEF0JdOgdIBw1gRT' }),
  Object.freeze({ rank: 14, artist_key: 'not-equal-me', artist_name: '≠ME', spotify_artist_id: '3e3ubSlRDBFxokscDrbvpF' }),
  Object.freeze({ rank: 15, artist_key: 'juice-juice', artist_name: 'Juice=Juice', spotify_artist_id: '6ckfItpfxpSYKrZ0OIXUuh' }),
  Object.freeze({ rank: 16, artist_key: 'sakurazaka46', artist_name: '櫻坂46', spotify_artist_id: '0Ti7MfCiVVQAK8zLSiqlto' }),
  Object.freeze({ rank: 17, artist_key: 'piki', artist_name: 'PiKi', spotify_artist_id: '0k24bjTbB2IUhV74mvSv4T' }),
  Object.freeze({ rank: 18, artist_key: 'hinatazaka46', artist_name: '日向坂46', spotify_artist_id: '0eQSoTI7sQENREQM8Klp2j' }),
  Object.freeze({ rank: 19, artist_key: 'kyururin-tte-shitemite', artist_name: 'きゅるりんってしてみて', spotify_artist_id: '1tIFdPigPQapjr9pOEDP7d' }),
  Object.freeze({ rank: 20, artist_key: 'sweet-steady', artist_name: 'SWEET STEADY', spotify_artist_id: '1UyIqMBjk0DMexWtQF2X1i' }),
]);

export const SPOTIFY_ALWAYS_COLLECT_ARTISTS = Object.freeze([
  Object.freeze({
    artist_key: 'shiritsu-ebisu-chugaku',
    artist_name: '私立恵比寿中学',
    spotify_artist_id: '0hWvpmIrUgyPKOYvEGcERp',
  }),
  Object.freeze({
    artist_key: 'nearly-equal-joy',
    artist_name: '≒JOY',
    spotify_artist_id: '0CXdxGaAia8vQLHVRFXW8a',
  }),
  Object.freeze({
    artist_key: 'illit',
    artist_name: 'ILLIT',
    spotify_artist_id: '36cgvBn0aadzOijnjjwqMN',
  }),
]);

// Preserve the legacy three-group export for existing callers; collection scheduling uses
// the current Top 20, the additive ever-Top-20 database roster, and explicit always-collect artists.
const LEGACY_SAKAMICHI_KEYS = new Set(['nogizaka46', 'sakurazaka46', 'hinatazaka46']);
export const SPOTIFY_TARGET_ARTISTS = Object.freeze(
  SPOTIFY_CURRENT_TOP20_ARTISTS.filter((artist) => LEGACY_SAKAMICHI_KEYS.has(artist.artist_key)),
);
export const SPOTIFY_SESSION_SEED_ARTIST_ID = '0Ti7MfCiVVQAK8zLSiqlto';

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

// Keep this query limited to the original collection-run columns so already-running
// album queue work remains compatible during a migration/deploy overlap.
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
  return row?.run_token === message.run_token
    && ['catalog', 'queued'].includes(String(row?.status || ''));
}
