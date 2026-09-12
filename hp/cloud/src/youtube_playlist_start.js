const YOUTUBE_ORIGIN = 'https://www.youtube.com';
export const YOUTUBE_PLAYLIST_ID = 'PLMWqSdpIVl30';
export const YOUTUBE_PLAYLIST_URL =
  `${YOUTUBE_ORIGIN}/playlist?list=${YOUTUBE_PLAYLIST_ID}`;

const RESOLVE_TIMEOUT_MS = 8_000;
const MAX_PLAYLIST_HTML_CHARS = 6 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
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
    const html = await response.text();
    if (html.length > MAX_PLAYLIST_HTML_CHARS) {
      throw new Error('youtube playlist response too large');
    }
    const videoId = firstYoutubePlaylistVideoId(html);
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
    }
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

export async function youtubePlaylistStartResponse(dependencies = {}) {
  try {
    const start = await resolveYoutubePlaylistStart(dependencies);
    return new Response(null, {
      status: 302,
      headers: {
        'Location': start.url,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-HomePanel-Youtube-Start': start.cached ? 'cloud-cache' : 'cloud-resolved',
      },
    });
  } catch (error) {
    console.warn('youtube-playlist-start-resolve-failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Preserve startup if YouTube temporarily blocks Worker-side HTML fetches.
    // The native fallback reads the first playlist item but never clicks Play all.
    return new Response(null, {
      status: 302,
      headers: {
        'Location': YOUTUBE_PLAYLIST_URL,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-HomePanel-Youtube-Start': 'native-fallback',
      },
    });
  }
}
