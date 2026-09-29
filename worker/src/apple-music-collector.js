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
const LOOKUP_LIMIT = 25;
const HISTORY_TRACK_LIMIT = 12;
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

function integer(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function appleMusicJstDate(now = Date.now()) {
  const date = new Date(Number(now) + 9 * 60 * 60_000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function appleMusicLookupUrl(regionCode, limit = LOOKUP_LIMIT) {
  const url = new URL('https://itunes.apple.com/lookup');
  url.searchParams.set('id', APPLE_MUSIC_ARTIST_ID);
  url.searchParams.set('entity', 'song');
  url.searchParams.set('sort', 'popular');
  url.searchParams.set('limit', String(Math.max(1, Math.min(200, Number(limit) || LOOKUP_LIMIT))));
  url.searchParams.set('country', String(regionCode || 'jp').toLowerCase());
  return url.toString();
}

export function normalizeAppleMusicLookup(payload) {
  const seen = new Set();
  const tracks = [];
  for (const item of Array.isArray(payload?.results) ? payload.results : []) {
    if (item?.wrapperType !== 'track' || !item?.trackName) continue;
    const trackId = integer(item.trackId);
    if (trackId == null || seen.has(trackId)) continue;
    seen.add(trackId);
    tracks.push({
      rank: tracks.length + 1,
      track_id: trackId,
      title: text(item.trackName),
      album: text(item.collectionName),
      artist: text(item.artistName),
      artwork: text(item.artworkUrl100),
      url: text(item.trackViewUrl),
      release_date: text(item.releaseDate),
    });
  }
  return tracks;
}

export async function fetchAppleMusicRegion(region, fetchImpl = fetch) {
  const response = await fetchImpl(appleMusicLookupUrl(region.code), {
    headers: {
      accept: 'application/json',
      'user-agent': 'skrzk-pages/1.0',
    },
  });
  if (!response?.ok) throw new Error(`Apple Music ${region.code} lookup HTTP ${response?.status || 0}`);
  const payload = await response.json();
  const tracks = normalizeAppleMusicLookup(payload);
  if (!tracks.length) throw new Error(`Apple Music ${region.code} lookup returned no tracks`);
  return {
    code: region.code,
    label: region.label,
    tracks,
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
      region.tracks.slice(0, HISTORY_TRACK_LIMIT).map((track) => ({
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
  const settled = await Promise.allSettled(
    APPLE_MUSIC_REGIONS.map((region) => fetchAppleMusicRegion(region, fetchImpl)),
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
  if (!regions.length) throw new Error('Apple Music lookup failed for every region');

  const snapshot = {
    version: 1,
    source: 'itunes-lookup-sort-popular',
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
    regions: regions.length,
    failed_regions: failedRegions.map((item) => item.code),
    bytes_written: bytesWritten,
    pages_object_key: published.objectKey,
  };
}
