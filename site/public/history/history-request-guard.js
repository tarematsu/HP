const browser = typeof window === 'undefined' ? null : window;
const nativeFetch = browser?.fetch?.bind(browser) || null;
const HISTORY_CACHE_PREFIX = 'sh.history.v3:/api/history?';
const HISTORY_CACHE_MIGRATION_KEY = 'sh.history.server-range.v1';

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

function announceMaterializedAt(response) {
  const updatedAt = Number(response?.headers?.get('x-materialized-at'));
  if (!Number.isFinite(updatedAt) || updatedAt <= 0 || !browser) return;
  browser.dispatchEvent(new CustomEvent('history:materialized-at', {
    detail: { updatedAt },
  }));
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

  // Keep history from/to intact. Pages middleware applies the requested range
  // to the R2 materialized payload before it reaches the browser, avoiding a
  // full-history transfer and an extra parse/filter/stringify cycle here.
  if (url.pathname === '/api/sakurazaka46jp') {
    url.searchParams.set('revision', '3');
  }
  const response = await nativeFetch(requestWithUrl(input, url), init);
  if (url.pathname === '/api/history') announceMaterializedAt(response);
  return response;
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
