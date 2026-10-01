import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

const GAANA_TRACK_LIMIT = 30;

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

export function gaanaArtistSearchUrl(query) {
  const params = new URLSearchParams({
    geoLocation:'IN', query, content_filter:'2', include:'artist', isRegSrch:'0',
    webVersion:'mix', rType:'web', autocomplete:'0', startIndex:'0',
  });
  return `https://gsearch.gaana.com/vichitih/go/v2/?${params}`;
}

export function gaanaArtistTracksUrl(artistId) {
  const params = new URLSearchParams({ sortBy:'popularity', sortOrder:'0', request_type:'web', pkc:'true', st:'hls', song_type:'new', limit:'0,20' });
  return `https://a1api.gaana.com/home/artist/tracks/${encodeURIComponent(artistId)}?${params}`;
}

export function gaanaArtistUrl(seokey) {
  return `https://gaana.com/artist/${encodeURIComponent(seokey)}`;
}

export function gaanaSongUrl(seokey) {
  return `https://gaana.com/song/${encodeURIComponent(seokey)}`;
}

function searchResults(payload) {
  const groups = Array.isArray(payload?.gr) ? payload.gr : [];
  return groups.flatMap((group) => Array.isArray(group?.gd) ? group.gd : []);
}

export function parseGaanaArtist(payload, aliases) {
  const wanted = new Set(aliases.map(normalize));
  for (const item of searchResults(payload)) {
    const name = item?.ti || item?.name || item?.title || '';
    if (!wanted.has(normalize(name))) continue;
    const id = item?.id ?? item?.artist_id ?? item?.entity_id;
    const seokey = item?.seo || item?.seokey;
    if (id == null || !seokey) continue;
    return { id: String(id), seokey: String(seokey), name };
  }
  return null;
}

function entityInfo(entity, key) {
  const list = Array.isArray(entity?.entity_info) ? entity.entity_info : [];
  return list.find((item) => item?.key === key)?.value;
}

function entityArtists(entity) {
  const value = entityInfo(entity, 'artist');
  return Array.isArray(value) ? value : [];
}

export function parseGaanaTopTracks(payload, aliases, artistId) {
  const entities = Array.isArray(payload?.entities) ? payload.entities : [];
  const wanted = new Set(aliases.map(normalize));
  const output = [];
  const seen = new Set();

  for (const [index, entity] of entities.entries()) {
    const artists = entityArtists(entity);
    const belongs = artists.some((artist) =>
      String(artist?.artist_id ?? artist?.id ?? '') === String(artistId)
      || wanted.has(normalize(artist?.name)));
    if (!belongs) continue;

    const trackId = entity?.entity_id ?? entity?.track_id ?? entity?.id;
    const seokey = entity?.seokey ?? entity?.seo;
    if (trackId == null || !seokey || seen.has(String(trackId))) continue;
    seen.add(String(trackId));

    const albumValue = entityInfo(entity, 'album');
    const album = Array.isArray(albumValue) ? albumValue[0] : null;
    output.push({
      track_id: String(trackId),
      title: entity?.name || entity?.title || null,
      album_name: album?.name || null,
      seokey: String(seokey),
      popularity_rank: index + 1,
    });
    if (output.length >= GAANA_TRACK_LIMIT) break;
  }
  return output;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://gaana.com/',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (!body.trim()) throw new Error('current public search endpoint returned an empty catalog response');
  if (/^\s*</.test(body)) throw new Error('current catalog endpoint returned website HTML instead of JSON');
  return JSON.parse(body);
}

async function discoverArtist(fetchImpl, artist) {
  for (const alias of artist.aliases) {
    const found = parseGaanaArtist(await fetchJson(fetchImpl, gaanaArtistSearchUrl(alias)), artist.aliases);
    if (found) return found;
  }
  return null;
}

export async function collectGaana(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let artists = 0;
  let tracks = 0;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      const profile = await discoverArtist(fetchImpl, artist);
      if (!profile) throw new Error('artist id not found');
      await saveRegionalArtist(env, {
        service: 'gaana',
        canonical_artist: canonicalArtist,
        service_artist_id: profile.id,
        display_name: profile.name || artist.aliases[1],
        profile_url: gaanaArtistUrl(profile.seokey),
        observed_at: observedAt,
      });
      artists += 1;

      const entries = parseGaanaTopTracks(
        await fetchJson(fetchImpl, gaanaArtistTracksUrl(profile.id)),
        artist.aliases,
        profile.id,
      );
      for (const entry of entries) {
        await saveRegionalTrack(env, {
          service: 'gaana',
          service_track_id: entry.track_id,
          service_artist_id: profile.id,
          canonical_artist: canonicalArtist,
          title: entry.title,
          album_name: entry.album_name,
          track_url: gaanaSongUrl(entry.seokey),
          popularity_rank: entry.popularity_rank,
          observed_at: observedAt,
        });
        tracks += 1;
      }
      if (!entries.length) throw new Error('artist top-track list empty');
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : (artists || tracks) ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'gaana',
    status,
    last_attempt_at: observedAt,
    last_success_at: (artists || tracks) ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'gaana', status, artists, tracks, failures };
}
