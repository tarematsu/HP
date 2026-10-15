import { SPOTIFY_CHART_MODEL_KEYS } from '../../packages/sh-shared/spotify-charts.mjs';
import { PAGES_QUERY_MODEL_KEYS } from './pages-query-contract.js';
import {
  MATERIALIZED_API_VARIANTS,
  MUSIC_SERVICE_API_MODELS,
  materializedResponseMaximumAge,
} from '../../packages/sh-shared/api-contract.mjs';
import { STATIONHEAD_READ_MODEL_KEYS } from '../../packages/sh-shared/stationhead-read-models.mjs';

export const TRACK_HISTORY_MODEL_KEY = 'track-history';
export const FOLLOWERS_MODEL_KEY = 'followers';
const DEFAULT_STALE_FALLBACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PRODUCER_EVENT_DRIVEN_R2_MODEL_KEYS = new Set([
  ...SPOTIFY_CHART_MODEL_KEYS,
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
export const PUBLIC_R2_MODEL_KEYS = new Set([
  ...PAGES_QUERY_MODEL_KEYS,
  ...MATERIALIZED_API_VARIANTS.map(({ key }) => key),
  ...PRODUCER_EVENT_DRIVEN_R2_MODEL_KEYS,
  ...Object.values(MUSIC_SERVICE_API_MODELS),
  ...Object.values(STATIONHEAD_READ_MODEL_KEYS),
  TRACK_HISTORY_MODEL_KEY,
]);

export function materializedStaleMaximumAge(env, freshMaximumAge) {
  const configured = Number(env?.PAGES_RESPONSE_STALE_MAX_AGE_MS);
  const staleMaximumAge = Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_STALE_FALLBACK_MAX_AGE_MS;
  return Math.max(Number(freshMaximumAge) || 0, staleMaximumAge);
}

export function responseIsStale(response, now, maximumAge) {
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

export function staleMaterializedResponse(response) {
  if (!response) return null;
  const headers = new Headers(response.headers);
  headers.set('x-materialized-stale', '1');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function modelMaximumAge(modelKey, env) {
  return PRODUCER_EVENT_DRIVEN_R2_MODEL_KEYS.has(modelKey)
    ? Number.MAX_SAFE_INTEGER : materializedResponseMaximumAge(modelKey, env);
}
