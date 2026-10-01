import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

const FLO_ALBUM_BATCH = 6;
const FLO_SEARCH_SIZE = 30;
const DAY_MS = 86_400_000;

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

export function floSearchUrl(query, searchType = 'INTEGRATION', size = FLO_SEARCH_SIZE) {
  const params = new URLSearchParams({
    sortType: 'ACCURACY',
    searchType,
    keyword: query,
    suggestedQuery: '',
    queryType: 'system',
    mixYn: 'Y',
    page: '1',
    size: String(size),
  });
  return `https://www.music-flo.com/api/search/v2/search?${params}`;
}

export function floAlbumTracksUrl(albumId) {
  return `https://www.music-flo.com/api/meta/v1/album/${encodeURIComponent(albumId)}/track`;
}

export function floAlbumUrl(albumId) {
  return `https://www.music-flo.com/detail/album/${encodeURIComponent(albumId)}`;
}

function typedLists(payload) {
  const roots = payload?.data?.list;
  if (!Array.isArray(roots)) return [];
  const output = [];
  for (const root of roots) {
    const type = String(root?.type || root?.searchType || '').toUpperCase();
    if (Array.isArray(root?.list)) {
      for (const item of root.list) output.push({ type, item });
    } else if (root && typeof root === 'object') {
      output.push({ type, item: root });
    }
  }
  return output;
}

function artistNames(item) {
  const names = [];
  if (item?.name) names.push(item.name);
  if (item?.artistName) names.push(item.artistName);
  if (item?.representationArtist?.name) names.push(item.representationArtist.name);
  if (Array.isArray(item?.artistList)) {
    for (const artist of item.artistList) if (artist?.name) names.push(artist.name);
  }
  return names;
}

function exactArtist(item, aliases) {
  const wanted = new Set(aliases.map(normalize));
  return artistNames(item).some((name) => wanted.has(normalize(name)));
}

export function parseFloArtistId(payload, aliases) {
  const matches = typedLists(payload)
    .filter(({ type, item }) => (!type || type === 'ARTIST') && exactArtist(item, aliases))
    .map(({ item }) => item);
  const first = matches.find((item) => item?.id != null || item?.artistId != null);
  const id = first?.id ?? first?.artistId;
  return id == null ? null : String(id);
}

export function parseFloAlbums(payload, aliases) {
  const seen = new Set();
  const output = [];
  for (const { type, item } of typedLists(payload)) {
    if (type && type !== 'ALBUM') continue;
    if (!exactArtist(item, aliases)) continue;
    const id = item?.id ?? item?.albumId;
    if (id == null || seen.has(String(id))) continue;
    seen.add(String(id));
    output.push({
      id: String(id),
      title: item?.title || item?.name || item?.albumTitle || null,
    });
  }
  return output;
}

function trackItems(payload) {
  const direct = payload?.data?.list;
  if (!Array.isArray(direct)) return [];
  return direct.flatMap((entry) => Array.isArray(entry?.list) ? entry.list : [entry]);
}

export function parseFloAlbumTracks(payload, aliases) {
  const output = [];
  const seen = new Set();
  for (const track of trackItems(payload)) {
    if (!exactArtist(track, aliases)) continue;
    const id = track?.id ?? track?.trackId;
    if (id == null || seen.has(String(id))) continue;
    seen.add(String(id));
    output.push({
      track_id: String(id),
      title: track?.name || track?.title || track?.trackTitle || null,
      album_name: track?.album?.title || track?.album?.name || track?.albumTitle || null,
    });
  }
  return output;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'cache-control': 'no-cache',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.code != null && Number(payload.code) !== 2000000) {
    throw new Error(`FLO code ${payload.code}: ${String(payload?.message || 'unknown').slice(0, 120)}`);
  }
  return payload;
}

async function discoverArtist(fetchImpl, artist) {
  for (const alias of artist.aliases) {
    const payload = await fetchJson(fetchImpl, floSearchUrl(alias, 'ARTIST', 10));
    const artistId = parseFloArtistId(payload, artist.aliases);
    if (artistId) return artistId;
  }
  return null;
}

async function discoverAlbums(fetchImpl, artist) {
  for (const alias of artist.aliases) {
    const payload = await fetchJson(fetchImpl, floSearchUrl(alias, 'ALBUM'));
    const albums = parseFloAlbums(payload, artist.aliases);
    if (albums.length) return albums;
  }
  return [];
}

function rotatingBatch(items, observedAt) {
  if (items.length <= FLO_ALBUM_BATCH) return items;
  const start = (Math.floor(observedAt / DAY_MS) * FLO_ALBUM_BATCH) % items.length;
  return Array.from({ length: FLO_ALBUM_BATCH }, (_, offset) => items[(start + offset) % items.length]);
}

export async function collectFlo(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let artists = 0;
  let albums = 0;
  let tracks = 0;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      const artistId = await discoverArtist(fetchImpl, artist);
      if (!artistId) throw new Error('artist id not found');
      await saveRegionalArtist(env, {
        service: 'flo',
        canonical_artist: canonicalArtist,
        service_artist_id: artistId,
        display_name: artist.aliases[1],
        profile_url: floSearchUrl(artist.aliases[1], 'ARTIST', 10),
        observed_at: observedAt,
      });
      artists += 1;

      const albumBatch = rotatingBatch(await discoverAlbums(fetchImpl, artist), observedAt);
      for (const album of albumBatch) {
        try {
          const payload = await fetchJson(fetchImpl, floAlbumTracksUrl(album.id));
          albums += 1;
          for (const entry of parseFloAlbumTracks(payload, artist.aliases)) {
            await saveRegionalTrack(env, {
              service: 'flo',
              service_track_id: entry.track_id,
              service_artist_id: artistId,
              canonical_artist: canonicalArtist,
              title: entry.title,
              album_name: entry.album_name || album.title,
              track_url: floAlbumUrl(album.id),
              observed_at: observedAt,
            });
            tracks += 1;
          }
        } catch (error) {
          failures.push({ canonical_artist: canonicalArtist, album_id: album.id, error: String(error?.message || error) });
        }
      }

      if (!albumBatch.length) throw new Error('album catalog empty');
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : (artists || tracks) ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'flo',
    status,
    last_attempt_at: observedAt,
    last_success_at: (artists || tracks) ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, albums, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'flo', status, artists, albums, tracks, failures };
}
