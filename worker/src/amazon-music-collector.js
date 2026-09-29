import { pagesActionsR2ResponseKey } from './pages-response-r2.js';
import { resolveAmazonMusicTracks } from './amazon-music-track-identity.js';
import {
  createAmazonMusicWebClient,
  extractAmazonMusicTracks,
  extractFollowerCount,
  extractIsrc,
} from './amazon-music-web-client.js';

export const AMAZON_MUSIC_ARTIST_ID = 'B08P3RHP1P';
export const AMAZON_MUSIC_JAPAN_TOP50_ID = 'B088FYHTR4';
export const AMAZON_MUSIC_PAGES_MODEL_KEY = 'amazon-music';
const ARTIST_PREFIX = `amazon-music/artist/${AMAZON_MUSIC_ARTIST_ID}/`;
const TOP50_PREFIX = 'amazon-music/japan-top-50/';
const CATALOG_PREFIX = 'amazon-music/catalog-popular/';
const READ_MODEL_KEY = 'amazon-music/read-model/latest.json';
const READ_MODEL_HISTORY_DAYS = 365;
const MAX_ISRC_LOOKUPS = 240;
const ISRC_LOOKUP_CONCURRENCY = 4;
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

function jstParts(now) {
  const date = new Date(Number(now) + 9 * 60 * 60_000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function amazonMusicJstDate(now = Date.now()) {
  const { year, month, day } = jstParts(now);
  return isoDate(year, month, day);
}

export function amazonMusicWeekKey(now = Date.now()) {
  const shifted = new Date(Number(now) + 9 * 60 * 60_000);
  const weekday = shifted.getUTCDay();
  const daysSinceTuesday = (weekday - 2 + 7) % 7;
  shifted.setUTCDate(shifted.getUTCDate() - daysSinceTuesday);
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

function normalizeArtist(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s・･]/gu, '');
}

function isSakurazakaArtist(value) {
  const normalized = normalizeArtist(value);
  return normalized.includes('櫻坂46') || normalized.includes('sakurazaka46');
}

function rankTracks(tracks = []) {
  const seen = new Set();
  const result = [];
  for (const track of tracks) {
    const id = text(track?.amazon_music_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({
      rank: result.length + 1,
      amazon_music_id: id,
      title: text(track?.title),
      artist: text(track?.artist),
      album: text(track?.album),
      image: text(track?.image),
      isrc: text(track?.isrc)?.toUpperCase() || null,
    });
  }
  return result;
}

function normalizedTrack(source, current = {}) {
  const id = text(source?.amazon_music_id) || text(current?.amazon_music_id);
  return {
    ...source,
    ...current,
    amazon_music_id: id,
    title: text(current?.title) || text(source?.title),
    artist: text(current?.artist) || text(source?.artist),
    album: text(current?.album) || text(source?.album),
    image: text(current?.image) || text(source?.image),
    isrc: text(current?.isrc)?.toUpperCase() || text(source?.isrc)?.toUpperCase() || null,
  };
}

function mergeTracks(primary = [], fallback = []) {
  const byId = new Map();
  for (const source of primary) {
    const id = text(source?.amazon_music_id);
    if (!id) continue;
    byId.set(id, normalizedTrack(source));
  }
  for (const source of fallback) {
    const id = text(source?.amazon_music_id);
    if (!id) continue;
    const current = byId.get(id);
    if (current) byId.set(id, normalizedTrack(source, current));
    else byId.set(id, normalizedTrack(source));
  }
  return [...byId.values()];
}

async function mapLimit(values, limit, mapper) {
  const items = [...values];
  const output = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      output[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

async function sharedTrackIds(db, client, tracks, observedAt) {
  if (!db?.prepare || !tracks.length) return new Map();
  const first = await resolveAmazonMusicTracks(db, tracks, observedAt);
  const trackIdByAmazonId = new Map(first
    .filter((track) => track.amazon_music_id && Number.isSafeInteger(Number(track.trackId)))
    .map((track) => [track.amazon_music_id, Number(track.trackId)]));

  const unresolved = tracks
    .filter((track) => track.amazon_music_id && !trackIdByAmazonId.has(track.amazon_music_id))
    .slice(0, MAX_ISRC_LOOKUPS);
  if (!unresolved.length) return trackIdByAmazonId;

  const enriched = await mapLimit(unresolved, ISRC_LOOKUP_CONCURRENCY, async (track) => {
    if (track.isrc) return track;
    try {
      const detail = await client.fetchTrack(track.amazon_music_id);
      return { ...track, isrc: extractIsrc(detail) };
    } catch (error) {
      console.warn('amazon-music-isrc-lookup-failed', {
        amazon_music_id: track.amazon_music_id,
        error: String(error?.message || error).slice(0, 180),
      });
      return track;
    }
  });

  const second = await resolveAmazonMusicTracks(db, enriched, observedAt);
  for (const track of second) {
    if (track.amazon_music_id && Number.isSafeInteger(Number(track.trackId))) {
      trackIdByAmazonId.set(track.amazon_music_id, Number(track.trackId));
    }
  }
  return trackIdByAmazonId;
}

function publicTrack(track, trackIdByAmazonId) {
  return {
    rank: Number(track.rank) || null,
    amazon_music_id: track.amazon_music_id,
    track_id: trackIdByAmazonId.get(track.amazon_music_id) ?? null,
    title: track.title || null,
    artist: track.artist || null,
    album: track.album || null,
    image: track.image || null,
  };
}

function hitsFromRanking(ranking, artistIds) {
  return ranking
    .filter((track) => artistIds.has(track.amazon_music_id) || isSakurazakaArtist(track.artist))
    .map((track) => ({ ...track }));
}

async function r2Exists(r2, key) {
  if (typeof r2?.head !== 'function') return false;
  return Boolean(await r2.head(key));
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
  if (typeof r2?.put !== 'function') throw new Error('PAGES_RESPONSE_R2 binding is required');
  const body = JSON.stringify(value);
  await r2.put(key, body, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: Object.fromEntries(Object.entries(metadata).map(([name, item]) => [name, String(item)])),
  });
  return body.length;
}

async function followerInfo(client, artistDocument) {
  const fromDocument = extractFollowerCount(artistDocument);
  if (fromDocument) return fromDocument;
  try {
    return extractFollowerCount(await client.fetchArtistPageHtml(AMAZON_MUSIC_ARTIST_ID));
  } catch {
    return null;
  }
}

function readModelPoint(snapshot) {
  const overallRank = new Map((snapshot.catalog_popular_hits || [])
    .map((track) => [track.amazon_music_id, Number(track.rank) || null]));
  return {
    snapshot_date: snapshot.snapshot_date,
    observed_at: snapshot.observed_at,
    follower_count: snapshot.follower?.count ?? null,
    tracks: (snapshot.all_tracks || []).map((track) => ({
      amazon_music_id: track.amazon_music_id,
      track_id: track.track_id ?? null,
      amazon_rank: overallRank.get(track.amazon_music_id) ?? null,
      popular_rank: Number(track.rank) || null,
    })),
  };
}

export function buildAmazonMusicReadModel(snapshot, previousModel = null) {
  const point = readModelPoint(snapshot);
  const history = (Array.isArray(previousModel?.history) ? previousModel.history : [])
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.snapshot_date || '')))
    .filter((item) => item.snapshot_date !== snapshot.snapshot_date);
  history.push(point);
  history.sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
  const boundedHistory = history.slice(-READ_MODEL_HISTORY_DAYS);
  const previousDate = amazonMusicJstDate(Number(snapshot.observed_at) - 86400_000);
  const previousDay = boundedHistory.find((item) => item.snapshot_date === previousDate) || null;
  const followerCount = snapshot.follower?.count ?? null;
  const previousFollower = previousDay?.follower_count ?? null;
  const followerDelta = followerCount !== null
      && previousFollower !== null
      && Number.isSafeInteger(Number(followerCount))
      && Number.isSafeInteger(Number(previousFollower))
    ? Number(followerCount) - Number(previousFollower)
    : null;
  const overallRank = new Map((snapshot.catalog_popular_hits || [])
    .map((track) => [track.amazon_music_id, Number(track.rank) || null]));
  const tracks = (snapshot.all_tracks || []).map((track) => ({
    amazon_music_id: track.amazon_music_id,
    track_id: track.track_id ?? null,
    title: track.title || '曲名不明',
    album: track.album || null,
    image: track.image || null,
    amazon_rank: overallRank.get(track.amazon_music_id) ?? null,
    popular_rank: Number(track.rank) || null,
  }));
  return {
    version: 1,
    source: snapshot.source,
    artist_id: snapshot.artist_id,
    artist_name: '櫻坂46',
    snapshot_date: snapshot.snapshot_date,
    observed_at: snapshot.observed_at,
    follower: followerCount == null ? null : {
      count: followerCount,
      delta: followerDelta,
      exact: Boolean(snapshot.follower?.exact),
      label: snapshot.follower?.label || null,
    },
    track_count: tracks.length,
    tracks,
    history: boundedHistory,
  };
}

async function publishAmazonMusicReadModel(r2, model, observedAt) {
  const body = JSON.stringify({ ok: true, ...model });
  const objectKey = pagesActionsR2ResponseKey(AMAZON_MUSIC_PAGES_MODEL_KEY);
  if (!objectKey) throw new Error('Amazon Music public read-model key is unavailable');
  const envelope = {
    version: 1,
    status: 200,
    headers: PUBLIC_HEADERS,
    updated_at: observedAt,
    cadence_seconds: 0,
    source_revision: `amazon-music:${model.snapshot_date}:${observedAt}`,
    renderer_revision: 'amazon-music-v1',
    body,
  };
  await r2.put(objectKey, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return { objectKey, bytes: body.length };
}

export async function collectAmazonMusicSnapshot(
  env,
  now = Date.now(),
  client = createAmazonMusicWebClient(),
) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.put !== 'function') throw new Error('PAGES_RESPONSE_R2 binding is required');
  if (!env?.MINUTE_DB?.prepare) throw new Error('MINUTE_DB binding is required');

  const observedAt = Number(now) || Date.now();
  const snapshotDate = amazonMusicJstDate(observedAt);
  const weekKey = amazonMusicWeekKey(observedAt);

  const [artistDocument, rawArtistTracks, top50Document] = await Promise.all([
    client.fetchArtist(AMAZON_MUSIC_ARTIST_ID),
    client.fetchArtistTracks(AMAZON_MUSIC_ARTIST_ID),
    client.fetchPlaylist(AMAZON_MUSIC_JAPAN_TOP50_ID),
  ]);

  const artistPopular = rankTracks(extractAmazonMusicTracks(artistDocument));
  const allArtistTracks = rankTracks(mergeTracks(rawArtistTracks, artistPopular));
  const allIdentityInputs = mergeTracks(allArtistTracks, artistPopular);
  const trackIdByAmazonId = await sharedTrackIds(
    env.MINUTE_DB,
    client,
    allIdentityInputs,
    observedAt,
  );
  const artistIds = new Set(allArtistTracks.map((track) => track.amazon_music_id));

  const top50Ranking = rankTracks(extractAmazonMusicTracks(top50Document));
  const top50Hits = hitsFromRanking(top50Ranking, artistIds).map((track) => publicTrack(track, trackIdByAmazonId));
  const overallRanking = typeof client.fetchOverallTrackRanks === 'function'
    ? await client.fetchOverallTrackRanks(artistIds)
    : { hits: [], scanned_tracks: 0, exhausted: false };
  const catalogHits = hitsFromRanking(
    Array.isArray(overallRanking?.hits) ? overallRanking.hits : [],
    artistIds,
  ).map((track) => publicTrack(track, trackIdByAmazonId));
  const follower = await followerInfo(client, artistDocument);

  const snapshot = {
    version: 1,
    source: 'amazon-music-jp-web',
    artist_id: AMAZON_MUSIC_ARTIST_ID,
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    follower: follower ? {
      count: follower.count,
      exact: Boolean(follower.exact),
      label: follower.label || null,
    } : null,
    popular_tracks: artistPopular.map((track) => publicTrack(track, trackIdByAmazonId)),
    all_tracks: allArtistTracks.map((track) => publicTrack(track, trackIdByAmazonId)),
    catalog_popular_hits: catalogHits,
    catalog_popular_scanned: Number(overallRanking?.scanned_tracks) || 0,
    catalog_popular_exhausted: Boolean(overallRanking?.exhausted),
    japan_top_50: top50Hits.length ? { week_key: weekKey, hits: top50Hits } : null,
  };

  let bytesWritten = 0;
  const dailyKey = `${ARTIST_PREFIX}daily/${snapshotDate}.json`;
  if (!(await r2Exists(r2, dailyKey))) {
    bytesWritten += await putJson(r2, dailyKey, snapshot, { snapshotDate, observedAt });
  }
  bytesWritten += await putJson(r2, `${ARTIST_PREFIX}latest.json`, snapshot, { snapshotDate, observedAt });

  let top50Stored = false;
  if (top50Hits.length) {
    const top50Key = `${TOP50_PREFIX}weeks/${weekKey}.json`;
    const top50Snapshot = {
      version: 1,
      source: 'amazon-music-japan-top-50',
      playlist_id: AMAZON_MUSIC_JAPAN_TOP50_ID,
      week_key: weekKey,
      observed_at: observedAt,
      hits: top50Hits,
    };
    if (!(await r2Exists(r2, top50Key))) {
      bytesWritten += await putJson(r2, top50Key, top50Snapshot, { weekKey, observedAt });
      top50Stored = true;
    }
    bytesWritten += await putJson(r2, `${TOP50_PREFIX}latest-hit.json`, top50Snapshot, { weekKey, observedAt });
  }

  let catalogStored = false;
  if (catalogHits.length) {
    const catalogKey = `${CATALOG_PREFIX}daily/${snapshotDate}.json`;
    if (!(await r2Exists(r2, catalogKey))) {
      bytesWritten += await putJson(r2, catalogKey, {
        version: 1,
        source: 'amazon-music-jp-popular',
        snapshot_date: snapshotDate,
        observed_at: observedAt,
        scanned_tracks: Number(overallRanking?.scanned_tracks) || 0,
        exhausted: Boolean(overallRanking?.exhausted),
        hits: catalogHits,
      }, { snapshotDate, observedAt });
      catalogStored = true;
    }
  }

  const previousReadModel = await getJson(r2, READ_MODEL_KEY);
  const readModel = buildAmazonMusicReadModel(snapshot, previousReadModel);
  bytesWritten += await putJson(r2, READ_MODEL_KEY, readModel, { snapshotDate, observedAt });
  const publicModel = await publishAmazonMusicReadModel(r2, readModel, observedAt);
  bytesWritten += publicModel.bytes;

  return {
    ok: true,
    snapshot_date: snapshotDate,
    week_key: weekKey,
    follower_count: follower?.count ?? null,
    follower_delta: readModel.follower?.delta ?? null,
    popular_tracks: artistPopular.length,
    all_tracks: allArtistTracks.length,
    resolved_track_ids: trackIdByAmazonId.size,
    japan_top_50_hits: top50Hits.length,
    japan_top_50_stored: top50Stored,
    catalog_popular_hits: catalogHits.length,
    catalog_popular_scanned: Number(overallRanking?.scanned_tracks) || 0,
    catalog_popular_exhausted: Boolean(overallRanking?.exhausted),
    catalog_popular_stored: catalogStored,
    read_model_published: true,
    read_model_object_key: publicModel.objectKey,
    bytes_written: bytesWritten,
  };
}
