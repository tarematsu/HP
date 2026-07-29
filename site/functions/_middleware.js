import {
  API_BROWSER_TTL_SECONDS,
  MATERIALIZED_API_VARIANTS,
  apiCacheTtlSeconds,
  canonicalApiCacheRequest,
  edgeCacheableApiRequest,
  materializedApiKey,
} from './lib/api-contract.js';

const MATERIALIZED_RETRY_TTL_SECONDS = 30;
const MATERIALIZED_EDGE_TTL_MAX_SECONDS = 30 * 60;
const SUPPORTED_SHARED_VARY = new Set(['accept', 'accept-encoding']);
// The dashboard's live Pages handler reads the compact MINUTE_DB facts model and
// explicitly masks the legacy buddies DB. It is therefore safe to use as a
// narrow availability fallback when the runtime materialization service is down.
const LIVE_PAGES_FALLBACK_MODEL_KEYS = new Set(['dashboard']);
// The Pages service owns the storage choice. Compact payloads are read from
// KV and large payloads such as track-history are read from R2 there, so the
// gateway must not make a storage-specific decision before invoking it.
const SERVICE_MATERIALIZED_MODEL_KEYS = new Set(
  MATERIALIZED_API_VARIANTS.map(({ key }) => key),
);

function tagged(response, cacheState) {
  const clone = response.clone();
  const headers = new Headers(clone.headers);
  headers.set('x-edge-cache', cacheState);
  return new Response(clone.body, {
    status: clone.status,
    statusText: clone.statusText,
    headers,
  });
}

function withResponseHeader(response, name, value) {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serviceMaterializedResponse(context, modelKey) {
  const service = context.env?.PAGES_READ_MODEL_SERVICE;
  if (!SERVICE_MATERIALIZED_MODEL_KEYS.has(modelKey)) return null;
  if (typeof service?.fetch !== 'function') {
    throw new Error('PAGES_READ_MODEL_SERVICE binding is missing');
  }
  const url = new URL('https://pages-read-model.internal/_internal/pages-response');
  url.searchParams.set('key', modelKey);
  const response = await service.fetch(new Request(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
  }));
  if (!response?.ok) {
    throw new Error(`materialized ${modelKey} response returned HTTP ${response?.status || 503}`);
  }
  return response;
}

function responseCacheTtl(origin, requestedTtl, modelKey, usedMaterialized, now) {
  if (!usedMaterialized) {
    return modelKey ? MATERIALIZED_RETRY_TTL_SECONDS : requestedTtl;
  }
  const updatedAt = Number(origin.headers.get('x-materialized-at'));
  const cadenceSeconds = Number(origin.headers.get('x-materialized-cadence-seconds'));
  if (!Number.isFinite(updatedAt) || !Number.isFinite(cadenceSeconds) || cadenceSeconds <= 0) {
    return MATERIALIZED_RETRY_TTL_SECONDS;
  }
  const remainingSeconds = Math.floor((updatedAt + cadenceSeconds * 1000 - now) / 1000);
  if (remainingSeconds <= 0) return MATERIALIZED_RETRY_TTL_SECONDS;
  const materializedTtl = Math.min(MATERIALIZED_EDGE_TTL_MAX_SECONDS, cadenceSeconds);
  return Math.max(1, Math.min(Math.max(requestedTtl, materializedTtl), remainingSeconds));
}

function varyTokens(headers) {
  return (headers.get('vary') || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function cacheableOrigin(origin) {
  if (!origin?.ok) return false;
  if (origin.headers.has('set-cookie')) return false;
  const cacheControl = origin.headers.get('cache-control') || '';
  if (/\b(private|no-store|no-cache)\b/i.test(cacheControl)) return false;
  const vary = varyTokens(origin.headers);
  if (vary.includes('*') || vary.some((value) => !SUPPORTED_SHARED_VARY.has(value))) return false;
  const contentType = origin.headers.get('content-type') || '';
  return !contentType || /^application\/json(?:\s*;|$)/i.test(contentType);
}

function sharedResponse(origin, ttlSeconds) {
  const headers = new Headers(origin.headers);
  const cacheable = cacheableOrigin(origin);
  if (cacheable) {
    const browserTtl = Math.min(API_BROWSER_TTL_SECONDS, ttlSeconds);
    headers.set(
      'cache-control',
      `public, max-age=${browserTtl}, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`,
    );
  }
  const vary = new Set(varyTokens(headers));
  vary.add('accept-encoding');
  headers.set('vary', [...vary].join(', '));
  return { response: new Response(origin.body, {
    status: origin.status,
    statusText: origin.statusText,
    headers,
  }), cacheable };
}

function materializedUnavailable(modelKey) {
  return new Response(JSON.stringify({
    ok: false,
    error: 'materialized response unavailable',
    model_key: modelKey,
  }), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-materialized-required': '1',
    },
  });
}

export async function onRequest(context) {
  const { request } = context;
  if (!edgeCacheableApiRequest(request)) return context.next();

  const cache = caches.default;
  const cacheKey = canonicalApiCacheRequest(request);
  const hit = await cache.match(cacheKey);
  if (hit) return tagged(hit, 'HIT');

  const now = Date.now();
  const modelKey = materializedApiKey(new URL(request.url));
  let origin;
  let usedMaterialized = false;
  if (SERVICE_MATERIALIZED_MODEL_KEYS.has(modelKey)) {
    try {
      origin = await serviceMaterializedResponse(context, modelKey);
      usedMaterialized = true;
    } catch (error) {
      console.error(JSON.stringify({
        event: 'pages_materialized_response_unavailable',
        model_key: modelKey,
        error: String(error?.message || error).slice(0, 500),
      }));
      if (!LIVE_PAGES_FALLBACK_MODEL_KEYS.has(modelKey)) return materializedUnavailable(modelKey);

      try {
        origin = withResponseHeader(await context.next(), 'x-materialized-fallback', 'live-pages');
      } catch (fallbackError) {
        console.error(JSON.stringify({
          event: 'pages_live_fallback_unavailable',
          model_key: modelKey,
          error: String(fallbackError?.message || fallbackError).slice(0, 500),
        }));
        return materializedUnavailable(modelKey);
      }
    }
  } else {
    origin = await context.next();
  }
  const ttlSeconds = responseCacheTtl(
    origin,
    apiCacheTtlSeconds(request),
    modelKey,
    usedMaterialized,
    now,
  );
  const shared = sharedResponse(origin, ttlSeconds);
  if (shared.cacheable) context.waitUntil(cache.put(cacheKey, shared.response.clone()));
  return tagged(shared.response, shared.cacheable ? 'MISS' : 'BYPASS');
}
