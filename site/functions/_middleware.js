import {
  MATERIALIZED_API_VARIANTS,
  apiCacheTtlSeconds,
  edgeCacheableApiRequest,
  materializedApiKey,
} from './lib/api-contract.js';

const MATERIALIZED_RETRY_TTL_SECONDS = 30;
const MATERIALIZED_EDGE_TTL_MAX_SECONDS = 60;
const DASHBOARD_EDGE_TTL_MAX_SECONDS = 15;
const DASHBOARD_MODEL_KEY = 'dashboard';
const TRACK_HISTORY_MODEL_KEY = 'track-history';
const SUPPORTED_SHARED_VARY = new Set(['accept', 'accept-encoding']);
const SERVICE_MATERIALIZED_MODEL_KEYS = new Set([
  ...MATERIALIZED_API_VARIANTS.map(({ key }) => key),
  TRACK_HISTORY_MODEL_KEY,
]);

async function serviceMaterializedResponse(context, modelKey, publicRequest) {
  const service = context.env?.PAGES_READ_MODEL_SERVICE;
  if (!SERVICE_MATERIALIZED_MODEL_KEYS.has(modelKey)) return null;
  if (typeof service?.fetch !== 'function') throw new Error('PAGES_READ_MODEL_SERVICE binding is missing');
  const url = new URL('https://pages-read-model.internal/_internal/pages-response');
  url.searchParams.set('key', modelKey);
  if (modelKey === TRACK_HISTORY_MODEL_KEY || modelKey.startsWith('history:')) {
    if (modelKey === TRACK_HISTORY_MODEL_KEY) url.searchParams.set('api', '1');
    const publicUrl = new URL(publicRequest.url);
    for (const [name, value] of publicUrl.searchParams.entries()) {
      if (name === 'v' || name === 'key' || name === 'api') continue;
      url.searchParams.append(name, value);
    }
  }
  const response = await service.fetch(new Request(url, { method: 'GET', headers: { accept: 'application/json' } }));
  if (!response?.ok) {
    if (response && response.status >= 400 && response.status < 500) return response;
    throw new Error(`materialized ${modelKey} response returned HTTP ${response?.status || 503}`);
  }
  return response;
}

function responseCacheTtl(origin, requestedTtl, modelKey, usedMaterialized, now) {
  if (!usedMaterialized) return modelKey ? MATERIALIZED_RETRY_TTL_SECONDS : requestedTtl;
  const updatedAt = Number(origin.headers.get('x-materialized-at'));
  const cadenceSeconds = Number(origin.headers.get('x-materialized-cadence-seconds'));
  if (!Number.isFinite(updatedAt) || !Number.isFinite(cadenceSeconds) || cadenceSeconds <= 0) return MATERIALIZED_RETRY_TTL_SECONDS;
  const remainingSeconds = Math.floor((updatedAt + cadenceSeconds * 1000 - now) / 1000);
  if (remainingSeconds <= 0) return MATERIALIZED_RETRY_TTL_SECONDS;
  const edgeMaximum = modelKey === DASHBOARD_MODEL_KEY ? DASHBOARD_EDGE_TTL_MAX_SECONDS : MATERIALIZED_EDGE_TTL_MAX_SECONDS;
  return Math.max(1, Math.min(requestedTtl, edgeMaximum, cadenceSeconds, remainingSeconds));
}
function varyTokens(headers) {
  return (headers.get('vary') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
}
function cacheableOrigin(origin) {
  if (!origin?.ok || origin.headers.has('set-cookie')) return false;
  if (/\b(private|no-store|no-cache)\b/i.test(origin.headers.get('cache-control') || '')) return false;
  const vary = varyTokens(origin.headers);
  if (vary.includes('*') || vary.some((value) => !SUPPORTED_SHARED_VARY.has(value))) return false;
  const contentType = origin.headers.get('content-type') || '';
  return !contentType || /^application\/json(?:\s*;|$)/i.test(contentType);
}
function sharedResponse(origin, ttlSeconds) {
  const headers = new Headers(origin.headers);
  const cacheable = cacheableOrigin(origin);
  if (cacheable) {
    // Do not keep API payloads in the browser cache. Shared HTTP caches may use
    // the short TTL; the Worker/R2 object remains the sole application cache.
    headers.set('cache-control', `public, max-age=0, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`);
  }
  const vary = new Set(varyTokens(headers));
  vary.add('accept-encoding');
  headers.set('vary', [...vary].join(', '));
  headers.set('x-edge-cache', 'HTTP');
  return new Response(origin.body, { status: origin.status, statusText: origin.statusText, headers });
}
function materializedUnavailable(modelKey) {
  return new Response(JSON.stringify({ ok: false, error: 'materialized response unavailable', model_key: modelKey }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-materialized-required': '1' },
  });
}
function materializedModelKeyForRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  return pathname === '/api/track-history' ? TRACK_HISTORY_MODEL_KEY : materializedApiKey(url);
}

export async function onRequest(context) {
  const { request } = context;
  if (!edgeCacheableApiRequest(request)) return context.next();
  const now = Date.now();
  const modelKey = materializedModelKeyForRequest(request);

  let origin;
  let usedMaterialized = false;
  if (SERVICE_MATERIALIZED_MODEL_KEYS.has(modelKey)) {
    try {
      origin = await serviceMaterializedResponse(context, modelKey, request);
      usedMaterialized = true;
    } catch (error) {
      console.error(JSON.stringify({
        event: 'pages_materialized_response_unavailable',
        model_key: modelKey,
        error: String(error?.message || error).slice(0, 500),
      }));
      return materializedUnavailable(modelKey);
    }
  } else {
    origin = await context.next();
  }
  const ttlSeconds = responseCacheTtl(origin, apiCacheTtlSeconds(request), modelKey, usedMaterialized, now);
  return sharedResponse(origin, ttlSeconds);
}
