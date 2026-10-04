const YOUTUBE_ORIGIN = 'https://www.youtube.com';
export const YOUTUBE_PLAYLIST_ID = 'PLMWqSdpIVl30';
export const YOUTUBE_PLAYLIST_URL =
  `${YOUTUBE_ORIGIN}/playlist?list=${YOUTUBE_PLAYLIST_ID}`;

const RESOLVE_TIMEOUT_MS = 8_000;
const MAX_PLAYLIST_HTML_CHARS = 6 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const PERSISTENT_CACHE_TTL_SECONDS = 6 * 60 * 60;
const PERSISTENT_CACHE_URL =
  'https://homepanel-cloud.tarematsu.workers.dev/__cache/youtube-start';
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
let cachedStart = null;

function youtubeWatchUrl(videoId) {
  if (!VIDEO_ID_RE.test(String(videoId || ''))) return '';
  const url = new URL('/watch', YOUTUBE_ORIGIN);
  url.searchParams.set('v', videoId);
  url.searchParams.set('list', YOUTUBE_PLAYLIST_ID);
  return url.href;
}

export function firstYoutubePlaylistVideoId(html) {
  const text = String(html || '');
  if (!text || text.length > MAX_PLAYLIST_HTML_CHARS) return '';

  // The browse playlist payload exposes entries as playlistVideoRenderer in
  // playlist order. Take the first renderer rather than depending on visible
  // Polymer controls or layout timing.
  const renderer = text.match(
    /"playlistVideoRenderer"\s*:\s*\{[\s\S]{0,6000}?"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/,
  );
  if (renderer?.[1]) return renderer[1];

  // Keep a narrow fallback for experiments that serialize a watch endpoint
  // before the renderer object. index=0 and index=1 have both appeared in
  // YouTube playlist bootstrap data, so accept either only when the target
  // playlist id is adjacent to the endpoint.
  const endpoint = text.match(
    new RegExp(
      `"videoId"\\s*:\\s*"([A-Za-z0-9_-]{11})"[\\s\\S]{0,1000}?` +
      `"playlistId"\\s*:\\s*"${YOUTUBE_PLAYLIST_ID}"[\\s\\S]{0,300}?` +
      `"index"\\s*:\\s*[01](?:\\D|$)`,
    ),
  );
  return endpoint?.[1] || '';
}

async function firstYoutubePlaylistVideoIdFromResponse(response) {
  const reader = response?.body?.getReader?.();
  if (!reader) {
    const html = await response.text();
    if (html.length > MAX_PLAYLIST_HTML_CHARS) {
      throw new Error('youtube playlist response too large');
    }
    return firstYoutubePlaylistVideoId(html);
  }

  const decoder = new TextDecoder();
  let html = '';
  try {
    while (html.length <= MAX_PLAYLIST_HTML_CHARS) {
      const { done, value } = await reader.read();
      if (done) {
        html += decoder.decode();
        return firstYoutubePlaylistVideoId(html);
      }
      html += decoder.decode(value, { stream: true });
      const videoId = firstYoutubePlaylistVideoId(html);
      if (videoId) {
        try { await reader.cancel(); } catch (_) {}
        return videoId;
      }
      if (html.length > MAX_PLAYLIST_HTML_CHARS) break;
    }
  } finally {
    try { reader.releaseLock?.(); } catch (_) {}
  }
  throw new Error('youtube playlist first item not found within scan limit');
}

function persistentCache(dependencies) {
  if (dependencies.disableCache) return null;
  return dependencies.cache || globalThis.caches?.default || null;
}

function validCachedStart(value) {
  if (!value || value.playlistId !== YOUTUBE_PLAYLIST_ID) return null;
  const videoId = String(value.videoId || '');
  const url = youtubeWatchUrl(videoId);
  if (!url) return null;
  return {
    playlistId: YOUTUBE_PLAYLIST_ID,
    videoId,
    url,
    resolvedAt: String(value.resolvedAt || ''),
    cached: true,
  };
}

async function readPersistentCachedStart(dependencies = {}) {
  const cache = persistentCache(dependencies);
  if (!cache?.match) return null;
  try {
    const response = await cache.match(new Request(PERSISTENT_CACHE_URL));
    if (!response?.ok) return null;
    return validCachedStart(await response.json());
  } catch (_) {
    return null;
  }
}

async function writePersistentCachedStart(value, dependencies = {}) {
  const cache = persistentCache(dependencies);
  if (!cache?.put) return;
  try {
    const response = new Response(JSON.stringify(value), {
      headers: {
        'Cache-Control': `public, max-age=${PERSISTENT_CACHE_TTL_SECONDS}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
    await cache.put(new Request(PERSISTENT_CACHE_URL), response);
  } catch (_) {}
}

export async function resolveYoutubePlaylistStart(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const now = Number(dependencies.now ?? Date.now());
  if (!dependencies.disableCache && cachedStart && cachedStart.expiresAt > now) {
    return { ...cachedStart.value, cached: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(YOUTUBE_PLAYLIST_URL, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) {
      throw new Error(`youtube playlist returned ${response.status}`);
    }
    const videoId = await firstYoutubePlaylistVideoIdFromResponse(response);
    const url = youtubeWatchUrl(videoId);
    if (!url) throw new Error('youtube playlist first item not found');

    const value = {
      playlistId: YOUTUBE_PLAYLIST_ID,
      videoId,
      url,
      resolvedAt: new Date(now).toISOString(),
      cached: false,
    };
    if (!dependencies.disableCache) {
      cachedStart = { value, expiresAt: now + CACHE_TTL_MS };
      await writePersistentCachedStart(value, dependencies);
    }
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

function redirectHeaders(location, state) {
  return {
    'Location': location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-HomePanel-Youtube-Start': state,
  };
}

export async function youtubePlaylistStartResponse(dependencies = {}) {
  try {
    const start = await resolveYoutubePlaylistStart(dependencies);
    return new Response(null, {
      status: 302,
      headers: redirectHeaders(
        start.url,
        start.cached ? 'cloud-cache' : 'cloud-resolved',
      ),
    });
  } catch (error) {
    console.warn('youtube-playlist-start-resolve-failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    const stale = await readPersistentCachedStart(dependencies);
    if (stale) {
      return new Response(null, {
        status: 302,
        headers: redirectHeaders(stale.url, 'cloud-stale-cache'),
      });
    }
    // Preserve startup if YouTube temporarily blocks Worker-side HTML fetches.
    // This remains the last-resort path only when no direct watch URL is cached.
    return new Response(null, {
      status: 302,
      headers: redirectHeaders(YOUTUBE_PLAYLIST_URL, 'native-fallback'),
    });
  }
}
