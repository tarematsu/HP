import { loadRanking } from '../lib/history-ranking.js';
import {
  SUMMARY_TABLES,
  combineSummaryRows,
  liveSummarySql,
  loadSummaryWithLive,
} from '../lib/history-summary.js';
import { isRealIsoDate } from '../lib/api-utils.js';
import {
  BROADCAST_READ_MODEL_SQL,
  BROADCAST_SUMMARY_SQL,
  loadBroadcastPayload,
  parseBroadcastSummaryRows,
} from '../../../packages/sh-shared/broadcast-history.mjs';

export { combineSummaryRows, liveSummarySql, loadSummaryWithLive };
export { BROADCAST_READ_MODEL_SQL, BROADCAST_SUMMARY_SQL, loadBroadcastPayload, parseBroadcastSummaryRows };

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
  vary: 'accept-encoding',
};
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
const HISTORY_CACHE_MAX = 32;
const historyLoadCache = new Map();

function rankingCacheKey(url) {
  const from = url.searchParams.get('from') || '2024-06-01';
  const to = url.searchParams.get('to') || todayUtcString();
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'featured';
  const host = String(url.searchParams.get('host') || '').trim().slice(0, 100).toLowerCase();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 5000, 20), 10000);
  return `ranking:v1:${from}:${to}:${scope}:${host}:${limit}`;
}

function promoteCacheEntry(key, entry) {
  historyLoadCache.delete(key);
  historyLoadCache.set(key, entry);
}

export async function cachedHistoryLoad(key, ttlMs, loader, now = Date.now()) {
  const cached = historyLoadCache.get(key);
  if (cached?.expiresAt > now && Object.hasOwn(cached, 'value')) {
    promoteCacheEntry(key, cached);
    return cached.value;
  }
  if (cached?.pending) {
    promoteCacheEntry(key, cached);
    return cached.pending;
  }

  const entry = cached || {};
  entry.pending = Promise.resolve().then(loader).then((value) => {
    entry.value = value;
    entry.expiresAt = Date.now() + ttlMs;
    return value;
  }).catch((error) => {
    historyLoadCache.delete(key);
    throw error;
  }).finally(() => { entry.pending = null; });
  promoteCacheEntry(key, entry);
  while (historyLoadCache.size > HISTORY_CACHE_MAX) historyLoadCache.delete(historyLoadCache.keys().next().value);
  return entry.pending;
}

export function resetHistoryLoadCache() {
  historyLoadCache.clear();
}

async function snapshotResponse(response) {
  return {
    body: await response.text(),
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
  };
}

function restoreResponse(snapshot) {
  return new Response(snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

export async function cachedLegacyHistoryResponse(key, ttlMs, loader) {
  try {
    const snapshot = await cachedHistoryLoad(key, ttlMs, async () => {
      const response = await loader();
      const value = await snapshotResponse(response);
      if (!response.ok) {
        const error = new Error(`history response ${response.status}`);
        error.responseSnapshot = value;
        throw error;
      }
      return value;
    });
    return restoreResponse(snapshot);
  } catch (error) {
    if (error?.responseSnapshot) return restoreResponse(error.responseSnapshot);
    throw error;
  }
}

const todayUtcString = () => new Date().toISOString().slice(0, 10);\n\nasync function loadBroadcasts(env, from, to) {
  const payload = await cachedHistoryLoad(
    `broadcasts:v10:${from}:${to}`,
    30000,
    () => loadBroadcastPayload(env, from, to),
  );
  return json(payload, 200, {
    'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
  });
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'DB binding missing' }, 500, { 'cache-control': 'no-store' });
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'weekly';
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const from = fromParam || '2024-06-01';
  const to = toParam || todayUtcString();
  try {
    if ((fromParam && !isRealIsoDate(fromParam)) || (toParam && !isRealIsoDate(toParam))) {
      return json({ ok: false, error: 'from and to must be valid YYYY-MM-DD dates' }, 400, {
        'cache-control': 'no-store',
      });
    }
    if (from > to) {
      return json({ ok: false, error: 'from must not be after to' }, 400, {
        'cache-control': 'no-store',
      });
    }
    if (Object.hasOwn(SUMMARY_TABLES, mode)) {
      const summary = await cachedHistoryLoad(
        `summary:v5:${mode}:${from}:${to}`,
        30000,
        () => loadSummaryWithLive(env, mode, from, to),
      );
      return json({ ok: true, mode, from, to, timezone: 'UTC', ...summary }, 200, {
        'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
      });
    }
    if (mode === 'ranking') {
      if (!env.OTHER_DB) return json({ ok: false, error: 'OTHER_DB binding missing' }, 500, { 'cache-control': 'no-store' });
      return cachedLegacyHistoryResponse(
        rankingCacheKey(url),
        30000,
        () => loadRanking(url, env, loadSummaryWithLive),
      );
    }
    if (mode === 'broadcasts') return loadBroadcasts(env, from, to);
    return json({ ok: false, error: `unsupported history mode: ${mode}` }, 400, { 'cache-control': 'no-store' });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'history error' }, 500, { 'cache-control': 'no-store' });
  }
}