// HTTP readers must not import the SQL, merging and publication pipeline.
export const TRACK_HISTORY_DAY_MODEL_VERSION = 1;
const DAY_MODEL_PREFIX = 'track-history-days/v1/';

export function trackHistoryDayObjectKey(day, source = 'buddies') {
  const timestamp = Date.parse(`${String(day || '')}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new Error('invalid track-history day');
  const normalizedDay = new Date(timestamp).toISOString().slice(0, 10);
  const normalizedSource = String(source || 'buddies').trim().toLowerCase();
  if (normalizedSource === 'buddies') return `${DAY_MODEL_PREFIX}${normalizedDay}.json`;
  if (normalizedSource === 'ohisama') return `${DAY_MODEL_PREFIX}ohisama/${normalizedDay}.json`;
  throw new Error(`unsupported track-history source: ${source}`);
}

export async function loadTrackHistoryDayReadModel(r2, day, source = 'buddies') {
  const key = trackHistoryDayObjectKey(day, source);
  const object = await r2.get(key);
  if (!object) return null;
  const payload = typeof object.json === 'function'
    ? await object.json()
    : JSON.parse(await object.text());
  if (!payload) return null;
  if (Number(payload.version) !== TRACK_HISTORY_DAY_MODEL_VERSION
      || String(payload.day || '') !== String(day)
      || !Array.isArray(payload.rows)) {
    throw new Error(`track-history day read-model is invalid: ${key}`);
  }
  return { key, payload };
}
