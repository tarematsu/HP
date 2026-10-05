import {
  MATERIALIZED_API_VARIANTS,
  materializedResponseMaximumAge,
} from '../../site/functions/lib/api-contract.js';
import { loadMaterializedR2Response } from './pages-response-r2.js';

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
  TRACK_HISTORY_MODEL_KEY,
]);

let trackHistoryApiModulePromise;
function loadTrackHistoryApiModule() {
  trackHistoryApiModulePromise ||= import('./pages-track-history-r2-api.js');
  return trackHistoryApiModulePromise;
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
  return Number.isFinite(updatedAt) && updatedAt >= 0 && Number.isFinite(age) && age >= 0 && now - updatedAt > age;
}
function staleMaterializedResponse(response) {
  if (!response) return null;
  const headers = new Headers(response.headers);
  headers.set('x-materialized-stale', '1');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
async function loadCanonicalR2(env, modelKey, now, maximumAge, dependencies) {
  const loadR2 = dependencies.loadR2Response || loadMaterializedR2Response;
  const staleMaximumAge = materializedStaleMaximumAge(env, maximumAge);
  const response = await loadR2(env?.PAGES_RESPONSE_R2, modelKey, now, staleMaximumAge);
  return responseIsStale(response, now, maximumAge) ? staleMaterializedResponse(response) : response;
}

export async function runPagesResponseFetch(
  request,
  env,
  _contextOrDependencies = EMPTY_DEPENDENCIES,
  injectedDependencies = EMPTY_DEPENDENCIES,
) {
  const dependencies = typeof _contextOrDependencies?.waitUntil === 'function'
    ? injectedDependencies
    : _contextOrDependencies;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== INTERNAL_RESPONSE_PATH) return new Response(null, { status: 404 });
  const modelKey = String(url.searchParams.get('key') || '').trim();
  if (!modelKey) return new Response(null, { status: 400 });
  const now = dependencies.now?.() ?? Date.now();
  const maximumAge = PRODUCER_EVENT_DRIVEN_R2_MODEL_KEYS.has(modelKey)
    ? Number.MAX_SAFE_INTEGER
    : materializedResponseMaximumAge(modelKey, env);
  try {
    let response = null;
    if (modelKey === TRACK_HISTORY_MODEL_KEY && url.searchParams.get('api') === '1') {
      const loadTrackHistoryApi = dependencies.loadTrackHistoryApiResponse
        || (await loadTrackHistoryApiModule()).loadTrackHistoryR2ApiResponse;
      response = await loadTrackHistoryApi(
        env?.PAGES_RESPONSE_R2,
        request,
        now,
        materializedStaleMaximumAge(env, maximumAge),
        dependencies.trackHistory || EMPTY_DEPENDENCIES,
      );
    } else if (PUBLIC_R2_MODEL_KEYS.has(modelKey)) {
      response = await loadCanonicalR2(env, modelKey, now, maximumAge, dependencies);
    }
    return response || new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'pages_response_storage_read_failed',
      model_key: modelKey,
      error: String(error?.message || error).slice(0, 500),
    }));
    return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

export default { fetch: runPagesResponseFetch };
