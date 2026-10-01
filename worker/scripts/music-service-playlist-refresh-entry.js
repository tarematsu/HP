import { canonicalizeAppleMusicPlaylistPresentation } from '../src/apple-music-playlist-canonical-presentation.js';
import {
  APPLE_MUSIC_PLAYLIST_SEEDS,
  collectAppleMusicPlaylists,
} from '../src/apple-music-playlist-collector.js';
import { collectSpotifyPlaylists } from '../src/spotify-playlist-collector.js';

const APPLE_STATE_KEY = 'apple-music/playlists/state.json';
const appleSeedCache = new Map();
const appleSeedSet = new Set(APPLE_MUSIC_PLAYLIST_SEEDS);

async function getJson(r2, key) {
  const stored = await r2?.get?.(key);
  if (!stored) return null;
  try {
    if (typeof stored.json === 'function') return await stored.json();
    if (typeof stored.text === 'function') return JSON.parse(await stored.text());
  } catch {
    return null;
  }
  return null;
}

async function putJson(r2, key, value) {
  await r2.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

async function clearAppleDailyGate(r2) {
  const state = await getJson(r2, APPLE_STATE_KEY);
  if (!state || !state.scan_date) return false;
  await putJson(r2, APPLE_STATE_KEY, { ...state, scan_date: null });
  return true;
}

async function cachedAppleSeedFetch(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (!appleSeedSet.has(url)) return fetch(input, init);
  if (!appleSeedCache.has(url)) {
    appleSeedCache.set(url, fetch(input, init).then(async (response) => ({
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body: await response.text(),
    })));
  }
  const cached = await appleSeedCache.get(url);
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers,
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function refreshApple(env) {
  await clearAppleDailyGate(env?.PAGES_RESPONSE_R2);
  const result = await collectAppleMusicPlaylists(env, Date.now(), cachedAppleSeedFetch);
  return {
    ...result,
    service: 'apple',
    known_playlists: Number(result?.discovered_playlists || result?.known_playlists || 0),
  };
}

async function refreshSpotify(env, discover) {
  return collectSpotifyPlaylists(env, Date.now(), fetch, { discover });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return new Response(null, { status: 405 });

    if (url.pathname === '/refresh') {
      const service = String(url.searchParams.get('service') || '').toLowerCase();
      try {
        if (service === 'apple') return json(await refreshApple(env));
        if (service === 'spotify') {
          const discover = url.searchParams.get('discover') !== '0';
          return json(await refreshSpotify(env, discover));
        }
        return json({ ok: false, error: 'service must be apple or spotify' }, 400);
      } catch (error) {
        return json({
          ok: false,
          service,
          error: String(error?.stack || error?.message || error).slice(0, 1200),
        }, 500);
      }
    }

    if (url.pathname === '/finalize' && url.searchParams.get('service') === 'apple') {
      try {
        const result = await canonicalizeAppleMusicPlaylistPresentation(env, Date.now(), { force: true });
        return json({ ok: true, service: 'apple', ...result });
      } catch (error) {
        return json({ ok: false, service: 'apple', error: String(error?.message || error).slice(0, 1200) }, 500);
      }
    }

    return new Response(null, { status: 404 });
  },
};
