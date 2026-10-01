import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

const VIBE_TRACK_LIMIT = 50;

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

export function vibeArtistSearchUrl(query) {
  const params = new URLSearchParams({ query, sort: 'RELEVANCE' });
  return `https://apis.naver.com/vibeWeb/musicapiweb/v4/search/artist.json?${params}`;
}

export function vibeArtistUrl(artistId) {
  return `https://vibe.naver.com/artist/${encodeURIComponent(artistId)}`;
}

export function vibeArtistDetailUrl(artistId) {
  return `https://apis.naver.com/vibeWeb/musicapiweb/vibe/v1/artist/${encodeURIComponent(artistId)}.json`;
}

export function vibeArtistTracksUrl(artistId) {
  const params = new URLSearchParams({ display: String(VIBE_TRACK_LIMIT), start: '1', type: 'RELEASE' });
  return `https://apis.naver.com/vibeWeb/musicapiweb/vibe/v1/artist/${encodeURIComponent(artistId)}/tracks.json?${params}`;
}

export function vibeTrackUrl(trackId) {
  return `https://vibe.naver.com/track/${encodeURIComponent(trackId)}`;
}

function resultOf(payload) {
  return payload?.response?.result || {};
}

export function parseVibeArtist(payload, aliases) {
  const wanted = new Set(aliases.map(normalize));
  const list = resultOf(payload)?.artists || [];
  if (!Array.isArray(list)) return null;
  for (const artist of list) {
    if (!wanted.has(normalize(artist?.artistName))) continue;
    const id = artist?.artistId;
    if (id == null) continue;
    return {
      id: String(id),
      name: artist?.artistName || null,
      likes: Number.isFinite(Number(artist?.likeCount)) ? Math.max(0, Math.trunc(Number(artist.likeCount))) : null,
    };
  }
  return null;
}

export function parseVibeArtistDetail(payload, artistId, aliases) {
  const artist = resultOf(payload)?.artist;
  if (!artist || String(artist?.artistId ?? '') !== String(artistId)) return null;
  const wanted = new Set(aliases.map(normalize));
  if (!wanted.has(normalize(artist?.artistName))) return null;
  return {
    id: String(artist.artistId),
    name: artist.artistName || null,
    likes: Number.isFinite(Number(artist?.likeCount)) ? Math.max(0, Math.trunc(Number(artist.likeCount))) : null,
  };
}

export function parseVibeTracks(payload, artistId, aliases) {
  const list = resultOf(payload)?.tracks || [];
  if (!Array.isArray(list)) return [];
  const wanted = new Set(aliases.map(normalize));
  const output = [];
  const seen = new Set();
  for (const track of list) {
    const artists = Array.isArray(track?.artists) ? track.artists : [];
    if (!artists.some((artist) =>
      String(artist?.artistId ?? '') === String(artistId)
      || wanted.has(normalize(artist?.artistName)))) continue;
    const trackId = track?.trackId;
    if (trackId == null || seen.has(String(trackId))) continue;
    seen.add(String(trackId));
    output.push({
      track_id: String(trackId),
      title: track?.trackTitle || null,
      album_name: track?.album?.albumTitle || null,
      likes: Number.isFinite(Number(track?.likeCount)) ? Math.max(0, Math.trunc(Number(track.likeCount))) : null,
    });
  }
  return output;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      referer: 'https://vibe.naver.com/',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function discoverArtist(fetchImpl, artist) {
  for (const alias of artist.aliases) {
    const found = parseVibeArtist(await fetchJson(fetchImpl, vibeArtistSearchUrl(alias)), artist.aliases);
    if (found) return found;
  }
  return null;
}

export async function collectNaverVibe(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let artists = 0;
  let tracks = 0;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      const discovered = await discoverArtist(fetchImpl, artist);
      if (!discovered) throw new Error('artist id not found');
      let profile = discovered;
      try {
        profile = parseVibeArtistDetail(
          await fetchJson(fetchImpl, vibeArtistDetailUrl(discovered.id)),
          discovered.id,
          artist.aliases,
        ) || discovered;
      } catch {}

      await saveRegionalArtist(env, {
        service: 'naver_vibe',
        canonical_artist: canonicalArtist,
        service_artist_id: profile.id,
        display_name: profile.name || artist.aliases[1],
        profile_url: vibeArtistUrl(profile.id),
        likes: profile.likes,
        observed_at: observedAt,
      });
      artists += 1;

      const entries = parseVibeTracks(
        await fetchJson(fetchImpl, vibeArtistTracksUrl(profile.id)),
        profile.id,
        artist.aliases,
      );
      for (const entry of entries) {
        await saveRegionalTrack(env, {
          service: 'naver_vibe',
          service_track_id: entry.track_id,
          service_artist_id: profile.id,
          canonical_artist: canonicalArtist,
          title: entry.title,
          album_name: entry.album_name,
          track_url: vibeTrackUrl(entry.track_id),
          likes: entry.likes,
          observed_at: observedAt,
        });
        tracks += 1;
      }
      if (!entries.length) throw new Error('artist release track list empty');
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : (artists || tracks) ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'naver_vibe',
    status,
    last_attempt_at: observedAt,
    last_success_at: (artists || tracks) ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'naver_vibe', status, artists, tracks, failures };
}
