import { loadAmazonMusicCanonicalMetadata } from './amazon-music-canonical-metadata.js';
import { resolveAmazonMusicTracks } from './amazon-music-track-identity.js';
import {
  AMAZON_MUSIC_DEEP_STATE_KEY,
  continueAmazon100kScan,
  monitorAmazonTop500,
} from './amazon-music-rank-monitor.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

export const AMAZON_MUSIC_PIPELINE_STATE_KEY = 'amazon-music/rank-monitor/pipeline.json';
const AMAZON_MUSIC_READ_MODEL_KEY = 'amazon-music/read-model/latest.json';
const AMAZON_MUSIC_PAGES_MODEL_KEY = 'amazon-music';
const AMAZON_MUSIC_ARTIST_ID = 'B08P3RHP1P';
const READ_MODEL_HISTORY_DAYS = 365;
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

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
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

function sakurazakaTracks(deepState) {
  return (Array.isArray(deepState?.cycle_tracks) ? deepState.cycle_tracks : [])
    .filter((track) => track?.group_name === '櫻坂46')
    .filter((track) => text(track?.amazon_music_id) && (integer(track?.rank) || 0) > 0);
}

async function resolveProgressTrackIds(db, tracks, previousTracks, observedAt) {
  const result = new Map();
  for (const track of previousTracks) {
    const id = text(track?.amazon_music_id);
    const trackId = integer(track?.track_id);
    if (id && trackId != null) result.set(id, trackId);
  }
  if (!db?.prepare) return result;

  const unresolved = tracks.filter((track) => {
    const id = text(track?.amazon_music_id);
    return id && !result.has(id);
  });
  if (!unresolved.length) return result;

  const resolved = await resolveAmazonMusicTracks(db, unresolved, observedAt);
  for (const item of resolved) {
    const id = text(item?.amazon_music_id);
    const trackId = integer(item?.trackId);
    if (id && trackId != null) result.set(id, trackId);
  }
  return result;
}

function historyPoint(snapshotDate, observedAt, tracks) {
  return {
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    follower_count: null,
    tracks: tracks.map((track) => ({
      amazon_music_id: track.amazon_music_id,
      track_id: track.track_id ?? null,
      amazon_rank: integer(track.amazon_rank),
    })),
  };
}

async function publishDeepProgress(env, deepState, observedAt, { resetRanks = false } = {}) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');

  const previousModel = await getJson(r2, AMAZON_MUSIC_READ_MODEL_KEY);
  const previousTracks = Array.isArray(previousModel?.tracks) ? previousModel.tracks : [];
  const deepTracks = sakurazakaTracks(deepState);
  const trackIdByAmazonId = await resolveProgressTrackIds(
    env?.MINUTE_DB,
    deepTracks,
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
    if (!id) continue;
    byId.set(id, {
      ...track,
      amazon_music_id: id,
      amazon_rank: resetRanks ? null : integer(track?.amazon_rank),
    });
  }

  for (const track of deepTracks) {
    const id = text(track.amazon_music_id);
    const current = byId.get(id) || null;
    const trackId = trackIdByAmazonId.get(id) ?? current?.track_id ?? null;
    const canonical = trackId == null ? null : canonicalMetadata.get(Number(trackId));
    byId.set(id, {
      amazon_music_id: id,
      track_id: trackId,
      title: canonical?.title || current?.title || text(track.title) || '曲名不明',
      album: text(track.album) || current?.album || null,
      image: text(track.image) || current?.image || null,
      amazon_rank: integer(track.rank),
    });
  }

  const tracks = [...byId.values()].sort((a, b) => {
    const ar = integer(a.amazon_rank) ?? Number.MAX_SAFE_INTEGER;
    const br = integer(b.amazon_rank) ?? Number.MAX_SAFE_INTEGER;
    return ar - br || String(a.title || '').localeCompare(String(b.title || ''), 'ja');
  });
  const snapshotDate = jstDate(observedAt);
  const history = (Array.isArray(previousModel?.history) ? previousModel.history : [])
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.snapshot_date || '')))
    .filter((item) => item.snapshot_date !== snapshotDate)
    .slice(-(READ_MODEL_HISTORY_DAYS - 1));
  history.push(historyPoint(snapshotDate, observedAt, tracks));

  const model = {
    version: 2,
    source: 'amazon-music-jp-overall-100k',
    artist_id: AMAZON_MUSIC_ARTIST_ID,
    artist_name: '櫻坂46',
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    follower: null,
    track_count: tracks.length,
    tracks,
    history,
    scan: {
      cycle: integer(deepState?.cycle) || 1,
      scanned_tracks: integer(deepState?.scanned_tracks) || 0,
      complete: Boolean(deepState?.complete),
      exhausted: Boolean(deepState?.exhausted),
    },
  };

  await putJson(r2, AMAZON_MUSIC_READ_MODEL_KEY, model);
  const body = JSON.stringify({ ok: true, ...model });
  const objectKey = pagesActionsR2ResponseKey(AMAZON_MUSIC_PAGES_MODEL_KEY);
  if (!objectKey) throw new Error('Amazon Music public read-model key is unavailable');
  await putJson(r2, objectKey, {
    version: 1,
    status: 200,
    headers: PUBLIC_HEADERS,
    updated_at: observedAt,
    cadence_seconds: 600,
    source_revision: `amazon-music-100k:${model.scan.cycle}:${model.scan.scanned_tracks}:${observedAt}`,
    renderer_revision: 'amazon-music-100k-v1',
    body,
  });

  return {
    published: true,
    object_key: objectKey,
    sakurazaka_tracks_seen: deepTracks.length,
    visible_ranked_tracks: tracks.filter((track) => integer(track.amazon_rank) != null).length,
  };
}

export async function checkAmazonUpdateAndQueue100k(env, observedAt = Date.now(), fetchImpl = fetch) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');

  const pipeline = await getJson(r2, AMAZON_MUSIC_PIPELINE_STATE_KEY);
  const result = await monitorAmazonTop500(env, observedAt, fetchImpl);
  const bootstrap = !pipeline;
  const requested = bootstrap || result.initialized || result.updated;
  let triggerId = null;

  if (requested) {
    triggerId = `${Number(observedAt) || Date.now()}`;
    await putJson(r2, AMAZON_MUSIC_PIPELINE_STATE_KEY, {
      version: 1,
      ...pipeline,
      pending_trigger: {
        id: triggerId,
        observed_at: observedAt,
        reason: result.updated ? 'top-500-update' : 'bootstrap',
      },
      last_top500_observed_at: observedAt,
      last_top500_changed_positions: result.changed_positions,
    });
  }

  return {
    ...result,
    deep_scan_requested: requested,
    deep_scan_trigger_id: triggerId,
  };
}

export async function continueQueuedAmazon100kScan(env, observedAt = Date.now(), fetchImpl = fetch) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');

  let pipeline = await getJson(r2, AMAZON_MUSIC_PIPELINE_STATE_KEY);
  let deepState = await getJson(r2, AMAZON_MUSIC_DEEP_STATE_KEY);
  const pending = object(pipeline?.pending_trigger);
  let active = Boolean(pipeline?.active);
  let activeTriggerId = text(pipeline?.active_trigger_id);
  let resetRanks = false;
  let restarted = false;

  if (pending && text(pending.id) !== activeTriggerId) {
    await putJson(r2, AMAZON_MUSIC_DEEP_STATE_KEY, {
      observed_at: observedAt,
      cycle: Math.max(0, integer(deepState?.cycle) || 0),
      scanned_tracks: 0,
      next_url: null,
      complete: true,
      exhausted: false,
      cycle_tracks: [],
      reported_ids: [],
    });
    active = true;
    activeTriggerId = text(pending.id);
    resetRanks = true;
    restarted = true;
    pipeline = {
      version: 1,
      ...pipeline,
      active: true,
      active_trigger_id: activeTriggerId,
      pending_trigger: null,
      started_at: observedAt,
    };
    await putJson(r2, AMAZON_MUSIC_PIPELINE_STATE_KEY, pipeline);
  } else if (!pipeline && deepState && deepState.complete === false
    && ((integer(deepState.scanned_tracks) || 0) > 0 || text(deepState.next_url))) {
    active = true;
    activeTriggerId = 'legacy-active';
    resetRanks = true;
    pipeline = {
      version: 1,
      active: true,
      active_trigger_id: activeTriggerId,
      pending_trigger: null,
      started_at: observedAt,
    };
    await putJson(r2, AMAZON_MUSIC_PIPELINE_STATE_KEY, pipeline);
  }

  if (!active) {
    return {
      ok: true,
      skipped: true,
      reason: 'no-amazon-chart-update-pending',
    };
  }

  const result = await continueAmazon100kScan(env, observedAt, fetchImpl);
  deepState = await getJson(r2, AMAZON_MUSIC_DEEP_STATE_KEY);
  const pages = await publishDeepProgress(env, deepState, observedAt, { resetRanks });

  const latestPipeline = (await getJson(r2, AMAZON_MUSIC_PIPELINE_STATE_KEY)) || {};
  const latestPending = object(latestPipeline.pending_trigger);
  const unhandledPending = latestPending && text(latestPending.id) !== activeTriggerId
    ? latestPending
    : null;
  const complete = Boolean(result.complete);

  await putJson(r2, AMAZON_MUSIC_PIPELINE_STATE_KEY, {
    version: 1,
    ...latestPipeline,
    active: !complete,
    active_trigger_id: complete ? null : activeTriggerId,
    pending_trigger: unhandledPending,
    last_batch_at: observedAt,
    last_completed_trigger_id: complete
      ? activeTriggerId
      : text(latestPipeline.last_completed_trigger_id),
    last_completed_at: complete
      ? observedAt
      : integer(latestPipeline.last_completed_at),
    cycle: result.cycle,
    scanned_tracks: result.scanned_tracks,
    complete,
  });

  return {
    ...result,
    skipped: false,
    restarted,
    trigger_id: activeTriggerId,
    pages,
  };
}
