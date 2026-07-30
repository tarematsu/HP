const browser = typeof window === 'undefined' ? null : window;
const previousFetch = browser?.fetch?.bind(browser) || null;
const DAILY_MODE = 'daily';
const HISTORY_CACHE_PREFIX = 'sh.history.v3:/api/history?';
const HISTORY_CACHE_TTL_MS = 30_000;
const DAILY_ONLY_MIGRATION_KEY = 'sh.history.daily-current-only.v1';

function requestUrl(input) {
  try {
    const value = typeof input === 'string' || input instanceof URL ? input : input?.url;
    return new URL(value, browser?.location?.href || 'https://history.invalid/');
  } catch {
    return null;
  }
}

function jsonResponse(response, data, additionalHeaders = {}) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json; charset=utf-8');
  for (const [name, value] of Object.entries(additionalHeaders)) headers.set(name, value);
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function currentUtcDay(now = Date.now()) {
  const key = new Date(now).toISOString().slice(0, 10);
  return { key, startDate: key, endDate: key };
}

function requestedRangeIncludesToday(url, day) {
  const from = String(url.searchParams.get('from') || '');
  const to = String(url.searchParams.get('to') || '');
  return (!from || from <= day.endDate) && (!to || to >= day.startDate);
}

function mergeCurrentRow(baseRows, liveRow, periodKey) {
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

async function fetchCurrentDailySummary(input, init) {
  const url = new URL('/api/history-current', browser.location.href);
  url.searchParams.set('mode', DAILY_MODE);
  const signal = init?.signal || (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
  return previousFetch(url.href, {
    signal,
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
}

async function overlayCurrentDaily(input, init, requestedUrl, baseResponse) {
  const mode = String(requestedUrl.searchParams.get('mode') || 'weekly').trim().toLowerCase();
  if (mode !== DAILY_MODE || !baseResponse.ok) return baseResponse;
  const day = currentUtcDay();
  if (!requestedRangeIncludesToday(requestedUrl, day)) return baseResponse;

  try {
    const [baseData, liveResponse] = await Promise.all([
      baseResponse.clone().json(),
      fetchCurrentDailySummary(input, init),
    ]);
    if (!baseData?.ok || !Array.isArray(baseData.rows) || !liveResponse.ok) return baseResponse;
    const liveData = await liveResponse.json();
    const liveRow = Array.isArray(liveData?.rows)
      ? liveData.rows.find((row) => String(row?.period_key || '') === day.key)
      : null;
    if (!liveData?.ok || !liveRow) return baseResponse;

    const readPath = `${baseData.read_path || 'history'}+minute-current-daily`;
    const data = {
      ...baseData,
      rows: mergeCurrentRow(baseData.rows, liveRow, day.key),
      live_overlay_count: 1,
      latest_live_observed_at: liveRow.period_end || null,
      live_source: 'minute_facts',
      read_path: readPath,
    };
    return jsonResponse(baseResponse, data, {
      'x-history-live-overlay': 'minute-current-daily',
      'x-history-read-path': readPath,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return baseResponse;
  }
}

function migrateHistoryCache() {
  const storage = browser?.sessionStorage;
  if (!storage || storage.getItem(DAILY_ONLY_MIGRATION_KEY) === '1') return;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(HISTORY_CACHE_PREFIX)) storage.removeItem(key);
  }
  storage.setItem(DAILY_ONLY_MIGRATION_KEY, '1');
}

function installDailyHistoryCacheFreshness() {
  const storage = browser?.sessionStorage;
  const prototype = storage && Object.getPrototypeOf(storage);
  if (!prototype || prototype.__shDailyHistoryCurrentCacheHook) return;
  const nativeGetItem = prototype.getItem;
  if (typeof nativeGetItem !== 'function') return;

  try {
    Object.defineProperty(prototype, '__shDailyHistoryCurrentCacheHook', { value: true });
    Object.defineProperty(prototype, 'getItem', {
      configurable: true,
      writable: true,
      value(key) {
        const raw = nativeGetItem.call(this, key);
        const textKey = String(key);
        if (this !== storage || !raw || !textKey.startsWith(HISTORY_CACHE_PREFIX) || !textKey.includes('mode=daily')) {
          return raw;
        }
        try {
          const cached = JSON.parse(raw);
          if (Date.now() - Number(cached?.at || 0) >= HISTORY_CACHE_TTL_MS) return null;
        } catch {}
        return raw;
      },
    });
  } catch {
    // Embedded browsers may expose a non-configurable Storage prototype.
  }
}

async function guardedFetch(input, init) {
  const url = requestUrl(input);
  const response = await previousFetch(input, init);
  if (!url || url.origin !== browser.location.origin || url.pathname !== '/api/history') return response;
  return overlayCurrentDaily(input, init, url, response);
}

export function installHistoryCurrentOverlay() {
  if (!browser || !previousFetch) return;
  migrateHistoryCache();
  installDailyHistoryCacheFreshness();
  browser.fetch = guardedFetch;
}

installHistoryCurrentOverlay();
