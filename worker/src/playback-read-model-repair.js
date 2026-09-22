import { attachReadModelTrackMetadata } from './minute-facts-read-model.js';
import { loadReadModelTrackMetadata } from './read-model-metadata-indexed.js';
import {
  sanitizeQueueTrackMetadata,
  trackNeedsHydration,
} from './track-metadata-quality.js';

function text(value) {
  if (value == null || value === '') return null;
  const result = String(value).trim();
  return result || null;
}

function safeQueue(value) {
  try {
    const parsed = JSON.parse(String(value || 'null'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function incompletePlaybackMetadataKeys(queue) {
  const tracks = queue?.tracks;
  if (!Array.isArray(tracks) || !tracks.length) return null;

  const spotifyIds = [];
  const isrcs = [];
  const seenSpotifyIds = new Set();
  const seenIsrcs = new Set();
  let incomplete = false;

  for (const track of tracks) {
    if (!trackNeedsHydration(track)) continue;
    incomplete = true;

    const spotifyId = text(track?.spotify_id);
    if (spotifyId && !seenSpotifyIds.has(spotifyId)) {
      seenSpotifyIds.add(spotifyId);
      spotifyIds.push(spotifyId);
    }

    const isrc = text(track?.isrc)?.toUpperCase() || null;
    if (isrc && !seenIsrcs.has(isrc)) {
      seenIsrcs.add(isrc);
      isrcs.push(isrc);
    }
  }

  return incomplete ? { spotifyIds, isrcs } : null;
}

async function playbackMetadataRows(env, spotifyIds, isrcs) {
  const localRows = await loadReadModelTrackMetadata({ MINUTE_DB: env?.MINUTE_DB }, spotifyIds, isrcs);
  if (!env?.BUDDIES_DB || env.BUDDIES_DB === env.MINUTE_DB) return localRows;
  const sourceRows = await loadReadModelTrackMetadata({ MINUTE_DB: env.BUDDIES_DB }, spotifyIds, isrcs);
  return localRows.concat(sourceRows);
}

export async function repairPlaybackReadModels(env) {
  const db = env?.MINUTE_DB;
  if (!db) return { repaired: 0, skipped: true, reason: 'db-binding-missing' };
  const current = await db.prepare(`SELECT channel_id,queue_json
    FROM sh_queue_read_model_current WHERE queue_json IS NOT NULL`).all();
  let repaired = 0;
  for (const row of current.results || []) {
    const originalQueue = safeQueue(row.queue_json);
    const queue = sanitizeQueueTrackMetadata(originalQueue);
    const keys = incompletePlaybackMetadataKeys(queue);
    if (!keys || (!keys.spotifyIds.length && !keys.isrcs.length)) {
      if (queue && queue !== originalQueue) {
        await db.prepare(`UPDATE sh_queue_read_model_current SET queue_json=? WHERE channel_id=?`)
          .bind(JSON.stringify(queue), row.channel_id).run();
        repaired += 1;
      }
      continue;
    }
    const metadataRows = await playbackMetadataRows(env, keys.spotifyIds, keys.isrcs);
    const hydrated = attachReadModelTrackMetadata(queue, metadataRows);
    if (hydrated === originalQueue) continue;
    await db.prepare(`UPDATE sh_queue_read_model_current SET queue_json=? WHERE channel_id=?`)
      .bind(JSON.stringify(hydrated), row.channel_id).run();
    repaired += 1;
  }
  return { repaired, skipped: false };
}
