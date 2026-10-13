import { scheduleQueueTracks } from './minute-facts-normalize.js';

// Count materialized positions for a revision; used by rebuild and materializer.
export async function countQueueRevisionItems(db, revisionId) {
  const row = await db.prepare(
    'SELECT COUNT(*) AS item_count FROM sh_queue_revision_items WHERE revision_id=?',
  ).bind(revisionId).first();
  return Number(row?.item_count || 0);
}

// Load only positions needed to resume an incomplete revision.
export function loadQueueRevisionPositions(db, revisionId) {
  return db.prepare(
    'SELECT position FROM sh_queue_revision_items WHERE revision_id=?',
  ).bind(revisionId).all();
}

// Lightweight membership check; do not load the full revision item set.
export async function queueRevisionPositionExists(db, revisionId, position) {
  const row = await db.prepare(`SELECT 1 AS present FROM sh_queue_revision_items
    WHERE revision_id=? AND position=? LIMIT 1`).bind(revisionId, position).first();
  return Boolean(row);
}

// Schedule the whole queue before filtering: persisted preceding positions still
// contribute duration and can invalidate later offsets. Resolve only missing IDs.
export async function resolveMissingQueueRevisionTracks(tracks, existingRows, resolve) {
  const scheduled = scheduleQueueTracks(tracks);
  const existing = new Set((existingRows || []).map((row) => Number(row.position)));
  const missing = scheduled.filter((track) => !existing.has(track.position));
  if (!missing.length) return [];
  const resolved = await resolve(missing);
  const schedules = new Map(missing.map((track) => [track.position, track]));
  return resolved.map((track) => {
    const schedule = schedules.get(track.position);
    if (!schedule) throw new Error('resolved queue track has an unexpected position');
    return { ...track, playbackOffset: schedule.playbackOffset, scheduleValid: schedule.scheduleValid };
  });
}
