import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

export const APPLE_MUSIC_PLAYLIST_PAGES_MODEL_KEY = 'apple-music-playlists';

const TARGET_ARTIST_ID = '1541126420';
const TARGET_ARTIST_NAME = '櫻坂46';
const STATE_KEY = 'apple-music/playlists/state.json';
const LATEST_KEY = 'apple-music/playlists/latest.json';
const APPLE_MODEL_KEY = 'apple-music/read-model/latest.json';
const MAX_PLAYLISTS_PER_RUN = 20;
const MAX_KNOWN_PLAYLISTS = 600;
const MAX_RELATED_LINKS_PER_PAGE = 12;
const PUBLIC_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

export const APPLE_MUSIC_PLAYLIST_SEEDS = Object.freeze([
  'https://music.apple.com/jp/artist/-/1541126420',
  'https://music.apple.com/jp/room/6503392297',
  'https://music.apple.com/jp/search?term=%E6%AB%BB%E5%9D%8246',
  'https://music.apple.com/jp/new/top-charts/playlists',
  'https://music.apple.com/jp/genre/j-pop/27',
]);

function text(value) {
  if (value === null || value === undefined) return null;
  const parsed = String(value).trim();
  return parsed || null;
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
  const match = String(value || '').match(/\/(pl\.[A-Za-z0-9]+)(?:[/?#]|$)/u);
  return match?.[1] || null;
}

function songIdFromUrl(value) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw, 'https://music.apple.com');
    const item = url.searchParams.get('i');
    if (/^\d+$/u.test(String(item || ''))) return String(item);
    const match = url.pathname.match(/\/(?:song|album)\/[^/]+\/(\d+)$/u);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function canonicalPlaylistUrl(value) {
  const raw = decodeHtml(value);
  try {
    const url = new URL(raw, 'https://music.apple.com');
    if (url.hostname !== 'music.apple.com') return null;
    const id = playlistIdFromUrl(url.toString());
    if (!id) return null;
    url.protocol = 'https:';
    url.hostname = 'music.apple.com';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function extractAppleMusicPlaylistLinks(html) {
  const source = String(html || '');
  const seen = new Set();
  const links = [];
  const patterns = [
    /href=["']([^"']*\/playlist\/[^"']*\/pl\.[A-Za-z0-9]+[^"']*)["']/giu,
    /"(https:\\?\/\\?\/music\.apple\.com\\?\/jp\\?\/playlist\\?\/[^\"]*\\?\/pl\.[A-Za-z0-9]+[^\"]*)"/giu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const candidate = String(match[1] || '').replaceAll('\\/', '/');
      const url = canonicalPlaylistUrl(candidate);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      links.push(url);
    }
  }
  return links;
}

function jsonLdDocuments(html) {
  const source = String(html || '');
  const documents = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu;
  for (const match of source.matchAll(regex)) {
    try {
      documents.push(JSON.parse(decodeHtml(match[1])));
    } catch {
      // Ignore malformed or non-JSON structured-data blocks.
    }
  }
  return documents;
}

function serializedServerDocuments(html) {
  const source = String(html || '');
  const documents = [];
  const regex = /<script[^>]+id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/giu;
  for (const match of source.matchAll(regex)) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    for (const candidate of [raw, decodeHtml(raw)]) {
      try {
        documents.push(JSON.parse(candidate));
        break;
      } catch {
        // Try the HTML-decoded variant before giving up.
      }
    }
  }
  return documents;
}

function schemaTypes(value) {
  return Array.isArray(value) ? value.map(String) : [String(value || '')];
}

function isMusicRecording(node) {
  return node && typeof node === 'object' && schemaTypes(node['@type']).includes('MusicRecording');
}

function artistDetails(value) {
  const values = Array.isArray(value) ? value : [value];
  const names = [];
  const urls = [];
  for (const item of values) {
    if (typeof item === 'string') {
      names.push(item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    if (text(item.name)) names.push(text(item.name));
    const url = text(item.url || item['@id']);
    if (url) urls.push(url);
  }
  return { names, urls };
}

function targetArtist(recording) {
  const artists = artistDetails(recording?.byArtist || recording?.artist || recording?.creator);
  if (artists.urls.some((url) => String(url).includes(`/${TARGET_ARTIST_ID}`))) return true;
  return artists.names.some((name) => {
    const normalized = String(name).normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('ja-JP');
    return normalized === '櫻坂46' || normalized === 'sakurazaka46';
  });
}

function normalizedTrackTitle(value) {
  const valueText = text(value);
  return valueText
    ? valueText.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[\s\u00a0]+/gu, '')
    : null;
}

function pushTrackCandidate(tracks, seen, { appleMusicId, title, url, position }) {
  const idKey = appleMusicId ? `id:${appleMusicId}` : null;
  const normalizedTitle = normalizedTrackTitle(title);
  const titleKey = normalizedTitle ? `title:${normalizedTitle}` : null;
  if (!idKey && !titleKey) return;
  if ((idKey && seen.has(idKey)) || (titleKey && seen.has(titleKey))) return;
  if (idKey) seen.add(idKey);
  if (titleKey) seen.add(titleKey);
  tracks.push({
    apple_music_id: appleMusicId || null,
    title: text(title),
    url: text(url),
    position: Number.isInteger(Number(position)) && Number(position) > 0 ? Number(position) : tracks.length + 1,
  });
}

function recordTrack(tracks, seen, recording, position = null) {
  if (!isMusicRecording(recording) || !targetArtist(recording)) return;
  const url = text(recording.url || recording['@id']);
  pushTrackCandidate(tracks, seen, {
    appleMusicId: songIdFromUrl(url),
    title: text(recording.name),
    url,
    position,
  });
}

function collectRecordings(node, tracks, seen, inheritedPosition = null) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectRecordings(item, tracks, seen, inheritedPosition ?? index + 1));
    return;
  }
  if (!node || typeof node !== 'object') return;

  if (node.item && isMusicRecording(node.item)) {
    recordTrack(tracks, seen, node.item, node.position ?? inheritedPosition);
  } else if (isMusicRecording(node)) {
    recordTrack(tracks, seen, node, node.position ?? inheritedPosition);
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'item' && isMusicRecording(value)) continue;
    collectRecordings(value, tracks, seen, inheritedPosition);
  }
}

function nestedStrings(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => nestedStrings(item, depth + 1));
  if (typeof value !== 'object') return [];
  return Object.values(value).flatMap((item) => nestedStrings(item, depth + 1));
}

function targetArtistName(value) {
  const normalized = String(value || '').normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('ja-JP');
  return normalized === '櫻坂46' || normalized === 'sakurazaka46';
}

function serializedTrackIsTarget(item) {
  if (!item || typeof item !== 'object') return false;
  if (String(item.artistId || item.artistID || '') === TARGET_ARTIST_ID) return true;
  const artistFields = Object.entries(item)
    .filter(([key]) => /artist/iu.test(key))
    .flatMap(([, value]) => nestedStrings(value));
  return artistFields.some((value) => targetArtistName(value) || String(value).includes(`/${TARGET_ARTIST_ID}`));
}

function firstSerializedTrackUrl(item) {
  const queue = [{ value: item, depth: 0 }];
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (depth > 5 || value === null || value === undefined) continue;
    if (typeof value === 'string') {
      if ((value.includes('music.apple.com') || value.startsWith('/')) && songIdFromUrl(value)) {
        try {
          return new URL(value, 'https://music.apple.com').toString();
        } catch {
          // Ignore malformed URLs.
        }
      }
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((child) => queue.push({ value: child, depth: depth + 1 }));
      continue;
    }
    if (typeof value === 'object') {
      Object.values(value).forEach((child) => queue.push({ value: child, depth: depth + 1 }));
    }
  }
  return null;
}

function serializedTrackId(item, url) {
  const fromUrl = songIdFromUrl(url);
  if (fromUrl) return fromUrl;
  for (const key of ['songId', 'songID', 'adamId', 'adamID', 'contentId', 'id']) {
    const value = text(item?.[key]);
    if (/^\d+$/u.test(String(value || ''))) return value;
  }
  return null;
}

function recordSerializedTrack(tracks, seen, item, position) {
  if (!serializedTrackIsTarget(item)) return;
  const url = firstSerializedTrackUrl(item);
  pushTrackCandidate(tracks, seen, {
    appleMusicId: serializedTrackId(item, url),
    title: text(item?.title || item?.name),
    url,
    position,
  });
}

function collectSerializedTracks(node, tracks, seen) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectSerializedTracks(item, tracks, seen));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (node.itemKind === 'trackLockup' && Array.isArray(node.items)) {
    node.items.forEach((item, index) => recordSerializedTrack(tracks, seen, item, index + 1));
  }
  for (const value of Object.values(node)) collectSerializedTracks(value, tracks, seen);
}

function firstSchemaValue(documents, keys) {
  const queue = [...documents];
  while (queue.length) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    for (const key of keys) {
      const value = node[key];
      if (typeof value === 'string' && text(value)) return text(value);
      if (value && typeof value === 'object' && text(value.name)) return text(value.name);
    }
    queue.push(...Object.values(node).filter((value) => value && typeof value === 'object'));
  }
  return null;
}

function metaContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'iu'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'iu'),
  ];
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return null;
}

function cleanedPlaylistTitle(value) {
  return text(value)
    ?.replace(/\s*[-–—]\s*プレイリスト\s*[-–—]\s*Apple\s*Music.*$/iu, '')
    .replace(/\s*[-–—]\s*Playlist\s*[-–—]\s*Apple\s*Music.*$/iu, '')
    .trim() || null;
}

export function parseAppleMusicPlaylistPage(html, sourceUrl) {
  const url = canonicalPlaylistUrl(sourceUrl);
  const id = playlistIdFromUrl(url);
  if (!url || !id) return null;

  const documents = jsonLdDocuments(html);
  const tracks = [];
  const seen = new Set();
  collectRecordings(documents, tracks, seen);
  for (const document of serializedServerDocuments(html)) {
    collectSerializedTracks(document, tracks, seen);
  }

  const name = cleanedPlaylistTitle(
    firstSchemaValue(documents, ['name'])
      || metaContent(html, 'og:title')
      || metaContent(html, 'twitter:title'),
  );
  const curator = firstSchemaValue(documents, ['author', 'creator', 'provider']);
  const artwork = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');

  return {
    id,
    name: name || id,
    curator,
    url,
    artwork: text(artwork),
    tracks,
    related_urls: extractAppleMusicPlaylistLinks(html)
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
      'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Safari/537.36',
    },
    redirect: 'follow',
  });
  if (!response?.ok) throw new Error(`Apple Music page HTTP ${response?.status || 0}: ${url}`);
  return response.text();
}

function currentTrackMetadata(appleModel) {
  const byAppleId = new Map();
  for (const region of Array.isArray(appleModel?.regions) ? appleModel.regions : []) {
    for (const track of Array.isArray(region?.tracks) ? region.tracks : []) {
      const appleId = text(track?.apple_music_id);
      if (!appleId || byAppleId.has(appleId)) continue;
      const trackId = Number(track?.track_id);
      byAppleId.set(appleId, {
        track_id: Number.isSafeInteger(trackId) ? trackId : null,
        title: text(track?.title),
      });
    }
  }
  return byAppleId;
}

function stateEntries(state) {
  const entries = Array.isArray(state?.playlists) ? state.playlists : [];
  return new Map(entries
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

function scanCandidates(entries) {
  return [...entries.values()]
    .sort((a, b) => {
      const aNever = a.last_scanned_at ? 1 : 0;
      const bNever = b.last_scanned_at ? 1 : 0;
      if (aNever !== bNever) return aNever - bNever;
      return (a.last_scanned_at || 0) - (b.last_scanned_at || 0)
        || (a.tracks?.length ? 0 : 1) - (b.tracks?.length ? 0 : 1)
        || (a.priority || 999999) - (b.priority || 999999)
        || a.url.localeCompare(b.url);
    })
    .slice(0, MAX_PLAYLISTS_PER_RUN);
}

function publicModel(entries, appleModel, observedAt, seedResults, scannedCount) {
  const canonical = currentTrackMetadata(appleModel);
  const matchedPlaylists = [...entries.values()]
    .filter((entry) => Array.isArray(entry.tracks) && entry.tracks.length)
    .map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      curator: entry.curator,
      url: entry.url,
      artwork: entry.artwork,
      last_scanned_at: entry.last_scanned_at,
      tracks: entry.tracks.map((track) => {
        const known = canonical.get(text(track.apple_music_id));
        return {
          apple_music_id: text(track.apple_music_id),
          track_id: known?.track_id ?? null,
          title: known?.title || text(track.title) || '曲名不明',
          position: Number(track.position) || null,
          url: text(track.url),
        };
      }),
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja'));

  const grouped = new Map();
  for (const playlist of matchedPlaylists) {
    for (const track of playlist.tracks) {
      const key = track.track_id != null
        ? `track:${track.track_id}`
        : track.apple_music_id
          ? `apple:${track.apple_music_id}`
          : `title:${track.title}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          track_id: track.track_id,
          apple_music_id: track.apple_music_id,
          title: track.title,
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
    source: 'music.apple.com-public-pages',
    artist_id: TARGET_ARTIST_ID,
    artist_name: TARGET_ARTIST_NAME,
    observed_at: observedAt,
    scan_date: jstDate(observedAt),
    coverage: {
      seed_pages: APPLE_MUSIC_PLAYLIST_SEEDS.length,
      seed_pages_succeeded: seedResults.filter((item) => item.ok).length,
      known_playlists: entries.size,
      scanned_this_run: scannedCount,
      matched_playlists: matchedPlaylists.length,
    },
    playlists: matchedPlaylists,
    tracks: [...grouped.values()]
      .sort((a, b) => a.title.localeCompare(b.title, 'ja')),
  };
}

async function publishReadModel(r2, model, observedAt) {
  const body = JSON.stringify({ ok: true, ...model });
  const objectKey = pagesActionsR2ResponseKey(APPLE_MUSIC_PLAYLIST_PAGES_MODEL_KEY);
  if (!objectKey) throw new Error('Apple Music playlist public read-model key is unavailable');
  const envelope = {
    version: 1,
    status: 200,
    headers: PUBLIC_HEADERS,
    updated_at: observedAt,
    cadence_seconds: 86_400,
    source_revision: `apple-music-playlists:${model.scan_date}:${observedAt}`,
    renderer_revision: 'apple-music-playlists-v1',
    body,
  };
  await r2.put(objectKey, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return { objectKey, bytes: body.length };
}

export async function collectAppleMusicPlaylists(env, now = Date.now(), fetchImpl = fetch) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.put !== 'function') throw new Error('PAGES_RESPONSE_R2 binding is required');

  const observedAt = Number(now) || Date.now();
  const date = jstDate(observedAt);
  const previousState = await getJson(r2, STATE_KEY);
  if (previousState?.scan_date === date) {
    return {
      ok: true,
      skipped: true,
      reason: 'already-scanned-today',
      scan_date: date,
      known_playlists: Array.isArray(previousState?.playlists) ? previousState.playlists.length : 0,
      pages_written: 0,
    };
  }

  const entries = stateEntries(previousState);
  const seedSettled = await Promise.allSettled(
    APPLE_MUSIC_PLAYLIST_SEEDS.map(async (url, seedIndex) => ({
      url,
      seedIndex,
      html: await fetchHtml(fetchImpl, url),
    })),
  );
  const seedResults = [];
  seedSettled.forEach((result, seedIndex) => {
    if (result.status === 'fulfilled') {
      const links = extractAppleMusicPlaylistLinks(result.value.html);
      links.forEach((url, linkIndex) => upsertDiscovery(entries, url, observedAt, seedIndex * 1000 + linkIndex));
      seedResults.push({ url: APPLE_MUSIC_PLAYLIST_SEEDS[seedIndex], ok: true, discovered: links.length });
    } else {
      seedResults.push({
        url: APPLE_MUSIC_PLAYLIST_SEEDS[seedIndex],
        ok: false,
        error: String(result.reason?.message || result.reason || 'unknown error').slice(0, 240),
      });
    }
  });

  if (!entries.size) throw new Error('Apple Music playlist discovery returned no playlist links');

  const candidates = scanCandidates(entries);
  const scanned = await Promise.all(candidates.map(async (entry) => {
    try {
      const html = await fetchHtml(fetchImpl, entry.url);
      return { entry, parsed: parseAppleMusicPlaylistPage(html, entry.url), error: null };
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
    source: 'music.apple.com-public-pages',
    artist_id: TARGET_ARTIST_ID,
    scan_date: date,
    observed_at: observedAt,
    seeds: seedResults,
    playlists: [...entries.values()].slice(0, MAX_KNOWN_PLAYLISTS),
  };
  const appleModel = await getJson(r2, APPLE_MODEL_KEY);
  const model = publicModel(entries, appleModel, observedAt, seedResults, candidates.length);

  let bytesWritten = 0;
  bytesWritten += await putJson(r2, STATE_KEY, state, { scanDate: date, observedAt });
  bytesWritten += await putJson(r2, LATEST_KEY, model, { scanDate: date, observedAt });
  const published = await publishReadModel(r2, model, observedAt);
  bytesWritten += published.bytes;

  return {
    ok: true,
    skipped: false,
    scan_date: date,
    discovered_playlists: entries.size,
    scanned_playlists: candidates.length,
    matched_playlists: model.playlists.length,
    matched_tracks: model.tracks.length,
    bytes_written: bytesWritten,
    pages_object_key: published.objectKey,
  };
}
