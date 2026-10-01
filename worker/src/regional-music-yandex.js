import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

const YANDEX_PAGES = 2;

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

export function yandexSearchUrl(query, page = 0) {
  const params = new URLSearchParams({ text: query, page: String(page) });
  return `https://music.yandex.ru/handlers/music-search.jsx?${params}`;
}

export function yandexArtistUrl(artistId) {
  return `https://music.yandex.com/artist/${encodeURIComponent(artistId)}`;
}

export function yandexTrackUrl(albumId, trackId) {
  return `https://music.yandex.com/album/${encodeURIComponent(albumId)}/track/${encodeURIComponent(trackId)}`;
}

function trackArtists(track) {
  return Array.isArray(track?.artists) ? track.artists : [];
}

export function parseYandexTracks(payload, aliases) {
  const list = payload?.tracks?.items || [];
  if (!Array.isArray(list)) return [];
  const wanted = new Set(aliases.map(normalize));
  const output = [];
  const seen = new Set();
  for (const track of list) {
    if (track?.type && track.type !== 'music') continue;
    const matchedArtist = trackArtists(track).find((artist) => wanted.has(normalize(artist?.name)));
    if (!matchedArtist) continue;
    const trackId = track?.id;
    const album = Array.isArray(track?.albums) ? track.albums[0] : null;
    if (trackId == null || !album?.id || seen.has(String(trackId))) continue;
    seen.add(String(trackId));
    output.push({
      track_id: String(trackId),
      title: track?.title || null,
      album_id: String(album.id),
      album_name: album?.title || null,
      artist_id: matchedArtist?.id == null ? null : String(matchedArtist.id),
    });
  }
  return output;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      'accept-language': 'en-US,en;q=0.8',
      referer: 'https://music.yandex.ru/',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function collectYandexMusic(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let artists = 0;
  let tracks = 0;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      const seen = new Set();
      let artistId = null;
      for (const alias of artist.aliases) {
        for (let page = 0; page < YANDEX_PAGES; page += 1) {
          const entries = parseYandexTracks(await fetchJson(fetchImpl, yandexSearchUrl(alias, page)), artist.aliases);
          for (const entry of entries) {
            if (seen.has(entry.track_id)) continue;
            seen.add(entry.track_id);
            artistId ||= entry.artist_id;
            await saveRegionalTrack(env, {
              service: 'yandex_music',
              service_track_id: entry.track_id,
              service_artist_id: entry.artist_id || artistId,
              canonical_artist: canonicalArtist,
              title: entry.title,
              album_name: entry.album_name,
              track_url: yandexTrackUrl(entry.album_id, entry.track_id),
              observed_at: observedAt,
            });
            tracks += 1;
          }
          if (!entries.length) break;
        }
        if (seen.size) break;
      }
      if (!seen.size) throw new Error('catalog search returned no matching tracks');
      if (artistId) {
        await saveRegionalArtist(env, {
          service: 'yandex_music',
          canonical_artist: canonicalArtist,
          service_artist_id: artistId,
          display_name: artist.aliases[1],
          profile_url: yandexArtistUrl(artistId),
          observed_at: observedAt,
        });
        artists += 1;
      }
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : tracks ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'yandex_music',
    status,
    last_attempt_at: observedAt,
    last_success_at: tracks ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'yandex_music', status, artists, tracks, failures };
}
