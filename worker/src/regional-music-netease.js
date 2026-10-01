import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

const NETEASE_HOT_LIMIT = 20;
const NETEASE_ALBUM_BATCH = 6;
const NETEASE_COMMENT_BATCH = 5;
const VERIFIED_ARTIST_IDS = Object.freeze({ sakurazaka46: '36908026', hinatazaka46: '13163121', nogizaka46: '20846' });
const DAY_MS = 86_400_000;

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

function namesOfArtist(item) {
  return [item?.name, ...(Array.isArray(item?.alias) ? item.alias : [])].filter(Boolean).map(normalize);
}

export function neteaseSearchUrl() {
  return 'https://music.163.com/api/cloudsearch/pc';
}

export function neteaseArtistUrl(artistId) {
  return `https://music.163.com/#/artist?id=${encodeURIComponent(artistId)}`;
}

export function neteaseArtistApiUrl(artistId) {
  return `https://music.163.com/api/artist/${encodeURIComponent(artistId)}`;
}

export function neteaseArtistAlbumsUrl(artistId) {
  return `https://music.163.com/api/artist/albums/${encodeURIComponent(artistId)}/?limit=50&offset=0`;
}

export function neteaseAlbumUrl(albumId) {
  return `https://music.163.com/api/album/${encodeURIComponent(albumId)}`;
}

export function neteaseSongUrl(trackId) {
  return `https://music.163.com/#/song?id=${encodeURIComponent(trackId)}`;
}

export function neteaseCommentUrl(trackId) {
  return `https://music.163.com/api/v1/resource/comments/R_SO_4_${encodeURIComponent(trackId)}?limit=1&offset=0`;
}

export function parseNeteaseArtistId(payload, aliases) {
  const wanted = new Set(aliases.map(normalize));
  const list = payload?.result?.artists || payload?.artists || [];
  if (!Array.isArray(list)) return null;
  const exact = list.filter((artist) => namesOfArtist(artist).some((name) => wanted.has(name)));
  if (!exact.length) return null;
  exact.sort((a, b) => Number(b?.musicSize || 0) - Number(a?.musicSize || 0));
  const id = exact[0]?.id;
  return id == null ? null : String(id);
}

function trackArtists(track) {
  const list = track?.artists || track?.ar || [];
  return Array.isArray(list) ? list : [];
}

function trackAlbum(track) {
  return track?.album || track?.al || null;
}

function trackBelongsToArtist(track, artistId, aliases) {
  const wanted = new Set(aliases.map(normalize));
  return trackArtists(track).some((artist) =>
    String(artist?.id ?? '') === String(artistId)
    || wanted.has(normalize(artist?.name)));
}

function normalizeTrack(track, rank = null) {
  const id = track?.id;
  if (id == null) return null;
  const album = trackAlbum(track);
  return {
    track_id: String(id),
    title: track?.name || null,
    album_name: album?.name || null,
    rank,
  };
}

export function parseNeteaseHotTracks(payload, artistId, aliases, limit = NETEASE_HOT_LIMIT) {
  const list = payload?.hotSongs || payload?.songs || [];
  if (!Array.isArray(list)) return [];
  const output = [];
  for (const [index, track] of list.entries()) {
    if (!trackBelongsToArtist(track, artistId, aliases)) continue;
    const normalized = normalizeTrack(track, index + 1);
    if (normalized) output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

export function parseNeteaseAlbums(payload) {
  const list = payload?.hotAlbums || payload?.albums || [];
  if (!Array.isArray(list)) return [];
  return list.map((album) => ({
    id: album?.id == null ? null : String(album.id),
    name: album?.name || null,
  })).filter((album) => album.id);
}

export function parseNeteaseAlbumTracks(payload, artistId, aliases) {
  const list = payload?.songs || payload?.album?.songs || [];
  if (!Array.isArray(list)) return [];
  return list
    .filter((track) => trackBelongsToArtist(track, artistId, aliases))
    .map((track) => normalizeTrack(track))
    .filter(Boolean);
}

export function parseNeteaseCommentCount(payload) {
  const value = Number(payload?.total ?? payload?.data?.total);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

async function requestJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://music.163.com/',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function discoverArtist(fetchImpl, artist) {
  for (const alias of artist.aliases) {
    const body = new URLSearchParams({ s: alias, type: '100', limit: '10', offset: '0' });
    const payload = await requestJson(fetchImpl, neteaseSearchUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
    });
    const id = parseNeteaseArtistId(payload, artist.aliases);
    if (id) return id;
  }
  return null;
}

function rotatingAlbumBatch(albums, observedAt) {
  if (albums.length <= NETEASE_ALBUM_BATCH) return albums;
  const start = (Math.floor(observedAt / DAY_MS) * NETEASE_ALBUM_BATCH) % albums.length;
  return Array.from({ length: NETEASE_ALBUM_BATCH }, (_, offset) => albums[(start + offset) % albums.length]);
}

async function optionalCommentCount(fetchImpl, trackId) {
  try {
    return parseNeteaseCommentCount(await requestJson(fetchImpl, neteaseCommentUrl(trackId)));
  } catch {
    return null;
  }
}

export async function collectNeteaseCloudMusic(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let artists = 0;
  let tracks = 0;
  let comments = 0;
  let albums = 0;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      const artistId = (await discoverArtist(fetchImpl, artist)) || VERIFIED_ARTIST_IDS[canonicalArtist];
      if (!artistId) throw new Error('artist id not found');
      const artistPayload = await requestJson(fetchImpl, neteaseArtistApiUrl(artistId));
      if (!parseNeteaseArtistId({ artists: [artistPayload?.artist] }, artist.aliases)) {
        throw new Error('artist profile identity could not be verified');
      }
      await saveRegionalArtist(env, {
        service: 'netease_cloud_music',
        canonical_artist: canonicalArtist,
        service_artist_id: artistId,
        display_name: artist.aliases[1],
        profile_url: neteaseArtistUrl(artistId),
        observed_at: observedAt,
      });
      artists += 1;

      const hotTracks = parseNeteaseHotTracks(artistPayload, artistId, artist.aliases);
      for (const [index, entry] of hotTracks.entries()) {
        const commentCount = index < NETEASE_COMMENT_BATCH
          ? await optionalCommentCount(fetchImpl, entry.track_id)
          : null;
        if (commentCount != null) comments += 1;
        await saveRegionalTrack(env, {
          service: 'netease_cloud_music',
          service_track_id: entry.track_id,
          service_artist_id: artistId,
          canonical_artist: canonicalArtist,
          title: entry.title,
          album_name: entry.album_name,
          track_url: neteaseSongUrl(entry.track_id),
          comments: commentCount,
          popularity_rank: entry.rank,
          observed_at: observedAt,
        });
        tracks += 1;
      }

      const albumPayload = await requestJson(fetchImpl, neteaseArtistAlbumsUrl(artistId));
      const albumBatch = rotatingAlbumBatch(parseNeteaseAlbums(albumPayload), observedAt);
      const seen = new Set(hotTracks.map((track) => track.track_id));
      for (const album of albumBatch) {
        try {
          const payload = await requestJson(fetchImpl, neteaseAlbumUrl(album.id));
          albums += 1;
          for (const entry of parseNeteaseAlbumTracks(payload, artistId, artist.aliases)) {
            if (seen.has(entry.track_id)) continue;
            seen.add(entry.track_id);
            await saveRegionalTrack(env, {
              service: 'netease_cloud_music',
              service_track_id: entry.track_id,
              service_artist_id: artistId,
              canonical_artist: canonicalArtist,
              title: entry.title,
              album_name: entry.album_name || album.name,
              track_url: neteaseSongUrl(entry.track_id),
              observed_at: observedAt,
            });
            tracks += 1;
          }
        } catch (error) {
          failures.push({ canonical_artist: canonicalArtist, album_id: album.id, error: String(error?.message || error) });
        }
      }

      if (!hotTracks.length && !albumBatch.length) throw new Error('artist catalog empty');
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : (artists || tracks) ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'netease_cloud_music',
    status,
    last_attempt_at: observedAt,
    last_success_at: (artists || tracks) ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, albums, tracks, tracks_with_comments: comments, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'netease_cloud_music', status, artists, albums, tracks, tracks_with_comments: comments, failures };
}
