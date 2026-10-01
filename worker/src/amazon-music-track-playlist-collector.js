const AMAZON_HOST = 'music.amazon.co.jp';
const AMAZON_ORIGIN = `https://${AMAZON_HOST}`;
const CONFIG_URL = `${AMAZON_ORIGIN}/config.json?skipToken=false&clientApplication=skyfire`;
const WEB_SKILL_BASE = 'https://fe.web.skill.music.a2z.com/api';
const CATALOG_SKILL_BASE = 'https://fe.mesk.skill.music.a2z.com/api';
const USER_HASH = JSON.stringify({ level: 'LIBRARY_MEMBER' });
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const PRIME_ARTIST_ID = 'B08P3RHP1P';
const SOURCE_MODEL_KEY = 'amazon-music/read-model/latest.json';

export const AMAZON_MUSIC_TRACK_PLAYLIST_STATE_KEY = 'amazon-music/track-playlists/state.json';
export const AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY = 'amazon-music/track-playlists/latest.json';
export const AMAZON_MUSIC_TRACK_PLAYLIST_BATCH_SIZE = 25;

let cachedConfig = null;
let configExpiresAt = 0;
let primePromise = null;

function text(value) {
  if (value === null || value === undefined) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function stringValue(value) {
  if (typeof value === 'string') return text(value);
  const entry = object(value);
  return text(entry?.text ?? entry?.value ?? entry?.label ?? entry?.title);
}

function deepValues(value, visit, depth = 0) {
  if (depth > 22 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const child of value) deepValues(child, visit, depth + 1);
    return;
  }
  const entry = object(value);
  if (!entry) return;
  visit(entry);
  for (const child of Object.values(entry)) deepValues(child, visit, depth + 1);
}

function nestedStrings(value, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => nestedStrings(item, depth + 1));
  if (typeof value !== 'object') return [];
  return Object.values(value).flatMap((item) => nestedStrings(item, depth + 1));
}

function playlistIdFromDeeplink(value) {
  const match = String(value || '').match(/\/(?:user-)?playlists\/([A-Za-z0-9_-]+)/iu);
  return match?.[1] || null;
}

function catalogPlaylistId(strings) {
  for (const value of strings) {
    if (!String(value).includes('/api/showCatalogPlaylist?')) continue;
    try {
      const url = new URL(value, CATALOG_SKILL_BASE);
      const id = text(url.searchParams.get('id'));
      if (id) return id;
    } catch {
      // Ignore malformed action URLs.
    }
  }
  return null;
}

function imageFromNode(node) {
  const direct = node?.image ?? node?.cover ?? node?.artwork;
  if (typeof direct === 'string') return text(direct);
  const entry = object(direct);
  if (entry) return text(entry.url ?? entry.src ?? entry.uri);
  return nestedStrings(node).find((value) => /^https:\/\/[^\s]+(?:jpg|jpeg|png|webp)(?:\?|$)/iu.test(value)) || null;
}

export function extractAmazonTrackRelatedPlaylists(document) {
  const byId = new Map();
  deepValues(document, (node) => {
    const strings = nestedStrings(node);
    const deeplink = strings.find((value) => playlistIdFromDeeplink(value));
    const publicId = playlistIdFromDeeplink(deeplink);
    if (!publicId) return;
    const candidate = {
      playlist_id: publicId,
      catalog_id: catalogPlaylistId(strings),
      name: stringValue(node?.primaryText ?? node?.title ?? node?.headerText),
      curator: stringValue(node?.secondaryText ?? node?.subtitle),
      image: imageFromNode(node),
      url: new URL(deeplink, AMAZON_ORIGIN).toString(),
    };
    const previous = byId.get(publicId);
    if (!previous) {
      byId.set(publicId, candidate);
      return;
    }
    byId.set(publicId, {
      playlist_id: publicId,
      catalog_id: previous.catalog_id || candidate.catalog_id,
      name: previous.name || candidate.name,
      curator: previous.curator || candidate.curator,
      image: previous.image || candidate.image,
      url: previous.url || candidate.url,
    });
  });
  return [...byId.values()];
}

function relatedPlaylistsUrl(document, currentUrl = null) {
  let found = null;
  deepValues(document, (node) => {
    if (found) return;
    for (const value of Object.values(node)) {
      if (typeof value !== 'string'
        || !value.includes('/api/cosmicTrack/showTrackDetailSeeMore?')
        || !value.includes('pageType=related-playlists')) continue;
      try {
        const url = new URL(value, CATALOG_SKILL_BASE).toString();
        if (url !== currentUrl) found = url;
      } catch {
        // Ignore malformed action URLs.
      }
    }
  });
  return found;
}

async function responseJson(response, label) {
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  const value = await response.json();
  if (!object(value)) throw new Error(`${label} returned a non-object payload`);
  return value;
}

async function config(fetchImpl) {
  const now = Date.now();
  if (cachedConfig && now < configExpiresAt) return cachedConfig;
  const response = await fetchImpl(CONFIG_URL, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5',
      'user-agent': USER_AGENT,
      referer: `${AMAZON_ORIGIN}/`,
    },
  });
  cachedConfig = await responseJson(response, 'Amazon Music config');
  configExpiresAt = now + 30 * 60_000;
  primePromise = null;
  return cachedConfig;
}

function amazonHeaders(configuration, pageUrl) {
  const csrf = object(configuration?.csrf) || {};
  return {
    'x-amzn-authentication': JSON.stringify({
      interface: 'ClientAuthenticationInterface.v1_0.ClientTokenElement',
      accessToken: configuration?.accessToken || '',
    }),
    'x-amzn-device-model': 'WEBPLAYER',
    'x-amzn-device-width': '1920',
    'x-amzn-device-family': 'WebPlayer',
    'x-amzn-device-id': configuration?.deviceId || '',
    'x-amzn-user-agent': USER_AGENT,
    'x-amzn-session-id': configuration?.sessionId || '',
    'x-amzn-device-height': '1080',
    'x-amzn-request-id': crypto.randomUUID(),
    'x-amzn-device-language': 'ja_JP',
    'x-amzn-currency-of-preference': 'JPY',
    'x-amzn-os-version': '1.0',
    'x-amzn-application-version': configuration?.version || '',
    'x-amzn-device-time-zone': 'UTC',
    'x-amzn-timestamp': String(Date.now()),
    'x-amzn-csrf': JSON.stringify({
      interface: 'CSRFInterface.v1_0.CSRFHeaderElement',
      token: csrf.token || '',
      timestamp: csrf.ts == null ? '' : String(csrf.ts),
      rndNonce: csrf.rnd == null ? '' : String(csrf.rnd),
    }),
    'x-amzn-music-domain': AMAZON_HOST,
    'x-amzn-referer': '',
    'x-amzn-affiliate-tags': '',
    'x-amzn-ref-marker': '',
    'x-amzn-page-url': pageUrl,
    'x-amzn-weblab-id-overrides': '',
    'x-amzn-video-player-token': '',
    'x-amzn-feature-flags': 'hd-supported,uhd-supported',
    'x-amzn-has-profile-id': '',
    'x-amzn-age-band': '',
  };
}

function outerHeaders() {
  return {
    accept: '*/*',
    'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5',
    'content-type': 'text/plain;charset=UTF-8',
    origin: AMAZON_ORIGIN,
    referer: `${AMAZON_ORIGIN}/`,
    'user-agent': USER_AGENT,
  };
}

async function postAmazon(fetchImpl, url, request, pageUrl) {
  const configuration = await config(fetchImpl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: outerHeaders(),
    body: JSON.stringify({
      ...request,
      headers: JSON.stringify(amazonHeaders(configuration, pageUrl)),
    }),
  });
  return responseJson(response, `Amazon Music ${new URL(url).pathname}`);
}

async function primeWebPlayer(fetchImpl) {
  if (primePromise) return primePromise;
  primePromise = (async () => {
    const pageUrl = `${AMAZON_ORIGIN}/artists/${PRIME_ARTIST_ID}`;
    const deeplink = JSON.stringify({
      interface: 'DeeplinkInterface.v1_0.DeeplinkClientInformation',
      deeplink: `/artists/${PRIME_ARTIST_ID}`,
    });
    return postAmazon(fetchImpl, `${WEB_SKILL_BASE}/showHome`, { deeplink }, pageUrl);
  })().catch((error) => {
    primePromise = null;
    throw error;
  });
  return primePromise;
}

async function fetchTrackRelatedPlaylists(trackId, fetchImpl = fetch) {
  await primeWebPlayer(fetchImpl);
  const pageUrl = `${AMAZON_ORIGIN}/tracks/${encodeURIComponent(trackId)}`;
  const detail = await postAmazon(fetchImpl, `${CATALOG_SKILL_BASE}/cosmicTrack/displayCatalogTrack`, {
    id: trackId,
    userHash: USER_HASH,
  }, pageUrl);

  const byId = new Map(extractAmazonTrackRelatedPlaylists(detail).map((item) => [item.playlist_id, item]));
  let url = relatedPlaylistsUrl(detail);
  const seen = new Set();
  for (let page = 0; page < 10 && url && !seen.has(url); page += 1) {
    seen.add(url);
    const document = await postAmazon(fetchImpl, url, {}, pageUrl);
    for (const item of extractAmazonTrackRelatedPlaylists(document)) byId.set(item.playlist_id, item);
    url = relatedPlaylistsUrl(document, url);
  }
  return [...byId.values()];
}

async function getJson(r2, key) {
  if (typeof r2?.get !== 'function') return null;
  const stored = await r2.get(key);
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

export function selectAmazonTrackPlaylistBatch(tracks, state = {}, limit = AMAZON_MUSIC_TRACK_PLAYLIST_BATCH_SIZE) {
  const previous = object(state?.tracks) || {};
  const unique = new Map();
  for (const track of Array.isArray(tracks) ? tracks : []) {
    const id = text(track?.amazon_music_id);
    if (!id || unique.has(id)) continue;
    unique.set(id, track);
  }
  return [...unique.values()]
    .sort((left, right) => {
      const leftAt = integer(previous[text(left?.amazon_music_id)]?.last_attempt_at) ?? 0;
      const rightAt = integer(previous[text(right?.amazon_music_id)]?.last_attempt_at) ?? 0;
      if (leftAt !== rightAt) return leftAt - rightAt;
      const leftRank = integer(left?.amazon_rank) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = integer(right?.amazon_rank) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank;
    })
    .slice(0, Math.max(0, Number(limit) || 0));
}

function mergePlaylistHistory(previous, current, now) {
  const old = new Map((Array.isArray(previous) ? previous : []).map((item) => [text(item?.playlist_id), item]));
  return current.map((item) => ({
    ...item,
    first_seen_at: integer(old.get(item.playlist_id)?.first_seen_at) ?? now,
    last_seen_at: now,
  }));
}

function publicTrackRecord(track, entry) {
  return {
    amazon_music_id: text(track?.amazon_music_id),
    track_id: integer(track?.track_id),
    group_name: text(track?.group_name),
    title: text(track?.title),
    album: text(track?.album),
    amazon_rank: integer(track?.amazon_rank),
    checked_at: integer(entry?.checked_at),
    last_attempt_at: integer(entry?.last_attempt_at),
    status: text(entry?.status) || 'pending',
    playlist_count: Array.isArray(entry?.playlists) ? entry.playlists.length : 0,
    playlists: Array.isArray(entry?.playlists) ? entry.playlists : [],
    ...(entry?.error ? { error: text(entry.error) } : {}),
  };
}

export async function collectAmazonMusicTrackPlaylists(
  env,
  observedAt = Date.now(),
  fetchImpl = fetch,
  lookup = fetchTrackRelatedPlaylists,
) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!r2?.get || !r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');
  const now = integer(observedAt) ?? Date.now();
  const model = await getJson(r2, SOURCE_MODEL_KEY);
  const tracks = Array.isArray(model?.tracks) ? model.tracks : [];
  if (!tracks.length) throw new Error('Amazon Music Sakamichi read model is empty');

  const state = await getJson(r2, AMAZON_MUSIC_TRACK_PLAYLIST_STATE_KEY) || { version: 1, tracks: {} };
  if (!object(state.tracks)) state.tracks = {};
  const batch = selectAmazonTrackPlaylistBatch(tracks, state);
  let succeeded = 0;
  let failed = 0;

  for (const track of batch) {
    const id = text(track?.amazon_music_id);
    const previous = object(state.tracks[id]) || {};
    try {
      const playlists = await lookup(id, fetchImpl);
      state.tracks[id] = {
        track_id: integer(track?.track_id),
        group_name: text(track?.group_name),
        title: text(track?.title),
        album: text(track?.album),
        checked_at: now,
        last_attempt_at: now,
        status: 'ok',
        playlists: mergePlaylistHistory(previous.playlists, playlists, now),
      };
      succeeded += 1;
    } catch (error) {
      state.tracks[id] = {
        ...previous,
        track_id: integer(track?.track_id),
        group_name: text(track?.group_name),
        title: text(track?.title),
        album: text(track?.album),
        last_attempt_at: now,
        status: 'error',
        error: String(error?.message || error).slice(0, 300),
      };
      failed += 1;
    }
  }

  state.version = 1;
  state.updated_at = now;
  state.source_model_updated_at = integer(model?.observed_at ?? model?.updated_at);
  await putJson(r2, AMAZON_MUSIC_TRACK_PLAYLIST_STATE_KEY, state);

  const publicTracks = tracks
    .filter((track) => text(track?.amazon_music_id))
    .map((track) => publicTrackRecord(track, state.tracks[text(track.amazon_music_id)]));
  const checked = publicTracks.filter((track) => track.checked_at != null).length;
  const errors = publicTracks.filter((track) => track.status === 'error').length;
  const latest = {
    version: 1,
    source: 'amazon-music-track-related-playlists',
    observed_at: now,
    source_model_observed_at: integer(model?.observed_at ?? model?.updated_at),
    coverage: {
      total_tracks: publicTracks.length,
      checked_tracks: checked,
      pending_tracks: Math.max(0, publicTracks.length - checked),
      error_tracks: errors,
      batch_size: AMAZON_MUSIC_TRACK_PLAYLIST_BATCH_SIZE,
    },
    tracks: publicTracks,
  };
  await putJson(r2, AMAZON_MUSIC_TRACK_PLAYLIST_MODEL_KEY, latest);

  return {
    handled: true,
    batch_tracks: batch.length,
    succeeded,
    failed,
    total_tracks: publicTracks.length,
    checked_tracks: checked,
    pending_tracks: Math.max(0, publicTracks.length - checked),
  };
}

export function resetAmazonTrackPlaylistClientCache() {
  cachedConfig = null;
  configExpiresAt = 0;
  primePromise = null;
}
