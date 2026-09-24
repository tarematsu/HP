const INDEX_VERSION = 1;
export const TRACK_HISTORY_DAY_INDEX_KEY = 'track-history-days/v1/index.json';

function validDay(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text;
}

function normalizeDates(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(String)
    .filter(validDay))].sort();
}

async function objectJson(object) {
  if (!object) return null;
  if (typeof object.json === 'function') return object.json();
  if (typeof object.text === 'function') return JSON.parse(await object.text());
  return null;
}

export async function loadTrackHistoryDayIndex(r2) {
  if (typeof r2?.get !== 'function') return null;
  const payload = await objectJson(await r2.get(TRACK_HISTORY_DAY_INDEX_KEY));
  if (!payload) return null;
  if (Number(payload.version) !== INDEX_VERSION) {
    throw new Error('track-history day index version is invalid');
  }
  const dates = normalizeDates(payload.dates);
  return {
    version: INDEX_VERSION,
    updated_at: Number(payload.updated_at) || 0,
    dates,
    latest_date: dates.at(-1) || null,
  };
}

export async function saveTrackHistoryDayIndex(r2, dates, updatedAt = Date.now()) {
  if (typeof r2?.put !== 'function') throw new Error('track-history R2 index binding is missing');
  const normalized = normalizeDates(dates);
  const payload = {
    version: INDEX_VERSION,
    updated_at: Number(updatedAt) || Date.now(),
    dates: normalized,
    latest_date: normalized.at(-1) || null,
  };
  await r2.put(TRACK_HISTORY_DAY_INDEX_KEY, JSON.stringify(payload), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return payload;
}

export async function updateTrackHistoryDayIndex(r2, day, hasRows, updatedAt = Date.now()) {
  if (!validDay(day)) throw new Error('track-history day index update has invalid day');
  const current = await loadTrackHistoryDayIndex(r2).catch(() => null);
  const dates = new Set(current?.dates || []);
  if (hasRows) dates.add(day);
  else dates.delete(day);
  return saveTrackHistoryDayIndex(
    r2,
    [...dates],
    Math.max(Number(current?.updated_at) || 0, Number(updatedAt) || Date.now()),
  );
}
