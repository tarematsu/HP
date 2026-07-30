const browser = typeof window === 'undefined' ? null : window;
const previousFetch = browser?.fetch?.bind(browser) || null;
const SUMMARY_MODES = new Set(['daily', 'weekly', 'monthly']);
const HISTORY_CACHE_PREFIX = 'sh.history.v3:/api/history?';
const HISTORY_CACHE_TTL_MS = 30_000;

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

function currentPeriod(mode, now = Date.now()) {
  const date = new Date(now);
  const today = date.toISOString().slice(0, 10);
  if (mode === 'daily') return { key: today, startDate: today, endDate: today };
  if (mode === 'monthly') {
    const key = today.slice(0, 7);
    return { key, startDate: `${key}-01`, endDate: today };
  }
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return { key: monday.toISOString().slice(0, 10), startDate: monday.toISOString().slice(0, 10), endDate: today };
}

function requestedRangeIncludesCurrent(url, period) {
  const from = String(url.searchParams.get('from') || '');
  const to = String(url.searchParams.get('to') || '');
  return (!from || from <= period.endDate) && (!to || to >= period.startDate);
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

async function fetchCurrentSummary(mode, input, init) {
  const url = new URL('/api/history-current', browser.location.href);
  url.searchParams.set('mode', mode);
  const signal = init?.signal || (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
  return previousFetch(url.href, {
    signal,
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
}

async function overlayCurrentSummary(input, init, requestedUrl, baseResponse) {
  const mode = String(requestedUrl.searchParams.get('mode') || 'weekly').trim().toLowerCase();
  if (!SUMMARY_MODES.has(mode) || !baseResponse.ok) return baseResponse;
  const period = currentPeriod(mode);
  if (!requestedRangeIncludesCurrent(requestedUrl, period)) return baseResponse;

  try {
    const [baseData, liveResponse] = await Promise.all([
      baseResponse.clone().json(),
      fetchCurrentSummary(mode, input, init),
    ]);
    if (!baseData?.ok || !Array.isArray(baseData.rows) || !liveResponse.ok) return baseResponse;
    const liveData = await liveResponse.json();
    const liveRow = Array.isArray(liveData?.rows)
      ? liveData.rows.find((row) => String(row?.period_key || '') === period.key)
      : null;
    if (!liveData?.ok || !liveRow) return baseResponse;

    const readPath = `${baseData.read_path || 'history'}+minute-current`;
    const data = {
      ...baseData,
      rows: mergeCurrentRow(baseData.rows, liveRow, period.key),
      live_overlay_count: 1,
      latest_live_observed_at: liveRow.period_end || null,
      live_source: 'minute_facts',
      read_path: readPath,
    };
    return jsonResponse(baseResponse, data, {
      'x-history-live-overlay': 'minute-current',
      'x-history-read-path': readPath,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return baseResponse;
  }
}

function installHistoryCacheFreshness() {
  const storage = browser?.sessionStorage;
  const prototype = storage && Object.getPrototypeOf(storage);
  if (!prototype || prototype.__shHistoryCurrentCacheHook) return;
  const nativeGetItem = prototype.getItem;
  if (typeof nativeGetItem !== 'function') return;

  try {
    Object.defineProperty(prototype, '__shHistoryCurrentCacheHook', { value: true });
    Object.defineProperty(prototype, 'getItem', {
      configurable: true,
      writable: true,
      value(key) {
        const raw = nativeGetItem.call(this, key);
        if (this !== storage || !raw || !String(key).startsWith(HISTORY_CACHE_PREFIX)) return raw;
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
  return overlayCurrentSummary(input, init, url, response);
}

export function installHistoryCurrentOverlay() {
  if (!browser || !previousFetch) return;
  installHistoryCacheFreshness();
  browser.fetch = guardedFetch;
}

installHistoryCurrentOverlay();
