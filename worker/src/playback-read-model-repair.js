import { canonicalizeTrackRows } from '../../site/functions/lib/canonical-track-rows.js';
import {
  attachPlaybackReadModelTrackMetadata,
  loadPlaybackReadModelTrackMetadata,
} from './read-model-stationhead-metadata.js';
import { sanitizeQueueTrackMetadata } from './track-metadata-quality.js';

function safeQueue(value) {
  try {
    const parsed = JSON.parse(String(value || 'null'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function repairTrackHistoryStatusRanking(db) {
  let row;
  try {
    row = await db.prepare(`SELECT payload_json
      FROM sh_pages_payload_read_model
      WHERE model_key='track-history-status'
      LIMIT 1`).first();
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || error))) return 0;
    throw error;
  }
  const status = safeQueue(row?.payload_json);
  if (!status || !Array.isArray(status.ranking) || !status.ranking.length) return 0;
  const canonicalRanking = await canonicalizeTrackRows(db, status.ranking);
  if (canonicalRanking === status.ranking) return 0;
  await db.prepare(`UPDATE sh_pages_payload_read_model
    SET payload_json=?
    WHERE model_key='track-history-status'`)
    .bind(JSON.stringify({ ...status, ranking: canonicalRanking })).run();
  return 1;
}

export async function repairPlaybackReadModels(env) {
  const db = env?.MINUTE_DB;
  if (!db) return { repaired: 0, status_repaired: 0, skipped: true, reason: 'db-binding-missing' };
  const current = await db.prepare(`SELECT channel_id,queue_json
    FROM sh_queue_read_model_current WHERE queue_json IS NOT NULL`).all();
  let repaired = 0;
  for (const row of current.results || []) {
    const originalQueue = safeQueue(row.queue_json);
    const queue = sanitizeQueueTrackMetadata(originalQueue);
    if (!queue?.tracks?.length) continue;

    const metadataRows = await loadPlaybackReadModelTrackMetadata(env, queue.tracks);
    const hydrated = metadataRows.length
      ? attachPlaybackReadModelTrackMetadata(queue, metadataRows)
      : queue;
    const canonicalTracks = await canonicalizeTrackRows(db, hydrated.tracks);
    const canonicalQueue = canonicalTracks === hydrated.tracks
      ? hydrated
      : { ...hydrated, tracks: canonicalTracks };
    if (canonicalQueue === originalQueue) continue;

    await db.prepare(`UPDATE sh_queue_read_model_current SET queue_json=? WHERE channel_id=?`)
      .bind(JSON.stringify(canonicalQueue), row.channel_id).run();
    repaired += 1;
  }
  const statusRepaired = await repairTrackHistoryStatusRanking(db);
  return { repaired, status_repaired: statusRepaired, skipped: false };
}
