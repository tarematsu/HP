import { materializedResponseCadenceSeconds } from '../../site/functions/lib/api-contract.js';
import { canonicalizeTrackRows } from '../../site/functions/lib/canonical-track-rows.js';
import {
  pagesActionsR2ResponseKey,
  saveMaterializedR2Response,
} from './pages-response-r2.js';
import {
  attachPlaybackReadModelTrackMetadata,
  loadPlaybackReadModelTrackMetadata,
} from './read-model-stationhead-metadata.js';
import {
  sanitizeQueueTrackMetadata,
  trackNeedsHydration,
} from './track-metadata-quality.js';

const TRACK_HISTORY_MODEL_KEY = 'track-history';
const TRACK_HISTORY_STATUS_KEY = 'track-history-status';
const STATUS_HEADERS = Object.freeze({ 'content-type': 'application/json; charset=utf-8' });

function safeQueue(value) {
  try {
    const parsed = JSON.parse(String(value || 'null'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function compactTrackHistoryStatus(status, now) {
  return {
    ok: true,
    ranking: Array.isArray(status?.ranking) ? status.ranking : [],
    ranking_summary: status?.ranking_summary && typeof status.ranking_summary === 'object'
      ? status.ranking_summary
      : {},
    ranking_scope: status?.ranking_scope || 'all-time-latest-counter',
    source_row_count: Number(status?.source_row_count || 0),
    excluded_play_count_dates: Array.isArray(status?.excluded_play_count_dates)
      ? status.excluded_play_count_dates
      : [],
    generated_at: Number(status?.generated_at || 0) || now,
  };
}

async function publishTrackHistoryStatus(env, status) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.put !== 'function') return 0;
  const now = Date.now();
  const payload = compactTrackHistoryStatus(status, now);
  const body = JSON.stringify(payload);
  const cadenceSeconds = materializedResponseCadenceSeconds(TRACK_HISTORY_MODEL_KEY);
  try {
    await saveMaterializedR2Response(
      r2,
      TRACK_HISTORY_STATUS_KEY,
      body,
      200,
      STATUS_HEADERS,
      now,
      cadenceSeconds,
    );
    const actionsKey = pagesActionsR2ResponseKey(TRACK_HISTORY_STATUS_KEY);
    if (actionsKey) {
      await r2.put(actionsKey, JSON.stringify({
        version: 1,
        updated_at: now,
        cadence_seconds: cadenceSeconds,
        status: 200,
        headers: STATUS_HEADERS,
        body,
      }), {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
        customMetadata: {
          version: '1',
          model_key: TRACK_HISTORY_STATUS_KEY,
          updated_at: String(now),
          cadence_seconds: String(cadenceSeconds),
        },
      });
    }
    return 1;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'track_history_status_metadata_republish_failed',
      error: String(error?.message || error || '').slice(0, 500),
    }));
    return 0;
  }
}

async function repairTrackHistoryStatusRanking(env, db) {
  let row;
  try {
    const statement = db.prepare(`SELECT payload_json
      FROM sh_pages_payload_read_model
      WHERE model_key='track-history-status'
      LIMIT 1`);
    if (typeof statement?.first !== 'function') return 0;
    row = await statement.first();
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || error))) return 0;
    throw error;
  }
  const status = safeQueue(row?.payload_json);
  if (!status || !Array.isArray(status.ranking) || !status.ranking.length) return 0;
  const canonicalRanking = await canonicalizeTrackRows(db, status.ranking);
  const changed = canonicalRanking !== status.ranking;
  const nextStatus = changed ? { ...status, ranking: canonicalRanking } : status;
  if (changed) {
    await db.prepare(`UPDATE sh_pages_payload_read_model
      SET payload_json=?
      WHERE model_key='track-history-status'`)
      .bind(JSON.stringify(nextStatus)).run();
  }
  await publishTrackHistoryStatus(env, nextStatus);
  return changed ? 1 : 0;
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
    const canonicalSeeds = metadataRows.filter((metadata) => (
      Number.isSafeInteger(Number(metadata?.track_id))
      && Number(metadata.track_id) > 0
      && !trackNeedsHydration(metadata)
    ));
    const canonicalTracks = await canonicalizeTrackRows(
      db,
      hydrated.tracks,
      { seedRows: canonicalSeeds },
    );
    const canonicalQueue = canonicalTracks === hydrated.tracks
      ? hydrated
      : { ...hydrated, tracks: canonicalTracks };
    if (canonicalQueue === originalQueue) continue;

    await db.prepare(`UPDATE sh_queue_read_model_current SET queue_json=? WHERE channel_id=?`)
      .bind(JSON.stringify(canonicalQueue), row.channel_id).run();
    repaired += 1;
  }
  await repairTrackHistoryStatusRanking(env, db);
  return { repaired, skipped: false };
}
