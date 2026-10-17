// HTTP only forwards to the isolated resolver; HTML parsing belongs to the DO.
const COORDINATOR_NAME = 'youtube-playlist-start';
export const YOUTUBE_START_COORDINATOR_PATH = '/youtube-playlist-start';
const COORDINATOR_URL = `https://homepanel.internal${YOUTUBE_START_COORDINATOR_PATH}`;
const FALLBACK_URL = 'https://www.youtube.com/playlist?list=PLMWqSdpIVl30';

export async function coordinatedYoutubePlaylistStartResponse(env) {
  try {
    const namespace = env?.VIDEO_FEED_COORDINATOR;
    if (!namespace?.getByName) throw new Error('resolver binding unavailable');
    const response = await namespace.getByName(COORDINATOR_NAME).fetch(COORDINATOR_URL, { redirect: 'manual' });
    if (response.status === 302) return response;
    await response.body?.cancel();
    throw new Error(`resolver returned ${response.status}`);
  } catch (error) {
    // Keep playback startup available without moving expensive work back to HTTP.
    console.warn('youtube-playlist-start-coordinator-unavailable', error instanceof Error ? error.message.slice(0, 180) : 'unknown error');
    return new Response(null, {
      status: 302,
      headers: {
        Location: FALLBACK_URL,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-HomePanel-Youtube-Start': 'native-fallback',
      },
    });
  }
}

// A single small record survives DO eviction. Match the resolver's cache API,
// keeping its existing validation and six-hour TTL in one place.
export function youtubeStartStorageCache(storage, now = Date.now) {
  const key = 'youtube-playlist-start-v1';
  return {
    async match() {
      const record = await storage.get(key);
      if (!record || !Number.isFinite(record.expiresAt) || record.expiresAt <= now()) return undefined;
      return new Response(record.body, { headers: { 'Content-Type': 'application/json' } });
    },
    async put(_request, response) {
      const seconds = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]);
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      await storage.put(key, { body: await response.text(), expiresAt: now() + seconds * 1000 });
    },
  };
}
