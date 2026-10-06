import { canonicalizeTrackRows } from '../../site/functions/lib/canonical-track-rows.js';
import {
  APPLE_MUSIC_ARTIST_ID,
  APPLE_MUSIC_PAGES_MODEL_KEY,
  APPLE_MUSIC_REGIONS,
  appleMusicJstDate,
  fetchAppleMusicWebToken,
  normalizeAppleMusicTopSongs,
  resolveAppleMusicTrackIds,
} from './apple-music-collector.js';
import { pagesR2ResponseKey } from './pages-response-r2.js';

export const APPLE_MUSIC_ARTISTS = Object.freeze([
  Object.freeze({ key: 'sakurazaka46', id: APPLE_MUSIC_ARTIST_ID, name: '櫻坂46' }),
  Object.freeze({ key: 'nogizaka46', id: '571990937', name: '乃木坂46' }),
  Object.freeze({ key: 'hinatazaka46', id: '1456116642', name: '日向坂46' }),
]);

const PRIMARY_ARTIST_KEY = 'sakurazaka46';
const READ_MODEL_KEY = 'apple-music/read-model/latest.json';
const HISTORY_DAYS = 120;
const TOP_SONG_LIMIT = 12;
const PUBLIC_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function modelKey(artist) {
  return `apple-music/artist/${artist.id}/latest.json`;
}

function dailyKey(artist, snapshotDate) {
  return `apple-music/artist/${artist.id}/daily/${snapshotDate}.json`;
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

function trackIdentity(track) {
  const appleId = text(track?.apple_music_id);
  if (appleId) return `apple:${appleId}`;
  const trackId = Number(track?.track_id);
  if (Number.isSafeInteger(trackId)) return `track:${trackId}`;
  return `title:${text(track?.song_key) || text(track?.title) || ''}`;
}

function regionsSignature(regions) {
  return (Array.isArray(regions) ? regions : [])
    .map((region) => `${region?.code || ''}:${(Array.isArray(region?.tracks) ? region.tracks : [])
      .slice(0, TOP_SONG_LIMIT)
      .map((track) => `${Number(track?.rank) || 0}:${trackIdentity(track)}`)
      .join('|')}`)
    .join('||');
}

function historyPoint(model) {
  return {
    snapshot_date: model.snapshot_date,
    observed_at: model.observed_at,
    regions: Object.fromEntries((model.regions || []).map((region) => [
      region.code,
      (region.tracks || []).slice(0, TOP_SONG_LIMIT).map((track) => ({
        song_key: track.song_key,
        track_id: Number.isSafeInteger(Number(track.track_id)) ? Number(track.track_id) : null,
        apple_music_id: text(track.apple_music_id),
        rank: Number(track.rank) || null,
        title: text(track.title),
      })),
    ])),
  };
}

function buildArtistModel(artist, regions, failedRegions, previousModel, observedAt, trackIdsByIsrc) {
  const baseline = !(Array.isArray(previousModel?.regions) && previousModel.regions.length);
  const changed = baseline || regionsSignature(previousModel?.regions) !== regionsSignature(regions);
  const snapshotDate = changed ? appleMusicJstDate(observedAt) : previousModel.snapshot_date;
  const history = Array.isArray(previousModel?.history) ? [...previousModel.history] : [];
  const model = {
    version: 1,
    source: 'apple-music-web-top-songs',
    artist_key: artist.key,
    artist_id: artist.id,
    artist_name: artist.name,
    snapshot_date: snapshotDate,
    observed_at: changed ? observedAt : Number(previousModel?.observed_at) || observedAt,
    regions,
    failed_regions: failedRegions,
    track_ids_by_isrc: trackIdsByIsrc || previousModel?.track_ids_by_isrc || {},
    history,
  };
  if (changed) {
    model.history = history
      .filter((point) => /^\d{4}-\d{2}-\d{2}$/u.test(String(point?.snapshot_date || '')))
      .filter((point) => point.snapshot_date !== snapshotDate);
    model.history.push(historyPoint(model));
    model.history.sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
    model.history = model.history.slice(-HISTORY_DAYS);
  }
  return { model, changed, baseline };
}

function artistView(artist, model) {
  return {
    key: artist.key,
    artist_key: artist.key,
    artist_id: artist.id,
    artist_name: artist.name,
    snapshot_date: model?.snapshot_date || null,
    observed_at: model?.observed_at || null,
    regions: Array.isArray(model?.regions) ? model.regions : [],
    failed_regions: Array.isArray(model?.failed_regions) ? model.failed_regions : [],
    history: Array.isArray(model?.history) ? model.history : [],
  };
}

function primaryView(primaryModel) {
  const artist = APPLE_MUSIC_ARTISTS[0];
  return artistView(artist, primaryModel || {});
}

function artistTopSongsUrl(artist, regionCode) {
  const code = String(regionCode || 'jp').toLowerCase();
  const url = new URL(`https://api.music.apple.com/v1/catalog/${code}/artists/${artist.id}/view/top-songs`);
  url.searchParams.set('limit', String(TOP_SONG_LIMIT));
  return url.toString();
}

async function fetchArtistRegion(artist, region, token, fetchImpl) {
  const response = await fetchImpl(artistTopSongsUrl(artist, region.code), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      origin: 'https://music.apple.com',
      referer: `https://music.apple.com/${region.code}/artist/-/${artist.id}`,
      'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Safari/537.36',
    },
  });
  if (!response?.ok) throw new Error(`Apple Music ${artist.key}/${region.code} top-songs HTTP ${response?.status || 0}`);
  const tracks = normalizeAppleMusicTopSongs(await response.json())
    .map((track) => ({
      ...track,
      artist_key: artist.key,
      artist_id: artist.id,
      artist_name: artist.name,
    }));
  if (!tracks.length) throw new Error(`Apple Music ${artist.key}/${region.code} top-songs returned no tracks`);
  return {
    code: region.code,
    label: region.label,
    source: 'apple-music-web-top-songs',
    tracks,
  };
}

function carryFailedRegions(artist, previousModel, fetchedRegions, failedRegions) {
  const fetched = new Map(fetchedRegions.map((region) => [region.code, region]));
  const previous = new Map((previousModel?.regions || []).map((region) => [region.code, region]));
  const failed = new Set(failedRegions.map((item) => item.code));
  return APPLE_MUSIC_REGIONS.flatMap((definition) => {
    if (fetched.has(definition.code)) return [fetched.get(definition.code)];
    if (failed.has(definition.code) && previous.has(definition.code)) {
      return [{ ...previous.get(definition.code), stale: true, stale_artist: artist.key }];
    }
    return [];
  });
}

async function canonicalizeRegions(db, regions) {
  if (!db?.prepare || typeof db.batch !== 'function') return regions;
  const counts = regions.map((region) => region.tracks?.length || 0);
  const tracks = regions.flatMap((region) => region.tracks || []);
  if (!tracks.length) return regions;
  const canonical = await canonicalizeTrackRows(db, tracks);
  if (!Array.isArray(canonical) || canonical.length !== tracks.length) return regions;
  let offset = 0;
  return regions.map((region, index) => {
    const next = canonical.slice(offset, offset + counts[index]).map((track, trackIndex) => ({
      ...region.tracks[trackIndex],
      title: text(track?.title) || region.tracks[trackIndex]?.title,
      artist: text(track?.artist) || region.tracks[trackIndex]?.artist,
    }));
    offset += counts[index];
    return { ...region, tracks: next };
  });
}

async function collectArtist(env, artist, token, observedAt, fetchImpl, previousModel, sharedTrackMap) {
  const settled = await Promise.allSettled(
    APPLE_MUSIC_REGIONS.map((region) => fetchArtistRegion(artist, region, token, fetchImpl)),
  );
  const fetchedRegions = [];
  const failedRegions = [];
  settled.forEach((result, index) => {
    const region = APPLE_MUSIC_REGIONS[index];
    if (result.status === 'fulfilled') fetchedRegions.push(result.value);
    else failedRegions.push({
      code: region.code,
      label: region.label,
      artist_key: artist.key,
      artist_name: artist.name,
      error: String(result.reason?.message || result.reason || 'unknown error').slice(0, 240),
    });
  });
  if (!fetchedRegions.length && !(previousModel?.regions?.length)) {
    throw new Error(`Apple Music ${artist.name} collection failed for every region`);
  }

  let regions = carryFailedRegions(artist, previousModel, fetchedRegions, failedRegions);
  const resolution = await resolveAppleMusicTrackIds(
    env?.MINUTE_DB,
    regions,
    { ...(sharedTrackMap || {}), ...(previousModel?.track_ids_by_isrc || {}) },
    observedAt,
  );
  regions = await canonicalizeRegions(env?.MINUTE_DB, regions);
  const built = buildArtistModel(
    artist,
    regions,
    failedRegions,
    previousModel,
    observedAt,
    resolution.track_ids_by_isrc,
  );
  return {
    ...built,
    resolution,
    fetched_regions: fetchedRegions.length,
    failed_region_codes: failedRegions.map((item) => item.code),
  };
}

async function persistArtistModel(r2, artist, result, observedAt) {
  if (!result?.changed && !result?.baseline) return 0;
  const metadata = {
    snapshotDate: result.model.snapshot_date || '',
    observedAt,
    artist: artist.key,
  };
  let bytes = 0;
  bytes += await putJson(r2, modelKey(artist), result.model, metadata);
  if (result.model.snapshot_date) {
    bytes += await putJson(r2, dailyKey(artist, result.model.snapshot_date), result.model, metadata);
  }
  return bytes;
}

async function publishCombinedModel(r2, primaryModel, secondaryModels, observedAt) {
  const artists = [
    primaryView(primaryModel),
    ...APPLE_MUSIC_ARTISTS.slice(1).map((artist) => artistView(artist, secondaryModels.get(artist.key))),
  ];
  const combined = {
    ...primaryModel,
    artist_count: artists.length,
    artist_names: artists.map((artist) => artist.artist_name),
    artists,
  };
  await putJson(r2, READ_MODEL_KEY, combined, {
    snapshotDate: combined.snapshot_date || '',
    observedAt,
  });

  const publicKey = pagesR2ResponseKey(APPLE_MUSIC_PAGES_MODEL_KEY);
  if (!publicKey) throw new Error('Apple Music public read-model key is unavailable');
  const previousEnvelope = await getJson(r2, publicKey);
  const body = JSON.stringify({ ok: true, ...combined });
  const envelope = previousEnvelope && Number(previousEnvelope.version) === 1
    ? {
        ...previousEnvelope,
        updated_at: observedAt,
        source_revision: `apple-music:sakamichi:${combined.snapshot_date || 'none'}:${observedAt}`,
        body,
      }
    : {
        version: 1,
        status: 200,
        headers: PUBLIC_HEADERS,
        updated_at: observedAt,
        cadence_seconds: 0,
        source_revision: `apple-music:sakamichi:${combined.snapshot_date || 'none'}:${observedAt}`,
        renderer_revision: 'apple-music-v3',
        body,
      };
  await r2.put(publicKey, JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return { combined, publicKey, bytes: body.length };
}

export async function collectAdditionalAppleMusicArtists(
  env,
  observedAt = Date.now(),
  fetchImpl = fetch,
  { primaryResult = null } = {},
) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.get !== 'function' || typeof r2?.put !== 'function') {
    throw new Error('PAGES_RESPONSE_R2 binding is required');
  }

  const now = Number(observedAt) || Date.now();
  const secondaryArtists = APPLE_MUSIC_ARTISTS.slice(1);
  const previousEntries = await Promise.all(secondaryArtists.map(async (artist) => [artist.key, await getJson(r2, modelKey(artist))]));
  const previousModels = new Map(previousEntries);
  const hasBaseline = secondaryArtists.every((artist) => previousModels.get(artist.key)?.regions?.length);
  if (primaryResult?.skipped && hasBaseline) {
    return { ok: true, skipped: true, reason: primaryResult.reason || 'primary-skipped', artists: secondaryArtists.length };
  }

  const token = await fetchAppleMusicWebToken(fetchImpl, now);
  const sharedTrackMap = {};
  for (const model of previousModels.values()) Object.assign(sharedTrackMap, model?.track_ids_by_isrc || {});

  const collected = new Map();
  let d1Reads = 0;
  let d1Writes = 0;
  let tracksCreated = 0;
  let bytesWritten = 0;
  for (const artist of secondaryArtists) {
    const result = await collectArtist(
      env,
      artist,
      token,
      now,
      fetchImpl,
      previousModels.get(artist.key),
      sharedTrackMap,
    );
    collected.set(artist.key, result.model);
    Object.assign(sharedTrackMap, result.resolution.track_ids_by_isrc || {});
    d1Reads += result.resolution.d1_reads || 0;
    d1Writes += result.resolution.d1_writes || 0;
    tracksCreated += result.resolution.tracks_created || 0;
    bytesWritten += await persistArtistModel(r2, artist, result, now);
  }

  const primaryModel = await getJson(r2, READ_MODEL_KEY);
  if (!primaryModel?.regions?.length) throw new Error('Primary Apple Music read model unavailable');
  const secondaryChanged = secondaryArtists.some((artist) => {
    const previous = previousModels.get(artist.key);
    const next = collected.get(artist.key);
    return !previous?.regions?.length || regionsSignature(previous.regions) !== regionsSignature(next?.regions);
  });
  const alreadyCombined = Array.isArray(primaryModel?.artists)
    && APPLE_MUSIC_ARTISTS.every((artist) => primaryModel.artists.some((item) => item?.key === artist.key));
  let published = null;
  if (secondaryChanged || primaryResult?.changed || primaryResult?.migrated_track_ids || !alreadyCombined) {
    published = await publishCombinedModel(r2, primaryModel, collected, now);
    bytesWritten += published.bytes;
  }

  return {
    ok: true,
    changed: secondaryChanged,
    artists: secondaryArtists.map((artist) => ({
      key: artist.key,
      name: artist.name,
      snapshot_date: collected.get(artist.key)?.snapshot_date || null,
      regions: collected.get(artist.key)?.regions?.length || 0,
      failed_regions: collected.get(artist.key)?.failed_regions?.map((item) => item.code) || [],
    })),
    d1_reads: d1Reads,
    d1_writes: d1Writes,
    tracks_created: tracksCreated,
    bytes_written: bytesWritten,
    pages_object_key: published?.publicKey || null,
  };
}
