const HISTORY_CACHE_PREFIX = 'sh.history.v3:/api/history?';
const HISTORY_CACHE_MIGRATION_KEY = 'sh.history.direct-fetch.v1';
const DAILY_MODE = 'daily';

export const DAILY_HISTORY_CACHE_TTL_MS = 30_000;
export const DEFAULT_HISTORY_CACHE_TTL_MS = 5 * 60_000;
export const BROADCAST_HISTORY_CACHE_TTL_MS = 15 * 60_000;

export function historyCacheTtl(mode) {
  if (mode === DAILY_MODE) return DAILY_HISTORY_CACHE_TTL_MS;
  if (mode === 'broadcasts') return BROADCAST_HISTORY_CACHE_TTL_MS;
  return DEFAULT_HISTORY_CACHE_TTL_MS;
}

export function currentUtcDay(now = Date.now()) {
  const key = new Date(now).toISOString().slice(0, 10);
  return { key, startDate: key, endDate: key };
}

export function requestedRangeIncludesToday(url, day) {
  const from = String(url.searchParams.get('from') || '');
  const to = String(url.searchParams.get('to') || '');
  return (!from || from <= day.endDate) && (!to || to >= day.startDate);
}

export function mergeCurrentRow(baseRows, liveRow, periodKey) {
  const rows = Array.isArray(baseRows) ? baseRows : [];
  const existing = rows.find((row) => String(row?.period_key || '') === periodKey) || null;
  const merged = {
    ...(existing || {}),
    ...liveRow,
    primary_host: liveRow?.primary_host || existing?.primary_host || null,
    likes_max: liveRow?.likes_max ?? existing?.likes_max ?? null,
    distinct_tracks: liveRow?.distinct_tracks ?? existing?.distinct_tracks ?? null,
    live_overlay: true,
  };
  return [
    ...rows.filter((row) => String(row?.period_key || '') !== periodKey),
    merged,
  ].sort((left, right) => String(left?.period_key || '').localeCompare(String(right?.period_key || '')));
}

export function migrateHistoryCache(storage = globalThis.sessionStorage) {
  if (!storage || storage.getItem(HISTORY_CACHE_MIGRATION_KEY) === '1') return;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(HISTORY_CACHE_PREFIX)) storage.removeItem(key);
  }
  storage.setItem(HISTORY_CACHE_MIGRATION_KEY, '1');
}

function requestUrl(value) {
  const base = globalThis.location?.href || 'https://history.invalid/';
  return new URL(value, base);
}

async function overlayCurrentDaily(url, baseData, { signal, fetchImpl, now }) {
  const mode = String(url.searchParams.get('mode') || 'weekly').trim().toLowerCase();
  if (mode !== DAILY_MODE || !baseData?.ok || !Array.isArray(baseData.rows)) return baseData;

  const day = currentUtcDay(now);
  if (!requestedRangeIncludesToday(url, day)) return baseData;

  try {
    const liveUrl = new URL('/api/history-current?mode=daily', url);
    const liveResponse = await fetchImpl(liveUrl.href, {
      signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!liveResponse.ok) return baseData;
    const liveData = await liveResponse.json();
    const liveRow = Array.isArray(liveData?.rows)
      ? liveData.rows.find((row) => String(row?.period_key || '') === day.key)
      : null;
    if (!liveData?.ok || !liveRow) return baseData;

    return {
      ...baseData,
      rows: mergeCurrentRow(baseData.rows, liveRow, day.key),
      live_overlay_count: 1,
      latest_live_observed_at: liveRow.period_end || null,
      live_source: 'minute_facts',
      read_path: `${baseData.read_path || 'history'}+minute-current-daily`,
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return baseData;
  }
}

export async function fetchHistoryPayload(url, {
  signal,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  now = Date.now(),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch unavailable');
  const requestedUrl = requestUrl(url);
  const response = await fetchImpl(requestedUrl.href, {
    signal,
    headers: { accept: 'application/json' },
  });
  const data = await response.json();
  if (!response.ok || !data?.ok) throw new Error(data?.error || `API ${response.status}`);
  return overlayCurrentDaily(requestedUrl, data, { signal, fetchImpl, now });
}
