import {
  MATERIALIZED_API_VARIANTS,
  materializedResponseMaximumAge,
} from '../../site/functions/lib/api-contract.js';

const EMPTY_DEPENDENCIES = Object.freeze({});
const INTERNAL_RESPONSE_PATH = '/_internal/pages-response';
const TRACK_HISTORY_MODEL_KEY = 'track-history';
const DEFAULT_STALE_FALLBACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const R2_ONLY_MODEL_KEYS = new Set(
  MATERIALIZED_API_VARIANTS
    .map(({ key }) => key)
    .filter((key) => key !== 'dashboard'),
);

let responseR2ModulePromise;
let responseStoreModulePromise;

function loadResponseR2Module() {
  responseR2ModulePromise ||= import('./pages-response-r2.js');
  return responseR2ModulePromise;
}

function loadResponseStoreModule() {
  responseStoreModulePromise ||= import('./pages-response-store.js');
  return responseStoreModulePromise;
}

function edgeCache(dependencies) {
  return dependencies.cache || globalThis.caches?.default || null;
}

function edgeCacheKey(request, dependencies) {
  if (dependencies.cacheKey) return dependencies.cacheKey(request);
  return new Request(request.url, { method: 'GET' });
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
  const headers = new Headers(response.headers);
  headers.set('x-materialized-stale', '1');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function freshMaterializedResponse(response, now, maximumAge) {
  const updatedAt = Number(response?.headers?.get('x-materialized-at'));
  const age = Number(maximumAge);
  if (!Number.isFinite(updatedAt) || updatedAt < 0) return null;
  if (Number.isFinite(age) && age >= 0 && now - updatedAt > age) return null;
  const headers = new Headers(response.headers);
  headers.set('x-api-source', 'edge-cache');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function loadEdgeCachedResponse(cache, key, now, maximumAge) {
  if (!cache?.match) return null;
  try {
    return freshMaterializedResponse(await cache.match(key), now, maximumAge);
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'pages_response_edge_cache_read_failed',
      error: String(error?.message || error).slice(0, 300),
    }));
    return null;
  }
}

function cacheResponse(cache, key, response, context) {
  if (!cache?.put || !response?.headers?.get('x-materialized-at')) return null;
  const write = cache.put(key, response.clone()).catch((error) => {
    console.warn(JSON.stringify({
      event: 'pages_response_edge_cache_write_failed',
      error: String(error?.message || error).slice(0, 300),
    }));
  });
  if (context?.waitUntil) context.waitUntil(write);
  return context?.waitUntil ? null : write;
}

export async function runPagesResponseFetch(
  request,
  env,
  contextOrDependencies = EMPTY_DEPENDENCIES,
  injectedDependencies = EMPTY_DEPENDENCIES,
) {
  const context = typeof contextOrDependencies?.waitUntil === 'function'
    ? contextOrDependencies
    : null;
  const dependencies = context ? injectedDependencies : contextOrDependencies;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== INTERNAL_RESPONSE_PATH) {
    return new Response(null, { status: 404 });
  }
  const modelKey = String(url.searchParams.get('key') || '').trim();
  if (!modelKey) return new Response(null, { status: 400 });
  const now = dependencies.now?.() ?? Date.now();
  const maximumAge = materializedResponseMaximumAge(modelKey, env);
  const cache = edgeCache(dependencies);
  const cacheKey = edgeCacheKey(request, dependencies);
  try {
    const edgeResponse = await loadEdgeCachedResponse(cache, cacheKey, now, maximumAge);
    if (edgeResponse) return edgeResponse;

    let response;
    if (R2_ONLY_MODEL_KEYS.has(modelKey)) {
      const loadR2 = dependencies.loadR2Response
        || (await loadResponseR2Module()).loadMaterializedR2Response;
      const staleMaximumAge = materializedStaleMaximumAge(env, maximumAge);
      response = await loadR2(env?.PAGES_RESPONSE_R2, modelKey, now, staleMaximumAge);
      if (responseIsStale(response, now, maximumAge)) {
        response = staleMaterializedResponse(response);
      }
    } else if (modelKey === TRACK_HISTORY_MODEL_KEY) {
      const loadR2 = dependencies.loadR2Response
        || (await loadResponseR2Module()).loadMaterializedR2Response;
      response = await loadR2(env?.PAGES_RESPONSE_R2, modelKey, now, maximumAge);
      if (!response) {
        const loadKv = dependencies.loadResponse
          || (await loadResponseStoreModule()).loadMaterializedResponse;
        response = await loadKv(env?.PAGES_RESPONSE_KV, modelKey, now, maximumAge);
      }
    } else {
      const loadKv = dependencies.loadResponse
        || (await loadResponseStoreModule()).loadMaterializedResponse;
      response = await loadKv(env?.PAGES_RESPONSE_KV, modelKey, now, maximumAge);
      if (!response) {
        const loadR2 = dependencies.loadR2Response
          || (await loadResponseR2Module()).loadMaterializedR2Response;
        response = await loadR2(env?.PAGES_RESPONSE_R2, modelKey, now, maximumAge);
      }
    }
    if (response && response.headers.get('x-materialized-stale') !== '1') {
      await cacheResponse(cache, cacheKey, response, context);
    }
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
