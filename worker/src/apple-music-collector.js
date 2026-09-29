import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

export const APPLE_MUSIC_ARTIST_ID = '1541126420';
export const APPLE_MUSIC_PAGES_MODEL_KEY = 'apple-music';
export const APPLE_MUSIC_REGIONS = Object.freeze([
  Object.freeze({ code: 'jp', label: '日本' }),
  Object.freeze({ code: 'tw', label: '台湾' }),
  Object.freeze({ code: 'hk', label: '香港' }),
  Object.freeze({ code: 'kr', label: '韓国' }),
  Object.freeze({ code: 'sg', label: 'シンガポール' }),
  Object.freeze({ code: 'th', label: 'タイ' }),
  Object.freeze({ code: 'us', label: '米国' }),
]);

const ARTIST_PREFIX = `apple-music/artist/${APPLE_MUSIC_ARTIST_ID}/`;
const READ_MODEL_KEY = 'apple-music/read-model/latest.json';
const HISTORY_DAYS = 120;
const TOP_SONG_LIMIT = 12;
const APPLE_MUSIC_BOOTSTRAP_URL = 'https://music.apple.com/us/browse';
const PUBLIC_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

function text(value) {
  if (value === null || value === undefined) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

function songKey(value) {
  const title = text(value);
  if (!title) return null;
  return title
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\u00a0]+/gu, '')
    .replace(/[‐‑‒–—―−]/gu, '-');
}

function normalizedArtworkUrl(value) {
  const url = text(value);
  if (!url) return null;
  return url.replace('{w}', '300').replace('{h}', '300');
}

export function appleMusicJstDate(now = Date.now()) {
  const date = new Date(Number(now) + 9 * 60 * 60_000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function appleMusicTopSongsUrl(regionCode, limit = TOP_SONG_LIMIT) {
  const code = String(regionCode || 'jp').toLowerCase();
  const url = new URL(`https://api.music.apple.com/v1/catalog/${code}/artists/${APPLE_MUSIC_ARTIST_ID}/view/top-songs`);
  url.searchParams.set('limit', String(Math.max(1, Math.min(25, Number(limit) || TOP_SONG_LIMIT))));
  return url.toString();
}

export function appleMusicBundleUrls(html) {
  const urls = [];
  const seen = new Set();
  const source = String(html || '');
  const regex = /<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/giu;
  for (const match of source.matchAll(regex)) {
    try {
      const url = new URL(match[1], 'https://music.apple.com').toString();
      if (!url.startsWith('https://music.apple.com/')) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    } catch {
      // Ignore malformed script URLs.
    }
  }
  return urls.sort((a, b) => {
    const aIndex = /\/assets\/index[-.]/u.test(a) ? 0 : 1;
    const bIndex = /\/assets\/index[-.]/u.test(b) ? 0 : 1;
    return aIndex - bIndex;
  });
}

function jwtExpiryMs(token) {
  try {
    if (typeof atob !== 'function') return Number.POSITIVE_INFINITY;
    const payload = String(token || '').split('.')[1];
    if (!payload) return 0;
    const padded = payload.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded));
    return Number(decoded?.exp) * 1000;
  } catch {
    return 0;
  }
}

export function extractAppleMusicWebToken(source, now = Date.now()) {
  const tokens = String(source || '').match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu) || [];
  return tokens.find((token) => jwtExpiryMs(token) > Number(now) + 60_000) || null;
}

export async function fetchAppleMusicWebToken(fetchImpl = fetch, now = Date.now()) {
  const bootstrap = await fetchImpl(APPLE_MUSIC_BOOTSTRAP_URL, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Safari/537.36',
    },
  });
  if (!bootstrap?.ok) throw new Error(`Apple Music bootstrap HTTP ${bootstrap?.status || 0}`);
  const html = await bootstrap.text();
  const inlineToken = extractAppleMusicWebToken(html, now);
  if (inlineToken) return inlineToken;

  const bundleUrls = appleMusicBundleUrls(html).slice(0, 8);
  if (!bundleUrls.length) throw new Error('Apple Music web bundle URL was not found');
  for (const url of bundleUrls) {
    const response = await fetchImpl(url, {
      headers: {
        accept: '*/*',
        referer: 'https://music.apple.com/',
        'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Safari/537.36',
      },
    });
    if (!response?.ok) continue;
    const token = extractAppleMusicWebToken(await response.text(), now);
    if (token) return token;
  }
  throw new Error('Apple Music web token was not found');
}

function pushUniqueTrack(tracks, seen, track) {
  const key = songKey(track?.title);
  if (!key || seen.has(key)) return;
  seen.add(key);
  tracks.push({ ...track, song_key: key, rank: tracks.length + 1 });
}

export function normalizeAppleMusicTopSongs(payload) {
  const seen = new Set();
  const tracks = [];
  for (const item of Array.isArray(payload?.data) ? payload.data : []) {
    const attributes = item?.attributes || {};
    if (!attributes?.name) continue;
    pushUniqueTrack(tracks, seen, {
      track_id: text(item?.id),
      title: text(attributes.name),
      album: text(attributes.albumName),
      artist: text(attributes.artistName),
      artwork: normalizedArtworkUrl(attributes?.artwork?.url),
      url: text(attributes.url),
      release_date: text(attributes.releaseDate),
      isrc: text(attributes.isrc),
    });
  }
  return tracks.slice(0, TOP_SONG_LIMIT);
}

async function fetchAppleMusicTopSongs(region, token, fetchImpl) {
  if (!token) throw new Error('Apple Music web token unavailable');
  const response = await fetchImpl(appleMusicTopSongsUrl(region.code), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      origin: 'https://music.apple.com',
      referer: `https://music.apple.com/${region.code}/artist/-/${APPLE_MUSIC_ARTIST_ID}`,
      'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Safari/537.36',
    },
  });
  if (!response?.ok) throw new Error(`Apple Music ${region.code} top-songs HTTP ${response?.status || 0}`);
  const tracks = normalizeAppleMusicTopSongs(await response.json());
  if (!tracks.length) throw new Error(`Apple Music ${region.code} top-songs returned no tracks`);
  return tracks;
}

export async function fetchAppleMusicRegion(region, { token, fetchImpl = fetch } = {}) {
  return {
    code: region.code,
    label: region.label,
    source: 'apple-music-web-top-songs',
    tracks: await fetchAppleMusicTopSongs(region, token, fetchImpl),
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

function historyPoint(snapshot) {
  return {
    snapshot_date: snapshot.snapshot_date,
    observed_at: snapshot.observed_at,
    regions: Object.fromEntries(snapshot.regions.map((region) => [
      region.code,
      region.tracks.slice(0, TOP_SONG_LIMIT).map((track) => ({
        song_key: track.song_key,
        track_id: track.track_id,
        rank: track.rank,
      })),
    ])),
  };
}

export function buildAppleMusicReadModel(snapshot, previousModel = null) {
  const previousHistory = Array.isArray(previousModel?.history) ? previousModel.history : [];
  const history = previousHistory
    .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(String(point?.snapshot_date || '')))
    .filter((point) => point.snapshot_date !== snapshot.snapshot_date);
  history.push(historyPoint(snapshot));
  history.sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));

  return {
    version: 1,
    source: snapshot.source,
    artist_id: snapshot.artist_id,
    artist_name: '櫻坂46',
    snapshot_date: snapshot.snapshot_date,
    observed_at: snapshot.observed_at,
    regions: snapshot.regions,
    failed_regions: snapshot.failed_regions,
    history: history.slice(-HISTORY_DAYS),
  };
}

async function publishReadModel(r2, model, observedAt) {
  const body = JSON.stringify({ ok: true, ...model });
  const objectKey = pagesActionsR2ResponseKey(APPLE_MUSIC_PAGES_MODEL_KEY);
  if (!objectKey) throw new Error('Apple Music public read-model key is unavailable');
  const envelope = {
    version: 1,
    status: 200,
    headers: PUBLIC_HEADERS,
    updated_at: observedAt,
    cadence_seconds: 0,
    source_revision: `apple-music:${model.snapshot_date}:${observedAt}`,
    renderer_revision: 'apple-music-v1',
    body,
  };
  await r2.put(objectKey, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return { objectKey, bytes: body.length };
}

export async function collectAppleMusicSnapshot(env, now = Date.now(), fetchImpl = fetch) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.put !== 'function') throw new Error('PAGES_RESPONSE_R2 binding is required');

  const observedAt = Number(now) || Date.now();
  const snapshotDate = appleMusicJstDate(observedAt);
  const token = await fetchAppleMusicWebToken(fetchImpl, observedAt);

  const settled = await Promise.allSettled(
    APPLE_MUSIC_REGIONS.map((region) => fetchAppleMusicRegion(region, { token, fetchImpl })),
  );

  const regions = [];
  const failedRegions = [];
  settled.forEach((result, index) => {
    const region = APPLE_MUSIC_REGIONS[index];
    if (result.status === 'fulfilled') regions.push(result.value);
    else failedRegions.push({
      code: region.code,
      label: region.label,
      error: String(result.reason?.message || result.reason || 'unknown error').slice(0, 240),
    });
  });
  if (!regions.length) throw new Error('Apple Music collection failed for every region');

  const snapshot = {
    version: 1,
    source: 'apple-music-web-top-songs',
    artist_id: APPLE_MUSIC_ARTIST_ID,
    artist_name: '櫻坂46',
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    regions,
    failed_regions: failedRegions,
  };

  let bytesWritten = 0;
  bytesWritten += await putJson(r2, `${ARTIST_PREFIX}daily/${snapshotDate}.json`, snapshot, {
    snapshotDate,
    observedAt,
  });
  bytesWritten += await putJson(r2, `${ARTIST_PREFIX}latest.json`, snapshot, {
    snapshotDate,
    observedAt,
  });

  const previousModel = await getJson(r2, READ_MODEL_KEY);
  const model = buildAppleMusicReadModel(snapshot, previousModel);
  bytesWritten += await putJson(r2, READ_MODEL_KEY, model, { snapshotDate, observedAt });
  const published = await publishReadModel(r2, model, observedAt);
  bytesWritten += published.bytes;

  return {
    ok: true,
    snapshot_date: snapshotDate,
    source: snapshot.source,
    regions: regions.length,
    failed_regions: failedRegions.map((item) => item.code),
    bytes_written: bytesWritten,
    pages_object_key: published.objectKey,
  };
}
