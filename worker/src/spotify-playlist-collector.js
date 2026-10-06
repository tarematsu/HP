import { canonicalizeTrackRows } from '../../site/functions/lib/canonical-track-rows.js';
import { pagesR2ResponseKey } from './pages-response-r2.js';

export const SPOTIFY_PLAYLIST_PAGES_MODEL_KEY = 'spotify-playlists';
export const SPOTIFY_PLAYLIST_STATE_KEY = 'spotify/playlists/state.json';
export const SPOTIFY_PLAYLIST_MODEL_KEY = 'spotify/playlists/latest.json';
export const SPOTIFY_PLAYLIST_BATCH_SIZE = 20;

const TARGET_ARTIST_ID = '0Ti7MfCiVVQAK8zLSiqlto';
const TARGET_ARTIST_NAME = '櫻坂46';
const MAX_KNOWN_PLAYLISTS = 600;
const MAX_RELATED_LINKS_PER_PAGE = 20;
const PUBLIC_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

export const SPOTIFY_PLAYLIST_DISCOVERY_SEEDS = Object.freeze([
  `https://open.spotify.com/artist/${TARGET_ARTIST_ID}`,
  'https://open.spotify.com/search/%E6%AB%BB%E5%9D%8246/playlists',
  'https://open.spotify.com/search/Sakurazaka46/playlists',
]);

// Public playlist URLs verified from open.spotify.com. They are only bootstrap
// seeds: discovery pages can add new editorial/community playlists every sweep.
export const SPOTIFY_PLAYLIST_BOOTSTRAP_URLS = Object.freeze([
  'https://open.spotify.com/playlist/11wvFhPaw51JOMziFTYvNq',
  'https://open.spotify.com/playlist/5fDiONcQwG6qSjhpj2EdOP',
  'https://open.spotify.com/playlist/2MRqgbZV6n3X3Nj3Ibf87Q',
  'https://open.spotify.com/playlist/6UxKUkX9Ja3KEKBPp7ubun',
  'https://open.spotify.com/playlist/7bFe5bipiFcztzWFTVMPx5',
  'https://open.spotify.com/playlist/3j7CoI1Z0hlgeoamzjSzOW',
  'https://open.spotify.com/playlist/5EEzDm0Lj7iYDGwpBzzzn4',
  'https://open.spotify.com/playlist/2L6x2wyqCWLBUfKXL2sXZx',
]);

function text(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function positiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function jstDate(now = Date.now()) {
  const date = new Date(Number(now) + 9 * 60 * 60_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function decodeHtml(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function playlistIdFromUrl(value) {
  const match = String(value || '').match(/\/(?:embed\/)?playlist\/([A-Za-z0-9]{22})(?:[/?#]|$)/u);
  return match?.[1] || null;
}

function canonicalPlaylistUrl(value) {
  const raw = decodeHtml(String(value || '').replaceAll('\\/', '/'));
  try {
    const url = new URL(raw, 'https://open.spotify.com');
    if (url.hostname !== 'open.spotify.com') return null;
    const id = playlistIdFromUrl(url.pathname);
    return id ? `https://open.spotify.com/playlist/${id}` : null;
  } catch {
    return null;
  }
}

function embedPlaylistUrl(id) {
  return `https://open.spotify.com/embed/playlist/${encodeURIComponent(id)}`;
}

export function extractSpotifyPlaylistLinks(html) {
  const source = String(html || '')
    .replaceAll('\\/', '/')
    .replaceAll('\\u002F', '/');
  const seen = new Set();
  const links = [];
  const patterns = [
    /href=["']([^"']*\/(?:embed\/)?playlist\/[A-Za-z0-9]{22}[^"']*)["']/giu,
    /(https:\/\/open\.spotify\.com\/(?:embed\/)?playlist\/[A-Za-z0-9]{22}[^"'<>\s]*)/giu,
    /(\/(?:embed\/)?playlist\/[A-Za-z0-9]{22}(?:[/?#][^"'<>\s]*)?)/giu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const candidate = String(match[1] || match[0] || '');
      const url = canonicalPlaylistUrl(candidate);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      links.push(url);
    }
  }
  return links;
}

function nextData(html) {
  const match = String(html || '').match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/iu);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(decodeHtml(match[1]));
  } catch {
    return null;
  }
}

function nestedStrings(value, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => nestedStrings(item, depth + 1));
  if (typeof value !== 'object') return [];
  return Object.values(value).flatMap((item) => nestedStrings(item, depth + 1));
}

function findEntityWithTrackList(value, depth = 0) {
  if (depth > 14 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findEntityWithTrackList(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  if (Array.isArray(value.trackList)) return value;
  for (const child of Object.values(value)) {
    const found = findEntityWithTrackList(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function spotifyTrackId(value) {
  for (const item of nestedStrings(value)) {
    const uri = String(item).match(/^spotify:track:([A-Za-z0-9]{22})$/u);
    if (uri) return uri[1];
    const url = String(item).match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/u);
    if (url) return url[1];
  }
  return null;
}

function normalizedArtist(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s\u00a0]+/gu, '')
    .toLocaleLowerCase('ja-JP');
}

function targetTrack(row) {
  const strings = nestedStrings(row);
  if (strings.some((value) => String(value).includes(`spotify:artist:${TARGET_ARTIST_ID}`)
    || String(value).includes(`/artist/${TARGET_ARTIST_ID}`))) return true;
  return strings.some((value) => {
    const normalized = normalizedArtist(value);
    return normalized === '櫻坂46'
      || normalized === 'sakurazaka46'
      || normalized.includes('sakurazaka46');
  });
}

function firstImageUrl(value) {
  return nestedStrings(value).find((item) => /^https:\/\/[^\s]+(?:jpg|jpeg|png|webp)(?:\?|$)/iu.test(item)) || null;
}

function rowTitle(row) {
  return text(row?.title ?? row?.name ?? row?.track?.name);
}

function rowArtist(row) {
  const direct = text(row?.subtitle ?? row?.artist ?? row?.artistName ?? row?.track?.artistName);
  if (direct) return direct;
  const artists = Array.isArray(row?.track?.artists) ? row.track.artists.map((item) => text(item?.name)).filter(Boolean) : [];
  return artists.length ? artists.join(', ') : null;
}

export function parseSpotifyPlaylistEmbed(html, sourceUrl) {
  const url = canonicalPlaylistUrl(sourceUrl);
  const id = playlistIdFromUrl(url);
  if (!url || !id) return null;
  const document = nextData(html);
  if (!document) return null;
  const entity = findEntityWithTrackList(document);
  if (!entity) return null;

  const tracks = [];
  const seen = new Set();
  for (const [index, row] of entity.trackList.entries()) {
    if (!row || typeof row !== 'object' || !targetTrack(row)) continue;
    const spotifyId = spotifyTrackId(row);
    const title = rowTitle(row);
    const key = spotifyId ? `spotify:${spotifyId}` : title ? `title:${title}` : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tracks.push({
      spotify_id: spotifyId,
      title,
      artist: rowArtist(row) || TARGET_ARTIST_NAME,
      position: index + 1,
      url: spotifyId ? `https://open.spotify.com/track/${spotifyId}` : null,
    });
  }

  return {
    id,
    name: text(entity?.title ?? entity?.name) || id,
    curator: text(entity?.subtitle ?? entity?.owner?.name ?? entity?.ownerName),
    url,
    artwork: firstImageUrl(entity),
    tracks,
    related_urls: extractSpotifyPlaylistLinks(html)
      .filter((item) => item !== url)
      .slice(0, MAX_RELATED_LINKS_PER_PAGE),
  };
}

async function getJson(r2, key) {
  if (typeof r2?.get !== 'function') return null;
  const object = await r2.get(key);
  if (!object) return null;
  try {
    if (typeof object.json === 'function') return await object.json();
    if (typeof object.text === 'function') return JSON.parse(await object.text());
  } catch {
    return null;
  }
  return null;
}

async function putJson(r2, key, value, metadata = {}) {
  const body = JSON.stringify(value);
  await r2.put(key, body, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: Object.fromEntries(Object.entries(metadata).map(([name, item]) => [name, String(item)])),
  });
  return body.length;
}

async function fetchHtml(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    },
    redirect: 'follow',
  });
  if (!response?.ok) throw new Error(`Spotify page HTTP ${response?.status || 0}: ${url}`);
  return response.text();
}

function stateEntries(state) {
  return new Map((Array.isArray(state?.playlists) ? state.playlists : [])
    .filter((entry) => canonicalPlaylistUrl(entry?.url))
    .map((entry) => [canonicalPlaylistUrl(entry.url), {
      url: canonicalPlaylistUrl(entry.url),
      id: playlistIdFromUrl(entry.url),
      name: text(entry.name),
      curator: text(entry.curator),
      artwork: text(entry.artwork),
      priority: Number.isFinite(Number(entry.priority)) ? Number(entry.priority) : 999999,
      discovered_at: Number(entry.discovered_at) || null,
      last_scanned_at: Number(entry.last_scanned_at) || null,
      last_match_at: Number(entry.last_match_at) || null,
      last_error: text(entry.last_error),
      tracks: Array.isArray(entry.tracks) ? entry.tracks : [],
    }]));
}

function upsertDiscovery(map, url, now, priority) {
  const canonical = canonicalPlaylistUrl(url);
  if (!canonical) return;
  const existing = map.get(canonical);
  if (existing) {
    existing.priority = Math.min(existing.priority ?? 999999, priority);
    return;
  }
  if (map.size >= MAX_KNOWN_PLAYLISTS) return;
  map.set(canonical, {
    url: canonical,
    id: playlistIdFromUrl(canonical),
    name: null,
    curator: null,
    artwork: null,
    priority,
    discovered_at: now,
    last_scanned_at: null,
    last_match_at: null,
    last_error: null,
    tracks: [],
  });
}

export function selectSpotifyPlaylistBatch(entries, limit = SPOTIFY_PLAYLIST_BATCH_SIZE) {
  const values = entries instanceof Map ? [...entries.values()] : Array.isArray(entries) ? entries : [];
  return values
    .sort((a, b) => {
      const aNever = a.last_scanned_at ? 1 : 0;
      const bNever = b.last_scanned_at ? 1 : 0;
      if (aNever !== bNever) return aNever - bNever;
      return (a.last_scanned_at || 0) - (b.last_scanned_at || 0)
        || (a.tracks?.length ? 0 : 1) - (b.tracks?.length ? 0 : 1)
        || (a.priority || 999999) - (b.priority || 999999)
        || String(a.url).localeCompare(String(b.url));
    })
    .slice(0, Math.max(0, Number(limit) || 0));
}

async function canonicalizePlaylistTracks(db, playlists) {
  const flattened = [];
  const counts = [];
  for (const playlist of playlists) {
    const tracks = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
    counts.push(tracks.length);
    flattened.push(...tracks.map((track) => ({
      ...track,
      spotify_id: text(track?.spotify_id),
      title: text(track?.title),
      artist: text(track?.artist),
    })));
  }
  if (!flattened.length) return playlists;
  const canonical = await canonicalizeTrackRows(db, flattened);
  let offset = 0;
  return playlists.map((playlist, index) => {
    const count = counts[index];
    const tracks = canonical.slice(offset, offset + count);
    offset += count;
    return { ...playlist, tracks };
  });
}

async function publicModel(entries, env, observedAt, seedResults, scannedCount) {
  let matchedPlaylists = [...entries.values()]
    .filter((entry) => Array.isArray(entry.tracks) && entry.tracks.length)
    .map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      curator: entry.curator,
      url: entry.url,
      artwork: entry.artwork,
      last_scanned_at: entry.last_scanned_at,
      tracks: entry.tracks.map((track) => ({
        spotify_id: text(track.spotify_id),
        track_id: positiveInteger(track.track_id),
        title: text(track.title) || '曲名不明',
        artist: text(track.artist) || TARGET_ARTIST_NAME,
        position: Number(track.position) || null,
        url: text(track.url),
      })),
    }));
  matchedPlaylists = await canonicalizePlaylistTracks(env?.MINUTE_DB, matchedPlaylists);
  matchedPlaylists.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja'));

  const grouped = new Map();
  for (const playlist of matchedPlaylists) {
    for (const track of playlist.tracks) {
      const key = positiveInteger(track.track_id) != null
        ? `track:${positiveInteger(track.track_id)}`
        : track.spotify_id
          ? `spotify:${track.spotify_id}`
          : `title:${track.title}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          track_id: positiveInteger(track.track_id),
          spotify_id: text(track.spotify_id),
          title: text(track.title) || '曲名不明',
          artist: text(track.artist) || TARGET_ARTIST_NAME,
          playlists: [],
        });
      }
      grouped.get(key).playlists.push({
        id: playlist.id,
        name: playlist.name,
        curator: playlist.curator,
        url: playlist.url,
        position: track.position,
      });
    }
  }

  return {
    version: 1,
    source: 'open.spotify.com-public-pages',
    artist_id: TARGET_ARTIST_ID,
    artist_name: TARGET_ARTIST_NAME,
    observed_at: observedAt,
    scan_date: jstDate(observedAt),
    coverage: {
      seed_pages: SPOTIFY_PLAYLIST_DISCOVERY_SEEDS.length,
      seed_pages_succeeded: seedResults.filter((item) => item.ok).length,
      bootstrap_playlists: SPOTIFY_PLAYLIST_BOOTSTRAP_URLS.length,
      known_playlists: entries.size,
      scanned_this_run: scannedCount,
      matched_playlists: matchedPlaylists.length,
    },
    playlists: matchedPlaylists,
    tracks: [...grouped.values()].sort((a, b) => String(a.title).localeCompare(String(b.title), 'ja')),
  };
}

async function publishReadModel(r2, model, observedAt) {
  const body = JSON.stringify({ ok: true, ...model });
  const objectKey = pagesR2ResponseKey(SPOTIFY_PLAYLIST_PAGES_MODEL_KEY);
  if (!objectKey) throw new Error('Spotify playlist public read-model key is unavailable');
  const envelope = {
    version: 1,
    status: 200,
    headers: PUBLIC_HEADERS,
    updated_at: observedAt,
    cadence_seconds: 43_200,
    source_revision: `spotify-playlists:${model.scan_date}:${observedAt}`,
    renderer_revision: 'spotify-playlists-v1',
    body,
  };
  await r2.put(objectKey, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return { objectKey, bytes: body.length };
}

export async function collectSpotifyPlaylists(
  env,
  now = Date.now(),
  fetchImpl = fetch,
  { discover = true } = {},
) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.get !== 'function' || typeof r2?.put !== 'function') {
    throw new Error('PAGES_RESPONSE_R2 binding is required');
  }
  const observedAt = Number(now) || Date.now();
  const entries = stateEntries(await getJson(r2, SPOTIFY_PLAYLIST_STATE_KEY));
  const previousState = await getJson(r2, SPOTIFY_PLAYLIST_STATE_KEY);
  let seedResults = Array.isArray(previousState?.seeds) ? previousState.seeds : [];

  if (discover) {
    SPOTIFY_PLAYLIST_BOOTSTRAP_URLS.forEach((url, index) => upsertDiscovery(entries, url, observedAt, index));
    const settled = await Promise.allSettled(SPOTIFY_PLAYLIST_DISCOVERY_SEEDS.map(async (url, seedIndex) => ({
      url,
      seedIndex,
      html: await fetchHtml(fetchImpl, url),
    })));
    seedResults = [];
    settled.forEach((result, seedIndex) => {
      if (result.status === 'fulfilled') {
        const links = extractSpotifyPlaylistLinks(result.value.html);
        links.forEach((url, linkIndex) => upsertDiscovery(entries, url, observedAt, 1000 + seedIndex * 1000 + linkIndex));
        seedResults.push({ url: SPOTIFY_PLAYLIST_DISCOVERY_SEEDS[seedIndex], ok: true, discovered: links.length });
      } else {
        seedResults.push({
          url: SPOTIFY_PLAYLIST_DISCOVERY_SEEDS[seedIndex],
          ok: false,
          error: String(result.reason?.message || result.reason || 'unknown error').slice(0, 240),
        });
      }
    });
  }

  if (!entries.size) throw new Error('Spotify playlist discovery returned no playlist links');

  const candidates = selectSpotifyPlaylistBatch(entries);
  const scanned = await Promise.all(candidates.map(async (entry) => {
    try {
      const html = await fetchHtml(fetchImpl, embedPlaylistUrl(entry.id));
      return { entry, parsed: parseSpotifyPlaylistEmbed(html, entry.url), error: null };
    } catch (error) {
      return { entry, parsed: null, error: String(error?.message || error || 'unknown error').slice(0, 240) };
    }
  }));

  scanned.forEach((result) => {
    if (result.parsed) {
      const { entry, parsed } = result;
      Object.assign(entry, {
        id: parsed.id,
        name: parsed.name,
        curator: parsed.curator,
        artwork: parsed.artwork,
        last_scanned_at: observedAt,
        last_match_at: parsed.tracks.length ? observedAt : entry.last_match_at,
        last_error: null,
        tracks: parsed.tracks,
      });
      parsed.related_urls.forEach((url, index) => {
        upsertDiscovery(entries, url, observedAt, (entry.priority || 999999) + 100 + index);
      });
    } else {
      result.entry.last_scanned_at = observedAt;
      result.entry.last_error = result.error || 'playlist parse failed';
    }
  });

  const state = {
    version: 1,
    source: 'open.spotify.com-public-pages',
    artist_id: TARGET_ARTIST_ID,
    scan_date: jstDate(observedAt),
    observed_at: observedAt,
    seeds: seedResults,
    playlists: [...entries.values()].slice(0, MAX_KNOWN_PLAYLISTS),
  };
  const model = await publicModel(entries, env, observedAt, seedResults, candidates.length);
  let bytesWritten = 0;
  bytesWritten += await putJson(r2, SPOTIFY_PLAYLIST_MODEL_KEY, model, { scanDate: model.scan_date, observedAt });
  const published = await publishReadModel(r2, model, observedAt);
  bytesWritten += published.bytes;
  bytesWritten += await putJson(r2, SPOTIFY_PLAYLIST_STATE_KEY, state, { scanDate: model.scan_date, observedAt });

  return {
    ok: true,
    service: 'spotify',
    scan_date: model.scan_date,
    discovered: discover,
    known_playlists: entries.size,
    scanned_playlists: candidates.length,
    matched_playlists: model.playlists.length,
    matched_tracks: model.tracks.length,
    bytes_written: bytesWritten,
    pages_object_key: published.objectKey,
  };
}
