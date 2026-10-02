export const API_CONTRACT_VERSION = 20;

export const REGIONAL_MUSIC_API_SERVICES = Object.freeze([
  'youtube_music',
  'genie',
  'bugs',
  'joox',
  'nhaccuatui',
  'anghami',
  'melon',
  'kkbox',
  'qq_music',
  'netease_cloud_music',
  'kugou_music',
  'naver_vibe',
  'flo',
  'yandex_music',
  'boomplay',
  'plern',
  'fungjai',
  'zing_mp3',
  'jiosaavn',
  'gaana',
  'langit_musik',
]);

const regionalMusicApiServices = new Set(REGIONAL_MUSIC_API_SERVICES);

export const API_GROUPS = Object.freeze({
  status: Object.freeze([
    { path: '/api/health', methods: ['GET'], description: 'Unified collector, minute pipeline, runtime, and Sakurazaka health' },
    { path: '/api/sakurazaka46jp-status', methods: ['GET'], description: 'Latest Sakurazaka Stationhead per-minute raw collection status' },
    { path: '/api/nogizaka46smej-status', methods: ['GET'], description: 'Latest Nogizaka official Stationhead per-minute collection status' },
  ]),
  dashboard: Object.freeze([
    { path: '/api/dashboard', methods: ['GET'], description: 'Current state and queue optimized for first paint' },
    { path: '/api/dashboard-details', methods: ['GET'], description: 'Deferred current history, chart comparison data, and completed daily summaries' },
    { path: '/api/hinata', methods: ['GET'], description: 'Materialized ohisama current metrics, 24-hour chart history, and daily summaries' },
  ]),
  history: Object.freeze([
    { path: '/api/history', methods: ['GET'], description: 'Daily, weekly, monthly, ranking, and broadcast history modes' },
    { path: '/api/history-current', methods: ['GET'], description: 'Current UTC daily summary from the incremental minute projection' },
    { path: '/api/track-history', methods: ['GET'], description: 'Stored track history and current like ranking' },
    { path: '/api/sakurazaka46jp', methods: ['GET'], description: 'Sakurazaka official broadcast listener series' },
    { path: '/api/nogizaka-listening-party', methods: ['GET'], description: 'Today Nogizaka official listening-party listener series and summary' },
    { path: '/api/host-history', methods: ['GET'], description: 'Sakurazaka broadcast sessions and session details' },
    { path: '/api/first-week-comparison', methods: ['GET'], description: 'Title-track first-week comparison aligned to JST prerelease midnight' },
    { path: '/api/spotify-playcounts', methods: ['GET'], description: 'Latest finalized Spotify cumulative playcounts by Sakamichi group' },
    { path: '/api/spotify-monthly-listeners', methods: ['GET'], description: 'Daily Spotify monthly-listener snapshots and SVG trend chart for tracked idols' },
    { path: '/api/spotify-playlists', methods: ['GET'], description: 'Public Spotify playlist memberships discovered from open.spotify.com pages' },
    { path: '/api/amazon-music', methods: ['GET'], description: 'Latest Sakurazaka Amazon Music follower and track-rank read model' },
    { path: '/api/amazon-music-playlists', methods: ['GET'], description: 'Amazon Music related-playlist memberships collected from track detail pages' },
    { path: '/api/apple-music', methods: ['GET'], description: 'Latest Sakurazaka Apple Music regional artist-popularity read model' },
    { path: '/api/apple-music-playlists', methods: ['GET'], description: 'Public Apple Music playlist memberships discovered from music.apple.com pages' },
    { path: '/api/followers', methods: ['GET'], description: 'Daily Stationhead follower history and comparison for tracked accounts' },
    { path: '/api/regional-music', methods: ['GET'], description: 'Service-scoped regional music read model selected by the service query parameter' },
  ]),
});

export const API_EDGE_TTL_SECONDS = 300;
export const API_BROWSER_TTL_SECONDS = 30;
export const MATERIALIZED_RESPONSE_MAX_AGE_MS = 15 * 60_000;

export const MATERIALIZED_API_VARIANTS = Object.freeze([
  Object.freeze({ key: 'dashboard', url: '/api/dashboard?history=0', cadence_minutes: 5 }),
  Object.freeze({ key: 'history:daily', url: '/api/history?mode=daily', cadence_minutes: 1440, revision_driven: true }),
  Object.freeze({ key: 'history:weekly', url: '/api/history?mode=weekly', cadence_minutes: 1440, revision_driven: true }),
  Object.freeze({ key: 'history:broadcasts', url: '/api/history?mode=broadcasts', cadence_minutes: 1440, revision_driven: true }),
  Object.freeze({ key: 'host-history:summary', url: '/api/host-history?mode=summary', cadence_minutes: 1440, revision_driven: true }),
  Object.freeze({
    key: 'spotify-playcounts',
    url: '/api/spotify-playcounts',
    cadence_minutes: 720,
    event_driven: true,
  }),
]);

const materializedVariantsByKey = new Map(MATERIALIZED_API_VARIANTS.map((variant) => [variant.key, variant]));

function normalizedPathname(value) {
  const pathname = String(value || '/');
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function onlyParameters(url, allowed = []) {
  const keys = new Set(allowed);
  for (const key of url.searchParams.keys()) {
    if (key !== 'v' && !keys.has(key)) return false;
  }
  return true;
}

function regionalMusicModelKey(url) {
  if (!onlyParameters(url, ['service'])) return null;
  const service = String(url.searchParams.get('service') || '').trim();
  return regionalMusicApiServices.has(service) ? `regional-music:${service}` : null;
}

export function materializedApiKey(input) {
  const url = input instanceof URL ? input : new URL(input);
  const pathname = normalizedPathname(url.pathname);
  if (pathname === '/api/dashboard'
      && onlyParameters(url, ['since', 'queue_revision', 'history'])) return 'dashboard';
  if (pathname === '/api/history' && onlyParameters(url, ['mode', 'from', 'to'])) {
    const mode = String(url.searchParams.get('mode') || 'weekly').trim().toLowerCase();
    return ['daily', 'weekly', 'broadcasts'].includes(mode) ? `history:${mode}` : null;
  }
  if (pathname === '/api/host-history' && onlyParameters(url, ['mode'])) {
    const mode = String(url.searchParams.get('mode') || 'summary').trim().toLowerCase();
    return mode === 'summary' ? 'host-history:summary' : null;
  }
  if (pathname === '/api/spotify-playcounts' && onlyParameters(url, ['artist'])) {
    return 'spotify-playcounts';
  }
  if (pathname === '/api/followers' && onlyParameters(url)) return 'followers';
  if (pathname === '/api/regional-music') return regionalMusicModelKey(url);
  return null;
}

export function edgeCacheableApiRequest(request) {
  if (request.method !== 'GET' || request.headers.has('authorization')) return false;
  const pathname = normalizedPathname(new URL(request.url).pathname);
  if (!pathname.startsWith('/api/')) return false;
  return pathname !== '/api/health'
    && pathname !== '/api/sakurazaka46jp-status'
    && pathname !== '/api/nogizaka46smej-status'
    && pathname !== '/api/nogizaka-listening-party';
}

export function apiCacheTtlSeconds(request) {
  const pathname = request?.url ? normalizedPathname(new URL(request.url).pathname) : '';
  if (pathname === '/api/history-current') return 30;
  if (pathname === '/api/first-week-comparison') return 3600;
  return API_EDGE_TTL_SECONDS;
}

export function materializedResponseCadenceSeconds(modelKey) {
  const key = String(modelKey || '');
  if (key === 'followers' || key.startsWith('regional-music:')) return 0;
  const variant = materializedVariantsByKey.get(key);
  if (variant?.event_driven === true) return 0;
  const cadenceMinutes = Number(variant?.cadence_minutes);
  if (!Number.isFinite(cadenceMinutes) || cadenceMinutes <= 0) return API_EDGE_TTL_SECONDS;
  return Math.max(API_EDGE_TTL_SECONDS, Math.trunc(cadenceMinutes * 60));
}

export function materializedResponseMaximumAge(modelKey, env = {}) {
  const key = String(modelKey || '');
  if (key === 'followers' || key.startsWith('regional-music:')) return Number.MAX_SAFE_INTEGER;
  const variant = materializedVariantsByKey.get(key);
  if (variant?.event_driven === true || variant?.revision_driven === true) {
    return Number.MAX_SAFE_INTEGER;
  }
  const configured = Number(env.PAGES_RESPONSE_MAX_AGE_MS);
  const cadenceMs = materializedResponseCadenceSeconds(key) * 1000;
  const graceMs = API_EDGE_TTL_SECONDS * 1000;
  const minimum = cadenceMs + graceMs;
  const fallback = Math.max(MATERIALIZED_RESPONSE_MAX_AGE_MS, minimum);
  return Number.isFinite(configured) && configured >= minimum ? configured : fallback;
}

export function canonicalApiCacheRequest(request) {
  const url = new URL(request.url);
  const pathname = normalizedPathname(url.pathname);
  url.searchParams.delete('v');
  if (pathname === '/api/dashboard') {
    url.searchParams.delete('since');
    url.searchParams.delete('queue_revision');
    url.searchParams.delete('history');
  }
  if (pathname === '/api/history'
      && String(url.searchParams.get('mode') || 'weekly').trim().toLowerCase() === 'weekly') {
    url.searchParams.delete('mode');
  }
  if (pathname === '/api/host-history'
      && String(url.searchParams.get('mode') || 'summary').trim().toLowerCase() === 'summary') {
    url.searchParams.delete('mode');
  }
  if (pathname === '/api/spotify-playcounts') {
    url.searchParams.delete('artist');
  }
  const sorted = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) =>
    aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
  url.search = '';
  for (const [key, value] of sorted) url.searchParams.append(key, value);
  return new Request(url.toString(), { method: 'GET', headers: { accept: 'application/json' } });
}

export function canonicalApiPaths() {
  return Object.values(API_GROUPS).flat().map(({ path }) => path);
}
