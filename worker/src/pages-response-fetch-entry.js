import { pagesResponseCacheKey, cacheablePagesResponse } from './pages-response-cache.js';
import {
  PUBLIC_R2_MODEL_KEYS,
  TRACK_HISTORY_MODEL_KEY,
  modelMaximumAge,
  materializedStaleMaximumAge,
  responseIsStale,
  staleMaterializedResponse,
} from './pages-response-models.js';

const EMPTY_DEPENDENCIES = Object.freeze({});
const INTERNAL_RESPONSE_PATH = '/_internal/pages-response';

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
  const maximumAge = modelMaximumAge(modelKey, env);
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
      if (typeof dependencies.loadR2Response === 'function' && !isHistoryRange) {
        // Explicit test injection; production never imports the envelope parser.
        response = await dependencies.loadR2Response(env?.PAGES_RESPONSE_R2, modelKey, now,
          materializedStaleMaximumAge(env, maximumAge));
        if (responseIsStale(response, now, maximumAge)) response = staleMaterializedResponse(response);
      } else if (typeof env?.PAGES_HISTORY_API_COORDINATOR?.get === 'function'
          && typeof env.PAGES_HISTORY_API_COORDINATOR.idFromName === 'function') {
        const namespace = env.PAGES_HISTORY_API_COORDINATOR;
        response = await namespace.get(namespace.idFromName(modelKey)).fetch(request);
      } else {
        return new Response(null, { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' } });
      }
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
          ? 'history-range-do' : 'canonical-do'),
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
