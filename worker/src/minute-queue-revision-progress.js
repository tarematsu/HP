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
