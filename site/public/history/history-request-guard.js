const browser = typeof window === 'undefined' ? null : window;
const nativeFetch = browser?.fetch?.bind(browser) || null;
const HISTORY_CACHE_PREFIX = 'sh.history.v3:/api/history?';
const HISTORY_CACHE_MIGRATION_KEY = 'sh.history.r2-primary.v1';
const MATERIALIZED_HISTORY_MODES = new Set(['daily', 'weekly', 'monthly', 'broadcasts']);

function requestUrl(input) {
  try {
    const value = typeof input === 'string' || input instanceof URL ? input : input?.url;
    return new URL(value, browser?.location?.href || 'https://history.invalid/');
  } catch {
    return null;
  }
}

function requestWithUrl(input, url) {
  return typeof Request !== 'undefined' && input instanceof Request
    ? new Request(url.href, input)
    : url.href;
}

function responseWithHeaders(response, additionalHeaders = {}) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(additionalHeaders)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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

function materializedUnavailable(error) {
  return Response.json({
    ok: false,
    error: 'materialized history unavailable',
    detail: String(error?.message || error || '').slice(0, 300) || undefined,
  }, {
    status: 503,
    headers: {
      'cache-control': 'no-store',
      'x-history-read-path': 'r2-materialized-unavailable',
    },
  });
}

function rowDate(row, mode) {
  if (mode !== 'broadcasts') return String(row?.period_key || '');
  const value = Number(row?.started_at ?? row?.period_start);
  if (!Number.isFinite(value)) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function filterMaterializedHistory(data, mode, from, to) {
  if (!Array.isArray(data?.rows)) return data;
  const rows = data.rows.filter((row) => {
    const key = rowDate(row, mode);
    if (!key) return true;
    return (!from || key >= from) && (!to || key <= to);
  });
  return {
    ...data,
    from: from || data.from,
    to: to || data.to,
    rows,
    read_path: 'r2-materialized',
  };
}

async function fetchMaterializedHistory(input, init, requestedUrl) {
  const mode = String(requestedUrl.searchParams.get('mode') || 'weekly').trim().toLowerCase();
  if (!MATERIALIZED_HISTORY_MODES.has(mode)
      || (!requestedUrl.searchParams.has('from') && !requestedUrl.searchParams.has('to'))) {
    return null;
  }

  const materializedUrl = new URL(requestedUrl);
  materializedUrl.search = '';
  materializedUrl.searchParams.set('mode', mode);
  const version = requestedUrl.searchParams.get('v');
  if (version) materializedUrl.searchParams.set('v', version);

  try {
    const response = await nativeFetch(requestWithUrl(input, materializedUrl), init);
    if (!response.ok) {
      return responseWithHeaders(response, { 'x-history-read-path': 'r2-materialized-unavailable' });
    }
    const data = await response.clone().json();
    if (!data?.ok) {
      return jsonResponse(response, data, { 'x-history-read-path': 'r2-materialized-unavailable' });
    }
    const filtered = filterMaterializedHistory(
      data,
      mode,
      requestedUrl.searchParams.get('from') || '',
      requestedUrl.searchParams.get('to') || '',
    );
    return jsonResponse(response, filtered, { 'x-history-read-path': 'r2-materialized' });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return materializedUnavailable(error);
  }
}

function migrateHistorySessionCache() {
  const storage = browser?.sessionStorage;
  if (!storage || storage.getItem(HISTORY_CACHE_MIGRATION_KEY) === '1') return;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(HISTORY_CACHE_PREFIX)) storage.removeItem(key);
  }
  storage.setItem(HISTORY_CACHE_MIGRATION_KEY, '1');
}

async function guardedFetch(input, init) {
  const url = requestUrl(input);
  if (!url || url.origin !== browser.location.origin) return nativeFetch(input, init);

  if (url.pathname === '/api/history') {
    const materialized = await fetchMaterializedHistory(input, init, url);
    if (materialized) return materialized;
  }
  if (url.pathname === '/api/sakurazaka46jp') {
    url.searchParams.set('revision', '3');
  }
  return nativeFetch(requestWithUrl(input, url), init);
}

export function installHistoryRequestGuard() {
  if (!browser || !nativeFetch) return;
  for (let index = browser.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = browser.sessionStorage.key(index);
    if (key?.startsWith('sakurazaka46jp:v1:') || key?.startsWith('sakurazaka46jp:v2:')) {
      browser.sessionStorage.removeItem(key);
    }
  }

  migrateHistorySessionCache();
  browser.fetch = guardedFetch;
}

installHistoryRequestGuard();
