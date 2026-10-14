import { pagesResponseCacheKey, cacheablePagesResponse } from './pages-response-cache.js';
import {
  MATERIALIZED_API_VARIANTS,
  MUSIC_SERVICE_API_MODELS,
  materializedResponseMaximumAge,
} from '../../packages/sh-shared/api-contract.mjs';
import { STATIONHEAD_READ_MODEL_KEYS } from '../../packages/sh-shared/stationhead-read-models.mjs';
import { loadMaterializedResponse } from './pages-response-store.js';
import { normalizeFollowersResponse } from './stationhead-followers-response.js';

const EMPTY_DEPENDENCIES = Object.freeze({});
const INTERNAL_RESPONSE_PATH = '/_internal/pages-response';
const TRACK_HISTORY_MODEL_KEY = 'track-history';
const FOLLOWERS_MODEL_KEY = 'followers';

const DEFAULT_STALE_FALLBACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PRODUCER_EVENT_DRIVEN_R2_MODEL_KEYS = new Set([
  'apple-music',
  'apple-music-playlists',
  'amazon-music',
  'amazon-music-playlists',
  'spotify-playlists',
  'nogizaka-listening-party',
  'regional-music',
  FOLLOWERS_MODEL_KEY,
  'leaderboard',
]);
const PUBLIC_R2_MODEL_KEYS = new Set([
  ...MATERIALIZED_API_VARIANTS.map(({ key }) => key),
  ...PRODUCER_EVENT_DRIVEN_R2_MODEL_KEYS,
  ...Object.values(MUSIC_SERVICE_API_MODELS),
  ...Object.values(STATIONHEAD_READ_MODEL_KEYS),
  TRACK_HISTORY_MODEL_KEY,
]);

// Concurrent identical cold cache misses otherwise deserialize and assemble the
// same track-history R2 shards more than once. Keep this strictly in-flight:
// published models can change, and the edge cache owns completed responses.
const trackHistoryPendingByR2 = new WeakMap();
const MAX_INFLIGHT_HISTORY_QUERIES = 64;

async function loadTrackHistoryCoalesced(r2, dependencies, url, load) {
  // A binding is stable within a production isolate. Injected dependencies keep
  // independent test callers isolated when no R2 binding is supplied.
  const identity = r2 && typeof r2 === 'object' ? r2 : dependencies;
  let pending = trackHistoryPendingByR2.get(identity);
  if (!pending) {
    pending = new Map();
    trackHistoryPendingByR2.set(identity, pending);
  }
  const key = url.href;
  const existing = pending.get(key);
  if (existing) return (await existing).clone();
  const current = Promise.resolve().then(load);
  if (pending.size < MAX_INFLIGHT_HISTORY_QUERIES) pending.set(key, current);
  try {
    return await current;
  } finally {
    if (pending.get(key) === current) pending.delete(key);
  }
}

// Only explicitly injected test loaders can assemble history in HTTP. Production
// requires the 30s Durable Object even when its binding is absent or invalid.
async function loadTrackHistoryThroughCoordinator(env, request, dependencies, fallback) {
  if (typeof dependencies.loadTrackHistoryApiResponse === 'function') return fallback();
  const namespace = env?.PAGES_HISTORY_API_COORDINATOR;
  if (!namespace || typeof namespace.idFromName !== 'function'
      || typeof namespace.get !== 'function') {
    return new Response(null, { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' } });
  }
  const source = new URL(request.url).searchParams.get('source') || 'buddies';
  if (source !== 'buddies' && source !== 'ohisama') {
    return Response.json({ ok: false, error: 'invalid track-history source' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  try {
    const stub = namespace.get(namespace.idFromName(`history:${source}`));
    const response = await stub.fetch(request);
    if (response) return response;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'track_history_do_unavailable', source,
      error: String(error?.message || error).slice(0, 200),
    }));
  }
  return new Response(null, {
    status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' },
  });
}

function materializedStaleMaximumAge(env, freshMaximumAge) {
  const configured = Number(env?.PAGES_RESPONSE_STALE_MAX_AGE_MS);
  const staleMaximumAge = Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_STALE_FALLBACK_MAX_AGE_MS;
  return Math.max(Number(freshMaximumAge) || 0, staleMaximumAge);
}

function responseIsStale(response, now, maximumAge) {
  const rawUpdatedAt = response?.headers?.get('x-materialized-at');
  if (rawUpdatedAt == null || rawUpdatedAt === '') return false;
  const updatedAt = Number(rawUpdatedAt);
  const age = Number(maximumAge);
  return Number.isFinite(updatedAt)
    && updatedAt >= 0
    && Number.isFinite(age)
    && age >= 0
    && now - updatedAt > age;
}

function staleMaterializedResponse(response) {
  if (!response) return null;
  const headers = new Headers(response.headers);
  headers.set('x-materialized-stale', '1');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function loadCanonicalR2(env, modelKey, now, maximumAge, dependencies) {
  const loadR2 = dependencies.loadR2Response || loadMaterializedResponse;
  const staleMaximumAge = materializedStaleMaximumAge(env, maximumAge);
  const response = await loadR2(env?.PAGES_RESPONSE_R2, modelKey, now, staleMaximumAge);
  return responseIsStale(response, now, maximumAge)
    ? staleMaterializedResponse(response)
    : response;
}

// The account-level CPU metric records one invocation, not a model route.
// Emit a bounded, route-only diagnostic on slow HTTP reads (wall time is a
// correlate, not itself CPU time). Never emit raw query parameters or URLs.
export function logSlowPagesRead(modelKey, path, startedAt, now = Date.now(), api = false) {
  const elapsedMs = Math.max(0, Number(now) - Number(startedAt));
  if (elapsedMs < 10 || !PUBLIC_R2_MODEL_KEYS.has(modelKey)) return false;
  console.info(JSON.stringify({
    event: 'pages_response_slow_read', model_key: modelKey,
    api, read_path: path, elapsed_ms: elapsedMs,
  }));
  return true;
}

export async function runPagesResponseFetch(
  request,
  env,
  _contextOrDependencies = EMPTY_DEPENDENCIES,
  injectedDependencies = EMPTY_DEPENDENCIES,
) {
  const context = typeof _contextOrDependencies?.waitUntil === 'function'
    ? _contextOrDependencies : null;
  const dependencies = typeof _contextOrDependencies?.waitUntil === 'function'
    ? injectedDependencies
    : _contextOrDependencies;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== INTERNAL_RESPONSE_PATH) {
    return new Response(null, { status: 404 });
  }
  const params = url.searchParams;
  const modelKey = String(params.get('key') || '').trim();
  const isTrackHistoryApi = modelKey === TRACK_HISTORY_MODEL_KEY && params.get('api') === '1';
  if (!modelKey) return new Response(null, { status: 400 });
  const startedAt = Date.now();
  const now = dependencies.now?.() ?? startedAt;
  const maximumAge = PRODUCER_EVENT_DRIVEN_R2_MODEL_KEYS.has(modelKey)
    ? Number.MAX_SAFE_INTEGER
    : materializedResponseMaximumAge(modelKey, env);
  try {
    let response = null;
    if (isTrackHistoryApi) {
      const cache = dependencies.responseCache
        ?? (context && typeof caches !== 'undefined' ? caches.default : null);
      // This API already declares a five-minute public cache lifetime. Retain
      // the full query so source, range, limits and invalid parameters stay isolated.
      const cacheKey = cache
        ? new Request(`https://track-history-cache.internal/v1${url.pathname}${url.search}`)
        : null;
      if (cache) {
        const cached = await cache.match(cacheKey).catch(() => null);
        if (cached) {
          logSlowPagesRead(modelKey, 'track-history-edge-cache', startedAt, Date.now(), true);
          return cached;
        }
      }
      const loadTrackHistoryApi = async (...args) => {
        const run = dependencies.loadTrackHistoryApiResponse;
        return run(...args);
      };
      response = await loadTrackHistoryCoalesced(
        env?.PAGES_RESPONSE_R2, dependencies, url,
        () => loadTrackHistoryThroughCoordinator(env, request, dependencies, () => loadTrackHistoryApi(
          env?.PAGES_RESPONSE_R2,
          request,
          now,
          materializedStaleMaximumAge(env, maximumAge),
          dependencies.trackHistory || EMPTY_DEPENDENCIES,
        )),
      );
      if (cache && context && response?.ok) {
        context.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
      }
    } else if (PUBLIC_R2_MODEL_KEYS.has(modelKey)) {
      const cache = dependencies.responseCache
        ?? (context && typeof caches !== 'undefined' ? caches.default : null);
      const isHistoryRange = modelKey.startsWith('history:') && (params.has('from') || params.has('to'));
      const key = cache ? pagesResponseCacheKey(url) : null;
      if (cache) {
        const cached = await cache.match(key).catch(() => null);
        if (cached && !responseIsStale(cached, now, maximumAge)) {
          logSlowPagesRead(modelKey, 'canonical-edge-cache', startedAt);
          return cached;
        }
      }
      if (isHistoryRange && typeof env?.PAGES_HISTORY_API_COORDINATOR?.get === 'function'
          && typeof env.PAGES_HISTORY_API_COORDINATOR.idFromName === 'function') {
        const namespace = env.PAGES_HISTORY_API_COORDINATOR;
        response = await namespace.get(namespace.idFromName(modelKey)).fetch(request);
      } else if (isHistoryRange) {
        return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
      } else {
        response = await loadCanonicalR2(env, modelKey, now, maximumAge, dependencies);
      }
      if (modelKey === FOLLOWERS_MODEL_KEY) response = await normalizeFollowersResponse(response, now);
      if (cache && context) {
        const cacheResponse = cacheablePagesResponse(response, now, maximumAge);
        if (cacheResponse) context.waitUntil(cache.put(key, cacheResponse).catch(() => {}));
      }
    }
    // An HTTP 10 ms CPU breach can occur on a cache hit as well as a miss.
    // Distinguish those paths without logging content or arbitrary URLs.
    logSlowPagesRead(
      modelKey,
      isTrackHistoryApi
        ? (env?.PAGES_HISTORY_API_COORDINATOR ? 'track-history-do' : 'track-history-unavailable')
        : (modelKey.startsWith('history:') && (params.has('from') || params.has('to'))
          ? 'history-range-do' : 'canonical-r2'),
      startedAt,
      Date.now(),
      isTrackHistoryApi,
    );
    return response || new Response(null, {
      status: 404,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'pages_response_storage_read_failed',
      model_key: modelKey,
      error: String(error?.message || error).slice(0, 500),
    }));
    return new Response(null, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }
}

export default { fetch: runPagesResponseFetch };
