import { loadAmazonMusicCanonicalMetadata } from './amazon-music-canonical-metadata.js';
import {
  AMAZON_MUSIC_150K_EXTENSION_STATE_KEY,
  AMAZON_MUSIC_DEEP_TARGET_RANK,
} from './amazon-music-150k-extension.js';
import {
  addAmazonMusicRankChanges,
  labelAmazonMusicVariants,
} from './amazon-music-pipeline.js';
import { AMAZON_MUSIC_DEEP_STATE_KEY } from './amazon-music-rank-monitor.js';
import { resolveAmazonMusicTracks } from './amazon-music-track-identity.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

const AMAZON_MUSIC_READ_MODEL_KEY = 'amazon-music/read-model/latest.json';
const AMAZON_MUSIC_PAGES_MODEL_KEY = 'amazon-music';
const READ_MODEL_HISTORY_DAYS = 365;
const GROUP_NAMES = new Set(['乃木坂46', '櫻坂46', '日向坂46']);
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
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function jstDate(now) {
  const shifted = new Date(Number(now) + 9 * 60 * 60_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
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

function mergeCycleTracks(deepState, extensionState) {
  const cycle = integer(deepState?.cycle);
  const extensionMatches = cycle != null && integer(extensionState?.cycle) === cycle;
  const byId = new Map();
  const append = (rows) => {
    for (const track of Array.isArray(rows) ? rows : []) {
      const id = text(track?.amazon_music_id);
      const group = text(track?.group_name);
      const rank = integer(track?.rank);
      if (!id || !GROUP_NAMES.has(group) || rank == null || rank <= 0) continue;
      byId.set(id, { ...track, amazon_music_id: id, group_name: group, rank });
    }
  };
  append(deepState?.cycle_tracks);
  if (extensionMatches) append(extensionState?.cycle_tracks);
  return { cycle, extensionMatches, tracks: [...byId.values()] };
}

async function resolveTrackIds(db, observedTracks, previousTracks, observedAt) {
  const ids = new Map();
  for (const track of previousTracks) {
    const id = text(track?.amazon_music_id);
    const trackId = integer(track?.track_id);
    if (id && trackId != null) ids.set(id, trackId);
  }
  if (!db?.prepare || !observedTracks.length) return ids;
  const resolved = await resolveAmazonMusicTracks(db, observedTracks, observedAt);
  for (const item of resolved) {
    const id = text(item?.amazon_music_id);
    if (!id) continue;
    const trackId = integer(item?.trackId);
    if (trackId != null) ids.set(id, trackId);
    else ids.delete(id);
  }
  return ids;
}

function historyPoint(snapshotDate, observedAt, tracks) {
  return {
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    follower_count: null,
    tracks: tracks.map((track) => ({
      amazon_music_id: track.amazon_music_id,
      track_id: track.track_id ?? null,
      group_name: track.group_name ?? null,
      amazon_rank: integer(track.amazon_rank),
    })),
  };
}

export function amazonMusicSakamichiScanState(deepState, extensionState) {
  const cycle = Math.max(1, integer(deepState?.cycle) || 1);
  const baseScanned = Math.max(0, integer(deepState?.scanned_tracks) || 0);
  const extensionMatches = integer(extensionState?.cycle) === cycle;
  const extensionScanned = extensionMatches
    ? Math.max(0, integer(extensionState?.scanned_tracks) || 0)
    : 0;
  const extensionComplete = extensionMatches && extensionState?.status === 'complete';
  return {
    cycle,
    scanned_tracks: Math.max(baseScanned, extensionScanned),
    target_rank: AMAZON_MUSIC_DEEP_TARGET_RANK,
    complete: extensionComplete,
    exhausted: extensionComplete && Boolean(extensionState?.exhausted),
  };
}

export async function publishAmazonMusicSakamichiModel(env, observedAt = Date.now()) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');

  const [deepState, extensionState, previousModel] = await Promise.all([
    getJson(r2, AMAZON_MUSIC_DEEP_STATE_KEY),
    getJson(r2, AMAZON_MUSIC_150K_EXTENSION_STATE_KEY),
    getJson(r2, AMAZON_MUSIC_READ_MODEL_KEY),
  ]);
  if (!deepState) return { published: false, reason: 'deep-state-missing' };

  const merged = mergeCycleTracks(deepState, extensionState);
  const scan = amazonMusicSakamichiScanState(deepState, extensionState);
  const previousTracks = Array.isArray(previousModel?.tracks) ? previousModel.tracks : [];
  const trackIdByAmazonId = await resolveTrackIds(
    env?.MINUTE_DB,
    merged.tracks,
    previousTracks,
    observedAt,
  );
  const canonicalMetadata = await loadAmazonMusicCanonicalMetadata(
    env?.MINUTE_DB,
    trackIdByAmazonId,
  );

  const byId = new Map();
  for (const track of previousTracks) {
    const id = text(track?.amazon_music_id);
    const group = text(track?.group_name);
    if (!id || !GROUP_NAMES.has(group)) continue;
    byId.set(id, {
      ...track,
      amazon_music_id: id,
      group_name: group,
      amazon_rank: scan.complete ? null : integer(track?.amazon_rank),
    });
  }

  for (const track of merged.tracks) {
    const id = text(track?.amazon_music_id);
    if (!id) continue;
    const current = byId.get(id) || null;
    const trackId = trackIdByAmazonId.get(id) ?? integer(current?.track_id) ?? null;
    const canonical = trackId == null ? null : canonicalMetadata.get(Number(trackId));
    byId.set(id, {
      amazon_music_id: id,
      track_id: trackId,
      group_name: text(track?.group_name) || current?.group_name || null,
      title: canonical?.title || current?.title || text(track?.title) || '曲名不明',
      album: text(track?.album) || current?.album || null,
      image: text(track?.image) || current?.image || null,
      amazon_rank: integer(track?.rank),
    });
  }

  const snapshotDate = jstDate(observedAt);
  const tracks = addAmazonMusicRankChanges(
    labelAmazonMusicVariants([...byId.values()]),
    previousModel?.history,
    snapshotDate,
  ).sort((left, right) => {
    const lr = integer(left?.amazon_rank) ?? Number.MAX_SAFE_INTEGER;
    const rr = integer(right?.amazon_rank) ?? Number.MAX_SAFE_INTEGER;
    return lr - rr
      || String(left?.group_name || '').localeCompare(String(right?.group_name || ''), 'ja')
      || String(left?.title || '').localeCompare(String(right?.title || ''), 'ja');
  });

  const history = (Array.isArray(previousModel?.history) ? previousModel.history : [])
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.snapshot_date || '')))
    .filter((item) => item.snapshot_date !== snapshotDate)
    .slice(-(READ_MODEL_HISTORY_DAYS - 1));
  history.push(historyPoint(snapshotDate, observedAt, tracks));

  const model = {
    version: 3,
    source: 'amazon-music-jp-overall-150k-sakamichi',
    artist_id: null,
    artist_name: '坂道3グループ',
    artists: ['乃木坂46', '櫻坂46', '日向坂46'],
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    follower: null,
    track_count: tracks.length,
    tracks,
    history,
    scan,
  };

  await putJson(r2, AMAZON_MUSIC_READ_MODEL_KEY, model);
  const objectKey = pagesActionsR2ResponseKey(AMAZON_MUSIC_PAGES_MODEL_KEY);
  if (!objectKey) throw new Error('Amazon Music public read-model key is unavailable');
  await putJson(r2, objectKey, {
    version: 1,
    status: 200,
    headers: PUBLIC_HEADERS,
    updated_at: observedAt,
    cadence_seconds: 600,
    source_revision: `amazon-music-sakamichi:${scan.cycle}:${scan.scanned_tracks}:${observedAt}`,
    renderer_revision: 'amazon-music-sakamichi-v1',
    body: JSON.stringify({ ok: true, ...model }),
  });

  return {
    published: true,
    object_key: objectKey,
    tracks: tracks.length,
    ranked_tracks: tracks.filter((track) => integer(track?.amazon_rank) != null).length,
    groups: Object.fromEntries([...GROUP_NAMES].map((group) => [
      group,
      tracks.filter((track) => track.group_name === group && integer(track?.amazon_rank) != null).length,
    ])),
    scan,
  };
}
