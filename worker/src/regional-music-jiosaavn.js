import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import {
  saveRegionalArtist,
  saveRegionalCollectorState,
  saveRegionalTrack,
} from './regional-music-store.js';

const JIOSAAVN_TRACK_LIMIT = 50;

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
}

function apiUrl(call, params = {}) {
  const query = new URLSearchParams({
    __call: call,
    _format: 'json',
    _marker: '0',
    ctx: 'web6dot0',
    api_version: '4',
    cc: 'in',
    ...params,
  });
  return `https://www.jiosaavn.com/api.php?${query}`;
}

export function jioSaavnAutocompleteUrl(query) {
  return apiUrl('autocomplete.get', { query, includeMetaTags: '1' });
}

export function jioSaavnSongSearchUrl(query, page = 1) {
  return apiUrl('search.getResults', { q: query, n: String(JIOSAAVN_TRACK_LIMIT), p: String(page) });
}

export function jioSaavnArtistUrl(artistId) {
  return `https://www.jiosaavn.com/artist/_/${encodeURIComponent(artistId)}`;
}

function artistCandidates(payload) {
  const section = payload?.artists;
  if (Array.isArray(section)) return section;
  if (Array.isArray(section?.data)) return section.data;
  if (Array.isArray(section?.results)) return section.results;
  return [];
}

function itemName(item) {
  return item?.title || item?.name || item?.artist || item?.description || '';
}

export function parseJioSaavnArtist(payload, aliases) {
  const wanted = new Set(aliases.map(normalize));
  for (const item of artistCandidates(payload)) {
    if (!wanted.has(normalize(itemName(item)))) continue;
    const id = item?.id ?? item?.artist_id ?? item?.artistId;
    if (id == null) continue;
    return {
      id: String(id),
      name: itemName(item),
      url: item?.url || item?.perma_url || item?.permaUrl || null,
    };
  }
  return null;
}

function songCandidates(payload) {
  for (const candidate of [payload?.results, payload?.songs, payload?.data?.results, payload?.data?.songs, payload?.data]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function splitNames(value) {
  if (Array.isArray(value)) return value.flatMap((item) => typeof item === 'string' ? [item] : [item?.name || item?.title || '']).filter(Boolean);
  return String(value || '').split(/,|&| feat\.? | ft\.? /i).map((part) => part.trim()).filter(Boolean);
}

function songArtists(song) {
  const names = [];
  for (const field of [song?.primary_artists, song?.primaryArtists, song?.artists, song?.singers, song?.artist]) {
    names.push(...splitNames(field));
  }
  return names;
}

export function parseJioSaavnTracks(payload, aliases, artistId = null) {
  const wanted = new Set(aliases.map(normalize));
  const output = [];
  const seen = new Set();
  for (const song of songCandidates(payload)) {
    const names = songArtists(song).map(normalize);
    const ids = String(song?.primary_artists_id || song?.primaryArtistsId || song?.artist_ids || '')
      .split(',').map((id) => id.trim()).filter(Boolean);
    if (!names.some((name) => wanted.has(name)) && !(artistId && ids.includes(String(artistId)))) continue;
    const id = song?.id ?? song?.songid ?? song?.song_id;
    if (id == null || seen.has(String(id))) continue;
    seen.add(String(id));
    output.push({
      track_id: String(id),
      title: song?.title || song?.song || song?.name || null,
      album_name: song?.album?.name || song?.album || song?.album_name || null,
      url: song?.perma_url || song?.permaUrl || song?.url || null,
    });
  }
  return output;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://www.jiosaavn.com/',
      cookie: 'L=english; gdpr_acceptance=true; DL=english',
      'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function discoverArtist(fetchImpl, artist) {
  for (const alias of artist.aliases) {
    const found = parseJioSaavnArtist(await fetchJson(fetchImpl, jioSaavnAutocompleteUrl(alias)), artist.aliases);
    if (found) return found;
  }
  return null;
}

export async function collectJioSaavn(env, observedAt = Date.now(), fetchImpl = fetch) {
  const failures = [];
  let artists = 0;
  let tracks = 0;

  for (const [canonicalArtist, artist] of Object.entries(REGIONAL_MUSIC_ARTISTS)) {
    try {
      const profile = await discoverArtist(fetchImpl, artist);
      if (!profile) throw new Error('artist id not found');
      await saveRegionalArtist(env, {
        service: 'jiosaavn',
        canonical_artist: canonicalArtist,
        service_artist_id: profile.id,
        display_name: profile.name || artist.aliases[1],
        profile_url: profile.url || jioSaavnArtistUrl(profile.id),
        observed_at: observedAt,
      });
      artists += 1;

      let entries = [];
      for (const alias of artist.aliases) {
        entries = parseJioSaavnTracks(
          await fetchJson(fetchImpl, jioSaavnSongSearchUrl(alias)),
          artist.aliases,
          profile.id,
        );
        if (entries.length) break;
      }
      for (const entry of entries) {
        await saveRegionalTrack(env, {
          service: 'jiosaavn',
          service_track_id: entry.track_id,
          service_artist_id: profile.id,
          canonical_artist: canonicalArtist,
          title: entry.title,
          album_name: entry.album_name,
          track_url: entry.url,
          observed_at: observedAt,
        });
        tracks += 1;
      }
      if (!entries.length) throw new Error('artist song search returned no matches');
    } catch (error) {
      failures.push({ canonical_artist: canonicalArtist, error: String(error?.message || error) });
    }
  }

  const status = failures.length === 0 ? 'ok' : (artists || tracks) ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'jiosaavn',
    status,
    last_attempt_at: observedAt,
    last_success_at: (artists || tracks) ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: { artists, tracks, failures: failures.length },
    updated_at: observedAt,
  });
  return { service: 'jiosaavn', status, artists, tracks, failures };
}
