import { resolveAmazonMusicTracks } from './amazon-music-track-identity.js';
import {
  createAmazonMusicWebClient,
  extractAmazonMusicTracks,
  extractFollowerCount,
  extractIsrc,
} from './amazon-music-web-client.js';

export const AMAZON_MUSIC_ARTIST_ID = 'B08P3RHP1P';
export const AMAZON_MUSIC_JAPAN_TOP50_ID = 'B088FYHTR4';
const ARTIST_PREFIX = `amazon-music/artist/${AMAZON_MUSIC_ARTIST_ID}/`;
const TOP50_PREFIX = 'amazon-music/japan-top-50/';
const CATALOG_PREFIX = 'amazon-music/catalog-popular/';
const READ_MODEL_KEY = 'amazon-music/read-model/latest.json';
const MAX_ISRC_LOOKUPS = 240;
const ISRC_LOOKUP_CONCURRENCY = 4;

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

function mergeTracks(primary = [], fallback = []) {
  const byId = new Map();
  for (const source of [...fallback, ...primary]) {
    const id = text(source?.amazon_music_id);
    if (!id) continue;
    const current = byId.get(id) || {};
    byId.set(id, {
      ...current,
      ...source,
      amazon_music_id: id,
      title: text(source?.title) || text(current?.title),
      artist: text(source?.artist) || text(current?.artist),
      album: text(source?.album) || text(current?.album),
      image: text(source?.image) || text(current?.image),
      isrc: text(source?.isrc)?.toUpperCase() || text(current?.isrc)?.toUpperCase() || null,
    });
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

  const [artistDocument, rawArtistTracks, top50Document, popularHtml] = await Promise.all([
    client.fetchArtist(AMAZON_MUSIC_ARTIST_ID),
    client.fetchArtistTracks(AMAZON_MUSIC_ARTIST_ID),
    client.fetchPlaylist(AMAZON_MUSIC_JAPAN_TOP50_ID),
    client.fetchPopularPageHtml().catch(() => ''),
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
  const catalogRanking = rankTracks(extractAmazonMusicTracks(popularHtml));
  const catalogHits = hitsFromRanking(catalogRanking, artistIds).map((track) => publicTrack(track, trackIdByAmazonId));
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
    japan_top_50: top50Hits.length ? { week_key: weekKey, hits: top50Hits } : null,
  };

  let bytesWritten = 0;
  const dailyKey = `${ARTIST_PREFIX}daily/${snapshotDate}.json`;
  if (!(await r2Exists(r2, dailyKey))) {
    bytesWritten += await putJson(r2, dailyKey, snapshot, { snapshotDate, observedAt });
  }
  bytesWritten += await putJson(r2, `${ARTIST_PREFIX}latest.json`, snapshot, { snapshotDate, observedAt });
  bytesWritten += await putJson(r2, READ_MODEL_KEY, snapshot, { snapshotDate, observedAt });

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
        hits: catalogHits,
      }, { snapshotDate, observedAt });
      catalogStored = true;
    }
  }

  return {
    ok: true,
    snapshot_date: snapshotDate,
    week_key: weekKey,
    follower_count: follower?.count ?? null,
    popular_tracks: artistPopular.length,
    all_tracks: allArtistTracks.length,
    resolved_track_ids: trackIdByAmazonId.size,
    japan_top_50_hits: top50Hits.length,
    japan_top_50_stored: top50Stored,
    catalog_popular_hits: catalogHits.length,
    catalog_popular_stored: catalogStored,
    bytes_written: bytesWritten,
  };
}
