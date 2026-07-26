import {
  normalizeTrackRows,
  summarizeCompleteTrackRows,
} from './history-track-view.js';

const browser = typeof window === 'undefined' ? null : window;
const nativeFetch = browser?.fetch?.bind(browser) || null;
const integer = new Intl.NumberFormat('ja-JP');
const TRACK_CACHE_PREFIX = 'sh.history.v3:/api/track-history?';
let trackRows = [];
let summaryFrame = 0;

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

function setText(id, value) {
  const node = browser?.document?.getElementById(id);
  if (node && node.textContent !== value) node.textContent = value;
}

function applyTrackSummary() {
  summaryFrame = 0;
  if (browser?.location?.hash !== '#tracks') return;
  const summary = summarizeCompleteTrackRows(trackRows);
  setText('periodLabel', '有効日数');
  setText('maxLabel', '総再生回数');
  setText('streamLabel', '曲数');
  setText('memberLabel', '1曲の最多');
  setText('periods', integer.format(summary.days));
  setText('maxListener', summary.days ? integer.format(summary.total) : '—');
  setText('streamGrowth', summary.days ? integer.format(summary.tracks) : '—');
  setText('memberGrowth', summary.maximum ? `${integer.format(summary.maximum)}回` : '—');
}

function scheduleTrackSummary() {
  if (summaryFrame || !browser?.requestAnimationFrame) return;
  summaryFrame = browser.requestAnimationFrame(applyTrackSummary);
}

function normalizeTrackPayload(data) {
  if (data?.mode !== 'tracks' || !Array.isArray(data.rows)) return data;
  const rows = normalizeTrackRows(data.rows);
  trackRows = rows;
  browser?.dispatchEvent(new CustomEvent('history:track-rows', { detail: { rows } }));
  scheduleTrackSummary();
  return { ...data, rows };
}

function jsonResponse(response, data) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function installSessionCacheHook() {
  const storage = browser?.sessionStorage;
  const prototype = storage && Object.getPrototypeOf(storage);
  if (!prototype || prototype.__shTrackHistoryCacheHook) return;
  const nativeGetItem = prototype.getItem;
  if (typeof nativeGetItem !== 'function') return;

  try {
    Object.defineProperty(prototype, '__shTrackHistoryCacheHook', { value: true });
    Object.defineProperty(prototype, 'getItem', {
      configurable: true,
      writable: true,
      value(key) {
        const raw = nativeGetItem.call(this, key);
        if (this !== storage || !raw || !String(key).startsWith(TRACK_CACHE_PREFIX)) return raw;
        try {
          const cached = JSON.parse(raw);
          const data = normalizeTrackPayload(cached?.data);
          return data === cached?.data ? raw : JSON.stringify({ ...cached, data });
        } catch {
          return raw;
        }
      },
    });
  } catch {
    // Some embedded browsers expose a non-configurable Storage prototype.
  }
}

async function guardedFetch(input, init) {
  const url = requestUrl(input);
  if (!url || url.origin !== browser.location.origin) return nativeFetch(input, init);

  if (url.pathname === '/api/track-history' && url.searchParams.get('latest') !== '1') {
    url.searchParams.set('ranking', '0');
  }
  if (url.pathname === '/api/sakurazaka46jp') {
    url.searchParams.set('revision', '3');
  }

  const response = await nativeFetch(requestWithUrl(input, url), init);
  if (url.pathname !== '/api/track-history' || !response.ok || url.searchParams.get('latest') === '1') {
    return response;
  }
  try {
    const data = normalizeTrackPayload(await response.clone().json());
    return jsonResponse(response, data);
  } catch {
    return response;
  }
}

export function installHistoryRequestGuard() {
  if (!browser || !nativeFetch) return;
  for (let index = browser.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = browser.sessionStorage.key(index);
    if (key?.startsWith('sakurazaka46jp:v1:') || key?.startsWith('sakurazaka46jp:v2:')) {
      browser.sessionStorage.removeItem(key);
    }
  }

  installSessionCacheHook();
  browser.fetch = guardedFetch;
  browser.addEventListener('hashchange', scheduleTrackSummary);
}

installHistoryRequestGuard();
