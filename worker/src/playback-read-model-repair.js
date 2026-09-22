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

export async function repairPlaybackReadModels(env) {
  const db = env?.MINUTE_DB;
  if (!db) return { repaired: 0, skipped: true, reason: 'db-binding-missing' };
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
    if (hydrated === originalQueue) continue;

    await db.prepare(`UPDATE sh_queue_read_model_current SET queue_json=? WHERE channel_id=?`)
      .bind(JSON.stringify(hydrated), row.channel_id).run();
    repaired += 1;
  }
  return { repaired, skipped: false };
}
