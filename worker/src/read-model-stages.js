import { preserveReadModelTrackMetadata } from './minute-facts-read-model.js';
import {
  attachPlaybackReadModelTrackMetadata,
  loadPlaybackReadModelTrackMetadata,
} from './read-model-stationhead-metadata.js';
import { queueNeedsPreservation } from './read-model-metadata-plan.js';
import {
  sanitizeQueueTrackMetadata,
  trackNeedsHydration,
} from './track-metadata-quality.js';

const READ_MODEL_CHECKPOINT_MS = 20 * 60_000;

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function timestamp(value) {
  const numeric = integer(value);
  if (numeric != null) return numeric;
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanCode(value) {
  if (value == null) return null;
  if (value === false || value === 0 || String(value).toLowerCase() === 'false') return 0;
  return 1;
}

function normalizedIsrc(value) {
  return String(value || '').trim().toUpperCase();
}

function queueValueFromJson(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function stableChannelPresentation(value) {
  const presentation = objectValue(value) || {};
  let changed = false;
  let result = presentation;
  const stripStreaming = (container, key) => {
    const owner = objectValue(container);
    const streaming = objectValue(owner?.[key]);
    if (!owner || !streaming || !Object.hasOwn(streaming, 'current_stream_count')) return owner;
    const { current_stream_count: _ignored, ...stable } = streaming;
    changed = true;
    return { ...owner, [key]: stable };
  };

  const topLevel = stripStreaming(result, 'streaming_party');
  if (topLevel !== result) result = topLevel;
  const currentStation = stripStreaming(result.current_station, 'streaming_party');
  if (currentStation !== result.current_station) {
    result = { ...result, current_station: currentStation };
  }
  return changed ? result : presentation;
}

const TRACK_METADATA_KEY_LIMIT = 80;

function incompleteTrackMetadataKeys(tracks) {
  const spotifyIds = new Set();
  const isrcs = new Set();

  for (let index = 0, length = tracks.length; index < length; index += 1) {
    const track = tracks[index];
    if (!track || !trackNeedsHydration(track)) continue;

    if (spotifyIds.size < TRACK_METADATA_KEY_LIMIT) {
      const spotifyId = String(track.spotify_id || '').trim();
      if (spotifyId) spotifyIds.add(spotifyId);
    }

    if (isrcs.size < TRACK_METADATA_KEY_LIMIT) {
      const isrc = normalizedIsrc(track.isrc);
      if (isrc) isrcs.add(isrc);
    }

    if (spotifyIds.size === TRACK_METADATA_KEY_LIMIT
        && isrcs.size === TRACK_METADATA_KEY_LIMIT) break;
  }

  return {
    spotifyIds: Array.from(spotifyIds),
    isrcs: Array.from(isrcs),
  };
}

export async function hydrateReadModelMetadata(env, readModel) {
  if (!readModel || typeof readModel !== 'object') throw new Error('minute fact read model payload is missing');
  const originalQueue = readModel?.queue?.value;
  const queue = sanitizeQueueTrackMetadata(originalQueue);
  if (!queue?.tracks?.length) return readModel;

  const baseReadModel = queue === originalQueue
    ? readModel
    : { ...readModel, queue: { ...readModel.queue, value: queue } };
  const rows = await loadPlaybackReadModelTrackMetadata(env, queue.tracks, TRACK_METADATA_KEY_LIMIT);
  if (!rows.length) return baseReadModel;

  const hydrated = attachPlaybackReadModelTrackMetadata(queue, rows);
  return hydrated === queue
    ? baseReadModel
    : { ...baseReadModel, queue: { ...baseReadModel.queue, value: hydrated } };
}

export async function preserveReadModelForWrite(env, readModel) {
  if (!readModel || typeof readModel !== 'object') throw new Error('minute fact read model payload is missing');
  const originalQueue = readModel?.queue?.value;
  const queue = sanitizeQueueTrackMetadata(originalQueue);
  const baseReadModel = queue === originalQueue
    ? readModel
    : { ...readModel, queue: { ...readModel.queue, value: queue } };
  const channelId = integer(readModel?.channel?.channel_id);
  if (!env?.MINUTE_DB || channelId == null || !queue?.tracks?.length
      || !queueNeedsPreservation(queue)) return baseReadModel;

  const previous = await env.MINUTE_DB.prepare(`SELECT queue_id,start_time,queue_json
    FROM sh_queue_read_model_current WHERE channel_id=? LIMIT 1`).bind(channelId).first();
  if (!previous
      || integer(previous.queue_id) !== integer(readModel.queue.queue_id)
      || timestamp(previous.start_time) !== timestamp(readModel.queue.start_time)) return baseReadModel;
  const previousQueue = sanitizeQueueTrackMetadata(queueValueFromJson(previous.queue_json));
  const preserved = preserveReadModelTrackMetadata(queue, previousQueue);
  return preserved === queue
    ? baseReadModel
    : { ...baseReadModel, queue: { ...baseReadModel.queue, value: preserved } };
}

export async function prepareReadModelForWrite(env, readModel) {
  const preserved = await preserveReadModelForWrite(env, readModel);
  return hydrateReadModelMetadata(env, preserved);
}

export async function writePreparedReadModel(env, readModel) {
  if (!env?.MINUTE_DB) throw new Error('minute fact read model MINUTE_DB binding is missing');
  if (!readModel || typeof readModel !== 'object') throw new Error('minute fact read model payload is missing');
  const channel = readModel.channel || {};
  const queue = readModel.queue || {};
  const collector = readModel.collector || {};
  const channelId = integer(channel.channel_id);
  const observedAt = integer(channel.observed_at);
  if (channelId == null || observedAt == null) throw new Error('channel read model identity is missing');
  const collectorId = String(collector.collector_id || '').trim();
  if (!collectorId) throw new Error('collector read model identity is missing');
  const presentationJson = JSON.stringify(stableChannelPresentation(channel.presentation));
  const queueValue = sanitizeQueueTrackMetadata(queue.value);

  await env.MINUTE_DB.batch([
    env.MINUTE_DB.prepare(`INSERT INTO sh_channel_read_model(channel_id,observed_at,presentation_json)
      VALUES(?,?,?) ON CONFLICT(channel_id) DO UPDATE SET
        observed_at=excluded.observed_at,presentation_json=excluded.presentation_json
      WHERE excluded.observed_at>=sh_channel_read_model.observed_at
        AND excluded.presentation_json IS NOT sh_channel_read_model.presentation_json`)
      .bind(channelId, observedAt, presentationJson),
    env.MINUTE_DB.prepare(`INSERT INTO sh_queue_read_model_current(
        channel_id,observed_at,station_id,queue_id,start_time,is_paused,queue_json
      ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET
        observed_at=excluded.observed_at,station_id=excluded.station_id,queue_id=excluded.queue_id,
        start_time=excluded.start_time,is_paused=excluded.is_paused,queue_json=excluded.queue_json
      WHERE excluded.observed_at>=sh_queue_read_model_current.observed_at AND (
        excluded.station_id IS NOT sh_queue_read_model_current.station_id
        OR excluded.queue_id IS NOT sh_queue_read_model_current.queue_id
        OR excluded.start_time IS NOT sh_queue_read_model_current.start_time
        OR excluded.is_paused IS NOT sh_queue_read_model_current.is_paused
        OR excluded.queue_json IS NOT sh_queue_read_model_current.queue_json
        OR excluded.observed_at-sh_queue_read_model_current.observed_at>=${READ_MODEL_CHECKPOINT_MS}
      )`)
      .bind(
        channelId,
        observedAt,
        integer(queue.station_id),
        integer(queue.queue_id),
        timestamp(queue.start_time),
        booleanCode(queue.is_paused),
        JSON.stringify(queueValue || null),
      ),
    env.MINUTE_DB.prepare(`INSERT INTO sh_collector_read_model(
        collector_id,last_run_at,last_success_at,last_error_present,updated_at
      ) VALUES(?,?,?,?,?) ON CONFLICT(collector_id) DO UPDATE SET
        last_run_at=excluded.last_run_at,last_success_at=excluded.last_success_at,
        last_error_present=excluded.last_error_present,updated_at=excluded.updated_at
      WHERE excluded.updated_at>=sh_collector_read_model.updated_at AND (
        excluded.last_error_present IS NOT sh_collector_read_model.last_error_present
        OR (sh_collector_read_model.last_success_at IS NULL AND excluded.last_success_at IS NOT NULL)
        OR excluded.updated_at-sh_collector_read_model.updated_at>=${READ_MODEL_CHECKPOINT_MS}
      )`)
      .bind(
        collectorId,
        integer(collector.last_run_at),
        integer(collector.last_success_at),
        Number(Boolean(collector.last_error_present)),
        integer(collector.updated_at) ?? observedAt,
      ),
  ]);
}
